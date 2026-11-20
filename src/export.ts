import { normalizeDesignColor } from './analyze.ts';
import type { DesignAnalysis, LayoutEntry } from './analyze.ts';
import type { CaptureSnapshot } from './schema.ts';

export interface DesignExportOptions {
  name?: string;
  additional?: DesignAnalysis[];
  colorOverrides?: Record<string, string>;
}

function cleanLine(value: string, maxLength: number): string {
  const stripped = value.replace(/[\x00-\x1f\x7f\u2028-\u202e\u2066-\u2069]/g, ' ').trim();
  return Array.from(stripped).slice(0, maxLength).join('');
}

function markText(value: string): string {
  return cleanLine(value, 400).replace(/([\\`*_{}\[\]()#+!|~<>])/g, '\\$1');
}

function inlineCode(value: string): string {
  const content = cleanLine(value, 400).replace(/[|`]/g, '');
  return content ? `\`${content}\`` : 'Unknown';
}

function addHeading(lines: string[], heading: string): void {
  lines.push('', heading, '');
}

function describeLayout(entry: LayoutEntry): string {
  const traits = [entry.display, `${entry.width}px wide`];
  if (entry.maxWidth) traits.push(`max width ${entry.maxWidth}`);
  if (entry.columns) traits.push(`${entry.columns} ${entry.columns === 1 ? 'column' : 'columns'}`);
  if (entry.display.includes('flex') && entry.flexDirection) traits.push(`${entry.flexDirection} direction`);
  if (entry.gap) traits.push(`${entry.gap} gap`);
  return `- **${entry.role}** uses ${traits.join(', ')}.`;
}

const colorUse: Record<string, string> = {
  surface: 'Page or dominant content surface',
  'on-surface': 'Text color read on the page surface',
  primary: 'Candidate emphasis color from buttons, links, and colored backdrops',
  'on-primary': 'Foreground sampled from actions using the candidate primary fill',
  'surface-container': 'Secondary region or component surface',
  outline: 'Frequently observed visible border color',
  icon: 'Common SVG icon fill',
};

export function exportDesign(analysis: DesignAnalysis, options: DesignExportOptions = {}): string {
  const name = cleanLine(options.name ?? '', 80) || 'Captured page design';
  const palette = analysis.palette.map((entry) => {
    const override = options.colorOverrides?.[entry.role];
    const updated = override && normalizeDesignColor(override);
    return { ...entry, value: updated || entry.value, edited: Boolean(updated && updated !== entry.value) };
  });

  const lines = [
    '---', `name: ${JSON.stringify(name)}`,
    'description: "A design reference derived from visible browser snapshots."',
  ];
  const optionalSections = [
    ['colors', palette], ['typography', analysis.typography], ['spacing', analysis.spacing],
    ['rounded', analysis.rounded], ['components', Object.keys(analysis.components)],
  ] as const;
  const omitted = optionalSections.filter(([, entries]) => entries.length === 0);
  if (omitted.length) {
    lines.push('omitted:', ...omitted.map(([key]) => `  - ${key}`));
  }
  if (palette.length) {
    lines.push('colors:', ...palette.map(({ role, value }) => `  ${role}: ${JSON.stringify(value)}`));
  }
  if (analysis.typography.length) {
    lines.push('typography:');
    for (const type of analysis.typography) {
      lines.push(`  ${type.role}:`, `    fontFamily: ${JSON.stringify(type.fontFamily)}`, `    fontSize: ${JSON.stringify(type.fontSize)}`);
      if (type.fontWeight !== null) lines.push(`    fontWeight: ${type.fontWeight}`);
      if (type.lineHeight) lines.push(`    lineHeight: ${JSON.stringify(type.lineHeight)}`);
      if (type.letterSpacing) lines.push(`    letterSpacing: ${JSON.stringify(type.letterSpacing)}`);
    }
  }
  for (const kind of ['rounded', 'spacing'] as const) {
    if (!analysis[kind].length) continue;
    lines.push(`${kind}:`, ...analysis[kind].map(({ role, value }) => `  ${role}: ${JSON.stringify(value)}`));
  }
  const components = Object.entries(analysis.components);
  if (components.length) {
    lines.push('components:');
    for (const [name, settings] of components) {
      lines.push(`  ${name}:`);
      for (const [property, value] of Object.entries(settings)) {
        lines.push(`    ${property}: ${JSON.stringify(value)}`);
      }
    }
  }

  lines.push('---', '', `# ${markText(name)}`);
  addHeading(lines, '## Overview');
  lines.push(markText(analysis.overview));
  lines.push('', 'Design roles and reusable patterns are inferred from the visible sample. Measurements describe the captured states.');

  if (palette.length || analysis.gradients.length) {
    addHeading(lines, '## Colors');
    for (const entry of palette) {
      const basis = entry.edited ? 'user-edited value'
        : `${entry.basis || `${entry.samples} matching ${entry.samples === 1 ? 'sample' : 'samples'}`}`;
      lines.push(`- **${entry.role}** ${inlineCode(entry.value)}. ${colorUse[entry.role] ?? 'Sampled palette color'} (${basis}).`);
    }
    for (const gradient of analysis.gradients) lines.push(`- Observed gradient ${inlineCode(gradient)}.`);
  }

  if (analysis.typography.length) {
    addHeading(lines, '## Typography');
    for (const type of analysis.typography) {
      const metrics = [type.fontSize, type.fontWeight !== null ? `weight ${type.fontWeight}` : '', type.lineHeight ? `${type.lineHeight} line height` : ''].filter(Boolean);
      lines.push(`- **${type.role}** uses ${inlineCode(type.fontFamily)} at ${metrics.join(', ')}.`);
    }
  }

  const snapshots = [analysis, ...(options.additional ?? [])];
  addHeading(lines, '## Layout');
  for (const snapshot of snapshots) {
    const { width, height, preferredTheme, reducedMotion } = snapshot.context;
    addHeading(lines, `### Viewport ${width} × ${height} CSS px`);
    lines.push(`System color preference is ${preferredTheme}. Reduced motion is ${reducedMotion ? 'requested' : 'not requested'}.`);
    if (snapshot.layout.length) lines.push('', ...snapshot.layout.map(describeLayout));
    else lines.push('', 'This capture yielded no representative layout regions.');
    const { sampled, visited, omittedFrames, partial } = snapshot.coverage;
    lines.push('', `Capture kept ${sampled} visible samples from ${visited} visited elements in the main document.`);
    if (partial) lines.push('The capture reached its scan limit.');
    if (omittedFrames) lines.push(`Embedded frames outside this capture scope: ${omittedFrames}.`);
  }
  if (analysis.spacing.length) {
    lines.push('', `Frequently observed spacing sizes are ${analysis.spacing.map(({ value }) => value).join(', ')}.`);
  }

  if (analysis.shadows.length) {
    addHeading(lines, '## Elevation & Depth');
    lines.push(...analysis.shadows.map((shadow) => `- Observed shadow ${inlineCode(shadow)}.`));
  }

  if (analysis.rounded.length) {
    addHeading(lines, '## Shapes');
    lines.push(`Common observed corner radii are ${analysis.rounded.map(({ value }) => value).join(', ')}.`);
  }

  if (components.length || snapshots.some(({ motion }) => motion.length)) {
    addHeading(lines, '## Components');
    for (const [component] of components) lines.push(`- Reuse the captured \`${component}\` token group for the matching component role.`);
    addHeading(lines, '### Motion & Micro-interaction');
    for (const snapshot of snapshots.filter(({ motion }) => motion.length)) {
      const { width, height } = snapshot.context;
      const ordered = snapshot.motion.filter(({ evidence }) => evidence === 'observed')
        .concat(snapshot.motion.filter(({ evidence }) => evidence === 'declared'));
      lines.push(`Motion evidence at ${width} × ${height} CSS px.`, '');
      lines.push('| Target | Evidence | Source | Properties | Duration | Delay | Easing | Iterations |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const item of ordered.slice(0, 24)) {
        const duration = item.durationMs === null ? 'Unknown' : `${item.durationMs}ms`;
        const delay = item.delayMs === null ? 'Unknown' : `${item.delayMs}ms`;
        const properties = item.properties.length ? item.properties.map(inlineCode).join(', ') : 'Unknown';
        const iterations = item.iterations === null ? 'Unknown' : String(item.iterations);
        lines.push(`| ${markText(item.role)} | ${item.evidence} | ${item.source} | ${properties} | ${duration} | ${delay} | ${inlineCode(item.easing)} | ${iterations} |`);
      }
      lines.push('');
      if (ordered.length > 24) lines.push(`The capture JSON retains ${ordered.length - 24} additional motion records for this viewport.`, '');
    }
    if (snapshots.every(({ motion }) => motion.length === 0)) lines.push('This capture yielded no motion evidence.');
    else lines.push('Declared motion comes from computed CSS. Observed motion was active during sampling. Interaction triggers require separate verification.');
  }

  addHeading(lines, "## Do's and Don'ts");
  const notes = ['- Treat measured layouts as examples at their recorded viewport sizes. Verify any responsive breakpoint with additional evidence.'];
  if (palette.length) notes.push('- Confirm inferred color roles before applying them across additional components.');
  if (snapshots.some(({ motion }) => motion.length)) notes.push('- Recheck interaction behavior with reduced motion enabled.');
  lines.push(...notes, '');
  return lines.join('\n');
}

export function exportCapture(snapshots: CaptureSnapshot | CaptureSnapshot[]): string {
  const list = Array.isArray(snapshots) ? snapshots : [snapshots];
  return JSON.stringify({ version: 1, snapshots: list.map(({ version, context, samples, motion, coverage }) => ({ version, context, samples, motion, coverage })) }, null, 2) + '\n';
}
