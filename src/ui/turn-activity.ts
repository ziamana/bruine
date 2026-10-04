export type WorkingState = "Working" | "Waiting for model" | "Thinking";

/** One clock and explicit activity state for the current turn. */
export class TurnActivity {
  #active = false;
  #state: WorkingState = "Waiting for model";
  #startedAt = 0;
  #stoppedAt: number | undefined;
  #heldAt: number | undefined;
  #listeners = new Set<() => void>();
  constructor(private now: () => number = Date.now) {}
  get active(): boolean { return this.#active; }
  get state(): WorkingState { return this.#state; }
  get startedAt(): number { return this.#startedAt; }
  /** The turn's own time: the minutes it waited on a person are not the agent's. */
  get elapsed(): number { return Math.max(0, (this.#heldAt ?? this.now()) - this.#startedAt); }
  /** Waiting on the person at the keyboard (an approval): the clock is paused. */
  get held(): boolean { return this.#heldAt !== undefined; }
  /** Milliseconds since the turn ended; undefined while it runs or before the first one. */
  get sinceStop(): number | undefined { return this.#stoppedAt === undefined ? undefined : Math.max(0, this.now() - this.#stoppedAt); }
  start(state: WorkingState = "Waiting for model"): void {
    if (!this.#active) { this.#startedAt = this.now(); this.#stoppedAt = undefined; this.#active = true; }
    this.#state = state;
    this.changed();
  }
  setState(state: WorkingState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.changed();
  }
  /** Pause the clock while the turn waits on a person; release() starts it again where it was. */
  hold(): void {
    if (!this.#active || this.#heldAt !== undefined) return;
    this.#heldAt = this.now();
    this.changed();
  }
  release(): void {
    if (this.#heldAt === undefined) return;
    this.#startedAt += Math.max(0, this.now() - this.#heldAt);
    this.#heldAt = undefined;
    this.changed();
  }
  stop(): void {
    this.#heldAt = undefined;
    if (!this.#active) return;
    this.#active = false;
    this.#stoppedAt = this.now();
    this.changed();
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  private changed(): void { for (const listener of this.#listeners) listener(); }
}
