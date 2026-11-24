import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

async function until(read, description, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(80);
  }
  throw new Error('Timed out waiting for ' + description);
}

async function attachPanel(cdp, targetId) {
  // A Chrome side panel isn't a page in Playwright's tab list. Attach to its DevTools target.
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    pending.get(message.id)?.(message);
  });
  function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolveMessage, rejectMessage) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectMessage(new Error('Side panel did not answer ' + method));
      }, 5000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        if (message.error) rejectMessage(new Error(message.error.message));
        else resolveMessage(message.result);
      });
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => {
        clearTimeout(timer);
        pending.delete(id);
        rejectMessage(error);
      });
    });
  }
  async function evaluate(expression) {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  }
  return { evaluate, send };
}

async function openPanel(t, html) {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  }).listen(0, '127.0.0.1');
  let context;
  let scratch;
  t.after(async () => {
    await context?.close();
    server.close();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });
  await once(server, 'listening');
  scratch = await mkdtemp(join(tmpdir(), 'design-lens-browser-'));
  const extensionPath = process.env.DESIGN_LENS_EXTENSION_PATH
    ? resolve(process.env.DESIGN_LENS_EXTENSION_PATH)
    : fileURLToPath(new URL('../dist/chrome/', import.meta.url));
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    channel: process.env.DESIGN_LENS_CHROME ? undefined : 'chromium',
    executablePath: process.env.DESIGN_LENS_CHROME,
    headless: process.env.DESIGN_LENS_HEADED !== '1',
    locale: 'en-US',
    viewport: null,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--window-size=1500,940'],
  });
  context.setDefaultTimeout(5000);
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  const origin = 'chrome-extension://' + id;
  const worker = await until(() => context.serviceWorkers().find((item) => item.url() === origin + '/background.js'), 'the extension service worker');
  assert.equal(await worker.evaluate(() => chrome.runtime.id), id);
  const page = context.pages()[0] ?? await context.newPage();
  const fixtureUrl = 'http://127.0.0.1:' + server.address().port + '/fixture';
  const targets = async () => (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos;
  async function authorize(tabPage) {
    await tabPage.bringToFront();
    const tab = await until(async () => (await targets()).find((item) => item.type === 'tab' && item.url === tabPage.url()), 'the test tab');
    await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
  }
  await page.goto(fixtureUrl);
  await authorize(page);
  const panelTarget = await until(async () => (await targets()).find((item) => item.type === 'page' && item.url === origin + '/index.html'), 'the Chrome side panel');
  const panel = await attachPanel(cdp, panelTarget.targetId);
  const click = (selector) => panel.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const downloadPath = join(scratch, 'download');
  await mkdir(downloadPath);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, browserContextId: panelTarget.browserContextId });
  await until(() => panel.evaluate('Boolean(document.querySelector("#capture"))'), 'the panel UI');
  await page.setViewportSize({ width: 1440, height: 900 });

  async function capture() {
    await click('#capture');
    await until(async () => {
      const state = await panel.evaluate('({ text: document.querySelector("#status").textContent, failed: document.querySelector("#status").dataset.error === "true", ready: !document.querySelector("#results").hidden })');
      if (state.failed) throw new Error(state.text);
      return state.ready;
    }, 'page capture');
  }

  return { context, page, panel, click, capture, authorize, fixtureUrl, downloadPath };
}

async function savePanelImage(panel, filename) {
  if (!process.env.DESIGN_LENS_ARTIFACT_DIR) return;
  const artifactDir = resolve(process.env.DESIGN_LENS_ARTIFACT_DIR);
  await mkdir(artifactDir, { recursive: true });
  const screenshot = await panel.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifactDir, filename), Buffer.from(screenshot.data, 'base64'));
}

function saved(downloadPath, filename) {
  return until(() => readFile(join(downloadPath, filename), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }), filename + ' download');
}

async function expectPanelError(panel, message) {
  const error = await until(() => panel.evaluate('document.querySelector("#status[data-error=true]")?.textContent'), 'the panel error');
  assert.match(error, message);
}

async function refreshViewport(click, panel) {
  await click('#compare');
  await until(() => panel.evaluate('/was refreshed|已刷新/.test(document.querySelector("#status").textContent)'), 'the viewport to refresh in place');
}

const loadDemo = () => readFile(new URL('../fixtures/field-notes.html', import.meta.url));

