import type {
  CaptureReply,
  CaptureRequest,
  CaptureSnapshot,
  ElementRole,
  MotionKeyframe,
  MotionSample,
  StyleSample,
} from "./schema";

const visitLimit = 5_000;
const sampleLimit = 360;
const motionLimit = 80;
const captureBudgetMs = 350;
const cssListLengthLimit = 8_192;
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

function topLevelTokens(value: string, separator: "," | " " = ","): string[] {
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
  element: Element, style: CSSStyleDeclaration, rect: DOMRect, role: ElementRole,
): StyleSample {
  return {
    role,
    rect: rectSample(rect),
    color: normalizedColor(style.color),
    backgroundColor: normalizedColor(style.backgroundColor),
    borderColor: firstBorderColor(style),
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

async function capture(documentKey: string): Promise<CaptureSnapshot> {
  const context = captureContext();
  const { width, height } = context;
  const root = document.documentElement;
  const scanner = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => ignoredTags.has((node as Element).localName)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const samples: StyleSample[] = [];
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
        samples.push(styleSample(element, style, rect, role));
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
  function stop(): void {
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
      case "stop-recording":
        reply({ ok: true, type: "stop-recording", documentKey, context: captureContext(), motion: [...(recording?.motion.values() ?? [])] });
        releaseRecording();
        return;
    }
  });
}

install();
