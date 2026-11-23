# Arducode

*English: see README.md*

Le développement Arduino dans VS Code : vérifier, téléverser, cartes, bibliothèques, moniteur série et véritable IntelliSense C++.

> Extension non officielle, sans lien avec Arduino.

## Installation

Installez le `.vsix` (vue Extensions → `…` → *Installer à partir d'un VSIX…*). L'extension C/C++ de Microsoft s'installe avec.
`arduino-cli` est détecté (PATH ou Arduino IDE), sinon Arducode propose de le télécharger.

| Système | État |
| --- | --- |
| Windows x64, cartes AVR | testé |
| Linux, macOS, autres cartes (ESP32, SAMD, RP2040…) | prévu, pas encore testé |

Sous Linux, l'accès au port série demande le groupe `dialout` (`uucp` sous Arch).

## Utilisation

Ouvrez le **dossier** d'un croquis, ou un dossier qui en contient. Le fichier principal porte le nom de son dossier : `Blink/Blink.ino`.

| Action | Où |
| --- | --- |
| Vérifier, Téléverser, Port, Carte, Moniteur | barre latérale Arducode, haut de l'éditeur, barre d'état |
| Vérifier / Téléverser / Moniteur | `Alt+Maj+V` / `Alt+Maj+U` / `Alt+Maj+M` |
| Bibliothèques et cartes | barre latérale Arducode |
| Options de carte, exemples, export `.hex`, nouveau croquis | palette de commandes → « Arducode » |
| Référence Arduino | survol d'un mot, ou `Ctrl+Maj+F1` |

La première fois, Arducode demande votre accord avant d'écrire dans le `.vscode/settings.json` du projet.

## Réglages (`.vscode/settings.json`)

```jsonc
{
  "arducode.board": "arduino:avr:uno",
  // Relatif au dossier ouvert. S'il y en a plusieurs, la destination est demandée.
  "arducode.libraryPaths": ["./lib", "./../commonLibs"],
  // false = uniquement les bibliothèques du projet (et celles fournies avec la carte)
  "arducode.useGlobalLibraries": true,
  "arducode.baudRate": 9600,
  "arducode.buildProperties": ["build.extra_flags=-DDEBUG=1"],
  "arducode.additionalBoardUrls": [],
  "arducode.docs": "full",
  "arducode.editorButtons": true
}
```

Le port choisi est mémorisé sur votre poste, pas dans le projet. `arducode.port` permet d'en fixer un par défaut.

## Crédits

Textes au survol : [référence Arduino](https://github.com/arduino/reference-en) © Arduino et contributeurs, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), convertis par `tools/docs.js`. `media/arduino-docs.json` reste sous cette licence.
