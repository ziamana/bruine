import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { appEnv, runtimeHome } from "../compat.js";
import { silenceBudget, watchSilence, type SilenceState, type StreamChunk } from "../llm/silence.js";
import { currentEffortName } from "../ui/rain.js";
import type { DshContext } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "bruine-silence";

/** Service the UI reads to say how long the model has been quiet, and until when it waits. */
export const BRUINE_SILENCE_SERVICE = "bruineSilence";

/** The adapters' own stream timeout when a route sets none (dsh-llm-pi-ai, dsh-llm-deepseek). */
export const ADAPTER_DEFAULT_CEILING_MS = 300_000;

export interface SilenceReading {
  /** When the stream last said something (epoch ms). */
  quietSince: number;
  /** How long it may stay quiet from then. */
  budget: number;
  state: SilenceState;
}

export interface BruineSilenceService {
  /** The live stream of a session, while one is open. */
  reading(sessionId: string | undefined): SilenceReading | undefined;
}

/**
 * The route's `streamIdleTimeoutMs`, the adapter's hard ceiling, from settings.yaml (re-read when
 * the file changes, since dsh hot-reloads it too).
 */
function ceilingReader(home: () => string): (provider: string | undefined) => number {
  let cache: { mtime: number; doc: any } | undefined;
  return (provider) => {
    try {
      const file = join(home(), "settings.yaml");
      if (!existsSync(file)) return ADAPTER_DEFAULT_CEILING_MS;
      const mtime = statSync(file).mtimeMs;
      if (cache?.mtime !== mtime) cache = { mtime, doc: parseYaml(readFileSync(file, "utf8")) };
      const doc = cache.doc;
      const value = provider === undefined ? undefined : (doc?.["llm-pi-ai"]?.providers?.[provider]?.streamIdleTimeoutMs ?? doc?.["llm-deepseek"]?.streamIdleTimeoutMs);
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : ADAPTER_DEFAULT_CEILING_MS;
    } catch {
      return ADAPTER_DEFAULT_CEILING_MS;
    }
  };
}

/**
 * An adaptive silence budget on every model stream (src/llm/silence.ts): a stream quiet past it
 * ends with a retryable `TIMEOUT`, which dsh's own retry loop takes from there, each retry with a
 * longer budget than the last. `BRUINE_SILENCE=off` leaves the adapters' fixed timeout alone;
 * `BRUINE_SILENCE_SCALE` stretches or shrinks every duration (tests).
 */
export function apply(ctx: DshContext): void {
  const enabled = appEnv("SILENCE") !== "off";
  const scale = Number(appEnv("SILENCE_SCALE") ?? "1");
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const ceilingOf = ceilingReader(() => runtimeHome());
  /** Retries made for the current step, per session (as dsh-llm-retry counts them). */
  const retries = new Map<string, number>();
  /** The live reading per session. */
  const readings = new Map<string, SilenceReading>();
  /** The longest silence that ended well, this process. */
  let survived = 0;

  const service: BruineSilenceService = {
    reading: (sessionId) => (sessionId === undefined ? undefined : readings.get(sessionId)),
  };
  ctx.provide(BRUINE_SILENCE_SERVICE, service);

  ctx.on("session/event", (session: { id?: unknown } | undefined, event: { type: string; data?: { retry?: unknown } }) => {
    const id = session?.id === undefined ? undefined : String(session.id);
    if (id === undefined) return;
    if (event.type === "llm/retry" && typeof event.data?.retry === "number") retries.set(id, event.data.retry);
    else if (event.type === "step/start" || event.type === "turn/end") retries.delete(id);
  });

  if (!enabled) return;
  ctx.on(
    "llm/stream",
    (options: { provider?: string; sessionId?: unknown; reasoningEffort?: string }, next: () => AsyncIterable<StreamChunk>) => {
      const source = next();
      const id = options.sessionId === undefined ? undefined : String(options.sessionId);
      const ceiling = ceilingOf(options.provider);
      const start: SilenceState = {
        phase: "waiting",
        toolChars: 0,
        effort: options.reasoningEffort ?? currentEffortName(),
        retry: id === undefined ? 0 : (retries.get(id) ?? 0),
        survived,
      };
      const watched = watchSilence(source, {
        start,
        budget: (state) => silenceBudget({ ...state, survived }, ceiling, factor),
        onState: (state, quietSince, budget) => {
          if (id !== undefined) readings.set(id, { quietSince, budget, state });
        },
        onResumed: (quiet) => {
          survived = Math.max(survived, quiet);
        },
      });
      // The reading belongs to the open stream only.
      return (async function* () {
        try {
          yield* watched;
        } finally {
          if (id !== undefined) readings.delete(id);
        }
      })();
    },
    { global: true },
  );
}
