import { describe, expect, test } from "vitest";
import { Shell } from "../src/ui/shell.js";
import { JumpToLatest } from "../src/ui/jump-latest.js";
import { displayPlace } from "../src/ui/place.js";
import { clipStart } from "../src/render/reasoning.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { strip } from "./fakes.js";
import type { Component, Terminal } from "@earendil-works/pi-tui";

/** A block that always says the same thing, which is all a layout test needs. */
function block(...lines: string[]): Component {
  return { render: () => lines, invalidate: () => {} };
}

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

describe("the transcript window keeps the composer on the last row", () => {
  /**
   * The defect this file exists for: the composer sat at the END of a frame the
   * terminal scrolled, so reading anything above the last screenful took the input
   * bar off the screen with it. The frame is the only place that can fix it.
   */
  test("at rest the transcript is printed whole, exactly as before", () => {
    const live = block(...Array.from({ length: 30 }, (_, i) => `line ${String(i)}`));
    const shell = new Shell([block("header")], live, [block("editor"), block("footer")], () => 20);
    const frame = shell.render(40).map(strip);
    // No window, so no height budget: the terminal scrolls, which is the old deal,
    // plus the one blank row the bar keeps under itself.
    expect(frame).toHaveLength(34);
    expect(frame.at(-1)).toBe("");
    expect(shell.scrolled).toBe(false);
  });

  test("scrolled back, the frame is the terminal and the band is its last lines", () => {
    const live = block(...Array.from({ length: 30 }, (_, i) => `line ${String(i)}`));
    const shell = new Shell([block("header")], live, [block("editor"), block("footer")], () => 20);
    shell.render(40);
    shell.scrollBy(3);
    const frame = shell.render(40).map(strip);
    expect(frame).toHaveLength(20);
    // The two rows the band owns are still the last two rows before the blank,
    // on screen, with a row of air under them.
    expect(frame.slice(-3)).toEqual(["editor", "footer", ""]);
    // And the window really moved: the newest line is no longer the last one shown.
    expect(frame).not.toContain("line 29");
    expect(frame).toContain("line 26");
  });

  test("the hint is the jump pill, and it is only there while the window is held (D5)", () => {
    const live = block(...Array.from({ length: 30 }, (_, i) => `line ${String(i)}`));
    const pill = new JumpToLatest(UNICODE_ICONS);
    const shell = new Shell([block("header")], live, [block("editor")], () => 20, pill);
    shell.render(40);
    // The shell owns the flag, so the row and the offset it describes cannot drift.
    expect(pill.visible).toBe(false);
    expect(shell.render(40).map(strip).join("\n")).not.toContain("Jump to latest");

    shell.scrollBy(4);
    const held = shell.render(40).map(strip);
    expect(pill.visible).toBe(true);
    // One row, and it sits between the window and the band: the way back, then the
    // composer. A hint that took a second row would push the band off the screen.
    expect(held.filter((l) => l.includes("Jump to latest"))).toHaveLength(1);
    const at = (needle: string): number => held.findIndex((l) => l.includes(needle));
    expect(at("editor")).toBe(held.length - 2);
    expect(at("Jump to latest")).toBe(held.length - 3);
    expect(held.at(-1)).toBe("");
    expect(held).toHaveLength(20);

    shell.toEnd();
    const home = shell.render(40).map(strip);
    // The flag is the frame's, not the offset's: it is settled by the next render,
    // which is also the moment the row stops being drawn.
    expect(pill.visible).toBe(false);
    expect(home.join("\n")).not.toContain("Jump to latest");
    // 1 header + 30 transcript + 1 editor + the blank row: the whole frame.
    expect(home).toHaveLength(33);
  });

  test("the window never runs past the top of the history", () => {
    const live = block("one", "two", "three");
    const shell = new Shell([], live, [block("editor")], () => 20);
    shell.render(40);
    shell.scrollBy(500);
    // One line has to stay: a window with nothing in it is a blank screen.
    expect(shell.back).toBe(2);
    expect(shell.render(40).map(strip)).toContain("one");
  });

  test("a turn that keeps writing does not yank the window to the end", () => {
    // A transcript longer than the window: ten rows less the editor leave nine.
    let lines = Array.from({ length: 14 }, (_, i) => `line ${String(i)}`);
    const live: Component = { render: () => lines, invalidate: () => {} };
    const shell = new Shell([], live, [block("editor")], () => 10);
    shell.render(40);
    shell.scrollBy(2);
    const newestShown = (): string =>
      shell.render(40).map(strip).filter((l) => l.startsWith("line ")).at(-1)!;
    const before = newestShown();
    expect(before).toBe("line 11");
    lines = [...lines, "line 14"];
    // The offset is kept constant in lines, so it grows with the live edge: the
    // reader's window does not creep forward and is certainly not yanked.
    expect(newestShown()).toBe(before);
    expect(shell.back).toBe(3);
    expect(newestShown()).not.toBe("line 14");
    expect(shell.render(40).map(strip).at(-2)).toBe("editor");
  });

  test("a live turn does not move the reading a single row (D5 bug: the frame animated)", () => {
    // The defect: the window was anchored to the live edge, so every line the model
    // wrote pushed the whole visible transcript up one row — at ten repaints a
    // second, while the user was reading. The window is the reading; it must not
    // move because something else is happening below it.
    let lines = Array.from({ length: 12 }, (_, i) => `line ${String(i)}`);
    const live: Component = { render: () => lines, invalidate: () => {} };
    const shell = new Shell([block("header")], live, [block("editor")], () => 12);
    shell.render(40);
    shell.scrollBy(3);
    const shown = (): string[] =>
      shell.render(40).map(strip).filter((l) => l.startsWith("line "));
    const before = shown();
    expect(before.length).toBeGreaterThan(2);

    // A turn writing: one line at a time, the way tokens arrive.
    for (const next of ["line 12", "line 13", "line 14"]) {
      lines = [...lines, next];
      expect(shown()).toEqual(before);
      expect(shown()).not.toContain(next);
    }
    // The offset grew with the live edge, so the way back is one page longer and
    // the pill still says where the user is.
    expect(shell.back).toBe(6);
    expect(shell.scrolled).toBe(true);
    expect(shell.render(40).map(strip).at(-2)).toBe("editor");
    // PageDown still walks it home, and the window is the live edge again.
    shell.scrollBy(-6);
    expect(shell.back).toBe(0);
    expect(shown()).toContain("line 14");
  });

  test("a block leaving the transcript rebuilds the history instead of doubling it", () => {
    let lines = ["kept", "gone"];
    const live: Component = { render: () => lines, invalidate: () => {} };
    const shell = new Shell([], live, [block("editor")], () => 20);
    shell.render(40);
    lines = ["kept"];
    shell.render(40);
    shell.scrollBy(1);
    const frame = shell.render(40).map(strip);
    // The removed line is not still there, and nothing was appended twice.
    expect(frame.filter((l) => l === "gone")).toHaveLength(0);
    expect(frame.filter((l) => l === "kept")).toHaveLength(1);
  });

  test("a line that changes in place is one line in the history, not one per frame (the repeated spinner)", () => {
    // The defect users saw: a tool spinner, a "Thinking" line, a sentence being
    // written each changed in place, and the history appended the changed line and
    // everything after it again on every frame. A held window then showed the
    // spinner ten times over. The transcript renders whole each frame, so the
    // history is that render and nothing more.
    const frames = ["|", "/", "-", "\\"];
    let tick = 0;
    const body = ["first", "second", "third", "fourth", "fifth", "sixth"];
    const live: Component = {
      render: () => [body[0]!, `${frames[tick % frames.length]!} bash whoami`, "  running", ...body.slice(1)],
      invalidate: () => {},
    };
    const shell = new Shell([], live, [block("editor")], () => 40);
    shell.render(60);
    shell.scrollBy(1);
    for (tick = 1; tick <= 12; tick += 1) shell.render(60);
    const frame = shell.render(60).map(strip);
    expect(frame.filter((l) => l.endsWith("bash whoami"))).toHaveLength(1);
    expect(frame.filter((l) => l === "  running")).toHaveLength(1);
    expect(frame.filter((l) => l === "fifth")).toHaveLength(1);
    // And the way back is the transcript's own length, not a length that grows with the frames.
    expect(shell.back).toBeLessThanOrEqual(live.render(60).length - 1);
  });

  test("a sentence written word by word is one line while the window is held", () => {
    const words = ["Ça", "Ça marche", "Ça marche, je suis", "Ça marche, je suis connecté"];
    let step = 0;
    const live: Component = {
      render: () => ["intro", "", words[step]!, "", "after"],
      invalidate: () => {},
    };
    const shell = new Shell([], live, [block("editor")], () => 30);
    shell.render(60);
    shell.scrollBy(1);
    for (step = 1; step < words.length; step += 1) shell.render(60);
    step = words.length - 1;
    const frame = shell.render(60).map(strip);
    expect(frame.filter((l) => l.startsWith("Ça"))).toEqual(["Ça marche, je suis connecté"]);
  });

  test("paging past the top shows the first page whole, not a sliver of it", () => {
    // A transcript only a little longer than the window, and a page jump bigger than
    // what is above the window: the old frame showed one line and a screen of blanks.
    const lines = Array.from({ length: 20 }, (_, i) => `line ${String(i)}`);
    const live: Component = { render: () => lines, invalidate: () => {} };
    const shell = new Shell([block("header")], live, [block("editor")], () => 12);
    shell.render(40);
    shell.scrollBy(500);
    const frame = shell.render(40).map(strip);
    const shown = frame.filter((l) => l.startsWith("line "));
    // 12 rows less the header, the editor and the blank under it: nine lines,
    // from the very first.
    expect(shown).toEqual(lines.slice(0, 9));
    expect(frame[0]).toBe("header");
    expect(frame.slice(-2)).toEqual(["editor", ""]);
    expect(frame).toHaveLength(12);
  });

  test("the windowed frame's first line is not the live frame's, so the renderer redraws it whole", () => {
    // The renderer repaints only the lines that changed. A windowed frame starts with
    // lines the live one also had; without a difference on its first line a terminal
    // that had scrolled repainted from the middle and left the rest of the screen blank.
    const lines = Array.from({ length: 20 }, (_, i) => `line ${String(i)}`);
    const live: Component = { render: () => lines, invalidate: () => {} };
    const shell = new Shell([block("header")], live, [block("editor")], () => 12);
    const atRest = shell.render(40);
    shell.scrollBy(500);
    const held = shell.render(40);
    // Scrolled to the top, the window opens on the same line the live frame does.
    expect(strip(held[0]!)).toBe(strip(atRest[0]!));
    expect(held[0]).not.toBe(atRest[0]);
    // And every windowed frame carries it, so moving in the window repaints only what moved.
    shell.scrollBy(-1);
    expect(shell.render(40)[0]!.startsWith("\x1b[0m")).toBe(true);
    // Back at the live edge the line is the plain one again.
    shell.scrollBy(-50);
    expect(shell.render(40)[0]).toBe(atRest[0]);
  });

  test("the header scrolls with the transcript: out of view while reading, back at the very top", () => {
    // The wordmark is the first thing in the document. Reading back through a long
    // conversation it is far above, and it must not sit pinned over the page.
    const lines = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    const live: Component = { render: () => lines, invalidate: () => {} };
    const shell = new Shell([block("HEADER")], live, [block("editor")], () => 12);
    shell.render(40);
    shell.scrollBy(20);
    const middle = shell.render(40).map(strip);
    expect(middle).not.toContain("HEADER");
    expect(middle.at(-2)).toBe("editor");
    expect(middle.filter((l) => l.startsWith("line "))).toHaveLength(10);
    // All the way up, the header is the first line of the first page.
    shell.scrollBy(500);
    const top = shell.render(40).map(strip);
    expect(top[0]).toBe("HEADER");
    expect(top.filter((l) => l.startsWith("line "))[0]).toBe("line 0");
    expect(top.at(-2)).toBe("editor");
    expect(top.at(-1)).toBe("");
    expect(top).toHaveLength(12);
  });

  test("a terminal too short for a window still gets its band", () => {
    const live = block(...Array.from({ length: 9 }, (_, i) => `line ${String(i)}`));
    const shell = new Shell([], live, [block("editor"), block("footer")], () => 5);
    shell.render(40);
    shell.scrollBy(4);
    const frame = shell.render(40).map(strip);
    // Too small to fit both, and the floor keeps the band whole rather than
    // spending the last rows on the window: a composer cut in half is worse.
    expect(frame.slice(-3)).toEqual(["editor", "footer", ""]);
  });
});

