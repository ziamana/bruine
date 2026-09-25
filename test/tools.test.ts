import { describe, expect, test } from "vitest";
import { ToolCallView } from "../src/render/tools.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import type { Screen } from "../src/render/reasoning.js";

class FakeScreen implements Screen {
  writes: string[] = [];
  columns = 80;
  write(s: string): void {
    this.writes.push(s);
  }
  get last(): string {
    return this.writes[this.writes.length - 1] ?? "";
  }
  get all(): string {
    return this.writes.join("");
  }
}

function fakeClock(start: number) {
  let t = start;
  return {
    now: () => t,
    set: (v: number) => {
      t = v;
    },
  };
}

const strip = (s: string) => s.replace(/\r/g, "").replace(/\x1b\[[0-9]*[A-Za-z]/g, "");

describe("ToolCallView", () => {
  test("1. full lifecycle: header fills in, result shows summary and output", () => {
    const s = new FakeScreen();
    const clock = fakeClock(0);
    const v = new ToolCallView(s, clock.now, UNICODE_ICONS);

    v.start("1", "bash");
    expect(s.last).toBe("● bash");

    v.args("1", '{"comm');
    expect(strip(s.last)).toBe("● bash  …");

    v.args("1", 'and":"ls -la"}');
    expect(strip(s.last)).toBe("● bash  ls -la");

    clock.set(400);
    v.result("1", true, "a\nb");
    const output = s.writes.slice(-3);
    expect(strip(output[0])).toMatch(/^✓ bash {2}ls -la {2}\d+\.\ds\n$/);
    expect(strip(output[1]).trim()).toBe("a");
    expect(strip(output[2]).trim()).toBe("b");
    expect(output[1]).toContain("\x1b[2m");
  });

  test("2. long output: 5 lines shown + more-lines hint", () => {
    const s = new FakeScreen();
    const v = new ToolCallView(s, fakeClock(0).now, UNICODE_ICONS);
    v.start("1", "bash");
    const twelve = Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join("\n");
    v.result("1", true, twelve);

    const output = s.writes.slice(-7);
    expect(strip(output[0]).startsWith("✓")).toBe(true);
    for (const [i, w] of output.slice(1, 6).entries()) {
      expect(strip(w).trim()).toBe(`l${i + 1}`);
    }
    expect(strip(output[6]).trim()).toBe("… 7 more lines");
  });

  test("3. path argument becomes the summary", () => {
    const s = new FakeScreen();
    const v = new ToolCallView(s, fakeClock(0).now, UNICODE_ICONS);
    v.start("1", "read");
    v.args("1", '{"path":"src/x.ts"}');
    expect(strip(s.last)).toBe("● read  src/x.ts");
  });

  test("4. failed result starts with ✗", () => {
    const s = new FakeScreen();
    const v = new ToolCallView(s, fakeClock(0).now, UNICODE_ICONS);
    v.start("1", "bash");
    v.result("1", false, "boom");
    expect(strip(s.writes[s.writes.length - 2]).startsWith("✗")).toBe(true);
  });

  test("5. unknown id is ignored silently", () => {
    const s = new FakeScreen();
    const v = new ToolCallView(s, fakeClock(0).now, UNICODE_ICONS);
    expect(() => v.args("nope", '{"a":1}')).not.toThrow();
    expect(() => v.result("nope", true, "x")).not.toThrow();
    expect(s.writes).toHaveLength(0);
  });

  test("summary falls back to compact JSON when no known key", () => {
    const s = new FakeScreen();
    const v = new ToolCallView(s, fakeClock(0).now, UNICODE_ICONS);
    v.start("1", "weather");
    v.args("1", '{"city":"Paris","days":2}');
    expect(strip(s.last)).toBe('● weather  {"city":"Paris","days":2}');
  });

  test("summary is truncated to fit columns", () => {
    const s = new FakeScreen();
    s.columns = 30;
    const v = new ToolCallView(s, fakeClock(0).now, UNICODE_ICONS);
    v.start("1", "bash");
    v.args("1", JSON.stringify({ command: "x".repeat(60) }));
    const text = strip(s.last).replace("● bash  ", "");
    // columns - tool.length - 6 = 30 - 4 - 6 = 20
    expect(text.length).toBe(20);
    expect(text.endsWith("…")).toBe(true);
  });

  test("describe exposes the current header info for approvals", () => {
    const s = new FakeScreen();
    const v = new ToolCallView(s, fakeClock(0).now, UNICODE_ICONS);
    expect(v.describe("nope")).toBeUndefined();
    v.start("1", "bash");
    v.args("1", '{"command":"rm -rf dist"}');
    expect(v.describe("1")).toEqual({ tool: "bash", summary: "rm -rf dist" });
    v.result("1", true, "done");
    expect(v.describe("1")).toBeUndefined();
  });
});
