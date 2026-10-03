import { describe, expect, test, vi } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { EscapeFilter, isEscapePress, withEscapeFilter, type EscapeTimers } from "../src/ui/escape-filter.js";

/** A clock the test turns by hand, with the timers the filter sets. */
function clock() {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; id: number; live: boolean }> = [];
  let ids = 0;
  const api: EscapeTimers = {
    now: () => t,
    set: (fn, ms) => { const id = ids++; timers.push({ at: t + ms, fn, id, live: true }); return id; },
    clear: (id) => { const hit = timers.find((x) => x.id === id); if (hit) hit.live = false; },
  };
  const advance = (ms: number): void => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      t = next.at;
      next.live = false;
      next.fn();
    }
    t = end;
  };
  return { api, advance };
}

const ESC = "\x1b";

describe("EscapeFilter: holding Escape is one Escape", () => {
  test("a single tap acts at once, without waiting", () => {
    const c = clock();
    const got: string[] = [];
    new EscapeFilter((d) => got.push(d), c.api).press(ESC);
    expect(got).toEqual([ESC]);
  });

  test("a held key acts once: the press, the repeat delay, then a stream of repeats", () => {
    const c = clock();
    const got: string[] = [];
    const f = new EscapeFilter((d) => got.push(d), c.api);
    f.press(ESC);
    c.advance(600); // the keyboard's repeat delay
    for (let i = 0; i < 20; i += 1) { f.press(ESC); c.advance(35); }
    c.advance(500);
    expect(got).toEqual([ESC]);
  });

  test("a held key whose repeats are slow is still mostly one", () => {
    const c = clock();
    const got: string[] = [];
    const f = new EscapeFilter((d) => got.push(d), c.api);
    f.press(ESC);
    c.advance(400);
    for (let i = 0; i < 12; i += 1) { f.press(ESC); c.advance(90); }
    c.advance(500);
    expect(got).toEqual([ESC]);
  });

  test("a second deliberate tap goes through, a moment late", () => {
    const c = clock();
    const got: string[] = [];
    const f = new EscapeFilter((d) => got.push(d), c.api);
    f.press(ESC);
    c.advance(300);
    f.press(ESC);
    expect(got).toHaveLength(1); // waiting to see whether it is a repeat
    c.advance(130);
    expect(got).toHaveLength(2);
  });

  test("a tap after a pause is a new press, held or not before it", () => {
    const c = clock();
    const got: string[] = [];
    const f = new EscapeFilter((d) => got.push(d), c.api);
    f.press(ESC);
    c.advance(600);
    for (let i = 0; i < 5; i += 1) { f.press(ESC); c.advance(40); }
    expect(got).toHaveLength(1);
    c.advance(3000); // let go, and wait
    f.press(ESC);
    expect(got).toHaveLength(2);
    // And that one can be held again without acting twice.
    c.advance(600);
    for (let i = 0; i < 5; i += 1) { f.press(ESC); c.advance(40); }
    c.advance(500);
    expect(got).toHaveLength(2);
  });

  test("dispose drops a press that was still waiting", () => {
    const c = clock();
    const got: string[] = [];
    const f = new EscapeFilter((d) => got.push(d), c.api);
    f.press(ESC);
    c.advance(300);
    f.press(ESC);
    f.dispose();
    c.advance(1000);
    expect(got).toHaveLength(1);
  });
});

describe("withEscapeFilter: the screens see only what comes out", () => {
  function fakeTerminal() {
    const inner = {
      onInput: undefined as ((d: string) => void) | undefined,
      stopped: 0,
      start(onInput: (d: string) => void) { this.onInput = onInput; },
      stop() { this.stopped += 1; },
      async drainInput() {},
      write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
      columns: 100, rows: 30, kittyProtocolActive: false,
    };
    return inner as typeof inner & Terminal;
  }

  test("keys that are not Escape pass straight through, in order", () => {
    const c = clock();
    const inner = fakeTerminal();
    const seen: string[] = [];
    withEscapeFilter(inner, c.api).start((d) => seen.push(d), () => {});
    for (const key of ["a", "\x1b[A", "\r", "\x1b[Z", "b"]) inner.onInput!(key);
    expect(seen).toEqual(["a", "\x1b[A", "\r", "\x1b[Z", "b"]);
  });

  test("Escape goes through the filter, and a held one reaches the screen once", () => {
    const c = clock();
    const inner = fakeTerminal();
    const seen: string[] = [];
    withEscapeFilter(inner, c.api).start((d) => seen.push(d), () => {});
    inner.onInput!(ESC);
    c.advance(600);
    for (let i = 0; i < 15; i += 1) { inner.onInput!(ESC); c.advance(35); }
    inner.onInput!("x");
    c.advance(500);
    expect(seen).toEqual([ESC, "x"]);
  });

  test("one tap of Escape on a kitty-protocol terminal is one Escape: the release is not a second one", () => {
    const c = clock();
    const inner = fakeTerminal();
    const seen: string[] = [];
    withEscapeFilter(inner, c.api).start((d) => seen.push(d), () => {});
    // Press, then the key coming back up, as the terminal reports them.
    inner.onInput!("\x1b[27u");
    inner.onInput!("\x1b[27;1:3u");
    c.advance(500);
    expect(seen).toEqual(["\x1b[27u"]);
  });

  test("no key release reaches a screen, whichever key: Escape, Ctrl+C, a letter, an arrow", () => {
    const c = clock();
    const inner = fakeTerminal();
    const seen: string[] = [];
    withEscapeFilter(inner, c.api).start((d) => seen.push(d), () => {});
    for (const release of ["\x1b[27;1:3u", "\x1b[99;5:3u", "\x1b[97;1:3u", "\x1b[1;1:3A", "\x1b[13;1:3u"]) inner.onInput!(release);
    expect(seen).toEqual([]);
  });

  test("presses and repeats of other keys still go through, so typing is unharmed", () => {
    const c = clock();
    const inner = fakeTerminal();
    const seen: string[] = [];
    withEscapeFilter(inner, c.api).start((d) => seen.push(d), () => {});
    for (const key of ["\x1b[97u", "\x1b[97;1:2u", "\x1b[99;5u", "\x1b[1;1:1A"]) inner.onInput!(key);
    expect(seen).toEqual(["\x1b[97u", "\x1b[97;1:2u", "\x1b[99;5u", "\x1b[1;1:1A"]);
  });

  test("it looks like the terminal it wraps", () => {
    const inner = fakeTerminal();
    const t = withEscapeFilter(inner);
    expect([t.columns, t.rows, t.kittyProtocolActive]).toEqual([100, 30, false]);
    t.start(() => {}, () => {});
    t.stop();
    expect(inner.stopped).toBe(1);
  });

  test("isEscapePress is the bare key, not a sequence that starts with it", () => {
    expect(isEscapePress(ESC)).toBe(true);
    expect(isEscapePress("\x1b[A")).toBe(false);
    expect(isEscapePress("\x1b[200~")).toBe(false);
    expect(isEscapePress("a")).toBe(false);
  });

  test("a timer that fires after stop delivers nothing", () => {
    const c = clock();
    const inner = fakeTerminal();
    const seen = vi.fn();
    const t = withEscapeFilter(inner, c.api);
    t.start(seen, () => {});
    inner.onInput!(ESC);
    c.advance(300);
    inner.onInput!(ESC);
    t.stop();
    c.advance(1000);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
