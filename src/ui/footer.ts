import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { clipStart } from "../render/reasoning.js";
import { ansi } from "./theme.js";
import { bgEnabled, onBg, paint, type PaletteRole } from "./palette.js";
import { displayPlace } from "./place.js";
import { terminalMotionAllowed } from "./logo-motion.js";

/** The breathing room between the two ends of a row, in cells. */
const GAP = 2;
const TOKEN_SETTLE_MS = 650;
type TokenReadings = Pick<FooterState, "inputTokens" | "outputTokens">;

export interface FooterState {
  contextUsed?: number;
  contextWindow?: number;
  model?: string;
  modelName?: string;
  provider?: string;
  effort?: string;
  tps?: number;
  /** A live text-volume estimate, explicitly marked with ~. */
  tpsEstimated?: boolean;
  pp?: number;
  cachePct?: number;
  cacheFirst?: boolean;
  /** Mode badges (PLAN / FULL ACCESS), set by the modes layer (T16). */
  badges?: string[];
  /**
   * D3: where the tools run. Unset means the directory kumo was started in, so a
   * session says where it is without anything having to wire it first.
   */
  cwd?: string;
  /** D3: the branch under that directory, when it is a repository. */
  gitBranch?: string;
  /** D3: tokens written into the session's prompts (↑) and read back out of them (↓). */
  inputTokens?: number;
  outputTokens?: number;
  /** D3: tokens served out of the prompt cache (R) — the session total behind CH. */
  cacheRead?: number;
  /** Running agents owned by this conversation. */
  subagents?: number;
}

function formatK(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(n);
}

function formatPct(used: number, window: number): string {
  const pct = (used / window) * 100;
  if (pct === 0) return "0";
  return pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
}

/**
 * A cache hit rate: one decimal, because the whole reading is in the last one.
 * `99.9%` and `100%` are different facts about a prompt cache.
 */
function formatHit(pct: number): string {
  return pct >= 100 ? "100" : pct.toFixed(1);
}

/** A context window, the way a person says one: `131k`, `1.0M`. */
function formatWindow(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : formatK(n);
}

/**
 * A token count as `259.0K` (T55). One decimal at every scale, so a column of
 * them lines up: `9.5K`, `259.0K`, `1.0M`.
 */
export function formatVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}


/** Display model: settings name, else basename without .gguf, never a full path. */
export function displayModel(id?: string, name?: string): string {
  if (name !== undefined && name.trim() !== "") return name;
  if (id === undefined || id === "") return "no model";
  const base = id.split(/[\\/]/).at(-1) ?? id;
  return base.replace(/\.gguf$/i, "");
}

/**
 * The branch a repository is on, read out of `.git/HEAD`.
 *
 * The footer's first row says where the tools run, and inside a repository the
 * other half of that is which branch: a session on `main` and a session on a
 * feature branch touch the same files in opposite ways, and only one of them is
 * what the user meant.
 *
 * Read once at startup and again on a directory change, never during a render —
 * the frame is painted on every keystroke, and a syscall per keystroke is how a
 * status bar becomes the slowest thing in the app. No subprocess either: `git` is
 * not always installed, is not always on the PATH a GUI-launched terminal hands
 * over, and a label is not worth a dependency.
 *
 * `.git` is a file in a worktree or a submodule and then it names the real
 * directory; a detached HEAD is a commit rather than a branch, so there is nothing
 * to say; outside a repository, nothing either.
 */
export function readGitBranch(cwd: string): string | undefined {
  const head = (gitDir: string): string | undefined => {
    try {
      // `ref: refs/heads/main` is a branch. Anything else here is a commit id.
      return /^ref:\s*refs\/heads\/(.+)$/.exec(readFileSync(join(gitDir, "HEAD"), "utf8").trim())?.[1];
    } catch {
      return undefined;
    }
  };
  try {
    const dot = join(cwd, ".git");
    if (statSync(dot).isDirectory()) return head(dot);
    const at = /^gitdir:\s*(.+)$/.exec(readFileSync(dot, "utf8").trim())?.[1];
    return at === undefined ? undefined : head(isAbsolute(at) ? at : join(cwd, at));
  } catch {
    return undefined;
  }
}

/**
 * A name that has to give up its head, by the same rule a path on screen follows:
 * `…/jets/kumo` still names the directory, `…/jets` names the wrong one.
 */
export function shortenHead(text: string, cells: number, ascii = false): string {
  return clipStart(text, cells, ascii ? "..." : "\u2026");
}

