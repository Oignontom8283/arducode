import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cli from './cli';
import * as config from './config';
import * as sketches from './sketch';
import * as boards from './boards';
import * as monitor from './monitor';
import { globalLibraryEnv, compileFlags } from './flags';
import { tr } from './l10n';

type Mode = 'verify' | 'upload' | 'export';
const diagnostics = vscode.languages.createDiagnosticCollection('arducode');
let busy = false;

export function init(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(diagnostics,
    vscode.workspace.onDidChangeTextDocument(e => { if (e.contentChanges.length) { diagnostics.delete(e.document.uri); } }));
}

export function parseDiagnostics(text: string): Map<string, vscode.Diagnostic[]> {
  const map = new Map<string, vscode.Diagnostic[]>();
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^((?:[A-Za-z]:)?[^:]+):(\d+):(?:(\d+):)? (fatal error|error|warning|note): (.*)$/.exec(line)
      ?? /^((?:[A-Za-z]:)?[^:]+):(\d+):()() ?(undefined reference to .*)$/.exec(line);
    if (!m || seen.has(line) || !path.isAbsolute(m[1]) || !fs.existsSync(m[1])) { continue; }
    seen.add(line);
    const l = Math.max(0, +m[2] - 1), c = m[3] ? Math.max(0, +m[3] - 1) : 0;
    const sev = m[4] === 'warning' ? vscode.DiagnosticSeverity.Warning : m[4] === 'note' ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Error;
    const d = new vscode.Diagnostic(new vscode.Range(l, c, l, m[3] ? c + 1 : 999), m[5], sev);
    d.source = 'arduino';
    const key = path.normalize(m[1]);
    map.set(key, [...(map.get(key) ?? []), d]);
  }
  return map;
}

export async function build(mode: Mode): Promise<boolean> {
  if (busy) { vscode.window.showInformationMessage(tr("A build is already running.")); return false; }
  busy = true;
  try { return await doBuild(mode); } finally { busy = false; }
}

async function doBuild(mode: Mode): Promise<boolean> {
  const sketch = await sketches.current();
  if (!sketch) { vscode.window.showErrorMessage(tr("No .ino sketch found in this project.")); return false; }
  if (!await sketches.ensureValid(sketch)) { return false; }
  const programmer = config.get<string>('programmer', sketch);
  let port = config.port(sketch);
  if (mode === 'upload' && !programmer && (!port || !(await boards.listPorts()).some(p => p.address === port))) {
    if (port) { vscode.window.showWarningMessage(tr("Port {0} is not connected: choose another one.", port)); }
    const p = await boards.selectPort(sketch); // peut aussi renseigner la carte
    if (!p) { return false; }
    port = p;
  }
  if (!config.get<string>('board', sketch) && !await boards.selectBoard(sketch)) { return false; }
  const board = config.get<string>('board', sketch);
  await vscode.workspace.saveAll(false);

  const args = ['compile', '-b', board, '--warnings', config.get<string>('warnings', sketch), ...compileFlags(sketch)];
  if (config.get('verbose', sketch)) { args.push('-v'); }
  if (mode === 'export') { args.push('--export-binaries'); }
  if (mode === 'upload') {
    args.push('--upload');
    if (port) { args.push('-p', port); }
    if (programmer) { args.push('-P', programmer); }
    if (config.get('verifyAfterUpload', sketch)) { args.push('--verify'); }
  }
  args.push('--', sketch);

  const title = mode === 'upload' ? tr("Uploading") : mode === 'export' ? tr("Export") : tr("Verification");
  diagnostics.clear();
  cli.output.clear();
  cli.output.appendLine(`> ${title}: ${path.basename(sketch)} (${board}${mode === 'upload' && port ? ', ' + port : ''})\n`);
  cli.output.show(true);
  const resume = mode === 'upload' ? await monitor.suspend() : undefined;
  const t0 = Date.now();
  try {
    const { r, cancelled } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${title}…`, cancellable: true }, async (_p, token) => ({
      r: await cli.run(args, { token, env: globalLibraryEnv(sketch), sketch, cwd: sketch, onData: d => cli.output.append(d) }),
      cancelled: token.isCancellationRequested,
    }));
    if (cancelled) { cli.output.appendLine(tr("\nCancelled.")); return false; }
    const all = r.stdout + '\n' + r.stderr;
    for (const [f, d] of parseDiagnostics(all)) { diagnostics.set(vscode.Uri.file(f), d); }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.code === 0) {
      cli.output.appendLine(tr("\n✔ {0}: done in {1} s.", title, secs));
      vscode.window.setStatusBarMessage(tr("$(check) {0}: done", title), 5000);
      return true;
    }
    cli.output.appendLine(tr("\n✖ {0}: failed ({1} s).", title, secs));
    void explain(all, board, sketch, title);
    return false;
  } finally { resume?.(); }
}

async function explain(text: string, board: string, sketch: string, title: string) {
  if (process.platform === 'linux' && /permission denied[^\n]*\/dev\/tty|\/dev\/tty[^\n]*permission denied/i.test(text)) {
    vscode.window.showErrorMessage(tr("No permission to use the serial port. Run \"sudo usermod -aG dialout $USER\" (group \"uucp\" on Arch), then log out and back in."));
    return;
  }
  const missing = /fatal error: ([^\s:]+\.(?:h|hpp)): No such file/.exec(text)?.[1];
  if (missing) {
    if (await vscode.window.showErrorMessage(tr("File \"{0}\" not found.", missing), tr("Find the library"))) {
      await vscode.commands.executeCommand('arducode.manageLibraries', path.parse(missing).name.replace(/_/g, ' '));
    }
    return;
  }
  const id = board.split(':').slice(0, 2).join(':');
  const cores = await cli.runJson(['core', 'list'], { sketch }).then(j => j.platforms ?? [], () => undefined);
  if (cores && !cores.some((c: any) => c.id === id)) {
    if (await vscode.window.showErrorMessage(tr("Board support \"{0}\" is not installed.", id), tr("Install"))) {
      try {
        await cli.runLogged(['core', 'install', id], tr("Installing {0}…", id), { sketch });
        await vscode.commands.executeCommand('arducode.refreshIntelliSense');
      } catch (e: any) { vscode.window.showErrorMessage(e.message); }
    }
    return;
  }
  if (await vscode.window.showErrorMessage(tr("{0}: failed.", title), tr("Show problems"))) { await vscode.commands.executeCommand('workbench.actions.view.problems'); }
}
