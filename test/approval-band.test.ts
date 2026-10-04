import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { alwaysLabel } from "../src/plugins/approval.js";
import { ApprovalBand } from "../src/ui/approval-band.js";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { TurnActivity } from "../src/ui/turn-activity.js";
import { strip } from "./fakes.js";

const savedDshHome = process.env.DSH_HOME;
beforeAll(() => {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "bruine-band-test-"));
});
afterAll(() => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedDshHome;
});

class FakeTerminal implements Terminal {
  onInput?: (data: string) => void;
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(): void {}
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

const CHOICES = [
  { key: "y", label: "Allow once" },
  { key: "a", label: 'Always allow "npm test" this session' },
  { key: "n", label: "Reject" },
];

test("the approval is a frame: the tool on the edge, the request inside, a letter per answer, Escape spelled out", () => {
  const lines = new ApprovalBand("? Allow bash: npm test", CHOICES, UNICODE_ICONS).render(60).map(strip);
  expect(lines[0]).toMatch(/^╭─ Allow bash ─+╮$/);
  expect(lines[1]).toBe(`│ npm test${" ".repeat(48)} │`);
  expect(lines.some((l) => l.includes("› y  Allow once"))).toBe(true);
  expect(lines.some((l) => l.includes("  a  Always allow \"npm test\" this session"))).toBe(true);
  expect(lines.some((l) => l.includes("  n  Reject"))).toBe(true);
  expect(lines.at(-1)).toMatch(/^╰─+ ⏎ choose · esc rejects ──╯$/);
  for (const line of lines) expect(visibleWidth(line)).toBe(60);
});

test("a long request wraps, and is cut after three rows", () => {
  const lines = new ApprovalBand(`? Allow bash: ${"x ".repeat(200)}`, CHOICES, UNICODE_ICONS).render(40).map(strip);
  const inside = lines.slice(1, lines.findIndex((l) => l.includes("Allow once")));
  expect(inside.filter((l) => l.includes("x"))).toHaveLength(3);
  for (const line of lines) expect(visibleWidth(line)).toBe(40);
});

test("ASCII terminals get ASCII", () => {
  for (const line of new ApprovalBand("? Allow edit: src/a.ts", CHOICES, ASCII_ICONS).render(50).map(strip)) {
    expect(line).toMatch(/^[\x20-\x7e]*$/);
  }
});

test("a letter answers at once; arrows move, Enter picks; Escape cancels", () => {
  const picked: number[] = [];
  let cancelled = 0;
  const band = new ApprovalBand("? Allow edit: a.ts", CHOICES, UNICODE_ICONS);
  band.onSelect = (i) => picked.push(i);
  band.onCancel = () => (cancelled += 1);
  band.handleInput("a");
  band.handleInput("N");
  band.handleInput("\x1b[B");
  band.handleInput("\x1b[B");
  band.handleInput("\r");
  band.handleInput("\x1b");
  band.handleInput("q");
  expect(picked).toEqual([1, 2, 1]);
  expect(cancelled).toBe(1);
});

test("Always says what it covers: one command for a shell, the whole tool otherwise", () => {
  expect(alwaysLabel("bash:npm   test", "bash")).toBe('Always allow "npm test" this session');
  expect(alwaysLabel(`bash:${"a".repeat(80)}`, "bash")).toMatch(/^Always allow "a{47}…" this session$/);
  expect(alwaysLabel("edit", "edit")).toBe("Always allow every edit this session");
  expect(alwaysLabel("mcp__docs__search", "mcp__docs__search")).toBe("Always allow every mcp__docs__search call this session");
  expect(alwaysLabel(undefined, "bash")).toBe("Always for this session");
});

test("the turn's clock stops while it waits on a person", () => {
  let now = 1_000;
  const activity = new TurnActivity(() => now);
  activity.start();
  now += 4_000;
  activity.hold();
  expect(activity.held).toBe(true);
  now += 60_000;
  expect(activity.elapsed).toBe(4_000);
  activity.release();
  now += 1_000;
  expect(activity.held).toBe(false);
  expect(activity.elapsed).toBe(5_000);
});

test("while an approval is open: the band has the keys, the box says whose turn it is, the queue hints step aside", async () => {
  const terminal = new FakeTerminal();
  const ui = new BruineUi("test", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, terminal, UNICODE_ICONS);
  ui.start();
  ui.setQueued(["then document it"]);
  ui.activity.start("Working");
  const answer = ui.askChoice("? Allow bash: npm test", CHOICES.map((c) => ({ value: c.key, label: c.label })), { keys: ["y", "a", "n"] });
  const screen = ui.tui.render(terminal.columns).map(strip).join("\n");
  expect(screen).toContain("Allow bash");
  expect(screen).toContain("Waiting for you");
  expect(screen).not.toContain("esc stop, and take them back");
  expect(ui.activity.held).toBe(true);
  terminal.onInput?.("y");
  expect(await answer).toBe(0);
  expect(ui.activity.held).toBe(false);
  const after = ui.tui.render(terminal.columns).map(strip).join("\n");
  expect(after).toContain("esc stop, and take them back");
  expect(after).not.toContain("Waiting for you");
  await ui.shutdown();
});
