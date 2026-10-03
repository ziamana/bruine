/**
 * The logo's entrances: one pure function of time per effect. A frame is three rows of cells,
 * each cell a character and how it should be coloured; the last frame of every effect is the
 * logo exactly as the banner draws it, so the hand-off is invisible.
 */

import { LOGO } from "./logo-motion.js";
import { hash01 } from "./rain.js";
const H = LOGO.length;
const W = LOGO[0].length;

export type Tone = "base" | "dim" | "mist" | "accent" | "bright" | "rainbow";
export interface Cell { ch: string; tone: Tone; hue?: number }
export type Frame = Cell[][];

const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x));
const easeOut = (x: number): number => 1 - (1 - clamp(x)) ** 3;
const easeIn = (x: number): number => clamp(x) ** 3;
const smooth = (x: number): number => { const t = clamp(x); return t * t * (3 - 2 * t); };

const blank = (): Cell => ({ ch: " ", tone: "base" });
const empty = (): Frame => Array.from({ length: H }, () => Array.from({ length: W }, blank));
const target = (r: number, c: number): string => LOGO[r]![c]!;
const lit = (r: number, c: number, tone: Tone = "base"): Cell => ({ ch: target(r, c), tone });
const final = (): Frame => Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (target(r, c) === " " ? blank() : lit(r, c))));
export const finalFrame = final;

export interface Effect {
  id: string;
  label: string;
  /** How long it takes, in milliseconds. */
  ms: number;
  /** How often it is picked among the others. */
  weight: number;
  frame(t: number, seed: number): Frame;
}

const letters = (): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < H; r += 1) for (let c = 0; c < W; c += 1) if (target(r, c) !== " ") out.push([r, c]);
  return out;
};
const LETTERS = letters();

/** Drizzle: a drop falls into each column, and the cell it reaches is wetted (░ ▒ ▓) and fills in. */
function rain(t: number, seed: number): Frame {
  const f = empty();
  for (let c = 0; c < W; c += 1) {
    const rows = [0, 1, 2].filter((r) => target(r, c) !== " ");
    if (rows.length === 0) continue;
    const reached = 0.1 + hash01(c, 1, seed) * 0.55;
    const top = rows[0]!;
    if (t < reached) {
      // The drop: it falls through the blank cells above the letter, then waits as a dot.
      const fall = clamp(t / reached);
      const y = Math.min(top, Math.floor(fall * (top + 1)));
      if (t > 0.02 && (c + Math.floor(t * 30)) % 2 === 0) f[y]![c] = { ch: y < top ? "╷" : "·", tone: "accent" };
      continue;
    }
    for (const r of rows) {
      const into = (t - reached - r * 0.07) / 0.1;
      if (into < 0) { f[r]![c] = { ch: "·", tone: "mist" }; continue; }
      f[r]![c] = into < 1 / 3 ? { ch: "░", tone: "mist" } : into < 2 / 3 ? { ch: "▒", tone: "mist" } : into < 1 ? { ch: "▓", tone: "accent" } : lit(r, c);
    }
  }
  return f;
}

const SCRAMBLE = ["░", "▒", "▓", "╷", "│", "╎", "·", "▀", "▄", "█"];
/** Decrypt: every letter cell is rain glyphs flickering until it locks onto its letter. */
function decrypt(t: number, seed: number): Frame {
  const f = empty();
  for (const [r, c] of LETTERS) {
    const lock = 0.25 + hash01(c, r, seed) * 0.6;
    if (t >= lock) { f[r]![c] = lit(r, c, t < lock + 0.06 ? "bright" : "base"); continue; }
    const flick = SCRAMBLE[Math.floor(hash01(c, r, Math.floor(t * 22) + seed * 31) * SCRAMBLE.length)]!;
    f[r]![c] = { ch: flick, tone: lock - t < 0.12 ? "accent" : "dim" };
  }
  return f;
}

/** Beams: a bright line sweeps across, lighting each column it passes, then each row is swept. */
function beams(t: number): Frame {
  const f = empty();
  const sweep = clamp(t / 0.6);
  const x = sweep * (W + 2) - 1;
  for (const [r, c] of LETTERS) if (c < x - 1) f[r]![c] = lit(r, c);
  if (t < 0.6) {
    for (let r = 0; r < H; r += 1) {
      const c = Math.round(x);
      if (c >= 0 && c < W) f[r]![c] = { ch: target(r, c) === " " ? "│" : target(r, c), tone: "bright" };
    }
  } else {
    const row = Math.floor(((t - 0.6) / 0.4) * (H + 1)) - 1;
    for (const [r, c] of LETTERS) f[r]![c] = lit(r, c, r === row ? "bright" : "base");
  }
  return t >= 1 ? final() : f;
}

