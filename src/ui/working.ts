import type { Component } from "@earendil-works/pi-tui";
import { clipCells } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { terminalMotionAllowed, WAITING_FRAMES } from "./logo-motion.js";

/** Prefill activity (T24.3): shown from prompt sent until the first stream chunk. */
export class WorkingComponent implements Component {
  #startTime: number;
  #animate: boolean;
  constructor(
    private now: () => number = Date.now,
    private icons: KumoIcons = kumoIcons(),
  ) {
    this.#startTime = now();
    this.#animate = terminalMotionAllowed({ ascii: icons.think === "*" });
  }
  get active(): boolean {
    return this.#animate;
  }
  render(width: number): string[] {
    const label = this.icons.think === "*" ? "Waiting for model - Esc cancels" : "Waiting for model · Esc cancels";
    if (!this.#animate || width < 6) return [ansi.gray(clipCells(label, width))];
    const elapsed = this.now() - this.#startTime;
    const frame = WAITING_FRAMES[Math.floor(Math.max(0, elapsed) / 90) % WAITING_FRAMES.length]!;
    return [`${ansi.cyan(frame)} ${ansi.gray(clipCells(label, width - 5))}`];
  }
  invalidate(): void {}
}
