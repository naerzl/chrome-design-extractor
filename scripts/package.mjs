import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const unpacked = join(dist, 'chrome');
const manifest = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8'));
const file = 'extension-chrome-v' + manifest.version + '.zip';
const paths = await readdir(unpacked, { recursive: true, withFileTypes: true });
const files = paths
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name))
  .sort();
const entries = await Promise.all(files.map(async (path) => [
  relative(unpacked, path).split(sep).join('/'),
  await readFile(path),
]));
const archive = zipSync(Object.fromEntries(entries), { level: 9, mtime: new Date(2000, 0, 1) });
const checksum = createHash('sha256').update(archive).digest('hex');
await writeFile(join(dist, file), archive);
await writeFile(join(dist, file + '.sha256'), checksum + '  ' + file + '\n');
console.log('Packaged ' + join(dist, file));
