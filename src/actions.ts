import * as vscode from 'vscode';
import * as path from 'path';
import * as config from './config';
import * as sketches from './sketch';
import { tr } from './l10n';

interface Action { label: string; icon: string; command: string; description?: string; tooltip?: string }

/** Section « Croquis », en tête de la barre latérale Arducode. */
export class Actions implements vscode.TreeDataProvider<Action> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  refresh() { this.changed.fire(); }

  getTreeItem(a: Action): vscode.TreeItem {
    const t = new vscode.TreeItem(a.label);
    t.id = a.command;
    t.iconPath = new vscode.ThemeIcon(a.icon);
    t.description = a.description;
    t.tooltip = a.tooltip ?? a.label;
    t.command = { command: 'arducode.' + a.command, title: a.label };
    return t;
  }

  async getChildren(parent?: Action): Promise<Action[]> {
    const s = parent ? undefined : await sketches.current();
    if (!s) { return []; } // affiche viewsWelcome
    const board = config.get<string>('board', s), port = config.port(s);
    return [
      { label: tr("Verify"), icon: 'check', command: 'verify', description: path.basename(s), tooltip: tr("Compile the sketch") },
      { label: tr("Upload"), icon: 'arrow-right', command: 'upload', tooltip: tr("Compile and send to the board") },
      { label: tr("Port"), icon: 'plug', command: 'selectPort', description: port || tr("not set") },
      { label: tr("Board"), icon: 'circuit-board', command: 'selectBoard', description: board ? board.split(':').slice(2).join(':') : tr("not set"), tooltip: board },
      { label: tr("Board options"), icon: 'settings', command: 'boardOptions' },
      { label: tr("Serial monitor"), icon: 'pulse', command: 'openMonitor', tooltip: tr("Open the serial monitor") },
      { label: tr("Examples"), icon: 'book', command: 'openExample' },
      { label: tr("Project settings"), icon: 'gear', command: 'openSettings' },
    ];
  }
}
