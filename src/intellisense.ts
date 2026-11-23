import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { getCppToolsApi, Version, CppToolsApi, CustomConfigurationProvider, SourceFileConfiguration, SourceFileConfigurationItem, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import * as cli from './cli';
import * as config from './config';
import * as sketches from './sketch';
import { compileFlags, globalLibraryEnv } from './flags';
import { applyThemeColors } from './theme';
import { GccConfig, parseGcc, prototypeHeader } from './prototypes';
import { tr } from './l10n';

interface Database { main: GccConfig; files: Map<string, GccConfig>; header: string; fallback: string[] }

const EXT_ID = 'oignontom8283.arducode';
const cache = new Map<string, Promise<Database | undefined>>();
let api: CppToolsApi | undefined;
let timer: NodeJS.Timeout | undefined;
let generation = 0;

/** Racines d'inclusion des bibliothèques d'un dossier (src/ ou racine + utility/). */
function libraryIncludes(dir: string): string[] {
  try {
    return fs.readdirSync(dir).map(n => path.join(dir, n)).filter(config.isDir).flatMap(root =>
      config.isDir(path.join(root, 'src')) ? [path.join(root, 'src')] : [root, path.join(root, 'utility')].filter(config.isDir));
  } catch { return []; }
}

// Deux exécutions simultanées partageraient le même dossier de sortie.
let queue: Promise<unknown> = Promise.resolve();

async function load(sketch: string): Promise<Database | undefined> {
  const fqbn = config.get<string>('board', sketch) || 'arduino:avr:uno';
  if (!cli.findCli()) { return; }
  const dir = path.join(cli.storageDir(), 'intellisense', crypto.createHash('sha1').update(config.norm(sketch)).digest('hex').slice(0, 16));
  const dbFile = path.join(dir, 'compile_commands.json');
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.rm(dbFile, { force: true });
  const r = await cli.run(['--json', 'compile', '-b', fqbn, '--only-compilation-database', '--build-path', dir, ...compileFlags(sketch), '--', sketch], { env: globalLibraryEnv(sketch), sketch });
  let j: any = {};
  try { j = JSON.parse(r.stdout); } catch { /* sans JSON, la base peut tout de même exister */ }
  if (!fs.existsSync(dbFile)) { throw new Error(j.error || j.compiler_err || r.stderr || 'no compilation database'); }
  const entries: any[] = JSON.parse(await fs.promises.readFile(dbFile, 'utf8'));
  const mainCpp = path.join(dir, 'sketch', path.basename(sketch) + '.ino.cpp');
  const files = new Map<string, GccConfig>();
  let main: GccConfig | undefined;
  for (const e of entries) {
    const g = parseGcc(e.arguments, e.directory);
    if (config.norm(e.file) === config.norm(mainCpp)) { main = g; }
    // Les sources du croquis sont copiées dans <build>/sketch : on rétablit leur chemin d'origine.
    const rel = path.relative(path.join(dir, 'sketch'), e.file);
    files.set(config.norm(rel.startsWith('..') || path.isAbsolute(rel) ? e.file : path.join(sketch, rel)), g);
  }
  if (!main) { throw new Error('main sketch missing from the compilation database'); }
  const header = path.join(dir, 'arducode_prototypes.h');
  const text = prototypeHeader(await fs.promises.readFile(mainCpp, 'utf8').catch(() => ''));
  if (await fs.promises.readFile(header, 'utf8').catch(() => '') !== text) { await fs.promises.writeFile(header, text); }
  // En dernier recours : toutes les bibliothèques connues, pour compléter avant même leur #include.
  const roots = [...config.existingLibraryPaths(sketch)];
  if (config.get('useGlobalLibraries', sketch)) {
    const user = await cli.runJson(['config', 'get', 'directories.user']).catch(() => undefined);
    const u = typeof user === 'string' ? user : user?.config;
    if (typeof u === 'string') { roots.push(path.join(u, 'libraries')); }
  }
  for (const p of new Set([j.builder_result?.board_platform?.install_dir, j.builder_result?.build_platform?.install_dir])) { if (p) { roots.push(path.join(p, 'libraries')); } }
  const fallback = roots.flatMap(libraryIncludes).filter(p => !main!.includes.includes(p));
  return { main, files, header, fallback };
}

function database(sketch: string): Promise<Database | undefined> {
  const key = config.norm(sketch);
  let p = cache.get(key);
  if (!p) {
    p = queue.then(() => load(sketch)).catch(e => { cli.output.appendLine('IntelliSense: ' + (e?.message ?? e)); return undefined; });
    queue = p;
    cache.set(key, p);
  }
  return p;
}

function mode(compiler: string): SourceFileConfiguration['intelliSenseMode'] {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  return `${os}-gcc-${/arm-none|aarch64/.test(path.basename(compiler)) ? 'arm' : 'x86'}`;
}

function toConfig(db: Database, file: string, sketch: string): SourceFileConfiguration {
  const ino = /\.(ino|pde)$/i.test(file), hdr = /\.(h|hh|hpp|tpp|ipp)$/i.test(file);
  const g = db.files.get(config.norm(file)) ?? db.main;
  const forced = [...g.forced];
  if (ino) {
    // Arduino concatène les .ino : chaque onglet voit tout ce qui le précède.
    forced.push(db.header);
    const list = sketches.sketchFiles(sketch), i = list.findIndex(f => config.norm(f) === config.norm(file));
    if (i > 0) { forced.push(...list.slice(0, i)); }
  } else if (hdr) {
    const h = db.main.includes.map(d => path.join(d, 'Arduino.h')).find(f => fs.existsSync(f));
    if (h) { forced.push(h); }
  }
  const compiler = process.platform === 'win32' && !/\.exe$/i.test(g.compiler) ? g.compiler + '.exe' : g.compiler;
  return {
    includePath: [...new Set([...g.includes, sketch, ...db.main.includes, ...db.fallback])],
    defines: [...g.defines], forcedInclude: forced, compilerPath: path.normalize(compiler), compilerArgs: g.args,
    intelliSenseMode: mode(compiler), standard: g.standard?.replace('++1z', '++17').replace('++2a', '++20').replace('++2b', '++23') as SourceFileConfiguration['standard'],
  };
}

async function sketchFor(file: string): Promise<string | undefined> {
  const cur = await sketches.current();
  if (config.libraryPaths(cur).some(l => config.isInside(file, l))) { return cur; }
  const own = sketches.sketchOfFile(file);
  if (own) { return own; }
  // Fichier du cœur ou d'une bibliothèque globale utilisée par le croquis.
  const db = cur && await database(cur);
  return db && (db.files.has(config.norm(file)) || [...db.main.includes, ...db.fallback].some(d => config.isInside(file, d))) ? cur : undefined;
}

const provider: CustomConfigurationProvider = {
  name: 'Arducode', extensionId: EXT_ID,
  async canProvideConfiguration(uri) { const s = await sketchFor(uri.fsPath); return !!s && !!await database(s); },
  async provideConfigurations(uris) {
    const out: SourceFileConfigurationItem[] = [];
    for (const uri of uris) {
      const s = await sketchFor(uri.fsPath), db = s && await database(s);
      if (s && db) { out.push({ uri, configuration: toConfig(db, uri.fsPath, s) }); }
    }
    return out;
  },
  async canProvideBrowseConfiguration() { const s = await sketches.current(); return !!s && !!await database(s); },
  async provideBrowseConfiguration(): Promise<WorkspaceBrowseConfiguration | null> {
    const s = await sketches.current(), db = s && await database(s);
    if (!s || !db) { return null; }
    return { browsePath: [...new Set([s, ...db.main.includes, ...config.existingLibraryPaths(s)])], compilerPath: toConfig(db, 'x.cpp', s).compilerPath, compilerArgs: db.main.args };
  },
  async canProvideBrowseConfigurationsPerFolder() { return false; },
  async provideFolderBrowseConfiguration() { return null; },
  dispose() { /* rien */ },
};

let pending: (() => void)[] = [];
export function refresh(delay = 400): Promise<void> {
  if (timer) { clearTimeout(timer); }
  const g = ++generation;
  return new Promise(resolve => {
    pending.push(resolve);
    timer = setTimeout(async () => {
      const done = pending;
      pending = [];
      const s = await sketches.current();
      cache.clear();
      if (s) { await database(s); }
      if (g === generation) { api?.didChangeCustomConfiguration(provider); api?.didChangeCustomBrowseConfiguration(provider); }
      done.forEach(f => f());
    }, delay);
  });
}

/** Pour les tests d'intégration. */
export async function inspect(file: string) { return (await provider.provideConfigurations([vscode.Uri.file(file)]))[0]?.configuration; }

let asked = false;
/** Demande l'accord avant d'écrire dans le .vscode du projet ; la réponse est le réglage arducode.configureProject. */
async function consent(folder: vscode.WorkspaceFolder): Promise<boolean> {
  const answer = config.get<boolean | null>('configureProject', folder.uri.fsPath);
  if (typeof answer === 'boolean') { return answer; }
  if (vscode.workspace.getConfiguration('C_Cpp', folder.uri).get('default.configurationProvider') === EXT_ID) { return true; }
  if (asked) { return false; }
  asked = true;
  const yes = tr("Yes"), always = tr("Always"), never = tr("Never");
  const r = await vscode.window.showInformationMessage(tr("Let Arducode set up this project (.vscode/settings.json)? It connects the C/C++ extension to your board and hides its PC run/debug buttons."), yes, always, never);
  const set = (v: boolean, target: vscode.ConfigurationTarget) => vscode.workspace.getConfiguration('arducode', folder.uri).update('configureProject', v, target);
  if (r === always) { await set(true, vscode.ConfigurationTarget.Global); }
  if (r === never) { await set(false, vscode.ConfigurationTarget.Global); }
  return r === yes || r === always;
}

async function configureWorkspace(sketch: string) {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sketch));
  if (!folder || !await consent(folder)) { return; }
  const c = vscode.workspace.getConfiguration('C_Cpp', folder.uri), target = vscode.ConfigurationTarget.WorkspaceFolder;
  // Le bouton « exécuter/déboguer » de l'extension C++ vise un programme PC : inutile ici.
  const dbg = c.inspect('debugShortcut');
  if (dbg?.workspaceFolderValue === undefined && dbg?.workspaceValue === undefined) { await c.update('debugShortcut', false, target); }
  if (!c.get('default.configurationProvider')) { await c.update('default.configurationProvider', EXT_ID, target); }
  if (config.get('themeColors', sketch)) { await applyThemeColors(); }
}

