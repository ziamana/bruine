import { formatElapsed } from "../render/elapsed.js";
import type { Component } from "@earendil-works/pi-tui";
import { clipCells, completeWords, dim, splitReasoningSegments, thinkingWords } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

/** Current sentence growing word by word (T25.3), subtitle on overflow. */
export class ReasoningComponent implements Component {
  readonly transcriptStyle = "reasoning";
  onActivityChange?: (active: boolean) => void;
  #current = "";
  #lastFinished = "";
  #startTime = 0;
  #started = false;
  #ended = false;
  #endTime = 0;
  constructor(private now: () => number = Date.now, private icons: KumoIcons = kumoIcons()) {}
  get active(): boolean { return this.#started && !this.#ended; }
  push(delta: string): void {
    if (!delta || this.#ended) return;
    if (!this.#started) { this.#started = true; this.#startTime = this.now(); this.onActivityChange?.(true); }
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
    if (this.#ended) return [ansi.faint(dim(clipCells(`${this.icons.think} Thought for ${formatElapsed(this.#endTime - this.#startTime)}`, width)))];
    const words = completeWords(this.#current);
    return [ansi.violet(dim(thinkingWords(words, width, this.now() - this.#startTime, this.icons)))];
  }
  invalidate(): void {}
}
