export type ElementRole =
  | "page"
  | "header"
  | "navigation"
  | "main"
  | "section"
  | "footer"
  | "heading"
  | "text"
  | "button"
  | "link"
  | "input"
  | "card"
  | "list"
  | "icon"
  | "media"
  | "container";

export interface StyleSample {
  role: ElementRole;
  rect: { x: number; y: number; width: number; height: number };
  color: string;
  backgroundColor: string;
  borderColor: string;
  fill: string;
  gradient: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  borderRadius: string;
  boxShadow: string;
  padding: string;
  margin: string;
  display: string;
  position: string;
  maxWidth: string;
  gap: string;
  gridColumns: number | null;
  flexDirection: string;
  depth: number;
}

export interface MotionKeyframe {
  offset: number | null;
  easing: string;
  values: Record<string, string>;
}

export interface MotionSample {
  role: ElementRole;
  source: "css-transition" | "css-animation" | "web-animation";
  evidence: "declared" | "observed";
  durationMs: number | null;
  delayMs: number | null;
  easing: string;
  iterations: number | "infinite" | null;
  properties: string[];
  keyframes: MotionKeyframe[];
}

export interface CaptureSnapshot {
  version: 1;
  documentKey: string;
  context: {
    width: number;
    height: number;
    preferredTheme: "light" | "dark";
    reducedMotion: boolean;
  };
  samples: StyleSample[];
  motion: MotionSample[];
  coverage: {
    visited: number;
    sampled: number;
    omittedFrames: number;
    partial: boolean;
  };
}

export type CaptureRequest =
  | { type: "capture" }
  | { type: "start-recording"; durationMs?: number }
  | { type: "stop-recording" };

export type CaptureReply =
  | { ok: true; type: "capture"; snapshot: CaptureSnapshot }
  | { ok: true; type: "start-recording"; documentKey: string; durationMs: number; context: CaptureSnapshot["context"] }
  | { ok: true; type: "stop-recording"; documentKey: string; context: CaptureSnapshot["context"]; motion: MotionSample[] }
  | { ok: false; error: string };
