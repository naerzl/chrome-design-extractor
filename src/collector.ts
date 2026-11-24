import type {
  CaptureReply,
  CaptureRequest,
  CaptureSnapshot,
  ElementRole,
  MotionKeyframe,
  MotionSample,
  StyleSample,
} from "./schema";
import { gradientStops, topLevelTokens } from "./css-values";
import { colorKey, resolveColor } from "./color";

const visitLimit = 5_000;
const sampleLimit = 360;
const motionLimit = 80;
const captureBudgetMs = 350;
const visibilityOptions: CheckVisibilityOptions = { checkOpacity: true, checkVisibilityCSS: true };

const ariaRoles: Readonly<Record<string, ElementRole>> = {
  banner: "header",
  navigation: "navigation",
  main: "main",
  region: "section",
  contentinfo: "footer",
  heading: "heading",
  button: "button",
  link: "link",
  textbox: "input",
  combobox: "input",
  article: "card",
  list: "list",
  grid: "list",
  img: "media",
};

const tagRoles: Readonly<Record<string, ElementRole>> = {
  html: "page",
  body: "page",
  header: "header",
  nav: "navigation",
  main: "main",
  section: "section",
  aside: "section",
  footer: "footer",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "text",
  label: "text",
  small: "text",
  blockquote: "text",
  button: "button",
  summary: "button",
  a: "link",
  input: "input",
  select: "input",
  textarea: "input",
  article: "card",
  ul: "list",
  ol: "list",
  dl: "list",
  table: "list",
  img: "media",
  picture: "media",
  video: "media",
  audio: "media",
  canvas: "media",
};

const ignoredTags = new Set(["script", "style", "template", "noscript", "iframe", "frame"]);
const visualProperties = new Set([
  "background", "background-color", "background-position", "background-size",
  "border-color", "border-radius", "box-shadow", "clip-path", "color",
  "fill", "filter", "font-size", "font-weight", "gap", "height", "inset",
  "left", "letter-spacing", "line-height", "margin", "max-height", "max-width",
  "min-height", "min-width", "opacity", "padding", "right", "rotate", "scale",
  "stroke", "stroke-dashoffset", "text-shadow", "top", "transform",
  "transform-origin", "translate", "visibility", "width",
]);

function lookup(map: Readonly<Record<string, ElementRole>>, key: string): ElementRole | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function elementRole(element: Element): ElementRole {
  if (element instanceof SVGElement) return "icon";
  const ariaRole = element.getAttribute("role")?.split(/\s+/, 1)[0] ?? "";
  if (element.localName === "input") {
    const type = (element as HTMLInputElement).type;
    if (type === "button" || type === "submit" || type === "reset") return "button";
  }
  return lookup(ariaRoles, ariaRole) ?? lookup(tagRoles, element.localName) ?? "container";
}

function elementDepth(element: Element): number {
  let depth = 0;
  for (let parent = element.parentElement; parent && depth < 24; parent = parent.parentElement) depth++;
  return depth;
}

function overlapsViewport(rect: DOMRect, width: number, height: number): boolean {
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
    && rect.left < width && rect.top < height;
}