test('loads the extension, captures a real web page, and downloads its design brief', { timeout: 45000 }, async (t) => {
  const { page, panel, click, capture, fixtureUrl, downloadPath } = await openPanel(t, await loadDemo());
  await capture();
  t.diagnostic('Captured the desktop viewport through the panel.');
  await click('#record');
  await until(() => panel.evaluate('document.querySelector("#capture-card").dataset.recording === "true"'), 'motion recording');
  await page.locator('#primary-action').hover();
  await page.locator('#css-trigger').click();
  await page.locator('#waapi-trigger').click();
  await click('#record');
  await until(() => panel.evaluate('document.querySelector("#capture-card").dataset.recording === "false"'), 'observed motion');
  t.diagnostic('Recorded interactive motion through the panel.');

  await page.locator('#waapi-target').evaluate(async (target) => {
    await Promise.allSettled(target.getAnimations().map((animation) => animation.finished));
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await click('#compare');
  await until(() => panel.evaluate('document.querySelector("#context-details").textContent.includes("390 × 900")'), 'the additional viewport');
  await panel.evaluate('document.querySelector("#document-name").value = "Field Notes Demo"');
  await click('#markdown-tab');
  const markdown = await panel.evaluate('document.querySelector("#preview").value');
  assert.match(markdown, /name: "Field Notes Demo"/);
  assert.match(markdown, /primary: "#145344"/);
  assert.match(markdown, /Viewport 1440 × 900 CSS px[\s\S]*3 columns/);
  assert.match(markdown, /Viewport 390 × 900 CSS px[\s\S]*1 column\b/);
  assert.match(markdown, /observed \| css-transition \| .*\| 180ms/);
  assert.match(markdown, /observed \| css-animation \| .*\| 420ms/);
  assert.match(markdown, /observed \| web-animation \| .*\| 480ms/);
  assert.doesNotMatch(markdown, /private-fixture|127\.0\.0\.1|documentKey/);
  await click('#download');
  assert.equal(await saved(downloadPath, 'DESIGN.md'), markdown);
  const cli = fileURLToPath(new URL('../node_modules/@google/design.md/dist/index.js', import.meta.url));
  const lint = JSON.parse(execFileSync(process.execPath, [cli, 'lint', join(downloadPath, 'DESIGN.md'), '--format', 'json'], { encoding: 'utf8' }));
  assert.equal(lint.summary.errors, 0);
  await click('#json');
  const captured = await saved(downloadPath, 'capture.json');
  assert.doesNotMatch(captured, /private-fixture|127\.0\.0\.1|documentKey/);
  const data = JSON.parse(captured);
  assert.deepEqual(data.snapshots.map((snapshot) => snapshot.context.width), [1440, 390]);
  assert.ok(data.snapshots[0].motion.some((item) =>
    item.evidence === 'observed' && item.source === 'web-animation' && item.durationMs === 480 && item.keyframes.length > 1));

  if (process.env.DESIGN_LENS_ARTIFACT_DIR) {
    const artifactDir = resolve(process.env.DESIGN_LENS_ARTIFACT_DIR);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'DESIGN.md'), markdown);
    await writeFile(join(artifactDir, 'capture.json'), captured);
    await click('#summary-tab');
    await savePanelImage(panel, 'side-panel.png');
  }

  await page.goto(fixtureUrl + '?navigated');
  await until(() => panel.evaluate('document.querySelector("#results").hidden'), 'stale results to clear after navigation');
});

