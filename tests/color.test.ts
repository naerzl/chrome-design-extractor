import assert from 'node:assert/strict';
import test from 'node:test';
import { colorKey, isOpaqueColor, resolveColor } from '../src/color.ts';

test('resolves the color notations a browser reports into one sRGB value', () => {
  assert.deepEqual(resolveColor('#145344'), { red: 20, green: 83, blue: 68, alpha: 1 });
  assert.deepEqual(resolveColor('rgb(20, 83, 68)'), { red: 20, green: 83, blue: 68, alpha: 1 });
  assert.deepEqual(resolveColor('rgba(20, 83, 68, 0.5)'), { red: 20, green: 83, blue: 68, alpha: 0.5 });
  // A four digit hex carries alpha, so #1453 is a translucent #1155.
  assert.deepEqual(resolveColor('#1453'), { red: 17, green: 68, blue: 85, alpha: 0.2 });
  assert.deepEqual(resolveColor('#145'), { red: 17, green: 68, blue: 85, alpha: 1 });
  assert.deepEqual(resolveColor('hsl(160, 60%, 20%)'), { red: 20, green: 82, blue: 61, alpha: 1 });
  // hwb() rounds differently from the browser, so only the hue axes are exact.
  const hwb = resolveColor('hwb(160 10% 20%)');
  assert.equal(hwb?.red, 26);
  assert.equal(hwb?.green, 204);
  assert.ok(Math.abs((hwb?.blue ?? 0) - 145) <= 1);
  assert.deepEqual(resolveColor('color(srgb 0.078 0.325 0.267)'), { red: 20, green: 83, blue: 68, alpha: 1 });
});

test('treats equivalent notations of one color as the same color', () => {
  // Chrome reports the same color in different notations depending on the source.
  assert.equal(colorKey('rgb(0, 0, 0)'), '#000000');
  assert.equal(colorKey('lab(0 0 0)'), '#000000');
  assert.equal(colorKey('oklab(0 0 0)'), '#000000');
  assert.equal(colorKey('lab(50 0 0)'), '#777777');
  assert.equal(colorKey('oklab(0.5 0 0)'), '#636363');
});

test('keeps transparency visible instead of treating it as opaque', () => {
  assert.equal(isOpaqueColor('rgb(255, 255, 255)'), true);
  assert.equal(isOpaqueColor('rgba(255, 255, 255, 0.05)'), false);
  assert.equal(isOpaqueColor('oklab(0.129999 -0.00404751 -0.027702 / 0.05)'), false);
  assert.equal(isOpaqueColor('transparent'), false);
  assert.equal(colorKey('rgba(20, 83, 68, 0.5)'), '#14534480');
});

test('refuses values that are not colors', () => {
  assert.equal(resolveColor('none'), null);
  assert.equal(resolveColor(''), null);
  assert.equal(resolveColor('url(https://example.com/a.png)'), null);
  assert.equal(colorKey('not-a-color'), null);
});
