import { describe, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** A write call whose content has arrived up to `lines` complete lines (and optionally part of the next). */
function writing(lines: number, partial = "", tool = "write", key = "content"): ToolCallComponent {
  const body = Array.from({ length: lines }, (_, i) => `const line${String(i + 1)} = ${String(i + 1)};`).join("\n");
  const content = lines === 0 ? partial : `${body}\n${partial}`;
  const c = new ToolCallComponent(tool, () => 0, UNICODE_ICONS);
  // The arguments stream as deltas of an unfinished JSON object.
  c.args(`{"file_path":"/tmp/app.ts","${key}":${JSON.stringify(content).slice(0, -1)}`);
  return c;
}
const rows = (c: ToolCallComponent, w = 100): string[] => c.render(w).map(strip);

describe("a file being written is shown as it arrives, then counted", () => {
  test("the first lines appear numbered, with no counter while there are only a few", () => {
    const out = rows(writing(3));
    expect(out[0]).toMatch(/write +\/tmp\/app\.ts/);
    expect(out.slice(1)).toEqual([
      "   1 │ const line1 = 1;",
      "   2 │ const line2 = 2;",
      "   3 │ const line3 = 3;",
    ]);
  });

  test("a line still being typed is already a line", () => {
    const out = rows(writing(2, "const par"));
    expect(out.at(-1)).toBe("   3 │ const par");
  });

  test("exactly ten lines show all ten and nothing else", () => {
    const out = rows(writing(10));
    expect(out.filter((l) => /^ +\d+ │/.test(l))).toHaveLength(10);
    expect(out.some((l) => /lines/.test(l))).toBe(false);
  });

  test("past ten lines the first ten stay still and a counter does the moving", () => {
    const a = rows(writing(25));
    const b = rows(writing(180));
    const numbered = (out: string[]) => out.filter((l) => /^ +\d+ │/.test(l));
    expect(numbered(a)).toHaveLength(10);
    expect(numbered(a)).toEqual(numbered(b)); // the same ten lines: nothing scrolls
    expect(a.at(-1)).toMatch(/^ +… 25 lines · \d+(\.\d)? (B|KB)$/);
    expect(b.at(-1)).toMatch(/^ +… 180 lines · /);
    expect(a).toHaveLength(12); // header, ten lines, counter
    expect(b).toHaveLength(12);
  });

  test("the counter also moves while one long line is still being written", () => {
    const small = rows(writing(30, "x".repeat(10))).at(-1)!;
    const big = rows(writing(30, "x".repeat(4000))).at(-1)!;
    expect(small).toMatch(/31 lines/);
    expect(big).toMatch(/31 lines/);
    expect(small).not.toBe(big); // the size differs, so something visibly changed
  });

  test("a trailing newline ends a line, it does not start a blank one", () => {
    const c = new ToolCallComponent("write", () => 0, UNICODE_ICONS);
    c.args('{"file_path":"a.ts","content":"one\\ntwo\\n');
    expect(rows(c).filter((l) => /^ +\d+ │/.test(l))).toHaveLength(2);
  });

  test("an edit shows the text it is putting in", () => {
    const c = writing(4, "", "edit", "new_string");
    expect(rows(c).filter((l) => /^ +\d+ │/.test(l))).toHaveLength(4);
  });

  test("a tool that writes nothing, or has no text yet, shows its header only", () => {
    expect(rows(writing(0)).length).toBe(1);
    const read = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
    read.args('{"file_path":"/tmp/a.ts"');
    expect(rows(read)).toHaveLength(1);
  });

  test("once the call is done the preview is gone and the result takes its place", () => {
    const c = writing(40);
    c.setArgs(JSON.stringify({ file_path: "/tmp/app.ts", content: "a\nb\nc\n" }));
    c.result(true, "Created file");
    const out = rows(c).join("\n");
    expect(out).not.toMatch(/\d+ │ const line/);
    expect(out).toContain("write");
  });

  test.each([100, 60, 30])("no row is wider than %i columns", (width) => {
    for (const row of writing(60, "y".repeat(500)).render(width)) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  });

  test("ASCII terminals get ASCII", () => {
    const c = new ToolCallComponent("write", () => 0, ASCII_ICONS);
    c.args(`{"file_path":"a.ts","content":${JSON.stringify(Array.from({ length: 20 }, (_, i) => `l${String(i)}`).join("\n")).slice(0, -1)}`);
    const out = c.render(80).map(strip).join("\n");
    expect(out).toContain("   1 | l0");
    expect(out).toMatch(/\.\.\. 20 lines - /);
    expect(out).not.toMatch(/[│…·]/);
  });
});
