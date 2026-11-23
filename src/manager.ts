import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as cli from './cli';
import * as config from './config';
import * as libraries from './libraries';
import * as sketches from './sketch';
import { tr, esc, json } from './l10n';


interface Item { id: string; name: string; author: string; text: string; versions: string[]; installed?: string; dir?: string; url?: string; where?: string; extra?: string }

const cmp = (a: string, b: string) => b.localeCompare(a, undefined, { numeric: true });

/** Dernier catalogue téléchargé, lu sans mise à jour (hors ligne, horloge décalée…). */
async function localIndex(cause: Error): Promise<any> {
  try {
    const data = await cli.runJson(['config', 'get', 'directories.data']);
    const j = JSON.parse(await fs.promises.readFile(path.join(typeof data === 'string' ? data : data.config, 'library_index.json'), 'utf8'));
    const map = new Map<string, any>();
    for (const l of j.libraries) {
      const e = map.get(l.name) ?? { name: l.name, available_versions: [] };
      e.available_versions.push(l.version);
      if (!e.latest || cmp(e.latest.version, l.version) > 0) { e.latest = l; }
      map.set(l.name, e);
    }
    return { libraries: [...map.values()] };
  } catch { throw cause; }
}

/** Panneau latéral « façon Arduino IDE », commun aux bibliothèques et aux cartes. */
export class Manager implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private index?: Promise<Item[]>;
  private query = '';
  private seq = 0;
  constructor(private kind: 'lib' | 'core') {}

  resolveWebviewView(v: vscode.WebviewView) {
    this.view = v;
    v.webview.options = { enableScripts: true, localResourceRoots: [] };
    v.onDidDispose(() => this.view = undefined);
    v.webview.onDidReceiveMessage(m => this.onMessage(m));
    v.webview.html = this.kind === 'lib' ? html(tr("Search libraries…")) : html(tr("Search boards…"));
  }

  async search(q: string) {
    this.query = q;
    await vscode.commands.executeCommand(`arducode.${this.kind === 'lib' ? 'libs' : 'cores'}.focus`);
    void this.view?.webview.postMessage({ type: 'query', q });
    await this.refresh();
  }

  reload() { this.index = undefined; return this.refresh(); }

  private load(): Promise<Item[]> {
    const p = this.index ??= this.fetchIndex();
    p.catch(() => { if (this.index === p) { this.index = undefined; } });
    return p;
  }

  private async fetchIndex(): Promise<Item[]> {
    if (this.kind === 'lib') {
      const j = await cli.runJson(['lib', 'search', '--omit-releases-details']).catch(e => { this.warn(e.message); return localIndex(e); });
      return (j.libraries ?? []).map((l: any) => ({ id: l.name, name: l.name, author: l.latest?.author ?? '', text: l.latest?.sentence ?? '', versions: [...(l.available_versions ?? [])].sort(cmp), url: l.latest?.website }));
    }
    const sketch = await sketches.current();
    if ((config.get<string[]>('additionalBoardUrls', sketch) ?? []).length) { await cli.run(['core', 'update-index'], { sketch }); }
    const j = await cli.runJson(['core', 'search'], { sketch });
    return (j.platforms ?? []).map((p: any) => {
      const rel = p.releases?.[p.latest_version] ?? p.releases?.[p.installed_version] ?? {};
      return {
        id: p.id, name: (rel.name || p.id) + (p.deprecated ? tr(" (deprecated)") : ''), author: p.maintainer ?? '', text: p.id, versions: Object.keys(p.releases ?? {}).sort(cmp),
        installed: p.installed_version || undefined, url: p.website, extra: (rel.boards ?? []).map((b: any) => b.name).join(', '),
      };
    });
  }

  private warn(message: string) {
    cli.output.appendLine('Catalog: ' + message);
    const clock = /signature expired|system clock/i.test(message);
    vscode.window.showWarningMessage(clock
      ? tr("The Arduino catalog was not updated: the computer clock seems wrong. Set the time, then refresh. The last known catalog is shown.")
      : tr("The Arduino catalog was not updated, the last known one is shown. ") + message);
  }

  private async items(): Promise<{ items: Item[]; total: number }> {
    let all = await this.load();
    if (this.kind === 'lib') {
      const inst = await libraries.installed();
      const known = new Map(all.map(i => [i.name, i]));
      // Une carte par exemplaire installé (la même bibliothèque peut exister dans deux dossiers).
      const mine: Item[] = inst.map(l => ({ ...(known.get(l.name) ?? { id: l.name, name: l.name, author: l.author, text: l.sentence, versions: [] }), installed: l.version || '?', dir: l.dir, where: vscode.workspace.asRelativePath(l.dir) }));
      const have = new Set(inst.map(l => l.name));
      all = [...mine, ...all.filter(i => !have.has(i.name))];
    }
    const terms = this.query.toLowerCase().split(/\s+/).filter(Boolean), q = terms.join(' ');
    const score = (i: Item) => {
      const name = i.name.toLowerCase(), hay = `${name} ${i.author} ${i.text} ${i.extra ?? ''}`.toLowerCase();
      if (!terms.every(t => hay.includes(t))) { return -1; }
      return name === q ? 4 : name.startsWith(q) ? 3 : terms.every(t => name.includes(t)) ? 2 : 1;
    };
    const hits = all.map(i => ({ i, s: score(i) })).filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s || Number(!!b.i.installed) - Number(!!a.i.installed));
    return { items: hits.slice(0, 60).map(x => x.i), total: hits.length };
  }

  private async refresh() {
    const v = this.view, n = ++this.seq;
    if (!v) { return; }
    const msg = await this.items().then(r => ({ type: 'items', ...r }), e => ({ type: 'error', text: e.message }));
    if (n === this.seq) { void v.webview.postMessage(msg); }
  }

  private async onMessage(m: any) {
    if (m.type === 'ready') { if (this.query) { void this.view?.webview.postMessage({ type: 'query', q: this.query }); } return this.refresh(); }
    if (m.type === 'query') { this.query = String(m.q); return this.refresh(); }
    if (m.type === 'open') { if (/^https?:\/\//.test(m.url)) { await vscode.env.openExternal(vscode.Uri.parse(m.url)); } return; }
    try {
      const id = String(m.id), version = String(m.version ?? '');
      const sketch = await sketches.current();
      if (this.kind === 'lib') {
        const root = m.dir ? (await libraries.installed()).find(l => l.dir === m.dir)?.root : undefined;
        if (m.type === 'install') { await libraries.install(id, version, root); }
        if (m.type === 'remove') { await libraries.remove(String(m.dir)); }
      } else {
        if (m.type === 'install') { await cli.runLogged(['core', 'install', '--', version ? `${id}@${version}` : id], tr("Installing {0}… (may take a while)", id), { sketch }); }
        if (m.type === 'remove') {
          if (!await vscode.window.showWarningMessage(tr("Uninstall {0}?", id), { modal: true }, tr("Uninstall"))) { return; }
          await cli.runLogged(['core', 'uninstall', '--', id], tr("Uninstalling {0}…", id), { sketch });
        }
        this.index = undefined;
        await vscode.commands.executeCommand('arducode.refreshIntelliSense');
      }
    } catch (e: any) { if (!(e instanceof vscode.CancellationError)) { vscode.window.showErrorMessage(e.message, tr("Details")).then(x => x && cli.output.show()); } }
    await this.refresh();
  }
}

function html(placeholder: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<style nonce="${nonce}">
body{padding:0 10px 10px;color:var(--vscode-foreground);font:var(--vscode-font-size) var(--vscode-font-family)}
#q{width:100%;box-sizing:border-box;padding:5px 7px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);position:sticky;top:0}
.c{padding:9px 0;border-bottom:1px solid var(--vscode-widget-border,#8884)}.n{font-weight:600;overflow-wrap:anywhere}.m{opacity:.75;font-size:.92em;margin:2px 0;overflow-wrap:anywhere}
.x{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.b{display:inline-block;font-size:.85em;padding:0 5px;margin-left:5px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.r{display:flex;gap:5px;margin-top:6px;flex-wrap:wrap;align-items:center}button{border:0;padding:3px 9px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button.s{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}button:disabled{opacity:.5}select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border)}
a{color:var(--vscode-textLink-foreground);cursor:pointer}</style></head><body><input id="q" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"><div id="l"><p class="m">${esc(tr("Loading…"))}</p></div>
<script nonce="${nonce}">
const T=${json({inst: tr("installed"), by: tr("by"), ver: tr("Version"), install: tr("Install"), re: tr("Reinstall"), upd: tr("Update"), chg: tr("Change version"), rm: tr("Remove"), info: tr("More info"), more: tr("more results, refine your search."), none: tr("No results.")})};const api=acquireVsCodeApi(),q=document.getElementById('q'),l=document.getElementById('l');let t;
const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e};
q.oninput=()=>{clearTimeout(t);t=setTimeout(()=>api.postMessage({type:'query',q:q.value}),150)};
window.addEventListener('message',({data:d})=>{
 if(d.type==='query'){q.value=d.q;return}
 if(d.type==='error'){l.replaceChildren(el('p','m',d.text));return}
 if(d.type!=='items')return;
 l.replaceChildren(...d.items.map(i=>{
  const c=el('div','c'),n=el('div','n',i.name);if(i.installed)n.append(el('span','b',i.installed+' '+T.inst));c.append(n);
  if(i.author)c.append(el('div','m',T.by+' '+i.author.replace(/<[^>]*>/g,'').trim()));
  if(i.text)c.append(el('div','m x',i.text));if(i.extra)c.append(el('div','m x',i.extra));if(i.where)c.append(el('div','m',i.where));
  const r=el('div','r');
  if(i.versions.length){const s=el('select'),b=el('button');s.setAttribute('aria-label',T.ver);for(const v of i.versions)s.append(el('option','',v));
   const upd=()=>{b.textContent=!i.installed?T.install:s.value===i.installed?T.re:s.value===i.versions[0]?T.upd:T.chg;b.className=i.installed&&s.value===i.installed?'s':''};
   s.onchange=upd;upd();b.onclick=()=>{b.disabled=true;b.textContent='…';api.postMessage({type:'install',id:i.id,version:s.value,dir:i.dir})};r.append(s,b)}
  if(i.installed){const b=el('button','s',T.rm);b.onclick=()=>api.postMessage({type:'remove',id:i.id,dir:i.dir});r.append(b)}
  if(i.url){const a=el('a','',T.info);a.onclick=()=>api.postMessage({type:'open',url:i.url});r.append(a)}
  c.append(r);return c}));
 if(d.total>d.items.length)l.append(el('p','m','… '+(d.total-d.items.length)+' '+T.more));
 if(!d.total)l.append(el('p','m',T.none));
});
api.postMessage({type:'ready'});
</script></body></html>`;
}
