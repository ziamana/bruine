import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { FooterState } from "./footer.js";
import { ansi } from "./theme.js";
import { formatVolume } from "./footer.js";

/** Terminal width from which the cockpit panel sits next to the editor. */
export const DOCK_MIN_WIDTH = 116; // 120-column terminal minus the 2+2 margin
export const DOCK_PANEL_WIDTH = 34;

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Unicode sparkline (pure; tested).
 *
 * `reference` is the value that fills the graph. It defaults to the series' own
 * max, which is the honest answer for a series that has never had a reference.
 * The cockpit passes a sticky peak instead (T55 P4): scaling to the window made
 * a model that had slowed from 50 tok/s to a steady 5 fill the whole graph, so
 * the graph said "fine" exactly when it mattered.
 */
export function sparkline(values: number[], width: number, reference?: number): string {
  const tail = values.slice(-width);
  if (tail.length === 0) return "";
  const max = Math.max(reference ?? 0, ...tail, 1);
  // floor, not round: with round the bottom rung was unreachable, because any
  // non-zero speed landed on at least "▂". A tenth of the peak has to read as
  // nearly empty, which is what ▁ is for.
  return tail
    .map((v) => SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.floor((v / max) * (SPARK.length - 1))))]!)
    .join("");
}

/**
 * A meter: filled cells for pct, the rest faint (pure; tested).
 *
 * `cells` is the caller's decision because a bar in the footer and a bar in the
 * cockpit do not have the same room, and a bar that has to be truncated away is
 * worse than no bar.
 */
export function meter(pct: number, cells = 10): { filled: string; empty: string } {
  const n = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)));
  return { filled: "█".repeat(n), empty: "░".repeat(cells - n) };
}

/** Speed history fed by the footer's live tok/s (throttled, capped). */
export class SpeedHistory {
  values: number[] = [];
  /** The fastest sample ever seen: the graph's full scale, so a drop shows. */
  peak = 0;
  #last = 0;
  constructor(private now: () => number = Date.now, private cap = 24) {}
  push(v: number): void {
    if (!(v > 0)) return;
    const t = this.now();
    if (this.values.length > 0 && t - this.#last < 250) {
      this.values[this.values.length - 1] = v;
      if (v > this.peak) this.peak = v;
      return;
    }
    this.#last = t;
    this.values.push(v);
    if (v > this.peak) this.peak = v;
    if (this.values.length > this.cap) this.values.shift();
  }
}

/** The cockpit: live speed, cache and context of the local model. */
export class DashboardPanel implements Component {
  constructor(
    private state: () => FooterState,
    private speed: SpeedHistory,
    private tasks: () => { done: number; total: number; current?: string },
    private host: () => string = () => "",
  ) {}

  render(width: number): string[] {
    const s = this.state();
    const label = (t: string): string => ansi.faint(t.padEnd(7));
    const rows: string[] = [];
    const tps = s.tps !== undefined && s.tps > 0 ? `${String(Math.round(s.tps))} tok/s` : "idle";
    const spark = sparkline(this.speed.values, 10, this.speed.peak);
    rows.push(`${label("speed")} ${ansi.cyan(spark.padEnd(10, " "))}  ${s.tps !== undefined && s.tps > 0 ? ansi.text(tps) : ansi.faint(tps)}`);
    if (s.cachePct !== undefined) {
      const m = meter(s.cachePct);
      const color = s.cacheFirst === true ? ansi.gray : s.cachePct >= 80 ? ansi.green : s.cachePct >= 30 ? ansi.yellow : ansi.red;
      rows.push(`${label("cache")} ${color(m.filled)}${ansi.faint(m.empty)}  ${ansi.text(`${String(Math.round(s.cachePct))}%`)}`);
    } else {
      rows.push(`${label("cache")} ${ansi.faint("░".repeat(10))}  ${ansi.faint("-")}`);
    }
    if (s.contextWindow !== undefined && s.contextWindow > 0) {
      const pct = ((s.contextUsed ?? 0) / s.contextWindow) * 100;
      const m = meter(pct);
      const color = pct >= 75 ? ansi.red : pct >= 60 ? ansi.yellow : ansi.cyan;
      // T55: the same marking as the footer, `259.0K (25%)`. The meter says how
      // full it is; the number says what that costs.
      const shown = `${formatVolume(s.contextUsed ?? 0)} (${pct < 10 ? pct.toFixed(1) : String(Math.round(pct))}%)`;
      rows.push(`${label("context")} ${color(m.filled)}${ansi.faint(m.empty)}  ${ansi.text(shown)}`);
    } else {
      rows.push(`${label("context")} ${ansi.faint("░".repeat(10))}  ${ansi.faint("?")}`);
    }
    const t = this.tasks();
    if (t.total > 0) {
      const cur = t.current !== undefined ? `  ${ansi.violet(t.current)}` : "";
      rows.push(`${label("tasks")} ${ansi.text(`${String(t.done)}/${String(t.total)}`)}${cur}`);
    } else {
      rows.push(`${label("server")} ${ansi.gray(this.host())}`);
    }
    return rows.map((r) => truncateToWidth(r, width));
  }

  invalidate(): void {}
}

/**
 * Editor on the left, cockpit on the right, when the terminal is wide enough
 * and the dock is on (ctrl+b). Otherwise just the editor. The editor keeps its
 * own lines (and cursor marker) untouched; only padding is added.
 */
export class DockRow implements Component {
  visible = true;
  constructor(
    private left: Component,
    private panel: Component,
  ) {}

  shown(width: number): boolean {
    return this.visible && width >= DOCK_MIN_WIDTH;
  }

  render(width: number): string[] {
    if (!this.shown(width)) return this.left.render(width);
    const leftW = width - DOCK_PANEL_WIDTH - 3;
    const left = this.left.render(leftW);
    const right = this.panel.render(DOCK_PANEL_WIDTH);
    const h = Math.max(left.length, right.length);
    const out: string[] = [];
    for (let i = 0; i < h; i++) {
      const l = left[i] ?? "";
      const pad = " ".repeat(Math.max(0, leftW - visibleWidth(l)));
      const r = right[i] ?? "";
      out.push(`${l}${pad} ${ansi.faint("│")} ${r}`);
    }
    return out;
  }

  handleInput(data: string): void {
    (this.left as { handleInput?: (d: string) => void }).handleInput?.(data);
  }

  invalidate(): void {
    this.left.invalidate();
    this.panel.invalidate();
  }
}
