/**
 * D3 — the footer's three rows, and the order they are given up in.
 *
 * Rendered at three widths (100, 60, 30) and on an ASCII terminal with no colour,
 * because a status bar is read in one glance and a row that wraps or an escape that
 * leaks is a status bar nobody reads.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";
import { FooterComponent, displayModel, readGitBranch, shortenHead } from "../src/ui/footer.js";
import { strip } from "./fakes.js";

const HOME = "/home/tu44";
/** A working directory the test owns, so no assertion depends on where it runs. */
const at = (over: Parameters<FooterComponent["set"]>[0] = {}): FooterComponent => {
  const f = new FooterComponent(UNICODE_ICONS, { cwd: `${HOME}/Bureau`, home: HOME });
  f.set(over);
  return f;
};

const rows = (f: FooterComponent, width: number): string[] => f.render(width).map(strip);

describe("the three rows (D3)", () => {
  test("place, turn and speed — the reading a full turn leaves behind", () => {
    const f = at({
      gitBranch: "main",
      inputTokens: 17_000,
      outputTokens: 749,
      cacheRead: 34_000,
      cachePct: 99.9,
      contextUsed: 15_800,
      contextWindow: 131_072,
      model: "Ornith-1.5-9B-Q4_K_M",
      provider: "local",
      effort: "high",
      tps: 78.04,
      badges: ["FULL ACCESS"],
    });
    expect(rows(f, 100)).toEqual([
      expect.stringContaining("~/Bureau  ⎇ main"),
      expect.stringContaining("↑17k ↓749  ·  cached 34k · hit 99.9%  ·  ctx 12% of 131k"),
      expect.stringContaining("↯ TPS: 78.0 tok/s"),
    ]);
    // The row the eye lands on: the route at the right edge, the metrics at the margin.
    const turn = rows(f, 100)[1]!;
    expect(turn.trimEnd().endsWith("(local) Ornith-1.5-9B-Q4_K_M • high")).toBe(true);
    expect(turn.indexOf("↑17k")).toBe(0);
    expect(turn.indexOf("(local)")).toBeGreaterThan(turn.indexOf("131k"));
  });

  test("the words name what the number is, and the letters come back when the row is narrow", () => {
    // The same four facts, written two ways. The long form is what a reader who
    // has not seen the bar for a month needs; the short form is the letters one
    // who has read it for an hour knows, and it is the one a narrow row keeps.
    const f = at({
      inputTokens: 17_000,
      outputTokens: 749,
      cacheRead: 34_000,
      cachePct: 99.9,
      contextUsed: 15_800,
      contextWindow: 131_072,
      model: "m",
    });
    expect(rows(f, 100)[1]).toContain("cached 34k · hit 99.9%");
    expect(rows(f, 100)[1]).toContain("ctx 12% of 131k");
    const narrow = rows(f, 60)[1]!;
    expect(narrow).toContain("↑17k ↓749 R34k CH99.9% 12%/131k");
    expect(narrow).not.toContain("cached");
    expect(narrow).not.toContain("ctx");
  });

  test("a reading is grouped by a discreet dot, and the dot is structure, not text", () => {
    const turn = at({ inputTokens: 1, outputTokens: 2, cacheRead: 3, cachePct: 99, contextUsed: 4, contextWindow: 100, model: "m" })
      .render(100)[1]!;
    // Faint is the structure role (palette.ts); a separator in the text role
    // would read as a reading.
    expect(turn).toContain("\x1b[90m\u00b7\x1b[39m");
    expect(strip(turn)).toContain("↑1 ↓2  ·  cached 3 · hit 99.0%  ·  ctx 4.0% of 100");
  });

  test("the first row ends on the badge, and the badge is the mode the session is in", () => {
    expect(rows(at(), 100)[0]!.trimEnd().endsWith("ask")).toBe(true);
    expect(rows(at({ badges: ["ask", "plan"] }), 100)[0]!.trimEnd().endsWith("ask  plan")).toBe(true);
    // T23: full access is the one badge that has to be noticed, so it stays bold rose.
    const full = at({ badges: ["FULL ACCESS"] }).render(100)[0]!;
    expect(strip(full).trimEnd().endsWith("FULL ACCESS")).toBe(true);
    expect(full).toContain("\x1b[1m");
    expect(full).toContain("\x1b[31m");
  });

  test("a session that has done nothing says so instead of inventing a route", () => {
    const lines = rows(at(), 100);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.trimEnd().endsWith("no model • ?")).toBe(true);
    const all = lines.join(" ");
    expect(all).not.toMatch(/NaN|Infinity|undefined|null/);
  });

  test("a model path is a name and never a path (D3/D7 rule)", () => {
    const line = rows(at({ model: "/etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf", provider: "local" }), 100)[1]!;
    expect(line).toContain("Ornith-1.5-9B-Q4_K_M");
    expect(line).not.toContain("/etc");
    expect(line).not.toContain(".gguf");
    expect(displayModel(undefined, "Ornith 1.5 9B")).toBe("Ornith 1.5 9B");
    expect(displayModel(undefined)).toBe("no model");
  });

  test("an unknown context window is left out, never guessed", () => {
    const line = rows(at({ model: "m", contextUsed: 4_321 }), 100)[1]!;
    expect(line).not.toContain("/");
    expect(line).not.toMatch(/NaN|Infinity/);
    // Known window, unknown fill: the honest `0%` rather than a blank that reads
    // like a missing metric.
    expect(rows(at({ model: "m", contextWindow: 100_000 }), 100)[1]).toContain("ctx 0% of 100k");
  });
});