/** Wipe: a diagonal edge reveals the logo from the top-left to the bottom-right. */
function wipe(t: number): Frame {
  const f = empty();
  const p = easeOut(t / 0.9) * (W + 2 * H + 4);
  for (const [r, c] of LETTERS) {
    const d = c + 2 * r;
    if (d < p - 3) f[r]![c] = lit(r, c);
    else if (d < p) f[r]![c] = { ch: "▒", tone: "accent" };
  }
  return t >= 0.9 ? final() : f;
}

/** Slide: each row comes in from the side, alternating, and settles. */
function slide(t: number): Frame {
  const f = empty();
  for (let r = 0; r < H; r += 1) {
    const k = easeOut((t - r * 0.1) / 0.65);
    const dir = r % 2 === 0 ? 1 : -1;
    const offset = Math.round((1 - k) * (W + 4) * dir);
    for (let c = 0; c < W; c += 1) {
      if (target(r, c) === " ") continue;
      const x = c + offset;
      if (x >= 0 && x < W) f[r]![x] = lit(r, c, k < 1 ? "accent" : "base");
    }
  }
  return t >= 0.85 ? final() : f;
}

/** Blackhole: the letters are pulled into one point, it flashes, and they burst back out. */
function blackhole(t: number): Frame {
  const f = empty();
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  for (const [r, c] of LETTERS) {
    let k: number;
    if (t < 0.4) k = 1 - easeIn(t / 0.4);
    else if (t < 0.5) k = 0;
    else k = easeOut((t - 0.5) / 0.5);
    const x = Math.round(cx + (c - cx) * k);
    const y = Math.round(cy + (r - cy) * k);
    const settled = k >= 1 && t >= 0.5;
    if (y >= 0 && y < H && x >= 0 && x < W) f[y]![x] = { ch: settled ? target(r, c) : k < 0.5 ? "·" : target(r, c), tone: settled ? "base" : t < 0.4 ? "dim" : "bright" };
  }
  if (t >= 0.38 && t < 0.52) f[1]![Math.round(cx)] = { ch: t < 0.46 ? "●" : "◉", tone: "bright" };
  return t >= 1 ? final() : f;
}

/** Spotlights: two pools of light travel across the dark logo, then the light spreads to all of it. */
function spotlights(t: number): Frame {
  const f = empty();
  const spread = 4 + 40 * smooth((t - 0.55) / 0.4);
  for (const [r, c] of LETTERS) {
    let inLight = false;
    for (let k = 0; k < 2; k += 1) {
      const x = (W + 12) * ((t * 1.1 + k * 0.5) % 1) - 6;
      const dx = c - x;
      const dy = (r - 1) * 2.2;
      if (dx * dx + dy * dy < spread * spread) inLight = true;
    }
    f[r]![c] = inLight ? lit(r, c, t < 0.95 ? "bright" : "base") : { ch: target(r, c), tone: "dim" };
  }
  return t >= 1 ? final() : f;
}

/** Waves: the rows ripple sideways, the swing dying away until they lie still. */
function waves(t: number): Frame {
  const f = empty();
  const amp = 4 * (1 - smooth(t / 0.95));
  for (let r = 0; r < H; r += 1) {
    const off = Math.round(amp * Math.sin(2 * Math.PI * (t * 2.2 - r / 3)));
    for (let c = 0; c < W; c += 1) {
      if (target(r, c) === " ") continue;
      const x = c + off;
      if (x >= 0 && x < W) f[r]![x] = lit(r, c, amp > 0.5 ? "accent" : "base");
    }
  }
  return t >= 0.95 ? final() : f;
}

/** Fog on a window: vapour covers the logo and a wipe clears it from the left, drops running down. */
function fog(t: number, seed: number): Frame {
  const f = empty();
  const p = easeOut(t / 0.85) * (W + 4);
  for (const [r, c] of LETTERS) {
    if (c < p - 2) f[r]![c] = lit(r, c);
    else if (c < p) f[r]![c] = { ch: "▒", tone: "mist" };
    else f[r]![c] = { ch: hash01(c, r, seed) < 0.5 ? "░" : "▒", tone: "mist" };
  }
  // a drop running down the cleared glass
  for (let k = 0; k < 3; k += 1) {
    const c = Math.floor(hash01(k, 7, seed) * Math.max(1, p - 3));
    const y = Math.floor(((t * 3 + k * 0.37) % 1) * H);
    if (c >= 0 && c < p - 3 && target(y, c) === " ") f[y]![c] = { ch: "╷", tone: "accent" };
  }
  return t >= 0.85 ? final() : f;
}

