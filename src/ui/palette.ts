import { appEnv } from "../compat.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { release as osRelease } from "node:os";
import { sharedState } from "../shared-state.js";
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
  // 4.8:1 on `chip`, the brightest dark surface it is read on (it was #8a90a6,
  // 4.37:1 there and 4.41:1 on a One Dark background).
  muted: { hex: "#9298ae", basic: 90 },
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

/**
 * The foreground roles, and the contrast each one owes the surfaces it is read
 * on. The authored values are for a dark terminal; on a light one they start
 * from LIGHT_INK instead, and either way setTerminalBackdrop moves a role
 * towards black or white until it meets its floor, so a terminal with an odd
 * background (One Dark's #282c34, Solarized Light's cream) still reads.
 */
const INK_FLOOR = {
  text: 7,
  muted: 4.5,
  // Structure only (borders, rules, dots): the 3:1 floor for a mark, not text.
  faint: 3,
  sky: 4.5,
  skyDeep: 4.5,
  lavender: 4.5,
  mint: 4.5,
  amber: 4.5,
  rose: 4.5,
  pink: 4.5,
  railActive: 3,
  railActiveEnd: 3,
  railErrorEnd: 3,
  addFg: 4.5,
  delFg: 4.5,
} as const;
type InkRole = keyof typeof INK_FLOOR;
const INK_ROLES = Object.keys(INK_FLOOR) as InkRole[];

/** Where each foreground starts on a light terminal: the same hues, as ink. */
const LIGHT_INK: Record<InkRole, string> = {
  text: "#1d2233",
  muted: "#555c74",
  faint: "#8a90a6",
  sky: "#0a6c9e",
  skyDeep: "#195f93",
  lavender: "#5b45c9",
  mint: "#1d7a3c",
  amber: "#8a5d00",
  rose: "#c02848",
  pink: "#b02a78",
  railActive: "#1678b4",
  railActiveEnd: "#1a6aa3",
  railErrorEnd: "#b0384e",
  addFg: "#145c2a",
  delFg: "#8e1a32",
};

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

/** What a foreground role resolves to once the terminal has been asked. */
export type Ink = Record<InkRole, string>;

/**
 * Move `hex` towards `pole` (black on a light terminal, white on a dark one) in
 * small steps until it meets `floor` against every surface in `under`. The hue
 * is kept as long as possible, which is the point: a lavender that has to
 * darken stays a lavender.
 */
function fit(hex: string, under: readonly string[], floor: number, pole: [number, number, number]): string {
  const start = rgb(hex);
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const candidate = toHex(mix(start, pole, t));
    if (under.every((surface) => contrastRatio(candidate, surface) >= floor)) return candidate;
  }
  return toHex(pole);
}

/**
 * The foregrounds to write on a terminal whose background is `bg`: every role
 * meets its floor on the background and on every painted surface it can sit
 * on, and the two diff inks on their own bands.
 */
export function deriveInk(bg: { r: number; g: number; b: number }, backdrop: Backdrop = deriveBackdrop(bg)): Ink {
  const base = toHex([bg.r, bg.g, bg.b]);
  const light = brightness(base) > 0.5;
  const pole: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255];
  const blocks = [base, backdrop.surface, backdrop.chip, backdrop.userBlock, backdrop.toolOk, backdrop.toolPending, backdrop.toolErr];
  const out = {} as Ink;
  for (const role of INK_ROLES) {
    const start = light ? LIGHT_INK[role] : NUAGE[role].hex;
    const under = role === "addFg" ? [backdrop.addBg] : role === "delFg" ? [backdrop.delBg] : role === "faint" ? [base, backdrop.surface] : blocks;
    out[role] = fit(start, under, INK_FLOOR[role], pole);
  }
  return out;
}

/**
 * What the terminal said about itself, one per process (src/shared-state.ts): the backgrounds
 * probed from it and the foregrounds fitted to them (empty until a reply lands), and its depth.
 */
const state = sharedState("palette", () => ({
  probed: {} as Partial<Record<ProbedRole, string>>,
  inked: {} as Partial<Record<InkRole, string>>,
  depth: undefined as ColorDepth | undefined,
}));
const probed = state.probed;
const inked = state.inked;

