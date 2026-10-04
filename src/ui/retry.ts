import { formatSilence } from "../llm/silence.js";

/** What dsh-llm-retry records when it is about to try a request again (`llm/retry`). */
export interface RetryEvent {
  retry: number;
  /** Absent in the `always` mode, which has no limit. */
  maxRetries?: number;
  delayMs: number;
  failure?: { code?: string; message?: string; silenceMs?: number };
}

/** How long the request was silent, from bruine's own failure or an adapter's message. */
function silenceOf(failure: RetryEvent["failure"]): number | undefined {
  if (typeof failure?.silenceMs === "number") return failure.silenceMs;
  const ms = /after (\d+)\s*ms/.exec(failure?.message ?? "")?.[1];
  return ms === undefined ? undefined : Number(ms);
}

/** Why the request is tried again, in a sentence a person reads. */
export function retryCause(failure: RetryEvent["failure"]): string {
  switch (failure?.code) {
    case "TIMEOUT": {
      const quiet = silenceOf(failure);
      return quiet === undefined ? "The model is not answering." : `The model has not answered for ${formatSilence(quiet)}.`;
    }
    case "RATE_LIMIT":
      return "The provider is limiting requests.";
    case "SERVER":
      return "The model's server returned an error.";
    case "TRANSPORT":
      return "The connection to the model dropped.";
    case "EMPTY_RESPONSE":
      return "The model sent an empty answer.";
    default:
      return failure?.code === undefined ? "The request failed." : `The request failed (${failure.code}).`;
  }
}

/** `2/5`, or `2` when the policy has no limit. */
export function retryCount(event: Pick<RetryEvent, "retry" | "maxRetries">): string {
  return event.maxRetries === undefined ? String(event.retry) : `${String(event.retry)}/${String(event.maxRetries)}`;
}

/** The wait before the retry: `now`, `in 0.6s`, `in 8s`. */
export function retryWait(delayMs: number): string {
  if (delayMs < 100) return "now";
  if (delayMs < 10_000) return `in ${(delayMs / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  return `in ${formatSilence(delayMs)}`;
}

/**
 * The line the transcript keeps for a retry: why, which attempt, and when. It used to be nothing
 * at all; the turn's clock just kept counting while dsh tried again in silence.
 */
export function retryLine(event: RetryEvent): string {
  return `${retryCause(event.failure)} Retry ${retryCount(event)} ${retryWait(event.delayMs)}.`;
}
