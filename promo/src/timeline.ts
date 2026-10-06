/**
 * Every cue of the film, in frames: when a drop lands, a key is pressed, a line appears. The
 * picture draws from these numbers and scripts/soundtrack.ts plays from the same ones, so a
 * sound can never drift from the thing it belongs to.
 *
 * Pure data and pure functions only (no React, no Remotion): Node runs this file as it is.
 */
import { COPY, CUTS, FADE, RIPPLE_ORIGIN, sceneFrames, VIDEO, type CutName, type Lang, type SceneName } from "./config.ts";
import { TERMINAL } from "./data/terminal.ts";

export const sec = (s: number): number => Math.round(s * VIDEO.fps);
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** A number in [0, 1) that depends only on its inputs (the same hash as src/ui/rain.ts). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

/** The three-row BRUINE mark in the `future` FIGlet font (src/ui/logo-motion.ts LOGO). */
export const LOGO = ["┏┓ ┏━┓╻ ╻╻┏┓╻┏━╸", "┣┻┓┣┳┛┃ ┃┃┃┗┫┣╸ ", "┗━┛╹┗╸┗━┛╹╹ ╹┗━╸"] as const;
/** How long a letter cell stays wet before it is the letter, as a share of the whole fill. */
export const WET = 0.09;
/** When the drop reaches a cell, on the 0..1 clock of the fill (the law of wordmarkFrame). */
export const reachedAt = (column: number, row: number): number => 0.14 + hash01(column, row, 11) * 0.5 + row * 0.07;

/** Characters of `text` shown at `frame` when typed from `start` at `cps` characters a second. */
export function typedCount(length: number, frame: number, start: number, cps: number): number {
  return Math.max(0, Math.min(length, Math.floor(((frame - start) / VIDEO.fps) * cps)));
}

/** The frame each character of a typed text appears on. */
export function keyFrames(length: number, start: number, cps: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= length; n += 1) out.push(start + Math.ceil((n / cps) * VIDEO.fps));
  return out;
}

export const SCENES = sceneFrames();
const cutScenes: Partial<Record<CutName, ReturnType<typeof sceneFrames>>> = {};
/** The scenes of a cut, in frames (the full film's are SCENES). */
export function scenesOf(cut: CutName = "full"): ReturnType<typeof sceneFrames> {
  return (cutScenes[cut] ??= sceneFrames(cut));
}

/** Cues inside each scene, in frames from that scene's start. */
export const INTRO = {
  dropStart: sec(0.15),
  dropHit: sec(0.95),
  word: sec(1.15),
  phonetic: sec(1.7),
  definition: sec(2.05),
  entryOut: sec(2.95),
  fillStart: sec(3.1),
  fillEnd: sec(4.8),
  sweep: sec(4.85),
  tagline: sec(5.0),
  sub: sec(5.45),
} as const;

export const MODELS = {
  title: sec(0.12),
  hub: sec(0.08),
  local: sec(0.7),
  chip: (i: number): number => sec(1.0) + i * 6,
  mcp: sec(2.15),
  more: sec(2.35),
  compat: sec(2.85),
  /** Promoted to the subtitle: what matters most about where the model runs. */
  footnote: sec(0.55),
} as const;

/**
 * The demo is the real bruine, recorded cell by cell (src/data/terminal.ts): its cues are the
 * moments the recording saw, so the camera, the captions and every sound land on the frame where
 * the real interface does the thing.
 */
const M = TERMINAL.markers;
/** The recording starts this long after the demo scene does, once the ripple has opened it. */
export const DEMO_LEAD = sec(0.3);
const rec = (seconds: number | undefined): number => DEMO_LEAD + Math.round((seconds ?? 0) * VIDEO.fps);
export const DEMO = {
  typeStart: rec(M.typeStart),
  submit: rec(M.submit),
  thinking: rec(M.thinking),
  thought: rec(M.thought),
  queueTypeStart: rec(M.queueTypeStart),
  queueSubmit: rec(M.queueSubmit),
  readDone: rec(M.readDone),
  approval1: rec(M.approval1),
  approve1: rec(M.approve1),
  editDone: rec(M.editDone),
  approval2: rec(M.approval2),
  approve2: rec(M.approve2),
  bashDone: rec(M.bashDone),
  answer: rec(M.answer),
  queueSent: rec(M.queueSent),
  queueAnswer: rec(M.queueAnswer),
  end: rec(M.end),
} as const;
/** The frame of each key the recording pressed, per typed text. */
export const DEMO_KEYS = {
  prompt: (TERMINAL.keys.prompt ?? []).map(rec),
  queued: (TERMINAL.keys.queued ?? []).map(rec),
} as const;
/** The recording's frame at a frame of the demo scene. */
export const recordingFrame = (frame: number): number =>
  Math.max(0, Math.min(TERMINAL.frames.length - 1, Math.round(((frame - DEMO_LEAD) / VIDEO.fps) * TERMINAL.fps)));
