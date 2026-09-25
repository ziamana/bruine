import { describe, expect, test } from "vitest";
import { TextStream } from "../src/render/text.js";
import type { Screen } from "../src/render/reasoning.js";

class FakeScreen implements Screen {
  writes: string[] = [];
  columns = 80;
  write(s: string): void {
    this.writes.push(s);
  }
  get all(): string {
    return this.writes.join("");
  }
}

describe("TextStream (T24.5 piped)", () => {
  test("1. streams deltas and ends with exactly one newline", () => {
    const s = new FakeScreen();
    const t = new TextStream(s);
    t.push("Hel");
    t.push("lo");
    t.end();
    expect(s.all).toBe("Hello\n");
  });

  test("2. no extra newline when the text already ends with one", () => {
    const s = new FakeScreen();
    const t = new TextStream(s);
    t.push("Hi\n");
    t.end();
    expect(s.all).toBe("Hi\n");
  });

  test("3. end() with no push writes nothing", () => {
    const s = new FakeScreen();
    const t = new TextStream(s);
    t.end();
    expect(s.writes).toHaveLength(0);
  });

  test("first push writes directly with no clear code", () => {
    const s = new FakeScreen();
    const t = new TextStream(s);
    t.push("a");
    t.push("b");
    expect(s.all).toBe("ab");
    expect(s.all).not.toContain("\r");
  });

  test("resets between turns", () => {
    const s = new FakeScreen();
    const t = new TextStream(s);
    t.push("one");
    t.end();
    t.push("two");
    t.end();
    expect(s.all).toBe("one\ntwo\n");
  });

  test("empty push writes nothing", () => {
    const s = new FakeScreen();
    const t = new TextStream(s);
    t.push("");
    expect(s.writes).toHaveLength(0);
  });
});
