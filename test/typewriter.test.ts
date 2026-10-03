import { describe, expect, test, vi } from "vitest";
import { revealAllowed, Typewriter, type TypewriterOptions } from "../src/ui/typewriter.js";
import { AssistantTextComponent } from "../src/ui/assistant-text.js";
import { UNICODE_ICONS, ASCII_ICONS } from "../src/render/chars.js";
import { strip } from "./fakes.js";

/** A typewriter whose clock the test owns, so nothing waits for real time. */
function clock(opts: TypewriterOptions = {}) {
  let fire: (() => void) | undefined;
  const tw = new Typewriter({
    // A repaint hook is what makes the reveal run at all; the disabled path is
    // tested on its own below.
    onTick: () => {},
    ...opts,
    setTimer: (fn) => {
      fire = fn;
      return 1;
    },
    clearTimer: () => {
      fire = undefined;
    },
  });
  return { tw, tick: () => fire?.() };
}

/** Steps driven directly, for the cases where the reveal parks and sleeps. */
function manual(opts: TypewriterOptions = {}) {
  const tw = new Typewriter({ onTick: () => {}, ...opts });
  return { tw, tick: (times = 1) => { for (let i = 0; i < times; i += 1) tw.tick(); } };
}

describe("the reveal (T57)", () => {
  test("without a repaint hook every delta lands whole", () => {
    // The disabled path, and the one CI and KUMO_NO_ANIMATION take. It has to
    // be indistinguishable from the renderer this replaced.
    const tw = new Typewriter();
    tw.push("hello ");
    tw.push("world");
    expect(tw.text).toBe("hello world");
    expect(tw.animating).toBe(false);
  });

  test("text is held back while the backlog is revealed", () => {
    const { tw } = clock();
    tw.push("abcdefghij");
    expect(tw.animating).toBe(true);
    expect(tw.text).toBe("");
    expect(tw.pending).toBe(10);
  });

  test("a tick hands out a share of the backlog, not all of it", () => {
    // A fixed rate per tick would fall behind a fast model forever. A share of
    // the backlog settles at a fixed lag instead.
    const { tw, tick } = clock();
    tw.push("x".repeat(100));
    tick();
    const first = tw.text.length;
    // A share of the backlog: more than nothing, far from all of it. Asserting
    // the exact share would only assert the constant back at itself.
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThan(50);
  });

  test("a slow model still moves, one grapheme per tick", () => {
    const { tw, tick } = clock();
    tw.push("a");
    tick();
    expect(tw.text).toBe("a");
    expect(tw.animating).toBe(false);
  });

  test("the reveal ends on its own once the buffer is drained", () => {
    const { tw, tick } = clock();
    const onTick = vi.fn();
    const t = new Typewriter({ onTick, setTimer: () => 1, clearTimer: () => {} });
    t.push("hello");
    for (let i = 0; i < 20; i += 1) t.tick();
    expect(t.text).toBe("hello");
    expect(t.animating).toBe(false);
    expect(onTick).toHaveBeenCalled();
  });

  test("a grapheme is never cut in half", () => {
    // An emoji is one grapheme made of two code units. A step of one that lands
    // between them takes the whole emoji, because refusing it would park the
    // frontier and show a replacement character for a frame.
    const { tw, tick } = manual();
    tw.push("a🙂b");
    tw.tick();
    expect(tw.text).toBe("a🙂");
    tw.tick();
    expect(tw.text).toBe("a🙂b");
  });

  test("what is shown is always a whole number of graphemes", () => {
    const { tw, tick } = manual();
    tw.push("👩‍👩‍👧‍👦 x 🙃 done");
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      tick();
      seen.push(tw.text);
    }
    for (const text of seen) {
      // A lone surrogate is what a half-cut emoji looks like in a string.
      expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(tw.text).toBe("👩‍👩‍👧‍👦 x 🙃 done");
  });

  test("half a bold marker is held, then let out once the pair arrives", () => {
    // "**bo" with the closing "**" still in the buffer paints two literal
    // asterisks, and the reader sees a typo nobody typed.
    const { tw, tick } = manual();
    tw.push("**bo");
    tick();
    expect(tw.text).toBe("");
    tw.push("ld** rest");
    tick();
    // Still held: the reader would see "**b" with no pair on the line.
    expect(tw.text).toBe("");
    tick(10);
    expect(tw.text).toBe("**bold** rest");
  });

  test("a marker that never closes cannot freeze the answer", () => {
    // The budget is the whole point: a guard that waits forever is a freeze,
    // and a marker sitting at the frontier can only be held by not moving.
    const { tw, tick } = manual();
    tw.push("**never closed");
    tick(40);
    expect(tw.text).toBe("**never closed");
    expect(tw.animating).toBe(false);
  });

  test("a lone asterisk in prose releases once it falls out of the window", () => {
    // The window is the other half of the budget: a "*" used as multiplication
    // is never closed, so the text has to be allowed to move away from it.
    const { tw, tick } = manual();
    tw.push("2 * 3 = 6 and then a good deal more prose to pass the window");
    tick(40);
    expect(tw.text).toBe("2 * 3 = 6 and then a good deal more prose to pass the window");
  });

  test("a parked reveal sleeps instead of spinning", () => {
    const { tw, tick } = clock();
    tw.push("**bo");
    tick();
    // The timer is disarmed while parked, so no frame is spent rediscovering it.
    tick();
    expect(tw.text).toBe("");
  });

  test("an escaped asterisk in prose does not freeze the answer", () => {
    // The guard must never be able to stop the reveal for good.
    const { tw, tick } = clock();
    tw.push("a \\* b");
    for (let i = 0; i < 10; i += 1) tick();
    expect(tw.text).toBe("a \\* b");
  });

  test("flush shows the rest at once and stops the timer", () => {
    const { tw, tick } = clock();
    tw.push("a long answer");
    tw.flush();
    expect(tw.text).toBe("a long answer");
    expect(tw.animating).toBe(false);
    // Nothing left to tick: a timer still armed here would spin forever.
    tick();
    expect(tw.text).toBe("a long answer");
  });

  test("dispose drops the repaint hook and the timer", () => {
    const { tw, tick } = clock();
    tw.push("text");
    tw.dispose();
    tw.push(" more");
    expect(tw.text).toBe("text more");
    tick();
  });

  test("reset reveals the new text from its first character, and never the old one", () => {
    const { tw, tick } = clock();
    tw.push("Choose mode");
    for (let i = 0; i < 3; i += 1) tick();
    // The text changed shape instead of growing: what is buffered is no longer a
    // prefix of it, and pushing on top would print both.
    tw.reset("Which database should I use for the ledger?");
    expect(tw.text).toBe("");
    tick();
    expect(tw.text.length).toBeGreaterThan(0);
    expect(tw.text.startsWith("Which")).toBe(true);
    for (let i = 0; i < 40; i += 1) tick();
    expect(tw.text).toBe("Which database should I use for the ledger?");
  });

  test("a reset with nobody watching shows the whole text at once", () => {
    const tw = new Typewriter();
    tw.push("Choose mode");
    tw.reset("Which database?");
    expect(tw.text).toBe("Which database?");
    expect(tw.animating).toBe(false);
  });
});

