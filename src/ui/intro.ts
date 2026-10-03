import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appEnv, configReadPath } from "../compat.js";
import { DIMENSIONS, EFFECTS, dropTransition, finalFrame, type Cell, type Effect, type Frame } from "./intro-effects.js";
import { LOGO_STOPS } from "./logo-motion.js";
import { blendHex, paint, paintHex } from "./palette.js";

/**
 * The logo's entrance at launch: one effect, or two with a drop between them.
 *
 * It plays in the banner, on the three rows of the mark, while the prompt is already there: it
 * never holds anything back. A key stops it at once, and its last frame is the banner as it
 * stays, so there is no jump when it ends.
 */

/** How long the drop between two effects takes, and the most a whole entrance may last. */
export const DROP_MS = 360;
export const MAX_INTRO_MS = 3800;
/** Chance that an entrance is two effects joined by the drop. */
const CHAIN_CHANCE = 0.4;
const TICK_MS = 50;

export interface IntroStep {
  kind: "effect" | "drop";
  effect?: Effect;
  seed: number;
  ms: number;
}

export interface IntroPlan {
  steps: IntroStep[];
  ms: number;
}

/** Weighted pick, never `skip`: a rare effect is rare, and the same one never plays twice in a row. */
function pickEffect(rng: () => number, skip: ReadonlyArray<string>): Effect {
  const pool = EFFECTS.filter((e) => !skip.includes(e.id));
  const total = pool.reduce((n, e) => n + e.weight, 0);
  let at = rng() * total;
  for (const e of pool) {
    at -= e.weight;
    if (at < 0) return e;
  }
  return pool[pool.length - 1]!;
}

export interface PlanOptions {
  /** An effect id to play, or "random" (the default). */
  pick?: string;
  /** The effect played at the last launch. */
  last?: string;
  rng?: () => number;
}

export function planIntro(opts: PlanOptions = {}): IntroPlan {
  const rng = opts.rng ?? Math.random;
  const pinned = EFFECTS.find((e) => e.id === opts.pick);
  const first = pinned ?? pickEffect(rng, opts.last === undefined ? [] : [opts.last]);
  const steps: IntroStep[] = [{ kind: "effect", effect: first, seed: Math.floor(rng() * 1000), ms: first.ms }];
  let ms = first.ms;
  if (pinned === undefined && rng() < CHAIN_CHANCE) {
    const second = pickEffect(rng, [first.id, ...(opts.last === undefined ? [] : [opts.last])]);
    if (ms + DROP_MS + second.ms <= MAX_INTRO_MS) {
      steps.push({ kind: "drop", seed: 0, ms: DROP_MS }, { kind: "effect", effect: second, seed: Math.floor(rng() * 1000), ms: second.ms });
      ms += DROP_MS + second.ms;
    }
  }
  return { steps, ms };
}

/** The frame `elapsed` milliseconds into the plan; the finished logo once the plan is over. */
export function introFrame(plan: IntroPlan, elapsed: number): Frame {
  if (!(elapsed >= 0)) elapsed = 0;
  let at = 0;
  for (const step of plan.steps) {
    if (elapsed < at + step.ms) {
      const t = (elapsed - at) / step.ms;
      return step.kind === "drop" ? dropTransition(t, finalFrame()) : step.effect!.frame(t, step.seed);
    }
    at += step.ms;
  }
  return finalFrame();
}

const RAINBOW = ["#7dcfff", "#b4a7ff", "#ff9ed2", "#ffd27d", "#a6e3a1"] as const;

function rainbow(hue: number): string {
  const x = Math.max(0, Math.min(1, hue)) * (RAINBOW.length - 1);
  const k = Math.min(RAINBOW.length - 2, Math.floor(x));
  return blendHex(RAINBOW[k]!, RAINBOW[k + 1]!, x - k);
}

/** The colour of the logo's gradient at a column, the same one the banner paints it with. */
function gradientAt(column: number): string {
  const x = (column / Math.max(1, DIMENSIONS.W - 1)) * (LOGO_STOPS.length - 1);
  const k = Math.min(LOGO_STOPS.length - 2, Math.floor(x));
  return blendHex(LOGO_STOPS[k]!, LOGO_STOPS[k + 1]!, x - k);
}

function paintCell(cell: Cell, column: number): string {
  if (cell.ch === " ") return " ";
  switch (cell.tone) {
    case "base": return paintHex(gradientAt(column), cell.ch);
    case "dim": return paint("faint", cell.ch);
    case "mist": return paint("muted", cell.ch);
    case "accent": return paint("sky", cell.ch);
    case "bright": return paint("text", cell.ch);
    case "rainbow": return paintHex(rainbow(cell.hue ?? 0.5), cell.ch);
  }
}

/** The three rows of a frame as coloured text, each exactly the mark's width. */
export function renderIntroRows(frame: Frame): [string, string, string] {
  const rows = frame.map((row) => row.map((cell, column) => paintCell(cell, column)).join(""));
  return [rows[0]!, rows[1]!, rows[2]!];
}

/** The effect asked for by the user: `BRUINE_INTRO`, else the `intro` key of the config. */
export function introSetting(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = appEnv("INTRO", env);
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv.trim().toLowerCase();
  try {
    const file = configReadPath(home);
    if (existsSync(file)) {
      const doc = JSON.parse(readFileSync(file, "utf8")) as { intro?: unknown };
      if (typeof doc.intro === "string" && doc.intro.trim() !== "") return doc.intro.trim().toLowerCase();
    }
  } catch {
    // an unreadable config is no setting
  }
  return "random";
}

const LAST_FILE = ".intro-last";

export function readLastIntro(home: string): string | undefined {
  try {
    const id = readFileSync(join(home, LAST_FILE), "utf8").trim();
    return EFFECTS.some((e) => e.id === id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Best effort: failing to remember only means the same effect may come twice. */
export function rememberIntro(home: string, id: string): void {
  try {
    writeFileSync(join(home, LAST_FILE), `${id}\n`);
  } catch {
    // read-only home
  }
}

/** Plays a plan on a timer and says what the banner's rows are right now. */
export class IntroPlayer {
  #startedAt = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #done = false;

  constructor(
    readonly plan: IntroPlan,
    private readonly onTick: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** Which effects are playing, in order (for tests and the one-line "playing" note). */
  get effects(): string[] {
    return this.plan.steps.flatMap((s) => (s.effect === undefined ? [] : [s.effect.id]));
  }

  get active(): boolean {
    return !this.#done;
  }

  start(): void {
    this.#startedAt = this.now();
    this.#timer = setInterval(() => {
      if (this.now() - this.#startedAt >= this.plan.ms) this.#finish();
      this.onTick();
    }, TICK_MS);
    this.#timer.unref?.();
  }

  /** A key was pressed, or the session is closing: the logo is whole now. */
  skip(): void {
    if (this.#done) return;
    this.#finish();
    this.onTick();
  }

  #finish(): void {
    this.#done = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** The banner's mark right now, or undefined once it is over (the banner then draws it itself). */
  rows(): [string, string, string] | undefined {
    if (this.#done) return undefined;
    return renderIntroRows(introFrame(this.plan, this.now() - this.#startedAt));
  }
}