describe("the bar keeps a row of air under it", () => {
  test("one blank row at the bottom, at rest and with the window held, at any height", () => {
    // The footer is read in one glance and it is the last thing on the screen: a bar
    // flush against the last row of a terminal reads as cut off rather than finished.
    for (const rows of [30, 20, 12, 5]) {
      const live = block(...Array.from({ length: 40 }, (_, i) => `line ${String(i)}`));
      const shell = new Shell([block("header")], live, [block("editor"), block("footer")], () => rows);
      const atRest = shell.render(40).map(strip);
      expect(atRest.slice(-3), `at rest, ${rows} rows`).toEqual(["editor", "footer", ""]);
      shell.scrollBy(6);
      const held = shell.render(40).map(strip);
      expect(held.slice(-3), `held, ${rows} rows`).toEqual(["editor", "footer", ""]);
      // And a held frame is still exactly the terminal, or the window scrolls.
      expect(held).toHaveLength(Math.max(8, rows));
    }
  });
});

describe("a frame row is mapped back to the transcript row it holds (D6)", () => {
  /** A shell whose transcript is long enough to be windowed, with a 2-row header. */
  function shellWith(rows: number): { shell: Shell; live: Component } {
    const live = block(...Array.from({ length: rows }, (_, i) => `line ${String(i)}`));
    return { shell: new Shell([block("head one"), block("head two")], live, [block("editor")], () => 20), live };
  }

  test("at rest, the transcript starts under the header", () => {
    const { shell, live } = shellWith(30);
    const frame = shell.render(40).map(strip);
    // Two header rows, so transcript row 0 is frame row 2.
    expect(shell.transcriptRowAt(2)).toBe(0);
    expect(shell.transcriptRowAt(1)).toBeUndefined();
    expect(shell.transcriptRowAt(2 + live.render(40).length - 1)).toBe(live.render(40).length - 1);
    // Past the transcript is the band, which belongs to nobody.
    expect(shell.transcriptRowAt(frame.length)).toBeUndefined();
  });

  test("a held window maps its own slice back to the same transcript rows", () => {
    const { shell } = shellWith(30);
    shell.render(40);
    shell.scrollBy(6);
    const frame = shell.render(40).map(strip);
    // The window is the tail of the history less the 6 rows below it, so the line
    // drawn on a frame row is the transcript line that row really holds.
    for (const row of [0, 1, 5, frame.length - 3]) {
      const at = shell.transcriptRowAt(row);
      if (at === undefined) continue;
      expect(strip(frame[row]!)).toBe(`line ${String(at)}`);
    }
    // The rows the gap and the band occupy are nobody's.
    expect(shell.transcriptRowAt(frame.length - 1)).toBeUndefined();
  });
});

