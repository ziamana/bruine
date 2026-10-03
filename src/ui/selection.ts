/**
 * T56 — mouse selection over the frame bruine already painted.
 *
 * bruine runs on the main screen, so the frame is taller than the terminal and the
 * terminal scrolls it. That single fact decides everything here: a mouse row is
 * a row of the *visible viewport*, and the line it belongs to is
 * `viewportTop + row`. Getting that wrong copies the wrong text, silently, and
 * only when the transcript is long enough to scroll.
 *
 * Pure on purpose. No terminal, no clipboard, no timers: the wiring lives in
 * bruine-ui.ts and the tests drive this file directly.
 */

import { Container, sliceByColumn, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Button-event tracking plus SGR encoding, and nothing more.
 *
 * `?1003` (all-motion) is deliberately absent: a selection needs press, drag
 * and release, and reporting every mouse move would flood the input stream for
 * a pointer position nothing acts on.
 */
export const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
/** Reverse order, so a half-enabled terminal is fully off rather than half on. */
export const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";

/** One mouse report, in zero-based terminal cells. */
export interface MouseSample {
  phase: "press" | "drag" | "release" | "wheel";
  col: number;
  row: number;
  /** Rows the wheel asked for, positive up. Only set when phase is "wheel". */
  wheelDelta?: number;
}

/**
 * Rows one wheel notch is worth.
 *
 * A terminal reports a notch, not a distance, and three lines is what a reader
 * expects from a wheel on every terminal they have used.
 */
const WHEEL_NOTCH_ROWS = 3;

/** SGR: `ESC [ < button ; col ; row (M|m)`. What Konsole, kitty, foot and xterm send. */
const SGR_MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
/** X10: `ESC [ M` then three bytes, each offset by 32. The pre-1006 fallback. */
const X10_MOUSE = /\x1b\[M([\x20-\xff])([\x20-\xff])([\x20-\xff])/g;

const LEFT_BUTTON = 0;
/** Set by the encoder while a button is held, so a drag still names its button. */
const MOTION_FLAG = 32;
/** Set by the encoder for wheel reports. */
const WHEEL_FLAG = 64;

export interface ParsedChunk {
  samples: MouseSample[];
  /** The chunk with every mouse report removed: what is left is real key input. */
  rest: string;
  /**
   * The tail was kept because it could still become a report. It is not
   * delivered, and it is not dropped either: it is the head of the next read.
   */
  held: boolean;
}

/** A tail that could still grow into a report, so it must not reach the editor. */
const PARTIAL_REPORT = /(?:\x1b\[<[0-9;]*|\x1b\[M[\x20-\xff]{0,2})$/;

/**
 * SGR button code to a sample, or undefined when the report is not ours.
 *
 * The wheel used to be dropped here, which is how a transcript stopped scrolling
 * with no word and no way for the user to know why. It is a report like any
 * other: the app decides what to do with it, and the terminal cannot.
 *
 * The button bits and the direction are read in the same place on purpose. They
 * used to be read twice, and only the up direction survived.
 */
function sgrSample(code: number, final: string, col: number, row: number): MouseSample | undefined {
  if ((code & WHEEL_FLAG) !== 0) {
    // 64 up, 65 down. 66 and 67 are horizontal wheels: reported by the terminal,
    // dropped by us, because there is nothing horizontal here to scroll.
    const which = code & 3;
    if (which > 1) return undefined;
    return { phase: "wheel", col, row, wheelDelta: which === 0 ? WHEEL_NOTCH_ROWS : -WHEEL_NOTCH_ROWS };
  }
  if ((code & 3) !== LEFT_BUTTON) return undefined;
  return {
    phase: (code & MOTION_FLAG) !== 0 ? "drag" : final === "M" ? "press" : "release",
    col,
    row,
  };
}

/**
 * X10 has no separate release code: 3 is the release report, 32 marks motion.
 *
 * A pre-1006 terminal, so this is the safety net rather than the path. It has no
 * wheel numbers worth trusting, and the wheel is reported as unknown rather than
 * as a scroll nobody asked for.
 */
function x10Phase(code: number): MouseSample["phase"] | undefined {
  if (code === 3) return "release";
  if (code >= 32) return "drag";
  return code === 0 ? "press" : undefined;
}

export class MouseScanner {
  #carry = "";

  read(chunk: string): ParsedChunk {
    const data = this.#carry + chunk;
    this.#carry = "";
    const { samples, rest } = this.#scan(data);
    const kept = rest.match(PARTIAL_REPORT);
    if (kept === null) return { samples, rest, held: false };
    this.#carry = kept[0];
    return { samples, rest: rest.slice(0, rest.length - kept[0].length), held: true };
  }

  /** Forget a half report, e.g. because a form took the screen. */
  reset(): void {
    this.#carry = "";
  }

  /** The reports in one self-contained chunk, and what is left of it. */
  #scan(chunk: string): { samples: MouseSample[]; rest: string } {
    const samples: MouseSample[] = [];
    const cut: [number, number][] = [];

    for (const match of chunk.matchAll(SGR_MOUSE)) {
      const at = match.index ?? 0;
      cut.push([at, at + match[0].length]);
      // SGR columns and rows are 1-based.
      const sample = sgrSample(Number(match[1]), match[4] as string, Number(match[2]) - 1, Number(match[3]) - 1);
      if (sample !== undefined) samples.push(sample);
    }

    for (const match of chunk.matchAll(X10_MOUSE)) {
      const at = match.index ?? 0;
      cut.push([at, at + match[0].length]);
      // X10 offsets both coordinates by 32 and reports them 1-based.
      const phase = x10Phase((match[1] as string).charCodeAt(0) - 32);
      if (phase === undefined) continue;
      samples.push({ phase, col: (match[2] as string).charCodeAt(0) - 33, row: (match[3] as string).charCodeAt(0) - 33 });
    }

    if (cut.length === 0) return { samples, rest: chunk };
    cut.sort((a, b) => a[0] - b[0]);
    let rest = "";
    let cursor = 0;
    for (const [from, to] of cut) {
      if (from < cursor) continue;
      rest += chunk.slice(cursor, from);
      cursor = to;
    }
    rest += chunk.slice(cursor);
    return { samples, rest };
  }
}

/**
 * Reassembles mouse reports across reads.
 *
 * pi-tui hands the input listeners the raw chunk the terminal produced
 * (`tui.js:662`), with no reassembly of its own on that path. A report the
 * terminal's buffering cut in half therefore arrives in two pieces, and a
 * per-chunk match never sees it: the press is lost, and since a drag without a
 * press is not a selection, the whole gesture is dropped. That is a selection
 * that works one time in ten, on a fast drag, on a loaded machine.
 *
 * A tail that could still become a report is kept and prepended to the next
 * read. Nothing else is ever held: an arrow key arriving in two pieces is not a
 * mouse, and holding it would eat a key the user pressed.
 */





/** A cell in terminal coordinates. */
interface Cell {
  row: number;
  col: number;
}

/** Normalized selection: `endCol` is exclusive, so one cell is a real selection. */
export interface SelectionSpan {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

/**
 * The gesture, and nothing else: an anchor, a focus, and whether the pointer
 * actually travelled.
 *
 * `dragged` is the whole reason a plain click copies nothing. Without it a press
 * and a release on the same cell would select that cell, and every click in
 * bruine would fire a "Copied" notice.
 */
export class TextSelection {
  #anchor: Cell | undefined;
  #focus: Cell | undefined;
  #pressed = false;
  #dragged = false;

  press(row: number, col: number): void {
    this.#anchor = { row, col };
    this.#focus = { row, col };
    this.#pressed = true;
    this.#dragged = false;
  }

  /** A report that lands on the cell the pointer is already on is not movement. */
  drag(row: number, col: number): void {
    if (!this.#pressed || this.#focus === undefined) return;
    if (this.#focus.row === row && this.#focus.col === col) return;
    this.#focus = { row, col };
    this.#dragged = true;
  }

  /** Ends the gesture and answers once: the span, or undefined for a click. */
  release(): SelectionSpan | undefined {
    this.#pressed = false;
    const span = this.span;
    this.clear();
    return span;
  }

  /** The live selection, for painting. Undefined unless the pointer travelled. */
  get span(): SelectionSpan | undefined {
    const anchor = this.#anchor;
    const focus = this.#focus;
    if (!this.#dragged || anchor === undefined || focus === undefined) return undefined;
    if (anchor.row === focus.row) {
      const startCol = Math.min(anchor.col, focus.col);
      return { startRow: anchor.row, endRow: focus.row, startCol, endCol: Math.max(anchor.col, focus.col) + 1 };
    }
    if (anchor.row < focus.row) {
      return { startRow: anchor.row, endRow: focus.row, startCol: anchor.col, endCol: focus.col + 1 };
    }
    // Dragged upwards: the focus row comes first, and the anchor row ends it.
    return { startRow: focus.row, endRow: anchor.row, startCol: focus.col, endCol: anchor.col + 1 };
  }

  clear(): void {
    this.#anchor = undefined;
    this.#focus = undefined;
    this.#pressed = false;
    this.#dragged = false;
  }
}

/**
 * Index of the frame line shown on screen row 0.
 *
 * The main screen writes the whole frame and lets the terminal scroll, so the
 * visible part is the tail. Matches what pi-tui does for its own overlays.
 */
export function viewportTop(lineCount: number, rows: number): number {
  return Math.max(0, lineCount - Math.max(1, rows));
}

/** Column range of `row` inside the span, clamped to the line. */
function rangeFor(row: number, span: SelectionSpan, lineWidth: number): { from: number; to: number } {
  const from = row === span.startRow ? Math.min(span.startCol, lineWidth) : 0;
  const rawTo = row === span.endRow ? span.endCol : lineWidth;
  return { from, to: Math.max(from, Math.min(rawTo, lineWidth)) };
}

/** The visible text of the selection, one output line per screen row it covers. */
export function selectedText(lines: readonly string[], top: number, span: SelectionSpan): string {
  const picked: string[] = [];
  for (let row = span.startRow; row <= span.endRow; row += 1) {
    const line = lines[top + row];
    if (line === undefined) continue;
    const { from, to } = rangeFor(row, span, visibleWidth(line));
    // A selection is text, not paint: no colour, no cursor marker, no padding.
    const text = stripTerminalSequences(sliceByColumn(line, from, to - from)).replace(/\s+$/, "");
    picked.push(text);
  }
  while (picked.length > 0 && picked[0] === "") picked.shift();
  while (picked.length > 0 && picked[picked.length - 1] === "") picked.pop();
  return picked.join("\n");
}

/**
 * Reverse video that survives the colour codes inside it.
 *
 * Any SGR reset in the middle of the selected run (`\x1b[39m`, `\x1b[0m`, the
 * palette codes bruine paints) turns reverse video off for the rest of the line,
 * which showed up as a selection that faded out halfway through a coloured
 * tool line. Re-arm after each one.
 */
function invert(text: string): string {
  return `\x1b[7m${text.replace(/\x1b\[[0-9;]*m/g, (code) => `${code}\x1b[7m`)}\x1b[27m`;
}

/** The frame with the selection painted in. Untouched lines come back identical. */
export function highlightSelection(lines: readonly string[], top: number, span: SelectionSpan): string[] {
  const painted = [...lines];
  for (let row = span.startRow; row <= span.endRow; row += 1) {
    const index = top + row;
    const line = lines[index];
    if (line === undefined) continue;
    const width = visibleWidth(line);
    const { from, to } = rangeFor(row, span, width);
    if (to <= from) continue;
    painted[index] =
      sliceByColumn(line, 0, from, true) + invert(sliceByColumn(line, from, to - from, true)) + sliceByColumn(line, to, width - to, true);
  }
  return painted;
}

/**
 * The one component that has to wrap every other one.
 *
 * bruine paints the selection after the tree is composed, because a selection can
 * cross the chat, the task panel and the console band, and no single child owns
 * the rows it covers.
 */
export class SelectionLayer extends Container {
  constructor(
    private readonly span: () => SelectionSpan | undefined,
    private readonly rows: () => number,
  ) {
    super();
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    const span = this.span();
    if (span === undefined) return lines;
    return highlightSelection(lines, viewportTop(lines.length, this.rows()), span);
  }
}
