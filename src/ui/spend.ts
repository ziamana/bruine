/**
 * What a whole conversation has cost, counted the way pi's status line counts
 * it.
 *
 * pi walks every message in its session and adds the usage on it, so `↑` and `↓`
 * on that footer are the totals of the session and not of the request that
 * happened to be last — and they survive a compaction, which replaces the
 * messages but not the tokens already paid for. kumo counts the same total from
 * the reports as they arrive, and the two agree because one report is the
 * accounting of one model call.
 *
 * Three rules keep the number honest:
 *
 * - A report is the running total of the call it belongs to, so what a call adds
 *   is how far it grew since that call's previous report. A server that reports
 *   once at the end adds its whole count; a server that reports as it generates
 *   is counted the same tokens once instead of once per chunk. A count that went
 *   *backwards* cannot be growth of the same call: it is a new one, and its whole
 *   value is added.
 * - A count the server never sent stays unknown. `↑0` because a field was missing
 *   is a lie about a session that has already spent tokens, so a reading appears
 *   only once the server has reported it at least once.
 * - The total belongs to a session. `/new` starts one at nothing and `/resume`
 *   continues the one its log already recorded, because both swap the session
 *   under the same wiring without any of it being re-provisioned.
 */

/** One usage report, in the three counts the row can print. Missing is unknown. */
export interface SpendReport {
  input?: number;
  output?: number;
  cacheRead?: number;
}

/** The row's three token readings; a glyph the server never sent is absent. */
export type SpendReadings = {
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
};

type Count = "input" | "output" | "cacheRead";

interface Totals {
  input: number;
  output: number;
  cacheRead: number;
}

/** A count the server actually sent, or undefined when it sent nothing. */
function reported(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : undefined;
}

/**
 * What a session log already records.
 *
 * Every assistant message in the log carries the usage of the call that wrote
 * it, so a resumed session is read rather than counted a second time as its
 * turns arrive. A log that cannot be read — no history, or none yet — is zero
 * spent rather than a guess.
 */
function loggedUsage(session: unknown): { total: Totals; seen: Record<Count, boolean> } {
  const total: Totals = { input: 0, output: 0, cacheRead: 0 };
  const seen: Record<Count, boolean> = { input: false, output: false, cacheRead: false };
  try {
    const events = (session as { snapshotEvents?: () => unknown } | undefined)?.snapshotEvents?.();
    if (!Array.isArray(events)) return { total, seen };
    for (const event of events as Array<{ type?: string; data?: { usage?: unknown } }>) {
      if (event?.type !== "assistant/message") continue;
      const usage = event.data?.usage as Record<string, unknown> | undefined;
      if (usage === undefined || usage === null) continue;
      const counts: Record<Count, number | undefined> = {
        input: reported(usage.inputTokens),
        output: reported(usage.outputTokens),
        cacheRead: reported(usage.cacheReadTokens),
      };
      for (const key of ["input", "output", "cacheRead"] as const) {
        const value = counts[key];
        if (value === undefined) continue;
        total[key] += value;
        seen[key] = true;
      }
    }
  } catch {
    // An unavailable log leaves the count at what this process reported itself.
  }
  return { total, seen };
}

/** Everything one session has spent, added as the reports arrive. */
export class SessionSpend {
  #session: unknown;
  #total: Totals;
  #seen: Record<Count, boolean>;
  /** The last count each call reported, so growth can be told from a repeat. */
  #call: Totals = { input: 0, output: 0, cacheRead: 0 };

  constructor(session: unknown) {
    this.#session = session;
    const logged = loggedUsage(session);
    this.#total = logged.total;
    this.#seen = logged.seen;
  }

  /** The session these totals belong to; `/new` and `/resume` bring another. */
  get session(): unknown {
    return this.#session;
  }

  /**
   * Move to another session: a new conversation starts at nothing, a resumed one
   * at what its log already recorded. False when it is the session already read.
   */
  follow(session: unknown): boolean {
    if (session === this.#session) return false;
    this.#session = session;
    const logged = loggedUsage(session);
    this.#total = logged.total;
    this.#seen = logged.seen;
    this.beginCall();
    return true;
  }

  /** A model call starts: nothing of this call has been reported yet. */
  beginCall(): void {
    this.#call = { input: 0, output: 0, cacheRead: 0 };
  }

  /** Add one usage report. A count the server did not send is not a zero. */
  add(report: SpendReport): void {
    this.#grow("input", report.input);
    this.#grow("output", report.output);
    this.#grow("cacheRead", report.cacheRead);
  }

  #grow(key: Count, value: number | undefined): void {
    // The one place a count is trusted: a usage report is a number or nothing, and
    // a negative one is a count of nothing rather than of minus five tokens.
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const count = Math.max(0, value);
    const last = this.#call[key];
    this.#call[key] = count;
    this.#total[key] += count >= last ? count - last : count;
    this.#seen[key] = true;
  }

  /**
   * The row's readings. A glyph the session has never been told about reads
   * `undefined`, which is how the footer is told to leave it off the row rather
   * than print a zero.
   */
  get readings(): SpendReadings {
    return {
      inputTokens: this.#seen.input ? this.#total.input : undefined,
      outputTokens: this.#seen.output ? this.#total.output : undefined,
      cacheRead: this.#seen.cacheRead ? this.#total.cacheRead : undefined,
    };
  }
}
