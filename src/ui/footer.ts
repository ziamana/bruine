import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { clipStart } from "../render/reasoning.js";
import { ansi } from "./theme.js";
import { bgEnabled, onBg, paint, type PaletteRole } from "./palette.js";
import { SpeedHistory } from "./dock.js";

/** The breathing room between the two ends of a row, in cells. */
const GAP = 2;

export interface FooterState {
  contextUsed?: number;
  contextWindow?: number;
  model?: string;
  modelName?: string;
  provider?: string;
  effort?: string;
  tps?: number;
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
  /** D3: tokens written into the last request (↑) and read back out of it (↓). */
  inputTokens?: number;
  outputTokens?: number;
  /** D3: tokens served out of the prompt cache (R) — the count behind CH. */
  cacheRead?: number;
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
 * The working directory the way a person names it: home is a `~`.
 *
 * The same answer `displayPlace` gives for the row above the input, kept here so
 * the footer can say it without importing a component's rules from three files
 * away. A directory outside home keeps its full path, because shortening it would
 * name somewhere else.
 */
export function displayCwd(cwd: string, home: string): string {
  const root = home.replace(/[\\/]+$/, "");
  const path = cwd === "" ? root : cwd;
  if (root === "" || path === root) return "~";
  if (!path.startsWith(root.endsWith("/") ? root : `${root}/`)) return path;
  const rest = path.slice(root.length).replace(/^[\\/]/, "");
  return rest === "" ? "~" : `~/${rest.split(/[\\/]/).join("/")}`;
}

/**
 * A name that has to give up its head, by the same rule the `PlaceRow` above the
 * input uses: `…/jets/kumo` still names the directory, `…/jets` names the wrong one.
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
 *     ↑17k ↓749 R34k CH99.9% 12%/131k   Ornith-1.5-9B • high
 *     ↯ TPS: 78.0 tok/s
 *
 * The context bar left with the row on purpose: a bar is a shape, and a shape costs
 * a reading twice — once as the bar and once as the number beside it. The cockpit
 * still draws it (`dock.ts`) for the sessions wide enough to show one, and the
 * absolute count is still on the row as `↑`, which is where it came from.
 *
 * A narrow terminal loses readings, in the order they stop being true: the
 * throughput first (it only moves while a model generates), then the cache (a rate,
 * not an amount), then the context (a number the eye knows by heart after an hour).
 * The route is never the thing that is dropped, and never the thing that is cut.
 */
export class FooterComponent implements Component {
  state: FooterState = {};
  /** The ASCII icon set is the marker of an ASCII terminal: no glyph, no colour. */
  #ascii: boolean;
  #cwd: string;
  #home: string;

  constructor(icons: KumoIcons = kumoIcons(), opts: { cwd?: string; home?: string } = {}) {
    this.#ascii = icons.think === "*";
    // Read once: the frame is painted on every keystroke, and a render must not be
    // a syscall. A directory change in the session arrives through `set`.
    this.#cwd = (opts.cwd ?? process.cwd()).trim();
    this.#home = opts.home ?? homedir();
  }

  /** Live tok/s samples for the cockpit sparkline. */
  readonly speed = new SpeedHistory();
  /** When the cockpit shows the metrics, the footer keeps place, mode and route. */
  compact: (width: number) => boolean = () => false;

  set(next: FooterState): void {
    this.state = { ...this.state, ...next };
    if (next.tps !== undefined) this.speed.push(next.tps);
  }

  render(width: number): string[] {
    const w = Math.max(1, width);
    const place = this.#placeRow(w);
    const turn = this.#turnRow(w);
    const rows = [place, turn.line];
    // The throughput is the first reading to go, and it goes as soon as the row
    // above it has had to leave something out: a rate nobody asked for does not
    // deserve the row it would take from the readings that were.
    const speed = turn.whole ? this.#speedRow(w) : undefined;
    if (speed !== undefined) rows.push(speed);
    return rows;
  }

  /** Paint in a palette role, unless the terminal cannot read colour. */
  #ink(role: PaletteRole): (s: string) => string {
    return this.#ascii ? (s) => s : (s) => paint(role, s);
  }

