// Génère media/arduino-docs.json depuis la référence officielle (CC BY-SA 3.0).
// git clone https://github.com/arduino/reference-en <dossier> ; node tools/docs.js <dossier>
const fs = require('fs'), path = require('path');
const root = path.join(process.argv[2], 'Language');
const SITEMAP = 'https://docs.arduino.cc/language-reference/sitemap-0.xml';
const slug = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

(async () => {
  const xml = await (await fetch(SITEMAP)).text();
  const urls = [...new Set([...xml.matchAll(/https:\/\/docs\.arduino\.cc\/language-reference\/en\/[^<\s]+/g)].map(m => m[0].replace(/\/?$/, '/')))];
  const byPath = new Map(urls.map(u => [slug(u.split('/en/')[1]), u]));
  const byName = new Map();
  for (const u of urls) { const k = slug(u.split('/').filter(Boolean).pop()); byName.set(k, byName.has(k) ? null : u); }

  const files = fs.readdirSync(root, { recursive: true }).map(String).filter(f => f.endsWith('.adoc'));
  const urlOf = rel => {
    const p = rel.replace(/\.adoc$/, '').split(/[\\/]/), leaf = p[p.length - 1];
    return byPath.get(slug(p.join(''))) ?? byName.get(slug(leaf)) ?? (p.length > 2 ? byName.get(slug(p[p.length - 2] + leaf)) : undefined) ?? null;
  };
  const link = (href, text) => {
    text = text.replace(/\^$/, '');
    if (/^https?:/.test(href)) { return `[${text}](${href})`; }
    const u = byName.get(slug(href.split('/').filter(Boolean).pop() ?? ''));
    return u ? `[${text}](${u})` : text;
  };
  function md(s) {
    const out = []; let table = null, code = false;
    for (let l of s.split(/\r?\n/)) {
      if (/^-{4,}$/.test(l)) { out.push(code ? '```' : '```cpp'); code = !code; continue; }
      if (code) { out.push(l); continue; }
      if (/^\|=+$/.test(l)) { if (table) { table = null; out.push(''); } else { table = []; out.push(''); } continue; }
      l = l.replace(/link:([^[\s]+)\[([^\]]*)\]/g, (_, h, t) => link(h, t)).replace(/(?<!\()(https?:\/\/[^[\s)]+)\[([^\]]*)\]/g, (_, h, t) => link(h, t))
        .replace(/`_(\w+)_/g, '`$1').replace(/`\+([^`]*)\+`/g, '`$1`').replace(/<<[^,>]*,([^>]*)>>/g, '$1').replace(/`\[([^\]`]*)\]\(([^)\s]*)\)`/g, '[`$1`]($2)');
      if (/^\[[^\]]*\]$/.test(l) || l === '--' || /^(\/\/|:ext)/.test(l) || l === '+') { continue; }
      if (table) {
        const cells = l.replace(/^\|/, '').split('|').map(c => c.trim());
        if (l.startsWith('|')) { out.push('| ' + cells.join(' | ') + ' |'); if (!table.length) { out.push('|' + ' --- |'.repeat(cells.length)); } table.push(1); }
        continue;
      }
      out.push(l.replace(/ \+$/, '  ').replace(/^=+ (.*)/, '**$1**'));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function parse(rel) {
    const raw = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r/g, '');
    const title = /^title:\s*(.+)$/m.exec(raw)?.[1].replace(/^["']|["']$/g, '').trim() ?? '';
    const sec = {};
    for (const m of raw.matchAll(/^=== (.+)\n([\s\S]*?)(?=^=== |^\/\/ (?:OVERVIEW|HOW TO USE|SEE ALSO) SECTION|(?![\s\S]))/gm)) { sec[m[1].trim().toLowerCase()] = md(m[2]); }
    const over = /\/\/ OVERVIEW SECTION STARTS\n([\s\S]*?)(?=^=== |\/\/ OVERVIEW SECTION ENDS|(?![\s\S]))/m.exec(raw)?.[1] ?? '';
    const e = { title, url: urlOf(rel), sec, desc: sec.description || md(over.replace(/^== .*$/gm, '')), syntax: sec.syntax, params: sec.parameters, returns: sec.returns ?? sec.return, example: sec['example code'], notes: sec['notes and warnings'] };
    for (const k of Object.keys(e)) { if (!e[k]) { delete e[k]; } }
    return e;
  }
  const docs = {}, noUrl = [];
  const put = (k, e) => { if (e.desc && !docs[k]) { docs[k] = e; } };
  const alias = { highLow: ['HIGH', 'LOW'], inputOutputPullup: ['INPUT', 'OUTPUT', 'INPUT_PULLUP'], ledbuiltin: ['LED_BUILTIN'], trueFalse: ['true', 'false'], switchCase: ['switch', 'case'], doWhile: ['do'], PROGMEM: ['PROGMEM'] };
  for (const rel of files.sort()) {
    const p = rel.replace(/\.adoc$/, '').split(/[\\/]/), leaf = p[p.length - 1], dir = p[p.length - 2];
    if (/Operators$/.test(dir) || /Operators/.test(rel) || ['Conversion', 'Further Syntax'].includes(dir) || /^(ifSerial|floatingPointConstants|integerConstants|scope|array|string|unsigned\w+)$/.test(leaf)) { continue; }
    const e = parse(rel);
    if (!e.url) { noUrl.push(rel); }
    const cls = dir === 'Functions' && p[p.length - 3] === 'String' ? 'String' : ['Serial', 'SPI', 'Wire', 'Stream', 'Keyboard', 'Mouse'].includes(dir) ? dir : '';
    let name = leaf;
    if (cls && slug(name).startsWith(slug(cls)) && ['Stream', 'Keyboard', 'Mouse'].includes(cls)) { name = name.slice(cls.length); name = name[0].toLowerCase() + name.slice(1); }
    const { sec, ...entry } = e;
    for (const n of alias[leaf] ?? [name]) {
      const key = n === 'stringObject' ? 'String' : n === 'stream' ? 'Stream' : n;
      put(cls && key !== 'SPISettings' && key !== 'serialEvent' ? `${cls}.${key}` : key, dir === 'Constants' && sec[n.toLowerCase()] ? { ...entry, title: n, desc: sec[n.toLowerCase()] } : entry);
    }
  }
  fs.writeFileSync(path.join(__dirname, '..', 'media', 'arduino-docs.json'), JSON.stringify(docs));
  console.log(Object.keys(docs).length, 'entrées ;', 'sans URL :', noUrl.join(', ') || 'aucune', '; URL du site :', urls.length);
  console.log(Object.keys(docs).join(' '));
})();
