import { afterEach, expect, test } from "vitest";
import { visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { PromptFrame } from "../src/ui/prompt-frame.js";
import { KumoUi } from "../src/ui/kumo-ui.js";
import { WorkingComponent } from "../src/ui/working.js";
import { ReasoningComponent } from "../src/ui/reasoning-component.js";
import { fgCode, resetColorDepth } from "../src/ui/palette.js";
import { UNICODE_ICONS, ASCII_ICONS } from "../src/render/chars.js";
class FakeTerminal implements Terminal {
  writes: string[] = [];
  onInput?: (data: string) => void;
  columns = 60;
  rows = 20;
  kittyProtocolActive = false;
  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; resetColorDepth(); });
test.each([100, 60, 30])("composer keeps rules, cursor and multi-line input at %i columns", async width => {
  process.env.KUMO_COLOR = "truecolor"; resetColorDepth();
  const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, new FakeTerminal(), UNICODE_ICONS);
  // The footer is being redesigned by the parallel agent; this test owns only input.
  ui.footer.render = () => [];
  ui.editor.focused = true; ui.editor.setText("first line\nsecond line");
  let rows = ui.promptFrame.render(width);
  expect(rows[0]).toContain(fgCode("edge", "truecolor"));
  const working = new WorkingComponent(() => 0); ui.addChat(working);
  rows = ui.promptFrame.render(width);
  expect(rows[0]).toContain("Waiting for model"); expect(rows[1]).toContain(fgCode("lavender", "truecolor"));
  expect(rows.join("\n")).toContain("second line"); expect(rows.join("\n")).toContain("\x1b[7m");
  expect(ui.chat.render(width).join("\n")).not.toContain("Waiting for model");
  ui.removeChat(working); const reasoning = new ReasoningComponent(() => 0); reasoning.push("Inspect "); ui.addChat(reasoning);
  expect(ui.promptFrame.render(width)[0]).toContain("Thinking"); reasoning.end();
  expect(ui.promptFrame.render(width)[0]).toContain("Working");
  ui.onTurnEnd({ tools: [], wallSec: 0, outputTokens: 0, cancelled: true, error: false });
  expect(ui.promptFrame.render(width).join("\n")).not.toContain("Working");
  for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  await ui.shutdown();
});
test("unfocused idle rules recede and ASCII rules preserve the editor scroll indicators", () => {
  process.env.KUMO_COLOR = "basic"; resetColorDepth();
  const editor = { focused: false, borderColor: (text: string) => text };
  const content = { render: () => [editor.borderColor("──↑──"), "cursor", editor.borderColor("──↓──")], invalidate() {} };
  const frame = new PromptFrame(content, editor, () => "Working", ASCII_ICONS, () => 0);
  expect(frame.render(30)[0]).toContain(fgCode("faint", "basic"));
  expect(frame.render(30)[0]).toContain("--^--"); frame.start(); frame.stop();
  expect(frame.render(30)).toHaveLength(3);
});