  /** `~/Bureau  ⎇ main`, with the mode badges at the other end of the row. */
  #placeRow(width: number): string {
    const path = displayCwd(this.state.cwd ?? this.#cwd, this.#home);
    const badges = this.#badges();
    const glyph = this.#ascii ? "#" : "\u2387";
    const branch = (this.state.gitBranch ?? "").trim();
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
    const pill = (text: string, tone: "rose" | "lavender" | "sky" | "muted"): string => {
      if (!bgEnabled()) {
        // T23: FULL ACCESS is the one badge a user has to notice, so it stays bold
        // rose; on a painted surface the chip carries the colour instead.
        if (tone === "muted") return paint("muted", text);
        if (tone === "lavender") return paint("lavender", text);
        if (tone === "rose") return ansi.bold(paint("rose", text));
        return paint("sky", text);
      }
      const body = ` ${text} `;
      return tone === "muted" ? ansi.chipBg(paint("muted", body)) : onBg(tone, paint("onSky", body));
    };
    const painted =
      mode === "ask" ? pill(mode, "muted") : mode === "FULL ACCESS" ? pill(mode, "rose") : pill(mode, "sky");
    return plan ? `${painted}  ${pill("plan", "lavender")}` : painted;
  }

  /**
   * `↑17k ↓749 R34k CH99.9% 12%/131k`, longest reading first. `whole` says the
   * row got every reading, which is what the throughput row is worth a row for.
   */
  #turnRow(width: number): { line: string; whole: boolean } {
    const groups = this.#metricGroups(width);
    for (const right of this.#routeCells()) {
      const rw = visibleWidth(right);
      if (rw > width) continue;
      for (const [i, metrics] of groups.entries()) {
        // An empty first group is not a squeeze: a session with no reading yet
        // still gets its throughput row.
        if (visibleWidth(metrics) + GAP + rw <= width) {
          return { line: twoUp(metrics, right, width), whole: i === 0 };
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

  /** The readings, in the order they may be given up: all, no cache, arrows only. */
  #metricGroups(width: number): string[] {
    if (this.compact(width)) return [""];
    const s = this.state;
    const io: string[] = [];
    // ASCII terminals get `^` and `v`: the arrows are one cell in a unicode font
    // and a wrapping hazard everywhere else.
    if (s.inputTokens !== undefined) io.push(this.#ink("text")(`${this.#ascii ? "^" : "\u2191"}${formatK(s.inputTokens)}`));
    if (s.outputTokens !== undefined) io.push(this.#ink("text")(`${this.#ascii ? "v" : "\u2193"}${formatK(s.outputTokens)}`));
    const cache: string[] = [];
    if (s.cacheRead !== undefined) cache.push(this.#ink("muted")(`R${formatK(s.cacheRead)}`));
    if (s.cachePct !== undefined) {
      const pct = s.cachePct;
      const label = `CH${formatHit(pct)}%`;
      cache.push(
        s.cacheFirst === true
          ? this.#ink("muted")(label)
          : pct >= 80
            ? this.#ink("mint")(label)
            : pct >= 30
              ? this.#ink("amber")(label)
              : this.#ink("rose")(label),
      );
    }
    const context: string[] = [];
    if (s.contextWindow !== undefined && s.contextWindow > 0) {
      const pct = ((s.contextUsed ?? 0) / s.contextWindow) * 100;
      // T31.5: the reading is in the colour as much as in the digits — mint under
      // 60%, amber to 74%, rose from 75%, where the next turn starts costing more.
      const label = `${formatPct(s.contextUsed ?? 0, s.contextWindow)}%/${formatWindow(s.contextWindow)}`;
      context.push(
        pct >= 75 ? this.#ink("rose")(label) : pct >= 60 ? this.#ink("amber")(label) : this.#ink("mint")(label),
      );
    }
    return [[...io, ...cache, ...context].join(" "), [...io, ...context].join(" "), io.join(" ")];
  }

  /** The throughput, in sky: a rate and nothing else. */
  #speedRow(width: number): string | undefined {
    const s = this.state;
    if (this.compact(width) || s.tps === undefined || !(s.tps > 0)) return undefined;
    // `↯` and not `⚡`: the bolt is an emoji, two cells wide in half the fonts kumo
    // runs in, and a row one cell off is a row that wraps.
    const bolt = this.#ascii ? "*" : "\u21af";
    const rate = `${bolt} TPS: ${s.tps.toFixed(1)} tok/s`;
    const line =
      s.pp !== undefined && s.pp > 0
        ? `${this.#ink("sky")(rate)}  ${this.#ink("muted")(`prefill ${formatK(Math.round(s.pp * 10) / 10)} tok/s`)}`
        : this.#ink("sky")(rate);
    return truncateToWidth(line, width);
  }

  invalidate(): void {
    // Stateless render.
  }
}