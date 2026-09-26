import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { bgEnabled, onBg, paint } from "./palette.js";
import { meter, SpeedHistory } from "./dock.js";

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
 * Footer (T13d, T25.2): mode + plan badges, ctx, tok/s + pp, model, effort.
 * All numbers come from kumo's own samples.
 */
export class FooterComponent implements Component {
  #icons: KumoIcons;
  state: FooterState = {};

  constructor(icons: KumoIcons = kumoIcons()) {
    this.#icons = icons;
  }

  /** Live tok/s samples for the cockpit sparkline. */
  readonly speed = new SpeedHistory();
  /** When the cockpit shows the metrics, the footer keeps only mode, model and effort. */
  compact: (width: number) => boolean = () => false;

  set(next: FooterState): void {
    this.state = { ...this.state, ...next };
    if (next.tps !== undefined) this.speed.push(next.tps);
  }

  render(width: number): string[] {
    const s = this.state;
    const sep = this.#icons.think === "*" ? "-" : "·";
    const plain = this.#icons.think === "*";
    const badges = s.badges ?? ["ask"];
    const modeName = badges.find((b) => b !== "plan") ?? "ask";
    const planOn = badges.includes("plan");
    const colorize = (b: string): string => {
      if (plain) return b;
      return b === "FULL ACCESS"
        ? ansi.bold(ansi.red(b))
        : b === "ask"
          ? ansi.dim(b)
          : ansi.yellow(b);
    };
    const mode = colorize(modeName);
    const plan = planOn ? colorize("plan") : undefined;

    let ctxPart: string;
    if (s.contextUsed !== undefined && s.contextWindow !== undefined && s.contextWindow > 0) {
      // T55: a bar, then the absolute cost, then the share. The only meter used to
      // live in the cockpit, behind ctrl+b AND at 116+ columns, so a default
      // session had a number that changed once per turn and no bar at all. A
      // percentage alone did not say whether 25% was 4k or 259k tokens either.
      const pct = (s.contextUsed / s.contextWindow) * 100;
      // T55: the bar is a fixed, cheap prefix and its cell count is decided once
      // the rest of the line is known (see the budget below), not guessed here.
      ctxPart = `ctx ${formatVolume(s.contextUsed)} (${formatPct(s.contextUsed, s.contextWindow)}%)`;
    } else {
      ctxPart = "ctx 0";
    }
    const modelName = displayModel(s.model, s.modelName);
    const model = `${s.provider === "local" ? "(local) " : ""}${modelName}`;
    // T34: the footer shows the REAL effort the effort plugin sends; "?"
    // until the plugin resolves the model's levels (never a silent lie).
    const effort = `effort ${s.effort ?? "?"}`;
    // T31.5: ctx <60 green, 60-74 yellow, >=75 red; tok/s >=30 green, 15-29
    // yellow, <15 red. ASCII / no-color terminals: same text, no color.
    const ctxColor = (text: string): string => {
      if (plain) return text;
      const pct =
        s.contextUsed !== undefined && s.contextWindow !== undefined && s.contextWindow > 0
          ? (s.contextUsed / s.contextWindow) * 100
          : 0;
      if (pct >= 75) return ansi.red(text);
      if (pct >= 60) return ansi.yellow(text);
      return ansi.green(text);
    };
    const tpsColor = (text: string): string => {
      if (plain) return text;
      const v = Math.round(s.tps ?? 0);
      if (v >= 30) return ansi.green(text);
      if (v >= 15) return ansi.yellow(text);
      return ansi.red(text);
    };
    const parts: string[] = [ctxColor(ctxPart)];
    if (s.tps !== undefined && s.tps > 0) {
      parts.push(tpsColor(`${String(Math.round(s.tps))} tok/s`));
    }
    let ppIndex = -1;
    if (s.pp !== undefined && s.pp > 0) {
      const ppText = `pp ${formatK(Math.round(s.pp * 10) / 10)} tok/s`;
      ppIndex = parts.length;
      parts.push(plain ? ppText : ansi.dim(ppText));
    }
    if (s.cachePct !== undefined) {
      const pct = Math.round(s.cachePct);
      const label = `cache ${String(pct)}%`;
      if (plain) {
        parts.push(label);
      } else {
        const colored =
          s.cacheFirst === true
            ? ansi.gray(label)
            : pct >= 80
              ? ansi.green(label)
              : pct >= 30
                ? ansi.yellow(label)
                : ansi.red(label);
        parts.push(colored);
      }
    }
    parts.push(model, effort);

    // T55: the context bar is sized from the room the rest of the line leaves,
    // never the other way round. A bar that pushed the model or the effort off
    // the edge is a worse trade than a shorter bar, and a metric that gets cut is
    // a metric the user stops reading. So the line is measured first and the bar
    // spends what is left: 10 cells, else 4, else nothing.
    const ctxPct =
      s.contextUsed !== undefined && s.contextWindow !== undefined && s.contextWindow > 0
        ? (s.contextUsed / s.contextWindow) * 100
        : undefined;

    // The prefill rate is the one metric here that is a diagnostic rather than a
    // reading, so it is what goes when the bar and the route both want the room.
    const build = (cells: number, keepPp = true): string => {
      // ctxColor, not the raw text: the green/amber/red thresholds are the whole
      // point of the reading, and rebuilding the part uncoloured dropped them.
      let first = ctxColor(ctxPart);
      if (ctxPct !== undefined && cells > 0) {
        const bar = meter(ctxPct, cells);
        first = ctxColor(ctxPart.replace(/^ctx /, `ctx ${bar.filled}${bar.empty} `));
      }
      // By index, not by prefix: the pp part is wrapped in a dim SGR, so matching
      // on its text would silently never match.
      const rest = parts.slice(1).filter((_, i) => keepPp || i + 1 !== ppIndex);
      const body = [first, ...rest];
      if (!plain && bgEnabled()) {
        // Nuage: pills. The mode pill is filled, the metrics sit on a quiet chip.
        const modePill =
          modeName === "FULL ACCESS"
            ? onBg("rose", paint("onSky", ` ${modeName} `))
            : modeName === "ask"
              ? ansi.chipBg(paint("muted", ` ${modeName} `))
              : onBg("sky", paint("onSky", ` ${modeName} `));
        const planPill = planOn ? onBg("lavender", paint("onSky", " plan ")) : "";
        const pill = (text: string): string => ansi.chipBg(` ${text} `);
        const pills = this.compact(width) ? [] : body.slice(0, -2).map(pill);
        const tail = paint("faint", `  ${model}  ${sep}  `) + paint("muted", effort);
        return [modePill, planPill, ...pills].filter((x) => x !== "").join(" ") + tail;
      }
      const head = plan === undefined ? mode : `${mode}  ${plan}`;
      const detail = body.join(`  ${sep}  `);
      return `${head}  ${plain ? detail : ansi.gray(detail)}`;
    };

    for (const [cells, keepPp] of [[10, true], [4, true], [10, false], [4, false], [0, false]] as const) {
      const line = build(cells, keepPp);
      if (visibleWidth(line) <= width) return [truncateToWidth(line, width)];
    }
    return [truncateToWidth(build(0, false), width)];
  }

  invalidate(): void {
    // Stateless render.
  }
}
