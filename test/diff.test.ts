/**
 * A diff is read as a list of statements about two files, so it needs three things
 * the old one lacked: a neutral block (the bands are the only colour in it), a sign
 * that cannot be mistaken for content, and the line numbers of both files.
 */
import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { diffCounter, diffForCall, renderDiff, type FileDiff } from "../src/ui/diff-view.js";
import { bgCode, contrastRatio, deriveBackdrop, fgCode, NUAGE, resetColorDepth, setTerminalBackdrop } from "../src/ui/palette.js";
import { strip } from "./fakes.js";

const plain = (rows: string[]): string[] => rows.map(strip);

/** A diff of one replaced line, in a file that really is on disk (numbers). */
function numberedDiff(): FileDiff {
  const dir = mkdtempSync(join(tmpdir(), "kumo-diff-"));
  const file = join(dir, "a.ts");
  writeFileSync(file, "const head = 0\nconst x = 1\nconst y = 3\n");
  const d = diffForCall("edit", JSON.stringify({ path: file, old_string: "const x = 2", new_string: "const x = 1" }));
  if (d === undefined) throw new Error("no diff");
  return d;
}

describe("the sign can never be read as content", () => {
  test("the sign has its own column and one gutter cell away from the text", () => {
    const d = diffForCall("edit", JSON.stringify({ path: "/nope/x.ts", old_string: "a\nb\n", new_string: "a\nc\nd\n" }))!;
    const rows = plain(renderDiff(d, 40));
    // The old layout printed `-b` and `+c`, which is a markdown bullet with a
    // character glued to it, and `+-` wherever a bullet followed an addition.
    expect(rows.some((l) => l.includes("- b"))).toBe(true);
    expect(rows.some((l) => l.includes("+ c"))).toBe(true);
    expect(rows.some((l) => /[-+][^ ]/.test(l.trimStart()))).toBe(false);
    // The sign is its own cell: the column is one wide, then a gutter.
    for (const row of rows) expect(row[0]).toMatch(/^[-+ a]/);
  });

  test("text that starts with a sign is still text", () => {
    const d = diffForCall("edit", JSON.stringify({ path: "/nope/x.ts", old_string: "x", new_string: "-- **Pression**" }))!;
    const rows = plain(renderDiff(d, 40));
    expect(rows.some((l) => l.includes("+ -- **Pression**"))).toBe(true);
  });

  test("ASCII has the same shape, with the ASCII ellipsis", () => {
    const d = diffForCall("write", JSON.stringify({ path: "n.ts", content: Array.from({ length: 30 }, (_, i) => `line ${String(i)}`).join("\n") }))!;
    const rows = renderDiff(d, 40, true);
    expect(rows.join("")).not.toContain("\u2026");
    expect(strip(rows.at(-1)!)).toContain("18 more lines");
    for (const row of rows) expect(visibleWidth(strip(row))).toBeLessThanOrEqual(40);
  });
});

describe("the two numberings", () => {
  test("a removed line carries the old file's number, an added one the new file's", () => {
    const d = numberedDiff();
    const rows = plain(renderDiff(d, 60));
    // `const x = 2` was line 2 before, `const x = 1` is line 2 after, and the line
    // below kept both numbers because it is in both files.
    expect(rows[0]).toMatch(/^2\s+- const x = 2/);
    expect(rows[1]).toMatch(/^\s*2 \+ const x = 1/);
    expect(d.lines.find((l) => l.kind === "del")?.old).toBe(2);
    expect(d.lines.find((l) => l.kind === "add")?.n).toBe(2);
  });

  test("a write has no old file, so the old column is not drawn at all", () => {
    const w = diffForCall("write", JSON.stringify({ path: "n.ts", content: "x\ny\n" }))!;
    const rows = plain(renderDiff(w, 40));
    expect(rows[0]).toMatch(/^1 \+ x/);
    expect(rows[0]).not.toMatch(/0/);
  });

  test("a file that cannot be read has no numbers, and says nothing false", () => {
    const d = diffForCall("edit", JSON.stringify({ path: "/nonexistent/x.ts", old_string: "a", new_string: "b" }))!;
    for (const row of plain(renderDiff(d, 40))) expect(row[0]).toMatch(/[-+ ]/);
  });

  test("at 30 columns the old numbering gives up its room before the text does", () => {
    const d = numberedDiff();
    const narrow = plain(renderDiff(d, 30));
    for (const row of narrow) {
      expect(row).toContain("const x");
      expect(visibleWidth(row)).toBeLessThanOrEqual(30);
    }
    expect(plain(renderDiff(d, 100))[0]).toMatch(/^2\s+-/);
  });
});

describe("the bands, on a neutral block", () => {
  afterEach(() => {
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
  });

  test("an added line and a removed one are painted the same way", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    const rows = renderDiff(numberedDiff(), 60);
    const add = rows[1]!;
    const del = rows[0]!;
    expect(add).toContain(bgCode("addBg", "truecolor"));
    expect(del).toContain(bgCode("delBg", "truecolor"));
    // Neither band is the block behind it, and neither is the other.
    expect(add).not.toContain(bgCode("delBg", "truecolor"));
    expect(del).not.toContain(bgCode("addBg", "truecolor"));
    // Same strength: the same role paints the text on both.
    expect(add).toContain(fgCode("addFg", "truecolor"));
    expect(del).toContain(fgCode("delFg", "truecolor"));
  });

  test("both bands clear AA with their own text, and the two are equally strong", () => {
    for (const [fg, bg] of [["addFg", "addBg"], ["delFg", "delBg"]] as const) {
      expect(contrastRatio(NUAGE[fg].hex, NUAGE[bg].hex)).toBeGreaterThanOrEqual(4.5);
    }
    // The green used to be so quiet that it vanished into a green card: the two
    // bands now sit the same distance from the neutral block they paint on.
    const green = Math.abs(contrastRatio(NUAGE.addBg.hex, NUAGE.toolPending.hex) - contrastRatio(NUAGE.delBg.hex, NUAGE.toolPending.hex));
    expect(green).toBeLessThan(0.9);
  });

  test("the bands follow the terminal's real background", () => {
    const dark = deriveBackdrop({ r: 0, g: 0, b: 0 });
    const light = deriveBackdrop({ r: 255, g: 255, b: 255 });
    for (const role of ["addBg", "delBg"] as const) {
      expect(dark[role]).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[role]).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[role]).not.toBe(dark[role]);
    }
    setTerminalBackdrop({ r: 255, g: 255, b: 255 });
    expect(bgCode("addBg", "truecolor")).not.toBe(bgCode("delBg", "truecolor"));
    resetColorDepth();
  });

  test("no colour and no background: the sign still says which side is which", () => {
    process.env.KUMO_COLOR = "none";
    resetColorDepth();
    const rows = renderDiff(numberedDiff(), 60);
    expect(rows.join("")).not.toMatch(/\x1b\[/);
    expect(rows.some((r) => r.includes("- ")) && rows.some((r) => r.includes("+ "))).toBe(true);
  });
});

describe("the counter in the header", () => {
  test("+2 -1, in the two colours that mean them", () => {
    const d = diffForCall("edit", JSON.stringify({ path: "/nope/x.ts", old_string: "a\nb\n", new_string: "a\nc\nd\n" }))!;
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(strip(diffCounter(d))).toBe("+2 -1");
  });
});
