/** CSS value helpers shared by the in-page collector and the offline analyzer. */

const cssListLengthLimit = 8_192;
const gradientLayer = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

/** Split a CSS list on top-level separators, ignoring separators nested in functions. */
export function topLevelTokens(value: string, separator: ',' | ' ' = ','): string[] {
  if (value.length > cssListLengthLimit) return [];
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") depth++;
    if (character === ")" || character === "]") depth--;
    if (!depth && character === separator) {
      const token = value.slice(start, index).trim();
      if (token) result.push(token);
      start = index + 1;
    }
  }
  const final = value.slice(start).trim();
  if (final) result.push(final);
  return result;
}

function stripStopPosition(part: string): string {
  return part.replace(/(?:^|\s)(?:-?\d*\.?\d+(?:%|deg|grad|rad|turn)|0)$/i, "").trim();
}

/**
 * Color stops of every gradient layer, in declaration order.
 * The first stop of a layer is the one designers reach for when they mean "the brand color".
 */
export function gradientStops(backgroundImage: string): string[][] {
  return topLevelTokens(backgroundImage, ",")
    .filter((layer) => gradientLayer.test(layer))
    .map((layer) => {
      const open = layer.indexOf("(");
      const close = layer.lastIndexOf(")");
      if (open < 0 || close <= open) return [];
      return topLevelTokens(layer.slice(open + 1, close), ",")
        .map(stripStopPosition)
        .filter(Boolean);
    })
    .filter((stops) => stops.length > 0);
}
