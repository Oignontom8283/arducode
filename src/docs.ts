import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as config from './config';
import * as sketches from './sketch';
import * as libraries from './libraries';
import { tr } from './l10n';

interface Doc { title: string; url?: string; desc: string; syntax?: string; params?: string; returns?: string; example?: string; notes?: string }

const CLASSES: Record<string, string> = {
  String: 'String', TwoWire: 'Wire', SPIClass: 'SPI', SPIClassMegaAVR: 'SPI', Keyboard_: 'Keyboard', Mouse_: 'Mouse',
  HardwareSerial: 'Serial', Serial_: 'Serial', USBCDC: 'Serial', HWCDC: 'Serial', UARTClass: 'Serial', Uart: 'Serial', UART: 'Serial', Stream: 'Stream',
};
const GLOBALS: [RegExp, string][] = [[/^Serial(\d|USB)?$/, 'Serial'], [/^Wire\d?$/, 'Wire'], [/^SPI\d?$/, 'SPI'], [/^Keyboard$/, 'Keyboard'], [/^Mouse$/, 'Mouse']];

let docs: Record<string, Doc> = {};
const nested = new Set<string>();

/** Vrai si la position est dans un commentaire // ou une chaîne sur la ligne. */
function inText(before: string): boolean {
  const s = before.replace(/\\./g, '').replace(/"[^"]*"|'[^']*'/g, '');
  return s.includes('//') || /["']/.test(s);
}

/** Ce que l'extension C++ sait du symbole : sert à distinguer Serial.begin de lcd.begin. */
async function cppInfo(doc: vscode.TextDocument, pos: vscode.Position): Promise<string> {
  const key = `${doc.uri}:${pos.line}:${pos.character}`;
  if (nested.has(key)) { return ''; }
  nested.add(key);
  try {
    const h = await Promise.race([
      vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, pos),
      new Promise<vscode.Hover[]>(r => setTimeout(() => r([]), 1500)),
    ]);
    return (h ?? []).flatMap(x => x.contents).map(c => typeof c === 'string' ? c : c.value).join('\n');
  } catch { return ''; } finally { nested.delete(key); }
}

async function lookup(doc: vscode.TextDocument, pos: vscode.Position): Promise<{ doc?: Doc; library?: libraries.Installed; range: vscode.Range } | undefined> {
  const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
  if (!range) { return; }
  const word = doc.getText(range), before = doc.lineAt(pos).text.slice(0, range.start.character);
  if (inText(before)) { return; }
  const member = /(?:(\w+)\s*(?:\[[^\]]*\])?\s*)?(?:\.|->|::)\s*$/.exec(before);
  if (!member && GLOBALS.some(([r]) => r.test(word))) { return { doc: docs[GLOBALS.find(([r]) => r.test(word))![1]], range }; }
  const interesting = member || docs[word] || /^[A-Z]/.test(word);
  if (!interesting) { return; }
  const info = await cppInfo(doc, pos);
  const owner = new RegExp(`(\\w+)(?:<[^>]*>)?::${word}\\b`).exec(info)?.[1];
  if (member) {
    const global = GLOBALS.find(([r]) => r.test(member[1] ?? ''))?.[1];
    const cls = global ?? (owner ? CLASSES[owner] : undefined);
    const d = cls && (docs[`${cls}.${word}`] ?? (cls === 'Serial' ? docs[`Stream.${word}`] : undefined));
    if (d) { return { doc: d, range }; }
  } else if (docs[word]) {
    // Une variable, un paramètre ou un membre de l'utilisateur peut porter le nom d'une fonction Arduino.
    const isFunction = /\)$/.test(docs[word].title);
    if (!isFunction || (!owner || owner === 'std' || owner === 'arduino') && (!info || new RegExp(`\\b${word}(?:<[^>]*>)?\\(|#define ${word}\\b`).test(info))) { return { doc: docs[word], range }; }
    return;
  }
  const cls = owner ?? (member ? undefined : word);
  const library = cls ? (await libraries.installed()).find(l => l.name.replace(/\W/g, '') === cls) : undefined;
  return library && (library.url || library.sentence) ? { library, range } : undefined;
}

const firstParagraph = (s: string) => s.split(/\n\s*\n/)[0];

function render(d: Doc): vscode.MarkdownString {
  const full = config.get<string>('docs') === 'full';
  const p = [`**Arduino · ${d.title}**` + (d.url ? ` — [${tr("Arduino documentation")}](${d.url})` : ''), full ? d.desc : firstParagraph(d.desc)];
  if (d.syntax) { p.push(tr("**Syntax**"), d.syntax); }
  if (d.params && !/^none\.?$/i.test(d.params)) { p.push(tr("**Parameters**"), d.params); }
  if (d.returns) { p.push(tr("**Returns**"), d.returns); }
  if (full && d.notes) { p.push(tr("**Notes**"), d.notes); }
  if (full && d.example) { p.push(tr("**Example**"), d.example); }
  return new vscode.MarkdownString(p.join('\n\n'), true);
}

export function register(ctx: vscode.ExtensionContext) {
  docs = JSON.parse(fs.readFileSync(path.join(ctx.extensionPath, 'media', 'arduino-docs.json'), 'utf8'));
  // Object.prototype : un mot comme « constructor » ne doit rien trouver.
  docs = Object.assign(Object.create(null), docs);
  const isArduino = async (doc: vscode.TextDocument) => !!sketches.sketchOfFile(doc.uri.fsPath) || config.libraryPaths(await sketches.current()).some(l => config.isInside(doc.uri.fsPath, l));
  ctx.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: 'cpp', scheme: 'file' }, {
      async provideHover(doc, pos) {
        const r = doc.getWordRangeAtPosition(pos);
        if (config.get<string>('docs') === 'off' || (r && nested.has(`${doc.uri}:${pos.line}:${pos.character}`)) || !await isArduino(doc)) { return; }
        const f = await lookup(doc, pos);
        if (f?.doc) { return new vscode.Hover(render(f.doc), f.range); }
        if (f?.library) {
          const l = f.library, url = /^https?:\/\//.test(l.url) ? `\n\n[$(link-external) ${tr("Library documentation")}](${l.url})` : '';
          const md = new vscode.MarkdownString('', true);
          md.appendMarkdown(`**${tr("Library")} `).appendText(l.name).appendMarkdown('**\n\n').appendText(l.sentence).appendMarkdown(url);
          return new vscode.Hover(md, f.range);
        }
        return;
      },
    }),
    vscode.commands.registerCommand('arducode.openReference', async () => {
      const e = vscode.window.activeTextEditor;
      const f = e && await lookup(e.document, e.selection.active);
      const url = f?.doc?.url ?? f?.library?.url ?? 'https://docs.arduino.cc/language-reference/';
      if (/^https?:\/\//.test(url)) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
    }));
}
