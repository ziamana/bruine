/**
 * T33b — errors must say what to do. One mapping from a dsh/pi-ai turn
 * failure to the ticket's two UI lines: one red actionable line, one dim
 * hint line — never a stack trace. The raw detail (code, status, message
 * chain) goes to $DSH_HOME/logs/kumo.log.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

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
  // Anything else: say the first line, never a stack, and point at the log.
  return {
    message: firstLine(message) === "" ? `${route.provider}: unknown model error` : firstLine(message),
    hint: "Details in logs/kumo.log; if it repeats: kumo setup",
  };
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
