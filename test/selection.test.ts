import { describe, expect, test, vi } from "vitest";
import {
  DISABLE_MOUSE,
  ENABLE_MOUSE,
  MouseScanner,
  selectedText,
  SelectionLayer,
  TextSelection,
  highlightSelection,
  viewportTop,
  type SelectionSpan,
} from "../src/ui/selection.js";
import {
  clipboardWriters,
  copyFailureNotice,
  copyNotice,
  copyTextToClipboard,
  osc52Sequence,
  type ClipboardWriter,
  type CopyOutcome,
} from "../src/ui/clipboard-write.js";
import { ToastHost } from "../src/ui/toast.js";
import { KumoUi } from "../src/ui/kumo-ui.js";
import { MOUSE_OFF_NOTICE, MOUSE_ON_NOTICE, mouseTrace, mouseSelectionAllowed } from "../src/ui/mouse.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import type { Terminal } from "@earendil-works/pi-tui";
import { strip } from "./fakes.js";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The reports in one self-contained chunk, the way a terminal sends it. */
const reports = (chunk: string): ReturnType<MouseScanner["read"]> => new MouseScanner().read(chunk);

/** SGR press/drag/release, columns and rows 1-based as a terminal sends them. */
const press = (col: number, row: number) => `\x1b[<0;${col + 1};${row + 1}M`;
const drag = (col: number, row: number) => `\x1b[<32;${col + 1};${row + 1}M`;
const release = (col: number, row: number) => `\x1b[<0;${col + 1};${row + 1}m`;

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

/** A chat with three known lines, so a selection has something to bite on. */
function makeUi(handlers: Record<string, unknown> = {}) {
  const terminal = new FakeTerminal();
  const copied: string[] = [];
  const ui = new KumoUi(
    "test",
    {
      onSubmit: () => {},
      onEscape: () => {},
      onQuit: () => {},
      copyText: async (text: string): Promise<CopyOutcome> => {
        copied.push(text);
        return { ok: true, via: "test" };
      },
      ...handlers,
    },
    terminal,
    UNICODE_ICONS,
  );
  return { ui, terminal, copied };
}

/**
 * The notices that were shown, read off the overlay itself.
 *
 * An overlay is composited inside doRender, not inside render, so a painted
 * frame never contains it. The public seam is showOverlay: spy on it, keep the
 * real call, and read what was handed over.
 */
function notices(ui: KumoUi): () => string[] {
  const seen: string[] = [];
  const spy = vi.spyOn(ui.tui, "showOverlay");
  spy.mockImplementation((component, options) => {
    seen.push(strip(component.render(60)[0] ?? "").trim());
    return { hide: () => {}, setHidden: () => {}, isHidden: () => false, focus: () => {}, unfocus: () => {}, isFocused: () => false, getBounds: () => undefined };
  });
  return () => seen;
}

const painted = (ui: KumoUi): string => ui.tui.render(60).map(strip).join("\n");

/** Where a word sits on screen: the row a mouse report has to name. */
function cellOf(ui: KumoUi, needle: string): { row: number; col: number } {
  const lines = ui.tui.render(ui.terminal.columns);
  const top = viewportTop(lines.length, ui.terminal.rows);
  const index = lines.findIndex((line) => strip(line).includes(needle));
  if (index < 0) throw new Error(`no frame line holds ${needle}`);
  return { row: index - top, col: strip(lines[index] as string).indexOf(needle) };
}

