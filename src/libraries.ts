import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cli from './cli';
import * as config from './config';
import * as sketches from './sketch';
import { tr } from './l10n';

export interface Installed { name: string; version: string; dir: string; root: string; sentence: string; author: string; url: string }

function properties(dir: string): Record<string, string> | undefined {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(dir, 'library.properties'), 'utf8').split(/\r?\n/)
      .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  } catch { return undefined; }
}

const subdirs = (d: string) => { try { return fs.readdirSync(d).filter(n => !n.startsWith('.') && !n.endsWith('.arducode-tmp')).map(n => path.join(d, n)).filter(config.isDir); } catch { return []; } };

export async function installed(): Promise<Installed[]> {
  return config.existingLibraryPaths(await sketches.current()).flatMap(root => subdirs(root).map(dir => {
    const p = properties(dir) ?? {};
    return { name: p.name || path.basename(dir), version: p.version || '', dir, root, sentence: p.sentence || '', author: p.author || '', url: p.url || '' };
  }));
}

/** Dossier de destination ; demande s'il y en a plusieurs. */
async function destination(): Promise<string | undefined> {
  const sketch = await sketches.current();
  if (!sketch && !vscode.workspace.workspaceFolders) { throw new Error(tr("Open a folder or a sketch first.")); }
  const list = config.libraryPaths(sketch);
  if (!list.length) { throw new Error(tr("\"arducode.libraryPaths\" is empty.")); }
  if (list.length === 1) { return list[0]; }
  const base = config.baseDir(sketch);
  return (await vscode.window.showQuickPick(list.map(d => ({ label: path.relative(base, d) || '.', description: d, dir: d })), { placeHolder: tr("Install into…") }))?.dir;
}

async function place(src: string, dest: string) {
  const tmp = dest + '.arducode-tmp';
  await fs.promises.rm(tmp, { recursive: true, force: true });
  await fs.promises.cp(src, tmp, { recursive: true });
  await fs.promises.rm(dest, { recursive: true, force: true });
  await fs.promises.rename(tmp, dest);
}

/**
 * arduino-cli n'installe que dans son sketchbook : on installe dans un sketchbook
 * temporaire, puis on déplace vers le dossier du projet.
 */
async function viaStaging(args: string[], title: string, root: string, requested?: string): Promise<string[]> {
  const staging = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'arducode-'));
  try {
    await cli.runLogged(args, title, { env: { ARDUINO_DIRECTORIES_USER: staging, ARDUINO_LIBRARY_ENABLE_UNSAFE_INSTALL: 'true' } });
    const have = new Set((await installed()).map(l => l.name));
    await fs.promises.mkdir(root, { recursive: true });
    const done: string[] = [];
    for (const src of subdirs(path.join(staging, 'libraries'))) {
      const name = properties(src)?.name ?? path.basename(src);
      if (requested && name !== requested && have.has(name)) { continue; } // dépendance déjà présente
      const dest = path.join(root, path.basename(src));
      const risky = fs.existsSync(path.join(dest, '.git')) || (!requested && fs.existsSync(dest));
      if (risky && !await vscode.window.showWarningMessage(tr("Replace \"{0}\"?", dest), { modal: true }, tr("Replace"))) { continue; }
      await place(src, dest);
      done.push(name);
    }
    return done;
  } finally { await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => undefined); }
}

async function finished(names: string[]) {
  if (!names.length) { return; }
  vscode.window.showInformationMessage(tr("Installed: ") + names.join(', '));
  await vscode.commands.executeCommand('arducode.refreshIntelliSense');
}

export async function install(name: string, version: string, root?: string): Promise<string[]> {
  // Une mise à jour reste dans le dossier où la bibliothèque se trouve déjà.
  const dest = root ?? (await installed()).find(l => l.name === name)?.root ?? await destination();
  if (!dest) { return []; }
  const done = await viaStaging(['lib', 'install', '--', version ? `${name}@${version}` : name], tr("Installing {0}…", name), dest, name);
  await finished(done);
  return done;
}

export async function installZip() {
  const f = await vscode.window.showOpenDialog({ filters: { [tr("ZIP library")]: ['zip'] }, canSelectMany: false });
  const dest = f && await destination();
  if (f && dest) { await finished(await viaStaging(['lib', 'install', '--zip-path', '--', f[0].fsPath], tr("Importing the ZIP…"), dest)); }
}

export async function installGit() {
  const url = await vscode.window.showInputBox({ prompt: tr("Git URL of the library"), placeHolder: tr("https://github.com/author/lib.git#v1.0"), validateInput: v => /^(https?|git|ssh):\/\//.test(v) ? null : tr("An https:// URL is expected") });
  const dest = url && await destination();
  if (url && dest) { await finished(await viaStaging(['lib', 'install', '--git-url', '--', url], tr("Cloning…"), dest)); }
}

export async function remove(dir: string) {
  const lib = (await installed()).find(l => l.dir === dir);
  if (!lib) { return; }
  if (!await vscode.window.showWarningMessage(tr("Remove the library \"{0}\"?", lib.name), { modal: true, detail: dir }, tr("Remove"))) { return; }
  try { await vscode.workspace.fs.delete(vscode.Uri.file(dir), { recursive: true, useTrash: true }); }
  catch {
    if (!await vscode.window.showWarningMessage(tr("The trash is unavailable. Delete permanently?"), { modal: true }, tr("Remove"))) { return; }
    await fs.promises.rm(dir, { recursive: true });
  }
  await vscode.commands.executeCommand('arducode.refreshIntelliSense');
}

export async function openExample() {
  const items: (vscode.QuickPickItem & { dir: string })[] = [];
  const scan = (lib: string, dir: string, depth: number) => {
    for (const d of subdirs(dir)) {
      if (fs.existsSync(path.join(d, path.basename(d) + '.ino'))) { items.push({ label: path.basename(d), description: lib, dir: d }); }
      else if (depth < 4) { scan(lib, d, depth + 1); }
    }
  };
  for (const l of await installed()) { scan(l.name, path.join(l.dir, 'examples'), 0); }
  const listed = await cli.runJson(['lib', 'list', '--all']).catch(() => ({}));
  for (const x of listed.installed_libraries ?? []) { if (x.library?.install_dir) { scan(x.library.name, path.join(x.library.install_dir, 'examples'), 0); } }
  if (!items.length) { vscode.window.showInformationMessage(tr("No examples: install a library first.")); return; }
  const p = await vscode.window.showQuickPick(items, { placeHolder: tr("Example to copy"), matchOnDescription: true });
  if (!p) { return; }
  const where = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: tr("Copy here"), defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
  if (!where) { return; }
  const dest = path.join(where[0].fsPath, p.label);
  if (fs.existsSync(dest)) { vscode.window.showErrorMessage(tr("\"{0}\" already exists.", dest)); return; }
  await fs.promises.cp(p.dir, dest, { recursive: true });
  await vscode.window.showTextDocument(vscode.Uri.file(path.join(dest, p.label + '.ino')));
}
