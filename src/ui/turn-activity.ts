export type WorkingState = "Working" | "Waiting for model" | "Thinking";

/** One clock and explicit activity state for the current turn. */
export class TurnActivity {
  #active = false;
  #state: WorkingState = "Waiting for model";
  #startedAt = 0;
  #listeners = new Set<() => void>();
  constructor(private now: () => number = Date.now) {}
  get active(): boolean { return this.#active; }
  get state(): WorkingState { return this.#state; }
  get startedAt(): number { return this.#startedAt; }
  get elapsed(): number { return Math.max(0, this.now() - this.#startedAt); }
  start(state: WorkingState = "Waiting for model"): void {
    if (!this.#active) { this.#startedAt = this.now(); this.#active = true; }
    this.#state = state;
    this.changed();
  }
  setState(state: WorkingState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.changed();
  }
  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.changed();
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  private changed(): void { for (const listener of this.#listeners) listener(); }
}
