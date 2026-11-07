// Renders icons/logo.svg to the PNG sizes the manifest needs (requires rsvg-convert).
import { execFileSync } from 'node:child_process';

for (const size of [16, 32, 48, 128]) {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), 'icons/logo.svg', '-o', `icons/icon${size}.png`]);
  console.log(`icons/icon${size}.png`);
}