/**
 * `left` at the margin, `right` flush to the edge, on one row.
 *
 * Measured, never guessed: the footer is the last thing on the screen, so a
 * reading that does not fit is dropped before the row is written rather than cut
 * out of a rendered string.
 */
function twoUp(left: string, right: string, width: number): string {
  const rw = visibleWidth(right);
  if (rw === 0) return truncateToWidth(left, width);
  if (rw >= width) return truncateToWidth(right, width);
  const lw = visibleWidth(left);
  if (lw === 0) return " ".repeat(width - rw) + right;
  const room = width - rw - GAP;
  const head = truncateToWidth(left, room);
  return `${head}${" ".repeat(GAP + room - visibleWidth(head))}${right}`;
}

/**
 * D3 — the footer's three rows: where you are, what the turn cost, how fast it
 * arrived.
 *
 * The defect: one row had to be mode, badges, context meter, prefill rate, cache,
 * route and effort at once, so every one of them was abbreviated until none of them
 * could be read (`ask  ctx ████░░░░░░ 16.1K (12%) pp 1.2k tok/s cache 97%
 * (local) Ornith-1.5-9B-Q4_K_M  effort low`) — and the directory the tools were
 * about to touch was not on it at all. Three rows say the same three facts with room
 * to be read:
 *
 *     ~/Bureau  ⎇ main                              FULL ACCESS
 *     ↑17k ↓749  cached 34k · hit 99.9%  ctx 12% of 131k  Ornith-1.5-9B-Q4_K_M • high
 *     ↯ TPS: 78.0 tok/s
 *
 * The context bar left with the row on purpose: a bar is a shape, and a shape costs
 * a reading twice — once as the bar and once as the number beside it. The row is
 * the only place the window is on screen, as `ctx 12% of 131k`.
 *
 * `↑ ↓` are the session's totals — every token this conversation has written and
 * read back — counted the way pi's status line counts them (`spend.ts`), so they
 * survive a compaction and a resumed session. `cached` is the session total the
 * cache served and `hit` the rate of the latest call, because a rate averaged over
 * a session says how the last hour went and not how well the cache is working now.
 *
 * The labels are a luxury, not a reading: a row too narrow for `cached 34k` keeps
 * the letters (`R34k CH99.9%`) and loses nothing but the words. A narrow terminal
 * then gives up the cache and context before the route. Measured decode and
 * prefill rates keep their own rows when necessary, independently of that squeeze.
 */
export class FooterComponent implements Component {
  state: FooterState = {};
  /** The ASCII icon set is the marker of an ASCII terminal: no glyph, no colour. */
  #ascii: boolean;
  #cwd: string;
  #home: string;
  #branch: string | undefined;
  #heldTokens: TokenReadings | undefined;
  #prefillMotion: { target: number; startedAt: number } | undefined;
  #tokenMotion: { from: TokenReadings; to: TokenReadings; startedAt: number } | undefined;

  constructor(icons: KumoIcons = kumoIcons(), opts: { cwd?: string; home?: string } = {}) {
    this.#ascii = icons.think === "*";
    // Read once: the frame is painted on every keystroke, and a render must not be
    // a syscall. A directory change in the session arrives through `set`.
    this.#cwd = (opts.cwd ?? process.cwd()).trim();
    this.#home = opts.home ?? homedir();
    this.#branch = readGitBranch(this.#cwd);
  }

