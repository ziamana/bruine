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
import { parsePartialJson } from "./partial-json.js";
import { readableToolSummary, toolSummariesEnabled } from "./tool-summary.js";

const SUMMARY_KEYS = ["command", "cmd", "path", "file_path", "url", "query", "pattern", "name"];
/** T59: the tools whose call is a change to the workspace. */
const WRITE_TOOLS = new Set(["write", "edit", "multi_edit", "notebook_edit"]);
const MAX_OUTPUT_LINES = 5;
/** Lines of a multi-line command kept on screen while the call is still being written. */
const MAX_PENDING_COMMAND_ROWS = 4;

/** Lines of a file being written that are shown as they arrive; past them only a counter moves. */
const PREVIEW_ROWS = 10;
/** Which argument carries the text a tool is writing. */
const WRITTEN_TEXT_KEY: Record<string, string> = { write: "content", edit: "new_string" };

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

/**
 * What the turn, the chat and the receipt need from a tool call, whichever
 * component draws it: a generic call, or one with a shape of its own like a question.
 */
export interface ChatToolCall extends Component {
  readonly tool: string;
  readonly active: boolean;
  readonly rail: RailState;
  readonly doneOk: boolean | undefined;
  readonly seconds: number | undefined;
  args(delta: string): void;
  setArgs(json: string): void;
  result(ok: boolean, output: string): void;
  cancel(): void;
  touchedPath(): string | undefined;
  /** One line saying what the call is about, for the approval gate. */
  summary(width?: number): string;
}

