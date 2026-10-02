import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { clipCells, spinnerFrame } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { terminalMotionAllowed } from "./logo-motion.js";

export type WorkingState = "Working" | "Waiting for model" | "Thinking";

/** One activity row, shared by the prefill marker and the pinned composer. */
export class WorkingComponent implements Component {
  #startTime: number;
  #animate: boolean;
  /** The composer paints this marker; keep it in chat for the stream lifecycle. */
  docked = false;
  state: WorkingState = "Waiting for model";
  constructor(
    private now: () => number = Date.now,
    private icons: KumoIcons = kumoIcons(),
  ) {
    this.#startTime = now();
    this.#animate = terminalMotionAllowed({ ascii: icons.think === "*" });
  }
  get active(): boolean { return this.#animate; }
  line(width: number): string {
    const elapsed = Math.max(0, this.now() - this.#startTime);
    const ascii = this.icons.think === "*";
    const frame = this.#animate ? spinnerFrame(elapsed, this.icons) : ascii ? "|" : "⋮";
    const label = `${frame} ${this.state} ${Math.floor(elapsed / 1000)}s`;
    const hint = "Esc to interrupt";
    const gap = width - visibleWidth(label) - hint.length;
    if (gap >= 3) return `${ansi.violet(label)}${" ".repeat(gap)}${ansi.gray(hint)}`;
    return ansi.violet(clipCells(label, width, ascii ? "..." : "…"));
  }
  render(width: number): string[] { return this.docked ? [] : [this.line(width)]; }
  invalidate(): void {}
}
