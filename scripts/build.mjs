import { copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build as bundleScripts } from 'esbuild';
import { build as bundlePanel } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../public/manifest.json', import.meta.url)));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
if (manifest.version !== pkg.version) {
  throw new Error('Versions in public/manifest.json and package.json must match.');
}
const target = 'chrome' + manifest.minimum_chrome_version;

await bundlePanel({
  root,
  base: './',
  configFile: false,
  build: { target, outDir: 'dist/chrome', emptyOutDir: true },
});
await bundleScripts({
  absWorkingDir: root,
  entryPoints: ['src/collector.ts', 'src/background.ts'],
  outdir: 'dist/chrome',
  platform: 'browser',
  format: 'iife',
  target,
  bundle: true,
});
await copyFile(new URL('../LICENSE', import.meta.url), new URL('../dist/chrome/LICENSE', import.meta.url));
