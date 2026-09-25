/**
 * Honest throughput (ARCHITECTURE §0): kumo computes tokens/s from its own
 * sample timestamps — never copies dsh's figure. Samples come from the
 * `usage` stream chunks (cumulative output tokens + frame time).
 */
export class TpsMeter {
  #lastTime: number | undefined;
  #lastTokens = 0;
  #tps = 0;
  #samples = 0;

  sample(timeMs: number, outputTokens: number): void {
    if (this.#lastTime !== undefined && timeMs > this.#lastTime) {
      const dt = (timeMs - this.#lastTime) / 1000;
      const dTok = Math.max(0, outputTokens - this.#lastTokens);
      const inst = dTok / dt;
      // Light exponential moving average so a single chunk burst is smoothed.
      this.#tps = this.#samples === 0 ? inst : this.#tps * 0.7 + inst * 0.3;
      this.#samples += 1;
    }
    this.#lastTime = timeMs;
    this.#lastTokens = outputTokens;
  }

  reset(): void {
    this.#lastTime = undefined;
    this.#lastTokens = 0;
    this.#tps = 0;
    this.#samples = 0;
  }

  get tps(): number {
    return this.#tps;
  }
}
