/**
 * T33b — errors must say what to do. One mapping from a dsh/pi-ai turn
 * failure to the ticket's two UI lines: one red actionable line, one dim
 * hint line — never a stack trace. The raw detail (code, status, message
 * chain) goes to $DSH_HOME/logs/kumo.log.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { displayModel } from "./footer.js";
import { ansi } from "./theme.js";
import { colorDepth, paint } from "./palette.js";

export interface LlmFailure {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}

export interface ErrorRoute {
  /** Provider display name from settings.yaml, else the route key. */
  provider: string;
  model: string;
  baseUrl?: string;
  contextWindow?: number;
}

export interface ErrorLines {
  message: string;
  hint: string;
  /** True when the caller should fetch /v1/models ids for the hint. */
  wantAvailableModels?: boolean;
}

/**
 * Bold is an attribute, not a colour, so `KUMO_COLOR=none` has to take it as well:
 * "no colour" means no SGR at all, and a lone `\x1b[1m` is still something to read
 * past on a screen where nothing else is decorated.
 */
function strong(text: string): string {
  return colorDepth() === "none" ? text : ansi.bold(text);
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? text).trim();
}

/** Status from the structured field, else the first 3-digit code in text. */
function statusOf(failure: LlmFailure): number | undefined {
  if (typeof failure.status === "number") return failure.status;
  const m = /\b(4\d\d|5\d\d)\b/.exec(typeof failure.message === "string" ? failure.message : "");
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

/** Seconds for the timeout line, when the failure text carries a duration. */
function timeoutSeconds(message: string): number | undefined {
  const s = /(\d+(?:[.,]\d+)?)\s*sec(?:onds?)?\b/i.exec(message) ?? /(\d+(?:[.,]\d+)?)\s*s\b/i.exec(message);
  if (s?.[1] !== undefined) return Number(s[1].replace(",", "."));
  const ms = /(\d+(?:[.,]\d+)?)\s*ms\b/i.exec(message);
  return ms?.[1] === undefined ? undefined : Math.round(Number(ms[1].replace(",", ".")) / 100) / 10;
}

export function formatK(n: number): string {
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

/** Map a turn-end LLM failure onto the ticket's two lines. */
export function describeLlmError(failure: LlmFailure, route: ErrorRoute): ErrorLines {
  const code = typeof failure.code === "string" ? failure.code : "UNKNOWN";
  const message = typeof failure.message === "string" ? failure.message : "";
  const status = statusOf(failure);
  const server = route.baseUrl;
  const at = server === undefined ? "the model server" : `your model server at ${server}`;

  if (code === "AUTH" || status === 401 || status === 403 || /\b40[13]\b/.test(message)) {
    return { message: `The API key was refused by ${route.provider}`, hint: "Set a new key: kumo setup" };
  }
  if (status === 404 || /\b404\b|model.{0,30}(not found|does not exist)/i.test(message)) {
    return {
      message: `Model "${route.model}" not found on ${server ?? "the model server"}`,
      hint: "Change it: kumo setup",
      wantAvailableModels: true,
    };
  }
  if (code === "RATE_LIMIT" || status === 429) {
    return { message: `Rate limited by ${route.provider}`, hint: "Wait a moment and try again" };
  }
  if (code === "QUOTA_EXCEEDED") {
    return { message: `Quota exceeded at ${route.provider}`, hint: "Check the account balance: kumo setup" };
  }
  if (code === "CONTEXT_WINDOW_EXCEEDED") {
    const n = route.contextWindow !== undefined && route.contextWindow > 0 ? ` (${formatK(route.contextWindow)})` : "";
    return { message: `The conversation is larger than the model's context${n}`, hint: "Use /compact or /new" };
  }
  if (code === "TIMEOUT" || /\btime(?:d)?\s*out\b|timeout/i.test(message)) {
    const secs = timeoutSeconds(message);
    return {
      message: `The model server did not answer in time${secs === undefined ? "" : ` (${String(secs)}s)`}`,
      hint: "It may still be loading the model. Try again, or check the server logs",
    };
  }
  if (code === "TRANSPORT" || /\bECONN|\b(?:network|connection|socket|fetch|dns)\b/i.test(message)) {
    return {
      message: `Can't reach ${at}`,
      hint: "Is llama.cpp / Ollama / LM Studio running?  Change it: kumo setup",
    };
  }
  if (code === "SERVER" || (status !== undefined && status >= 500)) {
    return {
      message: `The model server returned an error (${String(status ?? code)})`,
      hint: firstLine(message) === "" ? "Try again" : firstLine(message),
    };
  }
  // A retry loop that gave up because the user pressed Esc arrives here, and the
  // generic hint below ("if it repeats: kumo setup") is the wrong thing to say to
  // somebody who just stopped the turn on purpose. The provider's own wording is
  // kept — it knows how many attempts it made — and the hint says what to do next.
  if (code === "ABORTED" || code === "CANCELLED" || /\b(cancell?ed|aborted|interrupted)\b/i.test(message)) {
    const said = firstLine(message);
    return {
      message: said === "" ? "The turn was cancelled" : said,
      hint: "You stopped this turn. Ask again, or /new to start clean",
    };
  }
  // Anything else: say the first line, never a stack, and point at the log.
  return {
    message: firstLine(message) === "" ? `${route.provider}: unknown model error` : firstLine(message),
    hint: "Details in logs/kumo.log; if it repeats: kumo setup",
  };
}

/**
 * D7 — the error as the user meets it: what happened, on which model, and what to
 * do about it.
 *
 * The defect: the failure was two loose lines in the transcript, and neither said
 * which model had just refused. On a route that names a file (`/etc/ajean/models/
 * Ornith-1.5-9B-Q4_K_M.gguf`) a user who has three models on disk has no way to
 * tell which one gave up, and the answer was a path they have to shorten by hand.
 *
 *     Error: Retry failed after 2 attempts: Retry cancelled
 *     Model: Ornith-1.5-9B-Q4_K_M
 *     You stopped this turn. Ask again, or /new to start clean
 *
 * It carries D1's `rail: "red"`, so the transcript paints it exactly like a tool
 * call that failed — the same tint, the same red rail, the same plain rail where
 * there is no background to tint. An error is not a new kind of thing on screen.
 *
 * Every row is wrapped rather than cut: a failure message truncated at the width is
 * a failure message that lost the part that says why.
 */
export class ErrorBlock implements Component {
  /** D1: a turn that failed is the same kind of red as a tool call that failed. */
  readonly rail = "red" as const;
  #lines: ErrorLines;
  #model: string;

  constructor(lines: ErrorLines, opts: { model?: string; modelName?: string } = {}) {
    this.#lines = lines;
    // `displayModel`, never the id: the row names the model, it does not print the
    // path of the weights behind it.
    this.#model = displayModel(opts.model, opts.modelName);
  }

  /**
   * The hint, filled in place once the server answers.
   *
   * T55 writes the error straight away and lets the `/v1/models` list arrive a
   * moment later: waiting on a network call before printing anything delayed the
   * line the user actually needed.
   */
  setHint(hint: string): void {
    this.#lines = { ...this.#lines, hint };
  }

  render(width: number): string[] {
    const cells = Math.max(8, width);
    const rows: string[] = [];
    const label = "Error:";
    const wrapped = wrapTextWithAnsi(this.#lines.message, Math.max(8, cells - label.length - 1));
    rows.push(`${strong(paint("rose", label))} ${paint("rose", wrapped[0] ?? "")}`);
    for (const line of wrapped.slice(1)) rows.push(paint("rose", line));
    // No model, no row: `Model: no model` is a sentence about the UI, not about
    // the user's session.
    if (this.#model !== "no model") {
      for (const line of wrapTextWithAnsi(`Model: ${this.#model}`, cells)) rows.push(paint("muted", line));
    }
    if (this.#lines.hint.trim() !== "") {
      for (const line of wrapTextWithAnsi(this.#lines.hint, cells)) rows.push(paint("muted", line));
    }
    return rows.map((row) => truncateToWidth(row, cells));
  }

  invalidate(): void {
    // Stateless render.
  }
}

/** Best-effort /v1/models ids for the 404 hint (1 s timeout, first 3). */
export async function fetchAvailableModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown; model?: unknown }> };
    const raw = Array.isArray(body?.data) ? body.data : (Array.isArray(body?.models) ? body.models : []);
    return raw
      .map((m) => String(m?.id ?? (m as { model?: unknown })?.model ?? ""))
      .filter((id) => id !== "" && id !== "undefined")
      .slice(0, 3);
  } catch {
    return [];
  }
}

export function kumoLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME ?? join(process.env.HOME ?? ".", ".kumo");
  return join(home, "logs", "kumo.log");
}

/** Full failure detail to $DSH_HOME/logs/kumo.log; never throws. */
export async function appendErrorLog(failure: LlmFailure, extra = ""): Promise<void> {
  const path = kumoLogPath();
  const line =
    `${new Date().toISOString()} [llm-error] code=${String(failure.code ?? "UNKNOWN")}` +
    `${failure.status === undefined ? "" : ` status=${String(failure.status)}`} ` +
    `${String(failure.message ?? "").slice(0, 2000)}${extra === "" ? "" : ` ${extra}`}\n`;
  try {
    await mkdir(join(path, ".."), { recursive: true });
    await appendFile(path, line, "utf8");
  } catch {
    // logging must never replace the user's error line
  }
}
