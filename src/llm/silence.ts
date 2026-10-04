/**
 * How long a model may stay silent before bruine gives the request up and lets the retry loop
 * try again, and the wrapper that enforces it on a stream.
 *
 * A single fixed timeout is wrong in both directions. Two minutes cut off a model that, at its
 * highest effort, prepares a large file in silence: every retry died the same death and the turn
 * failed. Five minutes leaves a person staring at a dead stream for five minutes when the model
 * simply never started. So the budget depends on what the stream was doing when it went quiet:
 *
 * - waiting for the first token: the model is prefilling and thinking;
 * - after its reasoning ended: it is preparing what comes next, often a tool call;
 * - in the middle of a text answer: a pause there is the least likely to be healthy;
 * - in the middle of a tool call's arguments: the model is writing, and the more it has
 *   written, the more time it gets (a large file is the case a fixed timeout broke).
 *
 * That base is scaled by the effort the request asks for, doubled on every retry (a retry that
 * gives the model exactly the time that was not enough is a retry that fails the same way), and
 * never less than one and a half times the longest silence this session has seen end well. It
 * stays under the route's own `streamIdleTimeoutMs`, which remains the hard ceiling.
 */

/**
 * The stream timeout bruine writes into the routes it creates: a ceiling, not a budget. The real
 * limit is the adaptive budget below, which is usually much shorter; the ceiling only has to leave
 * it room to grow for a large file at a high effort on a late retry. A route without one keeps the
 * adapters' five minutes, and a value the user set is theirs.
 */
export const STREAM_CEILING_MS = 15 * 60 * 1000;

/** What the stream was doing when it went quiet. */
export type SilencePhase = "waiting" | "thinking" | "preparing" | "answering" | "calling";