  set(next: FooterState): void {
    // The branch belongs to the directory, so it is re-read when the directory
    // changes and never otherwise — `set` is called on every usage chunk.
    const moved = next.cwd !== undefined && next.cwd !== (this.state.cwd ?? this.#cwd);
    const countKeys = ["inputTokens", "outputTokens"] as const;
    if (countKeys.some(key => Object.hasOwn(next, key) && next[key] !== this.state[key])) {
      this.#tokenMotion = undefined;
      if (countKeys.some(key => Object.hasOwn(next, key) && this.state[key] !== undefined &&
        (next[key] === undefined || next[key]! < this.state[key]!))) this.#heldTokens = undefined;
    }
    if (Object.hasOwn(next, "pp") && next.pp !== this.state.pp) this.#prefillMotion = undefined;
    this.state = { ...this.state, ...next };
    if (moved) this.#branch = readGitBranch(this.state.cwd ?? this.#cwd);
  }

  /** Keep the previous totals visible until the answer is complete. */
  beginTurn(): void {
    if (this.#heldTokens) return;
    this.#heldTokens = { ...this.#displayTokens() };
    this.#tokenMotion = undefined;
    this.#prefillMotion = undefined;
  }

  /** Settle the two displayed counters without changing the reported totals. */
  endTurn(): void {
    const from = this.#heldTokens;
    this.#heldTokens = undefined;
    if (!from) return;
    const to = { inputTokens: this.state.inputTokens, outputTokens: this.state.outputTokens };
    const changed = from.inputTokens !== to.inputTokens || from.outputTokens !== to.outputTokens;
    const animate = terminalMotionAllowed({ ascii: this.#ascii });
    const pp = this.state.pp;
    this.#prefillMotion = animate && pp !== undefined && Number.isFinite(pp) && pp > 0
      ? { target: pp, startedAt: Date.now() } : undefined;
    this.#tokenMotion = changed && animate
      ? { from, to, startedAt: Date.now() } : undefined;
  }

  get active(): boolean {
    return [this.#tokenMotion, this.#prefillMotion].some(motion =>
      motion !== undefined && Date.now() - motion.startedAt < TOKEN_SETTLE_MS);
  }

  #displayTokens(): TokenReadings {
    if (this.#heldTokens) return this.#heldTokens;
    const motion = this.#tokenMotion;
    if (!motion) return { inputTokens: this.state.inputTokens, outputTokens: this.state.outputTokens };
    const progress = Math.min(1, Math.max(0, (Date.now() - motion.startedAt) / TOKEN_SETTLE_MS));
    if (progress === 1) return { inputTokens: this.state.inputTokens, outputTokens: this.state.outputTokens };
    const eased = 1 - (1 - progress) ** 3;
    const count = (key: keyof TokenReadings): number | undefined => {
      const target = motion.to[key];
      if (target === undefined) return undefined;
      const initial = motion.from[key] ?? 0;
      return Math.round(initial + (target - initial) * eased);
    };
    return { inputTokens: count("inputTokens"), outputTokens: count("outputTokens") };
  }

  #displayPrefill(): number | undefined {
    if (this.#heldTokens) return undefined;
    const motion = this.#prefillMotion;
    if (!motion) return this.state.pp;
    const progress = Math.min(1, Math.max(0, (Date.now() - motion.startedAt) / TOKEN_SETTLE_MS));
    return progress === 1 ? this.state.pp : motion.target * (1 - (1 - progress) ** 3);
  }

  render(width: number): string[] {
    const w = Math.max(1, width);
    const place = this.#placeRow(w);
    const turn = this.#turnRow(w);
    const rows = [place, turn.line];
    const count = this.state.subagents ?? 0;
    const agents = count > 0 ? this.#ink("sky")(`subagents ${Math.floor(count)}`) : "";
    const firstRoom = agents ? Math.max(1, w - visibleWidth(agents) - GAP) : w;
    const speeds = this.#speedRows(w, firstRoom);
    if (agents) {
      const first = speeds[0] ?? "";
      if (visibleWidth(first) + GAP + visibleWidth(agents) <= w) {
        rows.push(twoUp(first, agents, w), ...speeds.slice(1));
      } else {
        rows.push(twoUp("", agents, w), ...speeds);
      }
    } else rows.push(...speeds);
    return rows;
  }

  /** Paint in a palette role, unless the terminal cannot read colour. */
  #ink(role: PaletteRole): (s: string) => string {
    return this.#ascii ? (s) => s : (s) => paint(role, s);
  }

  /** `~/Bureau  ⎇ main`, with the mode badges at the other end of the row. */
  #placeRow(width: number): string {
    // One rule for one answer: the place row above the input says it the same way.
    const path = displayPlace(this.state.cwd ?? this.#cwd, this.#home);
    const badges = this.#badges();
    const glyph = this.#ascii ? "#" : "\u2387";
    const branch = (this.state.gitBranch ?? this.#branch ?? "").trim();
    const rest = (name: string): string => (name === "" ? "" : `  ${this.#ink("muted")(`${glyph} ${name}`)}`);
    // The path and the branch give up their heads before anything is dropped, and
    // the badge is the last thing to go: it is the one cell range that says whether
    // the tools need permission, and a half-written one says nothing at all.
    const branchRoom = Math.max(6, width - visibleWidth(path) - visibleWidth(badges) - GAP - glyph.length - 2);
    const branches = branch === "" ? [""] : [...new Set([branch, shortenHead(branch, branchRoom, this.#ascii), ""])];
    for (const name of branches) {
      const tail = rest(name);
      const room = Math.max(4, width - visibleWidth(tail) - visibleWidth(badges) - GAP);
      for (const head of [...new Set([path, shortenHead(path, room, this.#ascii)])]) {
        const left = `${head}${tail}`;
        if (visibleWidth(left) + GAP + visibleWidth(badges) <= width) return twoUp(left, badges, width);
      }
    }
    for (const name of branches) {
      const left = `${path}${rest(name)}`;
      if (visibleWidth(left) <= width) return truncateToWidth(left, width);
    }
    return truncateToWidth(path, width);
  }

  /** Mode badges: what the session is allowed to do, in the order it is read. */
  #badges(): string {
    const badges = this.state.badges ?? ["ask"];
    const mode = badges.find((b) => b !== "plan") ?? "ask";
    const plan = badges.includes("plan");
    if (this.#ascii) return [mode, ...(plan ? ["plan"] : [])].join("  ");
    // A mode is a word, not a chip: the quiet ones are colored text, and FULL ACCESS,
    // the one badge a user has to notice (T23), is bold rose.
    const pill = (text: string, tone: "rose" | "lavender" | "sky" | "muted"): string => {
      if (tone === "muted") return paint("muted", text);
      if (tone === "lavender") return paint("lavender", text);
      if (tone === "rose") return ansi.bold(paint("rose", text));
      return paint("sky", text);
    };
    const painted =
      mode === "ask" ? pill(mode, "muted") : mode === "FULL ACCESS" ? pill(mode, "rose") : pill(mode, "sky");
    return plan ? `${painted}  ${pill("plan", "lavender")}` : painted;
  }

  /**
   * `↑17k ↓749  ·  cached 34k · hit 99.9%  ·  ctx 12% of 131k`, longest
   * reading first. `whole` says the row got every reading, which is what the
   * throughput row is worth a row for.
   *
   * The words come first and the numbers keep the colours that mean something
   * (a cache that stopped answering is rose, a context past 60% is amber), so the
   * row reads as readings rather than as a string of grey symbols.
   */
  #turnRow(width: number): { line: string; whole: boolean } {
    const tiers = this.#metricTiers();
    for (const right of this.#routeCells()) {
      const rw = visibleWidth(right);
      if (rw > width) continue;
      for (const tier of tiers) {
        // The words are a luxury: a labelled reading that does not fit leaves the
        // row with its short form rather than with one reading fewer.
        for (const metrics of [tier.long, tier.short]) {
          // An empty first group is not a squeeze: a session with no reading yet
          // still gets its throughput row.
          if (visibleWidth(metrics) + GAP + rw <= width) {
            return { line: twoUp(metrics, right, width), whole: tier === tiers[0] };
          }
        }
      }
      return { line: twoUp("", right, width), whole: false };
    }
    // Nothing fits whole. A route cut in half is a lie about which model is
    // answering, so the shortest honest version is the one that gets written.
    return { line: truncateToWidth(this.#routeCells().at(-1) ?? "", width), whole: false };
  }

  /**
   * The model, the effort and the local marker, whole first: the route is the
   * session's identity, so the effort goes before the marker that never changes,
   * and the model's own name goes last, because a cut name is not the model.
   */
  #routeCells(): string[] {
    const s = this.state;
    const name = displayModel(s.model, s.modelName);
    const tagged = s.provider === "local" ? `(local) ${name}` : name;
    const dot = this.#ascii ? "-" : "\u2022";
    // T34: `?` until the effort plugin resolves the model's levels, never a guess.
    const effort = s.effort ?? "?";
    if (this.#ascii) return [`${tagged} ${dot} ${effort}`, tagged, `${name} ${dot} ${effort}`, name];
    const head = this.#ink("text");
    const tail = `${this.#ink("faint")(dot)} ${this.#ink("muted")(effort)}`;
    return [`${head(tagged)} ${tail}`, head(tagged), `${head(name)} ${tail}`, head(name)];
  }

  /** `label value`: the label quiet, the value in the role its meaning earns. */
  #read(label: string, value: string, role: PaletteRole = "text"): string {
    return `${this.#ink("muted")(label)} ${this.#ink(role)(value)}`;
  }

  /**
   * The dot that groups two readings of one row. Faint, because it is structure:
   * a separator nobody reads is a separator that costs nothing.
   */
  #dot(inner = false): string {
    const gap = inner ? " " : "  ";
    return `${gap}${this.#ink("faint")(this.#ascii ? "-" : "\u00b7")}${gap}`;
  }

  /**
   * The readings, in the order they may be given up: all of them, then all but
   * the cache, then the arrows alone.
   *
   * Each one is written twice. The long form names what the number is, which is
   * what a reader who has not seen the bar for a month needs; the short form
   * keeps the letters one who has read it for an hour knows. Words never buy the
   * loss of a reading: a bare `R34k` says more than no cache at all.
   */
  #metricTiers(): { long: string; short: string }[] {
    const s = this.state;
    const tokens = this.#displayTokens();
    const up = this.#ascii ? "^" : "\u2191";
    const down = this.#ascii ? "v" : "\u2193";
    const io = [
      tokens.inputTokens === undefined ? undefined : this.#ink("text")(`${up}${formatK(tokens.inputTokens)}`),
      tokens.outputTokens === undefined ? undefined : this.#ink("text")(`${down}${formatK(tokens.outputTokens)}`),
    ].filter((part): part is string => part !== undefined).join(" ");
    // The cache answers twice: how much the session was served, and how well the
    // last call hit. One label each, so the two are never confused for one.
    const served = s.cacheRead === undefined
      ? { long: undefined, short: undefined }
      : { long: this.#read("cached", formatK(s.cacheRead)), short: this.#ink("muted")(`R${formatK(s.cacheRead)}`) };
    const hitRole: PaletteRole = s.cachePct === undefined
      ? "text"
      : s.cacheFirst === true
        ? "muted"
        : s.cachePct >= 80
          ? "mint"
          : s.cachePct >= 30
            ? "amber"
            : "rose";
    const hit = s.cachePct === undefined
      ? { long: undefined, short: undefined }
      : { long: this.#read("hit", `${formatHit(s.cachePct)}%`, hitRole), short: this.#ink(hitRole)(`CH${formatHit(s.cachePct)}%`) };
    const cache = {
      long: [served.long, hit.long].filter((part) => part !== undefined).join(this.#dot(true)),
      short: [served.short, hit.short].filter((part) => part !== undefined).join(" "),
    };
    // T31.5: the reading is in the colour as much as in the digits — mint under
    // 60%, amber to 74%, rose from 75%, where the next turn starts costing more.
    const window = s.contextWindow;
    const used = s.contextUsed ?? 0;
    const share = window === undefined || window <= 0 ? 0 : (used / window) * 100;
    const ctxRole: PaletteRole = share >= 75 ? "rose" : share >= 60 ? "amber" : "mint";
    const context = window === undefined || window <= 0
      ? { long: undefined, short: undefined }
      : {
        long: this.#read("ctx", `${formatPct(used, window)}% of ${formatWindow(window)}`, ctxRole),
        short: this.#ink(ctxRole)(`${formatPct(used, window)}%/${formatWindow(window)}`),
      };
    const row = (...readings: { long: string | undefined; short: string | undefined }[]): { long: string; short: string } => ({
      // The dots are a luxury too: the short form is the letters and nothing
      // else, so a narrow terminal loses exactly the readings it lost before.
      long: readings.map((r) => r.long).filter((part) => part !== undefined && part !== "").join(this.#dot()),
      short: readings.map((r) => r.short).filter((part) => part !== undefined && part !== "").join(" "),
    });
    const both = { long: io, short: io };
    return [row(both, cache, context), row(both, context), both];
  }

  /** Keep each measured rate readable, independently of the other readings. */
  #speedRows(width: number, firstRoom: number): string[] {
    const s = this.state;
    const bolt = this.#ascii ? "*" : "\u21af";
    const rates: string[] = [];
    if (s.tps !== undefined && Number.isFinite(s.tps) && s.tps > 0) {
      rates.push(`${this.#ink("faint")(bolt)} ${this.#ink("muted")("TPS:")} ${this.#ink("sky")(`${s.tpsEstimated ? "~" : ""}${s.tps.toFixed(1)}`)} ${this.#ink("muted")("tok/s")}`);
    }
    const pp = this.#displayPrefill();
    if (pp !== undefined && Number.isFinite(pp) && pp > 0) {
      rates.push(this.#ink("muted")(`prefill ${formatK(Math.round(pp * 10) / 10)} tok/s`));
    }
    if (rates.length === 0) return [];
    const together = rates.join("  ");
    return visibleWidth(together) <= firstRoom ? [together] : rates.map(rate => truncateToWidth(rate, width));
  }

  invalidate(): void {
    // Stateless render.
  }
}