import type { CaptureSnapshot, ElementRole, StyleSample } from './schema.ts';

export interface PaletteEntry {
  role: string;
  value: string;
  samples: number;
  evidence: 'inferred';
}

export interface TypographyEntry {
  role: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: number | null;
  lineHeight: string;
  letterSpacing: string;
}

export interface DimensionEntry {
  role: string;
  value: string;
  samples: number;
}

export interface LayoutEntry {
  role: ElementRole;
  display: string;
  width: number;
  maxWidth: string;
  gap: string;
  columns: number | null;
  flexDirection: string;
}

export interface DesignAnalysis {
  context: CaptureSnapshot['context'];
  coverage: CaptureSnapshot['coverage'];
  palette: PaletteEntry[];
  typography: TypographyEntry[];
  spacing: DimensionEntry[];
  rounded: DimensionEntry[];
  layout: LayoutEntry[];
  components: Record<string, Record<string, string>>;
  motion: CaptureSnapshot['motion'];
  gradients: string[];
  shadows: string[];
  overview: string;
}

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const colorChannel = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/;
const colorAngle = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|grad|rad|turn)?$/;
const measuredPixels = /^(?:\d+(?:\.\d+)?|\.\d+)px$/;

function hexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0').toUpperCase();
}

function colorAlpha(value: string): number | null {
  if (!colorChannel.test(value)) return null;
  const alpha = Number.parseFloat(value) / (value.endsWith('%') ? 100 : 1);
  return alpha > 0 && alpha <= 1 ? alpha : null;
}

function displayP3InOklab(channels: string, alpha: number): string | null {
  const parts = channels.trim().split(/\s+/);
  if (parts.length !== 3 || parts.some((part) => !colorChannel.test(part))) return null;
  const [red, green, blue] = parts.map((part) => {
    const encoded = Number.parseFloat(part) / (part.endsWith('%') ? 100 : 1);
    const magnitude = Math.abs(encoded);
    return magnitude <= 0.04045 ? encoded / 12.92 : Math.sign(encoded) * ((magnitude + 0.055) / 1.055) ** 2.4;
  });
  if ([red, green, blue].some((component) => !Number.isFinite(component))) return null;

  // Combined linear Display P3 to XYZ D65 and XYZ D65 to LMS matrices from CSS Color 4.
  const long = Math.cbrt(0.4813798527 * red + 0.4621183710 * green + 0.0565017762 * blue);
  const medium = Math.cbrt(0.2288319418 * red + 0.6532168194 * green + 0.1179512388 * blue);
  const short = Math.cbrt(0.0839457523 * red + 0.2241652710 * green + 0.6918889767 * blue);
  const coordinates = [
    0.2104542683 * long + 0.7936177747 * medium - 0.0040720430 * short,
    1.9779985324 * long - 2.4285922420 * medium + 0.4505937096 * short,
    0.0259040425 * long + 0.7827717125 * medium - 0.8086757549 * short,
  ].map((value) => Number(value.toFixed(6)));
  return `oklab(${coordinates.join(' ')}${alpha === 1 ? '' : ` / ${alpha}`})`;
}

