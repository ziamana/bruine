import { describe, expect, test } from "vitest";
import { Shell } from "../src/ui/shell.js";
import { JumpToLatest } from "../src/ui/jump-latest.js";
import { displayPlace } from "../src/ui/place.js";
import { clipStart } from "../src/render/reasoning.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import { KumoUi } from "../src/ui/kumo-ui.js";
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
    // No window, so no height budget: the terminal scrolls, which is the old deal.
    expect(frame).toHaveLength(33);
    expect(shell.scrolled).toBe(false);
  });

  test("scrolled back, the frame is the terminal and the band is its last lines", () => {
    const live = block(...Array.from({ length: 30 }, (_, i) => `line ${String(i)}`));
    const shell = new Shell([block("header")], live, [block("editor"), block("footer")], () => 20);
    shell.render(40);
    shell.scrollBy(3);
    const frame = shell.render(40).map(strip);
    expect(frame).toHaveLength(20);
    // The two rows the band owns are still the last two rows, on screen.
    expect(frame.slice(-2)).toEqual(["editor", "footer"]);
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
    expect(at("editor")).toBe(held.length - 1);
    expect(at("Jump to latest")).toBe(held.length - 2);
    expect(held).toHaveLength(20);

    shell.toEnd();
    const home = shell.render(40).map(strip);
    // The flag is the frame's, not the offset's: it is settled by the next render,
    // which is also the moment the row stops being drawn.
    expect(pill.visible).toBe(false);
    expect(home.join("\n")).not.toContain("Jump to latest");
    // 1 header + 30 transcript + 1 editor: the whole frame, as before.
    expect(home).toHaveLength(32);
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
    let lines = ["one", "two", "three", "four", "five"];
    const live: Component = { render: () => lines, invalidate: () => {} };
    const shell = new Shell([], live, [block("editor")], () => 20);
    shell.render(40);
    shell.scrollBy(2);
    const newestShown = (): string => {
      const frame = shell.render(40).map(strip);
      return frame.filter((l) => l.startsWith("line ") || /^(one|two|three|four|five|six)$/.test(l)).at(-1)!;
    };
    const before = newestShown();
    lines = ["one", "two", "three", "four", "five", "six"];
    // The offset is kept constant in lines, so it grows with the live edge: the
    // reader's window does not creep forward and is certainly not yanked — the line
    // below it is still "five", and "six" has not appeared above it.
    expect(newestShown()).toBe(before);
    expect(shell.back).toBe(3);
    expect(newestShown()).not.toBe("six");
    expect(shell.render(40).map(strip).at(-1)).toBe("editor");
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
    expect(shell.render(40).map(strip).at(-1)).toBe("editor");
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

  test("a terminal too short for a window still gets its band", () => {
    const live = block(...Array.from({ length: 9 }, (_, i) => `line ${String(i)}`));
    const shell = new Shell([], live, [block("editor"), block("footer")], () => 5);
    shell.render(40);
    shell.scrollBy(4);
    const frame = shell.render(40).map(strip);
    // Too small to fit both, and the floor keeps the band whole rather than
    // spending the last rows on the window: a composer cut in half is worse.
    expect(frame.at(-2)).toBe("editor");
    expect(frame.at(-1)).toBe("footer");
  });
});

describe("PageUp keeps the composer where the user left it", () => {
  /** The one test that has to be about the real shell: the claim is about the screen. */
  test("the band is on the last rows while the transcript is read from above", async () => {
    const terminal = new FakeTerminal();
    const sent: string[] = [];
    const ui = new KumoUi(
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
    expect(scrolled.at(-1)).toBe(frame().at(-1));
    // D3: the last row of the frame is the footer's route row — a context
    // percentage and a model name, or an honest `no model` — so the band still
    // holds the bottom of the screen while the transcript is read above.
    expect(scrolled.at(-1)).toMatch(/%|no model/);
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
    expect(displayPlace("/home/tu44/projets/kumo", home)).toBe("~/projets/kumo");
  });

  test("a directory outside the home keeps its whole path", () => {
    // "~/../opt/kumo" would name a different directory than the one we are in.
    expect(displayPlace("/opt/kumo", home)).toBe("/opt/kumo");
    expect(displayPlace("/home/autre/projets/kumo", home)).toBe("/home/autre/projets/kumo");
  });

  test("separators are the readable one, on every platform", () => {
    expect(displayPlace("C:\\Users\\tu\\projets\\kumo", "C:\\Users\\tu")).toBe("~/projets/kumo");
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
