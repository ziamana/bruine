import { describe, expect, test } from "vitest";
import { resetColorDepth } from "../src/ui/palette.js";
import { SetupWelcome } from "../src/setup/welcome.js";

describe("setup welcome screen", () => {
  test("fills the terminal with one background and centers only the KUMO mark", () => {
    const previous = {
      ascii: process.env.KUMO_ASCII,
      color: process.env.KUMO_COLOR,
      bg: process.env.KUMO_BG,
    };
    process.env.KUMO_ASCII = "1";
    process.env.KUMO_COLOR = "truecolor";
    delete process.env.KUMO_BG;
    resetColorDepth();
    try {
      const screen = new SetupWelcome(() => 31).render(90);
      const plain = screen.map((line) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim());

      expect(screen).toHaveLength(31);
      expect(plain.filter(Boolean)).toEqual(["KUMO"]);
      expect(plain[15]).toBe("KUMO");
      expect(screen.every((line) => line.includes("\x1b[48;2;28;32;48m"))).toBe(true);
    } finally {
      if (previous.ascii === undefined) delete process.env.KUMO_ASCII;
      else process.env.KUMO_ASCII = previous.ascii;
      if (previous.color === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = previous.color;
      if (previous.bg === undefined) delete process.env.KUMO_BG;
      else process.env.KUMO_BG = previous.bg;
      resetColorDepth();
    }
  });
});
