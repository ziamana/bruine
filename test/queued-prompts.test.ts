import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { QueuedPrompts } from "../src/ui/queued-prompts.js";
import { strip } from "./fakes.js";

const savedDshHome = process.env.DSH_HOME;
beforeAll(() => {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "bruine-queue-test-"));
});
afterAll(() => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedDshHome;
});

class FakeTerminal implements Terminal {
  onInput?: (data: string) => void;
  columns = 60;
  rows = 20;
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

test("an empty queue takes no room at all", () => {
  expect(new QueuedPrompts(UNICODE_ICONS).render(80)).toEqual([]);
});

test("queued prompts are listed oldest first, on one line each, then how to take them back", () => {
  const q = new QueuedPrompts(UNICODE_ICONS);
  q.set(["fix the tests", "then\nrun   the linter"]);
  const lines = q.render(80).map(strip);
  expect(lines[0]).toBe("↳ next  fix the tests");
  expect(lines[1]).toBe("↳ then  then run the linter");
  expect(lines[2]).toContain("↑ edit the last");
  expect(lines).toHaveLength(3);
});

test("a long queue shows three and counts the rest; nothing is wider than the screen", () => {
  const q = new QueuedPrompts(UNICODE_ICONS);
  q.set(["a".repeat(200), "b", "c", "d", "e"]);
  const lines = q.render(40);
  expect(lines.map(strip).some((l) => l.includes("+ 2 more queued"))).toBe(true);
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
});

test("ASCII terminals get ASCII", () => {
  const q = new QueuedPrompts(ASCII_ICONS);
  q.set(["x"]);
  for (const line of q.render(80).map(strip)) expect(line).toMatch(/^[\x20-\x7e]*$/);
});

test("up on an empty box takes the last queued prompt back to edit; without a queue it is history", async () => {
  const terminal = new FakeTerminal();
  const queue = ["first", "second"];
  const ui = new BruineUi(
    "test",
    { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {}, onQueueEdit: () => { const last = queue.pop(); ui.setQueued(queue); return last; } },
    terminal,
    UNICODE_ICONS,
  );
  ui.start();
  ui.setQueued(queue);
  terminal.onInput?.("\x1b[A");
  expect(ui.editor.getText()).toBe("second");
  expect(ui.queued.items).toEqual(["first"]);
  // The box is no longer empty: up belongs to the editor again.
  terminal.onInput?.("\x1b[A");
  expect(ui.queued.items).toEqual(["first"]);
  await ui.shutdown();
});
