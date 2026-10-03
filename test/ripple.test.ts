/**
 * A finished turn leaves a ring on the prompt's top rule for a second, like a drop landing.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Component } from "@earendil-works/pi-tui";
import { PromptFrame } from "../src/ui/prompt-frame.js";
import { TurnActivity } from "../src/ui/turn-activity.js";
import { RIPPLE_MS } from "../src/ui/rain.js";
import { UNICODE_ICONS, ASCII_ICONS } from "../src/render/chars.js";
import { resetColorDepth } from "../src/ui/palette.js";

const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

const content: Component = {
  render: (width) => ["─".repeat(width), "> hello".padEnd(width), "─".repeat(width)],
  invalidate: () => {},
};
const editor = { focused: true, borderColor: (t: string) => t, frameBottomRow: 2 };

let saved: Record<string, string | undefined> = {};
let tty: boolean | undefined;
beforeEach(() => {
  saved = { a: process.env.BRUINE_ASCII, n: process.env.BRUINE_NO_ANIMATION, c: process.env.CI, t: process.env.TERM, color: process.env.BRUINE_COLOR, r: process.env.BRUINE_NO_RIPPLE };
  process.env.BRUINE_ASCII = "0";
  delete process.env.BRUINE_NO_ANIMATION;
  delete process.env.CI;
  process.env.TERM = "xterm-256color";
  process.env.BRUINE_COLOR = "none";
  process.env.BRUINE_NO_RIPPLE = "0";
  tty = process.stdout.isTTY;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  resetColorDepth();
});
afterEach(() => {
  const back = (k: string, v: string | undefined): void => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  back("BRUINE_ASCII", saved.a); back("BRUINE_NO_ANIMATION", saved.n); back("CI", saved.c); back("TERM", saved.t); back("BRUINE_COLOR", saved.color); back("BRUINE_NO_RIPPLE", saved.r);
  Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
  resetColorDepth();
});

function frame(icons = UNICODE_ICONS): { clock: { t: number }; activity: TurnActivity; frame: PromptFrame } {
  const clock = { t: 1000 };
  const activity = new TurnActivity(() => clock.t);
  return { clock, activity, frame: new PromptFrame(content, editor, activity, icons) };
}

describe("the ripple on the prompt rule", () => {
  test("nothing before a turn has run", () => {
    const { frame: f } = frame();
    expect(f.active).toBe(false);
    expect(plain(f.render(60)[0]!)).not.toMatch(/[()]/);
  });

  test("while the turn runs it is the working label, with no ring", () => {
    const { frame: f, activity } = frame();
    activity.start("Working");
    expect(plain(f.render(60)[0]!)).toContain("Working");
    expect(plain(f.render(60)[0]!)).not.toMatch(/\(\s*·?\s*\)/);
  });

  test("when it ends a ring spreads for a second on the rule, then the rule is plain again", () => {
    const { frame: f, activity, clock } = frame();
    activity.start("Working");
    clock.t += 5000;
    activity.stop();
    const seen = new Set<string>();
    for (let since = 0; since < RIPPLE_MS; since += 100) {
      clock.t = 6000 + since;
      expect(f.active).toBe(true);
      const top = plain(f.render(60)[0]!);
      expect(top).not.toContain("Working");
      expect(top).toMatch(/[·()]/);
      seen.add(top);
    }
    expect(seen.size).toBeGreaterThan(3);
    clock.t = 6000 + RIPPLE_MS + 50;
    expect(f.active).toBe(false);
    expect(plain(f.render(60)[0]!)).not.toMatch(/[()]/);
  });

  test("the rule keeps its width through the ring", () => {
    const { frame: f, activity, clock } = frame();
    activity.start("Working");
    activity.stop();
    for (let since = 0; since < RIPPLE_MS; since += 100) {
      clock.t = 1000 + since;
      for (const width of [20, 60, 120]) expect([...plain(f.render(width)[0]!)].length).toBe(width);
    }
  });

  test("a new turn ends the ring at once", () => {
    const { frame: f, activity } = frame();
    activity.start("Working");
    activity.stop();
    expect(f.active).toBe(true);
    activity.start("Working");
    expect(plain(f.render(60)[0]!)).toContain("Working");
  });

  test("BRUINE_NO_RIPPLE=1 turns the ring off and leaves the rest of the motion", () => {
    process.env.BRUINE_NO_RIPPLE = "1";
    const { frame: f, activity } = frame();
    activity.start("Working");
    expect(plain(f.render(60)[0]!)).toContain("Working");
    activity.stop();
    expect(f.active).toBe(false);
    expect(plain(f.render(60)[0]!)).not.toMatch(/[()]/);
  });

  test("with motion off there is no ring and the repaint loop is not kept alive", () => {
    process.env.BRUINE_NO_ANIMATION = "1";
    const { frame: f, activity } = frame();
    activity.start("Working");
    activity.stop();
    expect(f.active).toBe(false);
    expect(plain(f.render(60)[0]!)).not.toMatch(/[()]/);
  });

  test("ASCII draws the ring in ASCII", () => {
    const { frame: f, activity } = frame(ASCII_ICONS);
    activity.start("Working");
    activity.stop();
    const top = f.render(60)[0]!;
    expect(top).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe("TurnActivity.sinceStop", () => {
  test("undefined until a turn has stopped, then the time since, and undefined again on the next start", () => {
    let t = 100;
    const a = new TurnActivity(() => t);
    expect(a.sinceStop).toBeUndefined();
    a.start();
    expect(a.sinceStop).toBeUndefined();
    t = 400;
    a.stop();
    t = 650;
    expect(a.sinceStop).toBe(250);
    a.start();
    expect(a.sinceStop).toBeUndefined();
  });

  test("stopping a turn that never ran does not start a ring", () => {
    let t = 0;
    const a = new TurnActivity(() => t);
    a.stop();
    expect(a.sinceStop).toBeUndefined();
  });
});
