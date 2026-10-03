import { blendHex, colorDepth, paintHex } from "./palette.js";

/**
 * The prompt's frame shows how hard the model is asked to think, in whatever model it is.
 *
 * `high` is a slow violet shimmer, `xhigh` the same violet moving fast, and `max` every colour
 * of the palette travelling along the frame. Any other effort leaves the frame as it always was.
 * It goes by the name of the effort, which every model that has levels spells the same way, so it
 * is the same for a local template, a cloud provider and the free model.
 */
export type GlowMode = "off" | "slow" | "fast" | "rainbow";

export function glowMode(effort: string | undefined): GlowMode {
  switch ((effort ?? "").trim().toLowerCase()) {
    case "high":
      return "slow";
    case "xhigh":
    case "extra-high":
    case "extra_high":
      return "fast";
    case "max":
    case "maximum":
      return "rainbow";
    default:
      return "off";
  }
}

/** The violet the frame is at rest, deeper and lighter ends of the shimmer. */
const VIOLET_DEEP = "#6f5fd6";
const VIOLET_LIGHT = "#d9d0ff";
/** Palette of the `max` frame: the colours the logo is already made of, plus warm ones. */
const SPECTRUM = ["#7dcfff", "#b4a7ff", "#ff9ed2", "#ffd27d", "#a6e3a1", "#7dcfff"] as const;

/** How long one trip of the shimmer takes, in milliseconds. */
export const GLOW_PERIOD_MS: Record<Exclude<GlowMode, "off">, number> = {
  slow: 4200,
  fast: 900,
  rainbow: 600,
};

/** How many cells it takes the pattern to repeat along the frame. */
const WAVELENGTH = 28;

function spectrum(x: number): string {
  const t = ((x % 1) + 1) % 1 * (SPECTRUM.length - 1);
  const k = Math.min(SPECTRUM.length - 2, Math.floor(t));
  return blendHex(SPECTRUM[k]!, SPECTRUM[k + 1]!, t - k);
}

/** The colour of the frame at a column, at a moment. */
export function glowColor(mode: Exclude<GlowMode, "off">, column: number, timeMs: number): string {
  const phase = column / WAVELENGTH - timeMs / GLOW_PERIOD_MS[mode];
  if (mode === "rainbow") return spectrum(phase);
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
  return blendHex(VIOLET_DEEP, VIOLET_LIGHT, wave);
}

/** Whether the glow can be drawn at all: it needs colour it can blend. */
export function glowDrawable(): boolean {
  const depth = colorDepth();
  return depth === "truecolor" || depth === "256";
}

// An escape sequence is zero width and is carried through untouched.
const ESC = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/y;
const BORDER = new Set(["─", "│", "╭", "╮", "╰", "╯"]);

/**
 * Colours the frame's border cells along a line and leaves everything else alone.
 *
 * `edges` is for a row of the frame's body, where only the first and the last cell are border;
 * for the top and the bottom every border glyph is. Text between them (the working label, a
 * scroll hint) keeps its own colours, and the line comes back with the same text and the same
 * width.
 */
export function tintBorder(line: string, kind: "edges" | "all", mode: Exclude<GlowMode, "off">, timeMs: number): string {
  type Piece = { text: string; border: boolean; column: number };
  const pieces: Piece[] = [];
  let column = 0;
  let at = 0;
  while (at < line.length) {
    ESC.lastIndex = at;
    const esc = ESC.exec(line);
    if (esc !== null) {
      pieces.push({ text: esc[0], border: false, column });
      at += esc[0].length;
      continue;
    }
    const ch = String.fromCodePoint(line.codePointAt(at)!);
    at += ch.length;
    pieces.push({ text: ch, border: BORDER.has(ch), column });
    column += 1;
  }
  const borders = pieces.filter((p) => p.border);
  const chosen = kind === "all" ? borders : [borders[0], borders[borders.length - 1]].filter((p): p is Piece => p !== undefined);
  for (const p of chosen) p.text = paintHex(glowColor(mode, p.column, timeMs), p.text);
  return pieces.map((p) => p.text).join("");
}
