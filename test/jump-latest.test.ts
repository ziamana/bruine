/**
 * D5 — the jump-to-latest pill: one centred row, only while the window is away
 * from the live edge, and a mouse press on it that is a command rather than the
 * first half of a selection.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test } from "vitest";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { JumpToLatest } from "../src/ui/jump-latest.js";
import { MouseFeature, type MouseControl } from "../src/ui/mouse.js";
import { resetColorDepth } from "../src/ui/palette.js";
import type { Terminal } from "@earendil-works/pi-tui";
import { strip } from "./fakes.js";

/** The pill as the frame carries it: painted, centred, and inside the page margins. */
const frameWith = (pill: JumpToLatest, width: number, rows: readonly string[] = []): string[] => {
  const row = pill.render(width)[0] ?? "";
  const line = `  ${row}${" ".repeat(Math.max(0, width - 2 - visibleWidth(row)))}`;
  return [...rows, line];
};

describe("the pill (D5)", () => {
  const pill = (): JumpToLatest => {
    const j = new JumpToLatest(UNICODE_ICONS);
    j.visible = true;
    return j;
  };

  test("nothing to jump to, nothing on screen", () => {
    // At rest the frame is byte for byte what it was before D5: a pill that is
    // always there is a pill the user has learned to ignore.
    const j = new JumpToLatest(UNICODE_ICONS);
    expect(j.visible).toBe(false);
    expect(j.render(100)).toEqual([]);
    expect(j.render(30)).toEqual([]);
  });

  test("one centred row, at 100, 60 and 30", () => {
    const j = pill();
    for (const width of [100, 60]) {
      const rows = j.render(width);
      expect(rows).toHaveLength(1);
      expect(visibleWidth(rows[0]!)).toBeLessThanOrEqual(width);
      expect(strip(rows[0]!).trim()).toBe("↓ Jump to latest message · End");
      // Centred: the chip has the same margin on both sides, off by the rounding
      // of an odd width. Its left pad is one of the leading spaces.
      const plain = strip(rows[0]!);
      const chipStart = plain.length - plain.trimStart().length - 1;
      const chipEnd = visibleWidth(rows[0]!) - 1;
      expect(chipStart).toBe(width - 1 - chipEnd);
    }
    // 30 columns: the arrow and the middot are ambiguous-width glyphs, so the full
    // sentence does not fit with its padding and the pill says less.
    const narrow = j.render(30);
    expect(narrow).toHaveLength(1);
    expect(strip(narrow[0]!).trim()).toBe("↓ Latest · End");
    expect(visibleWidth(narrow[0]!)).toBeLessThanOrEqual(30);
  });

  test("too narrow for the sentence, it says less and never wraps", () => {
    const j = pill();
    expect(strip(j.render(24)[0]!).trim()).toBe("↓ Latest · End");
    expect(strip(j.render(11)[0]!).trim()).toBe("↓ End");
    // Below the chip and its two cells of padding there is no pill at all.
    expect(j.render(6)).toEqual([]);
    for (const width of [100, 60, 30, 24, 11, 7, 6, 1]) {
      for (const row of j.render(width)) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    }
  });

  test("ASCII terminals get ASCII: an arrow that is not one, and a dash", () => {
    const a = new JumpToLatest(ASCII_ICONS);
    a.visible = true;
    expect(strip(a.render(60)[0]!).trim()).toBe("v Jump to latest message - End");
    expect(strip(a.render(11)[0]!).trim()).toBe("v End");
  });

  test("the chip is the `chip` surface, and only where a background is allowed", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    try {
      const row = pill().render(60)[0]!;
      expect(row).toContain("\x1b[48;2;38;44;63m"); // chip #262c3f
      expect(row).toContain("\x1b[38;2;125;207;255m"); // sky #7dcfff
    } finally {
      process.env.KUMO_COLOR = "basic";
      resetColorDepth();
    }
    // 16 colors: no surface to tint, so the pill is the label in sky and the chip
    // is its two cells of padding — a background here reads as damage.
    const plain = pill().render(60)[0]!;
    expect(plain).toContain("\x1b[36m"); // sky at 16 colors
    expect(plain).not.toContain("\x1b[4"); // no background code at all
    expect(strip(plain).trim()).toBe("↓ Jump to latest message · End");
  });
});

