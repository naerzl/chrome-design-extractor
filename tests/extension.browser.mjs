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

async function until(read, description) {
  const deadline = Date.now() + 6000;
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

test('loads the extension, captures a real web page, and downloads its design brief', { timeout: 45000 }, async (t) => {
  const demo = await readFile(new URL('../fixtures/field-notes.html', import.meta.url));
  const server = createServer((req, res) => {
    if (!req.url?.startsWith('/fixture')) { res.writeHead(404).end(); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(demo);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const scratch = await mkdtemp(join(tmpdir(), 'design-lens-browser-'));
  let context;
  try {
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
    const worker = await until(() => context.serviceWorkers().find((item) => item.url() === 'chrome-extension://' + id + '/background.js'), 'the extension service worker');
    assert.equal(await worker.evaluate(() => chrome.runtime.id), id);
    const page = context.pages()[0] ?? await context.newPage();
    const fixtureUrl = 'http://127.0.0.1:' + server.address().port + '/fixture';
    await page.goto(fixtureUrl);
    await page.bringToFront();
    const targets = async () => (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos;
    const tab = await until(async () => (await targets()).find((item) => item.type === 'tab' && item.url === fixtureUrl), 'the test tab');
    await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
    const panelTarget = await until(async () => (await targets()).find((item) => item.type === 'page' && item.url === 'chrome-extension://' + id + '/index.html'), 'the Chrome side panel');
    t.diagnostic('Toolbar action opened the real Chrome side panel.');
    const panel = await attachPanel(cdp, panelTarget.targetId);
    const click = (selector) => panel.evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
    const downloadPath = join(scratch, 'download');
    await mkdir(downloadPath);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, browserContextId: panelTarget.browserContextId });
    await until(() => panel.evaluate('Boolean(document.querySelector("#capture"))'), 'the panel UI');
    await page.setViewportSize({ width: 1440, height: 900 });
    await click('#capture');
    await until(async () => {
      const state = await panel.evaluate('({ text: document.querySelector("#status").textContent, failed: document.querySelector("#status").dataset.error === "true", ready: !document.querySelector("#results").hidden })');
      if (state.failed) throw new Error(state.text);
      return state.ready;
    }, 'page capture');
    t.diagnostic('Captured the desktop viewport through the panel.');
    await click('#record');
    await until(() => panel.evaluate('document.querySelector("#capture-card").dataset.recording === "true"'), 'motion recording');
    await page.locator('#primary-action').hover();
    await page.locator('#css-trigger').click();
    await page.locator('#waapi-trigger').click();
    await click('#record');
    await until(() => panel.evaluate('document.querySelector("#capture-card").dataset.recording === "false"'), 'observed motion');
    t.diagnostic('Recorded interactive motion through the panel.');

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
    const saved = (file) => until(() => readFile(join(downloadPath, file), 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }), file + ' download');
    await click('#download');
    assert.equal(await saved('DESIGN.md'), markdown);
    const cli = fileURLToPath(new URL('../node_modules/@google/design.md/dist/index.js', import.meta.url));
    const lint = JSON.parse(execFileSync(process.execPath, [cli, 'lint', join(downloadPath, 'DESIGN.md'), '--format', 'json'], { encoding: 'utf8' }));
    assert.equal(lint.summary.errors, 0);
    await click('#json');
    const captured = await saved('capture.json');
    assert.doesNotMatch(captured, /private-fixture|127\.0\.0\.1|documentKey/);
    const data = JSON.parse(captured);
    assert.deepEqual(data.snapshots.map((snapshot) => snapshot.context.width), [1440, 390]);
    assert.ok(data.snapshots[0].motion.some((item) => item.evidence === 'observed' && item.keyframes.length > 1));

    if (process.env.DESIGN_LENS_ARTIFACT_DIR) {
      const artifactDir = resolve(process.env.DESIGN_LENS_ARTIFACT_DIR);
      await mkdir(artifactDir, { recursive: true });
      await writeFile(join(artifactDir, 'DESIGN.md'), markdown);
      await writeFile(join(artifactDir, 'capture.json'), captured);
      await click('#summary-tab');
      const screenshot = await panel.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(artifactDir, 'side-panel.png'), Buffer.from(screenshot.data, 'base64'));
    }

    await page.goto(fixtureUrl + '?navigated');
    await until(() => panel.evaluate('document.querySelector("#results").hidden'), 'stale results to clear after navigation');
  } finally {
    await context?.close();
    server.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
