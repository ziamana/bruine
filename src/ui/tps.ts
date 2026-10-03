/**
 * Honest throughput (ARCHITECTURE §0): kumo computes tokens/s from its own
 * sample timestamps — never copies dsh's figure. Per LLM call (T25.1):
 * t0 = first delta, t1 = last delta, n = usage.outputTokens (or delta count
 * estimate when no usage). Decode TPS = n / (t1 - t0), shown for the LAST
 * finished call. Delta counts are a legacy estimate, not a token measurement:
 * measuredTps requires output usage and a usable interval. During streaming,
 * estimatedTps uses received text volume and is explicitly labelled approximate.
 * Prefill pp = new input tokens / (t0 - request start), shown only when > 0.
 */
export interface TpsUsage {
  outputTokens?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
}

// A handful of chunks delivered in one burst cannot establish decode throughput.
const MIN_DECODE_MS = 250;

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
  #measuredTps = 0;
  #estimatedTps = 0;
  #textBytes = 0;
  #firstTextBytes = 0;
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
    this.#measuredTps = 0;
    this.#estimatedTps = 0;
    this.#textBytes = 0;
    this.#firstTextBytes = 0;
    this.#pp = undefined;
  }

  /** One decode delta (reasoning/text/tool-call) at the given time. */
  delta(timeMs: number, text = ""): void {
    this.#textBytes += Buffer.byteLength(text, "utf8");
    if (this.#t0 === undefined) {
      this.#firstTextBytes = this.#textBytes;
      this.#t0 = timeMs;
      this.#t1 = timeMs;
      this.#deltas = 1;
      this.#tps = 0;
      return;
    }
    this.#t1 = timeMs;
    this.#deltas += 1;
    const dt = (timeMs - this.#t0) / 1000;
    this.#tps = dt > 0 ? (this.#deltas - 1) / dt : 0;
    // Roughly four UTF-8 bytes per token. This estimates text, never SSE chunks.
    // Exclude the first buffered payload, whose generation time is unknown.
    const bytes = this.#textBytes - this.#firstTextBytes;
    this.#estimatedTps = dt * 1000 >= MIN_DECODE_MS && Number.isFinite(dt) && bytes > 0
      ? bytes / 4 / dt : 0;
  }

  /** Usage chunk at the end of a call: final decode rate + prefill rate. */
  usage(timeMs: number, usage: TpsUsage): void {
    const out = Number(usage.outputTokens ?? NaN);
    const n = Number.isFinite(out) ? Math.max(0, out) : this.#deltas;
    const decodeMs = this.#t0 !== undefined && this.#t1 !== undefined ? this.#t1 - this.#t0 : 0;
    const measured = Number.isFinite(out) && out > 0 && Number.isFinite(decodeMs) && decodeMs >= MIN_DECODE_MS
      ? out / (decodeMs / 1000) : 0;
    this.#measuredTps = Number.isFinite(measured) ? measured : 0;
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
      // T28b.6: prefill rate only interests when there was real prefill work:
      // hide it below 512 NEW prompt tokens (a cache hit would read 36 tok/s).
      const fresh = Number.isFinite(cached)
        ? cached > inp
          ? Math.max(0, inp)
          : Math.max(0, inp - cached)
        : Math.max(0, inp);
      this.#pp = preDt > 0 && fresh >= 512 ? fresh / preDt : undefined;
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
    this.#measuredTps = 0;
    this.#estimatedTps = 0;
    this.#textBytes = 0;
    this.#firstTextBytes = 0;
    this.#pp = undefined;
    this.#cachePct = undefined;
    this.#cacheFirst = false;
    this.#calls = 0;
  }

  get tps(): number {
    return this.#tps;
  }

  /** Tokens/s backed by model usage; zero means there is no reliable reading. */
  get measuredTps(): number {
    return this.#measuredTps;
  }

  /** Local text-volume estimate for streams that report usage only at the end. */
  get estimatedTps(): number {
    return this.#estimatedTps;
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