describe("mouse reports (T56)", () => {
  test("a press, a drag and a release in one chunk are three events", () => {
    const { samples, rest } = reports(`${press(2, 1)}${drag(5, 1)}${release(9, 2)}`);
    expect(samples).toEqual([
      { phase: "press", col: 2, row: 1 },
      { phase: "drag", col: 5, row: 1 },
      { phase: "release", col: 9, row: 2 },
    ]);
    expect(rest).toBe("");
  });

  test("a key that shared the chunk with a release is not lost", () => {
    // One read can carry both. Dropping the leftover would eat a keystroke.
    const { samples, rest } = reports(`${release(4, 4)}x`);
    expect(samples).toHaveLength(1);
    expect(rest).toBe("x");
  });

  test("the wheel is a report now, not a dropped one", () => {
    // It used to be discarded here, which is how the transcript stopped
    // scrolling with no word and no way for the user to know why.
    expect(reports("\x1b[<64;10;5M").samples).toEqual([
      { phase: "wheel", col: 9, row: 4, wheelDelta: 3 },
    ]);
    expect(reports("\x1b[<65;10;5M").samples).toEqual([
      { phase: "wheel", col: 9, row: 4, wheelDelta: -3 },
    ]);
    // Under ?1002 a wheel report can also carry the motion bit.
    expect(reports("\x1b[<96;10;5M").samples[0]?.wheelDelta).toBe(3);
    // Horizontal wheels are reported by the terminal, and dropped by us: there is
    // nothing horizontal to scroll.
    expect(reports("\x1b[<66;10;5M").samples).toEqual([]);
  });

  test("the right button is consumed and never acted on", () => {
    const right = reports("\x1b[<2;10;5M");
    expect(right.samples).toEqual([]);
    expect(right.rest).toBe("");
  });

  test("a terminal without SGR still selects, through the X10 form", () => {
    // ESC [ M then three bytes, each offset by 32: button 0, col 4, row 2.
    const chunk = `\x1b[M ${String.fromCharCode(32 + 5)}${String.fromCharCode(32 + 3)}`;
    expect(reports(chunk).samples).toEqual([{ phase: "press", col: 4, row: 2 }]);
  });

  test("a report the terminal cut in half is put back together", () => {
    // pi-tui hands the listeners the raw chunk (tui.js:662) with no reassembly,
    // so a press split across two reads was never seen, and a drag without a
    // press is not a selection. That is the gesture that works one time in ten.
    const scanner = new MouseScanner();
    const first = scanner.read(press(11, 4).slice(0, 6));
    expect(first.samples).toEqual([]);
    expect(first.held).toBe(true);
    const second = scanner.read(press(11, 4).slice(6));
    expect(second.samples).toEqual([{ phase: "press", col: 11, row: 4 }]);
  });

  test("half a report never reaches the editor", () => {
    // The bytes are held, not delivered: an editor that receives \x1b[<0;12
    // turns it into garbage in the prompt.
    const scanner = new MouseScanner();
    const chunk = scanner.read("\x1b[<0;12");
    expect(chunk.rest).toBe("");
    expect(chunk.held).toBe(true);
  });

  test("a key cut in half is not held: it is not a mouse", () => {
    const scanner = new MouseScanner();
    const first = scanner.read("\x1b[");
    expect(first.held).toBe(false);
    expect(first.rest).toBe("\x1b[");
  });

  test("the trace records what the terminal sent, and only when asked", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kumo-mouse-")), "mouse.log");
    mouseTrace(undefined, press(1, 1));
    expect(existsSync(file)).toBe(false);
    mouseTrace(file, press(1, 1));
    mouseTrace(file, "a");
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(press(1, 1))}\n`);
    // A trace that cannot be written must not take the UI down with it.
    expect(() => mouseTrace(join(file, "nope", "deep.log"), press(1, 1))).not.toThrow();
  });

  test("plain keys are not mistaken for a mouse", () => {
    expect(reports("\x1b[A").samples).toEqual([]);
    expect(reports("abc").samples).toEqual([]);
  });
});

describe("the gesture (T56)", () => {
  test("a click without movement selects nothing", () => {
    // The case that matters: without this, every click in kumo copies a cell and
    // fires a notice.
    const sel = new TextSelection();
    sel.press(3, 3);
    expect(sel.release()).toBeUndefined();
  });

  test("a drag report on the cell under the pointer is not movement", () => {
    const sel = new TextSelection();
    sel.press(3, 3);
    sel.drag(3, 3);
    expect(sel.release()).toBeUndefined();
  });

  test("one cell to the right is one cell, end column exclusive", () => {
    const sel = new TextSelection();
    sel.press(1, 2);
    sel.drag(1, 3);
    expect(sel.release()).toEqual({ startRow: 1, endRow: 1, startCol: 2, endCol: 4 });
  });

  test("a drag upwards starts at the focus, not at the anchor", () => {
    const sel = new TextSelection();
    sel.press(4, 6);
    sel.drag(2, 1);
    expect(sel.release()).toEqual({ startRow: 2, endRow: 4, startCol: 1, endCol: 7 });
  });

  test("a drag that never started is not a selection", () => {
    expect(new TextSelection().release()).toBeUndefined();
  });
});

describe("the visible frame (T56)", () => {
  test("the viewport is the tail of the frame, because the terminal scrolled it", () => {
    expect(viewportTop(100, 24)).toBe(76);
    expect(viewportTop(10, 24)).toBe(0);
  });

  const frame = ["first line", `\x1b[36msecond\x1b[39m line`, "third   ", ""];

  test("the text is the visible text: no colour, no padding, no blank edges", () => {
    // Rows before the last one are taken whole, the last one stops at the
    // pointer. That is what a drag across three lines means.
    const span: SelectionSpan = { startRow: 0, endRow: 2, startCol: 0, endCol: 5 };
    expect(selectedText(frame, 0, span)).toBe("first line\nsecond line\nthird");
  });

  test("a single row is cut at both ends", () => {
    const span: SelectionSpan = { startRow: 1, endRow: 1, startCol: 7, endCol: 11 };
    expect(selectedText(frame, 0, span)).toBe("line");
  });

  test("a screen row is a frame line only through the viewport offset", () => {
    // Row 0 of the screen is line 2 of the frame once the frame is taller than
    // the terminal. Reading the frame directly would copy the wrong line.
    const span: SelectionSpan = { startRow: 0, endRow: 0, startCol: 0, endCol: 5 };
    expect(selectedText(frame, 2, span)).toBe("third");
  });

  test("a selection of nothing but spaces is nothing", () => {
    const span: SelectionSpan = { startRow: 3, endRow: 3, startCol: 0, endCol: 3 };
    expect(selectedText(["      "], 0, span)).toBe("");
  });

  test("only the selected cells are painted, the rest of the line is untouched", () => {
    const lines = highlightSelection(["abcdefgh"], 0, { startRow: 0, endRow: 0, startCol: 2, endCol: 4 });
    expect(lines[0]).toBe(`ab\x1b[7mcd\x1b[27mefgh`);
  });

  test("a colour reset inside the selection cannot switch the paint off", () => {
    // \x1b[39m ends the colour, and it also ends reverse video. kumo paints tool
    // lines with palette codes, so a selection faded out halfway through one.
    const line = `\x1b[36mab\x1b[39mcd`;
    const [painted] = highlightSelection([line], 0, { startRow: 0, endRow: 0, startCol: 0, endCol: 4 });
    expect(painted.startsWith("\x1b[7m")).toBe(true);
    expect(painted.endsWith("\x1b[27m")).toBe(true);
    // Re-armed right after the reset: the second half is still selected.
    expect(painted).toContain("\x1b[39m\x1b[7mcd");
  });

  test("a line the selection does not reach comes back identical", () => {
    const lines = highlightSelection(["one", "two"], 0, { startRow: 0, endRow: 0, startCol: 0, endCol: 1 });
    expect(lines[1]).toBe("two");
  });

  test("the layer paints only while the pointer travelled", () => {
    const sel = new TextSelection();
    const layer = new SelectionLayer(
      () => sel.span,
      () => 20,
    );
    layer.addChild({ render: () => ["hello world"], invalidate: () => {} });
    expect(layer.render(20)[0]).toBe("hello world");
    sel.press(0, 0);
    sel.drag(0, 4);
    expect(layer.render(20)[0]).toBe(`\x1b[7mhello\x1b[27m world`);
  });
});

describe("the clipboard (T56)", () => {
  test("a Wayland session gets wl-copy, not the X11 tools", () => {
    // A Wayland login with only xclip installed would write to the clipboard of
    // a display that is not there.
    expect(clipboardWriters("linux", { WAYLAND_DISPLAY: "wayland-0" }).map((w) => w.cmd)).toEqual(["wl-copy"]);
    expect(clipboardWriters("linux", {}).map((w) => w.cmd)).toEqual(["xclip", "xsel"]);
  });

  test("macOS and Windows have exactly one writer each", () => {
    expect(clipboardWriters("darwin", {}).map((w) => w.cmd)).toEqual(["pbcopy"]);
    expect(clipboardWriters("win32", {}).map((w) => w.cmd)).toEqual(["clip"]);
  });

  const writer = (cmd: string): ClipboardWriter => ({ cmd, args: [], install: `install ${cmd}` });

  test("the first installed writer wins and says its name", async () => {
    const outcome = await copyTextToClipboard("hello", {
      writers: [writer("wl-copy"), writer("xclip")],
      has: async (cmd) => cmd === "xclip",
      run: async () => ({ code: 0, stderr: "" }),
    });
    expect(outcome).toEqual({ ok: true, via: "xclip" });
  });

  test("no writer installed falls back to the terminal escape", async () => {
    const sent: string[] = [];
    const outcome = await copyTextToClipboard("hello", {
      writers: [writer("wl-copy")],
      has: async () => false,
      run: async () => ({ code: 0, stderr: "" }),
      osc52: (text) => sent.push(text),
    });
    expect(sent).toEqual(["hello"]);
    expect(outcome).toEqual({ ok: true, via: "OSC 52" });
  });

  test("no writer and no escape is a failure with the way out", async () => {
    const outcome = await copyTextToClipboard("hello", { writers: [writer("wl-copy")], has: async () => false });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.install).toBe("install wl-copy");
  });

  test("a writer that fails reports its own error, not a generic one", async () => {
    const outcome = await copyTextToClipboard("hello", {
      writers: [writer("xclip")],
      has: async () => true,
      run: async () => ({ code: 1, stderr: "Error: target STRING not available\n" }),
    });
    expect(outcome).toEqual({ ok: false, reason: "Error: target STRING not available" });
  });

  test("the escape is base64 in an OSC 52", () => {
    expect(osc52Sequence("hi")).toBe(`\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07`);
  });

  test("the notice counts the characters, and hedges on the escape", () => {
    expect(copyNotice("abc", "wl-copy")).toBe("Copied 3 chars with wl-copy");
    expect(copyNotice("a", "wl-copy")).toBe("Copied 1 char with wl-copy");
    expect(copyNotice("abc", "OSC 52")).toBe("Sent 3 chars to the terminal");
    expect(copyFailureNotice("No clipboard tool", "sudo pacman -S wl-clipboard")).toBe(
      "Not copied: No clipboard tool. sudo pacman -S wl-clipboard",
    );
  });
});

describe("the corner notice (T56)", () => {
  function fakeTui(columns = 60) {
    const shown: { component: { render(width: number): string[] }; options: Record<string, unknown> }[] = [];
    const hidden: unknown[] = [];
    return {
      shown,
      hidden,
      tui: {
        terminal: { columns, rows: 20 },
        showOverlay: (component: never, options: Record<string, unknown>) => {
          const entry = { component, options };
          shown.push(entry);
          return { hide: () => hidden.push(entry) };
        },
        requestRender: () => {},
      } as never,
    };
  }

  test("the notice sits top-right and never takes the keyboard", () => {
    // nonCapturing is the whole point: a confirmation must not eat a keystroke.
    const { tui, shown } = fakeTui();
    new ToastHost(tui).show("Copied 3 chars with wl-copy");
    expect(shown[0]?.options).toMatchObject({ anchor: "top-right", nonCapturing: true, maxHeight: 1 });
    expect(shown[0]?.options["width"]).toBe(29);
  });

  test("a second notice replaces the first", () => {
    const { tui, shown, hidden } = fakeTui();
    const host = new ToastHost(tui);
    host.show("first");
    host.show("second");
    expect(shown).toHaveLength(2);
    expect(hidden).toHaveLength(1);
  });

  test("the notice expires on its own, without a sleep", () => {
    const { tui, hidden } = fakeTui();
    let fire: (() => void) | undefined;
    const host = new ToastHost(tui, {
      durationMs: 10,
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      clearTimer: () => {
        fire = undefined;
      },
    });
    host.show("Copied");
    expect(host.visible).toBe(true);
    fire?.();
    expect(hidden).toHaveLength(1);
    expect(host.visible).toBe(false);
  });

  test("an empty notice is not shown at all", () => {
    const { tui, shown } = fakeTui();
    new ToastHost(tui).show("   ");
    expect(shown).toHaveLength(0);
  });
});

describe("selecting in the shell (T56)", () => {
  test("a mouse report never reaches the editor as text", async () => {
    const { ui, terminal } = makeUi();
    ui.start();
    terminal.onInput?.(press(3, 2));
    // Before the feature the report reached the editor as raw escape bytes.
    expect(ui.editor.getText()).toBe("");
    await ui.shutdown();
  });

  test("start asks for mouse reports and shutdown gives them back", async () => {
    const { ui, terminal } = makeUi();
    ui.start();
    expect(terminal.writes).toContain(ENABLE_MOUSE);
    await ui.shutdown();
    expect(terminal.writes).toContain(DISABLE_MOUSE);
  });

  test("releasing after a drag copies the selected text and says so", async () => {
    const { ui, terminal, copied } = makeUi();
    ui.addChat({ render: () => ["alpha bravo charlie", "delta echo foxtrot"], invalidate: () => {} });
    const shown = notices(ui);
    ui.start();
    // Select "alpha" wherever it landed: the header owns the top rows.
    const at = cellOf(ui, "alpha");
    const last = at.col + "alpha".length - 1;
    terminal.onInput?.(press(at.col, at.row));
    terminal.onInput?.(drag(last, at.row));
    terminal.onInput?.(release(last, at.row));
    await vi.waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toBe("alpha");
    expect(shown().join("\n")).toContain("Copied 5 chars with test");
    await ui.shutdown();
  });

  test("a click copies nothing and shows no notice", async () => {
    const { ui, terminal, copied } = makeUi();
    ui.addChat({ render: () => ["alpha bravo"], invalidate: () => {} });
    const shown = notices(ui);
    ui.start();
    const at = cellOf(ui, "alpha");
    terminal.onInput?.(press(at.col + 2, at.row));
    terminal.onInput?.(release(at.col + 2, at.row));
    await Promise.resolve();
    expect(copied).toEqual([]);
    expect(shown()).toEqual([]);
    await ui.shutdown();
  });

  test("one gesture copies once, however many drag reports arrived", async () => {
    const { ui, terminal, copied } = makeUi();
    ui.addChat({ render: () => ["alpha bravo charlie"], invalidate: () => {} });
    ui.start();
    const at = cellOf(ui, "alpha");
    const last = at.col + "alpha".length - 1;
    terminal.onInput?.(press(at.col, at.row));
    for (let col = at.col + 1; col <= last; col += 1) terminal.onInput?.(drag(col, at.row));
    terminal.onInput?.(release(last, at.row));
    await vi.waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toBe("alpha");
    await ui.shutdown();
  });

  test("a key that shared a chunk with a release still types", async () => {
    const { ui, terminal } = makeUi();
    ui.start();
    terminal.onInput?.(`${release(4, 3)}k`);
    await vi.waitFor(() => expect(ui.editor.getText()).toBe("k"));
    await ui.shutdown();
  });

  test("KUMO_MOUSE_SELECT=0 never takes the mouse", async () => {
    const saved = process.env["KUMO_MOUSE_SELECT"];
    process.env["KUMO_MOUSE_SELECT"] = "0";
    try {
      const { ui, terminal, copied } = makeUi();
      ui.addChat({ render: () => ["alpha bravo"], invalidate: () => {} });
      ui.start();
      expect(terminal.writes).not.toContain(ENABLE_MOUSE);
      const at = cellOf(ui, "alpha");
      terminal.onInput?.(press(at.col, at.row));
      terminal.onInput?.(drag(at.col + 4, at.row));
      terminal.onInput?.(release(at.col + 4, at.row));
      await Promise.resolve();
      expect(copied).toEqual([]);
      await ui.shutdown();
    } finally {
      if (saved === undefined) delete process.env["KUMO_MOUSE_SELECT"];
      else process.env["KUMO_MOUSE_SELECT"] = saved;
    }
  });

  test("/mouse gives the wheel back and takes the mouse again", async () => {
    const { ui, terminal, copied } = makeUi();
    ui.addChat({ render: () => ["alpha bravo"], invalidate: () => {} });
    ui.start();
    expect(terminal.writes).toContain(ENABLE_MOUSE);
    // The notice has to name both the cost and the way out, or it is a shrug.
    const off = ui.mouse.toggle();
    expect(off).toMatch(/wheel scrolls/i);
    expect(off).toContain("dragging selects nothing");
    expect(terminal.writes.at(-1)).toBe(DISABLE_MOUSE);
    // Off means off: a drag now belongs to the terminal, not to us.
    const at = cellOf(ui, "alpha");
    terminal.onInput?.(press(at.col, at.row));
    terminal.onInput?.(drag(at.col + 4, at.row));
    terminal.onInput?.(release(at.col + 4, at.row));
    await Promise.resolve();
    expect(copied).toEqual([]);
    expect(ui.mouse.toggle()).toMatch(/no longer scrolls/i);
    expect(terminal.writes.at(-1)).toBe(ENABLE_MOUSE);
    await ui.shutdown();
  });

  test("/mouse off then on in one line", async () => {
    const { ui } = makeUi();
    ui.start();
    expect(ui.mouse.toggle(false)).toMatch(/wheel scrolls/i);
    expect(ui.mouse.toggle(true)).toMatch(/no longer scrolls/i);
    await ui.shutdown();
  });

  test("a form outranks the preference: /mouse on waits for the answer", async () => {
    // The form has the terminal's mouse whatever the session preference is, so
    // the notice has to say so rather than claim a mouse the terminal holds.
    const { ui, terminal } = makeUi();
    ui.start();
    ui.mouse.toggle(false);
    const answered = ui.askQuestions([
      { id: "db", header: "Mode", question: "Which database?", options: [{ label: "SQLite" }] },
    ]);
    expect(ui.mouse.toggle(true)).toContain("a form is up");
    expect(terminal.writes.at(-1)).toBe(DISABLE_MOUSE);
    terminal.onInput?.("\r");
    await answered;
    expect(terminal.writes.at(-1)).toBe(ENABLE_MOUSE);
    await ui.shutdown();
  });

  test("a form hands the mouse back to the terminal, and takes it again after", async () => {
    // A question is the moment the user reads what came before to answer it, and
    // reading means scrolling, which on the main screen is the terminal's wheel.
    const { ui, terminal } = makeUi();
    ui.start();
    const answered = ui.askQuestions([
      { id: "db", header: "Mode", question: "Which database?", options: [{ label: "SQLite" }, { label: "Redis" }] },
    ]);
    expect(terminal.writes.at(-1)).toBe(DISABLE_MOUSE);
    terminal.onInput?.("\x1b[B");
    await vi.waitFor(() => expect(terminal.writes.at(-1)).toBe(DISABLE_MOUSE));
    terminal.onInput?.("\r");
    expect(await answered).toEqual([{ id: "db", selected: ["Redis"] }]);
    expect(terminal.writes.at(-1)).toBe(ENABLE_MOUSE);
    await ui.shutdown();
  });

  test("the wheel says once that it cannot scroll, and names the way out", async () => {
    // A transcript that will not scroll with no word is indistinguishable from a
    // broken app. Once is enough: the user has read it or has not.
    const { ui, terminal } = makeUi();
    ui.start();
    terminal.onInput?.("\x1b[<64;10;5M");
    expect(painted(ui)).toContain("does not scroll");
    expect(painted(ui)).toContain("/mouse off");
    terminal.onInput?.("\x1b[<64;10;5M");
    terminal.onInput?.("\x1b[<64;10;5M");
    // The notice is 3 s and then gone, and the wheel does not bring it back.
    await new Promise((r) => setTimeout(r, 50));
    ui.showNotice("");
    expect(painted(ui)).not.toContain("does not scroll");
    await ui.shutdown();
  });

  test("with the mouse off the wheel is the terminal's, so nothing is said", async () => {
    // Reporting is off, the terminal scrolls, and there is no cost to explain.
    const { ui, terminal } = makeUi();
    ui.start();
    ui.mouse.toggle(false);
    terminal.onInput?.("\x1b[<64;10;5M");
    expect(painted(ui)).not.toContain("does not scroll");
    await ui.shutdown();
  });

  test("a copy that failed is reported as a failure", async () => {
    const { ui, terminal } = makeUi({ copyText: async () => ({ ok: false, reason: "no tool", install: "sudo pacman -S wl-clipboard" }) });
    ui.addChat({ render: () => ["alpha bravo"], invalidate: () => {} });
    const shown = notices(ui);
    ui.start();
    const at = cellOf(ui, "alpha");
    const last = at.col + "alpha".length - 1;
    terminal.onInput?.(press(at.col, at.row));
    terminal.onInput?.(drag(last, at.row));
    terminal.onInput?.(release(last, at.row));
    await vi.waitFor(() => expect(shown().join("\n")).toContain("Not copied"));
    expect(shown().join("\n")).toContain("sudo pacman -S wl-clipboard");
    await ui.shutdown();
  });
});
