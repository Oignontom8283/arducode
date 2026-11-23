import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as config from './config';
import { tr } from './l10n';

let chosen: string | undefined;

const inos = (dir: string) => { try { return fs.readdirSync(dir).filter(f => /\.(ino|pde)$/i.test(f)); } catch { return []; } };
const isSketch = (dir: string) => inos(dir).some(f => path.parse(f).name === path.basename(dir));

/** Fichiers .ino dans l'ordre de concaténation d'Arduino : principal puis alphabétique. */
export function sketchFiles(dir: string): string[] {
  const isMain = (f: string) => Number(path.parse(f).name === path.basename(dir));
  return inos(dir).sort((a, b) => isMain(b) - isMain(a) || (a < b ? -1 : 1)).map(f => path.join(dir, f));
}

/** Remonte depuis un fichier jusqu'au dossier de croquis qui le contient. */
export function sketchOfFile(file: string): string | undefined {
  let dir = path.dirname(file);
  if (/\.(ino|pde)$/i.test(file)) { return dir; }
  const stop = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath ?? dir;
  for (;;) {
    if (isSketch(dir)) { return dir; }
    if (config.norm(dir) === config.norm(stop) || path.dirname(dir) === dir) { return undefined; }
    dir = path.dirname(dir);
  }
}

async function workspaceSketches(): Promise<string[]> {
  const libs = config.libraryPaths();
  const files = await vscode.workspace.findFiles('**/*.{ino,pde}', '{**/node_modules/**,**/examples/**,**/.git/**}', 200);
  const dirs = [...new Set(files.map(f => path.dirname(f.fsPath)))].filter(d => !libs.some(l => config.isInside(d, l)));
  return dirs.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
}

/** Croquis courant : éditeur actif, réglage, dernier choix, puis premier du projet. */
export async function current(): Promise<string | undefined> {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc?.uri.scheme === 'file') {
    const s = sketchOfFile(doc.uri.fsPath);
    if (s && !config.libraryPaths().some(l => config.isInside(doc.uri.fsPath, l))) { return chosen = s; }
  }
  const fixed = config.get<string>('sketch');
  if (fixed) {
    const p = config.expandPath(fixed, config.baseDir());
    const d = /\.(ino|pde)$/i.test(p) ? path.dirname(p) : p;
    if (inos(d).length) { return d; }
  }
  if (chosen && inos(chosen).length) { return chosen; }
  const all = await workspaceSketches();
  return all.length ? chosen = all[0] : undefined;
}

export async function pick(): Promise<void> {
  const all = await workspaceSketches();
  const p = await vscode.window.showQuickPick(all.map(d => ({ label: path.basename(d), description: vscode.workspace.asRelativePath(d), dir: d })), { placeHolder: tr("Active sketch") });
  if (!p) { return; }
  chosen = p.dir;
  await config.set('sketch', path.relative(config.baseDir(p.dir), p.dir).replace(/\\/g, '/') || '.', p.dir);
}

/** arduino-cli exige <dossier>/<dossier>.ino : propose de renommer sinon. */
export async function ensureValid(dir: string): Promise<boolean> {
  if (isSketch(dir)) { return true; }
  const files = inos(dir), want = path.basename(dir) + '.ino';
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const from = files.length === 1 ? files[0] : files.find(f => active && config.norm(path.join(dir, f)) === config.norm(active));
  if (!from) { vscode.window.showErrorMessage(tr("The sketch must contain a file named \"{0}\".", want)); return false; }
  const ok = await vscode.window.showWarningMessage(tr("Arduino requires the main file to be named after its folder. Rename \"{0}\" to \"{1}\"?", from, want), { modal: true }, tr("Rename"));
  if (!ok) { return false; }
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(vscode.Uri.file(path.join(dir, from)), vscode.Uri.file(path.join(dir, want)));
  return vscode.workspace.applyEdit(edit);
}

export async function create(): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: tr("Sketch name"), validateInput: v => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/.test(v) ? null : tr("Only letters, digits, \"_\", \".\" and \"-\"") });
  if (!name) { return; }
  const where = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, title: tr("Parent folder of the sketch"), openLabel: tr("Create here"), defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
  if (!where) { return; }
  const dir = path.join(where[0].fsPath, name), file = path.join(dir, name + '.ino');
  if (fs.existsSync(dir)) { vscode.window.showErrorMessage(tr("\"{0}\" already exists.", dir)); return; }
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(file, 'void setup() {\n  \n}\n\nvoid loop() {\n  \n}\n');
  if (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir))) { await vscode.window.showTextDocument(vscode.Uri.file(file)); return; }
  const board = config.get<string>('board') || 'arduino:avr:uno';
  await fs.promises.mkdir(path.join(dir, '.vscode'));
  await fs.promises.writeFile(path.join(dir, '.vscode', 'settings.json'), JSON.stringify({ 'arducode.board': board, 'arducode.libraryPaths': ['./lib'] }, null, 2) + '\n');
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir));
}
