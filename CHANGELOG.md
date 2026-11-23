# Changelog

## 0.5.0

- **Build binaries** (Sketch section of the side bar, or Command palette): compiles the sketch to `.elf` and `.hex` files without uploading, then shows where they are. Handy for simulators such as Proteus.
- New setting `arducode.exportDir` to choose the folder that receives those files.

## 0.4.0

- English interface, with French translation following the VS Code language.
- The selected port is stored per computer instead of in the project.
- Arducode asks before editing a project's `.vscode/settings.json` (`arducode.configureProject` replaces `arducode.configureCppTools`).
- Extra colors for the Visual Studio themes are limited to Arduino projects.
- New shortcuts: `Alt+Shift+V`, `Alt+Shift+U`, `Alt+Shift+M`.
- Clear message when a Linux user lacks serial port permission; ARMv7 download of arduino-cli.

## 0.3.2

- Side bar with Sketch, Libraries and Boards sections; offline library catalog.

## 0.2.0

- Arduino reference on hover.

## 0.1.0

- First version.
