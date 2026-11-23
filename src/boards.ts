import * as vscode from 'vscode';
import * as cli from './cli';
import * as config from './config';
import { tr } from './l10n';

export interface Port { address: string; label: string; protocol: string; board?: { name: string; fqbn: string }; info: string }

export const baseFqbn = (f: string) => f.split(':').slice(0, 3).join(':');

export async function listPorts(): Promise<Port[]> {
  const j = await cli.runJson(['board', 'list']);
  return (j.detected_ports ?? []).map((d: any) => ({
    address: d.port.address, label: d.port.label || d.port.address, protocol: d.port.protocol,
    board: d.matching_boards?.find((b: any) => b.fqbn),
    info: [d.port.protocol_label, d.port.properties?.manufacturer].filter(Boolean).join(' · '),
  }));
}

export async function selectPort(sketch?: string): Promise<string | undefined> {
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { port?: Port; action?: string }>();
  let open = true;
  const refresh = async () => {
    qp.busy = true;
    qp.placeholder = tr("Searching for ports…");
    try {
      const cur = config.port(sketch);
      const ports = await listPorts();
      if (!open) { return; }
      qp.placeholder = ports.length ? tr("Board port") : tr("No port found: plug in the board, then refresh");
      qp.items = [
        ...ports.map(p => ({ label: `$(plug) ${p.label}`, description: [p.board?.name, p.address === cur ? tr("(current)") : ''].filter(Boolean).join(' '), detail: p.info, port: p })),
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: tr("$(refresh) Refresh"), action: 'refresh', alwaysShow: true },
        { label: tr("$(edit) Enter a port…"), action: 'manual', alwaysShow: true },
      ];
      qp.busy = false;
    } catch (e: any) { vscode.window.showErrorMessage(e.message); if (open) { qp.hide(); } }
  };
  qp.show();
  void refresh();
  const picked = await new Promise<Port | 'manual' | undefined>(resolve => {
    qp.onDidAccept(() => {
      const it = qp.selectedItems[0];
      if (!it) { return; }
      if (it.action === 'refresh') { void refresh(); return; }
      resolve(it.action === 'manual' ? 'manual' : it.port);
      qp.hide();
    });
    qp.onDidHide(() => { open = false; resolve(undefined); qp.dispose(); });
  });
  if (!picked) { return; }
  const address = picked === 'manual' ? await vscode.window.showInputBox({ prompt: 'Port', placeHolder: process.platform === 'win32' ? 'COM3' : '/dev/ttyACM0' }) : picked.address;
  if (!address) { return; }
  await config.setPort(address, sketch);
  const board = picked === 'manual' ? undefined : picked.board;
  const cur = config.get<string>('board', sketch);
  if (board && baseFqbn(cur) !== board.fqbn) {
    const yes = !cur || await vscode.window.showInformationMessage(tr("Board detected on {0}: {1}. Select it?", address, board.name), tr("Yes"), tr("No")) === tr("Yes");
    if (yes) { await config.set('board', board.fqbn, sketch); }
  }
  return address;
}

export async function selectBoard(sketch?: string): Promise<string | undefined> {
  const cur = baseFqbn(config.get<string>('board', sketch));
  const items = cli.runJson(['board', 'listall'], { sketch }).then(j => [
    ...(j.boards ?? []).map((b: any) => ({ label: b.name as string, description: b.fqbn + (cur === b.fqbn ? tr(" (current board)") : ''), fqbn: b.fqbn as string })),
    { label: tr("$(cloud-download) Install more boards…"), description: '', fqbn: '', alwaysShow: true },
  ]);
  const p = await vscode.window.showQuickPick(items, { placeHolder: tr("Board"), matchOnDescription: true });
  if (!p) { return; }
  if (!p.fqbn) { await vscode.commands.executeCommand('arducode.manageCores'); return; }
  await config.set('board', p.fqbn, sketch);
  await boardOptions(sketch, true);
  return p.fqbn;
}

export async function boardOptions(sketch?: string, silent = false): Promise<void> {
  const full = config.get<string>('board', sketch);
  if (!full) { if (!silent) { await selectBoard(sketch); } return; }
  const base = baseFqbn(full);
  const chosen = new Map<string, string>();
  for (const s of (full.split(':')[3] ?? '').split(',').filter(Boolean)) { const i = s.indexOf('='); chosen.set(s.slice(0, i), s.slice(i + 1)); }
  const opts: any[] = (await cli.runJson(['board', 'details', '-b', base], { sketch })).config_options ?? [];
  if (!opts.length) { if (!silent) { vscode.window.showInformationMessage(tr("This board has no options.")); } return; }
  for (;;) {
    const val = (o: any) => o.values.find((v: any) => chosen.has(o.option) ? v.value === chosen.get(o.option) : v.selected);
    const p = await vscode.window.showQuickPick([
      { label: tr("$(check) Done"), description: '', opt: undefined as any },
      ...opts.map(o => ({ label: o.option_label as string, description: val(o)?.value_label as string, opt: o })),
    ], { placeHolder: tr("Board options") });
    if (!p?.opt) { break; }
    const v = await vscode.window.showQuickPick((p.opt.values as any[]).map(x => ({ label: x.value_label as string, description: x.value as string, x })), { placeHolder: p.opt.option_label });
    if (v) { if (v.x.selected) { chosen.delete(p.opt.option); } else { chosen.set(p.opt.option, v.x.value); } }
  }
  const s = [...chosen].map(([k, v]) => `${k}=${v}`).join(',');
  await config.set('board', s ? `${base}:${s}` : base, sketch);
}