/** Adopt the terminal's real background (OSC 11) for the painted surfaces and the ink on them. */
export function setTerminalBackdrop(bg?: { r: number; g: number; b: number }): Backdrop | undefined {
  resetTerminalBackdrop();
  if (bg === undefined) return undefined;
  const next = deriveBackdrop(bg);
  for (const role of PROBED_ROLES) probed[role] = next[role];
  const ink = deriveInk(bg, next);
  for (const role of INK_ROLES) inked[role] = ink[role];
  return next;
}

/** The surfaces currently in force (tests reset this with resetColorDepth). */
export function resetTerminalBackdrop(): void {
  for (const role of PROBED_ROLES) delete probed[role];
  for (const role of INK_ROLES) delete inked[role];
}

/** The hex a role is written in right now: fitted to the terminal once it has answered. */
export function inkHex(role: PaletteRole): string {
  return inked[role as InkRole] ?? NUAGE[role].hex;
}

/** The six levels of each axis of the xterm-256 color cube. */
const CUBE = [0, 95, 135, 175, 215, 255] as const;

function distance(a: [number, number, number], b: [number, number, number]): number {
  // Weighted the way the eye is: green differences count most, blue least.
  return 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;
}

/**
 * Nearest xterm-256 index for a color: the closest of the cube and the 24-step
 * gray ramp. The cube has nothing between black and #00005f, so a dark tinted
 * surface (#1c2030) used to snap to navy and a dark green to #005f00; the gray
 * ramp is what such a surface actually looks like.
 *
 * `hue` keeps the cube for a role whose hue is its meaning (the two diff bands,
 * the error card): a red band that turns gray stops saying "removed".
 */
export function to256(hex: string, hue = false): number {
  const c = rgb(hex);
  const nearest = (v: number): number => {
    let best = 0;
    for (let i = 1; i < CUBE.length; i += 1) if (Math.abs(CUBE[i]! - v) < Math.abs(CUBE[best]! - v)) best = i;
    return best;
  };
  const [qr, qg, qb] = [nearest(c[0]), nearest(c[1]), nearest(c[2])];
  const cube = 16 + 36 * qr + 6 * qg + qb;
  const cubeRgb: [number, number, number] = [CUBE[qr]!, CUBE[qg]!, CUBE[qb]!];
  const level = Math.max(0, Math.min(23, Math.round(((c[0] + c[1] + c[2]) / 3 - 8) / 10)));
  const grayRgb: [number, number, number] = [8 + 10 * level, 8 + 10 * level, 8 + 10 * level];
  const isGray = Math.abs(c[0] - c[1]) < 12 && Math.abs(c[1] - c[2]) < 12;
  if (hue && !isGray) {
    // Keep the hue, but never let a dark band collapse to pure black.
    if (cube === 16) return c[0] >= c[1] && c[0] >= c[2] ? 52 : c[1] >= c[2] ? 22 : 17;
    return cube;
  }
  return distance(c, grayRgb) <= distance(c, cubeRgb) ? 232 + level : cube;
}

/** Background roles whose hue carries meaning, so 256 colors keep it. */
const HUE_ROLES: ReadonlySet<string> = new Set(["addBg", "delBg", "toolErr", "sky", "edge"]);

export function fgCode(role: PaletteRole | string, depth: ColorDepth): string {
  const sw: Swatch =
    typeof role === "string" && role.startsWith("#") ? { hex: role, basic: 37 } : { hex: inkHex(role as PaletteRole), basic: NUAGE[role as PaletteRole].basic };
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
  return bgEscape(probed[role as ProbedRole] ?? sw.hex, sw.basic, depth, HUE_ROLES.has(role));
}

function bgEscape(hex: string, basic: number, depth: ColorDepth, hue = false): string {
  if (depth === "none") return "";
  if (depth === "truecolor") {
    const [r, g, b] = rgb(hex);
    return `\x1b[48;2;${String(r)};${String(g)};${String(b)}m`;
  }
  if (depth === "256") return `\x1b[48;5;${String(to256(hex, hue))}m`;
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

/** The session's color depth (read once; tests reset it with resetColorDepth). */
export function colorDepth(): ColorDepth {
  state.depth ??= detectColorDepth();
  return state.depth;
}
export function resetColorDepth(): void {
  state.depth = undefined;
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
