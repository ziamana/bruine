import { expect, test } from "vitest";
import { formatElapsed } from "../src/render/elapsed.js";
import { WorkingComponent } from "../src/ui/working.js";
import { ReasoningComponent } from "../src/ui/reasoning-component.js";
import { ASCII_ICONS } from "../src/render/chars.js";
import { strip } from "./fakes.js";

test.each([
  [0, "0s"], [-1, "0s"], [45_000, "45s"], [59_900, "59s"],
  [60_000, "1min 00s"], [65_000, "1min 05s"], [119_000, "1min 59s"],
  [120_000, "2min 00s"], [150_000, "2min 30s"], [3_599_000, "59min 59s"],
  [3_600_000, "1h 00min"], [3_900_000, "1h 05min"], [7_200_000, "2h 00min"],
] as const)("formatElapsed(%i) is %s", (ms, expected) => expect(formatElapsed(ms)).toBe(expected));

test.each([65_000, 150_000, 3_900_000])("working and completed reasoning share the duration format at %i ms", ms => {
  let now = 0;
  const working = new WorkingComponent(() => now, ASCII_ICONS);
  const reasoning = new ReasoningComponent(() => now, ASCII_ICONS);
  reasoning.push("Inspect "); now = ms; reasoning.end();
  expect(strip(working.label())).toContain(formatElapsed(ms));
  expect(strip(reasoning.render(100)[0]!)).toBe(`* Thought for ${formatElapsed(ms)}`);
});
