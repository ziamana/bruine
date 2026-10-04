import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { formatElapsed } from "../render/elapsed.js";
import { clipCells } from "../render/reasoning.js";
import { dropSpinner, rainLevel } from "./rain.js";
import { bruineIcons, isAscii, type BruineIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { terminalMotionAllowed } from "./logo-motion.js";
import { formatSilence } from "../llm/silence.js";

/** How long the model has been quiet, and how long bruine waits before it tries again. */
export type SilenceProbe = () => { quietMs: number; budgetMs: number } | undefined;

/** A silence is worth a word once it lasts this long. */
export const QUIET_SHOWN_AFTER_MS = 20_000;

import { TurnActivity, type WorkingState } from "./turn-activity.js";
export type { WorkingState } from "./turn-activity.js";

/** Paint the pinned activity row from the turn's shared clock. */
export class WorkingComponent implements Component {
  #animate: boolean;
  private activity: TurnActivity;
  constructor(
    now: () => number = Date.now,
    private icons: BruineIcons = bruineIcons(),
    activity?: TurnActivity,
  ) {
    this.activity = activity ?? new TurnActivity(now);
    if (!activity) this.activity.start();
    // ASCII suppresses decorative logo motion, but its activity spinner still ticks.
    this.#animate = terminalMotionAllowed({ env: { ...process.env, BRUINE_ASCII: "0" } });
  }
  get state(): WorkingState { return this.activity.state; }
  set state(state: WorkingState) { this.activity.setState(state); }
  get active(): boolean { return this.#animate; }
  /** Where the live silence is read from (bruine-silence), when there is one. */
  silence: SilenceProbe | undefined;
  private status(): { label: string; elapsed: string } {
    const elapsed = this.activity.elapsed;
    // An approval is open: nothing is running, and the label says whose turn it is.
    if (this.activity.held) return { label: `${isAscii(this.icons) ? "?" : "◆"} Waiting for you`, elapsed: formatElapsed(elapsed) };
    // Rain while the model works: how hard it falls is the effort it was asked to think at.
    const frame = this.#animate ? dropSpinner(elapsed, rainLevel(), isAscii(this.icons)) : isAscii(this.icons) ? "|" : "⋮";
    return { label: `${frame} ${this.state}`, elapsed: formatElapsed(elapsed) };
  }
  /** Compact label for the composer rule; time has its own muted color. */
  label(): string {
    const status = this.status();
    const extra: string[] = [];
    if (!this.activity.held) {
      // A retry in progress, then how long the model has been quiet and when bruine gives up:
      // what used to be a counter that kept counting with nothing said.
      if (this.activity.note !== undefined) extra.push(ansi.yellow(this.activity.note));
      const quiet = this.silence?.();
      if (quiet !== undefined && quiet.quietMs >= QUIET_SHOWN_AFTER_MS) {
        extra.push(ansi.gray(`no answer for ${formatSilence(quiet.quietMs)}, retrying at ${formatSilence(quiet.budgetMs)}`));
      }
    }
    const tail = extra.map((part) => ` ${ansi.faint("·")} ${part}`).join("");
    return `${(this.activity.held ? ansi.yellow : ansi.violet)(status.label)} ${ansi.gray(status.elapsed)}${tail}`;
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