/** Normalize values shared by browser computed styles and the stable DESIGN.md format. */
export function normalizeDesignColor(input: string): string | null {
  const color = input.trim().toLowerCase();
  if (color.length > 100) return null;
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(color)) {
    const hex = color.length < 6 ? [...color.slice(1)].map((part) => part.repeat(2)).join('') : color.slice(1);
    if (hex.length === 8 && hex.endsWith('00')) return null;
    return `#${(hex.length === 8 && hex.endsWith('ff') ? hex.slice(0, 6) : hex).toUpperCase()}`;
  }

  const displayP3 = /^color\(display-p3\s+([^/()]+)(?:\/\s*([^/()]+))?\)$/.exec(color);
  if (displayP3) {
    const alpha = colorAlpha(displayP3[2]?.trim() ?? '1');
    return alpha === null ? null : displayP3InOklab(displayP3[1], alpha);
  }

  const rgb = /^rgba?\(([^()]*)\)$/.exec(color)?.[1];
  if (rgb !== undefined) {
    const parts = rgb.trim().split(/[\s,/]+/);
    if (parts.length !== 3 && parts.length !== 4) return null;
    if (parts.some((part) => !decimal.test(part.replace(/%$/, '')))) return null;
    const alpha = colorAlpha(parts[3] ?? '1');
    if (alpha === null) return null;
    const channels = parts.slice(0, 3).map((part) => Number(part.replace(/%$/, '')) * (part.endsWith('%') ? 255 / 100 : 1));
    if (channels.some((part) => part < 0 || part > 255)) return null;
    const encodedAlpha = hexByte(alpha * 255);
    if (encodedAlpha === '00') return null;
    return `#${channels.map(hexByte).join('')}${encodedAlpha === 'FF' ? '' : encodedAlpha}`;
  }

  // Preserve CSSOM color functions accepted by the stable DESIGN.md parser.
  const functional = /^(oklch|oklab|lch|lab|hsl|hsla|hwb)\(([^()]*)\)$/.exec(color);
  if (!functional) return null;
  const [, kind, body] = functional;
  const [channels, alpha = '1', extra] = body.trim().split(/\s*\/\s*/);
  const parts = channels.trim().split(/[,\s]+/);
  const alphaChannel = parts.length === 4 && kind === 'hsla' && !body.includes('/') ? parts.pop() ?? alpha : alpha;
  if (extra !== undefined || parts.length !== 3 || colorAlpha(alphaChannel) === null) return null;
  const angleIndex = kind.endsWith('lch') ? 2 : kind === 'hsl' || kind === 'hsla' || kind === 'hwb' ? 0 : -1;
  return parts.every((part, index) => (index === angleIndex ? colorAngle : colorChannel).test(part)) ? color : null;
}

function singleDimension(value: string): string | null {
  return measuredPixels.test(value) && Number.parseFloat(value) > 0 ? value : null;
}

