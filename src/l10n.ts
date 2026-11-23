import * as vscode from 'vscode';

/** Texte anglais, traduit par l10n/bundle.l10n.<langue>.json. */
export const tr = (message: string, ...args: (string | number | boolean)[]) => vscode.l10n.t(message, ...args);
export const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** JSON insérable dans un <script>. */
export const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
