/**
 * The frame, and a transcript the app can scroll without losing the composer.
 *
 * The defect: kumo runs on the main screen, so the frame is printed whole and the
 * terminal scrolls it. The composer sits at the END of that frame, which is exactly
 * where the visible viewport ends — so reading anything above the last screenful
 * scrolled the input bar out of sight, and the only way back was to scroll to the
 * bottom and find it. A user reading an answer to check a claim lost the means to
 * ask the next question, which is the whole point of the bar.
 *
 * The fix cannot be a repaint: the terminal owns the scrollback and the app cannot
 * move the terminal's cursor (`mouse.ts:212`). It has to be the frame. Scrolled
 * back, the transcript is windowed to end `back` lines above its live end, blank
 * rows make up the difference, and the frame is exactly the height of the terminal
 * — so nothing scrolls, the band sits on the last row, and the composer stays put.
 *
 * The live path is untouched: at rest the transcript renders whole and the terminal
 * scrolls it exactly as before.
 */

import { Container, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { ansi } from "./theme.js";

/** Transcript lines kept behind the window. A few screenfuls of reading, not an archive. */
const HISTORY_LINES = 2000;

/** Below this the transcript gets nothing and the band has the terminal to itself. */
const MIN_ROWS = 8;

export class Shell extends Container {
  /** Index of the transcript among `children`; everything after it is pinned. */
  readonly #split: number;
  /** Every transcript line rendered so far, so the window has something above it. */
  #history: string[] = [];
  #previous: string[] = [];
  /** Lines the window is held above the live end. 0 is the live edge. */
  #back = 0;

  constructor(
    head: readonly Component[],
    readonly transcript: Component,
    below: readonly Component[],
    private readonly rows: () => number,
  ) {
    super();
    this.#split = head.length;
    for (const child of head) this.addChild(child);
    this.addChild(transcript);
    for (const child of below) this.addChild(child);
  }

  /** True while the window is away from the live edge. */
  get scrolled(): boolean {
    return this.#back > 0;
  }

  /** Transcript lines between the window and the live end. */
  get back(): number {
    return this.#back;
  }

  /** Move the window. Positive goes further from the live edge. */
  scrollBy(lines: number): void {
    const far = Math.max(0, this.#history.length - 1);
    this.#back = Math.min(far, Math.max(0, this.#back + lines));
  }

  /**
   * Back to the live edge.
   *
   * Called on every key that means "go on" — a submitted prompt, an interrupt —
   * because a user who acted on what they just read is done reading it.
   */
  toEnd(): void {
    this.#back = 0;
  }

  render(width: number): string[] {
    const top: string[] = [];
    const bottom: string[] = [];
    for (const [i, child] of this.children.entries()) {
      if (i < this.#split) top.push(...child.render(width));
      else if (i > this.#split) bottom.push(...child.render(width));
    }
    const live = this.transcript.render(width);
    this.#ingest(live);
    // At rest the transcript is printed whole and the terminal scrolls it, which is
    // what it has always done: the window is a mode, not the default frame.
    if (this.#back === 0) return [...top, ...live, ...bottom];

    // The hint is placed before the transcript is measured, so it can never be the
    // row that pushes the composer off the bottom.
    const hint = [truncateToWidth(ansi.faint(`  ${String(this.#back)} lines below  ·  PageDown follows`), width)];
    const rows = Math.max(MIN_ROWS, this.rows());
    const area = Math.max(1, rows - top.length - hint.length - bottom.length);
    // The window is the last `keep` lines of the history, less the `back` lines
    // below it: slicing to the end would show the live edge and the offset would
    // only be a way to lose rows.
    const from = Math.max(0, this.#history.length - area - this.#back);
    const to = Math.max(0, this.#history.length - this.#back);
    const window = this.#history.slice(from, to);
    // The gap is what holds the band on the last row. A window shorter than the
    // budget — the top of the history, or a frame that just grew — is padded, never
    // left short, or the composer would drift up with it.
    const gap = Math.max(0, area - window.length);
    return [...top, ...Array.from({ length: gap }, () => ""), ...window, ...hint, ...bottom];
  }

  /**
   * Fold a fresh transcript render into the history.
   *
   * The transcript re-renders from scratch every frame, so the history grows by the
   * common prefix: what the new render adds past it is what the user saw for the
   * first time. A render that got SHORTER means a block left the transcript (the
   * question form, the working row), and there the common prefix is a coincidence
   * rather than an identity — so the history is rebuilt from what is really on
   * screen instead of keeping lines that are already gone.
   */
  #ingest(live: string[]): void {
    if (live.length === this.#previous.length && live.every((line, i) => line === this.#previous[i])) {
      this.#previous = live;
      return;
    }
    let shared = 0;
    if (live.length >= this.#previous.length) {
      while (shared < live.length && shared < this.#previous.length && live[shared] === this.#previous[shared]) shared += 1;
    }
    this.#history = live.length < this.#previous.length ? [] : this.#history;
    this.#history.push(...live.slice(shared));
    if (this.#history.length > HISTORY_LINES) this.#history = this.#history.slice(-HISTORY_LINES);
    this.#previous = live;
    // The history can shrink under a held window, so the offset may be past its end.
    this.#back = Math.min(this.#back, Math.max(0, this.#history.length - 1));
  }
}
