// Dev harness: run the real collector inside a real browser and print the inferred palette.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { analyzeSnapshot } from '../src/analyze.ts';

const fixtures = process.argv.slice(2);
if (!fixtures.length) {
  console.error('usage: node scripts/probe-palette.mjs <fixture.html|url> [...]');
  process.exit(1);
}

const pages = new Map();
for (const fixture of fixtures) {
  if (/^https?:\/\//.test(fixture)) continue;
  const body = await readFile(fileURLToPath(new URL('../' + fixture, import.meta.url)));
  pages.set('/' + fixture.split('/').pop(), body);
}

const server = createServer((request, response) => {
  const body = pages.get(request.url?.split('?')[0] ?? '');
  if (!body) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({
  channel: process.env.DESIGN_LENS_CHROME ? undefined : 'chromium',
  executablePath: process.env.DESIGN_LENS_CHROME,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  globalThis.chrome = {
    runtime: {
      id: 'probe',
      onMessage: { addListener: (listener) => { globalThis.__designLensListener = listener; } },
    },
  };
});

const collector = await readFile(new URL('../dist/chrome/collector.js', import.meta.url), 'utf8');
await context.addInitScript({ content: collector });

for (const fixture of fixtures) {
  const page = await context.newPage();
  const url = /^https?:\/\//.test(fixture)
    ? fixture
    : `http://127.0.0.1:${server.address().port}/${fixture.split('/').pop()}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const snapshot = await page.evaluate(() => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('capture timed out')), 10000);
    globalThis.__designLensListener({ type: 'capture' }, { id: 'probe' }, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
  }));
  const analysis = analyzeSnapshot(snapshot.snapshot);
  console.log(`\n=== ${fixture} ===`);
  console.log('samples:', snapshot.snapshot.samples.length);
  for (const entry of analysis.palette) {
    console.log(`  ${entry.role.padEnd(18)} ${entry.value}  (${entry.samples} samples)`);
  }
  await page.close();
}

await browser.close();
server.close();