function usefulCss(value: string, limit = 180): string | null {
  if (!value || value.length > limit || /[\x00-\x1f\x7f<>`\[\]{};]|\burl\s*\(/i.test(value)) return null;
  return value;
}

function groupValues(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
}

function commonColor(samples: StyleSample[], property: 'color' | 'backgroundColor' | 'borderColor' | 'fill') {
  return groupValues(samples.flatMap((sample) => {
    const value = normalizeDesignColor(sample[property]);
    return value ? [value] : [];
  }))[0];
}

function mostCommon<T>(values: T[], key: (value: T) => string): T | undefined {
  const groups = new Map<string, { count: number; value: T }>();
  for (const value of values) {
    const id = key(value);
    const group = groups.get(id);
    if (group) group.count += 1;
    else groups.set(id, { count: 1, value });
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count)[0]?.value;
}

function area(sample: StyleSample, width: number, height: number): number {
  const rect = sample.rect;
  const clippedWidth = Math.max(0, Math.min(width, rect.x + rect.width) - Math.max(0, rect.x));
  const clippedHeight = Math.max(0, Math.min(height, rect.y + rect.height) - Math.max(0, rect.y));
  return clippedWidth * clippedHeight;
}

const regionRoles = new Set<ElementRole>(['page', 'header', 'navigation', 'main', 'section', 'footer', 'card', 'list', 'container']);

function inferPalette(snapshot: CaptureSnapshot, samples: StyleSample[]): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  const add = (role: string, color: [string, number] | undefined) => {
    if (color) entries.push({ role, value: color[0], samples: color[1], evidence: 'inferred' });
  };

  const { width, height } = snapshot.context;
  const sortedRegions = samples.filter((sample) => regionRoles.has(sample.role) && normalizeDesignColor(sample.backgroundColor))
    .sort((a, b) => area(b, width, height) - area(a, width, height));
  const surface = commonColor(samples.filter(({ role }) => role === 'page'), 'backgroundColor')
    ?? commonColor(sortedRegions.slice(0, 3), 'backgroundColor');
  add('surface', surface);

  const bodyText = samples.filter(({ role }) => role === 'text' || role === 'heading');
  add('on-surface', commonColor(bodyText, 'color') ?? commonColor(samples.filter(({ role }) => role === 'page'), 'color'));

  const actions = samples.filter(({ role }) => role === 'button' || role === 'link');
  const filledActions = actions.filter((sample) => {
    const background = normalizeDesignColor(sample.backgroundColor);
    return background && background !== surface?.[0] && background !== normalizeDesignColor(sample.color);
  });
  const actionFill = commonColor(filledActions, 'backgroundColor');
  const ink = entries.find(({ role }) => role === 'on-surface')?.value;
  const actionText = commonColor(actions.filter((sample) => normalizeDesignColor(sample.color) !== ink), 'color');
  add('primary', actionFill ?? actionText);

  if (actionFill) {
    add('on-primary', commonColor(filledActions.filter((sample) => normalizeDesignColor(sample.backgroundColor) === actionFill[0]), 'color'));
  }

  const surfaceAlternatives = sortedRegions.filter((sample) => normalizeDesignColor(sample.backgroundColor) !== surface?.[0]);
  add('surface-container', commonColor(surfaceAlternatives, 'backgroundColor'));
  add('outline', commonColor(samples, 'borderColor'));
  add('icon', commonColor(samples, 'fill'));

  return entries;
}

function typographyOf(sample: StyleSample, role: string): TypographyEntry | null {
  const fontFamily = usefulCss(sample.fontFamily);
  const fontSize = singleDimension(sample.fontSize);
  if (!fontFamily || !fontSize) return null;
  const weight = Number(sample.fontWeight);
  const lineHeight = singleDimension(sample.lineHeight) ?? '';
  const letterSpacing = /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(sample.letterSpacing) ? sample.letterSpacing : '';
  return { role, fontFamily, fontSize, fontWeight: weight >= 1 && weight <= 1000 ? weight : null, lineHeight, letterSpacing };
}

function inferTypography(samples: StyleSample[]): TypographyEntry[] {
  const key = (entry: TypographyEntry) => [entry.fontSize, entry.fontWeight, entry.fontFamily, entry.lineHeight, entry.letterSpacing].join('|');
  const infer = (sampleGroup: StyleSample[], role: string) => {
    const entries = sampleGroup.flatMap((sample) => {
      const entry = typographyOf(sample, role);
      return entry ? [entry] : [];
    });
    return mostCommon(entries, key);
  };
  const headingsBySize = new Map<string, StyleSample[]>();
  for (const sample of samples) {
    if (sample.role !== 'heading' || !singleDimension(sample.fontSize)) continue;
    const matching = headingsBySize.get(sample.fontSize) ?? [];
    matching.push(sample);
    headingsBySize.set(sample.fontSize, matching);
  }
  const headings = Array.from(headingsBySize)
    .sort(([a], [b]) => Number.parseFloat(b) - Number.parseFloat(a))
    .slice(0, 4)
    .map(([, group], index) => infer(group, index === 0 ? 'headline' : `heading-${index + 1}`));
  const body = infer(samples.filter(({ role }) => role === 'text'), 'body')
    ?? infer(samples.filter(({ role }) => role === 'page'), 'body');
  const labels = infer(samples.filter(({ role }) => role === 'button' || role === 'input'), 'label');
  return [...headings, body, labels].filter((entry): entry is TypographyEntry => Boolean(entry));
}

function inferDimensions(samples: StyleSample[], type: 'spacing' | 'rounded'): DimensionEntry[] {
  const values = samples.flatMap((sample) => {
    const source = type === 'spacing' ? `${sample.padding} ${sample.gap} ${sample.margin}` : sample.borderRadius;
    // A single sample contributes at most once to each size.
    return [...new Set(source.split(/\s+/).filter((value) => singleDimension(value) && (type === 'rounded' || Number.parseFloat(value) <= 192)))];
  });
  return groupValues(values).slice(0, 6)
    .sort(([a], [b]) => Number.parseFloat(a) - Number.parseFloat(b))
    .map(([value, count]) => ({ role: `${type}-${Number.parseFloat(value).toString().replace('.', '-')}`, value, samples: count }));
}

function inferLayout(snapshot: CaptureSnapshot, samples: StyleSample[]): LayoutEntry[] {
  const { width, height } = snapshot.context;
  const ordered = samples.filter((sample) =>
    ['header', 'navigation', 'main', 'section', 'list', 'footer'].includes(sample.role)
    || /grid|flex/.test(sample.display))
    .sort((a, b) => {
      const priority = (sample: StyleSample) => (sample.role === 'main' ? 3 : sample.gridColumns ? 2 : sample.role === 'navigation' ? 1 : 0);
      return priority(b) - priority(a) || area(b, width, height) - area(a, width, height);
    });
  const seen = new Set<string>();
  const result: LayoutEntry[] = [];
  for (const sample of ordered) {
    const entry: LayoutEntry = {
      role: sample.role,
      display: /^(?:inline-)?(?:flex|grid|block)$/.test(sample.display) ? sample.display : '',
      width: Math.round(sample.rect.width),
      maxWidth: singleDimension(sample.maxWidth) ?? '',
      gap: sample.gap.split(/\s+/).filter(singleDimension).slice(0, 2).join(' '),
      columns: sample.gridColumns,
      flexDirection: /^(?:row|column)(?:-reverse)?$/.test(sample.flexDirection) ? sample.flexDirection : '',
    };
    if (entry.width <= 0 || !entry.display) continue;
    const key = [entry.role, entry.display, entry.maxWidth, entry.gap, entry.columns, entry.flexDirection].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
    if (result.length >= 8) break;
  }
  return result;
}

function inferComponents(samples: StyleSample[], palette: PaletteEntry[], rounded: DimensionEntry[]): DesignAnalysis['components'] {
  const components: DesignAnalysis['components'] = {};
  for (const role of ['button', 'input', 'card'] as const) {
    const roleSamples = samples.filter((sample) => sample.role === role);
    const sample = mostCommon(roleSamples, (value) => [value.backgroundColor, value.color, value.borderRadius, value.padding, Math.round(value.rect.height)].join('|'));
    if (!sample) continue;
    const background = normalizeDesignColor(sample.backgroundColor);
    const text = normalizeDesignColor(sample.color);
    const radius = singleDimension(sample.borderRadius);
    const padding = singleDimension(sample.padding);
    const component: Record<string, string> = {};
    const primary = palette.find((entry) => entry.role === 'primary' && entry.value === background);
    const backgroundToken = primary ?? palette.find((entry) => entry.value === background);
    const foregroundToken = palette.find((entry) => entry.role === (primary ? 'on-primary' : 'on-surface') && entry.value === text);
    const roundingToken = rounded.find((entry) => entry.value === radius);

    if (background) component.backgroundColor = backgroundToken ? `{colors.${backgroundToken.role}}` : background;
    if (text) component.textColor = foregroundToken ? `{colors.${foregroundToken.role}}` : text;
    if (radius) component.rounded = roundingToken ? `{rounded.${roundingToken.role}}` : radius;
    if (padding) component.padding = padding;
    if (role !== 'card') component.height = `${Math.round(sample.rect.height)}px`;
    if (Object.keys(component).length) components[role === 'button' && primary ? 'button-primary' : role] = component;
  }
  return components;
}

function uniqueMotion(samples: CaptureSnapshot['motion']): CaptureSnapshot['motion'] {
  const byEffect = new Map<string, CaptureSnapshot['motion'][number]>();
  for (const sample of samples) {
    const key = JSON.stringify({
      ...sample,
      keyframes: sample.keyframes.map((frame) => ({
        ...frame, values: Object.entries(frame.values).sort(([a], [b]) => a.localeCompare(b, 'en')),
      })),
    });
    if (!byEffect.has(key)) byEffect.set(key, sample);
  }
  return [...byEffect.values()];
}

export function analyzeSnapshot(snapshot: CaptureSnapshot): DesignAnalysis {
  const samples = snapshot.samples.filter((sample) => sample.rect.width > 0 && sample.rect.height > 0);
  const palette = inferPalette(snapshot, samples);
  const typography = inferTypography(samples);
  const spacing = inferDimensions(samples, 'spacing');
  const rounded = inferDimensions(samples, 'rounded');
  const layout = inferLayout(snapshot, samples);
  const components = inferComponents(samples, palette, rounded);
  const motion = uniqueMotion(snapshot.motion);
  const gradients = groupValues(samples.flatMap((sample) => usefulCss(sample.gradient, 360) ? [sample.gradient] : []))
    .slice(0, 3).map(([value]) => value);
  const shadows = groupValues(samples.flatMap((sample) => sample.boxShadow !== 'none' && usefulCss(sample.boxShadow) ? [sample.boxShadow] : []))
    .slice(0, 3).map(([value]) => value);

  const markers = [
    palette.find(({ role }) => role === 'surface')?.value,
    typography.find(({ role }) => role === 'headline')?.fontFamily,
    layout.some((entry) => entry.columns && entry.columns > 1) ? 'a multicolumn grid' : null,
    gradients.length ? 'gradient treatments' : null,
    shadows.length ? 'visible elevation' : null,
  ].filter(Boolean);
  const overview = markers.length ? `Visible design traits include ${markers.join(', ')}.` : 'This snapshot has limited visual evidence.';

  return { context: snapshot.context, coverage: snapshot.coverage, palette, typography, spacing, rounded, layout, components, motion, gradients, shadows, overview };
}
