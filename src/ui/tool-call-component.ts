import type { Component } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { isAbsolute, relative } from "node:path";
import { clipCells, dim, sanitize, spinnerFrame } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

const SUMMARY_KEYS = ["command", "cmd", "path", "file_path", "url", "query", "pattern"];
const MAX_OUTPUT_LINES = 5;

function padCells(text: string, width: number): string {
  const w = stringWidth(text);
  if (w >= width) return text;
  return text + " ".repeat(width - w);
}

/** Display absolute paths inside the project relative to the cwd (T27b minor). */
export function relCwd(p: string): string {
  if (p === "") return p;
  try {
    if (!isAbsolute(p)) return p;
    const rel = relative(process.cwd(), p);
    if (rel === "" ) return ".";
    if (rel.startsWith("..") || isAbsolute(rel)) return p;
    return rel;
  } catch {
    return p;
  }
}

export class ToolCallComponent implements Component {
  #rawArgs = "";
  #startTime: number;
  #done: { ok: boolean; seconds: number; lines: string[]; rest: number } | undefined;
  constructor(readonly tool: string, private now: () => number = Date.now, private icons: KumoIcons = kumoIcons()) {
    this.#startTime = now();
  }
  get active(): boolean { return this.#done === undefined; }
  get rail(): "blue" | "red" { return this.#done !== undefined && !this.#done.ok ? "red" : "blue"; }
  get doneOk(): boolean | undefined { return this.#done?.ok; }
  get seconds(): number | undefined { return this.#done?.seconds; }
  args(delta: string): void { this.#rawArgs += delta; }
  /** The durable event replaces streamed JSON, it must never be appended twice. */
  setArgs(json: string): void { this.#rawArgs = json; }
  result(ok: boolean, output: string): void {
    // dsh wraps file reads in <path>/<type>/<content> tags: the header already says
    // which file, so show only the content lines.
    const lines = sanitize(output)
      .split("\n")
      .filter((l) => !/^\s*(<(path|type)>.*<\/(path|type)>|<\/?content>)\s*$/.test(l));
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
      let text = key ? String(obj![key]) : JSON.stringify(parsed);
      if (key === "path" || key === "file_path") text = relCwd(text);
      return clipCells(sanitize(text).replace(/\n/g, " "), Math.min(60, width), this.icons.think === "*" ? "..." : "…");
    } catch { return this.icons.think === "*" ? "..." : "…"; }
  }
  render(width: number): string[] {
    const toolPad = padCells(this.tool, 7);
    if (!this.#done) {
      const summary = this.summary(width);
      const detail = summary ? `  ${summary}` : "";
      const plainLine = clipCells(`${spinnerFrame(this.now() - this.#startTime, this.icons)} ${toolPad}${detail}`, width);
      const fr = spinnerFrame(this.now() - this.#startTime, this.icons);
      if (stringWidth(plainLine) === stringWidth(`${fr} ${toolPad}${detail}`)) {
        return [`${ansi.cyan(fr)} ${ansi.text(toolPad)}${ansi.gray(detail)}`];
      }
      return [plainLine];
    }
    const mark = this.#done.ok ? ansi.green(this.icons.ok) : ansi.red(this.icons.fail);
    const dur = `${this.#done.seconds.toFixed(1)}s`;
    const prefixCells = 1 + 1 + 7 + 2;
    const avail = Math.max(0, width - prefixCells - 2 - stringWidth(dur));
    const rawSummary = this.summary(Math.min(60, Math.max(0, avail)));
    const summaryPadded = padCells(rawSummary, avail);
    const plainHead = ` ${toolPad}  ${summaryPadded}  ${dur}`;
    const fits = stringWidth(plainHead) <= Math.max(0, width - 1);
    const head =
      width <= 0
        ? ""
        : fits
          ? `${mark} ${ansi.text(toolPad)}  ${ansi.gray(summaryPadded)}  ${ansi.faint(dur)}`
          : mark + clipCells(plainHead, Math.max(0, width - 1));
    const out = [head];
    const branch = this.icons.think === "*" ? ">" : "⎿";
    this.#done.lines.forEach((line, i) => out.push(dim(clipCells(`${i === 0 ? `  ${branch} ` : "    "}${line}`, width))));
    if (this.#done.rest > 0) out.push(dim(clipCells(`    ${this.icons.think === "*" ? "..." : "…"} ${this.#done.rest} more lines`, width)));
    return out;
  }
  invalidate(): void {}
}
