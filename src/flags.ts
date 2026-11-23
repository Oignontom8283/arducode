import * as path from 'path';
import * as fs from 'fs';
import * as cli from './cli';
import * as config from './config';

/** Options communes à la compilation et à l'IntelliSense : mêmes bibliothèques, mêmes macros. */
export function compileFlags(sketch: string): string[] {
  return [
    ...config.existingLibraryPaths(sketch).flatMap(l => ['--libraries', l]),
    ...(config.get<string[]>('buildProperties', sketch) ?? []).flatMap(p => ['--build-property', p]),
  ];
}

/** Masque les bibliothèques globales en pointant le sketchbook vers un dossier vide. */
export function globalLibraryEnv(sketch: string): Record<string, string> {
  if (config.get<boolean>('useGlobalLibraries', sketch)) { return {}; }
  const dir = path.join(cli.storageDir(), 'empty-sketchbook');
  fs.mkdirSync(dir, { recursive: true });
  return { ARDUINO_DIRECTORIES_USER: dir };
}
