import { expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CheckList, SetupFilterList, SetupSummary } from "../src/setup/widgets.js";
import { SetupCardPicker, SetupThemePicker } from "../src/setup/welcome.js";
import { SetupFrame } from "../src/setup/frame.js";

const plain = (lines: string[]) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
test("model filtering confirms the original item and Escape restores all choices", () => {
  const items = [{ value: "main", label: "Local", description: "Ornith 9B" }, { value: "fast", label: "Remote", description: "Small model" }];
  const list = new SetupFilterList(items);
  let selected: unknown;
  list.onSelect = item => { selected = item; };
  list.handleInput("small");
  expect(plain(list.render(60))).not.toContain("Ornith");
  list.handleInput("\r");
  expect(selected).toBe(items[1]);
  list.handleInput("unlikely");
  expect(plain(list.render(60))).toContain("No matching options");
  list.handleInput("\x1b");
  expect(list.filtering).toBe(false);
  expect(plain(list.render(60))).toContain("Ornith");
});
test("skills retain hidden checks, skip group headings and clear filters before skipping", () => {
  const checked = new Set([1]);
  const list = new CheckList([{ value: "group", label: "Bundled", disabled: true }, { value: "git", label: "Git workflow" }, { value: "search", label: "Search" }], checked);
  let result: number[] = [];
  let skipped = false;
  list.onDone = indices => { result = indices; };
  list.onSkip = () => { skipped = true; };
  list.handleInput("/"); list.handleInput("search");
  expect(plain(list.render(60))).toContain("Bundled");
  expect(plain(list.render(60))).not.toContain("Git workflow");
  list.handleInput(" "); list.handleInput("\r");
  expect(result).toEqual([1, 2]);
  expect(skipped).toBe(false);
  list.handleInput("\x1b"); list.handleInput("s");
  expect(skipped).toBe(true);
});
test("empty and unmatched skills cannot toggle a nonexistent or hidden item", () => {
  const empty = new CheckList([], new Set());
  expect(() => empty.handleInput(" ")).not.toThrow();
  const list = new CheckList([{ value: "git", label: "Git" }], new Set());
  list.handleInput("missing"); list.handleInput(" ");
  expect(list.checked.size).toBe(0);
  expect(plain(list.render(30))).toContain("No matching skills");
});
test.each([100, 60, 30])("the frame keeps a late model choice and keyboard help visible at %i columns", width => {
  const list = new SetupFilterList(Array.from({ length: 40 }, (_, i) => ({ value: String(i), label: `Model ${i}` })));
  list.setSelectedIndex(35);
  const frame = new SetupFrame("Models", list, { step: 1, rows: () => 20, help: "Type filter · Enter select · Esc back", onContentHeight: rows => list.setHeight(rows) });
  const rows = frame.render(width);
  expect(plain(rows)).toContain("Model 35");
  expect(plain(rows)).toContain("Esc back");
  expect(rows.length).toBeLessThanOrEqual(20);
});
test.each([100, 60, 30])("setup cards, theme and summary fit %i columns with a constrained viewport", width => {
  const cards = new SetupCardPicker(Array.from({ length: 5 }, (_, i) => ({ value: String(i), label: `Choice ${i}`, description: "A helpful explanation that can wrap inside its card." })), () => 30);
  cards.setHeight(15); cards.setSelectedIndex(4);
  const rows = cards.render(width);
  expect(plain(rows)).toContain("Choice 4");
  expect(rows.length).toBeLessThanOrEqual(15);
  const summary = new SetupSummary([{ label: "Main", value: "local · Ornith 9B" }, { label: "Telemetry", value: "no" }], "/tmp/bruine");
  expect(plain(summary.render(width))).toMatch(/Telemetry\s+no/);
  for (const row of [...rows, ...new SetupThemePicker("dark").render(width), ...summary.render(width)]) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
});
