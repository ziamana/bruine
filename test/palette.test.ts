import { afterEach, describe, expect, test } from "vitest";
import {
  bgCode,
  bgEnabled,
  contrastRatio,
  bgOptOut,
  blendHex,
  deriveBackdrop,
  detectColorDepth,
  fgCode,
  fillLine,
  gradientStops,
  onBg,
  resetColorDepth,
  setTerminalBackdrop,
  to256,
} from "../src/ui/palette.js";
import { ChatTranscript, ConsoleBand, pasteChip, railPaint } from "../src/ui/chat-layout.js";
import { userMessageComponent } from "../src/ui/assistant-text.js";
import { DashboardPanel, DockRow, meter, SpeedHistory, sparkline } from "../src/ui/dock.js";
import { NUAGE } from "../src/ui/palette.js";
import type { Component } from "@earendil-works/pi-tui";

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

describe("painted surfaces (T40)", () => {
  afterEach(() => {
    process.env.KUMO_COLOR = "basic";
    delete process.env.KUMO_BG;
    resetColorDepth();
  });

  test("backgrounds are only painted where a background is a real color", () => {
    expect(bgEnabled("truecolor")).toBe(true);
    expect(bgEnabled("256")).toBe(true);
    // 16 colors: the ANSI backgrounds are black or cyan, which read as damage.
    expect(bgEnabled("basic")).toBe(false);
    expect(bgEnabled("none")).toBe(false);
  });

  test("KUMO_BG=0 opts out of every painted surface", () => {
    process.env.KUMO_BG = "0";
    expect(bgOptOut()).toBe(true);
    expect(bgEnabled("truecolor")).toBe(false);
    process.env.KUMO_BG = "none";
    expect(bgOptOut()).toBe(true);
    process.env.KUMO_BG = "1";
    expect(bgOptOut()).toBe(false);
  });

  test("a dark background gets a veil just above it, a light one a panel just below", () => {
    const dark = deriveBackdrop({ r: 0, g: 0, b: 0 });
    // Close to the hand-tuned Nuage values, so an unanswered query still looks right.
    expect(dark.surface).toBe("#1b2033");
    expect(dark.chip).toBe("#242a3f");
    const light = deriveBackdrop({ r: 255, g: 255, b: 255 });
    expect(light.surface).toBe("#dfe4f2");
    // The chip sits on the far side of the surface from the text in both modes, so
    // a quiet chip never competes with the band it is printed on.
    expect(light.chip).toBe("#edf0f8");
    for (const s of [dark, light]) {
      expect(s.surface).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.edge).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("the probe overrides the authored surfaces, and reset puts them back", () => {
    const before = bgCode("surface", "truecolor");
    setTerminalBackdrop({ r: 255, g: 255, b: 255 });
    expect(bgCode("surface", "truecolor")).toBe("\x1b[48;2;223;228;242m");
    // The accent follows the same probe, so the band and its edge stay in tune.
    expect(bgCode("edge", "truecolor")).not.toBe("\x1b[48;2;74;168;224m");
    resetColorDepth();
    expect(bgCode("surface", "truecolor")).toBe(before);
  });

  test("fillLine paints out to the edge with EL and never writes the last column", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    const line = fillLine("surface", "hi");
    expect(line).toBe("\x1b[48;2;28;32;48mhi\x1b[48;2;28;32;48m\x1b[K\x1b[49m");
    // EL only works if the background is still active, hence the second code.
    expect(line.indexOf("\x1b[K")).toBeGreaterThan(line.indexOf("hi"));
  });

  test("fillLine re-arms the surface after anything that resets it", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    // A nested background, a pill, and pi-tui's reverse-video editor cursor all
    // hand the background back to the terminal default on their way out. Each one
    // used to leave the rest of the band unpainted.
    const surface = bgCode("surface", "truecolor");
    const pill = onBg("rose", " FULL ACCESS ");
    const cursor = "\x1b[7m \x1b[0m";
    for (const content of [pill, cursor, "\x1b[0m", "\x1b[m"]) {
      const line = fillLine("surface", content);
      // Nothing between the start and the EL may leave the background dropped.
      const tail = line.slice(0, line.indexOf("\x1b[K"));
      expect(tail.endsWith(surface)).toBe(true);
    }
  });

  test("nothing is painted at 16 colors or with NO_COLOR", () => {
    expect(fillLine("surface", "hi")).toBe("hi");
    process.env.KUMO_COLOR = "none";
    resetColorDepth();
    expect(fillLine("surface", "hi")).toBe("hi");
  });

  test("blendHex clamps and interpolates", () => {
    expect(blendHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(blendHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(blendHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(blendHex("#000000", "#ffffff", 9)).toBe("#ffffff");
  });

  test("the rail fades down its block, and stays flat where a hex would collapse", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    expect(railPaint("blue", "▍", 0)).toBe("\x1b[38;2;125;207;255m▍\x1b[39m");
    expect(railPaint("blue", "▍", 1)).toBe("\x1b[38;2;74;168;224m▍\x1b[39m");
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
    // A blended hex at 16 colors would collapse both ends to the same code.
    expect(railPaint("blue", "▍", 0)).toBe("\x1b[34m▍\x1b[39m");
    expect(railPaint("red", "▍", 1)).toBe("\x1b[31m▍\x1b[39m");
  });

  test("a running tool owns the rail, so the eye can find it without reading (T55 P1c)", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    // The defect: a tool in flight and a tool that finished ten seconds ago were
    // the same blue, so "where is kumo right now" meant reading the whole block.
    const running = railPaint("active", "▍", 0);
    const done = railPaint("blue", "▍", 0);
    const failed = railPaint("red", "▍", 0);
    expect(running).not.toBe(done);
    expect(running).not.toBe(failed);
    // The live rail is the brightest of the three: it is the only moving part.
    const bright = (s: string): number => {
      const m = s.match(/38;2;(\d+);(\d+);(\d+)m/);
      return m === null ? 0 : Number(m[1])! + Number(m[2])! + Number(m[3])!;
    };
    expect(bright(running)).toBeGreaterThan(bright(done));
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
    // At 16 colors a running tool still has to be findable: bright cyan.
    expect(railPaint("active", "▍", 0)).toBe("\x1b[36m▍\x1b[39m");
  });
});

describe("console band (T40)", () => {
  const zone = (lines: string[]): Component => ({
    render: () => lines,
    invalidate: () => {},
  });
  /** Echoes the width it was handed, the way DockRow's fake left side does. */
  const echo: Component = {
    render: (w: number) => [`L${String(w)}`],
    invalidate: () => {},
  };
  afterEach(() => {
    process.env.KUMO_COLOR = "basic";
    delete process.env.KUMO_BG;
    resetColorDepth();
  });

  test("keeps the 2-column margin it had under Margin, so nothing reflows", () => {
    const plain = new ConsoleBand([echo]).render(40)[0]!.replace(/\x1b\[[0-9;]*m/g, "");
    // Margin also handed its inner component width - 4 and prefixed 2 columns;
    // the accent spends the first of those two, so the body still starts at 2.
    expect(plain).toBe("  L36");
  });

  test("the accent is the first cell, flush against the left edge", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    const line = new ConsoleBand([zone(["ab"])]).render(40)[0]!;
    // Nothing may sit to the left of the accent: a surface column there reads as
    // a second, dimmer blue stripe right beside the real one. The accent spends
    // the first of the two margin columns, so the body still starts at column 2.
    expect(line).toMatch(/^\x1b\[[0-9;]*m\x1b\[48;2;74;168;224m /);
    expect(line.replace(/\x1b\[[0-9;]*m/g, "")).toMatch(/^ {2}ab/);
    // EL only paints the last cells if the background is still active there.
    expect(line.indexOf("\x1b[K")).toBeGreaterThan(line.indexOf("ab"));
    expect(line.endsWith("\x1b[K\x1b[49m")).toBe(true);
  });

  test("without a paintable background the band is the margin it replaced", () => {
    // No surface, no accent: 16 colors must render exactly what Margin did.
    expect(new ConsoleBand([zone(["ab"])]).render(40)[0]).toBe("  ab");
  });

  test("KUMO_BG=0 keeps the layout and drops every background", () => {
    process.env.KUMO_COLOR = "truecolor";
    process.env.KUMO_BG = "0";
    resetColorDepth();
    const line = new ConsoleBand([zone(["ab"])]).render(40)[0]!;
    expect(line).toBe("  ab");
    expect(line).not.toContain("\x1b[48;");
  });
});

describe("painted transcript (T40)", () => {
  /** One user prompt (the only painted block in the transcript) as the chat draws it. */
  const render = (text: string): string => {
    const t = new ChatTranscript();
    t.addChild(userMessageComponent(text));
    return t.render(40).join("\n");
  };
  afterEach(() => {
    process.env.KUMO_COLOR = "basic";
    delete process.env.KUMO_BG;
    resetColorDepth();
  });

  test("the prompt band is painted at 24 bits, edge to edge, with the accent", () => {
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    const text = render("ship it");
    expect(text).toContain("\x1b[48;2;74;168;224m \x1b[49m");
    for (const line of text.split("\n").filter((l) => l !== "")) {
      // Every painted line ends by letting EL paint the last cell, never by
      // writing it (the empty spacer between blocks is the transcript's, unpainted).
      expect(line).toMatch(/(?:\x1b\[48;2;28;32;48m)?\x1b\[K\x1b\[49m$/);
    }
  });

  test("16 colors get no background at all, not a black one", () => {
    // The regression: surface/chip fell through to the raw ANSI codes here, which
    // painted the prompt black and the paste chips cyan on a 16-color terminal.
    expect(render("ship it")).not.toContain("\x1b[48;");
    expect(render("ship it")).not.toContain("\x1b[40m");
    expect(pasteChip("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk")).not.toContain("\x1b[46m");
  });
});

describe("cockpit dock", () => {
  test("sparkline and meter", () => {
    // T55 P4: floor, not round. With round the bottom rung was unreachable, so a
    // tenth of the peak still read as "▂" and nothing ever looked slow.
    expect(sparkline([1, 2, 4, 8], 10)).toBe("▁▂▄█");
    expect(sparkline([], 10)).toBe("");
    expect(meter(97)).toEqual({ filled: "██████████", empty: "" });
    expect(meter(5)).toEqual({ filled: "█", empty: "░░░░░░░░░" });
  });
  test("the sparkline is scaled against a sticky peak, not against its own window (T55 P4)", () => {
    // The defect: sparkline divided by the max of the window it was handed, so a
    // steady 5 tok/s filled the whole graph and looked identical to a steady 50.
    // The cockpit said "everything is fine" for a model that had slowed 10x.
    expect(sparkline([5, 5, 5, 5], 4, 50)).toBe("▁▁▁▁");
    expect(sparkline([50, 5, 5, 5], 4, 50)).toBe("█▁▁▁");
    // With no reference at all the series scales to itself. That is the honest
    // answer when nothing has been seen yet, and it is why the peak is sticky:
    // the graph corrects itself the first time anything faster arrives.
    expect(sparkline([5, 5, 5, 5], 4)).toBe("████");
    expect(sparkline([1, 2, 4, 8], 10)).toBe("▁▂▄█");

    // A moving clock, or the 250 ms throttle folds both pushes into one sample.
    let t = 0;
    const h = new SpeedHistory(() => (t += 300), 8);
    h.push(50);
    h.push(5);
    expect(h.peak).toBe(50);
    // 50 then 5: the drop is the whole point, and it is visible.
    expect(sparkline(h.values, 2, h.peak)).toBe("█▁");
    // A burst inside one throttle window still raises the peak, or a single fast
    // sample would be lost from the scale entirely.
    const fast = new SpeedHistory(() => 7, 8);
    fast.push(5);
    fast.push(50);
    expect(fast.peak).toBe(50);
  });

  test("the cockpit marks the context like the footer does (T55)", () => {
    const speed = new SpeedHistory(() => 0, 8);
    const panel = new DashboardPanel(
      () => ({ contextUsed: 259_000, contextWindow: 1_036_000 }),
      speed,
      () => ({ done: 0, total: 0 }),
    );
    const row = panel.render(40).join("\n");
    // The meter says how full; the number says what it costs. Same marking as the
    // footer, so the two never tell different stories.
    expect(row).toContain("259.0K (25%)");
  });

  test("the cockpit prints the number next to the graph, so a full graph cannot lie (T55 P4)", () => {
    // A moving clock: SpeedHistory keeps one sample per 250 ms, so a frozen clock
    // would collapse four pushes into one cell.
    let t = 0;
    const speed = new SpeedHistory(() => (t += 300), 8);
    for (const v of [5, 5, 5, 5]) speed.push(v);
    const panel = new DashboardPanel(
      () => ({ tps: 5, cachePct: 10, contextUsed: 1, contextWindow: 100 }),
      speed,
      () => ({ done: 0, total: 0 }),
    );
    const row = panel.render(40).join("\n");
    // The graph is full (nothing faster has been seen) but the exact value is
    // right there, which is the real guard against a self-scaled graph lying.
    expect(row).toContain("████");
    expect(row).toContain("5 tok/s");
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

describe("prompt band keeps its columns (T40)", () => {
  afterEach(() => {
    process.env.KUMO_COLOR = "basic";
    resetColorDepth();
  });
  test("the prompt still starts in column 2, accent or not", () => {
    const start = (): string => {
      const t = new ChatTranscript();
      t.addChild(userMessageComponent("Read note.txt"));
      const painted = t.render(40).find((l) => l.includes("Read note.txt"))!;
      return painted.replace(/\x1b\[[0-9;]*m/g, "");
    };
    expect(start()).toMatch(/^ {2}› Read note\.txt/);
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    // Painting the band must not push the prompt one column to the right.
    expect(start()).toMatch(/^ {2}› Read note\.txt/);
  });
});

describe("contrast floors (T55 P0)", () => {
  const surface = NUAGE.surface.hex;
  /** What each role is actually asked to do, so the floor is never arbitrary. */
  const STRUCTURAL: Array<[string, string]> = [
    ["faint", "the editor border, the dock divider, empty meter cells"],
    ["edge", "the accent that opens every painted surface"],
    ["skyDeep", "the tool rail on a block with no gradient left to spend"],
  ];
  const TEXT: Array<[string, string]> = [
    ["muted", "a tool argument, the host in the header"],
    ["text", "an assistant answer"],
  ];

  test.each(STRUCTURAL)("%s carries structure, so it needs 3:1 on the surface (%s)", (role) => {
    // The defect: faint was 2.64:1, under the 3:1 floor for a border or control,
    // and it drew the help line that says how to quit the app.
    expect(contrastRatio(NUAGE[role as keyof typeof NUAGE].hex, surface)).toBeGreaterThanOrEqual(3);
  });

  test.each(TEXT)("%s carries text, so it needs 4.5:1 on the surface (%s)", (role) => {
    expect(contrastRatio(NUAGE[role as keyof typeof NUAGE].hex, surface)).toBeGreaterThanOrEqual(4.5);
  });

  test("the accent must also read against the surface, or the band has no edge", () => {
    expect(contrastRatio(NUAGE.edge.hex, surface)).toBeGreaterThanOrEqual(3);
    // And it must not be the same color as the surface, which is what a failed
    // probe would leave behind.
    expect(NUAGE.edge.hex).not.toBe(surface);
  });

  test("contrastRatio is the WCAG ratio, not a vibe", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});