/** Mist: a fog drifts across and thins until the logo stands clear. */
function mist(t: number, seed: number): Frame {
  const f = empty();
  const density = 1 - smooth((t - 0.1) / 0.8);
  const drift = Math.floor(t * W * 1.4);
  for (const [r, c] of LETTERS) {
    const veil = hash01((c + drift) % W, r, seed) < density;
    f[r]![c] = veil ? { ch: hash01(c, r, 5) < 0.5 ? "░" : "▒", tone: "mist" } : lit(r, c);
  }
  return t >= 0.95 ? final() : f;
}

/** After the rain: the logo is dim, and a band of colour sweeps through it, leaving it lit. */
function afterRain(t: number): Frame {
  const f = empty();
  const x = (t / 0.9) * (W + 12) - 6;
  for (const [r, c] of LETTERS) {
    const d = c - x;
    f[r]![c] = d > 5 ? { ch: target(r, c), tone: "dim" } : d > -5 ? { ch: target(r, c), tone: "rainbow", hue: clamp(0.5 - d / 10) } : lit(r, c);
  }
  return t >= 0.9 ? final() : f;
}

/** A storm far off: the logo is dark, a flash lights it for a moment, then it settles. */
function storm(t: number): Frame {
  const f = empty();
  for (const [r, c] of LETTERS) {
    const flash = (t > 0.28 && t < 0.34) || (t > 0.4 && t < 0.43);
    const after = t >= 0.43;
    // A distant rumble first: the dark logo flickers a little before the light comes.
    const rumble = t > 0.12 && t < 0.22 && Math.floor(t * 50) % 2 === 0;
    f[r]![c] = flash ? { ch: "█", tone: "bright" } : after ? lit(r, c, t < 0.6 ? "bright" : "base") : { ch: target(r, c), tone: rumble ? "mist" : "dim" };
  }
  return t >= 0.7 ? final() : f;
}

export const EFFECTS: Effect[] = [
  { id: "rain", label: "Bruine", ms: 1700, weight: 10, frame: rain },
  { id: "decrypt", label: "Decryptage", ms: 1700, weight: 10, frame: decrypt },
  { id: "beams", label: "Faisceaux", ms: 1500, weight: 10, frame: (t) => beams(t) },
  { id: "wipe", label: "Essuyage", ms: 1300, weight: 10, frame: (t) => wipe(t) },
  { id: "slide", label: "Glissade", ms: 1400, weight: 10, frame: (t) => slide(t) },
  { id: "blackhole", label: "Trou noir", ms: 1900, weight: 10, frame: (t) => blackhole(t) },
  { id: "spotlights", label: "Projecteurs", ms: 2000, weight: 10, frame: (t) => spotlights(t) },
  { id: "waves", label: "Vagues", ms: 1700, weight: 10, frame: (t) => waves(t) },
  { id: "fog", label: "Buee", ms: 1700, weight: 10, frame: fog },
  { id: "mist", label: "Brume", ms: 1800, weight: 10, frame: mist },
  { id: "afterrain", label: "Apres la pluie", ms: 1500, weight: 2, frame: (t) => afterRain(t) },
  { id: "storm", label: "Orage", ms: 1500, weight: 1, frame: (t) => storm(t) },
];

/** The drop between two scenes: it falls through the rows, and a ring spreads and clears the first. */
export function dropTransition(t: number, from: Frame): Frame {
  const f = from.map((row) => row.map((cell) => ({ ...cell })));
  const cx = Math.floor(W / 2);
  const fall = clamp(t / 0.4);
  if (t < 0.4) {
    const y = Math.min(H - 1, Math.floor(fall * H));
    f[y]![cx] = { ch: y === H - 1 ? "●" : "╷", tone: "bright" };
    return f;
  }
  const radius = ((t - 0.4) / 0.6) * (W / 2 + 2);
  for (let r = 0; r < H; r += 1) {
    for (let c = 0; c < W; c += 1) {
      const d = Math.abs(c - cx);
      if (d < radius - 1) f[r]![c] = blank();
      else if (d < radius && r === 1) f[r]![c] = { ch: c < cx ? "(" : ")", tone: "accent" };
    }
  }
  return f;
}
export const DIMENSIONS = { W, H };
