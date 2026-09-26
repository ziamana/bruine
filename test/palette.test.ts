import { afterEach, describe, expect, test } from "vitest";
import { bgCode, detectColorDepth, fgCode, gradientStops, resetColorDepth, to256 } from "../src/ui/palette.js";
import { DockRow, meter, SpeedHistory, sparkline } from "../src/ui/dock.js";

describe("Nuage palette", () => {
  afterEach(() => {
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
  });
  test("depth detection: forced, NO_COLOR, COLORTERM, 256, basic", () => {
    expect(detectColorDepth({ KUMO_COLOR: "256" })).toBe("256");
    expect(detectColorDepth({ NO_COLOR: "1" })).toBe("none");
    expect(detectColorDepth({ COLORTERM: "truecolor" })).toBe("truecolor");
    expect(detectColorDepth({ WT_SESSION: "x" })).toBe("truecolor");
    expect(detectColorDepth({ TERM: "xterm-256color" })).toBe("256");
    expect(detectColorDepth({ TERM: "xterm" })).toBe("basic");
    expect(detectColorDepth({ COLORTERM: "truecolor", KUMO_ASCII: "1" })).toBe("basic");
  });
  test("codes per depth", () => {
    expect(fgCode("sky", "truecolor")).toBe("\x1b[38;2;125;207;255m");
    expect(fgCode("sky", "basic")).toBe("\x1b[36m");
    expect(fgCode("sky", "256")).toMatch(/^\x1b\[38;5;\d+m$/);
    expect(bgCode("surface", "truecolor")).toBe("\x1b[48;2;28;32;48m");
    expect(fgCode("sky", "none")).toBe("");
    expect(to256("#000000")).toBeGreaterThanOrEqual(16);
  });
  test("gradient only in truecolor", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    expect(gradientStops("ab", ["#000000", "#ffffff"])).toContain("38;2;");
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
    expect(gradientStops("ab", ["#000000", "#ffffff"])).toBe("\x1b[36mab\x1b[39m");
  });
});

describe("cockpit dock", () => {
  test("sparkline and meter", () => {
    expect(sparkline([1, 2, 4, 8], 10)).toBe("▂▃▅█");
    expect(sparkline([], 10)).toBe("");
    expect(meter(97)).toEqual({ filled: "██████████", empty: "" });
    expect(meter(5)).toEqual({ filled: "█", empty: "░░░░░░░░░" });
  });
  test("speed history throttles to one sample per 250 ms and caps", () => {
    let t = 0;
    const h = new SpeedHistory(() => t, 3);
    h.push(10); t = 100; h.push(20); t = 300; h.push(30); t = 600; h.push(40); t = 900; h.push(50);
    expect(h.values).toEqual([30, 40, 50]);
    h.push(0);
    expect(h.values).toEqual([30, 40, 50]);
  });
  test("dock only below the threshold width shows the editor alone", () => {
    const left = { render: (w: number) => [`L${String(w)}`], invalidate() {} };
    const panel = { render: () => ["P1", "P2"], invalidate() {} };
    const d = new DockRow(left, panel);
    expect(d.render(100)).toEqual(["L100"]);
    const wide = d.render(130).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(wide).toHaveLength(2);
    expect(wide[0]).toMatch(/^L93 +│ P1$/);
    d.visible = false;
    expect(d.render(130)).toEqual(["L130"]);
  });
});
