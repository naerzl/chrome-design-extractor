/**
 * Color resolution used for counting and comparison.
 *
 * A browser hands back the same visual color in different notations depending on
 * how the author wrote it (`rgb(0, 0, 0)`, `lab(1.9 0.28 -5.49)`, `oklab(...)`).
 * Counting those strings separately would split one color into several votes and
 * let an unrelated color win. Everything is resolved to sRGB plus alpha first.
 */

export interface ResolvedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

/** A gamma encoded sRGB byte (0-255) to linear light (0-1). */
function fromSrgb(byteValue: number): number {
  const value = clamp(byteValue / 255);
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Linear light (0-1) to a gamma encoded sRGB byte (0-255). */
function toSrgb(linear: number): number {
  const value = clamp(linear);
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return clamp(Math.round(encoded * 255), 0, 255);
}

/** Keep a value inside the 0-255 byte range. */
function byte(value: number): number {
  return clamp(Math.round(value), 0, 255);
}

function numberOf(part: string | undefined): number | null {
  if (part === undefined) return null;
  const trimmed = part.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(%?)$/.test(trimmed)) return null;
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return null;
  return trimmed.endsWith('%') ? value / 100 : value;
}

/**
 * Lightness on the scale the conversion expects.
 * `lab()` and `lch()` take a percentage on the 0-100 scale, `oklab()` and
 * `oklch()` take a number on the 0-1 scale.
 */
function lightnessOf(part: string | undefined, percentageScale: boolean): number | null {
  const trimmed = part?.trim() ?? "";
  const value = numberOf(trimmed);
  if (value === null) return null;
  if (percentageScale) {
    // Lab lightness is a 0-100 percentage in both the number and the percent form.
    return trimmed.endsWith("%") ? value * 100 : value;
  }
  if (trimmed.endsWith("%")) return value;
  return value > 1 ? value / 100 : value;
}

function angleOf(part: string | undefined): number | null {
  if (part === undefined) return null;
  const trimmed = part.trim();
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(deg|grad|rad|turn)?$/.exec(trimmed);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  switch (match[2]) {
    case "grad": return (value * 360) / 400;
    case "rad": return (value * 180) / Math.PI;
    case "turn": return value * 360;
    default: return value;
  }
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation);
  const l = clamp(lightness);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const table: Array<[number, number, number]> = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = table[sector];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function labToSrgb(lightness: number, a: number, b: number): [number, number, number] {
  // CSS Color 4: Lab is defined against D50, which is adapted to the D65 that sRGB uses.
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const fx3 = fx ** 3;
  const fy3 = fy ** 3;
  const fz3 = fz ** 3;
  // Lab XYZ uses the D50 white point, so scale by its reference white first.
  const x50 = (fx3 > epsilon ? fx3 : (116 * fx - 16) / kappa) * 0.9642956764295677;
  const y50 = (fy3 > epsilon ? fy3 : (116 * fy - 16) / kappa);
  const z50 = (fz3 > epsilon ? fz3 : (116 * fz - 16) / kappa) * 0.8251046025104602;
  // Bradford chromatic adaptation from D50 to the D65 white point that sRGB uses.
  const x = x50;
  const y = y50;
  const z = z50;
  const d65x = x * 0.9554734527042182 + y * -0.023098536874261423 + z * 0.0632593086610217;
  const d65y = x * -0.028369706963208136 + y * 1.0099954580058226 + z * 0.021041398966943008;
  const d65z = x * 0.012314001688319899 + y * -0.020507696433477912 + z * 1.3303659366080753;
  return [
    toSrgb(3.2409699419045226 * d65x - 1.537383177570094 * d65y - 0.4986107602930034 * d65z),
    toSrgb(-0.9692436362808796 * d65x + 1.8759675015077202 * d65y + 0.04155505740717559 * d65z),
    toSrgb(0.05563007969699366 * d65x - 0.20397695888897652 * d65y + 1.0569715142428786 * d65z),
  ];
}