describe("PageUp keeps the composer where the user left it", () => {
  /** The one test that has to be about the real shell: the claim is about the screen. */
  test("the band is on the last rows while the transcript is read from above", async () => {
    const terminal = new FakeTerminal();
    const sent: string[] = [];
    const ui = new BruineUi(
      "test",
      { onSubmit: (t) => sent.push(t), onEscape: () => {}, onQuit: () => {} },
      terminal,
      UNICODE_ICONS,
    );
    for (const line of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"]) {
      ui.addChat({ render: () => [line], invalidate: () => {} });
    }
    ui.start();
    const frame = (): string[] => ui.tui.render(terminal.columns).map(strip);
    frame();

    terminal.onInput?.("\x1b[5~");
    const scrolled = frame();
    // The claim, on the real screen: the frame is exactly the terminal, so nothing
    // scrolls, and the composer is still on the last row where it was left.
    expect(scrolled).toHaveLength(terminal.rows);
    expect(scrolled.at(-1)).toBe("");
    expect(scrolled.at(-2)).toBe(frame().at(-2));
    // D3: the last row of the band is the footer's route row — a context
    // percentage and a model name, or an honest `no model` — so the band still
    // holds the bottom of the screen while the transcript is read above.
    expect(scrolled.at(-2)).toMatch(/%|no model/);
    // And the way back is on screen, so the window is not a mystery.
    expect(scrolled.join("\n")).toContain("Jump to latest message");

    // PageDown walks it back to the live edge, and the frame is the tall one again.
    for (let i = 0; i < 4; i += 1) terminal.onInput?.("\x1b[6~");
    expect(frame().join("\n")).not.toContain("Jump to latest message");
    expect(ui.shell.scrolled).toBe(false);

    // A prompt is a decision to go on, so it takes the view with it.
    terminal.onInput?.("\x1b[5~");
    expect(ui.shell.scrolled).toBe(true);
    ui.editor.setText("et maintenant?");
    ui.editor.onSubmit?.("et maintenant?");
    expect(ui.shell.scrolled).toBe(false);
    expect(sent).toEqual(["et maintenant?"]);
    await ui.shutdown();
  });
});

