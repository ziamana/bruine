import { bruineIcons, type BruineIcons } from "./chars.js";
import { dim, type Screen } from "./reasoning.js";

const CLEAR = "\r\x1b[2K";
const SUMMARY_KEYS = [
  "command",
  "cmd",
  "path",
  "file_path",
  "url",
  "query",
  "pattern",
] as const;
const MAX_OUTPUT_LINES = 5;

interface Call {
  tool: string;
  rawArgs: string;
  startTime: number;
}

function truncate(s: string, max: number): string {
  if (max <= 1) return "…";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Header summary for streamed tool arguments: the first known key's value,
 * compact JSON, or "…" while unparseable. Shared by the screen renderer and
 * the pi-tui component.
 */
export function toolSummary(rawArgs: string, tool: string, columns: number): string {
  const max = columns - tool.length - 6;
  if (rawArgs === "") return "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    // Arguments are still streaming in.
    return "…";
  }

  let text: string;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const key = SUMMARY_KEYS.find((k) => k in obj);
    text = key !== undefined ? String(obj[key]) : JSON.stringify(parsed);
  } else {
    text = JSON.stringify(parsed);
  }
  return truncate(text, max);
}

export class ToolCallView {
  #screen: Screen;
  #now: () => number;
  #icons: BruineIcons;
  #calls = new Map<string, Call>();

  constructor(screen: Screen, now: () => number = Date.now, icons: BruineIcons = bruineIcons()) {
    this.#screen = screen;
    this.#now = now;
    this.#icons = icons;
  }

  start(id: string, toolName: string): void {
    this.#calls.set(id, { tool: toolName, rawArgs: "", startTime: this.#now() });
  }

  args(id: string, jsonDelta: string): void {
    const call = this.#calls.get(id);
    if (!call) return;
    call.rawArgs += jsonDelta;
  }

  result(id: string, ok: boolean, output: string): void {
    const call = this.#calls.get(id);
    if (!call) return;

    const seconds = (this.#now() - call.startTime) / 1000;
    const summary = this.#summary(call);
    const mark = ok ? this.#icons.ok : this.#icons.fail;
    const head =
      `${mark} ${call.tool}` +
      (summary !== "" ? `  ${summary}` : "") +
      `  ${seconds.toFixed(1)}s\n`;
    this.#screen.write(head);

    const lines = output.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const line of lines.slice(0, MAX_OUTPUT_LINES)) {
      this.#screen.write(`  ${line}\n`);
    }
    const rest = lines.length - MAX_OUTPUT_LINES;
    if (rest > 0) {
      this.#screen.write(`  … ${rest} more lines\n`);
    }

    this.#calls.delete(id);
  }

  /** Current header info for a tracked call; used by the approval prompt. */
  describe(id: string): { tool: string; summary: string } | undefined {
    const call = this.#calls.get(id);
    if (!call) return undefined;
    return { tool: call.tool, summary: this.#summary(call) };
  }

  #summary(call: Call): string {
    return toolSummary(call.rawArgs, call.tool, this.#screen.columns);
  }

  #header(call: Call, summary: string): string {
    return `● ${call.tool}  ${summary}`;
  }
}
