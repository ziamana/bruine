import { afterEach, expect, test, vi } from "vitest";
import { visibleWidth, stripTerminalSequences, type Terminal } from "@earendil-works/pi-tui";
import { tick } from "./fakes.js";
import { PromptFrame } from "../src/ui/prompt-frame.js";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { TurnActivity } from "../src/ui/turn-activity.js";
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
  process.env.BRUINE_COLOR = "truecolor"; resetColorDepth();
  const ui = new BruineUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, new FakeTerminal(), UNICODE_ICONS);
  // The footer is being redesigned by the parallel agent; this test owns only input.
  ui.footer.render = () => [];
  ui.promptFrame.focused = true; ui.editor.setText("first line\nsecond line");
  let rows = ui.promptFrame.render(width);
  expect(rows[0]).toContain(fgCode("lavender", "truecolor"));
  ui.showWorking();
  rows = ui.promptFrame.render(width);
  expect(rows[0]).toContain("Waiting for model"); expect(rows[0]).toContain(fgCode("lavender", "truecolor"));
  // C6: the frame wraps the editor itself, so the rows are the editor's rows.
  expect(rows).toHaveLength(ui.editor.render(width - 4).length);
  expect(rows[0]).not.toContain("Esc to interrupt");
  expect(rows.join("\n")).toContain("second line"); expect(rows.join("\n")).toContain("\x1b[7m");
  expect(ui.chat.render(width).join("\n")).not.toContain("Waiting for model");
  ui.activity.setState("Working"); const reasoning = new ReasoningComponent(() => 0); reasoning.push("Inspect "); ui.addChat(reasoning);
  expect(ui.promptFrame.render(width)[0]).toContain("Thinking"); reasoning.end();
  expect(ui.promptFrame.render(width)[0]).toContain("Working");
  ui.onTurnEnd({ tools: [], wallSec: 0, outputTokens: 0, cancelled: true, error: false });
  expect(ui.promptFrame.render(width).join("\n")).not.toContain("Working");
  for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  await ui.shutdown();
});
test("unfocused idle rules recede and ASCII rules preserve the editor scroll indicators", () => {
  process.env.BRUINE_COLOR = "basic"; resetColorDepth();
  const editor = { focused: false, borderColor: (text: string) => text };
  const content = { render: () => [editor.borderColor("──↑──"), "cursor", editor.borderColor("──↓──")], invalidate() {} };
  const frame = new PromptFrame(content, editor, new TurnActivity(() => 0), ASCII_ICONS);
  expect(frame.render(30)[0]).toContain(fgCode("faint", "basic"));
  expect(frame.render(30)[0]).toContain("--^--"); frame.activity.start(); frame.activity.stop();
  expect(frame.render(30)).toHaveLength(3);
});


