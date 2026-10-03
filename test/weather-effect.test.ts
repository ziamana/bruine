import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WeatherBackdrop, WEATHER_EFFECTS, parseWeatherEffect, readWeatherEffect, saveWeatherEffect, weatherIsStorm, weatherLevel, type WeatherEffect } from "../src/ui/weather-effect.js";
import { effortToRain, setRainLevel } from "../src/ui/rain.js";
import { runEffectCommand, type EffectUi } from "../src/plugins/effect-command.js";
import { BRUINE_COMMANDS } from "../src/plugins/repl.js";
import { strip } from "./fakes.js";

const dirs: string[] = [];
async function home(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "bruine-weather-")); dirs.push(dir); return dir; }
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { force: true, recursive: true }); });

test("on is auto; invalid effects are rejected", () => {
  expect(parseWeatherEffect(" On ")).toBe("auto");
  for (const { value } of WEATHER_EFFECTS) expect(parseWeatherEffect(value)).toBe(value);
  expect(parseWeatherEffect("storm")).toBeUndefined();
  expect(BRUINE_COMMANDS.some((command) => command.name === "/effect")).toBe(true);
});

test("auto follows activity; manual modes keep their level", () => {
  expect(weatherLevel("auto", true)).toBeGreaterThan(weatherLevel("auto", false));
  for (const effect of ["bruine", "pluie", "foudre", "off"] as const) expect(weatherLevel(effect, true)).toBe(weatherLevel(effect, false));
  expect(weatherLevel("foudre", false)).toBeGreaterThan(weatherLevel("pluie", false));
  expect(weatherLevel("off", true)).toBe(0);
});

test("auto rains as hard as the effort while working, each effort its own weather", () => {
  const efforts = ["low", "medium", "high", "xhigh", "max"];
  const levels = efforts.map((effort) => weatherLevel("auto", true, effortToRain(effort)));
  for (let i = 1; i < levels.length; i += 1) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
  // At rest the effort does not matter: auto is a drizzle.
  for (const effort of efforts) expect(weatherLevel("auto", false, effortToRain(effort))).toBe(weatherLevel("auto", false, 0));
  // The level follows the footer's effort by default.
  setRainLevel("xhigh");
  expect(weatherLevel("auto", true)).toBe(weatherLevel("auto", true, effortToRain("xhigh")));
  setRainLevel(undefined);
});

test("the storm is foudre, or auto at max while working", () => {
  expect(weatherIsStorm("foudre", false, "low")).toBe(true);
  expect(weatherIsStorm("auto", true, "max")).toBe(true);
  expect(weatherIsStorm("auto", true, "xhigh")).toBe(false);
  expect(weatherIsStorm("auto", false, "max")).toBe(false);
  expect(weatherIsStorm("pluie", true, "max")).toBe(false);
});

test("persist canonical choice, keep unrelated and legacy config, reload on restart", async () => {
  const dir = await home();
  expect(readWeatherEffect(dir)).toBe("bruine");
  const legacy = '{"theme":"light","effect":"on"}';
  await writeFile(join(dir, "kumo.json"), legacy);
  expect(readWeatherEffect(dir)).toBe("auto");
  await saveWeatherEffect(dir, "foudre");
  expect(JSON.parse(await readFile(join(dir, "bruine.json"), "utf8"))).toEqual({ theme: "light", effect: "foudre" });
  expect(await readFile(join(dir, "kumo.json"), "utf8")).toBe(legacy);
  expect(readWeatherEffect(dir)).toBe("foudre");
});

test("a malformed config is never destroyed when selecting an effect", async () => {
  const dir = await home();
  await writeFile(join(dir, "bruine.json"), "broken");
  await expect(saveWeatherEffect(dir, "off")).rejects.toThrow();
  expect(await readFile(join(dir, "bruine.json"), "utf8")).toBe("broken");
});

