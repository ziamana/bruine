import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { configReadPath, configWritePath } from "../compat.js";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { Weather, currentEffortName, effortIsStorm, hash01, rainGrid, rainIntoBlanks, rainLevel, type RainInk } from "./rain.js";
import { terminalMotionAllowed } from "./logo-motion.js";
import { ansi } from "./theme.js";
import { colorDepth } from "./palette.js";

export type WeatherEffect = "bruine" | "pluie" | "foudre" | "auto" | "off";
export const WEATHER_EFFECTS: Array<{ value: WeatherEffect; label: string; description: string }> = [
  { value: "bruine", label: "Bruine", description: "A few slow, quiet drops" },
  { value: "pluie", label: "Pluie", description: "Steady rain" },
  { value: "foudre", label: "Foudre", description: "Heavy rain and distant lavender lightning" },
  { value: "auto", label: "Auto", description: "Drizzle at rest; while working, as hard as the effort, with lightning at max (also on)" },
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
  try {
    await writeFile(temp, `${JSON.stringify({ ...doc, effect }, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, target);
  } finally { await rm(temp, { force: true }); }
}

/**
 * How hard the chat weather rains. The manual effects keep their level; `auto` is a drizzle at rest
 * and, while the agent works, rains as hard as the effort it was asked for (`effortRain`, from
 * effortToRain), so low, medium, high, xhigh and max each have their own weather.
 */
export function weatherLevel(effect: WeatherEffect, busy: boolean, effortRain: number = rainLevel()): number {
  if (effect === "off") return 0;
  if (effect === "bruine") return 0.15;
  if (effect === "pluie") return 0.55;
  if (effect === "foudre") return 1;
  return busy ? 0.2 + 0.8 * Math.max(0, Math.min(1, effortRain)) : 0.15;
}

/** Whether the weather is a storm (wind, violet drops, distant lightning): foudre, or auto at max while working. */
export function weatherIsStorm(effect: WeatherEffect, busy: boolean, effort: string | undefined = currentEffortName()): boolean {
  return effect === "foudre" || (effect === "auto" && busy && effortIsStorm(effort));
}

const QUIET_INK: RainInk = { far: ansi.faint, mid: ansi.faint, near: ansi.gray };
const STORM_INK: RainInk = { far: ansi.faint, mid: ansi.gray, near: ansi.violet };

function hasBackground(line: string): boolean {
  for (const match of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
    const codes = match[1]!.split(";").map(Number);
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i]!;
      if (code === 48 || (code >= 40 && code <= 47) || (code >= 100 && code <= 107)) return true;
      if (code === 38) i += codes[i + 1] === 2 ? 4 : codes[i + 1] === 5 ? 2 : 0;
    }
  }
  return false;
}

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
    const content = this.content.render(width);
    if (!this.active || width < 12) return content;
    // Keep controls where the shell placed them, but fill the unused screen below them.
    const rows = Math.max(0, Math.floor(this.options.rows()));
    const lines = [...content, ...Array<string>(Math.max(0, rows - content.length)).fill("")];
    this.#weather.set(weatherLevel(this.effect, this.options.busy()));
    const time = this.#weather.phase;
    // Only the visible portion moves, so a long transcript costs no more than a short one.
    const from = Math.max(0, lines.length - rows);
    const height = Math.min(rows, lines.length);
    const controlsFrom = this.options.decorateRows();
    const storm = weatherIsStorm(this.effect, this.options.busy());
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
    // From xhigh up the near drops turn violet; the wind and the lightning are the storm's alone.
    const ink = storm || this.#weather.level >= 0.85 ? STORM_INK : QUIET_INK;
    const out = [...lines];
    for (let y = 0; y < height; y += 1) {
      const row = from + y;
      if (row >= controlsFrom && row < content.length) continue;
      const line = lines[from + y]!;
      // Cards are opaque, and the original control band stays clear of the weather.
      if (hasBackground(line)) continue;
      const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
      out[from + y] = rainIntoBlanks(padded, grid[y]!, ink, "\x1b[7m");
    }
    return out;
  }
  invalidate(): void { this.content.invalidate(); }
}
