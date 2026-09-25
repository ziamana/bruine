import type { Component } from "@earendil-works/pi-tui";
import { dim, splitReasoningSegments, visible } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";

/**
 * The live reasoning display as a pi-tui component: always exactly ONE line
 * while streaming, collapsing to "💭 thought for 4.2s" when the block ends
 * (T13b, reusing the T12 state machine).
 */
export class ReasoningComponent implements Component {
  #now: () => number;
  #icons: KumoIcons;
  #current = "";
  #lastFinished = "";
  #startTime = 0;
  #started = false;
  #ended = false;
  #endTime = 0;

  constructor(now: () => number = Date.now, icons: KumoIcons = kumoIcons()) {
    this.#now = now;
    this.#icons = icons;
  }

  get active(): boolean {
    return this.#started && !this.#ended;
  }

  push(delta: string): void {
    if (delta === "" || this.#ended) return;
    if (!this.#started) {
      this.#started = true;
      this.#startTime = this.#now();
    }
    const split = splitReasoningSegments(this.#current, this.#lastFinished, delta);
    this.#current = split.current;
    this.#lastFinished = split.lastFinished;
  }

  end(): void {
    if (!this.#started || this.#ended) return;
    this.#ended = true;
    this.#endTime = this.#now();
  }

  render(width: number): string[] {
    if (!this.#started) return [];
    if (this.#ended) {
      const seconds = (this.#endTime - this.#startTime) / 1000;
      return [dim(`${this.#icons.think} thought for ${seconds.toFixed(1)}s`)];
    }
    const show = this.#current !== "" ? this.#current : this.#lastFinished;
    if (show === "") return [];
    return [dim(`${this.#icons.think} ${visible(show, width, this.#icons)}`)];
  }

  invalidate(): void {
    // Stateless render.
  }
}