export async function start(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push({ dispose: () => { if (timer) { clearTimeout(timer); } } });
  let last = '';
  const follow = async () => {
    const s = await sketches.current();
    await vscode.commands.executeCommand('setContext', 'arducode.active', !!s);
    if (!s || s === last) { return; }
    last = s;
    configureWorkspace(s).catch(e => cli.output.appendLine(String(e)));
    void refresh(0);
  };
  const sources = vscode.workspace.createFileSystemWatcher('**/*.{ino,pde}', false, true, false);
  ctx.subscriptions.push(sources,
    sources.onDidCreate(() => { void follow(); void refresh(); }), sources.onDidDelete(() => { void refresh(); }),
    vscode.workspace.onDidSaveTextDocument(async d => {
      if (d.uri.scheme !== 'file' || !/\.(ino|pde|h|hpp|cpp|c)$/i.test(d.fileName)) { return; }
      const s = await sketches.current();
      if (s && config.isInside(d.fileName, s)) { void refresh(); }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => void follow()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (['board', 'libraryPaths', 'useGlobalLibraries', 'buildProperties', 'cliPath', 'additionalBoardUrls', 'sketch'].some(k => e.affectsConfiguration('arducode.' + k))) { cli.forgetCli(); void refresh(); }
    }));
  await follow();
  api = await getCppToolsApi(Version.v5);
  if (api) {
    ctx.subscriptions.push(api);
    api.registerCustomConfigurationProvider(provider);
    api.notifyReady(provider);
  }
}
