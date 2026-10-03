/**
 * Rain: the one motion the interface is built around.
 *
 * Everything here is a pure function of time and a seed, so a frame is the same wherever it
 * is drawn and tests can pin it. Nothing draws by itself: callers ask for a frame and decide
 * whether motion is allowed (`terminalMotionAllowed`) before they do.
 */

/** A number in [0, 1) that depends only on its inputs: a stable, cheap hash. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 0x100000000;
}

export type RainLayer = "far" | "mid" | "near";

export interface RainCell {
  char: string;
  layer: RainLayer;
}

/** Far drops are small and slow, near ones long and quick: that is all the depth there is. */
const LAYERS: Record<RainLayer, { speed: number; length: number }> = {
  far: { speed: 3.2, length: 1 },
  mid: { speed: 6, length: 1 },
  near: { speed: 10, length: 2 },
};

function glyph(layer: RainLayer, bottom: boolean, ascii: boolean): string {
  if (ascii) return layer === "far" ? "." : layer === "mid" ? "'" : "|";
  if (layer === "far") return "·";
  if (layer === "mid") return "╷";
  return bottom ? "│" : "╎";
}

export interface RainOptions {
  width: number;
  height: number;
  /** Milliseconds since the rain began. */
  time: number;
  /** The share of columns that carry a drop, 0 to 1. */
  density: number;
  seed?: number;
  ascii?: boolean;
}

/** Height rows by width columns: a drop, or nothing. */
export function rainGrid(o: RainOptions): Array<Array<RainCell | undefined>> {
  const width = Math.max(0, Math.floor(o.width));
  const height = Math.max(0, Math.floor(o.height));
  const grid: Array<Array<RainCell | undefined>> = Array.from({ length: height }, () => Array<RainCell | undefined>(width).fill(undefined));
  const density = Math.max(0, Math.min(1, o.density));
  if (width === 0 || height === 0 || density === 0) return grid;
  const seed = o.seed ?? 1;
  const ascii = o.ascii === true;
  for (let column = 0; column < width; column += 1) {
    if (hash01(column, seed, 1) >= density) continue;
    const pick = hash01(column, seed, 2);
    const layer: RainLayer = pick < 0.5 ? "far" : pick < 0.85 ? "mid" : "near";
    const { speed, length } = LAYERS[layer];
    const gap = 3 + Math.floor(hash01(column, seed, 3) * 10);
    const period = height + length + gap;
    const offset = hash01(column, seed, 4) * period;
    const top = Math.floor(((Math.max(0, o.time) / 1000) * speed + offset) % period) - length;
    for (let k = 0; k < length; k += 1) {
      const y = top + k;
      if (y >= 0 && y < height) grid[y]![column] = { char: glyph(layer, k === length - 1, ascii), layer };
    }
  }
  return grid;
}

export type RainInk = Record<RainLayer, (text: string) => string>;

/** One row of cells as text: each drop in its layer's ink, the rest blank. */
export function paintRainRow(row: ReadonlyArray<RainCell | undefined>, ink: RainInk): string {
  let out = "";
  let blanks = 0;
  for (const cell of row) {
    if (cell === undefined) {
      blanks += 1;
      continue;
    }
    if (blanks > 0) out += " ".repeat(blanks);
    blanks = 0;
    out += ink[cell.layer](cell.char);
  }
  return out + " ".repeat(blanks);
}

/**
 * How hard it rains, from the effort the model is asked to think at: a low effort is a drizzle,
 * the highest a downpour. An effort nobody named is a middling rain, never none.
 */
export function effortToRain(effort: string | undefined): number {
  switch ((effort ?? "").toLowerCase()) {
    case "off":
    case "none":
      return 0.12;
    case "minimal":
    case "low":
      return 0.28;
    case "medium":
    case "med":
      return 0.5;
    case "high":
      return 0.75;
    case "xhigh":
    case "max":
    case "maximum":
      return 1;
    default:
      return 0.45;
  }
}

let currentLevel = 0.45;

/** The footer says the effort changed; the waiting labels follow it. */
export function setRainLevel(effort: string | undefined): void {
  currentLevel = effortToRain(effort);
}

export function rainLevel(): number {
  return currentLevel;
}

const DROP_DOTS = ["⠁", "⠂", "⠄", "⡀"] as const;
const DROP_ASCII = ["'", "`", ",", "."] as const;
/**
 * A cell with no drop in it. Never a plain space: a line of text is trimmed and its runs of
 * spaces collapsed on the way to the screen, which would slide the label along as the drops
 * come and go. The braille blank is not whitespace to any of that and draws as nothing.
 */
const DROP_REST = "\u2800";
const DROP_REST_ASCII = ".";

/**
 * Three cells of rain for the waiting labels: each cell is a drop that falls the height of the
 * row (a braille dot sliding down) and then waits. The wait shrinks as the level rises, so a
 * drizzle has a drop or two about and a downpour has all three always falling. Always three
 * cells wide, so the label next to it never moves.
 */
export function dropSpinner(elapsed: number, level: number, ascii = false): string {
  const lv = Math.max(0, Math.min(1, level));
  const fall = 4;
  const cycle = fall + Math.round((1 - lv) * 6);
  const step = Math.floor(Math.max(0, elapsed) / (lv >= 0.75 ? 90 : 120));
  const frames = ascii ? DROP_ASCII : DROP_DOTS;
  let out = "";
  for (let cell = 0; cell < 3; cell += 1) {
    const at = (step + cell * 3) % cycle;
    out += at < fall ? frames[at]! : ascii ? DROP_REST_ASCII : DROP_REST;
  }
  return out;
}

/** How long a ripple lasts, and how long each of its frames. */
export const RIPPLE_MS = 1000;
const RIPPLE_FRAME_MS = 200;

const RIPPLE = [
  "    ·    ",
  "   (·)   ",
  "  (   )  ",
  " (     ) ",
  "(       )",
] as const;

/** A ring spreading from a drop that landed: nine cells, then nothing. */
export function rippleFrame(sinceMs: number, ascii = false): string | undefined {
  if (!(sinceMs >= 0)) return undefined;
  const index = Math.floor(sinceMs / RIPPLE_FRAME_MS);
  const frame = RIPPLE[index];
  if (frame === undefined) return undefined;
  return ascii ? frame.replace("·", ".") : frame;
}