export class ToolCallComponent implements ChatToolCall {
  #rawArgs = "";
  #startTime: number;
  #done: { ok: boolean; seconds: number; lines: string[]; rest: number } | undefined;
  /** What a successful edit/write changed, shown instead of "file updated". */
  #diff: FileDiff | undefined;
  #readableSummaries: boolean;
  constructor(readonly tool: string, private now: () => number = Date.now, private icons: KumoIcons = kumoIcons(), opts: { readableSummaries?: boolean } = {}) {
    this.#startTime = now();
    this.#readableSummaries = opts.readableSummaries ?? toolSummariesEnabled();
  }
  get active(): boolean { return this.#done === undefined; }
  /** T55 P1c: a tool still in flight owns the rail, so the live edge is findable. */
  get rail(): RailState { return this.#done === undefined ? "active" : this.#done.ok ? "blue" : "red"; }

  /**
   * A call that shows a diff asks for a NEUTRAL card.
   *
   * The transcript tints a finished call green, which was the right call for a tool
   * that just says it worked. It was the wrong one here: the diff paints its own
   * green band for an added line and its own red band for a removed one, so a green
   * card left the addition with nothing of its own while the deletion shouted. Two
   * bands of equal weight on a neutral block is a diff that can be read.
   */
  get diffCard(): boolean { return this.#diff !== undefined && this.#diff.lines.length > 0; }
  get doneOk(): boolean | undefined { return this.#done?.ok; }
  get seconds(): number | undefined { return this.#done?.seconds; }
  args(delta: string): void { this.#rawArgs += delta; this.#settled = undefined; }
  /** The durable event replaces streamed JSON, it must never be appended twice. */
  setArgs(json: string): void { this.#rawArgs = json; this.#settled = undefined; }
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
    this.#settled = undefined;
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

  /**
   * What the arguments say so far. The args arrive as deltas and are only valid
   * JSON at the end, so the line is read out of the partial text: a command is seen
   * being written, word by word, instead of a bare ellipsis until it is whole.
   */
  #partialArgs(): Record<string, unknown> | undefined {
    // Read three times per frame (the summary, the command, the preview) and a file
    // being written can be large: parse once per length of text received.
    if (this.#parsedAt !== this.#rawArgs.length) {
      const parsed = parsePartialJson(this.#rawArgs);
      this.#parsed = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
      this.#parsedAt = this.#rawArgs.length;
    }
    return this.#parsed;
  }
  #parsed: Record<string, unknown> | undefined;
  #parsedAt = -1;

  /**
   * The text of a file being written, as it arrives: its first lines are shown, numbered,
   * and after them only a count of lines and bytes that keeps moving. Watching a hundred
   * lines scroll by is noise; watching a number climb is proof that it is working.
   */
  #writtenPreview(width: number): string[] {
    const key = WRITTEN_TEXT_KEY[this.tool];
    const text = key === undefined ? undefined : this.#partialArgs()?.[key];
    if (typeof text !== "string" || text === "") return [];
    const ascii = this.icons.think === "*";
    const ellipsis = ascii ? "..." : "…";
    const rows = text.split("\n");
    // A trailing newline ends the last line rather than starting a blank one.
    if (rows.at(-1) === "") rows.pop();
    const count = rows.length;
    const bar = ascii ? "|" : "│";
    const out = rows.slice(0, PREVIEW_ROWS).map((row, i) => {
      const gutter = `${String(i + 1).padStart(4)} ${bar} `;
      return ansi.faint(gutter) + ansi.gray(clipCells(sanitize(row).replace(/\t/g, "  "), Math.max(1, width - gutter.length), ellipsis));
    });
    if (count > PREVIEW_ROWS) {
      const bytes = Buffer.byteLength(text, "utf8");
      const size = bytes < 1024 ? `${String(bytes)} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
      out.push(ansi.faint(clipCells(`     ${ellipsis} ${String(count)} lines ${ascii ? "-" : "·"} ${size}`, width, ellipsis)));
    }
    return out;
  }

  summary(width = 60, link = false): string {
    if (!this.#rawArgs) return "";
    const ellipsis = this.icons.think === "*" ? "..." : "…";
    const obj = this.#partialArgs();
    if (obj === undefined) return ellipsis;
    const key = SUMMARY_KEYS.find((k) => typeof obj[k] === "string" && obj[k] !== "");
    let text = key ? String(obj[key]) : Object.keys(obj).length > 0 ? JSON.stringify(obj) : "";
    if (text === "") return ellipsis;
    if (key === "path" || key === "file_path") text = relCwd(text);
    const shown = clipCells(sanitize(text).replace(/\n/g, " "), Math.max(1, width), ellipsis);
    // A path is displayed relative to the cwd and linked to the absolute one.
    return link && (key === "path" || key === "file_path") ? fileLink(shown, String(obj[key])) : shown;
  }

  /** The chat can show a description; approval still reads the actual command/path. */
  #displaySummary(width: number, link = false): string {
    const text = this.#readableSummaries ? readableToolSummary(this.tool, this.#partialArgs()) : undefined;
    if (text === undefined) return this.summary(width, link);
    return clipCells(sanitize(text).replace(/\s+/g, " "), Math.max(1, width), this.icons.think === "*" ? "..." : "…");
  }

  /** A command being written keeps its later lines visible while the call is in flight. */
  #commandTail(width: number): string[] {
    const obj = this.#partialArgs();
    const command = obj && (typeof obj.command === "string" ? obj.command : typeof obj.cmd === "string" ? obj.cmd : undefined);
    if (command === undefined) return [];
    const rows = sanitize(command).split("\n");
    if (rows.length < 2) return [];
    const shown = rows.slice(1, 1 + MAX_PENDING_COMMAND_ROWS);
    const hidden = rows.length - 1 - shown.length;
    const ellipsis = this.icons.think === "*" ? "..." : "…";
    return [
      ...shown.map((row) => ansi.gray(clipCells(`    ${row}`, width, ellipsis))),
      ...(hidden > 0 ? [ansi.faint(clipCells(`    ${ellipsis} ${String(hidden)} more lines`, width))] : []),
    ];
  }
  /** A settled call at one width in one set of colours is the same lines every time it is asked for. */
  #settled: { width: number; ink: string; lines: string[] } | undefined;
  render(width: number): string[] {
    if (this.#done === undefined) return this.#draw(width);
    const ink = `${ansi.gray("x")}${ansi.green("x")}${ansi.red("x")}${ansi.text("x")}`;
    if (this.#settled?.width !== width || this.#settled.ink !== ink) this.#settled = { width, ink, lines: this.#draw(width) };
    return this.#settled.lines;
  }
  #draw(width: number): string[] {
    const toolPad = padCells(this.tool, 7);
    if (!this.#done) {
      const fr = spinnerFrame(this.now() - this.#startTime, this.icons);
      const room = Math.max(1, width - stringWidth(`${fr} ${toolPad}  `));
      const summary = this.#displaySummary(room);
      const detail = summary ? `  ${summary}` : "";
      const plainLine = clipCells(`${fr} ${toolPad}${detail}`, width);
      const head = stringWidth(plainLine) === stringWidth(`${fr} ${toolPad}${detail}`)
        ? `${ansi.cyan(fr)} ${ansi.text(toolPad)}${ansi.gray(detail)}`
        : plainLine;
      return [head, ...this.#commandTail(width), ...this.#writtenPreview(width)];
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
    const plainSummary = this.#displaySummary(budget);
    const linkedPadded = padCells(this.#displaySummary(budget, true), avail);
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
