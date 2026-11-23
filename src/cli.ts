import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import * as config from './config';
import { tr } from './l10n';

export const output = vscode.window.createOutputChannel('Arducode');
let storage = '';
let found: string | undefined;

export function init(ctx: vscode.ExtensionContext) { storage = ctx.globalStorageUri.fsPath; }
export const storageDir = () => storage;
export const forgetCli = () => { found = undefined; };

const exe = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';

function candidates(): string[] {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const inIde = ['resources', 'app', 'lib', 'backend', 'resources', exe];
  const extra = process.platform === 'win32'
    ? [path.join(pf, 'Arduino CLI', exe), path.join(pf, 'Arduino IDE', ...inIde),
       path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Arduino IDE', ...inIde)]
    : ['/usr/local/bin/' + exe, '/opt/homebrew/bin/' + exe, path.join(os.homedir(), '.local', 'bin', exe),
       '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/' + exe];
  const fromPath = (process.env.PATH ?? '').split(path.delimiter).filter(p => path.isAbsolute(p)).map(p => path.join(p, exe));
  return [...fromPath, ...extra, path.join(storage, 'bin', exe)];
}

export function findCli(): string | undefined {
  const custom = config.get<string>('cliPath');
  if (custom) { return config.expandPath(custom, config.baseDir()); }
  if (found && fs.existsSync(found)) { return found; }
  return found = candidates().find(p => fs.existsSync(p));
}

let asking: Promise<string> | undefined;
export async function cliPath(): Promise<string> {
  return findCli() ?? (asking ??= askInstall().finally(() => asking = undefined));
}

async function askInstall(): Promise<string> {
  const pick = await vscode.window.showWarningMessage(tr("Arducode needs arduino-cli, which was not found on this computer."), tr("Install"), tr("Locate it"));
  if (pick === tr("Locate it")) {
    const f = await vscode.window.showOpenDialog({ canSelectMany: false, title: 'arduino-cli' });
    if (f) {
      await vscode.workspace.getConfiguration('arducode').update('cliPath', f[0].fsPath, vscode.ConfigurationTarget.Global);
      return f[0].fsPath;
    }
  }
  if (pick !== tr("Install")) { throw new Error(tr("arduino-cli was not found.")); }
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: tr("Downloading arduino-cli…") }, async () => {
    const osName = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    const arch = osName === 'Windows' ? '64bit' : process.arch === 'arm64' ? 'ARM64' : process.arch === 'arm' ? 'ARMv7' : '64bit';
    const file = `arduino-cli_latest_${osName}_${arch}.${osName === 'Windows' ? 'zip' : 'tar.gz'}`;
    const res = await fetch('https://downloads.arduino.cc/arduino-cli/' + file);
    if (!res.ok) { throw new Error(tr("Downloading arduino-cli: HTTP {0}", res.status)); }
    const bin = path.join(storage, 'bin');
    await fs.promises.mkdir(bin, { recursive: true });
    const archive = path.join(bin, file);
    await fs.promises.writeFile(archive, Buffer.from(await res.arrayBuffer()));
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const r = await exec(tar, ['-xf', archive, '-C', bin]);
    await fs.promises.rm(archive, { force: true });
    const p = path.join(bin, exe);
    if (r.code !== 0 || !fs.existsSync(p)) { throw new Error(tr("Could not extract arduino-cli: ") + r.stderr); }
    await exec(p, ['core', 'update-index']);
    return found = p;
  });
}

export interface Result { code: number; stdout: string; stderr: string }
export interface RunOptions { env?: Record<string, string>; onData?: (s: string) => void; token?: vscode.CancellationToken; cwd?: string; sketch?: string }

export function killTree(p: ChildProcess) {
  if (process.platform === 'win32' && p.pid) { spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }).on('error', () => p.kill()); }
  else { p.kill(); }
}

export function exec(cmd: string, args: string[], o: RunOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    // LC_ALL=C : messages de gcc en anglais, indispensables à l'analyse des erreurs.
    const p = spawn(cmd, args, { windowsHide: true, cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', ...o.env } });
    const out: string[] = [], err: string[] = [];
    p.stdout.setEncoding('utf8').on('data', (d: string) => { out.push(d); o.onData?.(d); });
    p.stderr.setEncoding('utf8').on('data', (d: string) => { err.push(d); o.onData?.(d); });
    const sub = o.token?.onCancellationRequested(() => killTree(p));
    p.on('error', e => { sub?.dispose(); reject(e); });
    p.on('close', code => { sub?.dispose(); resolve({ code: code ?? -1, stdout: out.join(''), stderr: err.join('') }); });
  });
}

function globalFlags(sketch?: string): string[] {
  return ['--no-color', ...(config.get<string[]>('additionalBoardUrls', sketch) ?? []).flatMap(u => ['--additional-urls', u])];
}

export async function run(args: string[], o: RunOptions = {}): Promise<Result> {
  return exec(await cliPath(), [...globalFlags(o.sketch), ...args], o);
}

export async function runJson<T = any>(args: string[], o: RunOptions = {}): Promise<T> {
  const r = await run(['--json', ...args], o);
  let j: any;
  try { j = JSON.parse(r.stdout); } catch { 
    let text = (r.stderr || r.stdout || tr("arduino-cli: exit code {0}", r.code)).trim();
    try { text = JSON.parse(text).error ?? text; } catch { /* texte simple */ }
    throw new Error(text);
  }
  if (j?.error) { throw new Error(j.error); }
  return j;
}

/** Exécute en affichant la sortie ; lève une erreur en cas d'échec. */
export async function runLogged(args: string[], title: string, o: RunOptions = {}): Promise<void> {
  output.appendLine(`\n> arduino-cli ${args.join(' ')}`);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (_p, token) => {
    const r = await run(args, { ...o, token, onData: d => output.append(d) });
    if (token.isCancellationRequested) { throw new vscode.CancellationError(); }
    if (r.code !== 0) { throw new Error(r.stderr.trim().split(/\r?\n/).pop() || tr("{0} failed", title)); }
  });
}