describe("the place, said the way a person says it", () => {  const home = "/home/tu44";
  test("home is a tilde, and a project under it is a name", () => {
    expect(displayPlace(home, home)).toBe("~");
    expect(displayPlace("/home/tu44/Bureau", home)).toBe("~/Bureau");
    expect(displayPlace("/home/tu44/projets/bruine", home)).toBe("~/projets/bruine");
  });

  test("a directory outside the home keeps its whole path", () => {
    // "~/../opt/bruine" would name a different directory than the one we are in.
    expect(displayPlace("/opt/bruine", home)).toBe("/opt/bruine");
    expect(displayPlace("/home/autre/projets/bruine", home)).toBe("/home/autre/projets/bruine");
  });

  test("separators are the readable one, on every platform", () => {
    expect(displayPlace("C:\\Users\\tu\\projets\\bruine", "C:\\Users\\tu")).toBe("~/projets/bruine");
  });
});

describe("clipStart (a path is named by its tail)", () => {
  test("keeps the end, marks the cut, and never splits a grapheme", () => {
    // The ellipsis spends a cell, so 4 cells of "abcdef" is the mark and "def".
    expect(clipStart("abcdef", 4)).toBe("…def");
    expect(clipStart("abc", 10)).toBe("abc");
    expect(clipStart("abc", 0)).toBe("");
    // Wide cells are counted as cells, so a thumb is two of the four on offer.
    expect(clipStart("aaaa👍👍", 5)).toBe("…👍👍");
    expect(clipStart("aaaa👍👍", 3)).toBe("…👍");
  });
});
