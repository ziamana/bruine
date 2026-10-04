import { appEnv } from "../compat.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { release as osRelease } from "node:os";
/**
 * bruine's palette ("Nuage"): soft sky blues and lavender. 24-bit color when the
 * terminal says so, a 256-color approximation otherwise, and the classic 16 ANSI
 * colors as the last resort (and in tests).
 *
 * The transcript keeps the terminal's own background; only the bottom console
 * band and the prompt band are painted, and only when the terminal can render
 * a background that is not its default. Those surfaces are authored here for a
 * dark terminal and re-derived from the real background once the terminal
 * answers OSC 11 (setTerminalBackdrop), so the band also works on a light or
 * tinted terminal.
 *
 * BRUINE_COLOR=truecolor|256|basic|none forces a depth; NO_COLOR disables color;
 * BRUINE_BG=0 keeps every background transparent.
 */

export type ColorDepth = "truecolor" | "256" | "basic" | "none";

export function detectColorDepth(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  release: string = osRelease(),
): ColorDepth {
  const forced = appEnv("COLOR", env);
  if (forced === "truecolor" || forced === "256" || forced === "basic" || forced === "none") return forced;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none";
  if (appEnv("ASCII", env) === "1") return "basic";
  const ct = (env.COLORTERM ?? "").toLowerCase();
  if (ct === "truecolor" || ct === "24bit") return "truecolor";
  // Windows Terminal and VS Code always render 24-bit color.
  if (env.WT_SESSION !== undefined || env.TERM_PROGRAM === "vscode") return "truecolor";
  if ((env.TERM ?? "").includes("256color")) return "256";
  // The classic Windows console (conhost, no TERM at all) renders 24-bit color since Windows 10
  // build 14931, and 256 colors since 10586; older consoles get the 16 ANSI colors.
  if (platform === "win32" && env.TERM === undefined) {
    const [major, , build] = release.split(".").map(Number);
    if ((major ?? 0) >= 10 && (build ?? 0) >= 14931) return "truecolor";
    if ((major ?? 0) >= 10 && (build ?? 0) >= 10586) return "256";
  }
  return "basic";
}

/** One palette role: its 24-bit value and the 16-color code used as fallback. */
interface Swatch {
  hex: string;
  basic: number;
}

export const NUAGE = {
  sky: { hex: "#7dcfff", basic: 36 },
  skyDeep: { hex: "#4aa8e0", basic: 34 },
  lavender: { hex: "#b4a7ff", basic: 35 },
  mint: { hex: "#8fe3a3", basic: 32 },
  amber: { hex: "#f2cf73", basic: 33 },
  rose: { hex: "#ff7a90", basic: 31 },
  pink: { hex: "#ff9ed2", basic: 35 },
  text: { hex: "#e6e9f2", basic: 37 },
  muted: { hex: "#8a90a6", basic: 90 },
  // 3.20:1 on `surface`, the AA floor for a border or control. It was #5b6178
  // (2.64:1), under the floor, and it drew the editor border and the dock
  // divider. Structure only: anything a user has to read is `muted` (5.10:1).
  faint: { hex: "#676e87", basic: 90 },
  // Painted surfaces (the console band and the prompt band). These are the
  // authored values for a dark terminal; setTerminalBackdrop re-derives them
  // from the background the terminal reports.
  surface: { hex: "#1c2030", basic: 40 },
  chip: { hex: "#262c3f", basic: 40 },
  // Transcript surfaces: muted text remains above 4.5:1 on every block.
  userBlock: { hex: "#152a36", basic: 40 },
  toolOk: { hex: "#152b1e", basic: 40 },
  toolPending: { hex: "#252830", basic: 40 },
  toolErr: { hex: "#3a1820", basic: 40 },
  railActive: { hex: "#afe3ff", basic: 36 },
  railActiveEnd: { hex: "#8fd4ff", basic: 36 },
  railErrorEnd: { hex: "#c04a5e", basic: 31 },
  edge: { hex: "#4aa8e0", basic: 34 },
  onSky: { hex: "#0c2b3d", basic: 30 },
  // The two diff bands, on a NEUTRAL block: an added line and a removed line are
  // the same kind of fact, so they get the same weight. The green is as strong as
  // the red (it used to be so quiet it vanished into a green card).
  addBg: { hex: "#17361f", basic: 40 },
  delBg: { hex: "#3a1820", basic: 40 },
  addFg: { hex: "#b8f0c6", basic: 32 },
  delFg: { hex: "#ffb3c0", basic: 31 },
} satisfies Record<string, Swatch>;

