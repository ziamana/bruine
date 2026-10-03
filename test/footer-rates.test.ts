import { expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FooterComponent } from "../src/ui/footer.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { strip } from "./fakes.js";

for (const icons of [UNICODE_ICONS, ASCII_ICONS]) for (const subagents of [0, 1]) {
  test.each([100, 60, 30])(`measured rates survive a crowded footer with ${subagents} subagents at %i columns`, width => {
    const footer = new FooterComponent(icons, { cwd: "/tmp" });
    footer.set({ modelName: "qwen 3.8 flash", effort: "high", inputTokens: 1600, outputTokens: 536,
      cacheRead: 34000, cachePct: 99.9, contextUsed: 15800, contextWindow: 131072, tps: 78, pp: 1200, subagents });
    const rows = footer.render(width);
    const text = rows.map(strip).join("\n");
    expect(text).toContain("TPS: 78.0 tok/s");
    expect(text).toContain("prefill 1.2k tok/s");
    expect(text).toContain("qwen 3.8 flash");
    if (subagents) expect(strip(rows[2]!)).toMatch(/subagents 1$/);
    for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  });
}

test("prefill does not depend on a decode TPS measurement", () => {
  const footer = new FooterComponent(UNICODE_ICONS, { cwd: "/tmp" });
  footer.set({ tps: 0, pp: 1200 });
  expect(footer.render(30).map(strip).join("\n")).toContain("prefill 1.2k tok/s");
  expect(footer.render(30).map(strip).join("\n")).not.toContain("TPS:");
});

test("missing or invalid rates are not invented", () => {
  const footer = new FooterComponent(UNICODE_ICONS, { cwd: "/tmp" });
  for (const value of [undefined, 0, -1, NaN, Infinity]) {
    footer.set({ tps: value, pp: value });
    expect(footer.render(100).map(strip).join("\n")).not.toMatch(/TPS:|prefill/);
  }
});
