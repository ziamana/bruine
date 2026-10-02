import type { Component } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { isAbsolute, relative } from "node:path";
import { clipCells, sanitize, spinnerFrame } from "../render/reasoning.js";
import { formatDuration } from "./tool-group.js";
import type { RailState } from "./chat-layout.js";
import { fileLink } from "./links.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { diffCounter, diffForCall, renderDiff, type FileDiff } from "./diff-view.js";

const SUMMARY_KEYS = ["command", "cmd", "path", "file_path", "url", "query", "pattern"];
/** T59: the tools whose call is a change to the workspace. */
const WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "notebook_edit"]);
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
  /** What a successful edit/write changed, shown instead of "file updated". */
  #diff: FileDiff | undefined;
  constructor(readonly tool: string, private now: () => number = Date.now, private icons: KumoIcons = kumoIcons()) {
    this.#startTime = now();
  }
  get active(): boolean { return this.#done === undefined; }
  /** T55 P1c: a tool still in flight owns the rail, so the live edge is findable. */
  get rail(): RailState { return this.#done === undefined ? "active" : this.#done.ok ? "blue" : "red"; }
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
      .filter((l) => !/^\s*(<(path|type)>.*<\/(path|type)>|<\/?content>)\s*$/.test(l))
      // Read results end with "(End of file - total N lines)": noise once the lines are shown.
      .filter((l) => !/^\s*\(End of file - total \d+ lines?\)\s*$/.test(l));
    while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
    this.#diff = ok && WRITE_TOOLS.has(this.tool) ? diffForCall(this.tool, this.#rawArgs) : undefined;
    if (lines.at(-1) === "") lines.pop();
    this.#done = { ok, seconds: (this.now() - this.#startTime) / 1000, lines: lines.slice(0, MAX_OUTPUT_LINES), rest: Math.max(0, lines.length - MAX_OUTPUT_LINES) };
  }
  cancel(): void { if (this.active) this.result(false, "Cancelled"); }
  /**
   * `link` is only for a call that has settled (T55 P2): a streaming line is
   * replaced a frame later, so a link on it would be work thrown away.
   */
  /**
   * One argument out of the streamed JSON, or undefined.
   *
   * The args arrive as deltas and are only valid JSON once the tool is done, so
   * both the summary line and the turn's file list read them through here rather
   * than each parsing the same string a second way.
   */
  #arg(key: string): string | undefined {
    try {
      const parsed: unknown = JSON.parse(this.#rawArgs);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      const value = (parsed as Record<string, unknown>)[key];
      return typeof value === "string" && value !== "" ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * T59: the file this call named, if it named one.
   *
   * Only the tools that write are asked: a `read` names a path too, and printing
   * it as a change would be a lie the workspace can contradict.
   */
  touchedPath(): string | undefined {
    if (!WRITE_TOOLS.has(this.tool)) return undefined;
    return this.#arg("file_path") ?? this.#arg("path") ?? this.#arg("notebook_path");
  }

  summary(width = 60, link = false): string {
    if (!this.#rawArgs) return "";
    try {
      const parsed: unknown = JSON.parse(this.#rawArgs);
      const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
      const key = obj && SUMMARY_KEYS.find((k) => k in obj);
      let text = key ? String(obj![key]) : JSON.stringify(parsed);
      if (key === "path" || key === "file_path") text = relCwd(text);
      const shown = clipCells(sanitize(text).replace(/\n/g, " "), Math.min(60, width), this.icons.think === "*" ? "..." : "…");
      // A path is displayed relative to the cwd and linked to the absolute one.
      return link && (key === "path" || key === "file_path")
        ? fileLink(shown, String(obj![key]))
        : shown;
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
        return [`${ansi.cyan(fr)} ${ansi.text(toolPad)}${ansi.gray(detail)}`, ...(this.tool === "ask_user" ? [ansi.gray(clipCells(this.icons.think === "*" ? "Waiting for user input..." : "Waiting for user input…", width))] : [])];
      }
      return [plainLine, ...(this.tool === "ask_user" ? [ansi.gray(clipCells(this.icons.think === "*" ? "Waiting for user input..." : "Waiting for user input…", width))] : [])];
    }
    const mark = this.#done.ok ? ansi.green(this.icons.ok) : ansi.red(this.icons.fail);
    const dur = formatDuration(this.#done.seconds) ?? (this.#done.ok ? "0.0s" : undefined);
    const counter = this.#diff === undefined ? "" : `  ${diffCounter(this.#diff)}`;
    const durCells = this.#diff === undefined ? 0 : 2 + `+${String(this.#diff.added)} -${String(this.#diff.removed)}`.length;
    const prefixCells = 1 + 1 + 7 + 2;
    const avail = Math.max(0, width - prefixCells - durCells);
    const budget = Math.min(60, avail);
    const durPart = counter;
    // Two renderings of the same summary: the linked one when the line fits, and
    // the plain one for the narrow fallback, because clipCells walks graphemes
    // and must never be handed an escape sequence to cut through.
    const plainSummary = this.summary(budget);
    const linkedPadded = padCells(this.summary(budget, true), avail);
    const plainPadded = padCells(plainSummary, avail);
    const plainHead = ` ${toolPad}  ${plainPadded}${durPart}`;
    const fits = stringWidth(plainHead) <= Math.max(0, width - 1);
    const head =
      width <= 0
        ? ""
        : fits
          ? `${mark} ${ansi.text(toolPad)}  ${ansi.gray(linkedPadded)}${durPart}`
          : mark + clipCells(plainHead, Math.max(0, width - 1));
    const out = [head];
    if (this.#diff !== undefined && this.#diff.lines.length > 0) {
      out.push(...renderDiff(this.#diff, Math.max(1, width - 2), this.icons.think === "*").map((l) => `  ${l}`));
      if (dur !== undefined) out.push(ansi.gray(clipCells(`Took ${dur}`, width)));
      return out;
    }
    const branch = this.icons.think === "*" ? ">" : "⎿";
    this.#done.lines.forEach((line, i) => out.push(ansi.gray(clipCells(`${i === 0 ? `  ${branch} ` : "    "}${line}`, width))));
    if (this.#done.rest > 0) out.push(ansi.gray(clipCells(`    ${this.icons.think === "*" ? "..." : "…"} ${this.#done.rest} more lines`, width)));
    if (dur !== undefined) out.push(ansi.gray(clipCells(`Took ${dur}`, width)));
    return out;
  }
  invalidate(): void {}
}