export interface SilenceState {
  phase: SilencePhase;
  /** The tool whose arguments are streaming, in the `calling` phase. */
  tool?: string;
  /** Argument characters received so far for that tool call. */
  toolChars: number;
  /** The reasoning effort the request asked for. */
  effort?: string;
  /** Retries already made for this step (0 on the first attempt). */
  retry: number;
  /** The longest silence this session has seen that ended with the stream going on. */
  survived: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** The base budget per phase, before effort and retries. */
export const PHASE_BUDGET_MS: Record<SilencePhase, number> = {
  waiting: 2 * MINUTE,
  thinking: 90 * SECOND,
  preparing: 3 * MINUTE,
  answering: 60 * SECOND,
  calling: 2 * MINUTE,
};

/** Extra time per thousand characters of tool arguments already written (a file being written). */
export const PER_THOUSAND_CHARS_MS = 6 * SECOND;
/** The most the size of a tool call adds on its own. */
export const MAX_SIZE_BONUS_MS = 10 * MINUTE;
/** Never give a stream less than this, whatever the scaling says. */
export const MIN_BUDGET_MS = 20 * SECOND;

/** How much longer a model may think at a higher effort. */
export function effortFactor(effort: string | undefined): number {
  switch (effort) {
    case "high":
      return 1.5;
    case "xhigh":
      return 2;
    case "max":
      return 2.5;
    default:
      return 1;
  }
}

/**
 * The silence budget, in milliseconds, for a stream in `state`, under the route's `ceiling`.
 * `scale` shrinks or stretches every duration (tests and the `BRUINE_SILENCE_SCALE` knob).
 */
export function silenceBudget(state: SilenceState, ceiling: number, scale = 1): number {
  let base = PHASE_BUDGET_MS[state.phase];
  if (state.phase === "calling") base += Math.min(MAX_SIZE_BONUS_MS, (state.toolChars / 1000) * PER_THOUSAND_CHARS_MS);
  const grown = base * effortFactor(state.effort) * 2 ** Math.max(0, state.retry);
  const learned = state.survived * 1.5;
  const budget = Math.max(grown * scale, learned, MIN_BUDGET_MS * scale);
  return Math.max(1, Math.min(budget, ceiling));
}

/** The parts of a dsh stream chunk the watchdog reads. */
export interface StreamChunk {
  type: string;
  name?: string;
  argumentsDelta?: string;
  block?: { type?: string };
  blockType?: string;
  reason?: unknown;
}

/** The phase a chunk leaves the stream in, and what it adds to the open tool call. */
export function advance(state: SilenceState, chunk: StreamChunk): SilenceState {
  switch (chunk.type) {
    case "reasoning-delta":
      return { ...state, phase: "thinking" };
    case "text-delta":
      return { ...state, phase: "answering" };
    case "tool-call-delta": {
      const fresh = chunk.name !== undefined && chunk.name !== state.tool;
      return {
        ...state,
        phase: "calling",
        tool: chunk.name ?? state.tool,
        toolChars: (fresh ? 0 : state.toolChars) + (chunk.argumentsDelta?.length ?? 0),
      };
    }
    case "block-end":
      // The thought is over and nothing has started yet: the model is preparing what comes next.
      return chunk.block?.type === "reasoning" ? { ...state, phase: "preparing" } : state;
    default:
      return state;
  }
}

/** A short human duration: 45s, 3m, 2m 30s. */
export function formatSilence(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${String(m)}m` : `${String(m)}m ${String(rest)}s`;
}

/** The code dsh's retry loop treats as "try again" (dsh-llm DEFAULT_RETRYABLE_CODES). */
export const SILENCE_FAILURE_CODE = "TIMEOUT";

/** The terminal chunk a stream ends with when bruine gives up on its silence. */
export function silenceFinish(quietMs: number): StreamChunk & { reason: { kind: "error"; failure: { code: string; message: string; silenceMs: number } } } {
  return {
    type: "finish",
    reason: {
      kind: "error",
      failure: { code: SILENCE_FAILURE_CODE, message: `no answer from the model for ${formatSilence(quietMs)}`, silenceMs: quietMs },
    },
  };
}

export interface WatchOptions {
  /** The state the stream starts in (its effort, the retry it is). */
  start: SilenceState;
  /** The budget for a state. */
  budget: (state: SilenceState) => number;
  now?: () => number;
  /** Told whenever the stream's state or quiet start changes, for the UI. */
  onState?: (state: SilenceState, quietSince: number, budget: number) => void;
  /** Told when a silence ended with more of the stream (how long it was). */
  onResumed?: (quietMs: number) => void;
  /** Told when the watchdog gave up. */
  onGiveUp?: (quietMs: number, state: SilenceState) => void;
}

/**
 * The stream, unchanged, unless it stays silent past its budget: then the upstream request is
 * closed and the stream ends with a retryable failure, which dsh's retry loop picks up.
 */
export async function* watchSilence<T extends StreamChunk>(source: AsyncIterable<T>, opts: WatchOptions): AsyncGenerator<T | ReturnType<typeof silenceFinish>> {
  const now = opts.now ?? Date.now;
  const iterator = source[Symbol.asyncIterator]();
  let state = opts.start;
  let quietSince = now();
  let done = false;
  try {
    while (true) {
      const budget = opts.budget(state);
      opts.onState?.(state, quietSince, budget);
      const left = Math.max(0, quietSince + budget - now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), left);
      });
      const next = iterator.next();
      let result: IteratorResult<T> | "timeout";
      try {
        result = await Promise.race([next, timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (result === "timeout") {
        const quiet = now() - quietSince;
        opts.onGiveUp?.(quiet, state);
        // Close the request; its eventual rejection belongs to nobody now.
        next.catch(() => undefined);
        void Promise.resolve(iterator.return?.(undefined)).catch(() => undefined);
        done = true;
        yield silenceFinish(quiet);
        return;
      }
      if (result.done === true) {
        done = true;
        return;
      }
      const at = now();
      const quiet = at - quietSince;
      if (quiet >= 1000) opts.onResumed?.(quiet);
      quietSince = at;
      state = advance(state, result.value);
      yield result.value;
    }
  } finally {
    if (!done) await Promise.resolve(iterator.return?.(undefined)).catch(() => undefined);
  }
}