function oklabToSrgb(lightness: number, a: number, b: number): [number, number, number] {
  const long = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const medium = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const short = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = long ** 3;
  const m = medium ** 3;
  const s = short ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function splitAlpha(body: string): { channels: string[]; alpha: number } {
  const slash = body.split(/\s*\/\s*/);
  const parts = slash[0].trim().split(/[\s,]+/).filter(Boolean);
  const alphaPart = slash.length > 1 ? slash[1] : undefined;
  const alpha = alphaPart !== undefined ? numberOf(alphaPart) : undefined;
  return { channels: parts, alpha: alpha === null || alpha === undefined ? 1 : clamp(alpha) };
}

/** Resolve any CSS color the analyzer understands into sRGB plus alpha. */
export function resolveColor(input: string): ResolvedColor | null {
  const color = input.trim().toLowerCase();
  if (!color || color === "none" || color === "transparent") return null;

  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color);
  if (hex) {
    let digits = hex[1];
    if (digits.length < 6) digits = [...digits].map((part) => part.repeat(2)).join("");
    const red = Number.parseInt(digits.slice(0, 2), 16);
    const green = Number.parseInt(digits.slice(2, 4), 16);
    const blue = Number.parseInt(digits.slice(4, 6), 16);
    const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { red, green, blue, alpha };
  }

  const functional = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/.exec(color);
  if (!functional) return null;
  const kind = functional[1];
  const body = functional[2];

  if (kind === "color") {
    const space = body.trim().split(/\s+/)[0];
    const { channels, alpha } = splitAlpha(body);
    if (space === "srgb") {
      const values = channels.slice(1).map(numberOf);
      if (values.length !== 3 || values.some((value) => value === null)) return null;
      const [red, green, blue] = values as number[];
      return { red: byte(red * 255), green: byte(green * 255), blue: byte(blue * 255), alpha };
    }
    if (space === "srgb-linear") {
      const values = channels.slice(1).map(numberOf);
      if (values.length !== 3 || values.some((value) => value === null)) return null;
      const [red, green, blue] = values as number[];
      return { red: toSrgb(red), green: toSrgb(green), blue: toSrgb(blue), alpha };
    }
    if (space === "display-p3") {
      const values = channels.slice(1).map(numberOf);
      if (values.length !== 3 || values.some((value) => value === null)) return null;
      // Display P3 to linear sRGB.
      const [r, g, b] = (values as number[]).map((value) => fromSrgb(value * 255));
      return {
        red: toSrgb(1.2249401 * r - 0.2249404 * g + 0 * b),
        green: toSrgb(-0.0420569 * r + 1.0420571 * g + 0 * b),
        blue: toSrgb(-0.0196376 * r - 0.0786361 * g + 1.0982735 * b),
        alpha,
      };
    }
    return null;
  }

  if (kind === "rgb" || kind === "rgba") {
    const parts = body.trim().split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map((part) => {
      const value = numberOf(part);
      if (value === null) return null;
      return part.trim().endsWith("%") ? value * 255 : value;
    });
    if (channels.some((value) => value === null)) return null;
    const alpha = parts.length > 3 ? numberOf(parts[3]) : 1;
    return {
      red: byte(channels[0] as number),
      green: byte(channels[1] as number),
      blue: byte(channels[2] as number),
      alpha: alpha === null ? 1 : clamp(alpha),
    };
  }

  if (kind === "hsl" || kind === "hsla") {
    const parts = body.trim().split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const hue = angleOf(parts[0]);
    const saturation = numberOf(parts[1]);
    const lightness = numberOf(parts[2]);
    if (hue === null || saturation === null || lightness === null) return null;
    const alpha = parts.length > 3 ? numberOf(parts[3]) : 1;
    const [red, green, blue] = hslToRgb(hue, saturation, lightness);
    return { red: byte(red), green: byte(green), blue: byte(blue), alpha: alpha === null ? 1 : clamp(alpha) };
  }

  if (kind === "hwb") {
    const parts = body.trim().split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    // hwb() takes hue first, then whiteness, then blackness.
    const hue = angleOf(parts[0]);
    const whiteness = numberOf(parts[1]);
    const blackness = numberOf(parts[2]);
    if (whiteness === null || blackness === null || hue === null) return null;
    const alpha = parts.length > 3 ? numberOf(parts[3]) : 1;
    // Once the two achromatic weights cover the color, only grey remains.
    if (whiteness + blackness >= 1) {
      const grey = byte((whiteness / (whiteness + blackness)) * 255);
      return { red: grey, green: grey, blue: grey, alpha: alpha === null ? 1 : clamp(alpha) };
    }
    const base = hslToRgb(hue, 1, 0.5);
    const mix = (channel: number) => channel * (1 - whiteness - blackness) + whiteness * 255;
    return {
      red: byte(mix(base[0])),
      green: byte(mix(base[1])),
      blue: byte(mix(base[2])),
      alpha: alpha === null ? 1 : clamp(alpha),
    };
  }

  const { channels, alpha } = splitAlpha(body);
  if (channels.length !== 3) return null;
  // Lab and Lch use a percentage lightness, Oklab and Oklch a 0-1 number.
  const percentageScale = kind === "lab" || kind === "lch";
  const lightness = lightnessOf(channels[0], percentageScale);
  const second = numberOf(channels[1]);
  const third = numberOf(channels[2]);
  if (lightness === null || second === null || third === null) return null;

  if (kind === "lab") {
    const [red, green, blue] = labToSrgb(lightness, second, third);
    return { red, green, blue, alpha };
  }
  if (kind === "oklab") {
    const [red, green, blue] = oklabToSrgb(lightness, second, third);
    return { red, green, blue, alpha };
  }
  const hue = angleOf(channels[2]);
  if (hue === null) return null;
  const radians = (hue * Math.PI) / 180;
  const a = second * Math.cos(radians);
  const b = second * Math.sin(radians);
  const [red, green, blue] = kind === "lch" ? labToSrgb(lightness, a, b) : oklabToSrgb(lightness, a, b);
  return { red, green, blue, alpha };
}

/** The sRGB hex plus alpha of a color, used as a counting key. */
export function colorKey(input: string): string | null {
  const resolved = resolveColor(input);
  if (!resolved) return null;
  const hex = [resolved.red, resolved.green, resolved.blue]
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const alpha = Math.round(resolved.alpha * 255);
  return alpha === 255 ? `#${hex}` : `#${hex}${alpha.toString(16).padStart(2, "0").toUpperCase()}`;
}

/** Whether a color covers what is behind it. */
export function isOpaqueColor(input: string): boolean {
  const resolved = resolveColor(input);
  return resolved !== null && resolved.alpha >= 0.999;
}
