import { afterEach, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SetupFrame } from "../src/setup/frame.js";
import { resetColorDepth } from "../src/ui/palette.js";
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; resetColorDepth(); });
test.each([100, 60, 30])("setup frame fits %i columns and keeps its title, progress, controls and help", width => {
  const frame = new SetupFrame("Models", { render: () => ["→ local server", "  Add a server"], invalidate() {} }, { step: 1, help: "↑/↓ move · Enter select · Esc back · Ctrl+C quit", rows: () => 30 });
  const rows = frame.render(width); const text = rows.join("\n");
  expect(text).toContain("Models"); expect(text).toContain("Step 1/9"); expect(text).toContain("local server"); expect(text).toContain("Esc back");
  for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
});
test("a long title wraps and a short screen keeps the help visible", () => {
  const frame = new SetupFrame("Choose a server for the main model on your computer", { render: () => Array(40).fill("choice"), invalidate() {} }, { step: 2, help: "Enter select · Esc back", rows: () => 20 });
  const rows = frame.render(30); expect(rows).toHaveLength(20); expect(rows.join("\n")).toContain("Esc back");
  expect(rows.join("\n").replace(/\x1b\[[0-9;]*m/g, "").replace(/[│|]/g, "").replace(/\s+/g, " ")).toContain("on your computer");
});
test("ASCII and no color use plain borders and key names", () => {
  process.env.BRUINE_ASCII = "1"; process.env.BRUINE_COLOR = "none"; resetColorDepth();
  const frame = new SetupFrame("Keys", { render: () => ["Continue →"], invalidate() {} }, { step: 3, help: "↑/↓ move · Enter select", rows: () => 30 });
  expect(frame.render(30).join("\n")).not.toMatch(/[^\x00-\x7f]/);
});