function surface(width: number, effect: WeatherEffect) {
  let now = 0;
  let paused = false;
  let allowed = true;
  const lines = ["hello world", "", "\x1b[48;2;30;30;30mTool code      untouched\x1b[0m", "", "│ editor    cursor │", "footer"];
  const content = { render: () => [...lines], invalidate: () => {} };
  const backdrop = new WeatherBackdrop(content, effect, {
    busy: () => true, rows: () => 20, decorateRows: () => 4,
    now: () => now, paused: () => paused, allowed: () => allowed,
  });
  return { lines, backdrop, render: () => backdrop.render(width), time: (t: number) => { now = t; }, pause: () => { paused = true; }, disable: () => { allowed = false; } };
}

test.each([100, 60, 30])("weather stays within %i columns and leaves content, composer, footer and cards intact", (width) => {
  const s = surface(width, "foudre");
  const seen: string[] = [];
  for (let t = 0; t <= 10_000; t += 100) {
    s.time(t);
    const frame = s.render();
    expect(frame).toHaveLength(20);
    for (const line of frame) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    expect(strip(frame[0]!)).toContain("hello world");
    expect(frame.slice(4, s.lines.length)).toEqual(s.lines.slice(4));
    expect(frame[2]).toBe(s.lines[2]);
    seen.push(frame.join("\n"));
  }
  expect(new Set(seen).size).toBeGreaterThan(4);
  expect(seen.some((frame) => frame.split("\n").slice(s.lines.length).some((line) => strip(line).trim() !== ""))).toBe(true);
  expect(seen.some((frame) => /[╲╱]/.test(frame))).toBe(true);
  expect(s.backdrop.withoutWeather(() => s.render())).toEqual(s.lines);
  s.pause(); expect(s.render()).toEqual(s.lines);
});

test("off, disabled motion, narrow terminals and clean-copy mode leave the frame untouched", () => {
  const off = surface(60, "off"); expect(off.backdrop.active).toBe(false); expect(off.render()).toEqual(off.lines);
  const disabled = surface(60, "pluie"); disabled.disable(); expect(disabled.backdrop.active).toBe(false); expect(disabled.render()).toEqual(disabled.lines);
  const narrow = surface(10, "foudre"); expect(narrow.render()).toEqual(narrow.lines);
});

function fakeUi(): EffectUi {
  return { effect: "bruine", setEffect(effect) { this.effect = effect; }, askChoice: async () => -1 };
}
test("command on saves auto; invalid arguments and non-TTY commands do not write", async () => {
  const dir = await home(); const ui = fakeUi();
  expect(await runEffectCommand("on", ui, dir)).toBe("Weather: auto.");
  expect(ui.effect).toBe("auto"); expect(readWeatherEffect(dir)).toBe("auto");
  expect(await runEffectCommand("bad", ui, dir)).toContain("Usage:");
  expect(ui.effect).toBe("auto");
  expect(await runEffectCommand("on", undefined, dir)).toContain("terminal UI");
});
test("picker previews, cancels without saving, and persists the confirmed choice", async () => {
  const dir = await home(); const ui = fakeUi();
  ui.askChoice = async (_title, _items, opts) => { opts?.preview?.(2); expect(ui.effect).toBe("foudre"); return -1; };
  expect(await runEffectCommand("", ui, dir)).toBe("Weather unchanged: bruine.");
  expect(ui.effect).toBe("bruine");
  await expect(readFile(join(dir, "bruine.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  ui.askChoice = async (_title, _items, opts) => { opts?.preview?.(1); return 1; };
  expect(await runEffectCommand("", ui, dir)).toBe("Weather: pluie.");
  expect(ui.effect).toBe("pluie"); expect(readWeatherEffect(dir)).toBe("pluie");
});
test("failed persistence keeps the previous live effect", async () => {
  const dir = await home(); const ui = fakeUi();
  await writeFile(join(dir, "bruine.json"), "invalid");
  expect(await runEffectCommand("foudre", ui, dir)).toContain("Could not save");
  expect(ui.effect).toBe("bruine");
});
