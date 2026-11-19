// Copies the finished builds into one versioned folder next to the repo:
//   ../builds/MicMe-<version>/
//     MicMe-<version>-Android.apk
//     MicMe-Setup-<version>.exe
//     MicMe-Portable-<version>.exe
// Override the destination with BUILDS_DIR=/some/path.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8')).version;
const dest = join(process.env.BUILDS_DIR || resolve(root, '..', 'builds'), `MicMe-${version}`);
mkdirSync(dest, { recursive: true });

const items = [
  [join(root, 'mobile/android/app/build/outputs/apk/release/app-release.apk'), `MicMe-${version}-Android.apk`],
  [join(root, `desktop/release/MicMe-Setup-${version}.exe`), `MicMe-Setup-${version}.exe`],
  [join(root, `desktop/release/MicMe-Portable-${version}.exe`), `MicMe-Portable-${version}.exe`],
];

for (const [from, name] of items) {
  if (!existsSync(from)) {
    console.log(`  - skipped ${name} (not built)`);
    continue;
  }
  copyFileSync(from, join(dest, name));
  console.log(`  ✔ ${name}  ${(statSync(from).size / 1048576).toFixed(1)} MB`);
}
console.log(`\nBuilds are in ${dest}`);
