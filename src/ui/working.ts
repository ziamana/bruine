import type { Component } from "@earendil-works/pi-tui";
import { clipCells, dim, spinnerFrame } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";

/** Prefill activity (T24.3): shown from prompt sent until the first stream chunk. */
export class WorkingComponent implements Component {
  #startTime: number;
  constructor(
    private now: () => number = Date.now,
    private icons: KumoIcons = kumoIcons(),
  ) {
    this.#startTime = now();
  }
  get active(): boolean {
    return true;
  }
  render(width: number): string[] {
    const elapsed = this.now() - this.#startTime;
    return [dim(clipCells(`${spinnerFrame(elapsed, this.icons)} Working`, width))];
  }
  invalidate(): void {}
}
