import type { Component } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { clipCells } from "../render/reasoning.js";
import { bruineIcons, type BruineIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

function padCells(text: string, width: number): string {
  const w = stringWidth(text);
  if (w >= width) return text;
  return text + " ".repeat(width - w);
}

export interface GroupedTool {
  tool: string;
  ok: boolean;
  seconds: number;
}

/** Collapsed remainder, e.g. `✓ read   +3 files   0.4s` (T27.2). */
export class CollapsedToolsComponent implements Component {
  readonly rail: "blue" | "red" = "blue";  // a collapsed group is always settled
  constructor(
    readonly tool: string,
    readonly extra: number,
    readonly seconds: number,
    private icons: BruineIcons = bruineIcons(),
  ) {}
  render(width: number): string[] {
    const mark = ansi.green(this.icons.ok);
    const toolPad = padCells(this.tool, 7);
    // T55 P1a: "+3 more" is never three files specifically, and the duration is
    // dropped when it would only say 0.0s.
    const summary = `+${String(this.extra)} more`;
    const dur = formatDuration(this.seconds);
    const durCells = 0;
    const prefixCells = 1 + 1 + 7 + 2;
    const avail = Math.max(0, width - prefixCells - durCells);
    const padded = padCells(summary.slice(0, Math.max(0, avail)), avail);
    const durPart = "";
    return [mark + clipCells(` ${toolPad}  ${padded}${durPart}`, Math.max(0, width - 1)), ...(dur === undefined ? [] : [ansi.gray(clipCells(`Took ${dur}`, width))])];
  }
  invalidate(): void {}
}

/** Split consecutive successful same-tool runs (text or failure breaks). */
export function groupRuns(
  tools: GroupedTool[],
): Array<{ tool: string; start: number; count: number; seconds: number }> {
  const out: Array<{ tool: string; start: number; count: number; seconds: number }> = [];
  let i = 0;
  while (i < tools.length) {
    const t = tools[i]!;
    if (!t.ok) {
      out.push({ tool: t.tool, start: i, count: 1, seconds: t.seconds });
      i += 1;
      continue;
    }
    let j = i + 1;
    let sum = t.seconds;
    while (j < tools.length && tools[j]!.tool === t.tool && tools[j]!.ok) {
      sum += tools[j]!.seconds;
      j += 1;
    }
    out.push({ tool: t.tool, start: i, count: j - i, seconds: sum });
    i = j;
  }
  return out;
}

/**
 * A duration worth printing, or undefined when it is not (T55 P1a).
 *
 * The defect: every tool carried a stopwatch, so a wall of instant reads was a
 * wall of `0.0s` and a twelve-second build was `12.0s`. Under a fiftieth of a
 * second the number says nothing about anything, and past ten seconds the
 * decimal is noise. A cancelled call lands in the first case for free.
 */
export function formatDurationParts(seconds: number): { value: string; unit: string } | undefined {
  if (!(seconds >= 0.05)) return undefined;
  if (seconds < 10) return { value: seconds.toFixed(1), unit: "s" };
  if (seconds < 60) return { value: String(Math.round(seconds)), unit: "s" };
  const m = Math.floor(seconds / 60);
  return { value: `${String(m)}m${String(Math.round(seconds % 60)).padStart(2, "0")}`, unit: "s" };
}

export function formatDuration(seconds: number): string | undefined {
  const parts = formatDurationParts(seconds);
  return parts === undefined ? undefined : `${parts.value}${parts.unit}`;
}

export function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? String(Math.round(k)) : String(Math.round(k * 10) / 10)}k`;
  }
  return String(Math.round(n));
}

/**
 * How a piece of a receipt is painted: the numbers read, the chrome recedes.
 *
 * `sep` exists because the separators were the problem, not the values. The line is
 * the most important text in a turn, and it is mostly separators and unit words;
 * painting those as low as possible and the numbers only one step above made the
 * whole line read as the palest thing on screen. So the values are `text`, the
 * words that name them are `muted`, and only the separators are `faint`.
 */
export type ReceiptRole = "value" | "label" | "sep" | "ok" | "fail";

export interface ReceiptSegment {
  text: string;
  role: ReceiptRole;
}

export interface TurnReceiptOpts {
  tools: number;
  wallSec: number;
  outputTokens: number;
  cancelled: boolean;
  /** T55: the turn this receipt closes, when the shell is counting turns. */
  turn?: number;
  /** T55: prompt-cache hit rate, when the model reported one. */
  cachePct?: number;
  /** T55: a turn that failed still gets a receipt, marked in rose. */
  error?: boolean;
  okMark?: string;
  cancelMark?: string;
}

const seg = (text: string, role: ReceiptRole): ReceiptSegment => ({ text, role });

/**
 * The turn receipt as painted segments (T55).
 *
 * It used to be one `dim` string, which made the numbers the least readable thing
 * in the transcript: `dim` is a raw SGR, not a palette role, so on a truecolor
 * terminal it lands wherever the terminal's dim happens to land, while the same
 * numbers in the footer are `muted` at 5.10:1. A receipt is a measurement, not
 * something that has already been dealt with, so the numbers get the readable ink
 * and the labels recede. Concatenating the segments reproduces the plain string
 * exactly, which is what the ASCII and basic paths print.
 */
export function turnReceipt(opts: TurnReceiptOpts): ReceiptSegment[] {
  const okMark = opts.okMark ?? "✓";
  const cancelMark = opts.cancelMark ?? "·";
  const markRole: ReceiptRole = opts.error === true ? "fail" : "ok";
  const mark = opts.error === true ? (opts.okMark === undefined ? "✗" : opts.okMark) : okMark;
  const wall = formatDurationParts(opts.wallSec);
  const out: ReceiptSegment[] = [];

  if (opts.cancelled) {
    out.push(seg(`${cancelMark} cancelled after `, "label"));
    if (wall === undefined) out.push(seg("0", "value"), seg("s", "label"));
    else out.push(seg(wall.value, "value"), seg(wall.unit, "label"));
    return out;
  }

  if (opts.turn !== undefined) out.push(seg(`turn ${String(opts.turn)}`, "label"), seg(" · ", "sep"));
  out.push(seg(mark, markRole));

  // The mark is followed by a space, and only two measures are separated:
  // `✓ 5 tools · 41s · 1.2k tokens`, never `✓ · 5 tools ...`.
  let sep = " ";
  if (opts.tools > 0) {
    out.push(seg(sep, "sep"));
    out.push(seg(String(opts.tools), "value"), seg(` tool${opts.tools === 1 ? "" : "s"}`, "label"));
    sep = " · ";
  }
  if (wall !== undefined) {
    out.push(seg(sep, "sep"), seg(wall.value, "value"), seg(wall.unit, "label"));
    sep = " · ";
  }
  out.push(seg(sep, "sep"));
  out.push(
    seg(opts.outputTokens >= 1000 ? formatTokens(opts.outputTokens) : String(Math.round(opts.outputTokens)), "value"),
    seg(" tokens", "label"),
  );
  // A cache the model never reported is not shown as 0%.
  if (opts.cachePct !== undefined && opts.cachePct > 0) {
    out.push(seg(" · ", "sep"), seg("cache ", "label"), seg(String(Math.round(opts.cachePct)), "value"), seg("%", "label"));
  }
  return out;
}

/** The receipt as one plain string, for the ASCII and basic paths (T27.3). */
export function turnSummary(opts: TurnReceiptOpts): string | undefined {
  return turnReceipt(opts).map((s) => s.text).join("");
}
