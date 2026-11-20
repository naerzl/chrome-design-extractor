import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveColor } from '../src/color.ts';

const samples = [
  '#145344', 'rgb(20, 83, 68)', 'rgba(20, 83, 68, 0.5)',
  'hsl(160, 60%, 20%)', 'hsl(160 60% 20%)',
  'lab(50 0 0)', 'lab(50% 0 0)', 'oklab(0.5 0 0)', 'oklch(0.5 0 0)',
  'hwb(160 10% 20%)', 'color(srgb 0.078 0.325 0.267)',
  '#ffffff', '#000000', 'rgb(128, 128, 128)', 'hsl(0, 0%, 50%)',
];

// A translucent color blends with whatever is behind it, so its painted pixel
// cannot be compared directly. Its alpha is checked in the unit test instead.
const translucent = new Set(['rgba(20, 83, 68, 0.5)']);

test('resolves color notations the same way Chrome paints them', { timeout: 45000 }, async () => {
  // Fall back to the Playwright build when no system Chrome is configured.
  const browser = await chromium.launch({
    channel: process.env.DESIGN_LENS_CHROME ? undefined : 'chromium',
    executablePath: process.env.DESIGN_LENS_CHROME,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 40, height: samples.length * 20 } });
    const page = await context.newPage();
    await page.setContent(`<body style="margin:0">${samples
      .map((value) => `<div style="height:20px;background:${value}"></div>`).join('')}</body>`);
    const computed = await page.evaluate(() =>
      [...document.body.children].map((element) => getComputedStyle(element).backgroundColor));
    const painted = await page.evaluate(async () => {
      // Read the actual rendered pixels back so the check follows what a user sees.
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      return [...document.body.children].map((element) => {
        const rect = element.getBoundingClientRect();
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        return { red, green, blue, top: rect.top };
      });
    });
    for (const [index, value] of samples.entries()) {
      const resolved = resolveColor(computed[index]);
      assert.ok(resolved, `could not resolve ${computed[index]} from ${value}`);
      if (translucent.has(value)) {
        assert.equal(Math.round(resolved.alpha * 255), 128);
        continue;
      }
      const paintedPixel = painted[index];
      const tolerance = value.startsWith('hwb') ? 1 : 0;
      assert.ok(Math.abs(resolved.red - paintedPixel.red) <= tolerance,
        `${value}: red ${resolved.red} vs painted ${paintedPixel.red}`);
      assert.ok(Math.abs(resolved.green - paintedPixel.green) <= tolerance,
        `${value}: green ${resolved.green} vs painted ${paintedPixel.green}`);
      assert.ok(Math.abs(resolved.blue - paintedPixel.blue) <= tolerance,
        `${value}: blue ${resolved.blue} vs painted ${paintedPixel.blue}`);
    }
  } finally {
    await browser.close();
  }
});
