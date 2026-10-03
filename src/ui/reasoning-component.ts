import { formatElapsed } from "../render/elapsed.js";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clipCells, completeWords, dim, sanitize, splitReasoningSegments, thinkingWords } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

/**
 * The model's thinking: one live line while it thinks, one line once it has.
 *
 * D6: a thought that has ended used to leave nothing behind but its duration —
 * `∴ Thought for 3s` — and the reasoning itself was gone, which is the one part of
 * a turn a user cannot get back by asking again. So the whole thought is kept, and
 * a click on the line that says it opens the text; a click on the text closes it
 * again. The click is a click on the block, not on a word: the label is the whole
 * target when it is collapsed, and the reasoning is the whole target when it is
 * open, because both are one thing to the reader.
 *
 * While the model is still thinking there is nothing to open: the line is the live
 * sentence, and it must keep being it.
 */
export class ReasoningComponent implements Component {
  readonly transcriptStyle = "reasoning";
  onActivityChange?: (active: boolean) => void;
  #current = "";
  #lastFinished = "";
  /** Everything the model has said in this thought, kept so it can be read back. */
  #thought = "";
  #expanded = false;
  #startTime = 0;
  #started = false;
  #ended = false;
  #endTime = 0;
  constructor(private now: () => number = Date.now, private icons: KumoIcons = kumoIcons()) {}
  get active(): boolean { return this.#started && !this.#ended; }
  /** True when a press on this block does something: a finished thought only. */
  get clickable(): boolean { return this.#ended; }
  /** Open or close the thought. A press on a live thought changes nothing. */
  click(): void {
    if (this.#ended) this.#expanded = !this.#expanded;
  }
  push(delta: string): void {
    if (!delta || this.#ended) return;
    if (!this.#started) { this.#started = true; this.#startTime = this.now(); this.onActivityChange?.(true); }
    this.#thought += sanitize(delta);
    const split = splitReasoningSegments(this.#current, this.#lastFinished, delta);
    this.#current = split.current;
    this.#lastFinished = split.lastFinished;
  }
  end(): void {
    if (!this.active) return;
    this.#ended = true;
    this.#endTime = this.now();
    this.onActivityChange?.(false);
  }
  render(width: number): string[] {
    if (!this.#started) return [];
    const words = completeWords(this.#current);
    if (!this.#ended) return [ansi.violet(dim(thinkingWords(words, width, this.now() - this.#startTime, this.icons)))];
    // The head stays the head whether the thought is open or not: the line that
    // closed it is the line that opens it again.
    const head = ansi.faint(dim(clipCells(`${this.icons.think} Thought for ${formatElapsed(this.#endTime - this.#startTime)}`, width)));
    if (!this.#expanded) return [head];
    const indent = " ".repeat(2);
    const body = this.#thought.trim();
    if (body === "") return [head];
    const room = Math.max(1, width - indent.length);
    return [
      head,
      ...wrapTextWithAnsi(body, room).map((line) => `${indent}${ansi.faint(dim(line))}`),
    ];
  }
  invalidate(): void {}
}