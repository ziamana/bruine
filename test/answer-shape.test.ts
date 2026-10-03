/**
 * The reading shape of an answer: prose measured at READ_WIDTH on a wide
 * terminal, code and tables left as wide as they need, one blank line between
 * two blocks, and a title that looks like one.
 *
 * Rendered at 100, 60 and 30 columns, in ASCII and without colour, because a
 * block that overflows, an escape that leaks, or a blank line swallowed inside a
 * piece of code are all defects a unit test is cheaper for than a screenshot.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { AssistantTextComponent } from "../src/ui/assistant-text.js";
import { oneBlankBetween, READ_WIDTH, shapeAnswer } from "../src/render/markdown.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { resetColorDepth } from "../src/ui/palette.js";
import { strip } from "./fakes.js";

const answer = (markdown: string, icons = UNICODE_ICONS, width = 100): string[] => {
  const c = new AssistantTextComponent({ icons, animate: false });
  c.push(markdown);
  c.finish();
  return c.render(width).map(strip);
};

/** A paragraph long enough to cross the reading width and then some. */
const LONG =
  "Words keep coming and the line keeps growing past every comfortable measure a person reads at, " +
  "well past a hundred and ten columns of text, so the wrap has something real to do here.";

describe("the measure of prose", () => {
  test("a paragraph is read at 110 columns, not at every cell the terminal has", () => {
    const rows = answer(LONG, UNICODE_ICONS, 200);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(visibleWidth(row.trimEnd())).toBeLessThanOrEqual(READ_WIDTH);
    // And the words are all still there: a shorter measure is not a shorter answer.
    expect(rows.join(" ").trim().split(/\s+/)).toEqual(LONG.split(/\s+/));
  });

  test("a narrow terminal still gets its own width, and nothing overflows", () => {
    for (const width of [100, 60, 30]) {
      const rows = answer(LONG, UNICODE_ICONS, width);
      for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
    }
    // The measure is the reading width on a wide terminal and the terminal on a
    // narrow one: the same sentence either way, only shorter.
    expect(visibleWidth(answer(LONG, UNICODE_ICONS, 200)[0]!.trimEnd())).toBe(106);
    expect(visibleWidth(answer(LONG, UNICODE_ICONS, 60)[0]!.trimEnd())).toBeLessThanOrEqual(60);
  });

  test("code fences and tables keep every column they were given", () => {
    const long = "x".repeat(150);
    const rows = answer(["```ts", `const value = "${long}";`, "```", "", "| a | b |", "|---|---|", `| ${long} | 2 |`, ""].join("\n"), UNICODE_ICONS, 200);
    const code = rows.find((row) => row.includes("const value"))!;
    expect(code).toContain(long);
    // The table keeps its own layout and its widest cell: the box is drawn at the
    // width it needs, not at the reading width of a paragraph.
    expect(rows.some((row) => row.includes(long))).toBe(true);
    expect(rows.some((row) => row.includes("\u2502 a"))).toBe(true);
  });

  test("wrapping never invents structure: a marker is never alone at the start of a line", () => {
    const rows = answer(`first words and more words to push the line along - a dash in the middle - and another one`, UNICODE_ICONS, 200);
    for (const row of rows) expect(row.trimStart()).not.toMatch(/^[-*+>#|]/);
  });

  test("a paragraph holding a link is left exactly as it was written", () => {
    const withLink = `see [the docs](https://example.com/a/very/long/path/that/would/break/at/its/worst/place) for more`;
    expect(shapeAnswer(withLink, 200)).toBe(withLink);
    expect(shapeAnswer(`a bare https://example.com/${"segment/".repeat(30)} url`, 200)).toContain("://");
  });

  test("a list item wraps under its text, and the next item is its own", () => {
    const rows = answer(["- " + LONG, "- second item", "", "1. ordered", `2. ${LONG}`].join("\n"), UNICODE_ICONS, 200);
    // Four items, four markers: an item that wrapped did not swallow the next one.
    expect(rows.filter((row) => /^\s*(?:- |\d\. )/.test(row))).toHaveLength(4);
    // The continuation of the first item lines up under its text, not its dash.
    expect(rows[1]).toMatch(/^ {2}\S/);
    expect(rows.join(" ")).toContain("second item");
  });

  test("an indented block and a fenced block are code, and are never touched", () => {
    const indented = ["paragraph", "", `    ${"a very long indented line ".repeat(10)}`.trimEnd(), "", "after"].join("\n");
    expect(shapeAnswer(indented, 200)).toContain("    a very long indented line");
    const fenced = ["```", LONG, "```"].join("\n");
    expect(shapeAnswer(fenced, 200)).toBe(fenced);
  });

  test("a title underlined with a rule keeps the rule under it", () => {
    // Setext, not a paragraph: the `===` has to stay on its own line or the
    // title above it stops being a title.
    expect(shapeAnswer(["A title", "==="].join("\n"), 200)).toBe("A title\n===");
    // Painted as a heading, not as a paragraph.
    const c = new AssistantTextComponent({ icons: UNICODE_ICONS, animate: false });
    c.push(["A title", "===", "", "under it"].join("\n"));
    c.finish();
    expect(c.render(200)[0]!.replace(/\x1b\[[0-9;]*m/g, "").trimEnd()).toBe("A title");
    expect(c.render(200)[0]).toContain("\x1b[34m");
  });
});

describe("the rhythm between blocks", () => {
  test("one blank line, whatever the renderer left behind", () => {
    const rows = answer(["one", "", "```ts", "const x = 1;", "```", "", "two"].join("\n"), UNICODE_ICONS, 100);
    // paragraph, one blank, label, code, closing rule, one blank, paragraph. The
    // renderer leaves three blanks after a fence; the answer shows one.
    expect(rows.map((row) => row.trimEnd())).toEqual([
      "one", "", "\u258f ts", "\u258f const x = 1;", "\u258f", "", "two",
    ]);
  });

  test("a blank line inside code is not a blank line at all", () => {
    const rows = answer(["```", "const a = 1;", "", "const b = 2;", "```"].join("\n"), UNICODE_ICONS, 100);
    // The empty line inside the fence keeps its gutter, so the collapse can never
    // eat the air the code asked for.
    expect(rows).toHaveLength(5);
    expect(rows[2]!.trimEnd()).toBe("\u258f");
  });

  test("the collapse is idempotent and leaves a single leading and trailing gap alone", () => {
    expect(oneBlankBetween(["a", "", "", "b"])).toEqual(["a", "", "b"]);
    expect(oneBlankBetween(["", "", "a"])).toEqual(["", "a"]);
  });
});

describe("one treatment for every code block", () => {
  test("the language rides the gutter, and a block without one keeps the same shape", () => {
    const rows = answer(["```ts", "const x = 1;", "```", "", "```", "plain", "```"].join("\n"), UNICODE_ICONS, 100).map((row) => row.trimEnd());
    const [label, code, close, , bare, plain, closeBare] = rows;
    expect(label).toBe("\u258f ts");
    expect(code).toBe("\u258f const x = 1;");
    // Same rule, no text: a block without a language is not another kind of block.
    expect(bare).toBe("\u258f");
    expect(close).toBe("\u258f");
    expect(closeBare).toBe("\u258f");
    expect(plain).toBe("\u258f plain");
  });

  test("ASCII terminals get an ASCII gutter", () => {
    const rows = answer(["```ts", "const x = 1;", "```"].join("\n"), ASCII_ICONS, 100);
    expect(rows.map((row) => row.trimEnd())).toEqual(["| ts", "| const x = 1;", "|"]);
  });

  test("a terminal that cannot read colour gets no colour escape at all", () => {
    process.env.BRUINE_COLOR = "none";
    resetColorDepth();
    try {
      const c = new AssistantTextComponent({ icons: ASCII_ICONS, animate: false });
      c.push(["## A title", "", "```ts", "const x = 1;", "```", "", "text with `code`"].join("\n"));
      c.finish();
      // Bold is an attribute, not a colour: it stays. No foreground code does.
      expect(c.render(100).join("")).not.toMatch(/\x1b\[(?:3[0-7]|9[0-7])m/);
      expect(c.render(100).join("\n")).toContain("| ts");
    } finally {
      process.env.BRUINE_COLOR = "basic";
      resetColorDepth();
    }
  });
});

describe("a title looks like one", () => {
  test("a heading gets the air above it even when the source left none", () => {
    const rows = answer(["a paragraph", "## The title", "under it"].join("\n"), UNICODE_ICONS, 100).map((row) => row.trimEnd());
    expect(rows).toEqual(["a paragraph", "", "The title", "", "under it"]);
  });

  test("the accent is the sober one, and not the sky the links wear", () => {
    const c = new AssistantTextComponent({ icons: UNICODE_ICONS, animate: false });
    c.push("## The title\n\nA [link](https://example.com) here.");
    c.finish();
    const row = c.render(100).find((line) => line.includes("The title"))!;
    // skyDeep is the basic code 34, sky (the links' colour) is 36: one accent at
    // a time, so a title never reads as a link.
    expect(row).toContain("\x1b[34m");
    expect(row).not.toContain("\x1b[36m");
    const link = c.render(100).find((line) => line.includes("link"))!;
    expect(link).toContain("\x1b[36m");
  });
});