test('edits, restores, and refreshes the palette and switches to Markdown by keyboard', { timeout: 45000 }, async (t) => {
  const { page, panel, click, capture } = await openPanel(t, await loadDemo());
  await capture();
  const control = '[data-color-role="primary"] select';
  assert.equal(await panel.evaluate('document.querySelector(".swatch-item select").value'), '#145344');
  const chooseColor = () => panel.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(control)});
    select.value = '#162822';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await chooseColor();
  await panel.evaluate('document.querySelector("#summary-tab").focus()');
  await panel.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await panel.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  assert.equal(await panel.evaluate('document.activeElement.id'), 'markdown-tab');
  assert.equal(await panel.evaluate('document.querySelector("#markdown-tab").getAttribute("aria-selected")'), 'true');
  assert.match(await panel.evaluate('document.querySelector("#preview").value'), /^  primary: "#162822"$/m);
  await click('#summary-tab');
  await click('#reset-colors');
  assert.equal(await panel.evaluate(`document.querySelector(${JSON.stringify(control)}).value`), '#145344');
  await click('#markdown-tab');
  assert.match(await panel.evaluate('document.querySelector("#preview").value'), /^  primary: "#145344"$/m);
  await panel.evaluate('const nameInput = document.querySelector("#document-name"); nameInput.value = "Edited brief"; nameInput.dispatchEvent(new Event("input", { bubbles: true }));');
  assert.match(await panel.evaluate('document.querySelector("#preview").value'), /^name: "Edited brief"$/m);

  await click('#summary-tab');
  await chooseColor();
  await page.evaluate(() => document.body.style.setProperty('--primary', '#162822'));
  await refreshViewport(click, panel);
  assert.equal(await panel.evaluate('document.querySelector("#reset-colors").hidden'), true);
  await page.evaluate(() => document.body.style.setProperty('--primary', '#6b60f0'));
  await refreshViewport(click, panel);
  assert.equal(await panel.evaluate(`document.querySelector(${JSON.stringify(control)}).value`), '#6B60F0');
});

test('keeps export feedback visible while reading a narrow side panel', { timeout: 45000 }, async (t) => {
  const { context, page, panel, click, capture, fixtureUrl } = await openPanel(t, await loadDemo());
  await panel.send('Emulation.setDeviceMetricsOverride', { width: 264, height: 640, deviceScaleFactor: 1, mobile: false });
  await panel.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await savePanelImage(panel, 'side-panel-empty-dark.png');
  await capture();
  await context.grantPermissions(['clipboard-read'], { origin: new URL(fixtureUrl).origin });
  await panel.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await click('#markdown-tab');
  const markdown = await panel.evaluate('document.querySelector("#preview").value');
  await click('#summary-tab');
  await panel.evaluate('document.querySelector("#summary-view section:last-child").scrollIntoView({ block: "end" })');
  await click('#copy');
  await page.bringToFront();
  await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === markdown, 'the copied Markdown');
  assert.match(await panel.evaluate('document.querySelector("#status").textContent'), /Markdown copied\.|已复制 Markdown/);
  const layout = await panel.evaluate(`(() => {
    const status = document.querySelector('#status').getBoundingClientRect();
    const actions = document.querySelector('#export-actions').getBoundingClientRect();
    return {
      statusVisible: status.height > 0 && status.top >= 0 && status.bottom <= innerHeight,
      actionsVisible: actions.height > 0 && actions.top >= 0 && actions.bottom <= innerHeight,
      fits: document.documentElement.scrollWidth <= innerWidth,
      theme: getComputedStyle(document.documentElement).colorScheme,
    };
  })()`);
  assert.deepEqual(layout, { statusVisible: true, actionsVisible: true, fits: true, theme: 'dark' });
  await panel.evaluate('document.querySelector("#summary-tab").scrollIntoView()');
  await savePanelImage(panel, 'side-panel-narrow-dark.png');
  await click('#markdown-tab');
  await savePanelImage(panel, 'side-panel-markdown-dark.png');
});

test('clears stale captures and requests toolbar access in a different tab', { timeout: 45000 }, async (t) => {
  const { context, panel, click, capture, authorize, fixtureUrl } = await openPanel(t, await loadDemo());
  await capture();
  await panel.evaluate('document.querySelector("#document-name").value = "Previous tab"');
  const other = await context.newPage();
  await other.goto(fixtureUrl + '?tab=second');
  await other.bringToFront();
  await until(() => panel.evaluate('document.querySelector("#results").hidden && document.querySelector("#export-actions").hidden'), 'the previous capture to clear');
  assert.equal(await panel.evaluate('document.querySelector("#document-name").value'), '');
  await click('#capture');
  await expectPanelError(panel, /toolbar icon|工具栏/);
  await authorize(other);
  await capture();

  await other.goto('about:blank');
  await until(() => panel.evaluate('document.querySelector("#results").hidden'), 'the capture to clear on navigation');
  await click('#capture');
  await expectPanelError(panel, /regular (web page|HTTP or HTTPS page)|普通网页|HTTP 或 HTTPS/);
});