function rectSample(rect: DOMRect): StyleSample["rect"] {
  return { x: rounded(rect.x), y: rounded(rect.y), width: rounded(rect.width), height: rounded(rect.height) };
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizedValue(value: string): string {
  // Keep parsed design values independent of resource URLs and arbitrary CSS references.
  if (value.length > 600 || !/^[a-z0-9%.#(),+\-/\s]*$/i.test(value)) return "";
  return /\b(?:url|src|attr|var|image-set|image|paint|element)\s*\(/i.test(value) ? "" : value;
}

function normalizedColor(value: string): string {
  if (!/^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()/i.test(value)) {
    return "";
  }
  return value === "none" ? "" : normalizedValue(value);
}

function hasVisibleColor(value: string): boolean {
  return !!value && value !== "transparent"
    && !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/i.test(value)
    && !/\/\s*0(?:\.0+)?%?\s*\)$/i.test(value);
}

interface Painted {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** The flat color this element paints, or the first stop of its gradient. */
function ownBackground(element: Element, cache: Map<Element, Painted | null>): Painted | null {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const style = getComputedStyle(element);
  const flat = normalizedColor(style.backgroundColor);
  let value: Painted | null = null;
  if (hasVisibleColor(flat)) {
    value = resolveColor(flat);
  } else {
    // A gradient covers the area it paints, so its first stop stands in for the fill.
    const stop = (gradientStops(style.backgroundImage)[0] ?? [])
      .map((value) => normalizedColor(value))
      .map((value) => (value && hasVisibleColor(value) ? resolveColor(value) : null))
      .find((value) => value !== null && value !== undefined);
    if (stop) value = stop;
  }
  cache.set(element, value);
  return value;
}

function composite(top: Painted, bottom: Painted): Painted {
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  const mix = (a: number, b: number) => (a * top.alpha + b * bottom.alpha * (1 - top.alpha)) / alpha;
  return { red: mix(top.red, bottom.red), green: mix(top.green, bottom.green), blue: mix(top.blue, bottom.blue), alpha };
}

function paintHex(color: Painted): string {
  const hex = [color.red, color.green, color.blue]
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const alpha = Math.round(color.alpha * 255);
  return alpha === 255 ? `#${hex}` : `#${hex}${alpha.toString(16).padStart(2, "0").toUpperCase()}`;
}

/**
 * The background a visitor actually sees behind this element: its own fill
 * composited over the nearest painted ancestor.
 */
function backdropOf(element: Element, own: Map<Element, Painted | null>, cache: Map<Element, string>): string {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const fill = ownBackground(element, own);
  let ancestor: Painted | null = null;
  let parent = element.parentElement;
  while (parent) {
    const painted = ownBackground(parent, own);
    if (painted) {
      ancestor = painted;
      break;
    }
    const known = cache.get(parent);
    if (known !== undefined) {
      ancestor = known ? resolveColor(known) : null;
      break;
    }
    parent = parent.parentElement;
  }
  // Nothing painted anywhere means the browser canvas shows through.
  const below = ancestor ?? canvasColor();
  const result = fill ? composite(fill, below) : below;
  const hex = result && result.alpha > 0 ? paintHex(result) : "";
  cache.set(element, hex);
  return hex;
}

function firstBorderColor(style: CSSStyleDeclaration): string {
  for (const edge of ["top", "right", "bottom", "left"]) {
    const color = normalizedColor(style.getPropertyValue(`border-${edge}-color`));
    const kind = style.getPropertyValue(`border-${edge}-style`);
    if (kind !== "none" && kind !== "hidden" && hasVisibleColor(color) &&
        Number.parseFloat(style.getPropertyValue(`border-${edge}-width`)) > 0) return color;
  }
  return "";
}

function gradientLayers(value: string): string {
  return topLevelTokens(value).slice(0, 6)
    .filter((layer) => /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(layer))
    .map(normalizedValue)
    .filter(Boolean)
    .join(", ");
}

function columnCount(trackList: string): number | null {
  const tracks = topLevelTokens(trackList, " ").filter((track) => !track.startsWith("["));
  if (!tracks.length || tracks.some((track) => !/^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(track))) return null;
  return tracks.filter((track) => Number.parseFloat(track) > 0).length || null;
}

function cssFontStack(value: string): string {
  return value.length <= 200 && /^[\p{L}\p{N} _,'".-]*$/u.test(value) ? value : "";
}

function styleSample(
  element: Element, style: CSSStyleDeclaration, rect: DOMRect, role: ElementRole, backdrop: string,
): StyleSample {
  return {
    role,
    rect: rectSample(rect),
    color: normalizedColor(style.color),
    backgroundColor: normalizedColor(style.backgroundColor),
    borderColor: firstBorderColor(style),
    backdrop,
    fill: element instanceof SVGGeometryElement ? normalizedColor(style.fill) : "",
    gradient: gradientLayers(style.backgroundImage),
    fontFamily: cssFontStack(style.fontFamily),
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    borderRadius: style.borderRadius,
    boxShadow: normalizedValue(style.boxShadow),
    padding: style.padding,
    margin: style.margin,
    display: style.display,
    position: style.position,
    maxWidth: style.maxWidth,
    gap: style.gap,
    gridColumns: style.display.includes("grid") ? columnCount(style.gridTemplateColumns) : null,
    flexDirection: style.display.includes("flex") ? style.flexDirection : "",
    depth: elementDepth(element),
  };
}

function normalizedProperty(value: string): string {
  const property = value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
  if (visualProperties.has(property) || property === "all") return property;
  return "";
}

function easingValue(value: string | undefined): string {
  const easing = value?.trim() ?? "";
  return /^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|(?:linear|cubic-bezier|steps)\([\w\s.,%+-]+\))$/.test(easing)
    ? easing : "";
}

function ms(value: string | undefined): number | null {
  if (!value || !/^-?\d*\.?\d+(?:ms|s)$/.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return rounded(value.endsWith("ms") ? parsed : parsed * 1000);
}

function numberValue(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function iterationsValue(value: string | number | undefined): MotionSample["iterations"] {
  if (value === "infinite" || value === Infinity) return "infinite";
  return value === undefined || value === "" ? null : numberValue(Number(value));
}

function cyclic<T>(values: T[], index: number): T | undefined {
  return values[index % values.length];
}

function declarations(style: CSSStyleDeclaration, role: ElementRole): MotionSample[] {
  if (style.animationName === "none" && style.transitionDuration === "0s" && style.transitionDelay === "0s") {
    return [];
  }
  const motions: MotionSample[] = [];
  const transitionDurations = topLevelTokens(style.transitionDuration);
  const transitionDelays = topLevelTokens(style.transitionDelay);
  const transitionEasings = topLevelTokens(style.transitionTimingFunction);
  for (const [index, value] of topLevelTokens(style.transitionProperty).slice(0, 16).entries()) {
    const durationMs = ms(cyclic(transitionDurations, index));
    const delayMs = ms(cyclic(transitionDelays, index));
    const property = normalizedProperty(value);
    if (!property || ((durationMs ?? 0) <= 0 && (delayMs ?? 0) <= 0)) continue;
    motions.push({
      role, source: "css-transition", evidence: "declared", durationMs, delayMs,
      easing: easingValue(cyclic(transitionEasings, index)), iterations: 1,
      properties: [property], keyframes: [],
    });
  }

  const animationDurations = topLevelTokens(style.animationDuration);
  const animationDelays = topLevelTokens(style.animationDelay);
  const animationEasings = topLevelTokens(style.animationTimingFunction);
  const animationIterations = topLevelTokens(style.animationIterationCount);
  for (const [index, name] of topLevelTokens(style.animationName).slice(0, 16).entries()) {
    if (name === "none") continue;
    motions.push({
      role, source: "css-animation", evidence: "declared",
      durationMs: ms(cyclic(animationDurations, index)),
      delayMs: ms(cyclic(animationDelays, index)),
      easing: easingValue(cyclic(animationEasings, index)),
      iterations: iterationsValue(cyclic(animationIterations, index)),
      properties: [], keyframes: [],
    });
  }
  return motions;
}

function effectKeyframes(frames: ComputedKeyframe[]): MotionKeyframe[] {
  const count = Math.min(frames.length, 12);
  return Array.from({ length: count }, (_, index) => {
    const step = count === 1 ? 0 : Math.round(index * (frames.length - 1) / (count - 1));
    const frame = frames[step];
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(frame)) {
      const property = normalizedProperty(key);
      if (!property || typeof value !== "string") continue;
      const css = normalizedValue(value);
      if (css) values[property] = css;
    }
    return {
      offset: numberValue(frame.computedOffset ?? frame.offset ?? undefined),
      easing: easingValue(frame.easing),
      values,
    };
  });
}

function sourceOf(animation: Animation): MotionSample["source"] {
  if (animation instanceof CSSTransition) return "css-transition";
  if (animation instanceof CSSAnimation) return "css-animation";
  return "web-animation";
}

function sampleEffect(animation: Animation, width: number, height: number): MotionSample | null {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect) || !effect.target?.isConnected) return null;
  if (!overlapsViewport(effect.target.getBoundingClientRect(), width, height)) return null;

  const timing = effect.getTiming();
  const keyframes = effectKeyframes(effect.getKeyframes());
  const properties = new Set(keyframes.flatMap((frame) => Object.keys(frame.values)));
  if (animation instanceof CSSTransition) {
    const property = normalizedProperty(animation.transitionProperty);
    if (property) properties.add(property);
  }
  const source = sourceOf(animation);
  const leadingEasing = keyframes[0]?.easing;
  const easing = easingValue(timing.easing);
  return {
    role: elementRole(effect.target),
    source,
    evidence: "observed",
    durationMs: numberValue(typeof timing.duration === "number" ? timing.duration : undefined),
    delayMs: numberValue(timing.delay),
    easing: source !== "web-animation" && easing === "linear" && leadingEasing ? leadingEasing : easing,
    iterations: iterationsValue(timing.iterations),
    properties: [...properties].sort(),
    keyframes,
  };
}

function addMotion(list: Map<string, MotionSample>, sample: MotionSample): void {
  if (list.size >= motionLimit) return;
  const key = JSON.stringify({
    ...sample,
    keyframes: sample.keyframes.map((frame) => ({
      ...frame,
      values: Object.fromEntries(Object.entries(frame.values).sort(([a], [b]) => a.localeCompare(b))),
    })),
  });
  list.set(key, sample);
}

function scanEffects(motion: Map<string, MotionSample>, seen: WeakSet<Animation>): void {
  for (const animation of document.getAnimations().slice(0, 160)) {
    if (seen.has(animation) || motion.size >= motionLimit) continue;
    const sample = sampleEffect(animation, innerWidth, innerHeight);
    if (!sample) continue;
    seen.add(animation);
    addMotion(motion, sample);
  }
}

function captureContext(): CaptureSnapshot["context"] {
  return {
    width: innerWidth,
    height: innerHeight,
    preferredTheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/**
 * The color the browser paints behind a page whose root has no background.
 * Chrome uses white in light mode and a near black in dark mode.
 */
function canvasColor(): Painted {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? { red: 18, green: 18, blue: 18, alpha: 1 } : { red: 255, green: 255, blue: 255, alpha: 1 };
}

function captureThemeColors(element: Element): CaptureSnapshot["themeColors"] {
  const style = getComputedStyle(element);
  function readDeclaration(name: string): string | undefined {
    const value = style.getPropertyValue(name).trim();
    if (CSS.supports("color", value)) return value;
    // Some themes store only the channels and wrap the variable in hsl() at the point of use.
    const hsl = `hsl(${value})`;
    return CSS.supports("color", hsl) ? hsl : undefined;
  }
  const declaration = readDeclaration("--primary");
  if (!declaration) return undefined;
  const foreground = readDeclaration("--primary-foreground");
  const paint = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  if (!paint) return undefined;

  // Resolve color expressions in the document's inherited context, then read sRGB and alpha.
  // The probe is hidden and removed before layout and animation sampling.
  const probe = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
  probe.style.setProperty("display", "none", "important");
  probe.style.setProperty("forced-color-adjust", "none", "important");
  const readColor = (value: string): string | undefined => {
    probe.style.setProperty("color", value, "important");
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = "transparent";
    paint.fillStyle = getComputedStyle(probe).color;
    paint.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = paint.getImageData(0, 0, 1, 1).data;
    return alpha === 255 ? colorKey(`rgb(${red}, ${green}, ${blue})`) ?? undefined : undefined;
  };

  element.append(probe);
  try {
    const primary = readColor(declaration);
    if (!primary) return undefined;
    const onPrimary = foreground && readColor(foreground);
    return { primary, ...(onPrimary ? { onPrimary } : {}) };
  } finally {
    probe.remove();
  }
}

async function capture(documentKey: string): Promise<CaptureSnapshot> {
  const context = captureContext();
  const { width, height } = context;
  const root = document.documentElement;
  const themeColors = captureThemeColors(document.body ?? root);
  const scanner = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => ignoredTags.has((node as Element).localName)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const samples: StyleSample[] = [];
  const ownBackgrounds = new Map<Element, Painted | null>();
  const backdrops = new Map<Element, string>();
  const motion = new Map<string, MotionSample>();
  scanEffects(motion, new WeakSet());
  let element: Element | null = root;
  let visited = 0;
  const deadline = performance.now() + captureBudgetMs;
  while (element && visited < visitLimit && samples.length < sampleLimit && performance.now() < deadline) {
    const rect = element.getBoundingClientRect();
    if (overlapsViewport(rect, width, height) && element.checkVisibility(visibilityOptions)) {
      const style = getComputedStyle(element);
      if (style.visibility === "visible" && Number(style.opacity) > 0) {
        const role = elementRole(element);
        samples.push(styleSample(element, style, rect, role, backdropOf(element, ownBackgrounds, backdrops)));
        if (motion.size < motionLimit) {
          for (const motionSample of declarations(style, role)) addMotion(motion, motionSample);
        }
      }
    }
    visited++;
    element = scanner.nextNode() as Element | null;
    if (visited % 96 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return {
    version: 1, documentKey, context, samples, motion: [...motion.values()],
    ...(themeColors ? { themeColors } : {}),
    coverage: {
      visited,
      sampled: samples.length,
      omittedFrames: document.getElementsByTagName("iframe").length + document.getElementsByTagName("frame").length,
      partial: element !== null,
    },
  };
}

function recordMotion(durationMs: number): { motion: Map<string, MotionSample>; stop: () => void } {
  const motion = new Map<string, MotionSample>();
  const seen = new WeakSet<Animation>();
  const listener = (event: Event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    for (const animation of event.target.getAnimations().slice(0, 32)) {
      if (seen.has(animation)) continue;
      const sample = sampleEffect(animation, innerWidth, innerHeight);
      if (!sample) continue;
      seen.add(animation);
      addMotion(motion, sample);
    }
  };
  const interval = window.setInterval(() => scanEffects(motion, seen), 64);
  const timeout = window.setTimeout(stop, durationMs);
  const visibilityChange = () => { if (document.hidden) stop(); };
  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (!document.hidden) scanEffects(motion, seen);
    window.clearInterval(interval);
    window.clearTimeout(timeout);
    document.removeEventListener("transitionrun", listener, true);
    document.removeEventListener("animationstart", listener, true);
    document.removeEventListener("visibilitychange", visibilityChange);
    window.removeEventListener("pagehide", stop);
  }
  document.addEventListener("transitionrun", listener, true);
  document.addEventListener("animationstart", listener, true);
  document.addEventListener("visibilitychange", visibilityChange);
  window.addEventListener("pagehide", stop);
  scanEffects(motion, seen);
  return { motion, stop };
}

function install(): void {
  const marker = "__designCaptureCollectorInstalled";
  if (Object.hasOwn(globalThis, marker)) return;
  Object.defineProperty(globalThis, marker, { value: true });
  const newDocumentKey = () => Array.from(crypto.getRandomValues(new Uint32Array(3)), (value) => value.toString(36)).join("-");
  let documentKey = newDocumentKey();
  let address = location.href;
  let recording: ReturnType<typeof recordMotion> | undefined;
  let releaseTimer: number | undefined;

  function releaseRecording() {
    window.clearTimeout(releaseTimer);
    recording?.stop();
    recording = undefined;
  }

  chrome.runtime.onMessage.addListener((message: CaptureRequest | undefined, sender, reply: (value: CaptureReply) => void) => {
    if (sender.id !== chrome.runtime.id || !message) return;
    if (location.href !== address) {
      address = location.href;
      documentKey = newDocumentKey();
      releaseRecording();
    }
    switch (message.type) {
      case "capture": {
        const startedAt = address;
        void capture(documentKey).then(
          (snapshot) => reply(startedAt === location.href
            ? { ok: true, type: "capture", snapshot }
            : { ok: false, error: "capture-failed" }),
          () => reply({ ok: false, error: "capture-failed" }),
        );
        return true;
      }
      case "start-recording": {
        releaseRecording();
        const requested = message.durationMs;
        const durationMs = Math.max(1000, Math.min(10_000,
          typeof requested === "number" && Number.isFinite(requested) ? requested : 8000));
        recording = recordMotion(durationMs);
        // Keep the buffer briefly for a panel that receives the timeout late.
        releaseTimer = window.setTimeout(releaseRecording, durationMs + 30_000);
        reply({ ok: true, type: "start-recording", documentKey, durationMs, context: captureContext() });
        return;
      }
      case "stop-recording": {
        const session = recording;
        releaseRecording();
        reply({ ok: true, type: "stop-recording", documentKey, context: captureContext(), motion: [...(session?.motion.values() ?? [])] });
        return;
      }
    }
  });
}

install();
