import { afterEach, describe, expect, test } from "vitest";
import { visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { LOGO_MIN_WIDTH, paintResourceLine, planResourceLine } from "../src/ui/header.js";
import { resetColorDepth } from "../src/ui/palette.js";
import { strip } from "./fakes.js";

class FakeTerminal implements Terminal {
  cleared = 0;
  onInput?: (data: string) => void;
  columns = 100;
  rows = 30;
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
  clearScreen(): void { this.cleared += 1; }
  setTitle(): void {}
  setProgress(): void {}
}

const handlers = { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} };
const ink = { label: (s: string) => s, name: (s: string) => s, chrome: (s: string) => s };
const skills = ["apex", "brixhub", "browser", "code-review", "git-workflow", "grill-me", "herdr", "impeccable", "ssh-server", "write-tests"];

describe("planResourceLine: a kind of loaded resource on one line", () => {
  test("nothing loaded is no line at all", () => {
    expect(planResourceLine("skills", [], 100)).toBeUndefined();
    expect(planResourceLine("skills", ["  ", ""], 100)).toBeUndefined();
  });

  test("everything that fits is shown and nothing is claimed to be hidden", () => {
    const plan = planResourceLine("plugins", ["repl", "render"], 100)!;
    expect(plan.names).toEqual(["repl", "render"]);
    expect(plan.hidden).toBe(0);
  });

  test("what does not fit is counted, so the line never claims to be complete", () => {
    const plan = planResourceLine("skills", skills, 60)!;
    expect(plan.names.length).toBeLessThan(skills.length);
    expect(plan.hidden).toBe(skills.length - plan.names.length);
    expect(plan.names).toEqual(skills.slice(0, plan.names.length));
  });

  test("the hint appears only when there is room for it", () => {
    expect(planResourceLine("skills", skills, 100, { hint: "/skills" })!.hint).toBe("/skills");
    expect(planResourceLine("skills", skills, 60, { hint: "/skills" })!.hint).toBeUndefined();
  });

  test("one name longer than the room is clipped with a mark", () => {
    const plan = planResourceLine("skills", ["a-skill-name-far-too-long-for-a-narrow-terminal", "b"], 30)!;
    expect(plan.names).toHaveLength(1);
    expect(plan.names[0]!.endsWith("…")).toBe(true);
    expect(plan.hidden).toBe(1);
  });

  test.each([100, 60, 30, 20])("a painted line never passes %i columns", (width) => {
    const plan = planResourceLine("skills", skills, width, { hint: "/skills" })!;
    expect(visibleWidth(paintResourceLine(plan, width, ink))).toBeLessThanOrEqual(width);
  });

  test("labels align and the hint sits at the right edge of the line", () => {
    const a = paintResourceLine(planResourceLine("skills", skills, 100, { hint: "/skills" })!, 100, ink);
    const b = paintResourceLine(planResourceLine("plugins", ["repl", "render"], 100)!, 100, ink);
    expect(a.indexOf("apex")).toBe(b.indexOf("repl"));
    expect(visibleWidth(a)).toBe(100);
  });
});

