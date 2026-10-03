import { expect, test, vi } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { UNICODE_ICONS } from "../src/render/chars.js";

class FakeTerminal implements Terminal {
  onInput?: (data: string) => void;
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  start(onInput: (data: string) => void): void { this.onInput = onInput; }
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

const boot = () => {
  const terminal = new FakeTerminal();
  const onQuit = vi.fn();
  const ui = new BruineUi("test", { onSubmit() {}, onEscape() {}, onQuit }, terminal, UNICODE_ICONS);
  ui.start();
  return { terminal, onQuit, ui };
};

test("ctrl+c with text in the editor clears it and does not quit", async () => {
  const { terminal, onQuit, ui } = boot();
  terminal.onInput?.("abc");
  expect(ui.editor.getText()).toBe("abc");
  terminal.onInput?.("\x03");
  expect(ui.editor.getText()).toBe("");
  expect(onQuit).not.toHaveBeenCalled();
  await ui.shutdown();
});

test("ctrl+c on an empty editor quits", async () => {
  const { terminal, onQuit, ui } = boot();
  terminal.onInput?.("\x03");
  expect(onQuit).toHaveBeenCalledOnce();
  await ui.shutdown();
});

test("clearing and quitting are two presses, never one", async () => {
  const { terminal, onQuit, ui } = boot();
  terminal.onInput?.("abc");
  terminal.onInput?.("\x03");
  expect(onQuit).not.toHaveBeenCalled();
  terminal.onInput?.("\x03");
  expect(onQuit).toHaveBeenCalledOnce();
  await ui.shutdown();
});

test("ctrl+c does nothing while a question form is open", async () => {
  const { terminal, onQuit, ui } = boot();
  void ui.askQuestions([{ id: "q", question: "Which?", options: [{ label: "A" }] }]);
  terminal.onInput?.("\x03");
  expect(onQuit).not.toHaveBeenCalled();
  await ui.shutdown();
});
