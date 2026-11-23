// node test/run.js <Code.exe> <dossier cpptools> <dossier temporaire>   (VERBOSE=1 pour les détails)
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const [code, cpptools, tmp] = process.argv.slice(2);
fs.rmSync(path.join(tmp, 'w'), { recursive: true, force: true });
const ws = path.join(tmp, 'w', 'demo');
const W = (p, s) => { fs.mkdirSync(path.dirname(path.join(ws, p)), { recursive: true }); fs.writeFileSync(path.join(ws, p), s); };
W('.vscode/settings.json', JSON.stringify({ 'arducode.board': process.env.BOARD || 'arduino:avr:mega', 'arducode.libraryPaths': ['./lib', './../commonLibs'], 'arducode.useGlobalLibraries': false, 'arducode.configureProject': true, 'workbench.colorTheme': 'Visual Studio Dark' }, null, 2));
W('demo.ino', `#include <LiquidCrystal.h>
#include <Commun.h>
#include <EEPROM.h>
#include <Wire.h>
#include <SPI.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>
#include <util/delay.h>
#include "util.h"
struct Point { int x; };
enum Etat { A, B };
const char txt[] PROGMEM = "abc";
volatile uint32_t n = 0;
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);
Commun commun;
ISR(TIMER1_COMPA_vect) { n++; }
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200); Serial1.println(F("ok"));
  lcd.begin(16, 2);
  apres(3);
  Point p{1}; parPoint(p);
  afficher(lcd);
  onglet();
  { int map = 3; String s(map); s.trim(); } // delay
  String s = String(analogRead(A0)) + "x"; Serial.println(s);
  Serial.println(min(1, 2)); EEPROM.update(0, 1);
  noInterrupts(); interrupts(); _delay_us(10); cli(); sei();
  attachInterrupt(digitalPinToInterrupt(2), apresVoid, RISING);
  set_sleep_mode(SLEEP_MODE_IDLE); sleep_enable(); sleep_cpu();
  Serial.println(pgm_read_byte(&txt[0])); Wire.begin(); SPI.begin();
  bitSet(PORTB, 1); tone(3, 440); commun.go(util(2));
}
void loop() { delay(10); Etat e = A; if (e == B) apres(0); }
void apres(int a) { (void)a; }
void apresVoid() {}
void parPoint(Point &p) { p.x++; }
void afficher(LiquidCrystal &l) { l.print("x"); }
`);
if (process.env.BOARD) { // carte non AVR : retire ce qui est propre à l'AVR
  const f = path.join(ws, 'demo.ino'), eol = String.fromCharCode(10);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split(eol).filter(l => !/avr.(interrupt|sleep)|util.delay|^ISR|sleep|_delay_us|PORTB/.test(l)).join(eol));
}
W('tab.ino', 'int onglet() { lcd.clear(); apres(1); return commun.go(1); }\n');
W('util.h', '#pragma once\nuint8_t util(byte b);\n');
W('util.cpp', '#include <Arduino.h>\n#include "util.h"\nuint8_t util(byte b) { digitalWrite(13, HIGH); return b; }\n');
W('../commonLibs/Commun/Commun.h', '#pragma once\n#include <Arduino.h>\nclass Commun { public: int go(int a); };\n');
W('../commonLibs/Commun/Commun.cpp', '#include "Commun.h"\nint Commun::go(int a) { return a; }\n');
const exts = path.join(tmp, 'exts'), dst = path.join(exts, path.basename(cpptools));
if (!fs.existsSync(dst)) { fs.cpSync(cpptools, dst, { recursive: true }); }
const res = path.join(tmp, 'result.json');
fs.rmSync(res, { force: true });
const env = { ...process.env, ARDUCODE_RESULT: res };
for (const k of Object.keys(env)) { if (/^(VSCODE_|ELECTRON_)/.test(k)) { delete env[k]; } }
const root = path.resolve(__dirname, '..');
const r = spawnSync(code, [ws, '--extensions-dir', exts, '--user-data-dir', path.join(tmp, 'ud'), '--extensionDevelopmentPath=' + root, '--extensionTestsPath=' + path.join(root, 'test', 'integration.js'),
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--disable-updates'], { env, encoding: 'utf8', timeout: 400000 });
if (process.env.VERBOSE) { console.log(r.stdout, r.stderr); }
const R = JSON.parse(fs.readFileSync(res, 'utf8'));
for (const s of R.steps) { console.log(s.ok ? 'OK  ' : 'FAIL', s.n, s.ok && !process.env.VERBOSE ? '' : JSON.stringify(s.d)); }
process.exit(R.steps.every(s => s.ok) ? 0 : 1);
