import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";
import { readableToolSummary, toolSummariesEnabled } from "../src/ui/tool-summary.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { strip } from "./fakes.js";
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

test("readable summaries reuse descriptions and fall back to the first subagent prompt line", () => {
  expect(readableToolSummary("subagent", { description: "Review after corrections", prompt: "Long instructions" })).toBe("Review after corrections");
  expect(readableToolSummary("subagent", { prompt: "\nReview the interface\nLong instructions" })).toBe("Review the interface");
  expect(readableToolSummary("bash", { command: "pnpm test" })).toBeUndefined();
});

for (const icons of [UNICODE_ICONS, ASCII_ICONS]) test.each([100, 60, 30])("descriptions fit %i columns during streaming and after completion", width => {
  const tool = new ToolCallComponent("subagent", () => 0, icons, { readableSummaries: true });
  tool.args('{"description":"Review after corrections", "prompt":"Long instructions"');
  const live = tool.render(width);
  expect(strip(live[0]!)).toContain("Review"); expect(strip(live[0]!)).not.toContain('{"');
  tool.setArgs('{"description":"Review after corrections", "prompt":"Long instructions"}');
  tool.result(true, "Started subagent");
  const done = tool.render(width);
  expect(strip(done[0]!)).toContain("Review"); expect(strip(done[0]!)).not.toContain('{"');
  for (const row of [...live, ...done]) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
});

test("turning readable summaries off keeps the original argument display", () => {
  const tool = new ToolCallComponent("bash", () => 0, UNICODE_ICONS, { readableSummaries: false });
  tool.setArgs(JSON.stringify({ description: "Check tests", command: "pnpm test" }));
  expect(strip(tool.render(100)[0]!)).toContain("pnpm test");
  expect(strip(tool.render(100)[0]!)).not.toContain("Check tests");
});

test("a readable description never hides the real command in approval", () => {
  const tool = new ToolCallComponent("bash", () => 0, UNICODE_ICONS, { readableSummaries: true });
  tool.setArgs(JSON.stringify({ description: "Clean build output", command: "rm -rf dist" }));
  expect(strip(tool.render(100)[0]!)).toContain("Clean build output");
  expect(tool.summary(100)).toBe("rm -rf dist");
});

test("the environment overrides the saved preference and new calls use it", () => {
  const home = mkdtempSync(join(tmpdir(), "bruine-tool-summary-"));
  try {
    writeFileSync(join(home, "bruine.json"), JSON.stringify({ toolSummaries: false }));
    expect(toolSummariesEnabled({ DSH_HOME: home })).toBe(false);
    expect(toolSummariesEnabled({ DSH_HOME: home, BRUINE_TOOL_SUMMARIES: "1" })).toBe(true);
    writeFileSync(join(home, "bruine.json"), JSON.stringify({ toolSummaries: true }));
    expect(toolSummariesEnabled({ DSH_HOME: home, BRUINE_TOOL_SUMMARIES: "0" })).toBe(false);
    process.env.DSH_HOME = home; process.env.BRUINE_TOOL_SUMMARIES = "0";
    const tool = new ToolCallComponent("bash", () => 0);
    tool.setArgs('{"description":"Check tests", "command":"pnpm test"}');
    expect(strip(tool.render(100)[0]!)).toContain("pnpm test");
    writeFileSync(join(home, "bruine.json"), "invalid json");
    expect(toolSummariesEnabled({ DSH_HOME: home })).toBe(true);
    expect(toolSummariesEnabled({})).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