describe("degradation (D3: throughput, then cache, then context)", () => {
  const full = {
    gitBranch: "main",
    inputTokens: 17_000,
    outputTokens: 749,
    cacheRead: 34_000,
    cachePct: 99.9,
    contextUsed: 15_800,
    contextWindow: 131_072,
    model: "Ornith-1.5-9B-Q4_K_M",
    provider: "local",
    effort: "high",
    tps: 78,
  };
  const wide = rows(at(full), 100);
  expect(wide).toHaveLength(3);

  test("throughput stays visible when the metrics row gives up readings", () => {
    for (const width of [70, 68, 67, 60, 30]) {
      const squeezed = rows(at(full), width);
      expect(squeezed).toHaveLength(3);
      expect(squeezed[2]).toContain("TPS: 78.0 tok/s");
    }
    const longRoute = rows(at({ ...full, model: "Ornith-1.5-9B-Q4_K_M-instruct-uncensored" }), 70);
    expect(longRoute).toHaveLength(3);
    expect(longRoute[2]).toContain("TPS: 78.0 tok/s");
  });

  test("then the cache, then the context, and the route is never cut", () => {
    const f = at(full);
    // 60 cells: the cache goes first, the context stays, the route stays whole.
    const noCache = rows(f, 60)[1]!;
    expect(noCache).not.toContain("CH");
    expect(noCache).toContain("12%/131k");
    expect(noCache.trimEnd().endsWith("(local) Ornith-1.5-9B-Q4_K_M • high")).toBe(true);
    // 54 cells: the context goes next, the two arrows are what is left of the turn.
    const arrows = rows(f, 54)[1]!;
    expect(arrows).not.toContain("CH");
    expect(arrows).not.toContain("131k");
    expect(arrows).toContain("↑17k ↓749");
    expect(arrows.trimEnd().endsWith("(local) Ornith-1.5-9B-Q4_K_M • high")).toBe(true);
    // 44 cells: no reading fits beside the route, so the route takes the row.
    expect(rows(f, 44)[1]!.trimEnd().endsWith("(local) Ornith-1.5-9B-Q4_K_M • high")).toBe(true);
    // 34 and 30 cells: the effort goes before the marker that never changes, and the
    // model's own name is the last thing standing — a cut name is not the model
    // that is answering.
    expect(rows(f, 34)[1]!.trim()).toBe("(local) Ornith-1.5-9B-Q4_K_M");
    expect(rows(f, 30)[1]!.trim()).toBe("(local) Ornith-1.5-9B-Q4_K_M");
    // Narrower than the name: the name is still the honest thing to write.
    const cut = rows(f, 12)[1]!;
    expect(cut.trim().startsWith("Ornith-1")).toBe(true);
    expect(visibleWidth(cut)).toBeLessThanOrEqual(12);
  });

  test("the place row gives up the head of a long path before the badge", () => {
    const f = new FooterComponent(UNICODE_ICONS, {
      cwd: "/srv/deeply/nested/workspace/of/a/coding/agent/bruine",
      home: HOME,
    });
    f.set({ badges: ["FULL ACCESS"], gitBranch: "feature/D3-status-bar" });
    const line = rows(f, 60)[0]!;
    expect(line).toContain("coding/agent/bruine");
    expect(line).not.toContain("/srv/deeply");
    expect(line.trimEnd().endsWith("FULL ACCESS")).toBe(true);
    // Narrower still: the path keeps a tail, and the badge is the last thing to go.
    const narrow = rows(f, 40)[0]!;
    expect(narrow.trimEnd().endsWith("FULL ACCESS")).toBe(true);
    expect(visibleWidth(narrow)).toBeLessThanOrEqual(40);
  });
});

