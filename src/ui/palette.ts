/**
 * kumo's palette ("Nuage"): soft sky blues and lavender on the terminal's own
 * background. 24-bit color when the terminal says so, a 256-color approximation
 * otherwise, and the classic 16 ANSI colors as the last resort (and in tests).
 *
 * KUMO_COLOR=truecolor|256|basic forces a depth; NO_COLOR disables color.
 */

export type ColorDepth = "truecolor" | "256" | "basic" | "none";

export function detectColorDepth(env: NodeJS.ProcessEnv = process.env): ColorDepth {
  const forced = env.KUMO_COLOR;
  if (forced === "truecolor" || forced === "256" || forced === "basic" || forced === "none") return forced;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none";
  if (env.KUMO_ASCII === "1") return "basic";
  const ct = (env.COLORTERM ?? "").toLowerCase();
  if (ct === "truecolor" || ct === "24bit") return "truecolor";
  // Windows Terminal and VS Code always render 24-bit color.
  if (env.WT_SESSION !== undefined || env.TERM_PROGRAM === "vscode") return "truecolor";
  if ((env.TERM ?? "").includes("256color")) return "256";
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
  faint: { hex: "#5b6178", basic: 90 },
  // Backgrounds (surfaces drawn on top of the terminal background).
  surface: { hex: "#1c2030", basic: 40 },
  chip: { hex: "#262c3f", basic: 40 },
  onSky: { hex: "#0c2b3d", basic: 30 },
} satisfies Record<string, Swatch>;

export type PaletteRole = keyof typeof NUAGE;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
  const sw: Swatch = typeof role === "string" && role.startsWith("#") ? { hex: role, basic: 40 } : NUAGE[role as PaletteRole];
  if (depth === "none") return "";
  if (depth === "truecolor") {
    const [r, g, b] = rgb(sw.hex);
    return `\x1b[48;2;${String(r)};${String(g)};${String(b)}m`;
  }
  if (depth === "256") return `\x1b[48;5;${String(to256(sw.hex))}m`;
  return `\x1b[${String(sw.basic + 10)}m`;
}

let cachedDepth: ColorDepth | undefined;
/** The session's color depth (read once; tests reset it with resetColorDepth). */
export function colorDepth(): ColorDepth {
  cachedDepth ??= detectColorDepth();
  return cachedDepth;
}
export function resetColorDepth(): void {
  cachedDepth = undefined;
}

export function paint(role: PaletteRole, s: string): string {
  const d = colorDepth();
  if (d === "none") return s;
  return `${fgCode(role, d)}${s}\x1b[39m`;
}

export function onBg(role: PaletteRole, s: string): string {
  const d = colorDepth();
  if (d === "none") return s;
  return `${bgCode(role, d)}${s}\x1b[49m`;
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
