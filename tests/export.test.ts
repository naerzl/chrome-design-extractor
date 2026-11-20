import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeSnapshot, normalizeDesignColor } from '../src/analyze.ts';
import { exportCapture, exportDesign } from '../src/export.ts';
import type { CaptureSnapshot, StyleSample } from '../src/schema.ts';

function style(overrides: Partial<StyleSample>): StyleSample {
  return {
    role: 'container', rect: { x: 0, y: 0, width: 200, height: 44 },
    color: 'rgb(22, 40, 34)', backgroundColor: 'rgba(0, 0, 0, 0)', borderColor: '',
    backdrop: 'rgb(246, 245, 239)',
    fill: '', gradient: '', fontFamily: 'system-ui', fontSize: '16px', fontWeight: '400',
    lineHeight: '24px', letterSpacing: 'normal', borderRadius: '0px', boxShadow: 'none',
    padding: '0px', margin: '0px', display: 'block', position: 'static', maxWidth: 'none',
    gap: 'normal', gridColumns: null, flexDirection: 'row', depth: 0, ...overrides,
  };
}

function sample(width = 1440, columns = 3): CaptureSnapshot {
  return {
    version: 1,
    documentKey: 'internal-test-key',
    context: { width, height: 900, preferredTheme: 'light', reducedMotion: false },
    coverage: { visited: 49, sampled: 6, omittedFrames: 1, partial: false },
    samples: [
      style({ role: 'page', backgroundColor: 'rgb(246, 245, 239)', rect: { x: 0, y: 0, width, height: 900 } }),
      style({ role: 'heading', fontFamily: 'Georgia, serif', fontSize: '40px', fontWeight: '700' }),
      style({ role: 'text' }),
      style({ role: 'button', color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(20, 83, 68)', borderRadius: '8px', padding: '8px 16px' }),
      style({ role: 'main', maxWidth: '1120px' }),
      style({ role: 'section', display: 'grid', gridColumns: columns, gap: '24px', rect: { x: 0, y: 0, width: Math.min(width, 1120), height: 200 } }),
    ],
    motion: [{
      role: 'button', source: 'css-transition', evidence: 'observed', durationMs: 180, delayMs: 0,
      easing: 'ease-out', iterations: 1, properties: ['transform'],
      keyframes: [{ offset: 1, easing: 'linear', values: { transform: 'translateY(-2px)' } }],
    }],
  };
}

test('exports stable design tokens and viewport observations through the official CLI', () => {
  const design = exportDesign(analyzeSnapshot(sample()), {
    name: 'Field Notes',
    additional: [analyzeSnapshot(sample(390, 1))],
  });
  assert.match(design, /primary: "#145344"/);
  assert.match(design, /Viewport 1440 × 900 CSS px[\s\S]*3 columns/);
  assert.match(design, /Viewport 390 × 900 CSS px[\s\S]*1 column\b/);
  assert.match(design, /### Motion & Micro-interaction[\s\S]*180ms/);
  assert.doesNotMatch(design, /^motion:/m);
  const scratch = mkdtempSync(join(tmpdir(), 'design-lens-lint-'));
  try {
    const filename = join(scratch, 'DESIGN.md');
    writeFileSync(filename, design);
    const cli = fileURLToPath(new URL('../node_modules/@google/design.md/dist/index.js', import.meta.url));
    const result = JSON.parse(execFileSync(process.execPath, [cli, 'lint', filename, '--format', 'json'], { encoding: 'utf8' }));
    assert.equal(result.summary.errors, 0);
    assert.equal(result.summary.warnings, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('validates color overrides and escapes headings that resemble Markdown instructions', () => {
  const analysis = analyzeSnapshot(sample());
  const options = { name: 'Field\n## Layout <b>', colorOverrides: { primary: '#053020' } };
  const design = exportDesign(analysis, options);
  assert.match(design, /primary: "#053020"/);
  assert.match(design, /user-edited value/);
  assert.equal(design, exportDesign(analysis, options));
  assert.equal(design.match(/^## Layout$/gm)?.length, 1);
  assert.doesNotMatch(design, /^# .*<b>$/m);
  assert.match(exportDesign(analysis, { colorOverrides: { primary: 'url(https://invalid.example)' } }), /primary: "#145344"/);
  assert.equal(normalizeDesignColor('rgba(20, 83, 68, 0.5)'), '#14534480');
});

test('JSON retains structured keyframes and omits the internal document identifier', () => {
  const data = exportCapture([sample()]);
  assert.doesNotMatch(data, /documentKey|internal-test-key/);
  assert.equal(JSON.parse(data).snapshots[0].motion[0].keyframes[0].values.transform, 'translateY(-2px)');
});

/**
 * A brand color often lives in a gradient or in the backdrop of a hero rather
 * than in a flat button fill. Inferring it by frequency alone used to pick the
 * white text of a hero and report it as the primary color.
 */
function heroSample(): CaptureSnapshot {
  const backdrop = 'rgb(99, 102, 241)';
  return {
    version: 1,
    documentKey: 'internal-hero-key',
    context: { width: 1440, height: 900, preferredTheme: 'light', reducedMotion: false },
    coverage: { visited: 12, sampled: 6, omittedFrames: 0, partial: false },
    samples: [
      style({ role: 'page', backgroundColor: 'rgb(255, 255, 255)', backdrop: 'rgb(255, 255, 255)', rect: { x: 0, y: 0, width: 1440, height: 900 } }),
      style({ role: 'section', backgroundColor: 'rgba(0, 0, 0, 0)', backdrop, rect: { x: 0, y: 62, width: 1440, height: 354 } }),
      style({ role: 'heading', color: 'rgb(255, 255, 255)', backgroundColor: 'rgba(0, 0, 0, 0)', backdrop, rect: { x: 32, y: 158, width: 1376, height: 48 } }),
      style({ role: 'text', color: 'rgb(237, 233, 254)', backgroundColor: 'rgba(0, 0, 0, 0)', backdrop, rect: { x: 32, y: 223, width: 463, height: 25 } }),
      style({ role: 'button', color: 'rgb(15, 23, 42)', backgroundColor: 'rgb(255, 255, 255)', backdrop, rect: { x: 32, y: 276, width: 146, height: 44 } }),
      style({ role: 'link', color: 'rgb(255, 255, 255)', backgroundColor: 'rgba(0, 0, 0, 0)', backdrop, rect: { x: 331, y: 288, width: 103, height: 18 } }),
    ],
    motion: [],
  };
}

test('infers a primary color from a hero backdrop instead of its text', () => {
  const palette = analyzeSnapshot(heroSample()).palette;
  const primary = palette.find((entry) => entry.role === 'primary');
  const surface = palette.find((entry) => entry.role === 'surface');
  assert.equal(primary?.value, '#6366F1');
  assert.equal(surface?.value, '#FFFFFF');
  assert.notEqual(primary?.value, surface?.value);
});

/**
 * A button painted with a gradient has no flat background color, so the brand
 * color only exists in the gradient's first stop. A nearby input field's light
 * gray fill must not win the primary role.
 */
function gradientButtonSample(): CaptureSnapshot {
  return {
    version: 1,
    documentKey: 'internal-gradient-key',
    context: { width: 1440, height: 900, preferredTheme: 'light', reducedMotion: false },
    coverage: { visited: 20, sampled: 5, omittedFrames: 0, partial: false },
    samples: [
      style({ role: 'page', backgroundColor: 'rgb(255, 255, 255)', backdrop: 'rgb(255, 255, 255)', rect: { x: 0, y: 0, width: 1440, height: 900 } }),
      style({ role: 'input', backgroundColor: 'rgb(241, 242, 242)', backdrop: 'rgb(241, 242, 242)', rect: { x: 880, y: 370, width: 400, height: 44 } }),
      style({
        role: 'button',
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backdrop: 'rgb(0, 79, 248)',
        gradient: 'linear-gradient(135deg, rgb(0, 79, 248) 0%, rgb(193, 123, 255) 100%)',
        rect: { x: 880, y: 685, width: 400, height: 44 },
      }),
      style({ role: 'link', color: 'rgb(30, 134, 255)', backdrop: 'rgb(255, 255, 255)', rect: { x: 880, y: 537, width: 48, height: 16 } }),
      style({ role: 'text', color: 'rgb(31, 31, 31)', backdrop: 'rgb(255, 255, 255)', rect: { x: 880, y: 343, width: 101, height: 16 } }),
    ],
    motion: [],
  };
}

test('infers a primary color from a gradient button instead of a gray input fill', () => {
  const palette = analyzeSnapshot(gradientButtonSample()).palette;
  const primary = palette.find((entry) => entry.role === 'primary');
  assert.equal(primary?.value, '#004FF8');
  assert.match(primary?.basis ?? '', /gradient/);
  assert.equal(palette.find((entry) => entry.role === 'surface')?.value, '#FFFFFF');
});
