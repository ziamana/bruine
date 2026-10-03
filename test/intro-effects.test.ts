/**
 * The logo's entrances are pure functions of time: each one starts unlike the logo, never leaves
 * the three rows, and ends as exactly the logo the banner draws.
 */
import { describe, expect, test } from "vitest";
import { DIMENSIONS, EFFECTS, dropTransition, finalFrame, type Frame } from "../src/ui/intro-effects.js";
import { LOGO } from "../src/ui/logo-motion.js";

const text = (f: Frame): string[] => f.map((row) => row.map((c) => c.ch).join(""));
/** What the eye sees: the characters and how each is coloured. */
const look = (f: Frame): string => f.map((row) => row.map((c) => `${c.ch}${c.tone[0]}${c.hue === undefined ? "" : Math.round(c.hue * 9)}`).join("")).join("|");
const STEPS = Array.from({ length: 101 }, (_, i) => i / 100);

describe("every effect", () => {
  test("there are twelve, each with a name, a duration and a weight, and no two share an id", () => {
    expect(EFFECTS).toHaveLength(12);
    expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(12);
    for (const e of EFFECTS) {
      expect(e.label.length).toBeGreaterThan(2);
      expect(e.ms).toBeGreaterThanOrEqual(1000);
      expect(e.ms).toBeLessThanOrEqual(2200);
      expect(e.weight).toBeGreaterThan(0);
    }
  });

  for (const effect of EFFECTS) {
    describe(effect.id, () => {
      test("every frame is three rows of exactly the mark's width, with no emoji", () => {
        for (const t of STEPS) {
          const f = effect.frame(t, 5);
          expect(f).toHaveLength(LOGO.length);
          for (const row of f) {
            expect(row).toHaveLength(DIMENSIONS.W);
            for (const cell of row) expect([...cell.ch]).toHaveLength(1);
          }
          expect(text(f).join("")).not.toMatch(/\p{Extended_Pictographic}/u);
        }
      });

      test("it starts unlike the logo and ends as exactly the logo", () => {
        expect(look(effect.frame(0, 5))).not.toBe(look(finalFrame()));
        expect(text(effect.frame(1, 5))).toEqual([...LOGO]);
        expect(effect.frame(1, 5).flat().every((c) => c.tone === "base")).toBe(true);
      });

      test("the same time and seed give the same frame", () => {
        for (const t of [0.13, 0.5, 0.77]) expect(effect.frame(t, 9)).toEqual(effect.frame(t, 9));
      });

      test("it only ever draws a letter of the logo where the logo has one, or a mark of its own", () => {
        // A blank cell of the logo stays blank at the end; before that anything in the effect's alphabet.
        const end = effect.frame(1, 3);
        for (let r = 0; r < LOGO.length; r += 1) {
          for (let c = 0; c < DIMENSIONS.W; c += 1) if (LOGO[r]![c] === " ") expect(end[r]![c]!.ch).toBe(" ");
        }
      });

      test("it is not a still picture: at least four different frames", () => {
        const seen = new Set(STEPS.map((t) => look(effect.frame(t, 2))));
        expect(seen.size).toBeGreaterThanOrEqual(4);
      });
    });
  }

  test("the effects that use chance look different with another seed, the others do not need to", () => {
    for (const id of ["rain", "decrypt", "fog", "mist"]) {
      const e = EFFECTS.find((x) => x.id === id)!;
      const a = STEPS.map((t) => text(e.frame(t, 1)).join("|")).join("#");
      const b = STEPS.map((t) => text(e.frame(t, 2)).join("|")).join("#");
      expect(a, id).not.toBe(b);
    }
  });

  test("the rare ones are rare", () => {
    const weight = (id: string): number => EFFECTS.find((e) => e.id === id)!.weight;
    expect(weight("storm")).toBeLessThan(weight("afterrain"));
    expect(weight("afterrain")).toBeLessThan(weight("rain"));
  });
});

describe("the drop between two effects", () => {
  test("a drop falls first, then a ring spreads from where it landed and clears the logo", () => {
    const logo = finalFrame();
    const start = text(dropTransition(0.05, logo)).join("");
    expect(start).toContain("╷");
    const landed = text(dropTransition(0.38, logo)).join("");
    expect(landed).toContain("●");
    const ring = text(dropTransition(0.6, logo)).join("");
    expect(ring).toMatch(/\(/);
    expect(ring).toMatch(/\)/);
    const end = text(dropTransition(1, logo)).join("");
    expect(end.replace(/[ ()]/g, "").length).toBeLessThan(LOGO.join("").replace(/ /g, "").length / 4);
  });

  test("the clear spreads outward: later frames show less of the logo", () => {
    const logo = finalFrame();
    const left = (t: number): number => text(dropTransition(t, logo)).join("").replace(/[ ()●╷]/g, "").length;
    expect(left(0.5)).toBeGreaterThan(left(0.7));
    expect(left(0.7)).toBeGreaterThan(left(0.95));
  });

  test("it never changes the frame it was given", () => {
    const logo = finalFrame();
    const before = JSON.stringify(logo);
    dropTransition(0.7, logo);
    expect(JSON.stringify(logo)).toBe(before);
  });
});
