import type { Component } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { clipCells } from "../render/reasoning.js";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
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
  readonly rail: "blue" | "red" = "blue";
  constructor(
    readonly tool: string,
    readonly extra: number,
    readonly seconds: number,
    private icons: KumoIcons = kumoIcons(),
  ) {}
  render(width: number): string[] {
    const mark = ansi.green(this.icons.ok);
    const toolPad = padCells(this.tool, 7);
    const summary = `+${String(this.extra)} file${this.extra === 1 ? "" : "s"}`;
    const dur = `${this.seconds.toFixed(1)}s`;
    const prefixCells = 1 + 1 + 7 + 2;
    const avail = Math.max(0, width - prefixCells - 2 - stringWidth(dur));
    const padded = padCells(summary.slice(0, Math.max(0, avail)), avail);
    return [mark + clipCells(` ${toolPad}  ${padded}  ${dur}`, Math.max(0, width - 1))];
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

export function formatTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? String(Math.round(k)) : String(Math.round(k * 10) / 10)}k`;
  }
  return String(Math.round(n));
}

/** Turn summary line (T27.3), dim. Empty when error (no summary on error). */
export function turnSummary(opts: {
  tools: number;
  wallSec: number;
  outputTokens: number;
  cancelled: boolean;
  okMark?: string;
  cancelMark?: string;
}): string | undefined {
  const ok = opts.okMark ?? "✓";
  const cancel = opts.cancelMark ?? "·";
  const wall = `${String(Math.max(0, Math.round(opts.wallSec)))}s`;
  if (opts.cancelled) return `${cancel} cancelled after ${wall}`;
  const toks =
    opts.outputTokens >= 1000
      ? `${formatTokens(opts.outputTokens)} tokens`
      : `${String(Math.round(opts.outputTokens))} tokens`;
  if (opts.tools > 0) {
    return `${ok} ${String(opts.tools)} tool${opts.tools === 1 ? "" : "s"} · ${wall} · ${toks}`;
  }
  return `${ok} ${wall} · ${toks}`;
}
