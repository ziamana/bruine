import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { dim } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { toolSummary } from "../render/tools.js";

const MAX_OUTPUT_LINES = 5;

/**
 * One tool call as a pi-tui component (T13c): the header fills in while
 * arguments stream, then the result line plus a short output preview stay
 * in the transcript (logic shared with the screen ToolCallView).
 */
export class ToolCallComponent implements Component {
  readonly tool: string;
  #rawArgs = "";
  #startTime: number;
  #now: () => number;
  #icons: KumoIcons;
  #done: { ok: boolean; seconds: number; lines: string[]; rest: number } | undefined;

  constructor(
    tool: string,
    now: () => number = Date.now,
    icons: KumoIcons = kumoIcons(),
  ) {
    this.tool = tool;
    this.#now = now;
    this.#icons = icons;
    this.#startTime = now();
  }

  args(jsonDelta: string): void {
    this.#rawArgs += jsonDelta;
  }

  result(ok: boolean, output: string): void {
    const seconds = (this.#now() - this.#startTime) / 1000;
    const lines = output.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const shown = lines.slice(0, MAX_OUTPUT_LINES);
    this.#done = { ok, seconds, lines: shown, rest: lines.length - shown.length };
  }

  /** Current summary, for the approval prompt. */
  summary(width = 80): string {
    return toolSummary(this.#rawArgs, this.tool, width);
  }

  render(width: number): string[] {
    const summary = this.summary(width);
    if (this.#done === undefined) {
      return [truncateToWidth(`${this.#icons.bullet} ${this.tool}  ${summary}`, width)];
    }
    const mark = this.#done.ok ? this.#icons.ok : this.#icons.fail;
    const head =
      `${mark} ${this.tool}` +
      (summary !== "" ? `  ${summary}` : "") +
      `  ${this.#done.seconds.toFixed(1)}s`;
    const out = [truncateToWidth(head, width)];
    for (const line of this.#done.lines) out.push(dim(`    ${line}`));
    if (this.#done.rest > 0) out.push(dim(`    … ${this.#done.rest} more lines`));
    return out;
  }

  invalidate(): void {
    // Stateless render.
  }
}