test('records motion in a compared viewport and stops automatically', { timeout: 45000 }, async (t) => {
  const { page, panel, click, capture } = await openPanel(t, await loadDemo());
  await capture();
  await page.setViewportSize({ width: 390, height: 900 });
  await click('#record');
  await expectPanelError(panel, /viewport changed|视口已变化/);
  await click('#compare');
  await until(() => panel.evaluate('document.querySelector("#context-details").textContent.includes("390 × 900")'), 'the additional viewport');
  await refreshViewport(click, panel);

  await click('#record');
  await until(() => panel.evaluate('!document.querySelector("#recording-timer").hidden'), 'the recording countdown');
  await page.locator('#css-trigger').click();
  await until(() => panel.evaluate('document.querySelector("#recording-timer").hidden && document.querySelector("#capture-card").dataset.recording === "false"'), 'automatic recording completion', 12000);
  await click('#markdown-tab');
  const markdown = await panel.evaluate('document.querySelector("#preview").value');
  assert.equal([...markdown.matchAll(/^### Viewport 390 × 900 CSS px$/gm)].length, 1);
  assert.match(markdown, /Motion evidence at 390 × 900 CSS px\.[\s\S]*observed \| css-animation \| .*\| 420ms/);
});

const themeFixture = (mode) => `<!doctype html><html data-theme="${mode}"><head><title>Theme token fixture</title>
<style>
  :root { --brand-500: #6657f2; --primary: var(--brand-500); --primary-foreground: #fff; --selected: #5b4ce8; }
  [data-theme="dark"] { --brand-500: #6b60f0; --selected: #594bd5; }
  [data-theme="hsl"] { --brand-500: 240 100% 50%; --primary-foreground: 0 0% 100%; }
  [data-theme="named"] { --brand-500: rebeccapurple; --primary-foreground: color-mix(in srgb, white 80%, black); }
  [data-theme="conditional"] { color-scheme: dark; --brand-500: light-dark(red, #123456); --primary-foreground: hsl(0 1 0.5); }
  [data-theme="transparent"] { --brand-500: rgb(12 34 56 / none); }
  [data-theme="invalid"] { --primary: linear-gradient(red, blue); }
  body { background: #f4f6fb; color: #101828; }
  a[aria-current] { color: var(--selected); }
  button { background: white; color: #101828; }
</style></head><body><main><h1>Control panel</h1>
<nav><a href="#overview" aria-current="page">Overview</a></nav><button>Details</button>
</main></body></html>`;

async function verifyPrimary(t, content, { primary, onPrimary, artifact }) {
  const { panel, click, capture, downloadPath } = await openPanel(t, content);
  await capture();
  await click('#markdown-tab');
  const markdown = await panel.evaluate('document.querySelector("#preview").value');
  assert.equal(markdown.match(/^  primary: "(#[0-9A-F]+)"$/m)?.[1], primary);
  if (onPrimary) {
    assert.equal(markdown.match(/^  on-primary: "(#[0-9A-F]+)"$/m)?.[1], onPrimary);
    assert.match(markdown, /computed CSS variable --primary\)/);
    await click('#json');
    const { snapshots: [snapshot] } = JSON.parse(await saved(downloadPath, 'capture.json'));
    assert.deepEqual(snapshot.themeColors, { primary, onPrimary });
  }
  if (artifact && process.env.DESIGN_LENS_ARTIFACT_DIR) {
    const artifactDir = resolve(process.env.DESIGN_LENS_ARTIFACT_DIR);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, artifact + '-DESIGN.md'), markdown);
    await click('#summary-tab');
    await savePanelImage(panel, artifact + '-side-panel.png');
  }
}

test('finds a brand color that only exists behind a gradient hero', { timeout: 45000 }, async (t) => {
  const hero = await readFile(new URL('../fixtures/landing-hero.html', import.meta.url));
  await verifyPrimary(t, hero, { primary: '#4F46E5', artifact: 'hero' });
});

for (const [mode, primary, onPrimary] of [
  ['light', '#6657F2', '#FFFFFF'],
  ['dark', '#6B60F0', '#FFFFFF'],
  ['hsl', '#0000FF', '#FFFFFF'],
  ['named', '#663399', '#CCCCCC'],
  ['conditional', '#123456', '#010101'],
  ['transparent', '#5B4CE8'],
  ['invalid', '#5B4CE8'],
]) {
  test(`captures the correct primary when the declared theme is ${mode}`, { timeout: 45000 }, async (t) => {
    await verifyPrimary(t, themeFixture(mode), { primary, onPrimary });
  });
}
