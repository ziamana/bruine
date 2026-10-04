import { sharedState } from "../shared-state.js";
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
 * the highest a downpour. Every named effort has its own level, so stepping from high to xhigh to
 * max is always seen. An effort nobody named is a middling rain, never none.
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
      return 0.7;
    case "xhigh":
    case "extra-high":
    case "extra_high":
      return 0.86;
    case "max":
    case "maximum":
      return 1;
    default:
      return 0.45;
  }
}

/** The effort that brings the storm: the chat weather adds its distant lightning at this level. */
export function effortIsStorm(effort: string | undefined): boolean {
  const name = (effort ?? "").toLowerCase();
  return name === "max" || name === "maximum";
}

/** The effort in use, one per process: the shell sets it, every plugin's copy reads it. */
const effortState = sharedState("effort", () => ({ level: 0.45, effort: undefined as string | undefined }));

/** The footer says the effort changed; the waiting labels (and the prompt's glow) follow it. */
export function setRainLevel(effort: string | undefined): void {
  effortState.level = effortToRain(effort);
  effortState.effort = effort;
}

/** The effort in use, as the footer last said it; undefined until it said. */
export function currentEffortName(): string | undefined {
  return effortState.effort;
}

export function rainLevel(): number {
  return effortState.level;
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
  // The wait between drops shrinks and the drops quicken as the rain gets heavier, on a
  // continuous scale, so every effort level has its own rhythm.
  const cycle = fall + Math.round((1 - lv) * 7);
  const step = Math.floor(Math.max(0, elapsed) / (140 - 60 * lv));
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

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** How fast the rain falls at a level: a calm drizzle crawls, a downpour streaks. */
export function rainSpeed(level: number): number {
  return 0.35 + 1.5 * clamp01(level);
}

/**
 * The weather of a screen: how hard it rains, easing from one level to the next.
 *
 * A level is set (by the option under the cursor, or by how far through the setup one is) and
 * the rain follows it over a fraction of a second, so the drops speed up or slow down instead of
 * jumping. The clock the rain runs on is not wall time but the sum of the time that passed,
 * each slice scaled by the speed it passed at: slowing the rain slows the drops already falling.
 */
export class Weather {
  #level: number;
  #target: number;
  #phase = 0;
  #at: number | undefined;

  constructor(initial = 0.7, private readonly now: () => number = Date.now) {
    this.#level = this.#target = clamp01(initial);
  }

  /** Where the rain is heading. */
  set(target: number): void {
    this.#target = clamp01(target);
  }

  get target(): number {
    return this.#target;
  }

  #advance(): void {
    const t = this.now();
    if (this.#at === undefined) {
      this.#at = t;
      return;
    }
    const dt = Math.max(0, Math.min(250, t - this.#at));
    this.#at = t;
    this.#level += (this.#target - this.#level) * (1 - Math.exp(-dt / 220));
    this.#phase += dt * rainSpeed(this.#level);
  }

  /** The level right now, between the one it left and the one it is heading for. */
  get level(): number {
    this.#advance();
    return this.#level;
  }

  /** The rain's own clock, in milliseconds of rain. */
  get phase(): number {
    this.#advance();
    return this.#phase;
  }

  /** The share of columns that carry a drop in the margins. */
  get margin(): number {
    return 0.1 + 0.38 * this.level;
  }

  /** The share of columns that carry a drop behind the panel, in its blank cells: far fainter. */
  get interior(): number {
    return 0.02 + 0.06 * this.level;
  }
}

// An escape sequence is zero width: a colour, a link, the cursor marker.
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/y;

/**
 * Draws drops into the empty stretches of a line, and nowhere else.
 *
 * A drop only ever replaces a space that sits inside a run of at least `minRun` spaces, and never
 * the first or the last of the run, so the gap between two words and the padding against a border
 * are never touched: only the open air of a panel. A line that holds the cursor is left alone
 * entirely, so a field being typed in is never disturbed. Everything else (colours, links,
 * the widths) comes through unchanged, which is why this walks the string instead of
 * rebuilding it.
 */
export function rainIntoBlanks(
  line: string,
  cells: ReadonlyArray<RainCell | undefined>,
  ink: RainInk,
  skipIf: string,
  minRun = 5,
): string {
  if (skipIf !== "" && line.includes(skipIf)) return line;
  type Piece = { text: string; col: number; space: boolean };
  const pieces: Piece[] = [];
  let col = 0;
  let at = 0;
  while (at < line.length) {
    ESCAPES.lastIndex = at;
    const esc = ESCAPES.exec(line);
    if (esc !== null) {
      pieces.push({ text: esc[0], col, space: false });
      at += esc[0].length;
      continue;
    }
    const ch = String.fromCodePoint(line.codePointAt(at)!);
    at += ch.length;
    const width = ch === " " ? 1 : ch.charCodeAt(0) < 0x20 ? 0 : [...ch].length === 1 && ch.codePointAt(0)! < 0x2e80 ? 1 : 2;
    pieces.push({ text: ch, col, space: ch === " " });
    col += width;
  }
  // Runs of spaces, with escapes allowed in between.
  let i = 0;
  while (i < pieces.length) {
    if (!pieces[i]!.space) {
      i += 1;
      continue;
    }
    const run: number[] = [];
    let j = i;
    while (j < pieces.length && (pieces[j]!.space || (pieces[j]!.text.startsWith("\x1b") && !pieces[j]!.space))) {
      if (pieces[j]!.space) run.push(j);
      j += 1;
    }
    if (run.length >= minRun) {
      for (const k of run.slice(1, -1)) {
        const cell = cells[pieces[k]!.col];
        if (cell !== undefined) pieces[k]!.text = ink[cell.layer](cell.char);
      }
    }
    i = j;
  }
  return pieces.map((p) => p.text).join("");
}
