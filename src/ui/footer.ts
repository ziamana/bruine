import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

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

  set(next: FooterState): void {
    this.state = { ...this.state, ...next };
  }

  render(width: number): string[] {
    const s = this.state;
    const badges = s.badges ?? ["ask"];
    const modeName = badges.find((b) => b !== "plan") ?? "ask";
    const planOn = badges.includes("plan");
    const colorize = (b: string): string =>
      b === "FULL ACCESS"
        ? ansi.bold(ansi.red(b))
        : b === "ask"
          ? ansi.dim(b)
          : ansi.yellow(b);
    const mode = colorize(modeName);
    const plan = planOn ? colorize("plan") : undefined;

    let ctxPart: string;
    if (s.contextUsed !== undefined && s.contextWindow !== undefined && s.contextWindow > 0) {
      ctxPart = `ctx ${formatPct(s.contextUsed, s.contextWindow)} of ${formatK(s.contextWindow)}`;
    } else {
      ctxPart = "ctx 0% of ?";
    }
    const sep = this.#icons.think === "*" ? "-" : "·";
    const modelName = displayModel(s.model, s.modelName);
    const model = `${s.provider === "local" ? "(local) " : ""}${modelName}`;
    const effort = `effort ${s.effort ?? "off"}`;
    const parts: string[] = [ctxPart];
    if (s.tps !== undefined && s.tps > 0) {
      parts.push(`${String(Math.round(s.tps))} tok/s`);
    }
    if (s.pp !== undefined && s.pp > 0) {
      parts.push(ansi.dim(`pp ${formatK(Math.round(s.pp * 10) / 10)} tok/s`));
    }
    if (s.cachePct !== undefined) {
      const pct = Math.round(s.cachePct);
      const label = `cache ${String(pct)}%`;
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
    parts.push(model, effort);
    // Modes come first so a narrow window or long model name cannot hide them.
    const head = plan === undefined ? mode : `${mode}  ${plan}`;
    const detail = parts.join(`  ${sep}  `);
    return [truncateToWidth(`${head}  ${ansi.gray(detail)}`, width)];
  }

  invalidate(): void {
    // Stateless render.
  }
}
