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
 * — so nothing scrolls, the band sits one row above the last, and the composer
 * stays put.
 *
 * The live path is untouched: at rest the transcript renders whole and the terminal
 * scrolls it exactly as before.
 *
 * The row under a held window is a component, not a string (D5). It used to be a
 * `N lines below · PageDown follows` label, which said how far back the user was
 * and nothing about how to get back; the pill that replaced it is a control, and a
 * control the shell owns is a control that cannot claim to be there when the window
 * is at the live edge.
 */

import { Container, type Component } from "@earendil-works/pi-tui";

/** Transcript lines kept behind the window. A few screenfuls of reading, not an archive. */
const HISTORY_LINES = 2000;

/** An SGR reset: invisible, and enough to make a windowed frame's first line differ from the live one. */
const HELD_MARK = "\x1b[0m";

/** Below this the transcript gets nothing and the band has the terminal to itself. */
const MIN_ROWS = 8;

/**
 * The row that says the window is away from the live edge, when it is (D5).
 *
 * The shell owns the offset, so it owns the flag too: the row and the thing it
 * describes cannot drift apart, and the caller never has to remember to set a
 * boolean it could get wrong. A hint that draws nothing costs no row.
 */
export interface WindowHint extends Component {
  visible: boolean;
}

export class Shell extends Container {
  /** Index of the transcript among `children`; everything after it is pinned. */
  readonly #split: number;
  /** The last render of the header and the transcript, which is what a held window reads from. */
  #history: string[] = [];
  #previous: string[] = [];
  /** Lines the window is held above the live end. 0 is the live edge. */
  #back = 0;

  constructor(
    head: readonly Component[],
    readonly transcript: Component,
    below: readonly Component[],
    private readonly rows: () => number,
    private readonly hint?: WindowHint,
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
    // One blank row under the bar, always.
    //
    // The footer is the last thing on the screen and it is read in one glance, so a
    // bar flush against the last row of the terminal reads as cut off rather than
    // finished. It costs the window one row (`area` below counts it), and the band
    // moves up by one, which is the whole change.
    bottom.push("");
    const live = this.transcript.render(width);
    // The header is the first thing in the document, not a bar pinned over it: the
    // window reads the header and the transcript as one scroll, so the wordmark comes
    // into view only when the reader reaches the top, as it does in the terminal itself.
    this.#ingest([...top, ...live]);
    // At rest the transcript is printed whole and the terminal scrolls it, which is
    // what it has always done: the window is a mode, not the default frame.
    if (this.#back === 0 && this.hint === undefined) return [...top, ...live, ...bottom];

    // The hint is measured before the window, so it can never be the row that
    // pushes the composer off the bottom — and it draws nothing at the live edge.
    const hint: string[] = [];
    if (this.hint !== undefined) {
      this.hint.visible = this.#back > 0;
      hint.push(...this.hint.render(width));
    }
    if (this.#back === 0) return [...top, ...live, ...bottom];

    const rows = Math.max(MIN_ROWS, this.rows());
    const area = Math.max(1, rows - hint.length - bottom.length);
    // The window is the last `keep` lines of the history, less the `back` lines
    // below it: slicing to the end would show the live edge and the offset would
    // only be a way to lose rows.
    // Near the top of the transcript the offset can be larger than what is left above
    // the window: the window stops at the first page and shows it whole, rather than
    // a sliver of its first lines over a screen of blanks.
    const to = Math.max(Math.min(this.#history.length, area), this.#history.length - this.#back);
    const from = Math.max(0, to - area);
    const window = this.#history.slice(from, to);
    // The gap is what holds the band on the last row. A window shorter than the
    // budget — the top of the history, or a frame that just grew — is padded, never
    // left short, or the composer would drift up with it.
    const gap = Math.max(0, area - window.length);
    const frame = [...Array.from({ length: gap }, () => ""), ...window, ...hint, ...bottom];
    // The renderer repaints only the lines that differ, and treats the top of the
    // screen as wherever the previous frame left it. A windowed frame shorter than a
    // live one that had scrolled starts with the very same lines (the header, the
    // first turns), so nothing "above the screen" looked changed, and the repaint
    // landed twelve rows too high with the rest of the screen blank. A first line
    // that is not byte-for-byte the live one makes it redraw the whole frame when the
    // window opens; the mark paints nothing, and every windowed frame carries it, so
    // moving inside the window is still a repaint of what moved.
    if (frame.length > 0) frame[0] = `${HELD_MARK}${frame[0]!}`;
    return frame;
  }

  /**
   * Take a fresh transcript render as the history.
   *
   * The transcript re-renders from scratch every frame, whole, so the history is that
   * render and nothing more. It used to grow by the common prefix and append whatever
   * came after the first line that differed, which is right for a transcript that only
   * ever gains lines at its end and wrong for one that rewrites lines in place: a tool
   * spinner, a "Thinking" line, a sentence being written each changed one line, and
   * that line plus everything below it was appended again on every frame while the old
   * copies stayed. A held window then showed the spinner ten times over. One render is
   * one version of each line, the current one.
   */
  #ingest(live: string[]): void {
    if (live.length === this.#previous.length && live.every((line, i) => line === this.#previous[i])) {
      this.#previous = live;
      return;
    }
    const grew = live.length - this.#previous.length;
    this.#history = live.length > HISTORY_LINES ? live.slice(-HISTORY_LINES) : live;
    this.#previous = live;
    // A held window does not move because the model is still writing.
    //
    // The offset is kept constant in *lines*, so it has to grow with the live edge:
    // every line the transcript gains moves that edge one row further away, and a
    // window that stays `back` lines from it would shove the reading up a row for
    // every line that arrives. On a live turn that is a token at a time, so the
    // whole visible transcript creeps upward at ten frames a second while the user
    // is trying to read it. Growing the offset with the transcript freezes both ends
    // of the window: the lines the user chose stay on the same rows, and the new ones
    // land below it.
    if (grew > 0 && this.#back > 0) this.#back += grew;
    // The transcript can shrink under a held window, so the offset may be past its end.
    this.#back = Math.min(this.#back, Math.max(0, this.#history.length - 1));
  }
}
