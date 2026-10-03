import { describe, expect, test } from "vitest";
import { resetColorDepth } from "../src/ui/palette.js";
import { SetupWelcome } from "../src/setup/welcome.js";

describe("setup welcome screen", () => {
  test("fills the terminal with one background and centers only the BRUINE mark", () => {
    const previous = {
      ascii: process.env.BRUINE_ASCII,
      color: process.env.BRUINE_COLOR,
      bg: process.env.BRUINE_BG,
    };
    process.env.BRUINE_ASCII = "1";
    process.env.BRUINE_COLOR = "truecolor";
    delete process.env.BRUINE_BG;
    resetColorDepth();
    try {
      const screen = new SetupWelcome(() => 31).render(90);
      const plain = screen.map((line) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim());

      expect(screen).toHaveLength(31);
      expect(plain.filter(Boolean)).toEqual(["BRUINE"]);
      expect(plain[15]).toBe("BRUINE");
      expect(screen.every((line) => line.includes("\x1b[48;2;28;32;48m"))).toBe(true);
    } finally {
      if (previous.ascii === undefined) delete process.env.BRUINE_ASCII;
      else process.env.BRUINE_ASCII = previous.ascii;
      if (previous.color === undefined) delete process.env.BRUINE_COLOR;
      else process.env.BRUINE_COLOR = previous.color;
      if (previous.bg === undefined) delete process.env.BRUINE_BG;
      else process.env.BRUINE_BG = previous.bg;
      resetColorDepth();
    }
  });
});

describe("the welcome rain", () => {
  const withMotion = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const saved = { ascii: process.env.BRUINE_ASCII, color: process.env.BRUINE_COLOR, ci: process.env.CI, noAnim: process.env.BRUINE_NO_ANIMATION, tty: process.stdout.isTTY, term: process.env.TERM };
    process.env.BRUINE_ASCII = "0";
    process.env.BRUINE_COLOR = "truecolor";
    delete process.env.CI;
    delete process.env.BRUINE_NO_ANIMATION;
    process.env.TERM = "xterm-256color";
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    resetColorDepth();
    try {
      return await fn();
    } finally {
      const restore = (k: string, v: string | undefined): void => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
      restore("BRUINE_ASCII", saved.ascii); restore("BRUINE_COLOR", saved.color); restore("CI", saved.ci);
      restore("BRUINE_NO_ANIMATION", saved.noAnim); restore("TERM", saved.term);
      Object.defineProperty(process.stdout, "isTTY", { value: saved.tty, configurable: true });
      resetColorDepth();
    }
  };
  const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

  test("drops fall over the whole screen while the mark forms, and every row is the screen's width", async () => {
    await withMotion(async () => {
      const welcome = new SetupWelcome(() => 30);
      const realNow = Date.now;
      Date.now = () => realNow() + 700;
      let lines: string[];
      try {
        lines = welcome.render(100).map(plain);
      } finally {
        Date.now = realNow;
      }
      expect(lines).toHaveLength(30);
      expect(lines.some((l) => /[·╷│╎]/.test(l))).toBe(true);
      // The mark's own band is clear of rain on both sides.
      const mid = lines.slice(11, 19);
      expect(mid.some((l) => /[█▀▄░▒▓]/.test(l))).toBe(true);
    });
  });

  test("the rain stops when the mark is done: the last frame is the mark alone", async () => {
    await withMotion(async () => {
      const welcome = new SetupWelcome(() => 30);
      // Land past the end of the motion without waiting for it.
      const realNow = Date.now;
      Date.now = () => realNow() + 5000;
      try {
        const lines = welcome.render(100).map(plain).filter((l) => l.trim() !== "");
        expect(lines).toHaveLength(3);
        expect(lines.join("")).toMatch(/┏┓ ┏━┓╻ ╻/);
      } finally {
        Date.now = realNow;
      }
    });
  });

  test("a narrow screen gets the word and no rain", async () => {
    await withMotion(async () => {
      const lines = new SetupWelcome(() => 12).render(18).map(plain).filter((l) => l.trim() !== "");
      expect(lines).toEqual(["      BRUINE"]);
    });
  });
});
