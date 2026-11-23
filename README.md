# Arducode

Arduino development in VS Code: verify, upload, boards, libraries, serial monitor, and real C++ IntelliSense.

> Unofficial extension, not affiliated with or endorsed by Arduino.

Arducode drives [`arduino-cli`](https://arduino.github.io/arduino-cli/) from VS Code. Your sketches stay ordinary files in an ordinary folder, and libraries live in your project instead of a hidden global folder, so a project builds the same way on every computer.

## Features

- **Verify and Upload** with one click or one shortcut. Compiler errors and warnings appear in the Problems view, on the right line.
- **Boards and ports**: pick a board (and its options), pick a serial port. A connected board is detected and can be selected for you.
- **Libraries in your project**: search the Arduino catalog, install a specific version, or add a library from a `.zip` file or a Git URL. Examples can be copied into your workspace.
- **Board support**: install and remove cores (AVR, ESP32, SAMD, RP2040…) from the side bar, with extra board manager URLs if you need them.
- **Serial monitor** in the bottom panel: baud rate, line ending, timestamps, autoscroll. It closes while uploading and reopens afterwards.
- **Real IntelliSense**: completion, go to definition and error squiggles that use the exact compiler settings, libraries and macros of your build, across all the tabs of a multi-file sketch.
- **Arduino reference on hover**: hover a function, constant or class to read its documentation, or press `Ctrl+Shift+F1` to open it in the browser. Hovering a library you installed shows its description.
- **Build binaries without uploading**: get the `.elf` and `.hex` files (for simulators such as Proteus, or other tools) in the folder of your choice.
- Create a new sketch, choose an external programmer, verify after upload.
- Available in English and French (follows the VS Code display language).

## Requirements

- VS Code 1.90 or later. The Microsoft C/C++ extension is installed with Arducode.
- [`arduino-cli`](https://arduino.github.io/arduino-cli/). Arducode looks for it in your `PATH` and in the Arduino IDE, and offers to download it if it is missing. You can also set `arducode.cliPath`.
- A trusted workspace (Arducode runs compilers).

| System | Status |
| --- | --- |
| Windows x64, AVR boards | tested |
| Linux, macOS, other boards (ESP32, SAMD, RP2040…) | supported by design, not tested yet |

## Getting started

1. Open the **folder** of a sketch, or a folder that contains some. The main file is named after its folder: `Blink/Blink.ino`. No sketch yet? Run **Arducode: New sketch**.
2. Open the Arducode side bar and choose your **board** and **port**.
3. Click **Verify**, then **Upload**.

The first time, Arducode asks before writing to the project's `.vscode/settings.json` (it connects the C/C++ extension to your board and hides its PC run/debug buttons).

| Action | Where |
| --- | --- |
| Verify, Upload, Port, Board, Monitor | Arducode side bar, top of the editor, status bar |
| Verify / Upload / Monitor | `Alt+Shift+V` / `Alt+Shift+U` / `Alt+Shift+M` |
| Libraries and boards | Arducode side bar |
| Build `.elf` / `.hex` without uploading | Arducode side bar → *Build binaries* (folder: `arducode.exportDir`) |
| Board options, examples, new sketch | Command palette → "Arducode" |
| Arduino reference | hover a word, or `Ctrl+Shift+F1` |

## Settings

Everything is optional. Put what you need in `.vscode/settings.json`:

```jsonc
{
  "arducode.board": "arduino:avr:uno",
  // Relative to the opened folder. With several, you are asked where to install.
  "arducode.libraryPaths": ["./lib", "./../commonLibs"],
  // false = only the project's libraries (and those bundled with the board)
  "arducode.useGlobalLibraries": true,
  "arducode.baudRate": 9600,
  "arducode.buildProperties": ["build.extra_flags=-DDEBUG=1"],
  "arducode.additionalBoardUrls": [],
  "arducode.docs": "full",
  "arducode.editorButtons": true
}
```

The selected port is remembered on your computer, not in the project. `arducode.port` can set a default. All settings are listed under **Arducode** in the Settings editor.

Each library folder contains one subfolder per library:

```
MyProject/
├── .vscode/settings.json
├── MyProject.ino
└── lib/
    └── LiquidCrystal/
        ├── library.properties
        └── src/
```

## Credits and license

Arducode is released under the [MIT license](LICENSE).

Hover texts: [Arduino reference](https://github.com/arduino/reference-en) © Arduino and contributors, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), converted to Markdown by `tools/docs.js`. `media/arduino-docs.json` remains under that license.

## Building from source

```
npm install
npm run check
npm test
npm run package
```

Translations live in `package.nls.<lang>.json` and `l10n/bundle.l10n.<lang>.json`.