describe("where the pill is on screen (D5)", () => {
  test("the frame says where it landed; the label says what it is", () => {
    const j = new JumpToLatest(UNICODE_ICONS);
    j.visible = true;
    const width = 60;
    const row = j.render(width)[0]!;
    const lines = ["  a transcript line", ...frameWith(j, width), "  ask"];
    const at = j.span(lines, 0);
    expect(at).toBeDefined();
    expect(at!.row).toBe(1);
    const label = "↓ Jump to latest message · End";
    // Columns, not characters: `↓` and `·` are ambiguous-width, and the terminal
    // reports the column it painted.
    const plain = strip(lines[1]!);
    expect(at!.from).toBe(plain.length - plain.trimStart().length - 1);
    // The chip's own padding is clickable: a target the user has to aim at is a
    // target they will miss.
    expect(at!.to - at!.from).toBe(visibleWidth(label) + 1);
    expect(j.hitTest(lines, 0, 1, at!.from + 2)).toBe(true);
    expect(j.hitTest(lines, 0, 1, at!.to)).toBe(true);
    expect(j.hitTest(lines, 0, 1, at!.from - 1)).toBe(false);
    expect(j.hitTest(lines, 0, 1, at!.to + 1)).toBe(false);
    expect(j.hitTest(lines, 0, 0, 4)).toBe(false);
    expect(j.hitTest(lines, 0, 2, 4)).toBe(false);
  });

  test("a frame taller than the screen: the pill's row in it is not the row it is on", () => {
    const j = new JumpToLatest(UNICODE_ICONS);
    j.visible = true;
    // 7 rows of frame, 5 rows of screen: the top 2 are above the viewport.
    const lines = frameWith(j, 60, ["one", "two", "three", "four"]);
    expect(j.span(lines, 2)!.row).toBe(6);
    expect(j.hitTest(lines, 2, 6, 40)).toBe(true);
    expect(j.hitTest(lines, 2, 4, 40)).toBe(false);
  });

  test("no pill in the frame means no hit, however hard the mouse looks", () => {
    const j = new JumpToLatest(UNICODE_ICONS);
    j.visible = true;
    expect(j.span(["  a transcript line", "  ask"], 0)).toBeUndefined();
    expect(j.hitTest(["  a transcript line", "  ask"], 0, 1, 3)).toBe(false);
    // Hidden is the same answer: the pill is not drawn, so it cannot be pressed.
    j.visible = false;
    expect(j.hitTest(frameWith(j, 60), 0, 0, 30)).toBe(false);
  });
});

describe("the mouse on the pill (D5)", () => {
  afterEach(() => {
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
  });

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

  /** SGR press/drag/release, columns and rows 0-based as this test thinks in them. */
  const press = (col: number, row: number): string => `\x1b[<0;${col + 1};${row + 1}M`;
  const drag = (col: number, row: number): string => `\x1b[<32;${col + 1};${row + 1}M`;
  const release = (col: number, row: number): string => `\x1b[<0;${col + 1};${row + 1}m`;

  const feature = (control?: MouseControl): { mouse: MouseFeature; terminal: FakeTerminal; copied: string[] } => {
    const terminal = new FakeTerminal();
    const copied: string[] = [];
    const mouse = new MouseFeature({
      tui: { terminal: { columns: 60, rows: 20 }, showOverlay: () => ({ hide: () => {} }), requestRender: () => {} } as never,
      terminal,
      repaint: () => {},
      notify: () => {},
      readText: (span) => `read ${span.startRow}:${span.startCol}-${span.endRow}:${span.endCol}`,
      copy: async (text: string) => {
        copied.push(text);
        return { ok: true, via: "test" };
      },
      ...(control === undefined ? {} : { control }),
    });
    mouse.start();
    return { mouse, terminal, copied };
  };

  test("a click on the pill goes back to the bottom, and selects nothing", async () => {
    const pill = new JumpToLatest(UNICODE_ICONS);
    pill.visible = true;
    const lines = ["  a transcript line", ...frameWith(pill, 60)];
    let jumped = 0;
    const control: MouseControl = {
      hit: (row, col) => pill.hitTest(lines, 0, row, col),
      activate: () => {
        jumped += 1;
      },
    };
    const { mouse, copied } = feature(control);
    const at = pill.span(lines, 0)!;
    expect(mouse.read(press(at.from + 2, at.row)).handled).toBe(true);
    expect(jumped).toBe(1);
    expect(mouse.span).toBeUndefined();
    // Drag off the pill and let go: a gesture that had started on it would have
    // copied the paragraph underneath by the time the pointer was released.
    expect(mouse.read(`${drag(9, at.row)}${release(9, at.row)}`).handled).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(copied).toEqual([]);
    expect(jumped).toBe(1);
    mouse.stop();
  });

  test("a press beside the pill still selects, so the control costs nothing", async () => {
    const pill = new JumpToLatest(UNICODE_ICONS);
    pill.visible = true;
    const lines = ["  alpha bravo charlie", ...frameWith(pill, 60)];
    let jumped = 0;
    const control: MouseControl = {
      hit: (row, col) => pill.hitTest(lines, 0, row, col),
      activate: () => {
        jumped += 1;
      },
    };
    const { mouse, copied } = feature(control);
    mouse.read(press(4, 0));
    expect(jumped).toBe(0);
    expect(mouse.span).toBeUndefined(); // nothing has travelled yet
    mouse.read(`${drag(9, 0)}${release(9, 0)}`);
    await Promise.resolve();
    await Promise.resolve();
    expect(copied).toEqual(["read 0:4-0:10"]);
    mouse.stop();
  });

  test("no control is not an error: the feature behaves exactly as before", () => {
    const { mouse } = feature();
    mouse.read(press(4, 0));
    mouse.read(drag(9, 0));
    expect(mouse.span).toEqual({ startRow: 0, endRow: 0, startCol: 4, endCol: 10 });
    mouse.stop();
  });
});