export const CAPTION_AT = [DEMO.thinking, DEMO.queueSubmit, DEMO.approval1, DEMO.approval2, DEMO.answer] as const;

export const EFFORT = {
  title: sec(0.3),
  sub: sec(0.55),
  box: sec(0.6),
  steps: [sec(0.95), sec(1.75), sec(2.55), sec(3.35), sec(4.15)],
  weather: sec(4.65),
} as const;
/** The far flash when the effort reaches max, and its echo. */
export const LIGHTNING = [EFFORT.steps[4] + sec(0.22), EFFORT.steps[4] + sec(0.42)] as const;

export const PROMISES = {
  title: sec(0.3),
  body: sec(0.65),
  row: (i: number): number => sec(1.05) + i * 9,
  bracket: sec(2.2),
} as const;

export const OUTRO = {
  fillStart: sec(0.25),
  fillEnd: sec(1.45),
  sweep: sec(1.55),
  box: sec(1.4),
  installStart: sec(1.7),
  installCps: 40, // "npm install -g @ziamana/bruine" is typed by 2.45s, before the Enter at 2.55s
  enter1: sec(2.55),
  runStart: sec(2.7),
  runCps: 18,
  enter2: sec(3.2),
  line: sec(3.45),
  meta: sec(3.9),
  /** Everything but the commands and the address steps back; the rain eases to a drizzle. */
  calm: sec(5.0),
} as const;

/** Frames after the next scene's start at which its drop lands and the ripple starts. */
export const DROP_LANDS = 2;

/** The scene a transition opens, the frame its drop lands on, and where. */
export function transitions(cut: CutName = "full"): Array<{ scene: SceneName; at: number; x: number; y: number }> {
  const scenes = scenesOf(cut);
  return CUTS[cut].order.slice(1).map((scene) => ({ scene, at: scenes[scene].from + DROP_LANDS, x: RIPPLE_ORIGIN[scene][0], y: RIPPLE_ORIGIN[scene][1] }));
}

/**
 * The weather of the whole film: [frame, level] keys the rain eases between. The effort scene
 * drives it step by step, so the rain there is the one the product shows.
 */
export function rainKeys(cut: CutName = "full"): Array<[number, number]> {
  const s = scenesOf(cut);
  const keys: Array<[number, number]> = [[0, 0]];
  if (s.intro !== undefined) {
    keys.push(
      [s.intro.from + INTRO.dropHit, 0.04],
      [s.intro.from + sec(2.2), 0.3],
      [s.intro.from + INTRO.fillStart + sec(0.3), 0.66],
      [s.intro.from + INTRO.fillEnd + sec(0.4), 0.42],
    );
  }
  if (s.models !== undefined) keys.push([s.models.from + FADE, 0.28]);
  if (s.demo !== undefined) keys.push([s.demo.from + FADE, 0.13], [s.demo.from + s.demo.duration - sec(0.8), 0.13]);
  if (s.effort !== undefined) {
    const e = s.effort.from;
    const levels = [0.28, 0.5, 0.75, 1, 1];
    keys.push([e + EFFORT.steps[0], 0.08], ...EFFORT.steps.map((step, i): [number, number] => [e + step + sec(0.35), levels[i]!]), [e + s.effort.duration - sec(0.5), 1]);
  }
  if (s.promises !== undefined) keys.push([s.promises.from + sec(0.9), 0.22]);
  if (s.outro !== undefined) {
    keys.push([s.outro.from + sec(1), 0.36]);
    // The full film ends calm, in a drizzle; the short one ends on the commands, still raining.
    if (OUTRO.calm + sec(0.9) < s.outro.duration) keys.push([s.outro.from + OUTRO.calm + sec(0.9), 0.1]);
  }
  return keys.sort((x, y) => x[0] - y[0]);
}

const KEYS: Partial<Record<CutName, Array<[number, number]>>> = {};

/** How hard it rains at a frame, 0 to 1, eased between the keys. */
export function rainLevelAt(frame: number, cut: CutName = "full"): number {
  const keys = (KEYS[cut] ??= rainKeys(cut));
  if (frame <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i += 1) {
    const [f1, v1] = keys[i]!;
    if (frame <= f1) {
      const [f0, v0] = keys[i - 1]!;
      const t = (frame - f0) / Math.max(1, f1 - f0);
      return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }
  }
  return keys[keys.length - 1]![1];
}

/** How fast the rain falls at a level (src/ui/rain.ts rainSpeed). */
export const rainSpeed = (level: number): number => 0.35 + 1.5 * clamp01(level);

/** The texts whose keystrokes are heard, for a language. */
export function typedTexts(lang: Lang): { prompt: string; install: string; run: string; queued: string } {
  const copy = COPY[lang];
  return { prompt: copy.demo.prompt, install: copy.outro.install, run: copy.outro.run, queued: copy.demo.queued };
}