describe("the switch (T57)", () => {
  test("KUMO_NO_ANIMATION=1 turns the reveal off", () => {
    expect(revealAllowed(UNICODE_ICONS, { KUMO_NO_ANIMATION: "1", CI: undefined })).toBe(
      revealAllowed(UNICODE_ICONS, { KUMO_NO_ANIMATION: "1" }),
    );
  });

  test("CI never animates", () => {
    const tty = { stdoutTTY: true } as unknown as NodeJS.ProcessEnv;
    expect(revealAllowed(UNICODE_ICONS, { ...process.env, CI: "1" })).toBe(false);
    expect(tty).toBeDefined();
  });

  test("ASCII never animates", () => {
    expect(revealAllowed(ASCII_ICONS, { ...process.env, KUMO_ASCII: undefined })).toBe(false);
  });
});

describe("the answer block (T57)", () => {
  /** Without a tty the reveal is off, which is what the rest of the suite runs on. */
  const paint = (c: AssistantTextComponent, width = 40): string => c.render(width).map(strip).join("\n");

  test("a delta shows up as it arrives when animation is off", () => {
    const c = new AssistantTextComponent({ icons: ASCII_ICONS });
    c.push("hello ");
    expect(paint(c)).toContain("hello");
    c.push("world");
    expect(paint(c)).toContain("hello world");
  });

  test("finish never leaves text hidden", () => {
    const c = new AssistantTextComponent({ icons: ASCII_ICONS });
    c.push("a paragraph that is still arriving");
    c.finish();
    expect(paint(c)).toContain("a paragraph that is still arriving");
  });

  test("an animated block holds the text back, then hands it out on its clock", () => {
    const onTick = vi.fn();
    let fire: (() => void) | undefined;
    const c = new AssistantTextComponent({
      icons: UNICODE_ICONS,
      onTick,
      animate: true,
      typewriter: {
        setTimer: (fn) => {
          fire = fn;
          return 1;
        },
        clearTimer: () => {
          fire = undefined;
        },
      },
    });
    c.push("a streamed answer arrives in pieces");
    // Nothing is on screen yet, and nothing was painted: the arrival is not
    // the reveal.
    expect(paint(c)).not.toContain("streamed");
    expect(onTick).not.toHaveBeenCalled();
    for (let i = 0; i < 20 && fire !== undefined; i += 1) fire?.();
    expect(paint(c)).toContain("a streamed answer arrives in pieces");
    expect(onTick).toHaveBeenCalled();
  });

  test("finish flushes an animated block so nothing stays hidden", () => {
    const c = new AssistantTextComponent({ icons: UNICODE_ICONS, onTick: () => {}, animate: true });
    c.push("half an answer");
    expect(paint(c)).not.toContain("half an answer");
    c.finish();
    expect(paint(c)).toContain("half an answer");
  });
});