test("one turn clock survives activity transitions and rendering does not replace borderColor", () => {
  let now = 1000;
  const activity = new TurnActivity(() => now);
  const editor = { focused: false, borderColor: (text: string) => text };
  const frame = new PromptFrame({ render: (width: number) => [editor.borderColor("─".repeat(width)), "cursor", editor.borderColor("─".repeat(width))], invalidate() {} }, editor, activity, ASCII_ICONS);
  expect(activity.active).toBe(false);
  const idleBorder = editor.borderColor;
  frame.render(30); frame.render(60);
  expect(editor.borderColor).toBe(idleBorder);
  frame.focused = true;
  const focusedBorder = editor.borderColor;
  frame.render(100);
  expect(editor.borderColor).toBe(focusedBorder);
  activity.start(); now = 4200;
  expect(frame.render(60)[0]).toContain("3s");
  activity.setState("Thinking");
  expect(frame.render(60)[0]!.replace(/\x1b\[[0-9;]*m/g, "")).toContain("Thinking 3s");
  activity.start("Waiting for model");
  expect(activity.startedAt).toBe(1000);
  expect(frame.render(60)[0]!.replace(/\x1b\[[0-9;]*m/g, "")).toContain("Waiting for model 3s");
  activity.stop(); frame.focused = false;
  expect(editor.borderColor).not.toBe(focusedBorder);
});

for (const ascii of [false, true]) {
  test.each([100, 60, 30])(`activity lives inside the ${ascii ? "ASCII" : "Unicode"} rule at %i columns`, width => {
    process.env.BRUINE_COLOR = "basic"; process.env.BRUINE_NO_ANIMATION = "1"; resetColorDepth();
    let now = 0;
    const activity = new TurnActivity(() => now);
    const editor = { focused: false, borderColor: (text: string) => text };
    const content = { render: (cols: number) => [editor.borderColor("─".repeat(cols)), "cursor", editor.borderColor("─".repeat(cols))], invalidate() {} };
    const frame = new PromptFrame(content, editor, activity, ascii ? ASCII_ICONS : UNICODE_ICONS);
    const idle = frame.render(width);
    activity.start("Working"); now = 3000;
    const rows = frame.render(width);
    const top = rows[0]!.replace(/\x1b\[[0-9;]*m/g, "");
    expect(rows).toHaveLength(idle.length);
    expect(top).toMatch(ascii ? /^\+-- \| Working 3s -+\+$/ : /^╭── ⋮ Working 3s ─+╮$/);
    expect(rows[0]).toContain(`${fgCode("muted", "basic")}3s`);
    expect(rows[0]).not.toContain("Esc to interrupt");
    expect(rows.slice(1)).toEqual(frame.render(width).slice(1));
    expect(visibleWidth(rows[0]!)).toBe(width);
    now = 123_456_789_000_000; activity.setState("Waiting for model");
    const long = frame.render(width)[0]!.replace(/\x1b\[[0-9;]*m/g, "");
    expect(visibleWidth(long)).toBe(width);
    expect(long.endsWith(ascii ? "--+" : "──╮")).toBe(true);
    activity.stop();
    expect(frame.render(width)).toEqual(idle);
  });
}

test("a separately bundled reasoning component arms ASCII repaints and drives Thinking → Working", async () => {
  // Render and repl are bundled independently: their constructors have different identities.
  class BundledReasoning {
    readonly transcriptStyle = "reasoning";
    onActivityChange?: (active: boolean) => void;
    private inner = new ReasoningComponent(Date.now, ASCII_ICONS);
    constructor() { this.inner.onActivityChange = active => this.onActivityChange?.(active); }
    get active(): boolean { return this.inner.active; }
    push(text: string): void { this.inner.push(text); }
    end(): void { this.inner.end(); }
    render(width: number): string[] { return this.inner.render(width); }
    invalidate(): void {}
  }
  const tty = process.stdout.isTTY;
  vi.useFakeTimers(); vi.setSystemTime(0);
  process.stdout.isTTY = true;
  process.env.BRUINE_ASCII = "1"; process.env.TERM = "xterm-256color";
  delete process.env.CI; delete process.env.BRUINE_NO_ANIMATION;
  const ui = new BruineUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, new FakeTerminal(), ASCII_ICONS);
  const reasoning = new BundledReasoning();
  const transcriptFrames = new Set<string>();
  const ruleFrames = new Set<string>();
  const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
  const repaint = vi.spyOn(ui.tui, "requestRender").mockImplementation(() => {
    const transcript = /^(['`,.]{3}) Thinking/.exec(plain(reasoning.render(60)[0] ?? ""));
    const rule = /^\+-- (['`,.]{3}) Thinking/.exec(plain(ui.promptFrame.render(60)[0] ?? ""));
    if (transcript) transcriptFrames.add(transcript[1]!);
    if (rule) ruleFrames.add(rule[1]!);
  });
  try {
    ui.showWorking(); ui.activity.setState("Working");
    ui.addChat(reasoning); // Registered before its first push, as in render.ts.
    reasoning.push("Finished sentence. partial");
    expect(ui.activity.state).toBe("Thinking");
    vi.advanceTimersByTime(700);
    // Rain: three cells that keep changing while the model thinks.
    expect(transcriptFrames.size).toBeGreaterThanOrEqual(3);
    expect(ruleFrames.size).toBeGreaterThanOrEqual(3);
    reasoning.end();
    expect(ui.activity.state).toBe("Working");
    expect(plain(ui.promptFrame.render(60)[0]!)).toContain("Working");
  } finally {
    await ui.shutdown(); repaint.mockRestore();
    process.stdout.isTTY = tty; vi.useRealTimers();
  }
});

test("reasoning alone starts and stops repaints when the prompt activity is inactive", async () => {
  const tty = process.stdout.isTTY;
  vi.useFakeTimers(); vi.setSystemTime(0); process.stdout.isTTY = false;
  const ui = new BruineUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, new FakeTerminal(), ASCII_ICONS);
  const reasoning = new ReasoningComponent(Date.now, ASCII_ICONS);
  const frames = new Set<string>();
  const repaint = vi.spyOn(ui.tui, "requestRender").mockImplementation(() => {
    const spin = /^(['`,.]{3}) Thinking/.exec((reasoning.render(60)[0] ?? "").replace(/\x1b\[[0-9;]*m/g, ""));
    if (spin) frames.add(spin[1]!);
  });
  try {
    expect(ui.promptFrame.active).toBe(false);
    ui.addChat(reasoning);
    reasoning.push("Inspect the stream. ");
    vi.advanceTimersByTime(700);
    expect(frames.size).toBeGreaterThanOrEqual(3);
    reasoning.end();
    const ended = repaint.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(repaint.mock.calls).toHaveLength(ended);
  } finally {
    await ui.shutdown(); repaint.mockRestore();
    process.stdout.isTTY = tty; vi.useRealTimers();
  }
});

for (const ascii of [false, true]) for (const color of ["basic", "none"]) {
  test.each([100, 60, 30])(`connected ${ascii ? "ASCII" : "Unicode"} frame (${color}) fits %i columns`, async width => {
    process.env.BRUINE_COLOR = color; resetColorDepth();
    const ui = new BruineUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, new FakeTerminal(), ascii ? ASCII_ICONS : UNICODE_ICONS);
    try {
      ui.promptFrame.focused = true; ui.editor.setText("hello\nsecond line");
      const rows = ui.promptFrame.render(width);
      const plain = rows.map(stripTerminalSequences);
      expect(plain[0]).toMatch(ascii ? /^\+-+\+$/ : /^╭─+╮$/);
      expect(plain.at(-1)).toMatch(ascii ? /^\+-+\+$/ : /^╰─+╯$/);
      for (const row of plain.slice(1, -1)) {
        expect(row.startsWith(ascii ? "| " : "│ ")).toBe(true);
        expect(row.endsWith(ascii ? " |" : " │")).toBe(true);
      }
      for (const row of rows) expect(visibleWidth(row)).toBe(width);
      expect(rows.join("\n")).toContain("\x1b[7m");
      if (color === "none") expect(rows.join("\n")).not.toMatch(/\x1b\[(?:38|39|90|3[0-6]);?[^m]*m/);
    } finally { await ui.shutdown(); }
  });
}

test("frame keeps ghost text, pasted input, chips and scroll counts", async () => {
  const ui = new BruineUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, new FakeTerminal(), UNICODE_ICONS);
  try {
    ui.editor.setGhost("a suggested message");
    expect(ui.promptFrame.render(30).join("\n")).toContain("a suggested message");
    ui.editor.clearGhost();
    ui.promptFrame.handleInput("\x1b[200~first\nsecond\x1b[201~");
    expect(ui.editor.getText()).toBe("first\nsecond");
    expect(ui.promptFrame.render(30).map(stripTerminalSequences).join("\n")).toContain("second");
    ui.editor.setText("[Image 1]\n[paste #1 +22 lines]");
    expect(ui.promptFrame.render(30).map(stripTerminalSequences).join("\n")).toContain("[Image 1]");
    expect(ui.promptFrame.render(30).map(stripTerminalSequences).join("\n")).toContain("[Pasted 22 lines]");
    ui.editor.setText(Array.from({ length: 14 }, (_, i) => `line ${i}`).join("\n"));
    ui.activity.start("Thinking");
    for (const width of [100, 60, 30, 12, 11, 7]) {
      const rows = ui.promptFrame.render(width);
      if (width >= 30) expect(stripTerminalSequences(rows[0]!)).toMatch(/↑ \d+ more/);
      for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    }
    ui.activity.stop();
    for (let i = 0; i < 20; i++) ui.promptFrame.handleInput("\x1b[A");
    expect(ui.promptFrame.render(30).map(stripTerminalSequences).join("\n")).toMatch(/↓ \d+ more/);
    for (const width of [5, 10, 11]) {
      const rows = ui.promptFrame.render(width).map(stripTerminalSequences);
      expect(rows[0]).not.toContain("╭");
      for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    }
  } finally { await ui.shutdown(); }
});

test.each([100, 60, 30])("autocomplete stays below the editor frame at %i columns", async width => {
  const ui = new BruineUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, new FakeTerminal(), UNICODE_ICONS);
  try {
    ui.setAutocompleteCommands([{ name: "help", description: "Show help" }, { name: "history", description: "Recent sessions" }]);
    ui.promptFrame.handleInput("/");
    await tick(); await tick();
    expect(ui.editor.isShowingAutocomplete()).toBe(true);
    const editorRows = ui.editor.render(width - 4);
    const bottom = ui.editor.frameBottomRow;
    const rows = ui.promptFrame.render(width);
    expect(stripTerminalSequences(rows[bottom]!)).toMatch(/^╰─+╯$/);
    expect(rows.slice(bottom + 1)).toEqual(editorRows.slice(bottom + 1).map(row => `  ${row}`));
    expect(rows.slice(bottom + 1).map(stripTerminalSequences).join("\n")).toContain("help");
    for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  } finally { await ui.shutdown(); }
});

test("finishing a turn keeps repaints alive until the footer counters settle", async () => {
  const tty = process.stdout.isTTY;
  vi.useFakeTimers(); vi.setSystemTime(0); process.stdout.isTTY = true;
  delete process.env.CI; delete process.env.BRUINE_ASCII; delete process.env.BRUINE_NO_ANIMATION;
  process.env.TERM = "xterm-256color";
  const ui = new BruineUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, new FakeTerminal(), UNICODE_ICONS);
  const readings = new Set<string>();
  const repaint = vi.spyOn(ui.tui, "requestRender").mockImplementation(() => {
    readings.add(stripTerminalSequences(ui.footer.render(100)[1]!));
  });
  try {
    ui.footer.set({ inputTokens: 100, outputTokens: 10 }); ui.showWorking();
    ui.footer.set({ inputTokens: 1600, outputTokens: 536 });
    ui.onTurnEnd({ tools: [], wallSec: 1, outputTokens: 536, cancelled: false, error: false });
    expect(ui.activity.active).toBe(false); expect(ui.footer.active).toBe(true);
    vi.advanceTimersByTime(700);
    expect(readings.size).toBeGreaterThan(3);
    expect([...readings].at(-1)).toContain("↑1.6k ↓536");
    expect(ui.footer.active).toBe(false);
    const finished = repaint.mock.calls.length;
    vi.advanceTimersByTime(400); expect(repaint.mock.calls).toHaveLength(finished);
  } finally { await ui.shutdown(); repaint.mockRestore(); process.stdout.isTTY = tty; vi.useRealTimers(); }
});
