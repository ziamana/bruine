import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { formatElapsed } from "../render/elapsed.js";
import { clipCells } from "../render/reasoning.js";
import { dropSpinner, rainLevel } from "./rain.js";
import { kumoIcons, isAscii, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { terminalMotionAllowed } from "./logo-motion.js";

import { TurnActivity, type WorkingState } from "./turn-activity.js";
export type { WorkingState } from "./turn-activity.js";

/** Paint the pinned activity row from the turn's shared clock. */
export class WorkingComponent implements Component {
  #animate: boolean;
  private activity: TurnActivity;
  constructor(
    now: () => number = Date.now,
    private icons: KumoIcons = kumoIcons(),
    activity?: TurnActivity,
  ) {
    this.activity = activity ?? new TurnActivity(now);
    if (!activity) this.activity.start();
    // ASCII suppresses decorative logo motion, but its activity spinner still ticks.
    this.#animate = terminalMotionAllowed({ env: { ...process.env, KUMO_ASCII: "0" } });
  }
  get state(): WorkingState { return this.activity.state; }
  set state(state: WorkingState) { this.activity.setState(state); }
  get active(): boolean { return this.#animate; }
  private status(): { label: string; elapsed: string } {
    const elapsed = this.activity.elapsed;
    // Rain while the model works: how hard it falls is the effort it was asked to think at.
    const frame = this.#animate ? dropSpinner(elapsed, rainLevel(), isAscii(this.icons)) : isAscii(this.icons) ? "|" : "⋮";
    return { label: `${frame} ${this.state}`, elapsed: formatElapsed(elapsed) };
  }
  /** Compact label for the composer rule; time has its own muted color. */
  label(): string {
    const status = this.status();
    return `${ansi.violet(status.label)} ${ansi.gray(status.elapsed)}`;
  }
  line(width: number): string {
    const status = this.status();
    const ascii = isAscii(this.icons);
    const label = `${status.label} ${status.elapsed}`;
    const hint = "Esc to interrupt";
    const gap = width - visibleWidth(label) - hint.length;
    if (gap >= 3) return `${ansi.violet(label)}${" ".repeat(gap)}${ansi.gray(hint)}`;
    return ansi.violet(clipCells(label, width, ascii ? "..." : "…"));
  }
  render(width: number): string[] { return [this.line(width)]; }
  invalidate(): void {}
}
