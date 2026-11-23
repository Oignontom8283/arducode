import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import * as cli from './cli';
import * as config from './config';
import * as sketches from './sketch';
import * as boards from './boards';
import { tr, esc, json } from './l10n';

let view: vscode.WebviewView | undefined;
let proc: ChildProcess | undefined;
let buffer = '';
let flush: NodeJS.Timeout | undefined;
let starting = false;

const post = (m: any) => void view?.webview.postMessage(m);
function emit(s: string) {
  buffer += s;
  if (buffer.length > 200000) { buffer = buffer.slice(-200000); }
  flush ??= setTimeout(() => { flush = undefined; post({ type: 'data', s: buffer }); buffer = ''; }, 50);
}
async function state() {
  const s = await sketches.current();
  post({ type: 'state', on: !!proc, port: config.port(s), baud: config.get('baudRate', s) });
}

export async function start() {
  if (proc || starting) { return; }
  starting = true;
  try {
    const s = await sketches.current();
    const port = config.port(s) || await boards.selectPort(s);
    if (!port) { return; }
    const args = ['monitor', '--no-color', '--quiet', '-p', port, '-c', `baudrate=${config.get<number>('baudRate', s)}`];
    for (const c of config.get<string[]>('monitorConfig', s) ?? []) { args.push('-c', c); }
    const p = spawn(await cli.cliPath(), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    proc = p;
    p.stdout.setEncoding('utf8').on('data', emit);
    p.stderr.setEncoding('utf8').on('data', emit);
    p.stdin.on('error', () => undefined);
    p.on('error', e => { emit(`\n[${e.message}]\n`); if (proc === p) { proc = undefined; void state(); } });
    p.on('close', () => { emit(tr("\n[Monitor closed]\n")); if (proc === p) { proc = undefined; void state(); } });
  } finally { starting = false; void state(); }
}

export async function stop() {
  const p = proc;
  if (!p) { return; }
  proc = undefined;
  await new Promise<void>(r => { const t = setTimeout(r, 2000); p.once('close', () => { clearTimeout(t); r(); }); cli.killTree(p); });
  void state();
}

const restart = async () => { if (proc) { await stop(); await start(); } };

/** Libère le port pour le téléversement ; renvoie de quoi rouvrir le moniteur. */
export async function suspend(): Promise<(() => void) | undefined> {
  if (!proc) { return; }
  await stop();
  return () => void start();
}

export async function open() {
  await vscode.commands.executeCommand('arducode.monitor.focus');
  await start();
}

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push({ dispose: () => { if (proc) { cli.killTree(proc); } } },
    vscode.window.registerWebviewViewProvider('arducode.monitor', {
      resolveWebviewView(v) {
        view = v;
        v.webview.options = { enableScripts: true, localResourceRoots: [] };
        v.onDidDispose(() => view = undefined);
        v.webview.onDidReceiveMessage(async m => {
          try {
            if (m.type === 'ready') { await state(); }
            if (m.type === 'toggle') { await (proc ? stop() : start()); }
            if (m.type === 'send') { proc?.stdin?.write(String(m.s)); }
            if (m.type === 'baud' && Number(m.baud) > 0) { await config.set('baudRate', Number(m.baud), await sketches.current()); }
          } catch (e: any) { vscode.window.showErrorMessage(e.message); }
        });
        v.webview.html = html();
      },
    }, { webviewOptions: { retainContextWhenHidden: true } }),
    config.onDidChangePort(async () => { await restart(); void state(); }),
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (['baudRate', 'monitorConfig'].some(k => e.affectsConfiguration('arducode.' + k))) { await restart(); void state(); }
    }));
}

function html(): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const bauds = [300, 1200, 2400, 4800, 9600, 19200, 31250, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000];
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<style nonce="${nonce}">
html,body{height:100%;margin:0}body{display:flex;flex-direction:column;padding:6px;box-sizing:border-box;color:var(--vscode-foreground)}
.r{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:5px}#i{flex:1;min-width:120px}input,select{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#8886);padding:3px 5px}
button{border:0;padding:4px 10px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
#o{flex:1;overflow:auto;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)}</style></head><body>
<div class="r"><button id="t">${esc(tr("Connect"))}</button><input id="i" placeholder="${esc(tr("Message (Enter to send)"))}" aria-label="Message"><select id="e" aria-label="${esc(tr("Line ending"))}"><option value="n">${esc(tr("New line"))}</option><option value="">${esc(tr("None"))}</option><option value="r">${esc(tr("Carriage return"))}</option><option value="rn">${esc(tr("Both"))}</option></select>
<select id="b" aria-label="${esc(tr("Speed"))}">${bauds.map(b => `<option value="${b}">${b} baud</option>`).join('')}</select><label><input type="checkbox" id="a" checked>${esc(tr("Autoscroll"))}</label><label><input type="checkbox" id="h">${esc(tr("Timestamps"))}</label><button id="c">${esc(tr("Clear"))}</button></div><pre id="o"></pre>
<script nonce="${nonce}">
const T=${json({on: tr("Connect"), off: tr("Disconnect")})},api=acquireVsCodeApi(),$=i=>document.getElementById(i),o=$('o');let bol=true;
$('t').onclick=()=>api.postMessage({type:'toggle'});$('c').onclick=()=>{o.textContent='';bol=true};$('b').onchange=()=>api.postMessage({type:'baud',baud:$('b').value});
const hist=[],eol={n:'\\n',r:'\\r',rn:'\\r\\n'};let hi=0;
$('i').onkeydown=e=>{const i=$('i');if(e.key==='Enter'){api.postMessage({type:'send',s:i.value+(eol[$('e').value]||'')});if(i.value)hist.push(i.value);hi=hist.length;i.value=''}
 else if(e.key==='ArrowUp'&&hi>0){i.value=hist[--hi];e.preventDefault()}else if(e.key==='ArrowDown'&&hi<hist.length){i.value=hist[++hi]||''}};
const stamp=s=>{const n=new Date(),t=n.toLocaleTimeString([],{hour12:false})+'.'+String(n.getMilliseconds()).padStart(3,'0')+' -> ';let r='';for(const ch of s){if(bol&&$('h').checked)r+=t;bol=ch==='\\n';r+=ch}return r};
window.addEventListener('message',({data:d})=>{
 if(d.type==='state'){$('t').textContent=((d.on?T.off:T.on)+' ')+(d.port||'');$('i').disabled=!d.on;const s=String(d.baud);if(![...$('b').options].some(x=>x.value===s)){const n=document.createElement('option');n.value=s;n.textContent=s+' baud';$('b').append(n)}$('b').value=s}
 if(d.type==='data'){o.append(stamp(d.s.replace(/\\r/g,'')));while(o.childNodes.length>4000)o.firstChild.remove();if($('a').checked)o.scrollTop=o.scrollHeight}
});
api.postMessage({type:'ready'});
</script></body></html>`;
}