/**
 * The roles setTerminalBackdrop is allowed to override.
 *
 * The two diff bands are in it because they are the loudest surfaces in a
 * transcript: a band that was tuned for a dark terminal and is painted on a light
 * one turns into a bruise.
 */
const PROBED_ROLES = ["surface", "chip", "edge", "userBlock", "toolOk", "toolPending", "toolErr", "addBg", "delBg"] as const;
type ProbedRole = (typeof PROBED_ROLES)[number];

export type PaletteRole = keyof typeof NUAGE;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c: [number, number, number]): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** One sRGB channel, gamma-encoded 0..255, to linear light 0..1. */
function linearize(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luma(c: [number, number, number]): number {
  return 0.2126 * linearize(c[0]) + 0.7152 * linearize(c[1]) + 0.0722 * linearize(c[2]);
}

/** WCAG relative luminance of a hex color. The palette owns the maths for its own roles. */
export function luminance(hex: string): number {
  return luma(rgb(hex));
}

/**
 * WCAG contrast ratio between two hex colors, 1:1 to 21:1. AA asks 4.5:1 for
 * body text and 3:1 for borders, controls and other structural marks, so this
 * is how a role is checked before it is trusted with a job.
 */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Gamma-encoded brightness, 0..1. NOT the WCAG luminance above: this one keeps
 * the sRGB curve, which is what makes 0.5 land on mid gray. It only ever
 * answers "is this terminal light or dark", where the perceived midpoint is the
 * right question and the linear one would move the boundary.
 */
function brightness(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Blend two hex colors; t is clamped to 0..1. Returns "#rrggbb". */
export function blendHex(from: string, to: string, t: number): string {
  return toHex(mix(rgb(from), rgb(to), Math.max(0, Math.min(1, t))));
}

/** What a background role resolves to once the terminal has been asked. */
export type Backdrop = Record<ProbedRole, string>;

/** Where a probed role is pulled from the terminal's background, and how far (0..1). */
type Tint = readonly [target: [number, number, number], strength: number];

/** A cool veil just above a dark background; the transcript blocks keep their authored hue. */
const DARK_TINTS: Record<ProbedRole, Tint> = {
  surface: [[43, 52, 82], 0.62],
  chip: [[58, 68, 102], 0.62],
  edge: [[74, 168, 224], 0.9],
  userBlock: [[24, 52, 70], 0.9],
  toolOk: [[24, 54, 36], 0.9],
  toolPending: [[48, 52, 64], 0.9],
  toolErr: [[74, 28, 38], 0.9],
  // Mirrored: same strength, opposite hue, so a diff reads as two halves of one
  // statement rather than as a deletion with an addition behind it.
  addBg: [[30, 78, 46], 0.9],
  delBg: [[74, 28, 38], 0.9],
};

/** A pale panel just below a light background; the blocks are a light wash of their hue. */
const LIGHT_TINTS: Record<ProbedRole, Tint> = {
  surface: [[214, 221, 238], 0.78],
  chip: [[255, 255, 255], 0.45],
  edge: [[40, 104, 160], 0.85],
  userBlock: [[120, 190, 230], 0.26],
  toolOk: [[110, 200, 140], 0.26],
  toolPending: [[150, 155, 175], 0.24],
  toolErr: [[235, 110, 130], 0.24],
  addBg: [[110, 200, 140], 0.24],
  delBg: [[235, 110, 130], 0.24],
};

/**
 * The surfaces to paint over a terminal whose background is `bg`. On a dark
 * terminal they are a cool veil just above the background; on a light one they
 * are a pale panel just below it, so the band is visible either way and the
 * authored palette is only the fallback for a terminal that never answers.
 */
export function deriveBackdrop(bg: { r: number; g: number; b: number }): Backdrop {
  const base: [number, number, number] = [bg.r, bg.g, bg.b];
  const light = brightness(toHex(base)) > 0.5;
  const tints = light ? LIGHT_TINTS : DARK_TINTS;
  const out = {} as Backdrop;
  for (const role of PROBED_ROLES) {
    const [target, strength] = tints[role];
    // On a light terminal the chip is a brighter panel laid over the surface, not
    // over the background; `surface` is derived first, so it is already in `out`.
    const under = light && role === "chip" ? rgb(out.surface) : base;
    out[role] = toHex(mix(under, target, strength));
  }
  return out;
}

/** Backgrounds probed from the terminal; empty until a reply lands. */
const probed: Partial<Record<ProbedRole, string>> = {};

/** Adopt the terminal's real background (OSC 11) for the painted surfaces. */
export function setTerminalBackdrop(bg?: { r: number; g: number; b: number }): Backdrop | undefined {
  for (const role of PROBED_ROLES) delete probed[role];
  if (bg === undefined) return undefined;
  const next = deriveBackdrop(bg);
  for (const role of PROBED_ROLES) probed[role] = next[role];
  return next;
}

/** The surfaces currently in force (tests reset this with resetColorDepth). */
export function resetTerminalBackdrop(): void {
  for (const role of PROBED_ROLES) delete probed[role];
}

/** Nearest xterm-256 color cube index for an RGB triple. */
export function to256(hex: string): number {
  const [r, g, b] = rgb(hex);
  const q = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const [qr, qg, qb] = [q(r), q(g), q(b)];
  const cube = 16 + 36 * qr + 6 * qg + qb;
  // Grays read better on the dedicated gray ramp.
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    const gray = Math.round(((r + g + b) / 3 - 8) / 10);
    if (gray >= 0 && gray <= 23) return 232 + gray;
  }
  return cube;
}

export function fgCode(role: PaletteRole | string, depth: ColorDepth): string {
  const sw: Swatch = typeof role === "string" && role.startsWith("#") ? { hex: role, basic: 37 } : NUAGE[role as PaletteRole];
  if (depth === "none") return "";
  if (depth === "truecolor") {
    const [r, g, b] = rgb(sw.hex);
    return `\x1b[38;2;${String(r)};${String(g)};${String(b)}m`;
  }
  if (depth === "256") return `\x1b[38;5;${String(to256(sw.hex))}m`;
  return `\x1b[${String(sw.basic)}m`;
}

export function bgCode(role: PaletteRole | string, depth: ColorDepth): string {
  if (typeof role === "string" && role.startsWith("#")) return bgEscape(role, 40, depth);
  const sw: Swatch = NUAGE[role as PaletteRole];
  return bgEscape(probed[role as ProbedRole] ?? sw.hex, sw.basic, depth);
}

function bgEscape(hex: string, basic: number, depth: ColorDepth): string {
  if (depth === "none") return "";
  if (depth === "truecolor") {
    const [r, g, b] = rgb(hex);
    return `\x1b[48;2;${String(r)};${String(g)};${String(b)}m`;
  }
  if (depth === "256") return `\x1b[48;5;${String(to256(hex))}m`;
  return `\x1b[${String(basic + 10)}m`;
}

/** BRUINE_BG=0 (or none/off/false) keeps every background transparent. */
export function bgOptOut(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (appEnv("BG", env) ?? "").toLowerCase();
  return v === "0" || v === "none" || v === "off" || v === "false";
}

/**
 * Whether bruine may paint a background at all. On 16 colors the ANSI background
 * codes are pure black or cyan, which reads as damage rather than as a surface,
 * so every painted surface is dropped there and the app falls back to the
 * terminal's own background.
 */
export function bgEnabled(depth: ColorDepth = colorDepth()): boolean {
  if (bgOptOut()) return false;
  return depth === "truecolor" || depth === "256";
}

let cachedDepth: ColorDepth | undefined;
/** The session's color depth (read once; tests reset it with resetColorDepth). */
export function colorDepth(): ColorDepth {
  cachedDepth ??= detectColorDepth();
  return cachedDepth;
}
export function resetColorDepth(): void {
  cachedDepth = undefined;
  resetTerminalBackdrop();
}

export function paint(role: PaletteRole, s: string): string {
  const d = colorDepth();
  if (d === "none") return s;
  return `${fgCode(role, d)}${s}\x1b[39m`;
}

/** Foreground paint with an explicit hex, for the per-line gradients. */
export function paintHex(hex: string, s: string): string {
  const d = colorDepth();
  if (d === "none") return s;
  return `${fgCode(hex, d)}${s}\x1b[39m`;
}

export function onBg(role: PaletteRole, s: string): string {
  const d = colorDepth();
  if (!bgEnabled(d)) return s;
  return `${bgCode(role, d)}${s}\x1b[49m`;
}

/**
 * Like fillLine, but the tint covers exactly `cells` columns instead of the whole row,
 * so a card can keep the page margins on both sides (tool cards start at their rail).
 */
export function boxLine(role: PaletteRole, line: string, cells: number): string {
  const d = colorDepth();
  const pad = " ".repeat(Math.max(0, cells - visibleWidth(line)));
  if (!bgEnabled(d)) return line + pad;
  const bg = bgCode(role, d);
  const rearmed = line
    .replaceAll("\x1b[49m", `\x1b[49m${bg}`)
    .replaceAll("\x1b[0m", `\x1b[0m${bg}`)
    .replaceAll("\x1b[m", `\x1b[m${bg}`);
  return `${bg}${rearmed}${pad}\x1b[49m`;
}


/**
 * Paint a whole line with `role`'s background, out to the right edge.
 *
 * The caller keeps `line` at least one cell short of the terminal width: the
 * last cell is filled by EL (erase in line), which terminals paint with the
 * current background. Writing a colored space into the final column instead
 * leaves the cursor in the pending-wrap state and makes some terminals eat or
 * double the following line.
 *
 * A nested background (the accent, a footer pill) or a bare SGR reset (pi-tui
 * draws the editor cursor as reverse video followed by `\x1b[0m`) leaves the
 * background back at the terminal default on its way out, which would leave the
 * rest of the line unpainted, EL included. The surface is therefore re-armed
 * after every one of those, which is what makes the band a single color rather
 * than a strip of pills with gaps between them.
 */
export function fillLine(role: PaletteRole, line: string): string {
  const d = colorDepth();
  if (!bgEnabled(d)) return line;
  const bg = bgCode(role, d);
  const rearmed = line
    .replaceAll("\x1b[49m", `\x1b[49m${bg}`)
    .replaceAll("\x1b[0m", `\x1b[0m${bg}`)
    .replaceAll("\x1b[m", `\x1b[m${bg}`);
  return `${bg}${rearmed}${bg}\x1b[K\x1b[49m`;
}

/** Per-character gradient between two hex colors (truecolor only; plain elsewhere). */
export function gradient(s: string, from: string, to: string): string {
  if (colorDepth() !== "truecolor") return paint("sky", s);
  const chars = [...s];
  const [r1, g1, b1] = rgb(from);
  const [r2, g2, b2] = rgb(to);
  const n = Math.max(1, chars.length - 1);
  return (
    chars
      .map((ch, i) => {
        if (ch === " ") return ch;
        const t = i / n;
        const c = (a: number, b: number): number => Math.round(a + (b - a) * t);
        return `\x1b[38;2;${String(c(r1, r2))};${String(c(g1, g2))};${String(c(b1, b2))}m${ch}`;
      })
      .join("") + "\x1b[39m"
  );
}

/**
 * Multi-stop horizontal gradient across a line, shifted by `phase` (0..1) so a
 * light band can travel through it (startup shimmer). Truecolor only; 256 and
 * basic fall back to one sky color.
 */
export function gradientStops(s: string, stops: string[], phase = 0): string {
  if (colorDepth() !== "truecolor") return paint("sky", s);
  const chars = [...s];
  const cols = stops.map(rgb);
  const n = Math.max(1, chars.length - 1);
  return (
    chars
      .map((ch, i) => {
        if (ch === " ") return ch;
        let t = (i / n + phase) % 1;
        if (t < 0) t += 1;
        const seg = t * (cols.length - 1);
        const k = Math.min(cols.length - 2, Math.floor(seg));
        const u = seg - k;
        const a = cols[k]!;
        const b = cols[k + 1]!;
        const c = (x: number, y: number): number => Math.round(x + (y - x) * u);
        return `\x1b[38;2;${String(c(a[0], b[0]))};${String(c(a[1], b[1]))};${String(c(a[2], b[2]))}m${ch}`;
      })
      .join("") + "\x1b[39m"
  );
}
