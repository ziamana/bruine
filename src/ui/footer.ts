import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { kumoIcons, type KumoIcons } from "../render/chars.js";
import { ansi } from "./theme.js";

export interface FooterState {
  contextUsed?: number;
  contextWindow?: number;
  model?: string;
  provider?: string;
  effort?: string;
  tps?: number;
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

/**
 * Footer (T13d): context used / window on the left, model + effort on the
 * right, computed TPS underneath. All numbers come from kumo's own samples.
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
    let left = "";
    if (s.contextUsed !== undefined && s.contextWindow !== undefined && s.contextWindow > 0) {
      const pct = ((s.contextUsed / s.contextWindow) * 100).toFixed(1);
      left = `${pct}%/${formatK(s.contextWindow)} (auto)`;
    } else {
      left = "0%/— (auto)";
    }
    const badges = (s.badges ?? []).map((b) => (b === "FULL ACCESS" ? ansi.red(b) : ansi.yellow(b)));
    const model = `${s.provider === "local" ? "(local) " : ""}${s.model ?? "no model"}`;
    const right = [...badges, `${model} • ${s.effort ?? "off"}`].join("  ");
    const line1 = truncateToWidth(
      `${left}${" ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)))}${right}`,
      width,
    );
    const spark = this.#icons.spark === "" ? "" : `${this.#icons.spark} `;
    const tps = s.tps !== undefined && s.tps > 0 ? `${spark}TPS: ${s.tps.toFixed(1)}` : "";
    return [ansi.gray(line1), ansi.gray(tps)];
  }

  invalidate(): void {
    // Stateless render.
  }
}