describe("the header", () => {
  afterEach(() => resetColorDepth());

  test("with room, the wordmark is on the left and the build and the keys are beside it", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    const ui = new BruineUi("0.2.0", handlers, new FakeTerminal(), UNICODE_ICONS);
    const rows = ui.headerText(100).split("\n").map(strip);
    expect(rows[0]).toMatch(/^[█▄▀ ]+ {3}v0\.2\.0/);
    expect(rows[1]).toMatch(/^[█▄▀ ]+ {3}escape interrupt/);
    expect(rows[1]).toContain("ctrl+d exit");
    delete process.env.BRUINE_COLOR;
  });

  test("when the key labels would not fit beside the mark, the key line takes the width under it", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    const ui = new BruineUi("0.2.0", handlers, new FakeTerminal(), UNICODE_ICONS);
    const rows = ui.headerText(60).split("\n").map(strip);
    expect(rows[0]).toMatch(/^[\u2588\u2584\u2580 ]+ {3}v0\.2\.0$/);
    expect(rows[3]).toBe("escape interrupt \u00b7 ctrl+c clear \u00b7 ctrl+d exit \u00b7 / commands");
    delete process.env.BRUINE_COLOR;
  });

  test("under the mark's minimum width, or in ASCII, it is two plain lines", async () => {
    const narrow = new BruineUi("0.2.0", handlers, new FakeTerminal(), UNICODE_ICONS);
    const rows = narrow.headerText(LOGO_MIN_WIDTH - 1).split("\n").map(strip);
    expect(rows[0]).toMatch(/^▌ v0\.2\.0/);
    expect(rows.join("")).not.toMatch(/[█▄▀]/);
    const ascii = new BruineUi("0.2.0", handlers, new FakeTerminal(), ASCII_ICONS);
    expect(ascii.headerText(100)).not.toMatch(/\x1b\[|[█▄▀▌]/);
    await ascii.shutdown();
    await narrow.shutdown();
  });

  test("skills and plugins are a label and a line, after a blank row", () => {
    const ui = new BruineUi("0.2.0", handlers, new FakeTerminal(), UNICODE_ICONS);
    ui.setResources({ skills, plugins: ["repl", "render"] });
    const rows = ui.headerText(100).split("\n").map(strip);
    // The three rows of the mark, then the blank row, then one line for each kind.
    expect(rows[3]).toBe("");
    expect(rows[4]).toMatch(/^ {2}skills {3}apex · brixhub/);
    expect(rows[4]!.trimEnd().endsWith("/skills")).toBe(true);
    expect(rows[5]).toMatch(/^ {2}plugins {2}repl · render$/);
  });

  test("an empty kind is left out, never announced", () => {
    const ui = new BruineUi("0.2.0", handlers, new FakeTerminal(), UNICODE_ICONS);
    ui.setResources({ skills: [], plugins: ["repl"] });
    const rows = ui.headerText(100).split("\n").map(strip);
    expect(rows.some((row) => row.includes("skills"))).toBe(false);
    expect(rows.at(-1)).toMatch(/plugins {2}repl/);
  });

  test.each([100, 60, 46, 30])("no header line is wider than %i columns", (width) => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    const ui = new BruineUi("0.2.0", handlers, new FakeTerminal(), UNICODE_ICONS);
    ui.setResources({ skills, plugins: ["approval", "headless", "herdr", "modes", "render", "repl"] });
    for (const row of ui.headerText(width).split("\n")) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    delete process.env.BRUINE_COLOR;
  });
});

describe("the header inside the screen", () => {
  afterEach(() => resetColorDepth());

  // The header component keeps a column of margin on each side. A layout made for the
  // terminal's whole width came out two cells too wide, the terminal wrapped it, and
  // the renderer lost count of the rows. What is measured here is what is rendered.
  test.each([140, 100, 80, 62, 46, 40, 30])("no rendered line is wider than a %i-column terminal", (columns) => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    const terminal = new FakeTerminal();
    terminal.columns = columns;
    const ui = new BruineUi("0.2.0", handlers, terminal, UNICODE_ICONS);
    ui.setResources({ skills, plugins: ["approval", "headless", "herdr", "modes", "render", "repl", "startup", "web-search"] });
    ui.updateHeader();
    for (const line of ui.tui.render(columns)) expect(visibleWidth(line), `${String(columns)}: ${strip(line)}`).toBeLessThanOrEqual(columns);
    delete process.env.BRUINE_COLOR;
  });
});

describe("air above the wordmark", () => {
  afterEach(() => resetColorDepth());

  test("the screen opens on a blank row, and the wordmark is the second", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    const ui = new BruineUi("0.2.0", handlers, new FakeTerminal(), UNICODE_ICONS);
    ui.updateHeader();
    const rows = ui.tui.render(100).map(strip);
    expect(rows[0]).toBe("");
    expect(rows[1]).toMatch(/[\u2588\u2584\u2580]/);
    delete process.env.BRUINE_COLOR;
  });
});

describe("a launch takes the whole terminal", () => {
  const saved = { tty: process.stdout.isTTY, ci: process.env.CI, keep: process.env.BRUINE_NO_CLEAR };
  afterEach(() => {
    process.stdout.isTTY = saved.tty;
    if (saved.ci === undefined) delete process.env.CI;
    else process.env.CI = saved.ci;
    if (saved.keep === undefined) delete process.env.BRUINE_NO_CLEAR;
    else process.env.BRUINE_NO_CLEAR = saved.keep;
  });

  const launch = async (): Promise<number> => {
    const terminal = new FakeTerminal();
    const ui = new BruineUi("0.2.0", handlers, terminal, UNICODE_ICONS);
    ui.start();
    await ui.shutdown();
    return terminal.cleared;
  };

  test("on a terminal, what was on screen is cleared once", async () => {
    process.stdout.isTTY = true;
    delete process.env.CI;
    delete process.env.BRUINE_NO_CLEAR;
    expect(await launch()).toBe(1);
  });

  test("BRUINE_NO_CLEAR, CI and a pipe leave the screen alone", async () => {
    process.stdout.isTTY = true;
    process.env.BRUINE_NO_CLEAR = "1";
    expect(await launch()).toBe(0);
    delete process.env.BRUINE_NO_CLEAR;
    process.env.CI = "1";
    expect(await launch()).toBe(0);
    delete process.env.CI;
    process.stdout.isTTY = false;
    expect(await launch()).toBe(0);
  });
});