describe("widths, ASCII and no colour (D3)", () => {
  const busy = {
    gitBranch: "main",
    inputTokens: 17_000,
    outputTokens: 749,
    cacheRead: 34_000,
    cachePct: 99.9,
    contextUsed: 15_800,
    contextWindow: 131_072,
    model: "/etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf",
    provider: "local",
    effort: "high",
    tps: 78,
    pp: 1_200,
    badges: ["FULL ACCESS", "plan"],
  };

  test("no row is ever wider than the terminal, at 100, 60 or 30", () => {
    const f = at(busy);
    for (const width of [100, 60, 30]) {
      for (const line of f.render(width)) {
        expect(visibleWidth(line), `${width}: ${JSON.stringify(line)}`).toBeLessThanOrEqual(width);
      }
    }
  });

  test("a width of 1 does not throw and does not wrap", () => {
    const f = at(busy);
    for (const line of f.render(1)) expect(visibleWidth(line)).toBeLessThanOrEqual(1);
  });

  test("ASCII terminals get ASCII: no arrows, no bolt, not one escape", () => {
    const a = new FooterComponent(ASCII_ICONS, { cwd: `${HOME}/Bureau`, home: HOME });
    a.set(busy);
    const lines = a.render(100);
    expect(lines.join("")).not.toMatch(/\x1b\[/);
    expect(lines[0]).toContain("~/Bureau  # main");
    expect(lines[1]).toContain("^17k v749  -  cached 34k - hit 99.9%  -  ctx 12% of 131k");
    expect(lines[1].trimEnd().endsWith("(local) Ornith-1.5-9B-Q4_K_M - high")).toBe(true);
    expect(lines[2]).toContain("* TPS: 78.0 tok/s");
    expect(lines[0].trimEnd().endsWith("FULL ACCESS  plan")).toBe(true);
    for (const width of [60, 30]) {
      for (const line of a.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("the readings keep their colour: rose from 75%, amber from 60%, mint below", () => {
    const ctx = (used: number): string => at({ contextUsed: used, contextWindow: 100, model: "m" }).render(100)[1]!;
    // The label is quiet (muted) and the number carries the meaning, so the row
    // reads as a reading and not as a string of grey symbols.
    expect(ctx(40)).toContain("\x1b[90mctx\x1b[39m \x1b[32m40% of 100");
    expect(ctx(70)).toContain("\x1b[33m70% of 100");
    expect(ctx(78)).toContain("\x1b[31m78% of 100");
    // A cache that has not answered yet is gray (T27.1), not a reading of zero.
    expect(at({ cachePct: 99, cacheFirst: true }).render(100)[1]!).toContain("\x1b[90mhit\x1b[39m \x1b[90m99.0%");
    expect(at({ cachePct: 10 }).render(100)[1]!).toContain("\x1b[31m10.0%");
    // The throughput is sky: it is a rate, not a verdict.
    expect(at({ tps: 78 }).render(100)[2]!).toContain("\x1b[36m");
  });

  test("there is no cockpit to hand the metrics to: every reading is here (C6)", () => {
    // The bar used to be able to say "the panel next to the editor has the numbers",
    // and then the row it was on was a second, quieter copy that could disagree.
    const lines = rows(at(busy), 120);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("~/Bureau");
    expect(lines[1]).toContain("↑17k ↓749  ·  cached 34k · hit 99.9%");
    expect(lines[1]!.trimEnd().endsWith("(local) Ornith-1.5-9B-Q4_K_M • high")).toBe(true);
    expect(lines[2]).toContain("TPS");
  });

  test("prefill shares the speed row when it fits and wraps when it does not", () => {
    const f = at({ tps: 78, pp: 1_200 });
    expect(rows(f, 100)[2]).toContain("prefill 1.2k tok/s");
    expect(rows(f, 24).join("\n")).toContain("prefill 1.2k tok/s");
    expect(rows(f, 24).join("\n")).toContain("TPS: 78.0 tok/s");
  });
});

describe("the paths it names (D3)", () => {
  test("the place row says the place the way the row above the input says it", () => {
    // One rule for one answer: `displayPlace` (place.ts, tested in shell.test.ts).
    const f = new FooterComponent(UNICODE_ICONS, { cwd: `${HOME}/Bureau`, home: HOME });
    expect(rows(f, 60)[0]).toContain("~/Bureau");
    const outside = new FooterComponent(UNICODE_ICONS, { cwd: "/srv/bruine", home: HOME });
    expect(rows(outside, 60)[0]).toContain("/srv/bruine");
  });

  test("a shortened name keeps the tail that names it", () => {
    // The same rule as the place row above the input (clipStart), so one path is
    // never shortened two ways in one frame.
    expect(shortenHead("/srv/deep/nested/bruine", 30)).toBe("/srv/deep/nested/bruine");
    expect(shortenHead("/srv/deep/nested/bruine", 12)).toBe("…sted/bruine");
    expect(shortenHead("/srv/deep/nested/bruine", 4)).toBe("…ine");
    expect(shortenHead("/srv/deep/nested/bruine", 20, true)).toContain("...");
  });

  test("a session says where it is without anything wiring it", () => {
    // The constructor reads the working directory once, so the row is never empty
    // in a real session; the test only has to say where it is looking.
    const f = new FooterComponent(UNICODE_ICONS, { cwd: "/srv/bruine", home: HOME });
    expect(rows(f, 60)[0]).toContain("/srv/bruine");
    f.set({ cwd: `${HOME}/Bureau` });
    expect(rows(f, 60)[0]).toContain("~/Bureau");
  });
});
describe("the branch it names (D3)", () => {
  const made: string[] = [];
  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), "bruine-git-"));
    made.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const repo = (head: string, name = "main"): string => {
    const d = dir();
    mkdirSync(join(d, ".git"));
    writeFileSync(join(d, ".git", "HEAD"), `ref: refs/heads/${name}\n`);
    return d;
  };

  test("a branch is a name, read out of .git/HEAD", () => {
    expect(readGitBranch(repo("main"))).toBe("main");
    // A slash is a branch name too: `feature/D3-status-bar` is one branch.
    expect(readGitBranch(repo("x", "feature/D3-status-bar"))).toBe("feature/D3-status-bar");
    // A worktree's `.git` is a file naming the real directory, and the branch
    // lives there.
    const real = repo("x", "wip");
    const linked = dir();
    writeFileSync(join(linked, ".git"), `gitdir: ${join(real, ".git")}\n`);
    expect(readGitBranch(linked)).toBe("wip");
  });

  test("no repository, a detached HEAD and an unreadable file all say nothing", () => {
    expect(readGitBranch(dir())).toBeUndefined();
    // A detached HEAD is a commit, not a branch: printing the sha would be noise.
    const detached = dir();
    mkdirSync(join(detached, ".git"));
    writeFileSync(join(detached, ".git", "HEAD"), "9f2c1ab4e5d6...\n");
    expect(readGitBranch(detached)).toBeUndefined();
    const garbage = dir();
    mkdirSync(join(garbage, ".git"));
    writeFileSync(join(garbage, ".git", "HEAD"), "not a head at all\n");
    expect(readGitBranch(garbage)).toBeUndefined();
    // A `.git` file pointing nowhere is a broken checkout, not a crash.
    const broken = dir();
    writeFileSync(join(broken, ".git"), "gitdir: /nowhere/.git/worktrees/gone\n");
    expect(readGitBranch(broken)).toBeUndefined();
    expect(readGitBranch(join(dir(), "nope"))).toBeUndefined();
  });

  test("read once at startup, and again only when the directory moves", () => {
    const d = repo("main");
    const f = new FooterComponent(UNICODE_ICONS, { cwd: d, home: HOME });
    expect(rows(f, 60)[0]).toContain("⎇ main");
    // The frame is painted on every keystroke: if the branch were read there, a
    // deleted .git would empty the row under the user's eyes. It is not.
    rmSync(join(d, ".git"), { recursive: true, force: true });
    expect(rows(f, 60)[0]).toContain("⎇ main");
    // A directory change re-reads it, which is the other half of the rule.
    f.set({ cwd: dir() });
    expect(rows(f, 60)[0]).not.toContain("⎇");
    f.set({ cwd: d });
    expect(rows(f, 60)[0]).not.toContain("⎇");
  });

  test("a session that never had a repository shows no branch, and no error", () => {
    // What the e2e harness runs in: a temp directory, no .git at all.
    const f = new FooterComponent(UNICODE_ICONS, { cwd: dir(), home: HOME });
    expect(rows(f, 100)[0]).toContain("ask");
    expect(rows(f, 100)[0]).not.toContain("⎇");
    expect(rows(f, 100)[0]).not.toContain("#");
  });

  test("the row still shows ↑ ↓ and the cache when there is no branch (D3 readings)", () => {
    const f = new FooterComponent(UNICODE_ICONS, { cwd: repo("main"), home: HOME });
    f.set({ inputTokens: 17_000, outputTokens: 749, cacheRead: 34_000, cachePct: 99.9 });
    const line = rows(f, 100)[1]!;
    expect(line).toContain("↑17k ↓749");
    expect(line).toContain("cached 34k · hit 99.9%");
    expect(rows(f, 100)[0]).toContain("⎇ main");
  });
});
