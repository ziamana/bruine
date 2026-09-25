import type { Component } from "@earendil-works/pi-tui";
import { clipCells, dim, sanitize, spinnerFrame } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

const SUMMARY_KEYS = ["command", "cmd", "path", "file_path", "url", "query", "pattern"];
const MAX_OUTPUT_LINES = 5;

export class ToolCallComponent implements Component {
  #rawArgs = "";
  #startTime: number;
  #done: { ok: boolean; seconds: number; lines: string[]; rest: number } | undefined;
  constructor(readonly tool: string, private now: () => number = Date.now, private icons: KumoIcons = kumoIcons()) {
    this.#startTime = now();
  }
  get active(): boolean { return this.#done === undefined; }
  args(delta: string): void { this.#rawArgs += delta; }
  /** The durable event replaces streamed JSON, it must never be appended twice. */
  setArgs(json: string): void { this.#rawArgs = json; }
  result(ok: boolean, output: string): void {
    const lines = sanitize(output).split("\n");
    if (lines.at(-1) === "") lines.pop();
    this.#done = { ok, seconds: (this.now() - this.#startTime) / 1000, lines: lines.slice(0, MAX_OUTPUT_LINES), rest: Math.max(0, lines.length - MAX_OUTPUT_LINES) };
  }
  cancel(): void { if (this.active) this.result(false, "Cancelled"); }
  summary(width = 60): string {
    if (!this.#rawArgs) return "";
    try {
      const parsed: unknown = JSON.parse(this.#rawArgs);
      const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
      const key = obj && SUMMARY_KEYS.find((k) => k in obj);
      const text = key ? String(obj![key]) : JSON.stringify(parsed);
      return clipCells(sanitize(text).replace(/\n/g, " "), Math.min(60, width), this.icons.think === "*" ? "..." : "…");
    } catch { return this.icons.think === "*" ? "..." : "…"; }
  }
  render(width: number): string[] {
    const summary = this.summary();
    const detail = summary ? `  ${summary}` : "";
    if (!this.#done) return [clipCells(`${spinnerFrame(this.now() - this.#startTime, this.icons)} ${this.tool}${detail}`, width)];
    const mark = this.#done.ok ? ansi.green(this.icons.ok) : ansi.red(this.icons.fail);
    const tail = clipCells(` ${this.tool}${detail}  ${this.#done.seconds.toFixed(1)}s`, Math.max(0, width - 1));
    const out = [width > 0 ? mark + tail : ""];
    const branch = this.icons.think === "*" ? ">" : "⎿";
    this.#done.lines.forEach((line, i) => out.push(dim(clipCells(`${i === 0 ? `  ${branch} ` : "    "}${line}`, width))));
    if (this.#done.rest > 0) out.push(dim(clipCells(`    ${this.icons.think === "*" ? "..." : "…"} ${this.#done.rest} more lines`, width)));
    return out;
  }
  invalidate(): void {}
}
