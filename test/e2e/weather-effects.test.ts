import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, expect, test } from "vitest";
import { build, Harness } from "./harness.js";

beforeAll(build, 60_000);

test("/effect on selects auto, previews cancel, and weather animates without model traffic", async () => {
  const h = await Harness.start([]);
  try {
    await h.waitFor("e2e-model");
    await h.waitStable(150, 2000);
    await h.prompt("/effect on");
    await h.waitFor("Weather: auto.");
    const config = () => JSON.parse(readFileSync(join(h.home, "bruine.json"), "utf8"));
    expect(config().effect).toBe("auto");
    await h.prompt("/effect");
    await h.waitFor("Weather effect");
    h.type("\x1b[A");
    await delay(150);
    h.press("escape");
    await h.waitFor("Weather unchanged: auto.");
    expect(config().effect).toBe("auto");
    await h.prompt("/effect foudre");
    await h.waitFor("Weather: foudre.");
    expect(config().effect).toBe("foudre");
    const frames = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      await delay(100);
      await h.flush();
      frames.add(h.screen().join("\n"));
    }
    expect(frames.size).toBeGreaterThan(1);
    const footer = h.statusBarRows().turn;
    expect(footer).toBeGreaterThanOrEqual(0);
    expect([...frames].some((frame) => frame.split("\n").slice(footer + 1).some((line) => /[╎╷│·]/.test(line)))).toBe(true);
    await h.dump("weather-foudre-full-screen");
    for (let i = 0; i < 2; i += 1) {
      await h.prompt("/help");
      await h.until(() => !h.screen().some((line) => /^\s*│ \/help/.test(line)), 2000, "help submitted");
    }
    h.press("pageUp");
    await h.waitFor("Jump to latest");
    const scrolledFrames = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      await delay(100); await h.flush(); scrolledFrames.add(h.screen().join("\n"));
    }
    expect(scrolledFrames.size).toBeGreaterThan(1);
    await h.dump("weather-scrolled");
    h.press("end");
    await h.prompt("/effect off");
    await h.waitFor("Weather: off.");
    expect(config().effect).toBe("off");
    await h.waitStable(150);
    expect(h.server.mainRequests()).toHaveLength(0);
    await h.dump("weather-effects");
  } finally { await h.close(); }
});
