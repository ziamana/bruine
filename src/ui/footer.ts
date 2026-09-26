import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";
import { colorDepth, onBg, paint } from "./palette.js";
import { SpeedHistory } from "./dock.js";

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
  return pct < 10 ? `${pct.toFixed(1)}%` : `${String(Math.round(pct))}%`;
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
      ctxPart = `ctx ${formatPct(s.contextUsed, s.contextWindow)} of ${formatK(s.contextWindow)}`;
    } else {
      ctxPart = "ctx 0% of ?";
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
    if (s.pp !== undefined && s.pp > 0) {
      const ppText = `pp ${formatK(Math.round(s.pp * 10) / 10)} tok/s`;
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
    // Modes come first so a narrow window or long model name cannot hide them.
    if (!plain && colorDepth() !== "basic" && colorDepth() !== "none") {
      // Nuage: pills. The mode pill is filled, the metrics sit on a quiet chip.
      const modePill =
        modeName === "FULL ACCESS"
          ? onBg("rose", paint("onSky", ` ${modeName} `))
          : modeName === "ask"
            ? onBg("chip", paint("muted", ` ${modeName} `))
            : onBg("sky", paint("onSky", ` ${modeName} `));
      const planPill = planOn ? onBg("lavender", paint("onSky", " plan ")) : "";
      const pill = (text: string): string => onBg("chip", ` ${text} `);
      const pills = this.compact(width) ? [] : parts.slice(0, -2).map(pill);
      const tail = paint("faint", `  ${model}  ${sep}  `) + paint("muted", effort);
      const line = [modePill, planPill, ...pills].filter((x) => x !== "").join(" ") + tail;
      return [truncateToWidth(line, width)];
    }
    const head = plan === undefined ? mode : `${mode}  ${plan}`;
    const detail = parts.join(`  ${sep}  `);
    return [truncateToWidth(`${head}  ${plain ? detail : ansi.gray(detail)}`, width)];
  }

  invalidate(): void {
    // Stateless render.
  }
}
