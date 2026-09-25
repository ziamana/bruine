/**
 * Honest throughput (ARCHITECTURE §0): kumo computes tokens/s from its own
 * sample timestamps — never copies dsh's figure. Per LLM call (T25.1):
 * t0 = first delta, t1 = last delta, n = usage.outputTokens (or delta count
 * estimate when no usage). Decode TPS = n / (t1 - t0), shown for the LAST
 * finished call. Live during a call: deltas so far / (now - t0).
 * Prefill pp = new input tokens / (t0 - request start), shown only when > 0.
 */
export interface TpsUsage {
  outputTokens?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
}

/** Share of prompt reused (T27.1): cached / total, handling both include styles. */
export function cachePercent(cached: number, totalInput: number): number | undefined {
  if (!Number.isFinite(cached) || !Number.isFinite(totalInput)) return undefined;
  if (cached < 0 || totalInput <= 0) return undefined;
  // llama.cpp/OpenAI: inputTokens includes cached (total). If cached > input,
  // the server excluded it and total is input + cached.
  const total = cached <= totalInput ? totalInput : totalInput + cached;
  if (total <= 0) return undefined;
  return Math.min(100, Math.max(0, (cached / total) * 100));
}

export class TpsMeter {
  #callStart: number | undefined;
  #t0: number | undefined;
  #t1: number | undefined;
  #deltas = 0;
  #tps = 0;
  #pp: number | undefined;
  #cachePct: number | undefined;
  #cacheFirst = false;
  #calls = 0;

  /** Kept for compatibility; prefer startCall/delta/usage/endCall. */
  sample(timeMs: number, outputTokens: number): void {
    this.usage(timeMs, { outputTokens });
  }

  /** Frame start: marks request start for prefill timing. */
  startCall(timeMs: number): void {
    this.#callStart = timeMs;
    this.#t0 = undefined;
    this.#t1 = undefined;
    this.#deltas = 0;
  }

  /** One decode delta (reasoning/text/tool-call) at the given time. */
  delta(timeMs: number): void {
    if (this.#t0 === undefined) {
      this.#t0 = timeMs;
      this.#t1 = timeMs;
      this.#deltas = 1;
      this.#tps = 0;
      return;
    }
    this.#t1 = timeMs;
    this.#deltas += 1;
    const dt = (timeMs - this.#t0) / 1000;
    this.#tps = dt > 0 ? this.#deltas / dt : 0;
  }

  /** Usage chunk at the end of a call: final decode rate + prefill rate. */
  usage(timeMs: number, usage: TpsUsage): void {
    const out = Number(usage.outputTokens ?? NaN);
    const n = Number.isFinite(out) ? Math.max(0, out) : this.#deltas;
    if (this.#t0 !== undefined && this.#t1 !== undefined) {
      const dt = (this.#t1 - this.#t0) / 1000;
      this.#tps = dt > 0 ? n / dt : 0;
    } else if (this.#deltas > 0) {
      this.#tps = 0;
    }
    const inp = Number(usage.inputTokens ?? NaN);
    if (
      Number.isFinite(inp) &&
      this.#t0 !== undefined &&
      this.#callStart !== undefined
    ) {
      const preDt = (this.#t0 - this.#callStart) / 1000;
      const cached = Number(usage.cacheReadTokens ?? 0);
      // pi-ai inputTokens EXCLUDES cached (BOS real capture): fresh = inp.
      // If a server includes cached (cached <= input), fresh = input - cached.
      const fresh = Number.isFinite(cached)
        ? cached > inp
          ? Math.max(0, inp)
          : Math.max(0, inp - cached)
        : Math.max(0, inp);
      this.#pp = preDt > 0 && fresh > 0 ? fresh / preDt : undefined;
    }
    const cachedRaw = Number(usage.cacheReadTokens ?? NaN);
    if (Number.isFinite(cachedRaw) && Number.isFinite(inp)) {
      this.#cachePct = cachePercent(cachedRaw, inp);
      this.#cacheFirst = this.#calls === 0;
    } else {
      this.#cachePct = undefined;
      this.#cacheFirst = false;
    }
  }

  /** Frame end: when no usage arrived, estimate from delta count. */
  endCall(): void {
    if (this.#t0 !== undefined && this.#t1 !== undefined && this.#deltas > 0) {
      // If usage already set a final rate, keep it; otherwise estimate.
      // usage() always runs before endCall when usage exists, so only fill
      // in when tps is still live/zero from deltas alone.
      if (this.#tps === 0) {
        const dt = (this.#t1 - this.#t0) / 1000;
        this.#tps = dt > 0 ? this.#deltas / dt : 0;
      }
    }
    this.#calls += 1;
    this.#callStart = undefined;
    this.#t0 = undefined;
    this.#t1 = undefined;
    this.#deltas = 0;
  }

  reset(): void {
    this.#callStart = undefined;
    this.#t0 = undefined;
    this.#t1 = undefined;
    this.#deltas = 0;
    this.#tps = 0;
    this.#pp = undefined;
    this.#cachePct = undefined;
    this.#cacheFirst = false;
  }

  get tps(): number {
    return this.#tps;
  }

  get pp(): number | undefined {
    return this.#pp;
  }

  get cachePct(): number | undefined {
    return this.#cachePct;
  }

  get cacheFirst(): boolean {
    return this.#cacheFirst;
  }
}
