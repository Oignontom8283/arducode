// Lancé dans VS Code par test/run.js ; écrit son résultat dans ARDUCODE_RESULT.
const vscode = require('vscode'), fs = require('fs'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
  const R = { steps: [] }, log = (n, ok, d) => { R.steps.push({ n, ok, d }); fs.writeFileSync(process.env.ARDUCODE_RESULT, JSON.stringify(R, null, 1)); };
  const diags = uri => vscode.languages.getDiagnostics(uri).map(x => `${x.source}:${x.range.start.line + 1}: ${x.message}`);
  try {
    const ws = vscode.workspace.workspaceFolders[0].uri.fsPath, f = path.join(ws, path.basename(ws) + '.ino');
    const ext = vscode.extensions.getExtension('oignontom8283.arducode');
    const api = await ext.activate();
    const doc = await vscode.workspace.openTextDocument(f);
    await vscode.window.showTextDocument(doc);
    log('langage cpp', doc.languageId === 'cpp', doc.languageId);
    log('lib absente : échec + diagnostic', await vscode.commands.executeCommand('arducode.verify') === false && diags(doc.uri).some(d => d.startsWith('arduino')), diags(doc.uri));
    const done = await api.installLibrary('LiquidCrystal', '1.0.7', path.join(ws, 'lib'));
    log('install LiquidCrystal', fs.existsSync(path.join(ws, 'lib/LiquidCrystal/src/LiquidCrystal.h')), done);
    log('vérifier', await vscode.commands.executeCommand('arducode.verify') === true, diags(doc.uri));
    log('settings', true, fs.readFileSync(path.join(ws, '.vscode/settings.json'), 'utf8'));
    const set = JSON.parse(fs.readFileSync(path.join(ws, '.vscode/settings.json'), 'utf8'));
    log('boutons C++ masqués', set['C_Cpp.debugShortcut'] === false && vscode.workspace.getConfiguration('C_Cpp', doc.uri).get('debugShortcut') === false, set);
    log('couleurs limitées au projet', !!set['editor.semanticTokenColorCustomizations']?.['[Visual Studio Dark]'] && !!set['editor.tokenColorCustomizations']?.['[Visual Studio Dark]'] && !vscode.workspace.getConfiguration('editor').inspect('semanticTokenColorCustomizations').defaultValue?.['[Visual Studio Dark]'], set);
    log('port absent du projet', !('arducode.port' in set));
    await vscode.commands.executeCommand('arducode.libs.focus');
    log('config', true, await api.inspect(f));
    const line = s => doc.getText().split(/\r?\n/).findIndex(l => l.includes(s));
    let labels = [];
    for (let i = 0; i < 40; i++) {
      const c = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(line('lcd.begin'), 6));
      labels = c.items.map(x => typeof x.label === 'string' ? x.label : x.label.label);
      if (labels.some(l => /^setCursor/.test(l))) { break; }
      await sleep(1500);
    }
    log('complétion lcd.', labels.some(l => /^setCursor/.test(l)), labels.slice(0, 12));
    const hover = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(line('pinMode'), 4));
    log('survol pinMode', hover.length > 0, hover.flatMap(h => h.contents.map(c => c.value)));
    const hov = async (l, w) => {
      const n = line(l), s = doc.lineAt(n).text;
      const h = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(n, s.indexOf(w, s.indexOf(l)) + 1));
      return h.flatMap(x => x.contents.map(c => c.value)).join('\n');
    };
    for (const [l, w, want, not] of [['pinMode', 'pinMode', 'digital-io/pinMode/'], ['Serial.begin', 'begin', 'serial/begin/'], ['Serial1.println', 'println', 'serial/println/'],
      ['lcd.begin', 'begin', 'Library', 'serial/begin/'], ['LED_BUILTIN', 'OUTPUT', 'Arduino · OUTPUT'], ['Wire.begin', 'begin', 'ire/begin/'], ['SPI.begin', 'begin', 'SPI/begin/'],
      ['delay(10)', 'delay', 'time/delay/'], ['s.trim', 'trim', '/trim/'], ['tone(3', 'tone', '/tone/'], ['min(1', 'min', 'math/min/'],
      ['EEPROM.update', 'update', '', 'Arduino ·'], ['// delay', 'delay', '', 'Arduino ·'], ['int map', 'map', '', 'Arduino ·']]) {
      if (line(l) < 0) { continue; }
      const h = await hov(l, w);
      log('doc ' + l + ' > ' + w, h.toLowerCase().includes(want.toLowerCase()) && !(not && h.includes(not)), h.slice(0, 500));
    }
    let kinds = {};
    for (let i = 0; i < 20; i++) {
      const lg = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', doc.uri);
      const st = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', doc.uri);
      kinds = {};
      for (let k = 0, l = 0, c = 0; st && k < st.data.length; k += 5) {
        if (st.data[k]) { l += st.data[k]; c = 0; }
        c += st.data[k + 1];
        kinds[doc.lineAt(l).text.substr(c, st.data[k + 2])] = lg.tokenTypes[st.data[k + 3]];
      }
      if (kinds.pinMode) { break; }
      await sleep(1500);
    }
    log('coloration sémantique', kinds.pinMode === 'function' && kinds.LiquidCrystal === 'type' && ['macro', 'enumMember'].includes(kinds.OUTPUT) && kinds.begin === 'method', kinds);
    for (const p of [f, path.join(ws, 'tab.ino'), path.join(ws, 'util.h'), path.join(ws, 'util.cpp'), path.join(ws, 'lib/LiquidCrystal/src/LiquidCrystal.cpp')]) {
      const d = await vscode.workspace.openTextDocument(p);
      await vscode.window.showTextDocument(d);
      await sleep(12000);
      log('zéro erreur IntelliSense ' + path.basename(p), !vscode.languages.getDiagnostics(d.uri).some(x => x.severity <= 1), diags(d.uri));
    }
    // Contrôle : une vraie erreur doit être signalée, sinon « zéro erreur » ne prouve rien.
    for (const p of [f, path.join(ws, 'tab.ino')]) {
      const d = await vscode.workspace.openTextDocument(p);
      await vscode.window.showTextDocument(d);
      const e = new vscode.WorkspaceEdit();
      e.insert(d.uri, new vscode.Position(d.lineCount, 0), '\nvoid zz_' + path.parse(p).name + '(){ inexistant(); }\n');
      await vscode.workspace.applyEdit(e);
      await sleep(10000);
      log('erreur réelle détectée ' + path.basename(p), diags(d.uri).some(x => /inexistant/.test(x)), diags(d.uri));
    }
    log('compilation en échec', await vscode.commands.executeCommand('arducode.verify') === false && diags(doc.uri).some(x => /^arduino.*inexistant/.test(x)), diags(doc.uri));
    await vscode.commands.executeCommand('arducode.manageLibraries', 'liquid');
    await sleep(3000);
    await vscode.commands.executeCommand('arducode.manageCores', 'uno');
    await sleep(3000);
    log('panneaux ouverts sans exception', true);
  } catch (e) { log('exception', false, String(e.stack)); }
};
