import * as vscode from 'vscode';
import * as cli from './cli';
import * as config from './config';
import * as sketches from './sketch';
import * as boards from './boards';
import * as build from './build';
import * as intellisense from './intellisense';
import * as libraries from './libraries';
import * as monitor from './monitor';
import * as docs from './docs';
import { Actions } from './actions';
import { Manager } from './manager';
import { tr } from './l10n';

export async function activate(ctx: vscode.ExtensionContext) {
  cli.init(ctx);
  config.init(ctx);
  build.init(ctx);
  ctx.subscriptions.push(cli.output);
  const libs = new Manager('lib'), cores = new Manager('core');
  const keep = { webviewOptions: { retainContextWhenHidden: true } };
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('arducode.libs', libs, keep),
    vscode.window.registerWebviewViewProvider('arducode.cores', cores, keep));
  const actions = new Actions();
  ctx.subscriptions.push(vscode.window.registerTreeDataProvider('arducode.sketchActions', actions));
  monitor.register(ctx);
  docs.register(ctx);

  const command = (name: string, fn: (...a: any[]) => any) => ctx.subscriptions.push(vscode.commands.registerCommand('arducode.' + name, async (...a) => {
    try { return await fn(...a); }
    catch (e: any) { if (!(e instanceof vscode.CancellationError)) { cli.output.appendLine(String(e?.stack ?? e)); vscode.window.showErrorMessage(e?.message ?? String(e)); } }
  }));
  command('verify', () => build.build('verify'));
  command('upload', () => build.build('upload'));
  command('exportBinary', () => build.build('export'));
  command('selectPort', async () => boards.selectPort(await sketches.current()));
  command('selectBoard', async () => boards.selectBoard(await sketches.current()));
  command('boardOptions', async () => boards.boardOptions(await sketches.current()));
  command('openMonitor', () => monitor.open());
  command('manageLibraries', (q?: unknown) => libs.search(typeof q === 'string' ? q : ''));
  command('manageCores', (q?: unknown) => cores.search(typeof q === 'string' ? q : ''));
  command('refreshLists', () => Promise.all([libs.reload(), cores.reload()]));
  command('installZip', async () => { await libraries.installZip(); await libs.reload(); });
  command('installGit', async () => { await libraries.installGit(); await libs.reload(); });
  command('openExample', () => libraries.openExample());
  command('newSketch', () => sketches.create());
  command('selectSketch', () => sketches.pick());
  command('refreshIntelliSense', () => intellisense.refresh(0));
  command('openSettings', () => vscode.commands.executeCommand(vscode.workspace.workspaceFolders ? 'workbench.action.openWorkspaceSettings' : 'workbench.action.openSettings', { query: 'arducode' }));

  const items = [['verify', '$(check)', tr("Verify")], ['upload', '$(arrow-right)', tr("Upload")], ['selectBoard', '', tr("Board")], ['selectPort', '', tr("Serial port")], ['openMonitor', '$(pulse)', tr("Serial monitor")]].map(([c, text, tip], i) => {
    const s = vscode.window.createStatusBarItem('arducode.' + c, vscode.StatusBarAlignment.Left, 50 - i);
    s.name = s.tooltip = 'Arducode: ' + tip;
    s.command = 'arducode.' + c;
    s.text = text;
    ctx.subscriptions.push(s);
    return s;
  });
  const update = async () => {
    const s = await sketches.current();
    const b = config.get<string>('board', s), p = config.port(s);
    items[2].text = `$(circuit-board) ${b ? b.split(':').slice(2).join(':') : tr("Select board")}`;
    items[3].text = `$(plug) ${p || tr("Select port")}`;
    items.forEach(i => s ? i.show() : i.hide());
    actions.refresh();
  };
  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => void update()),
    config.onDidChangePort(() => void update()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('arducode')) { return; }
      void update();
      if (e.affectsConfiguration('arducode.additionalBoardUrls') || e.affectsConfiguration('arducode.libraryPaths')) { void libs.reload(); void cores.reload(); }
    }));
  await update();
  void intellisense.start(ctx).then(update, e => cli.output.appendLine('IntelliSense: ' + e));
  return { inspect: intellisense.inspect, installLibrary: libraries.install };
}

export function deactivate() { /* tout est dans subscriptions */ }
