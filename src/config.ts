import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export function folderOf(dir?: string): vscode.WorkspaceFolder | undefined {
  return (dir && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir))) || vscode.workspace.workspaceFolders?.[0];
}

/** Dossier auquel les chemins relatifs des réglages se rapportent. */
export function baseDir(sketchDir?: string): string {
  if (sketchDir) {
    const own = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sketchDir));
    return own ? own.uri.fsPath : sketchDir;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
}

export function get<T>(key: string, sketchDir?: string): T {
  return vscode.workspace.getConfiguration('arducode', folderOf(sketchDir)?.uri).get<T>(key) as T;
}

export async function set(key: string, value: unknown, sketchDir?: string): Promise<void> {
  const folder = folderOf(sketchDir);
  const target = folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration('arducode', folder?.uri).update(key, value, target);
}

export function expandPath(p: string, base: string): string {
  const s = p
    .replace(/\$\{workspaceFolder\}/g, () => base)
    .replace(/\$\{env:([^}]+)\}/g, (_, n: string) => process.env[n] ?? '')
    .replace(/^~(?=$|[\/])/, () => os.homedir());
  return path.resolve(base, s);
}

/** Tous les dossiers de bibliothèques configurés (existants ou non). */
export function libraryPaths(sketchDir?: string): string[] {
  const base = baseDir(sketchDir);
  const list = get<string[]>('libraryPaths', sketchDir) ?? [];
  return [...new Set(list.filter(p => p.trim()).map(p => expandPath(p, base)))];
}

export const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export const existingLibraryPaths = (sketchDir?: string) => libraryPaths(sketchDir).filter(isDir);
export const norm = (p: string) => process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
export const isInside = (file: string, dir: string) => {
  const f = norm(file), d = norm(dir).replace(/[\/]+$/, '');
  return f === d || f.startsWith(d + path.sep);
};

let memory: vscode.Memento | undefined;
const portChanged = new vscode.EventEmitter<void>();
export const onDidChangePort = portChanged.event;

export function init(ctx: vscode.ExtensionContext) {
  memory = ctx.workspaceState;
  ctx.subscriptions.push(portChanged, vscode.workspace.onDidChangeConfiguration(async e => {
    if (!e.affectsConfiguration('arducode.port')) { return; }
    // Un réglage modifié à la main l'emporte sur le dernier choix.
    for (const k of memory?.keys() ?? []) { if (k.startsWith('port:')) { await memory?.update(k, undefined); } }
    portChanged.fire();
  }));
}

/** Port choisi sur ce poste (mémorisé hors du projet), sinon réglage arducode.port. */
export const port = (sketchDir?: string): string => memory?.get<string>('port:' + norm(baseDir(sketchDir))) || get<string>('port', sketchDir) || '';

export async function setPort(address: string, sketchDir?: string): Promise<void> {
  await memory?.update('port:' + norm(baseDir(sketchDir)), address);
  portChanged.fire();
}
