import * as vscode from 'vscode';

// Les vieux thèmes « Visual Studio » ne colorent ni fonctions, ni types, ni variables.
const PALETTES: Record<string, { fn: string; type: string; ctl: string; v: string; k: string; esc: string }> = {
  'Visual Studio Dark': { fn: '#DCDCAA', type: '#4EC9B0', ctl: '#C586C0', v: '#9CDCFE', k: '#4FC1FF', esc: '#D7BA7D' },
  'Visual Studio Light': { fn: '#795E26', type: '#267F99', ctl: '#AF00DB', v: '#001080', k: '#0070C1', esc: '#EE0000' },
};

/** Complète ces thèmes pour le C++ de ce projet seulement ; ne remplace jamais un réglage existant. */
export async function applyThemeColors(): Promise<void> {
  const editor = vscode.workspace.getConfiguration('editor');
  const theme = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme') ?? '', c = PALETTES[theme];
  if (!c || vscode.workspace.workspaceFolders?.length !== 1) { return; }
  const add = async (key: string, value: unknown) => {
    const cur = editor.inspect<Record<string, unknown>>(key);
    if (cur?.globalValue?.[`[${theme}]`] || cur?.workspaceValue?.[`[${theme}]`]) { return; }
    await editor.update(key, { ...cur?.workspaceValue, [`[${theme}]`]: value }, vscode.ConfigurationTarget.Workspace);
  };
  const sem = (types: string, color: string) => types.split(' ').map(t => [t + ':cpp', color]);
  await add('semanticTokenColorCustomizations', { rules: Object.fromEntries([
    ...sem('function method templateFunction customLiteral', c.fn), ...sem('class struct enum type templateType referenceType valueType namespace', c.type),
    ...sem('variable parameter property', c.v), ...sem('enumMember macro', c.k), ...sem('newOperator', c.ctl)]) });
  const tm = (scopes: string, foreground: string) => ({ scope: scopes.split(' ').map(s => 'source.cpp ' + s), settings: { foreground } });
  await add('tokenColorCustomizations', { textMateRules: [
    tm('entity.name.function support.function', c.fn), tm('entity.name.type entity.name.class entity.name.namespace entity.name.scope-resolution support.type support.class', c.type),
    tm('keyword.control keyword.operator.new keyword.operator.delete', c.ctl), tm('variable entity.name.variable', c.v),
    tm('variable.other.constant variable.other.enummember entity.name.function.preprocessor', c.k), tm('constant.character.escape', c.esc)] });
}
