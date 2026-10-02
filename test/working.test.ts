import { afterEach, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { WorkingComponent } from "../src/ui/working.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
test.each([100, 60, 30])("activity fits %i columns and prioritizes state and time", width => {
  let now = 0; const working = new WorkingComponent(() => now, UNICODE_ICONS); now = 4200;
  for (const state of ["Working", "Waiting for model", "Thinking"] as const) {
    working.state = state; const row = working.line(width);
    expect(row).toContain(state); expect(row).toContain("4s"); expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    expect(row.includes("Esc to interrupt")).toBe(width >= 60);
  }
});
test("reduced motion and ASCII keep a static recognizable status", () => {
  process.env.KUMO_NO_ANIMATION = "1";
  const working = new WorkingComponent(() => 0, ASCII_ICONS);
  expect(working.active).toBe(false);
  expect(working.line(30).replace(/\x1b\[[0-9;]*m/g, "")).toBe("| Waiting for model 0s");
  expect(working.render(30)).toEqual([working.line(30)]);
});
