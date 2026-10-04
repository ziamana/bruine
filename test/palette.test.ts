import { afterEach, describe, expect, test } from "vitest";
import {
  bgCode,
  bgEnabled,
  contrastRatio,
  bgOptOut,
  blendHex,
  deriveBackdrop,
  deriveInk,
  detectColorDepth,
  fgCode,
  fillLine,
  gradientStops,
  onBg,
  resetColorDepth,
  setTerminalBackdrop,
  to256,
} from "../src/ui/palette.js";
import { ChatTranscript, Margin, pasteChip, railPaint } from "../src/ui/chat-layout.js";
import { userMessageComponent } from "../src/ui/assistant-text.js";
import { bruineIcons } from "../src/render/chars.js";
import { NUAGE } from "../src/ui/palette.js";
import { Container, type Component } from "@earendil-works/pi-tui";

describe("Nuage palette", () => {
  afterEach(() => {
    process.env.BRUINE_COLOR = "basic";
    resetColorDepth();
  });
  test("depth detection: forced, NO_COLOR, COLORTERM, 256, basic", () => {
    expect(detectColorDepth({ BRUINE_COLOR: "256" })).toBe("256");
    expect(detectColorDepth({ NO_COLOR: "1" })).toBe("none");
    expect(detectColorDepth({ COLORTERM: "truecolor" })).toBe("truecolor");
    expect(detectColorDepth({ WT_SESSION: "x" })).toBe("truecolor");
    expect(detectColorDepth({ TERM: "xterm-256color" })).toBe("256");
    expect(detectColorDepth({ TERM: "xterm" })).toBe("basic");
    expect(detectColorDepth({ COLORTERM: "truecolor", BRUINE_ASCII: "1" })).toBe("basic");
  });
  test("the classic Windows console: 24-bit since Windows 10 build 14931, 256 before, 16 on old Windows", () => {
    expect(detectColorDepth({}, "win32", "10.0.19045")).toBe("truecolor");
    expect(detectColorDepth({}, "win32", "10.0.10586")).toBe("256");
    expect(detectColorDepth({}, "win32", "6.1.7601")).toBe("basic");
    // A TERM set by a POSIX layer (Git Bash, MSYS) is read as it is.
    expect(detectColorDepth({ TERM: "xterm" }, "win32", "10.0.19045")).toBe("basic");
    expect(detectColorDepth({}, "linux", "6.1.0")).toBe("basic");
  });
  test("codes per depth", () => {
    expect(fgCode("sky", "truecolor")).toBe("\x1b[38;2;125;207;255m");
    expect(fgCode("sky", "basic")).toBe("\x1b[36m");
    expect(fgCode("sky", "256")).toMatch(/^\x1b\[38;5;\d+m$/);
    expect(bgCode("surface", "truecolor")).toBe("\x1b[48;2;28;32;48m");
    expect(fgCode("sky", "none")).toBe("");
    expect(to256("#000000")).toBeGreaterThanOrEqual(16);
  });
  test("every foreground stays readable on a light terminal, and on odd dark ones", () => {
    // The defect: only the surfaces followed a light background, so the answer
    // text (#e6e9f2) was 1.2:1 on white.
    for (const bg of [
      { r: 255, g: 255, b: 255 },
      { r: 0xfd, g: 0xf6, b: 0xe3 }, // Solarized Light
      { r: 0x28, g: 0x2c, b: 0x34 }, // One Dark
      { r: 0, g: 0, b: 0 },
    ]) {
      const backdrop = deriveBackdrop(bg);
      const ink = deriveInk(bg, backdrop);
      const base = `#${[bg.r, bg.g, bg.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      for (const surface of [base, backdrop.surface, backdrop.chip, backdrop.userBlock, backdrop.toolOk, backdrop.toolPending, backdrop.toolErr]) {
        expect(contrastRatio(ink.text, surface)).toBeGreaterThanOrEqual(7);
        for (const role of ["muted", "sky", "lavender", "mint", "amber", "rose", "pink"] as const) {
          expect(contrastRatio(ink[role], surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrastRatio(ink.addFg, backdrop.addBg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink.delFg, backdrop.delBg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink.faint, base)).toBeGreaterThanOrEqual(3);
    }
    // A hue that has to move keeps its hue: lavender on white is still violet.
    const lavender = deriveInk({ r: 255, g: 255, b: 255 }).lavender;
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(lavender.slice(i, i + 2), 16)) as [number, number, number];
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(g);
  });
  test("a light background repaints the ink, not only the surfaces", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    expect(fgCode("text", "truecolor")).toBe("\x1b[38;2;230;233;242m");
    setTerminalBackdrop({ r: 255, g: 255, b: 255 });
    expect(fgCode("text", "truecolor")).not.toBe("\x1b[38;2;230;233;242m");
    setTerminalBackdrop();
    expect(fgCode("text", "truecolor")).toBe("\x1b[38;2;230;233;242m");
  });
  test("256 colors: dark tinted surfaces land on the gray ramp, not on navy or black", () => {
    // The defect: #1c2030 snapped to 17 (#00005f) and the ok card to 16 (black).
    for (const role of ["surface", "chip", "userBlock", "toolOk", "toolPending"] as const) {
      const code = to256(NUAGE[role].hex);
      expect(code).toBeGreaterThanOrEqual(232);
      expect(code).toBeGreaterThan(232);
    }
    // A band whose hue is its meaning keeps a hue, and is never pure black.
    expect(to256(NUAGE.addBg.hex, true)).toBe(22);
    expect(to256(NUAGE.delBg.hex, true)).toBe(52);
    expect(bgCode("delBg", "256")).toBe("\x1b[48;5;52m");
    // Plain colors still find their cube entry.
    expect(to256("#ff0000")).toBe(196);
    expect(to256("#808080")).toBe(244);
  });
  test("gradient only in truecolor", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    expect(gradientStops("ab", ["#000000", "#ffffff"])).toContain("38;2;");
    process.env.BRUINE_COLOR = "basic";
    resetColorDepth();
    expect(gradientStops("ab", ["#000000", "#ffffff"])).toBe("\x1b[36mab\x1b[39m");
  });
});

describe("painted surfaces (T40)", () => {
  afterEach(() => {
    process.env.BRUINE_COLOR = "basic";
    delete process.env.BRUINE_BG;
    resetColorDepth();
  });

  test("backgrounds are only painted where a background is a real color", () => {
    expect(bgEnabled("truecolor")).toBe(true);
    expect(bgEnabled("256")).toBe(true);
    // 16 colors: the ANSI backgrounds are black or cyan, which read as damage.
    expect(bgEnabled("basic")).toBe(false);
    expect(bgEnabled("none")).toBe(false);
  });

  test("BRUINE_BG=0 opts out of every painted surface", () => {
    process.env.BRUINE_BG = "0";
    expect(bgOptOut()).toBe(true);
    expect(bgEnabled("truecolor")).toBe(false);
    process.env.BRUINE_BG = "none";
    expect(bgOptOut()).toBe(true);
    process.env.BRUINE_BG = "1";
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

  test("the two diff bands are probed too: they are the loudest surfaces in a block", () => {
    // A band tuned for a dark terminal and painted on a light one reads as a bruise,
    // and a diff is where the eye goes after a turn changed something.
    const dark = deriveBackdrop({ r: 0, g: 0, b: 0 });
    const light = deriveBackdrop({ r: 255, g: 255, b: 255 });
    for (const role of ["addBg", "delBg"] as const) {
      expect(dark[role]).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[role]).toMatch(/^#[0-9a-f]{6}$/);
      expect(light[role]).not.toBe(dark[role]);
      // And each one keeps its own hue: the two bands are never the same colour.
      expect(light[role]).not.toBe(light[role === "addBg" ? "delBg" : "addBg"]);
    }
    // On a light terminal both are a pale wash of their own hue, the way every other
    // painted surface is: they sit just below the terminal's own white, not above it.
    expect(contrastRatio("#ffffff", light.addBg)).toBeLessThan(1.3);
    expect(contrastRatio("#ffffff", light.delBg)).toBeLessThan(1.3);
    expect(contrastRatio("#ffffff", dark.addBg)).toBeGreaterThan(1.3);
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
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    const line = fillLine("surface", "hi");
    expect(line).toBe("\x1b[48;2;28;32;48mhi\x1b[48;2;28;32;48m\x1b[K\x1b[49m");
    // EL only works if the background is still active, hence the second code.
    expect(line.indexOf("\x1b[K")).toBeGreaterThan(line.indexOf("hi"));
  });

  test("fillLine re-arms the surface after anything that resets it", () => {
    process.env.BRUINE_COLOR = "truecolor";
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
    process.env.BRUINE_COLOR = "none";
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
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    expect(railPaint("blue", "▍", 0)).toBe("\x1b[38;2;125;207;255m▍\x1b[39m");
    expect(railPaint("blue", "▍", 1)).toBe("\x1b[38;2;74;168;224m▍\x1b[39m");
    process.env.BRUINE_COLOR = "basic";
    resetColorDepth();
    // A blended hex at 16 colors would collapse both ends to the same code.
    expect(railPaint("blue", "▍", 0)).toBe("\x1b[34m▍\x1b[39m");
    expect(railPaint("red", "▍", 1)).toBe("\x1b[31m▍\x1b[39m");
  });

  test("a running tool owns the rail, so the eye can find it without reading (T55 P1c)", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    // The defect: a tool in flight and a tool that finished ten seconds ago were
    // the same blue, so "where is bruine right now" meant reading the whole block.
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
    process.env.BRUINE_COLOR = "basic";
    resetColorDepth();
    // At 16 colors a running tool still has to be findable: bright cyan.
    expect(railPaint("active", "▍", 0)).toBe("\x1b[36m▍\x1b[39m");
  });
});

describe("the bottom zone keeps its margin and the terminal's background (T40)", () => {
  const zone = (lines: string[]): Component => ({
    render: () => lines,
    invalidate: () => {},
  });
  /** Echoes the width it was handed, the way DockRow's fake left side does. */
  const echo: Component = {
    render: (w: number) => [`L${String(w)}`],
    invalidate: () => {},
  };
  /** The bottom zone as the shell builds it: its zones behind one margin. */
  const bottom = (...zones: Component[]): string[] => {
    const inner = new Container();
    for (const z of zones) inner.addChild(z);
    return new Margin(inner).render(40);
  };
  afterEach(() => {
    process.env.BRUINE_COLOR = "basic";
    delete process.env.BRUINE_BG;
    resetColorDepth();
  });

  test("2 columns of margin on both sides, and never a painted background", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    // Margin hands its inner component width - 4 and prefixes 2 columns, so the
    // zones keep the body exactly where it was.
    expect(bottom(echo)[0]).toBe("  L36");
    const lines = bottom(zone(["ab"]), zone(["cd"]));
    expect(lines).toEqual(["  ab", "  cd"]);
    // The editor is framed by its two rules and the status bar is plain text, so
    // even on a truecolor terminal nothing in the bottom zone sets a background.
    expect(lines.join("")).not.toContain("\x1b[48");
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
    process.env.BRUINE_COLOR = "basic";
    delete process.env.BRUINE_BG;
    resetColorDepth();
  });

  test("the prompt band is painted at 24 bits, edge to edge, with the accent", () => {
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    const text = render("ship it");
    expect(text).toContain(bgCode("userBlock", "truecolor"));
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


describe("prompt band keeps its columns (T40)", () => {
  afterEach(() => {
    process.env.BRUINE_COLOR = "basic";
    resetColorDepth();
  });
  test("the prompt still starts in column 2, accent or not", () => {
    // The glyph is the platform's own (ASCII where the terminal is not UTF-8);
    // what this test is about is the two leading columns around it.
    const prompt = `^[ ▍|] ${bruineIcons().prompt} Read note\\.txt`;
    const start = (): string => {
      const t = new ChatTranscript();
      t.addChild(userMessageComponent("Read note.txt"));
      const painted = t.render(40).find((l) => l.includes("Read note.txt"))!;
      return painted.replace(/\x1b\[[0-9;]*m/g, "");
    };
    expect(start()).toMatch(new RegExp(prompt));
    process.env.BRUINE_COLOR = "truecolor";
    resetColorDepth();
    // Painting the band must not push the prompt one column to the right.
    expect(start()).toMatch(new RegExp(prompt));
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
