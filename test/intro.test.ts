/**
 * The logo's entrance at launch: how it is chosen, how it plays, and that it never gets in the way.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { BruineUi } from "../src/ui/bruine-ui.js";
import { UNICODE_ICONS, ASCII_ICONS } from "../src/render/chars.js";
import { resetColorDepth } from "../src/ui/palette.js";
import { EFFECTS, finalFrame } from "../src/ui/intro-effects.js";
import { DROP_MS, MAX_INTRO_MS, IntroPlayer, introFrame, introSetting, planIntro, readLastIntro, rememberIntro, renderIntroRows } from "../src/ui/intro.js";
import { LOGO } from "../src/ui/logo-motion.js";
import { strip } from "./fakes.js";

const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

describe("planIntro", () => {
  test("a pinned effect plays alone, by its id", () => {
    for (const e of EFFECTS) {
      const plan = planIntro({ pick: e.id, rng: seeded(1) });
      expect(plan.steps.map((s) => s.effect?.id)).toEqual([e.id]);
      expect(plan.ms).toBe(e.ms);
    }
  });

  test("an unknown pick is the random choice, not an error", () => {
    expect(planIntro({ pick: "nonesuch", rng: seeded(2) }).steps.length).toBeGreaterThan(0);
    expect(planIntro({ pick: "random", rng: seeded(2) }).steps.length).toBeGreaterThan(0);
  });

  test("the effect of the last launch never comes first again", () => {
    for (const last of EFFECTS.map((e) => e.id)) {
      for (let i = 0; i < 40; i += 1) {
        const plan = planIntro({ last, rng: seeded(i + 1) });
        expect(plan.steps[0]!.effect!.id).not.toBe(last);
      }
    }
  });

  test("an entrance is one effect, or two with the drop between, and never longer than the cap", () => {
    let chained = 0;
    for (let i = 0; i < 400; i += 1) {
      const plan = planIntro({ rng: seeded(i + 7) });
      expect(plan.ms).toBeLessThanOrEqual(MAX_INTRO_MS);
      expect(plan.ms).toBe(plan.steps.reduce((n, s) => n + s.ms, 0));
      if (plan.steps.length === 3) {
        chained += 1;
        expect(plan.steps.map((s) => s.kind)).toEqual(["effect", "drop", "effect"]);
        expect(plan.steps[1]!.ms).toBe(DROP_MS);
        expect(plan.steps[0]!.effect!.id).not.toBe(plan.steps[2]!.effect!.id);
      } else {
        expect(plan.steps).toHaveLength(1);
      }
    }
    // Some chain, most do not.
    expect(chained).toBeGreaterThan(40);
    expect(chained).toBeLessThan(260);
  });

  test("the rare effects are rare and the common ones are not", () => {
    const counts = new Map<string, number>();
    const rng = seeded(99);
    for (let i = 0; i < 3000; i += 1) {
      const id = planIntro({ rng }).steps[0]!.effect!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const rare = (counts.get("storm") ?? 0) + (counts.get("afterrain") ?? 0);
    expect(rare).toBeLessThan(3000 * 0.1);
    expect(rare).toBeGreaterThan(0);
    for (const common of ["rain", "decrypt", "beams", "wipe", "slide", "blackhole", "spotlights", "waves", "fog", "mist"]) {
      expect(counts.get(common) ?? 0, common).toBeGreaterThan(150);
    }
  });

  test("the same random source gives the same plan", () => {
    expect(planIntro({ rng: seeded(5) })).toEqual(planIntro({ rng: seeded(5) }));
  });
});

describe("introFrame", () => {
  test("it runs the steps in order and is the finished logo after the last", () => {
    const plan = planIntro({ pick: "decrypt", rng: seeded(3) });
    const look = (f: ReturnType<typeof introFrame>): string => f.map((r) => r.map((c) => c.ch).join("")).join("\n");
    expect(look(introFrame(plan, 0))).not.toBe(LOGO.join("\n"));
    expect(look(introFrame(plan, plan.ms))).toBe(LOGO.join("\n"));
    expect(look(introFrame(plan, plan.ms + 5000))).toBe(LOGO.join("\n"));
    expect(look(introFrame(plan, -50))).toBe(look(introFrame(plan, 0)));
  });

  test("a chained plan shows the drop between its two effects", () => {
    let plan = planIntro({ rng: seeded(1) });
    for (let i = 2; plan.steps.length < 3 && i < 200; i += 1) plan = planIntro({ rng: seeded(i) });
    expect(plan.steps).toHaveLength(3);
    const into = plan.steps[0]!.ms + DROP_MS * 0.55;
    const during = introFrame(plan, into).map((r) => r.map((c) => c.ch).join("")).join("");
    expect(during).toMatch(/[()]/);
  });
});

describe("renderIntroRows", () => {
  const cases: Array<[string, string | undefined]> = [["truecolor", undefined], ["basic", undefined], ["none", undefined]];
  for (const [depth] of cases) {
    test(`each row is exactly the mark's width, in ${depth} colour`, () => {
      const saved = process.env.BRUINE_COLOR;
      process.env.BRUINE_COLOR = depth;
      resetColorDepth();
      try {
        for (const e of EFFECTS) {
          for (const t of [0, 0.3, 0.6, 0.9, 1]) {
            const rows = renderIntroRows(e.frame(t, 4));
            for (const row of rows) expect([...strip(row)]).toHaveLength(LOGO[0].length);
          }
        }
        expect(renderIntroRows(finalFrame()).map(strip)).toEqual([...LOGO]);
      } finally {
        if (saved === undefined) delete process.env.BRUINE_COLOR;
        else process.env.BRUINE_COLOR = saved;
        resetColorDepth();
      }
    });
  }
});

describe("introSetting", () => {
  test("the environment wins over the config, and both are case-insensitive; the default is random", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-intro-"));
    expect(introSetting(home, {})).toBe("random");
    await writeFile(join(home, "bruine.json"), JSON.stringify({ intro: "Decrypt" }));
    expect(introSetting(home, {})).toBe("decrypt");
    expect(introSetting(home, { BRUINE_INTRO: "OFF" })).toBe("off");
    expect(introSetting(home, { KUMO_INTRO: "waves" })).toBe("waves");
    expect(introSetting(home, { BRUINE_INTRO: "  " })).toBe("decrypt");
  });

  test("an unreadable config is no setting", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-intro-"));
    await writeFile(join(home, "bruine.json"), "{ not json");
    expect(introSetting(home, {})).toBe("random");
    await writeFile(join(home, "bruine.json"), JSON.stringify({ intro: 7 }));
    expect(introSetting(home, {})).toBe("random");
  });

  test("the old config name is read when the new one is absent", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-intro-"));
    await writeFile(join(home, "kumo.json"), JSON.stringify({ intro: "off" }));
    expect(introSetting(home, {})).toBe("off");
  });
});

describe("the last effect is remembered", () => {
  test("it is written, read back, and a stranger in the file is ignored", async () => {
    const home = await mkdtemp(join(tmpdir(), "bruine-intro-"));
    expect(readLastIntro(home)).toBeUndefined();
    rememberIntro(home, "waves");
    expect(readLastIntro(home)).toBe("waves");
    await writeFile(join(home, ".intro-last"), "not-an-effect\n");
    expect(readLastIntro(home)).toBeUndefined();
  });

  test("a home that cannot be written to is not an error", () => {
    expect(() => rememberIntro("/proc/definitely/not/here", "rain")).not.toThrow();
  });
});

describe("IntroPlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("it ticks while it plays, then stops, and the banner takes over", () => {
    const plan = planIntro({ pick: "wipe", rng: seeded(1) });
    const onTick = vi.fn();
    let now = 0;
    const player = new IntroPlayer(plan, onTick, () => now);
    player.start();
    expect(player.active).toBe(true);
    expect(player.rows()).toHaveLength(3);
    now = 400;
    vi.advanceTimersByTime(400);
    expect(onTick.mock.calls.length).toBeGreaterThan(4);
    now = plan.ms + 10;
    vi.advanceTimersByTime(60);
    expect(player.active).toBe(false);
    expect(player.rows()).toBeUndefined();
    const ticks = onTick.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(onTick.mock.calls.length).toBe(ticks);
  });

  test("a key stops it at once, with one last repaint, and a second skip does nothing", () => {
    const onTick = vi.fn();
    const player = new IntroPlayer(planIntro({ pick: "rain", rng: seeded(1) }), onTick, () => 0);
    player.start();
    player.skip();
    expect(player.active).toBe(false);
    expect(player.rows()).toBeUndefined();
    expect(onTick).toHaveBeenCalledTimes(1);
    player.skip();
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  test("it lists the effects it plays", () => {
    const player = new IntroPlayer(planIntro({ pick: "slide", rng: seeded(1) }), () => {}, () => 0);
    expect(player.effects).toEqual(["slide"]);
  });
});

class FakeTerminal implements Terminal {
  columns = 100;
  rows = 30;
  kittyProtocolActive = false;
  onInput?: (data: string) => void;
  start(onInput: (data: string) => void): void { this.onInput = onInput; }
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(): void {}
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

describe("the banner plays the entrance", () => {
  let saved: Record<string, string | undefined> = {};
  let tty: boolean | undefined;
  beforeEach(async () => {
    saved = { i: process.env.BRUINE_INTRO, a: process.env.BRUINE_ASCII, n: process.env.BRUINE_NO_ANIMATION, c: process.env.CI, t: process.env.TERM, h: process.env.BRUINE_HOME, u: process.env.BRUINE_NO_UPDATE_CHECK, col: process.env.BRUINE_COLOR };
    process.env.BRUINE_INTRO = "decrypt";
    process.env.BRUINE_ASCII = "0";
    delete process.env.BRUINE_NO_ANIMATION;
    delete process.env.CI;
    process.env.TERM = "xterm-256color";
    process.env.BRUINE_HOME = await mkdtemp(join(tmpdir(), "bruine-intro-ui-"));
    process.env.BRUINE_NO_UPDATE_CHECK = "1";
    process.env.BRUINE_COLOR = "none";
    tty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    resetColorDepth();
  });
  afterEach(() => {
    const back = (k: string, v: string | undefined): void => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    back("BRUINE_INTRO", saved.i); back("BRUINE_ASCII", saved.a); back("BRUINE_NO_ANIMATION", saved.n); back("CI", saved.c);
    back("TERM", saved.t); back("BRUINE_HOME", saved.h); back("BRUINE_NO_UPDATE_CHECK", saved.u); back("BRUINE_COLOR", saved.col);
    Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
    resetColorDepth();
  });

  const make = (icons = UNICODE_ICONS, columns = 100): { ui: BruineUi; term: FakeTerminal } => {
    const term = new FakeTerminal();
    term.columns = columns;
    const ui = new BruineUi("0.2.0", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, term, icons);
    return { ui, term };
  };
  const logoLines = (ui: BruineUi): string[] => ui.headerText().split("\n").map(strip).slice(0, 3).map((l) => l.slice(0, LOGO[0].length));

  test("on launch the banner's mark is mid-effect, and the version and key line are already beside it", async () => {
    vi.useFakeTimers();
    try {
      const { ui } = make();
      ui.start();
      expect(ui.introPlaying).toBe(true);
      expect(logoLines(ui)).not.toEqual([...LOGO]);
      const text = ui.headerText().split("\n").map(strip);
      expect(text[0]).toContain("v0.2.0");
      expect(text[1]).toContain("escape interrupt");
      await ui.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  test("the mark changes while it plays and is exactly the mark when it is over", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date", "setTimeout", "clearTimeout"] });
    try {
      const { ui } = make();
      ui.start();
      const seen = new Set<string>();
      for (let i = 0; i < 30; i += 1) {
        seen.add(logoLines(ui).join("|"));
        vi.advanceTimersByTime(60);
      }
      expect(seen.size).toBeGreaterThan(5);
      vi.advanceTimersByTime(3000);
      expect(ui.introPlaying).toBe(false);
      expect(logoLines(ui)).toEqual([...LOGO]);
      await ui.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a key stops it at once and the key still reaches the prompt", async () => {
    vi.useFakeTimers();
    try {
      const { ui, term } = make();
      ui.start();
      expect(ui.introPlaying).toBe(true);
      term.onInput?.("h");
      expect(ui.introPlaying).toBe(false);
      expect(logoLines(ui)).toEqual([...LOGO]);
      expect(ui.editor.getText()).toBe("h");
      await ui.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  test("BRUINE_INTRO=off keeps the mark still from the first frame", async () => {
    process.env.BRUINE_INTRO = "off";
    const { ui } = make();
    ui.start();
    expect(ui.introPlaying).toBe(false);
    expect(logoLines(ui)).toEqual([...LOGO]);
    await ui.shutdown();
  });

  test("no entrance without motion, in ASCII, or when the banner has no room for the mark", async () => {
    process.env.BRUINE_NO_ANIMATION = "1";
    const still = make();
    still.ui.start();
    expect(still.ui.introPlaying).toBe(false);
    await still.ui.shutdown();
    delete process.env.BRUINE_NO_ANIMATION;
    const ascii = make(ASCII_ICONS);
    ascii.ui.start();
    expect(ascii.ui.introPlaying).toBe(false);
    await ascii.ui.shutdown();
    const narrow = make(UNICODE_ICONS, 40);
    narrow.ui.start();
    expect(narrow.ui.introPlaying).toBe(false);
    await narrow.ui.shutdown();
  });

  test("the effect played is remembered, so the next launch plays another", async () => {
    process.env.BRUINE_INTRO = "random";
    const { ui } = make();
    ui.start();
    const first = readLastIntro(process.env.BRUINE_HOME!);
    expect(first).toBeDefined();
    await ui.shutdown();
    const again = make();
    again.ui.start();
    expect(readLastIntro(process.env.BRUINE_HOME!)).not.toBe(first);
    await again.ui.shutdown();
  });
});
