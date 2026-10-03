import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { configReadPath, configWritePath } from "../compat.js";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { Weather, hash01, rainGrid, rainIntoBlanks, type RainInk } from "./rain.js";
import { terminalMotionAllowed } from "./logo-motion.js";
import { ansi } from "./theme.js";
import { colorDepth } from "./palette.js";

export type WeatherEffect = "bruine" | "pluie" | "foudre" | "auto" | "off";
export const WEATHER_EFFECTS: Array<{ value: WeatherEffect; label: string; description: string }> = [
  { value: "bruine", label: "Bruine", description: "A few slow, quiet drops" },
  { value: "pluie", label: "Pluie", description: "Steady rain" },
  { value: "foudre", label: "Foudre", description: "Heavy rain and distant lavender lightning" },
  { value: "auto", label: "Auto", description: "Drizzle at rest, rain while working (also on)" },
  { value: "off", label: "Off", description: "No weather" },
];

export function parseWeatherEffect(value: string): WeatherEffect | undefined {
  const key = value.trim().toLowerCase();
  return key === "on" ? "auto" : WEATHER_EFFECTS.find((effect) => effect.value === key)?.value;
}

export function readWeatherEffect(home: string): WeatherEffect {
  try {
    const doc = JSON.parse(readFileSync(configReadPath(home), "utf8"));
    if (typeof doc.effect === "string") return parseWeatherEffect(doc.effect) ?? "bruine";
  } catch { /* No saved weather yet. */ }
  return "bruine";
}

/** Preserve other settings and the legacy config; never overwrite an unreadable config. */
export async function saveWeatherEffect(home: string, effect: WeatherEffect): Promise<void> {
  let doc: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(configReadPath(home), "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid config");
    doc = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(home, { recursive: true });
  const target = configWritePath(home);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ...doc, effect }, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, target);
}

export function weatherLevel(effect: WeatherEffect, busy: boolean): number {
  return effect === "off" ? 0 : effect === "bruine" ? 0.15 : effect === "pluie" ? 0.55 : effect === "foudre" ? 1 : busy ? 0.65 : 0.15;
}

const QUIET_INK: RainInk = { far: ansi.faint, mid: ansi.faint, near: ansi.gray };
const STORM_INK: RainInk = { far: ansi.faint, mid: ansi.gray, near: ansi.violet };

/** Decorate the composed frame, after scrolling/history layout and before selection. */
export class WeatherBackdrop implements Component {
  effect: WeatherEffect;
  readonly #weather: Weather;
  #clean = false;
  constructor(
    readonly content: Component,
    effect: WeatherEffect,
    private readonly options: {
      busy: () => boolean;
      rows: () => number;
      decorateRows: () => number;
      paused?: () => boolean;
      allowed?: () => boolean;
      now?: () => number;
    },
  ) {
    this.effect = effect;
    this.#weather = new Weather(weatherLevel(effect, options.busy()), options.now);
  }
  get active(): boolean {
    return !this.#clean && this.effect !== "off" && !this.options.paused?.() &&
      (this.options.allowed?.() ?? (terminalMotionAllowed() && colorDepth() !== "none"));
  }
  withoutWeather<T>(read: () => T): T {
    this.#clean = true;
    try { return read(); } finally { this.#clean = false; }
  }
  render(width: number): string[] {
    const lines = this.content.render(width);
    if (!this.active || width < 12) return lines;
    this.#weather.set(weatherLevel(this.effect, this.options.busy()));
    const time = this.#weather.phase;
    // Only the visible portion moves, so a long transcript costs no more than a short one.
    const from = Math.max(0, lines.length - this.options.rows());
    const height = Math.max(0, Math.min(lines.length, this.options.decorateRows()) - from);
    const storm = this.effect === "foudre";
    const grid = rainGrid({ width, height, time, density: 0.06 + 0.42 * this.#weather.level, seed: 31 });
    if (storm) {
      for (let y = 0; y < height; y += 1) {
        const shift = Math.floor(time / 260) + Math.floor(y / 3);
        const row = grid[y]!;
        grid[y] = row.map((_, x) => row[(x + shift) % width]);
      }
      // One short, distant bolt per twelve seconds. Never flash the whole screen.
      const clock = Math.max(0, (this.options.now ?? Date.now)());
      if (clock % 12_000 >= 8_000 && clock % 12_000 < 8_250) {
        const origin = Math.floor(width * (0.25 + 0.5 * hash01(Math.floor(clock / 12_000), 41)));
        for (let y = 0; y < Math.min(height, 9); y += 1) {
          const x = Math.min(width - 1, Math.max(0, origin + Math.floor(y / 2) % 3));
          grid[y]![x] = { char: y % 2 ? "╲" : "╱", layer: "near" };
        }
      }
    }
    const out = [...lines];
    for (let y = 0; y < height; y += 1) {
      const line = lines[from + y]!;
      // Cards and code surfaces are opaque; composer, menus and footer are below decorateRows.
      if (/\x1b\[[0-9;]*(?:48|4[0-7]|10[0-7])(?:;|m)/.test(line)) continue;
      const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
      out[from + y] = rainIntoBlanks(padded, grid[y]!, storm ? STORM_INK : QUIET_INK, "\x1b[7m");
    }
    return out;
  }
  invalidate(): void { this.content.invalidate(); }
}
