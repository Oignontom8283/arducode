// Vérifie que chaque texte a sa traduction : node test/l10n.js
const fs = require('fs'), R = f => JSON.parse(fs.readFileSync(f, 'utf8')), bad = [];
const en = R('package.nls.json'), pkg = fs.readFileSync('package.json', 'utf8');
for (const m of pkg.matchAll(/"%([\w.]+)%"/g)) { if (!en[m[1]]) { bad.push('nls ' + m[1]); } }
const used = new Set();
for (const f of fs.readdirSync('src')) { for (const m of fs.readFileSync('src/' + f, 'utf8').matchAll(/\btr\(("(?:[^"\\]|\\.)*")/g)) { used.add(JSON.parse(m[1])); } }
const slots = s => (s.match(/\{\d\}/g) || []).sort().join();
for (const f of fs.readdirSync('l10n')) {
  const b = R('l10n/' + f), lang = f.split('.')[2], nls = R(`package.nls.${lang}.json`);
  for (const k of used) { if (!b[k]) { bad.push(`${lang} ${k}`); } else if (slots(k) !== slots(b[k])) { bad.push(`${lang} {n} ${k}`); } }
  for (const k of Object.keys(en)) { if (!nls[k]) { bad.push(`${lang} nls ${k}`); } }
}
console.log(used.size + ' textes,', Object.keys(en).length, 'clés package', bad.length ? bad : ': complet');
process.exit(bad.length ? 1 : 0);
