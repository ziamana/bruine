import { Text, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { KumoUi } from "../src/ui/kumo-ui.js";
import { ReasoningComponent } from "../src/ui/reasoning-component.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";
import { AssistantTextComponent } from "../src/ui/assistant-text.js";
import { FooterComponent } from "../src/ui/footer.js";
import { TpsMeter } from "../src/ui/tps.js";
import { attachTui } from "../src/plugins/render.js";
import { LineEmitter, Repl } from "../src/plugins/repl.js";
import { UNICODE_ICONS } from "../src/render/chars.js";

// Never read the developer's real ~/.kumo (this test used to pass only because the
// old hand-written YAML reader failed on the real settings.yaml).
const savedDshHome = process.env.DSH_HOME;
beforeAll(() => {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "kumo-ui-test-"));
});
afterAll(() => {
  if (savedDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedDshHome;
});
import { fakeCtx, strip } from "./fakes.js";

class FakeTerminal implements Terminal {
  writes: string[] = [];
  onInput?: (data: string) => void;
  columns = 60;
  rows = 20;
  kittyProtocolActive = false;
  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

test("KumoUi.clearTasks clears the panel for future /new wiring", () => {
  const ui = new KumoUi("test", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, new FakeTerminal(), UNICODE_ICONS);
  ui.setTasks([{ content: "Pending work", status: "in_progress" }]);
  expect(ui.taskPanel.visible).toBe(true);
  ui.clearTasks();
  expect(ui.taskPanel.visible).toBe(false);
  expect(ui.taskPanel.tasks).toEqual([]);
});

test("ctrl+t expands and collapses the task list", async () => {
  const terminal = new FakeTerminal();
  const ui = new KumoUi("test", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, terminal, UNICODE_ICONS);
  ui.setTasks(Array.from({ length: 9 }, (_, i) => ({ content: `Task ${i}`, status: i === 4 ? "in_progress" : "pending" })));
  ui.start();
  expect(ui.taskPanel.render(60)).toHaveLength(7);
  terminal.onInput?.("\x14");
  expect(ui.taskPanel.render(60)).toHaveLength(10);
  terminal.onInput?.("\x14");
  expect(ui.taskPanel.render(60)).toHaveLength(7);
  await ui.shutdown();
});

describe("ReasoningComponent (T25.3 word by word)", () => {
  test("shows Thinking alone before the first complete word", () => {
    const r = new ReasoningComponent(() => 0, UNICODE_ICONS);
    r.push("Hel");
    expect(strip(r.render(40)[0])).toBe("· Thinking");
    r.push("lo ");
    expect(strip(r.render(40)[0])).toBe("· Thinking  Hello");
  });

  test("grows one complete word at a time, clears on sentence end", () => {
    const r = new ReasoningComponent(() => 0, UNICODE_ICONS);
    r.push("Hello wor");
    expect(strip(r.render(40)[0])).toBe("· Thinking  Hello");
    r.push("ld. Next ");
    expect(strip(r.render(40)[0])).toBe("· Thinking  Next");
  });

  test("collapses to 'thought for Xs' after end()", () => {
    let t = 1000;
    const r = new ReasoningComponent(() => t, UNICODE_ICONS);
    r.push("Hello ");
    t = 3200;
    r.end();
    const lines = r.render(40);
    expect(lines).toHaveLength(1);
    expect(strip(lines[0])).toBe("∴ Thought for 2.2s");
  });

  test("renders nothing before the first push", () => {
    const r = new ReasoningComponent(() => 0, UNICODE_ICONS);
    expect(r.render(40)).toEqual([]);
    r.end(); // end without start
    expect(r.render(40)).toEqual([]);
  });

  test("subtitle clears and continues when the next word does not fit", () => {
    const r = new ReasoningComponent(() => 0, UNICODE_ICONS);
    r.push("aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp ");
    const line = strip(r.render(20)[0]);
    expect(line.startsWith("· Thinking  ")).toBe(true);
    expect(line).not.toContain("aa");
    expect(line).toContain("pp");
  });
});

describe("ToolCallComponent (T27.2 aligned + rail)", () => {
  test("streams one header line, then result + preview", () => {
    const t = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    expect(t.rail).toBe("blue");
    expect(strip(t.render(60)[0])).toBe("· bash   ");
    t.args('{"command":"ls -la"}');
    expect(strip(t.render(60)[0])).toBe("· bash     ls -la");
    t.result(true, "a\nb");
    expect(t.rail).toBe("blue");
    const lines = t.render(60).map(strip);
    expect(lines[0].startsWith("✓ bash   ")).toBe(true);
    expect(lines[0]).toContain("ls -la");
    expect(lines[0].endsWith("0.0s")).toBe(true);
    expect(lines[1].trim()).toBe("⎿ a");
    expect(lines[2].trim()).toBe("b");
  });

  test("failed tool has red rail", () => {
    const t = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
    t.result(false, "boom");
    expect(t.rail).toBe("red");
  });

  test("4 consecutive reads → 2 lines + collapsed +2, failed breaks (T27.2)", async () => {
    const { groupRuns, CollapsedToolsComponent } = await import("../src/ui/tool-group.js");
    const tools = [
      { tool: "read", ok: true, seconds: 0.1 },
      { tool: "read", ok: true, seconds: 0.1 },
      { tool: "read", ok: true, seconds: 0.1 },
      { tool: "read", ok: true, seconds: 0.1 },
    ];
    const runs = groupRuns(tools);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ tool: "read", start: 0, count: 4 });
    const c = new CollapsedToolsComponent("read", 2, 0.2, UNICODE_ICONS);
    expect(c.rail).toBe("blue");
    expect(strip(c.render(60)[0])).toContain("+2 files");
    const mixed = [
      { tool: "read", ok: true, seconds: 0.1 },
      { tool: "read", ok: false, seconds: 0.1 },
      { tool: "read", ok: true, seconds: 0.1 },
    ];
    expect(groupRuns(mixed)).toHaveLength(3);
  });

  test("turn summary lines (T27.3)", async () => {
    const { turnSummary } = await import("../src/ui/tool-group.js");
    expect(turnSummary({ tools: 5, wallSec: 41, outputTokens: 1200, cancelled: false })).toBe(
      "✓ 5 tools · 41s · 1.2k tokens",
    );
    expect(turnSummary({ tools: 0, wallSec: 12, outputTokens: 340, cancelled: false })).toBe("✓ 12s · 340 tokens");
    expect(turnSummary({ tools: 0, wallSec: 12, outputTokens: 0, cancelled: true })).toBe("· cancelled after 12s");
  });

  test("caps the output preview and counts the rest", () => {
    const t = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    t.result(true, Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join("\n"));
    const lines = t.render(60).map(strip);
    expect(lines).toHaveLength(7);
    expect(lines[6].trim()).toBe("… 7 more lines");
  });

  test("summary() feeds the approval prompt", () => {
    const t = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    t.args('{"command":"rm -rf dist"}');
    expect(t.summary(80)).toBe("rm -rf dist");
  });

  test("absolute paths inside cwd shown relative (T27b minor)", async () => {
    const { relCwd } = await import("../src/ui/tool-call-component.js");
    const { join } = await import("node:path");
    expect(relCwd("note.txt")).toBe("note.txt");
    expect(relCwd(join(process.cwd(), "note.txt"))).toBe("note.txt");
    expect(relCwd("/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("AssistantTextComponent (T13c)", () => {
  test("renders markdown", () => {
    const a = new AssistantTextComponent();
    a.push("Hello **kumo**");
    a.finish();
    const text = a.render(40).map(strip).join("\n");
    expect(text).toContain("Hello");
    expect(text).toContain("kumo");
    expect(text).not.toContain("**");
  });

  test("emoji plus VS16 and space removed, bold kept (T24.2)", () => {
    const a = new AssistantTextComponent();
    a.push("**🛠️ Développement & code**");
    a.finish();
    const text = a.render(40).map(strip).join("\n");
    expect(text).toContain("Développement & code");
    expect(text).not.toContain("*");
  });

  test("paste chip in chat echo, full text for model untouched (T27.5)", async () => {
    const { pasteChip, chipMarkers } = await import("../src/ui/chat-layout.js");
    const { userMessageComponent } = await import("../src/ui/assistant-text.js");
    const big = Array.from({ length: 22 }, (_, i) => `line${String(i + 1)}`).join("\n");
    expect(pasteChip(big)).toContain("[Pasted 22 lines]");
    expect(pasteChip("short")).toBeUndefined();
    expect(chipMarkers("[paste #1 +22 lines]")).toContain("[Pasted 22 lines]");
    const comp = userMessageComponent(big) as { render(w: number): string[] };
    const rendered = comp.render(80).map(strip).join("\n");
    expect(rendered).toContain("[Pasted 22 lines]");
    expect(rendered).not.toContain("line22");
  });
});

describe("TpsMeter (T25.1, honest per-call numbers)", () => {
  test("100 deltas over 2 s after 3 s prefill, usage 100 → 50 tok/s", () => {
    const m = new TpsMeter();
    m.startCall(0);
    for (let i = 0; i < 100; i++) m.delta(3000 + (i * 2000) / 99);
    m.usage(5100, { outputTokens: 100, inputTokens: 3600 });
    expect(m.tps).toBeGreaterThan(47.5);
    expect(m.tps).toBeLessThan(52.5);
    expect(m.pp).toBeGreaterThan(1100);
    expect(m.pp).toBeLessThan(1300);
    m.reset();
    expect(m.tps).toBe(0);
    expect(m.pp).toBeUndefined();
  });

  test("two calls separated by a 4 s tool keep their own rates", () => {
    const m = new TpsMeter();
    m.startCall(0);
    for (let i = 0; i < 50; i++) m.delta(100 + i * 20);
    m.usage(1200, { outputTokens: 50, inputTokens: 100 });
    const first = m.tps;
    expect(first).toBeGreaterThan(40);
    m.endCall();
    m.startCall(5200);
    for (let i = 0; i < 50; i++) m.delta(5300 + i * 20);
    m.usage(6400, { outputTokens: 50, inputTokens: 100 });
    const second = m.tps;
    expect(second).toBeGreaterThan(40);
    expect(Math.abs(first - second) / first).toBeLessThan(0.2);
  });

  test("no usage falls back to delta count estimate", () => {
    const m = new TpsMeter();
    m.startCall(0);
    for (let i = 0; i < 10; i++) m.delta(1000 + i * 100);
    m.endCall();
    expect(m.tps).toBeGreaterThan(9);
    expect(m.tps).toBeLessThan(12);
  });

  test("cache 9700/10000 → 97%, first call gray, unknown hidden (T27.1)", () => {
    const m = new TpsMeter();
    m.startCall(0);
    m.delta(3000);
    m.delta(4000);
    m.usage(4100, { outputTokens: 10, inputTokens: 10000, cacheReadTokens: 9700 });
    expect(m.cachePct).toBeGreaterThan(96.9);
    expect(m.cachePct).toBeLessThan(97.1);
    expect(m.cacheFirst).toBe(true);
    m.endCall();
    m.startCall(5000);
    m.delta(6000);
    m.delta(7000);
    m.usage(7100, { outputTokens: 10, inputTokens: 10000, cacheReadTokens: 9700 });
    expect(m.cacheFirst).toBe(false);
    const n = new TpsMeter();
    n.startCall(0);
    n.delta(1000);
    n.usage(1100, { outputTokens: 5, inputTokens: 100 });
    expect(n.cachePct).toBeUndefined();
  });

  test("pp hidden below 512 new tokens (T28b.6)", () => {
    const m = new TpsMeter();
    m.startCall(0);
    m.delta(1000);
    m.delta(1100);
    m.usage(1200, { outputTokens: 10, inputTokens: 100, cacheReadTokens: 0 });
    expect(m.pp).toBeUndefined();
    expect(m.tps).toBeGreaterThan(0);
  });
});

describe("FooterComponent (T25.2)", () => {
  test("shows ctx, tok/s, model and effort without (auto)", () => {
    const f = new FooterComponent(UNICODE_ICONS);
    f.set({
      contextUsed: 16_100,
      contextWindow: 131_000,
      model: "Ornith 1.5 9B",
      provider: "local",
      effort: "low",
      tps: 52.3,
      pp: 1200,
    });
    const lines = f.render(100).map(strip);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ask");
    expect(lines[0]).toContain("ctx 12% of 131k");
    expect(lines[0]).toContain("52 tok/s");
    expect(lines[0]).toContain("pp 1.2k tok/s");
    expect(lines[0]).toContain("(local) Ornith 1.5 9B");
    expect(lines[0]).toContain("effort low");
    expect(lines[0]).not.toContain("(auto)");
    expect(lines[0]).not.toContain("TPS:");
  });

  test("percent below 10 shows one decimal, else integer; gguf basename", () => {
    const f = new FooterComponent(UNICODE_ICONS);
    f.set({ contextUsed: 9500, contextWindow: 100_000, model: "/etc/models/ornith-9b.Q4_K_M.gguf", provider: "local" });
    expect(f.render(100).map(strip)[0]).toContain("ctx 9.5% of 100k");
    expect(f.render(100).map(strip)[0]).toContain("ornith-9b.Q4_K_M");
    expect(f.render(100).map(strip)[0]).not.toContain("/etc");
    f.set({ contextUsed: 12_300, contextWindow: 100_000 });
    expect(f.render(100).map(strip)[0]).toContain("ctx 12% of 100k");
  });

  test("ctx includes cached: 9000 + 100 + 0 over 100k → 9.1% (T27b.2)", () => {
    const f = new FooterComponent(UNICODE_ICONS);
    f.set({ contextUsed: 9100, contextWindow: 100000, model: "m" });
    expect(f.render(100).map(strip)[0]).toContain("ctx 9.1% of 100k");
  });

  test("footer colors: tok/s 10/20/45 and ctx 40/70/78 (T31.5)", async () => {
    const { ASCII_ICONS } = await import("../src/render/chars.js");
    const raw = (tps?: number, used?: number): string => {
      const f = new FooterComponent(UNICODE_ICONS);
      f.set({ model: "m", ...(tps !== undefined ? { tps } : {}), ...(used !== undefined ? { contextUsed: used, contextWindow: 100 } : {}) });
      return f.render(120)[0]!;
    };
    expect(raw(10)).toContain("\x1b[31m10 tok/s");
    expect(raw(20)).toContain("\x1b[33m20 tok/s");
    expect(raw(45)).toContain("\x1b[32m45 tok/s");
    expect(raw(undefined, 40)).toContain("\x1b[32mctx 40% of 100");
    expect(raw(undefined, 70)).toContain("\x1b[33mctx 70% of 100");
    expect(raw(undefined, 78)).toContain("\x1b[31mctx 78% of 100");
    const a = new FooterComponent(ASCII_ICONS);
    a.set({ model: "m", tps: 45, contextUsed: 78, contextWindow: 100 });
    expect(a.render(120)[0]).not.toMatch(/\x1b\[/);
  });

  test("renders placeholder state", () => {
    const f = new FooterComponent(UNICODE_ICONS);
    const line = f.render(80).map(strip)[0]!;
    expect(line).toContain("ctx 0% of ?");
    expect(line).not.toContain("(auto)");
  });

  test("cache colors and order: 97% green, first gray, unknown hidden (T27.1)", () => {
    const f = new FooterComponent(UNICODE_ICONS);
    f.set({ cachePct: 97, cacheFirst: false, tps: 52, model: "m", provider: "local" });
    const line = f.render(120).map(strip)[0]!;
    expect(line).toContain("cache 97%");
    expect(line.indexOf("tok/s") < line.indexOf("cache")).toBe(true);
    expect(line.indexOf("cache") < line.indexOf("(local)")).toBe(true);
    const cell = ((): number => {
      const row = f.render(120)[0]!;
      return row.indexOf("cache 97%");
    })();
    expect(cell).toBeGreaterThanOrEqual(0);
    const green = new FooterComponent(UNICODE_ICONS);
    green.set({ cachePct: 97 });
    expect(green.render(80)[0]).toContain("\x1b[32m");
    const yellow = new FooterComponent(UNICODE_ICONS);
    yellow.set({ cachePct: 50 });
    expect(yellow.render(80)[0]).toContain("\x1b[33m");
    const red = new FooterComponent(UNICODE_ICONS);
    red.set({ cachePct: 10 });
    expect(red.render(80)[0]).toContain("\x1b[31m");
    const first = new FooterComponent(UNICODE_ICONS);
    first.set({ cachePct: 97, cacheFirst: true });
    expect(first.render(80)[0]).toContain("\x1b[90m");
    const unknown = new FooterComponent(UNICODE_ICONS);
    unknown.set({ model: "m" });
    expect(unknown.render(80).map(strip)[0]).not.toContain("cache");
  });
});

describe("LineEmitter + Repl over TUI events", () => {
  test("typed lines drive turns (no pause needed)", async () => {
    const emitter = new LineEmitter();
    const followups: string[] = [];
    const exits: number[] = [];
    let whenIdleResolve!: () => void;
    const repl = new Repl({
      agent: {
        session: {},
        whenIdle: () => new Promise<void>((r) => (whenIdleResolve = r)),
        cancel: () => {},
      },
      followup: (t) => followups.push(t),
      flush: async () => {},
      appExit: (c) => exits.push(c),
      lines: emitter.source(),
    });
    await repl.run();
    emitter.emitLine("hello");
    expect(followups).toEqual(["hello"]);
    whenIdleResolve();
    emitter.emitClose();
    await new Promise((r) => setImmediate(r));
    expect(exits).toEqual([0]);
  });
});

describe("KumoUi shell (T13a, fake terminal)", () => {
  function makeUi() {
    const terminal = new FakeTerminal();
    const submitted: string[] = [];
    const ui = new KumoUi(
      "0.2.0",
      { onSubmit: (t) => submitted.push(t), onEscape: () => {}, onQuit: () => {} },
      terminal,
      UNICODE_ICONS,
    );
    return { ui, terminal, submitted };
  }

  test("tree contains header, editor and footer", () => {
    const { ui } = makeUi();
    const lines = ui.tui.render(60).map(strip);
    const text = lines.join("\n");
    expect(text).toContain("kumo");
    expect(text).toContain("v0.2.0");
    expect(text).toContain("escape interrupt");
    expect(text).toContain("ctx 0% of ?");
  });

  test("editor submit routes to the handler", () => {
    const { ui, submitted } = makeUi();
    ui.editor.onSubmit?.("say hi");
    expect(submitted).toEqual(["say hi"]);
  });

  test("addChat appends to the transcript", () => {
    const { ui } = makeUi();
    ui.addChat(new Text("hello from chat", 1, 0));
    const text = ui.tui.render(60)
      .map(strip)
      .join("\n");
    expect(text).toContain("hello from chat");
  });

  test("tool rail in chat padding, blue then red (T27.2)", () => {
    const { ui } = makeUi();
    const ok = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
    ok.setArgs('{"path":"a"}');
    ok.result(true, "x");
    const bad = new ToolCallComponent("grep", () => 0, UNICODE_ICONS);
    bad.setArgs('{"pattern":"p"}');
    bad.result(false, "nope");
    ui.addChat(ok);
    ui.addChat(bad);
    const text = ui.tui.render(80).join("\n");
    expect(text).toContain("▍");
    expect(text).toContain("\x1b[34m");
    expect(text).toContain("\x1b[31m");
  });

  test("a blank line separates the transcript from the task panel", () => {
    const { ui } = makeUi();
    ui.addChat(new Text("last chat block", 1, 0));
    ui.setTasks([{ content: "Add the panel", status: "in_progress" }]);
    const lines = ui.tui.render(80).map(strip);
    const tasks = lines.findIndex((l) => l.includes("Tasks  0/1"));
    expect(tasks).toBeGreaterThan(0);
    expect(lines[tasks - 1]!.trim()).toBe("");
  });

  test("the task panel adds no gap of its own once it is hidden", () => {
    const { ui } = makeUi();
    ui.addChat(new Text("last chat block", 1, 0));
    ui.setTasks([{ content: "Add the panel", status: "in_progress" }]);
    ui.clearTasks();
    const lines = ui.tui.render(80).map(strip);
    const last = lines.findIndex((l) => l.includes("last chat block"));
    expect(lines[last + 1]!.trim()).toBe("");
    expect(lines.join("\n")).not.toContain("Tasks");
  });

  test("/reload re-reads settings.yaml and never adopts a route it did not switch to (T40)", async () => {
    const { readSettingsRoute, routeLabel } = await import("../src/ui/kumo-ui.js");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const home = mkdtempSync(join(tmpdir(), "kumo-reload-"));
    const settings = [
      "llm-pi-ai:",
      "  providers:",
      "    local:",
      "      baseURL: 'http://127.0.0.1:8080/v1'",
      "      models:",
      "      - id: 'first.gguf'",
      "        name: 'First'",
      "        contextWindow: 100000",
      "agent-default-model:",
      "  provider: 'local'",
      "  model: 'first.gguf'",
      "",
    ].join("\n");
    writeFileSync(join(home, "settings.yaml"), settings);
    const savedHome = process.env.DSH_HOME;
    const savedColor = process.env.KUMO_COLOR;
    process.env.DSH_HOME = home;
    process.env.KUMO_COLOR = "basic";
    const { resetColorDepth } = await import("../src/ui/palette.js");
    resetColorDepth();
    try {
      const { ui, terminal } = makeUi();
      ui.footer.set({ provider: "local", model: "first.gguf", modelName: "First" });
      expect(ui.liveRouteLabel()).toBe("local / First");

      // Nothing moved: the report says so instead of inventing a change.
      const same = await ui.reload();
      expect(same).toEqual({ route: "unchanged", live: "local / First", moved: undefined, background: "kept" });
      // A 16-color terminal paints nothing, so there is no background to re-read.
      expect(terminal.writes.join("")).not.toContain("\x1b]11;?");

      // settings.yaml now names another model. The session has NOT moved, and the
      // report must name both sides rather than quietly showing the new one.
      // replaceAll, or the default route would still name the old model.
      writeFileSync(join(home, "settings.yaml"), settings.replaceAll("first.gguf", "second.gguf").replace("'First'", "'Second'"));
      const moved = await ui.reload();
      expect(moved.route).toBe("moved");
      expect(moved.live).toBe("local / First");
      expect(moved.moved).toBe("local / Second");
      // The header and the footer still show the live route: no silent lie.
      expect(ui.liveRouteLabel()).toBe("local / First");
      expect(ui.footer.state.model).toBe("first.gguf");
      expect(ui.headerFirstLine()).toContain("First");

      // A settings.yaml that cannot be parsed is reported, never guessed at.
      writeFileSync(join(home, "settings.yaml"), "llm-pi-ai: [\n  broken: :\n");
      const broken = await ui.reload();
      expect(broken.route).toBe("unreadable");
      expect(broken.live).toBe("local / First");
    } finally {
      resetColorDepth();
      if (savedHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = savedHome;
      if (savedColor === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = savedColor;
      resetColorDepth();
    }
  });

  test("/reload re-probes the terminal background on a color terminal (T40)", async () => {
    const { bgCode, resetColorDepth, setTerminalBackdrop } = await import("../src/ui/palette.js");
    const savedColor = process.env.KUMO_COLOR;
    const savedBg = process.env.KUMO_BG;
    process.env.KUMO_COLOR = "truecolor";
    delete process.env.KUMO_BG;
    resetColorDepth();
    try {
      // A terminal that never answers: the query goes out, the surfaces stay.
      const quiet = makeUi();
      const kept = await quiet.ui.reload();
      expect(kept.background).toBe("kept");
      expect(quiet.terminal.writes.join("")).toContain("\x1b]11;?\x07");
      expect(quiet.ui.tui.render(80).join("\n")).toContain(bgCode("surface", "truecolor"));

      // A terminal that answers. A fresh UI, because pi-tui answers OSC 11
      // queries in order and the shell above left an unanswered one at the head
      // of the queue; a reply would have settled that one instead.
      const live = makeUi();
      const reply = "\x1b]11;rgb:fefe/fefe/fefe\x07";
      live.ui.start();
      live.terminal.onInput?.(reply);
      const pending = live.ui.reload();
      live.terminal.onInput?.(reply);
      const read = await pending;
      expect(read.background).toBe("read");
      // A light terminal, so the painted surfaces are not the authored ones.
      const probed = bgCode("surface", "truecolor");
      expect(probed).not.toBe("\x1b[48;2;28;32;48m");
      expect(live.ui.tui.render(80).join("\n")).toContain(probed);
      await live.ui.shutdown();
    } finally {
      setTerminalBackdrop();
      resetColorDepth();
      if (savedColor === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = savedColor;
      if (savedBg === undefined) delete process.env.KUMO_BG;
      else process.env.KUMO_BG = savedBg;
      resetColorDepth();
    }
  });

  test("routeLabel names a route the way the header does", async () => {
    const { routeLabel } = await import("../src/ui/kumo-ui.js");
    expect(routeLabel({ provider: "local", model: "a.gguf", name: "Ornith" })).toBe("local / Ornith");
    expect(routeLabel({ model: "a.gguf" })).toBe("a");
    expect(routeLabel({ provider: "local", model: "a.gguf" })).toBe("local / a");
  });

  test("the console band follows the terminal's real background (T40)", async () => {
    const { bgCode, resetColorDepth, setTerminalBackdrop } = await import("../src/ui/palette.js");
    const savedDepth = process.env.KUMO_COLOR;
    const savedBg = process.env.KUMO_BG;
    process.env.KUMO_COLOR = "truecolor";
    delete process.env.KUMO_BG;
    resetColorDepth();
    try {
      const { ui, terminal } = makeUi();
      const authored = bgCode("surface", "truecolor");
      expect(ui.tui.render(80).join("\n")).toContain(authored);

      // The query for the terminal's own background really goes out on the wire,
      // and a terminal that never answers simply keeps the authored surfaces.
      expect(await ui.probeBackdrop()).toBeUndefined();
      expect(terminal.writes.join("")).toContain("\x1b]11;?\x07");
      expect(ui.tui.render(80).join("\n")).toContain(authored);

      // Once a light background is known, every painted surface follows it.
      setTerminalBackdrop({ r: 255, g: 255, b: 255 });
      const probed = bgCode("surface", "truecolor");
      expect(probed).not.toBe(authored);
      const after = ui.tui.render(80).join("\n");
      expect(after).toContain(probed);
      expect(after).not.toContain(authored);
    } finally {
      setTerminalBackdrop();
      resetColorDepth();
      if (savedDepth === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = savedDepth;
      if (savedBg === undefined) delete process.env.KUMO_BG;
      else process.env.KUMO_BG = savedBg;
      resetColorDepth();
    }
  });

  test("header shows model and host, animation frames are block/braille without emoji (T27.4)", async () => {
    const { ui } = makeUi();
    ui.footer.set({ model: "Ornith 1.5 9B", provider: "local", modelName: "Ornith 1.5 9B" });
    ui.updateHeader();
    const text = ui.tui.render(80).map(strip).join("\n");
    expect(text).toContain("kumo");
    expect(text).toContain("Ornith 1.5 9B");
    const { STARTUP_FRAMES, shouldAnimateStartup, headerHost } = await import("../src/ui/kumo-ui.js");
    expect(STARTUP_FRAMES).toHaveLength(6);
    expect(STARTUP_FRAMES.join("")).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(shouldAnimateStartup({ stdoutTTY: false })).toBe(false);
    expect(shouldAnimateStartup({ stdoutTTY: true, env: { CI: "1" } })).toBe(false);
    expect(shouldAnimateStartup({ stdoutTTY: true, env: { KUMO_NO_ANIMATION: "1" } })).toBe(false);
    expect(shouldAnimateStartup({ stdoutTTY: true, env: {}, ascii: false })).toBe(true);
    expect(headerHost({ models: { main: { baseUrl: "http://192.168.1.64:8081/v1" } } }, "local")).toBe("192.168.1.64");
    expect(headerHost({ models: { main: { provider: "openrouter" } } }, undefined)).toBe("openrouter");
  });

  test("the wordmark never freezes: the sweep loops instead of stopping after one pass", async () => {
    const saved = { tty: process.stdout.isTTY, anim: process.env.KUMO_NO_ANIMATION };
    process.stdout.isTTY = true;
    delete process.env.KUMO_NO_ANIMATION;
    const ui = new KumoUi("0.2.0", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} });
    const phases: string[] = [];
    const realSetText = ui.header.setText.bind(ui.header);
    ui.header.setText = (t: string) => {
      realSetText(t);
      phases.push(t);
    };
    try {
      // A plain (non-fancy) header is the deterministic path: the cloud frames.
      expect(ui.fancyHeader).toBe(false);
      ui.start();
      // 6 frames at 70 ms: two full passes prove the wrap, not just the start.
      await new Promise((r) => setTimeout(r, 1000));
      expect(phases.length).toBeGreaterThanOrEqual(12);
      // And it cycles rather than repeating one still frame.
      expect(new Set(phases).size).toBe(6);
      // stopHeaderAnimation leaves a frozen header and no live timer.
      ui.stopHeaderAnimation();
      const after = phases.length;
      await new Promise((r) => setTimeout(r, 250));
      expect(phases.length).toBe(after);
    } finally {
      await ui.shutdown();
      process.stdout.isTTY = saved.tty;
      if (saved.anim === undefined) delete process.env.KUMO_NO_ANIMATION;
      else process.env.KUMO_NO_ANIMATION = saved.anim;
    }
  });

  test("no animation, no looping timer: CI and KUMO_NO_ANIMATION never spin", async () => {
    const saved = { tty: process.stdout.isTTY, ci: process.env.CI };
    process.stdout.isTTY = true;
    process.env.CI = "1";
    const ui = new KumoUi("0.2.0", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} });
    const phases: string[] = [];
    const realSetText = ui.header.setText.bind(ui.header);
    ui.header.setText = (t: string) => {
      realSetText(t);
      phases.push(t);
    };
    try {
      ui.start();
      await new Promise((r) => setTimeout(r, 300));
      expect(phases.length).toBe(0);
    } finally {
      await ui.shutdown();
      process.stdout.isTTY = saved.tty;
      if (saved.ci === undefined) delete process.env.CI;
      else process.env.CI = saved.ci;
    }
  });

  test("settings.yaml-only home resolves host, pretty name and window (T28b.1)", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readSettingsRoute } = await import("../src/ui/kumo-ui.js");
    const home = await mkdtemp(join(tmpdir(), "kumo-set-"));
    await writeFile(
      join(home, "settings.yaml"),
      `llm-pi-ai:\n  providers:\n    local:\n      baseURL: 'http://192.168.1.64:8081/v1'\n      models:\n      - id: 'Ornith-1.5-9B-Q4_K_M.gguf'\n        name: 'Ornith 1.5 9B'\n        contextWindow: 100000\nagent-default-model:\n  provider: 'local'\n  model: 'Ornith-1.5-9B-Q4_K_M.gguf'\n`,
    );
    const prev = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
      expect(readSettingsRoute()).toEqual({
        provider: "local",
        model: "Ornith-1.5-9B-Q4_K_M.gguf",
        baseUrl: "http://192.168.1.64:8081/v1",
        name: "Ornith 1.5 9B",
        contextWindow: 100000,
      });
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prev;
    }
  });

  test("ctrl+o toggles tools collapsed flag (T27.2)", async () => {
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, terminal, UNICODE_ICONS);
    ui.start();
    expect(ui.toolsCollapsed).toBe(true);
    terminal.onInput?.("\x0f");
    expect(ui.toolsCollapsed).toBe(false);
    terminal.onInput?.("\x0f");
    expect(ui.toolsCollapsed).toBe(true);
    await ui.shutdown();
  });

  test("onTurnEnd collapses 4 reads to 2 plus summary (T27.2+3)", () => {
    const { ui } = makeUi();
    const comps = ["a", "b", "c", "d"].map((f) => {
      const t = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
      t.setArgs(JSON.stringify({ file_path: f }));
      t.result(true, "x");
      ui.addChat(t);
      return t;
    });
    ui.onTurnEnd({
      tools: comps.map((c) => ({ tool: "read", ok: true, seconds: 0.1, comp: c })),
      wallSec: 2,
      outputTokens: 100,
      cancelled: false,
      error: false,
    });
    const text = ui.tui.render(100).map(strip).join("\n");
    expect(text).toContain("+2 files");
    expect(text).toMatch(/✓ 4 tools/);
    expect(text).toContain("2s");
    expect(text).toContain("100 tokens");
  });

  test("ctrl+o expands collapsed groups and collapses back (T27.2)", async () => {
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, terminal, UNICODE_ICONS);
    ui.start();
    const comps = ["a", "b", "c", "d"].map((f) => {
      const t = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
      t.setArgs(JSON.stringify({ file_path: f }));
      t.result(true, "x");
      ui.addChat(t);
      return t;
    });
    ui.onTurnEnd({
      tools: comps.map((c) => ({ tool: "read", ok: true, seconds: 0.1, comp: c })),
      wallSec: 2,
      outputTokens: 100,
      cancelled: false,
      error: false,
    });
    expect(ui.tui.render(100).map(strip).join("\n")).toContain("+2 files");
    terminal.onInput?.("\x0f");
    const expanded = ui.tui.render(100).map(strip).join("\n");
    expect(expanded).not.toContain("+2 files");
    expect(expanded.match(/read/g)?.length).toBeGreaterThanOrEqual(4);
    terminal.onInput?.("\x0f");
    expect(ui.tui.render(100).map(strip).join("\n")).toContain("+2 files");
    await ui.shutdown();
  });

  test("askQuestions Down+Enter resolves second option without touching chat (T28A)", async () => {
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, terminal, UNICODE_ICONS);
    ui.start();
    const p = ui.askQuestions([
      { id: "db", header: "Choose mode", question: "Which database?", options: [{ label: "SQLite" }, { label: "Redis" }] },
    ]);
    await new Promise((r) => setTimeout(r, 50));
    terminal.onInput?.("\x1b[B");
    await new Promise((r) => setTimeout(r, 50));
    terminal.onInput?.("\r");
    const answers = await p;
    expect(answers).toEqual([{ id: "db", selected: ["Redis"] }]);
    await ui.shutdown();
  });

  test("askQuestions Space toggles multi and Esc skips without onEscape (T28A)", async () => {
    const terminal = new FakeTerminal();
    let escaped = 0;
    const ui = new KumoUi(
      "test",
      { onSubmit() {}, onEscape() { escaped += 1; }, onQuit() {} },
      terminal,
      UNICODE_ICONS,
    );
    ui.start();
    const p = ui.askQuestions([
      { id: "m", question: "Pick?", multiSelect: true, options: [{ label: "A" }, { label: "B" }] },
    ]);
    await new Promise((r) => setTimeout(r, 50));
    terminal.onInput?.(" ");
    await new Promise((r) => setTimeout(r, 50));
    terminal.onInput?.("\x1b[B");
    await new Promise((r) => setTimeout(r, 50));
    terminal.onInput?.(" ");
    await new Promise((r) => setTimeout(r, 50));
    terminal.onInput?.("\r");
    expect(await p).toEqual([{ id: "m", selected: ["A", "B"] }]);
    expect(escaped).toBe(0);
    const p2 = ui.askQuestions([{ id: "q", question: "Which?", options: [{ label: "SQLite" }] }]);
    await new Promise((r) => setTimeout(r, 50));
    terminal.onInput?.("\x1b");
    expect(await p2).toEqual([{ id: "q", selected: [], custom: "skipped by the user" }]);
    expect(escaped).toBe(0);
    await ui.shutdown();
  });
});

describe("attachTui wiring", () => {
  interface FakeUi {
    addChat(c: any): void;
    removeChat?(c: any): void;
    footer: { set(next: any): void };
    requestRender(): void;
    icons: typeof UNICODE_ICONS;
    chats: any[];
    footerState: Record<string, unknown>;
  }

  function setup() {
    const fake = fakeCtx();
    const chats: any[] = [];
    let footerState: Record<string, unknown> = {};
    const ui: FakeUi = {
      chats,
      footerState,
      addChat: (c) => chats.push(c),
      removeChat: (c) => {
        const i = chats.indexOf(c);
        if (i !== -1) chats.splice(i, 1);
      },
      footer: { set: (next) => { footerState = { ...ui.footerState, ...next }; ui.footerState = footerState; } },
      requestRender: () => {},
      icons: UNICODE_ICONS,
    };
    const session = { id: "s", requestContext: () => ({ contextWindow: 100_000 }) };
    const agent = { session };
    const service: { describe?: (id: string) => { tool: string; summary: string } | undefined } = {};
    attachTui(fake.ctx as any, agent as any, ui as any, service);
    const stream = (chunk: unknown) =>
      fake.emit("agent/assistant-stream", { agent, frame: { type: "chunk", time: 1, chunk } });
    const event = (type: string, data: unknown, sess: unknown = session) =>
      fake.emit("session/event", sess, { type, data });
    return { chats, fake, stream, event, service, ui };
  }

  const rendered = (component: any, width = 60): string =>
    component.render(width).map(strip).join("\n");

  test("reasoning: one live line collapsing on block-end", () => {
    const { chats, stream } = setup();
    stream({ type: "reasoning-delta", text: "one two " });
    expect(chats).toHaveLength(1);
    expect(rendered(chats[0])).toBe("· Thinking  one two");
    stream({ type: "block-end", block: { type: "reasoning", text: "x" } });
    expect(rendered(chats[0])).toMatch(/∴ Thought for/);
  });

  test("text deltas render markdown", () => {
    const { chats, stream } = setup();
    stream({ type: "text-delta", text: "Hi **kumo**" });
    expect(rendered(chats[0])).toContain("kumo");
    expect(rendered(chats[0])).not.toContain("**");
  });

  test("tool stream + durable result", () => {
    const { chats, stream, event, service } = setup();
    stream({ type: "tool-call-delta", id: "t1", name: "bash", argumentsDelta: '{"command":"ls"}' });
    expect(rendered(chats[0])).toContain("· bash");
    expect(service.describe?.("t1")).toEqual({ tool: "bash", summary: "ls" });
    event("tool/result", {
      turn: 1,
      step: 0,
      message: { content: [{ type: "tool-result", toolCallId: "t1", content: [{ type: "text", text: "out" }], isError: false }] },
    });
    expect(rendered(chats[0])).toContain("✓ bash");
    expect(rendered(chats[0])).toContain("ls");
    expect(rendered(chats[0])).toContain("out");
  });

  test("real user messages echo, plugin reminders do not", () => {
    const { chats, event } = setup();
    event("user/message", { source: { kind: "plugin" }, content: [{ type: "text", text: "<system-reminder>…" }] });
    expect(chats).toHaveLength(0);
    event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "hello" }] });
    expect(chats).toHaveLength(1);
    expect(rendered(chats[0])).toContain("hello");
  });

  test("turn/end with usage fills footer context + T33b maps the error", async () => {
    const prev = process.env.DSH_HOME;
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "kumo-uitest-err-"));
    try {
      const { chats, ui, stream, event } = setup();
      stream({ type: "usage", usage: { inputTokens: 1000, outputTokens: 50 } });
      event("turn/end", { turn: 1, reason: { kind: "error", error: { code: "E1", message: "boom" } } });
      expect(ui.footerState.contextWindow).toBe(100_000);
      expect(ui.footerState.contextUsed).toBe(1050);
      await new Promise((r) => setTimeout(r, 20)); // showLlmError is async
      const texts = chats.map((c) => rendered(c)).join("\n");
      expect(texts).toContain("boom");
      expect(texts).toContain("Details in logs/kumo.log");
      expect(texts).not.toContain("stack");
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prev;
    }
  });

  test("compaction events: notice on start, dim before/after line on end (T33b)", () => {
    const { chats, ui, event } = setup();
    (ui.footer as unknown as { state: Record<string, unknown> }).state = {
      contextUsed: 81000,
      contextWindow: 100_000,
    };
    const notices: string[] = [];
    (ui as unknown as { showNotice: (t: string) => void }).showNotice = (t) => {
      notices.push(t);
    };
    event("compaction/start", { compactionId: "c1", turn: 3 });
    expect(notices.at(-1)).toBe("Context 81% full: summarizing the conversation…");
    event("compaction/summary", { compactionId: "c1", shadowedTokenCount: 67000 });
    event("compaction/end", { compactionId: "c1" });
    expect(chats.map((c) => rendered(c)).join("\n")).toContain("Compacted: 81k → 14k tokens");
  });

  test("other agents are ignored", () => {
    const { chats, fake } = setup();
    fake.emit("agent/assistant-stream", {
      agent: { other: true },
      frame: { type: "chunk", chunk: { type: "reasoning-delta", text: "no" } },
    });
    expect(chats).toHaveLength(0);
  });

  test("Working shows on turn/start and is replaced by first chunk (T24.3)", () => {
    const { chats, stream, event } = setup();
    event("turn/start", { turn: 1 });
    expect(chats).toHaveLength(1);
    expect(rendered(chats[0])).toMatch(/Working/);
    stream({ type: "reasoning-delta", text: "one" });
    expect(chats).toHaveLength(1);
    expect(rendered(chats[0])).toContain("Thinking");
  });

  test("mode announcements are not echoed as user messages (T24.4)", async () => {
    const { chats, event } = setup();
    const { PLAN_ON_TEXT, PLAN_OFF_TEXT } = await import("../src/plugins/modes.js");
    event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: PLAN_ON_TEXT }] });
    expect(chats).toHaveLength(0);
    event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: PLAN_OFF_TEXT }] });
    expect(chats).toHaveLength(0);
    event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "hello" }] });
    expect(chats).toHaveLength(1);
  });
});

describe("a question form survives the turn it interrupts", () => {
  test("a notice while the form is up does not wipe it, and is shown after", async () => {
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, terminal, UNICODE_ICONS);
    await ui.start();
    const painted = () => ui.tui.render(80).map(strip).join("\n");
    const pending = ui.askQuestions([
      { id: "q1", question: "Quelle base ?", options: [{ label: "SQLite" }] },
    ]);
    // Any turn event that reports a notice while the form owns the box. It used
    // to clear the box, so the form vanished while still holding every key.
    ui.showNotice("Compaction needs an idle session", { red: true });
    expect(painted()).toContain("Quelle base ?");
    terminal.onInput?.("\r");
    await pending;
    await new Promise((r) => setTimeout(r, 20));
    expect(painted()).toContain("Compaction needs an idle session");
    await ui.shutdown();
  });

  test("typing answers the question, no Other… detour needed", async () => {
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, terminal, UNICODE_ICONS);
    await ui.start();
    const answers = ui.askQuestions([
      { id: "q1", question: "Quelle base ?", options: [{ label: "SQLite" }, { label: "Redis" }] },
    ]);
    for (const ch of "utilise postgres") terminal.onInput?.(ch);
    expect(ui.tui.render(80).map(strip).join("\n")).toContain("utilise postgres");
    terminal.onInput?.("\r");
    expect(await answers).toEqual([{ id: "q1", selected: [], custom: "utilise postgres" }]);
    await ui.shutdown();
  });
});

describe("the suggestion is drawn in the editor, not above it", () => {
  async function started() {
    const terminal = new FakeTerminal();
    const ui = new KumoUi(
      "test",
      { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} },
      terminal,
      UNICODE_ICONS,
    );
    await ui.start();
    return { ui, terminal };
  }

  test("it sits inside the input line, in italics, and keeps the editor box", async () => {
    const { ui } = await started();
    ui.editor.setGhost("run the tests");
    const lines = ui.editor.render(60);
    // The box is still there: it used to be replaced by one lone dim line.
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => strip(l).includes("─")).length).toBe(2);
    const row = lines[1]!;
    expect(row).toContain("\x1b[3mrun the tests\x1b[23m");
    // Right after the cursor, inside the input line, not on a line of its own.
    // strip() leaves pi-tui's private cursor marker behind; drop it and the
    // cursor cell, and the input line is exactly the suggestion.
    expect(strip(row).replace(/\x1b_pi:c\x07/g, "").trim()).toBe("run the tests");
    await ui.shutdown();
  });

  test("a long suggestion is clipped to the width, never spills over", async () => {
    const { ui } = await started();
    ui.editor.setGhost("veux tu que je relance aussi les tests de la suite complete du projet");
    for (const width of [60, 40, 20, 12]) {
      for (const line of ui.editor.render(width)) {
        // visibleWidth, not stringWidth: pi-tui marks the cursor column with an
        // invisible private sequence that string-width counts as 5 cells.
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        expect(line).not.toMatch(/\x1b\[[0-9;]*$/);
      }
    }
    await ui.shutdown();
  });

  test("Tab accepts it, and typing anything replaces it", async () => {
    const { ui, terminal } = await started();
    ui.editor.setGhost("run the tests");
    terminal.onInput?.("\t");
    expect(ui.editor.getText()).toBe("run the tests");
    expect(ui.editor.ghost).toBe("");

    const second = await started();
    second.ui.editor.setGhost("run the tests");
    second.terminal.onInput?.("x");
    expect(second.ui.editor.ghost).toBe("");
    expect(second.ui.editor.getText()).toBe("x");
    await ui.shutdown();
    await second.ui.shutdown();
  });

  test("Enter never sends a suggestion by accident", async () => {
    const sent: string[] = [];
    const terminal = new FakeTerminal();
    const ui = new KumoUi(
      "test",
      { onSubmit: (t) => sent.push(t), onEscape: () => {}, onQuit: () => {} },
      terminal,
      UNICODE_ICONS,
    );
    await ui.start();
    ui.editor.setGhost("run the tests");
    terminal.onInput?.("\r");
    expect(sent).toEqual([]);
    await ui.shutdown();
  });
});

describe("suggest ghost (T28B)", () => {
  async function setupSuggest(llm: unknown) {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = await mkdtemp(join(tmpdir(), "kumo-suggest-"));
    await writeFile(
      join(home, "kumo.json"),
      JSON.stringify({ models: { fast: { provider: "p", model: "m" } }, suggestions: true }),
    );
    const prev = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    const { fakeCtx } = await import("./fakes.js");
    const { attachTui } = await import("../src/plugins/render.js");
    const { UNICODE_ICONS: icons } = await import("../src/render/chars.js");
    const fake = fakeCtx({ llm });
    const ghosts: string[] = [];
    const ui = {
      addChat: () => {},
      removeChat: () => {},
      footer: { set: () => {} },
      requestRender: () => {},
      icons,
      setGhost: (t: string) => ghosts.push(t),
      clearGhost: () => {},
    };
    const session = {};
    const agent = { session };
    const service: Record<string, unknown> = {};
    attachTui(fake.ctx as never, agent as never, ui as never, service);
    const stream = (chunk: unknown) =>
      fake.emit("agent/assistant-stream", { agent, frame: { type: "chunk", time: 1, chunk } });
    const event = (type: string, data: unknown) =>
      fake.emit("session/event", session, { type, data });
    return {
      ghosts,
      stream,
      event,
      service,
      cleanup: () => {
        if (prev === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = prev;
      },
    };
  }

  test("separate request without system/tools, ghost set (T28B)", async () => {
    let seen: Record<string, unknown> = {};
    const llm = {
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: "off" }] } }),
      stream: (o: Record<string, unknown>) => {
        seen = o;
        return (async function* () {
          yield { type: "text-delta", text: "run the tests" };
        })();
      },
    };
    const s = await setupSuggest(llm);
    try {
      s.event("turn/start", { turn: 1 });
      s.event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "did it pass" }] });
      s.stream({ type: "text-delta", text: "Yes it passed fine today ok" });
      s.event("turn/end", { turn: 1, reason: { kind: "completed" } });
      await new Promise((r) => setTimeout(r, 50));
      expect(seen).not.toHaveProperty("system");
      expect(seen).not.toHaveProperty("tools");
      expect(seen.maxTokens).toBe(24);
      expect(JSON.stringify(seen.messages)).toContain("did it pass");
      expect(JSON.stringify(seen.messages)).toContain("Suggest");
      expect(s.ghosts).toEqual(["run the tests"]);
    } finally {
      s.cleanup();
    }
  });

  test("cancelSuggest aborts the fast request (T28B)", async () => {
    let aborted = false;
    const llm = {
      resolveModelInfo: async () => ({}),
      stream: (o: { signal?: AbortSignal }) =>
        (async function* () {
          await new Promise<void>((_, reject) => {
            o.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          });
          yield { type: "text-delta", text: "late" };
        })(),
    };
    const s = await setupSuggest(llm);
    try {
      s.event("turn/start", { turn: 1 });
      s.event("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "hi" }] });
      s.stream({ type: "text-delta", text: "hello world answer here" });
      s.event("turn/end", { turn: 1, reason: { kind: "completed" } });
      await new Promise((r) => setTimeout(r, 20));
      (s.service.cancelSuggest as (() => void) | undefined)?.();
      await new Promise((r) => setTimeout(r, 20));
      expect(aborted).toBe(true);
      expect(s.ghosts).toEqual([]);
    } finally {
      s.cleanup();
    }
  });
});

describe("T23 regressions", () => {
  test("todo writes restore the last snapshot and never create a tool chat line", () => {
    const fake = fakeCtx();
    const chats: any[] = [];
    const lists: unknown[] = [];
    const session = { snapshotEvents: () => [
      { type: "todo/write", data: { todos: [{ content: "Old", status: "pending" }] } },
      { type: "todo/write", data: { todos: [{ content: "Latest", status: "in_progress" }] } },
    ] };
    const agent = { session };
    const ui = { icons: UNICODE_ICONS, addChat: (c: any) => chats.push(c), setTasks: (items: unknown) => lists.push(items), requestRender: () => {}, footer: { set: () => {} } };
    const detach = attachTui(fake.ctx as any, agent, ui as any, {});
    expect(lists).toEqual([[{ content: "Latest", status: "in_progress" }]]);
    fake.emit("agent/assistant-stream", { agent, frame: { type: "chunk", chunk: { type: "tool-call-delta", id: "t", name: "todo_write", argumentsDelta: "{}" } } });
    fake.emit("session/event", session, { type: "tool/call", data: { callId: "t", name: "todo_write", arguments: "{}" } });
    fake.emit("session/event", session, { type: "todo/write", data: { todos: [{ content: "Done", status: "completed" }] } });
    fake.emit("session/event", session, { type: "tool/result", data: { message: { content: [{ type: "tool-result", toolCallId: "t", content: [], isError: false }] } } });
    expect(chats).toEqual([]);
    expect(lists.at(-1)).toEqual([{ content: "Done", status: "completed" }]);
    detach();
  });

  test("streamed arguments are replaced by durable arguments, not concatenated", () => {
    const fake = fakeCtx();
    const chats: any[] = [];
    const session = {};
    const agent = { session };
    const ui = { icons: UNICODE_ICONS, addChat: (c: any) => chats.push(c), requestRender: () => {}, footer: { set: () => {} } };
    const detach = attachTui(fake.ctx as any, agent, ui as any, {});
    fake.emit("agent/assistant-stream", { agent, frame: { type: "chunk", chunk: { type: "tool-call-delta", id: "1", name: "read", argumentsDelta: '{"file_path":"note.txt"}' } } });
    fake.emit("session/event", session, { type: "tool/call", data: { callId: "1", name: "read", arguments: '{"file_path":"note.txt"}' } });
    expect(chats[0].summary()).toBe("note.txt");
    detach();
    expect(chats[0].active).toBe(false);
  });
  test("tool output and CJK summaries never exceed their cell budgets", () => {
    const tool = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
    tool.setArgs(JSON.stringify({ file_path: "漢字".repeat(100) }));
    expect(tool.summary()).toMatch(/^漢字.*…$/);
    tool.result(false, "denied ".repeat(100));
    for (const width of [20, 60, 100]) {
      for (const line of tool.render(width)) expect(stringWidth(strip(line))).toBeLessThanOrEqual(width);
    }
  });
  test("reasoning animation changes frames without exposing partial words (T25.3)", () => {
    let time = 0;
    const r = new ReasoningComponent(() => time, UNICODE_ICONS);
    r.push("Alpha Bet");
    expect(strip(r.render(80)[0])).toBe("· Thinking  Alpha");
    r.push("a ");
    const first = strip(r.render(80)[0]);
    time = 100;
    expect(strip(r.render(80)[0])).toBe("✢ Thinking  Alpha Beta");
    expect(first).toBe("· Thinking  Alpha Beta");
    r.end();
    const done = r.render(80);
    time = 2000;
    expect(r.render(80)).toEqual(done);
  });
  test("consumed key handlers request redraw and bypass editor input", async () => {
    const terminal = new FakeTerminal();
    const shiftTab = vi.fn();
    const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {}, onShiftTab: shiftTab }, terminal, UNICODE_ICONS);
    const render = vi.spyOn(ui, "requestRender");
    ui.start();
    terminal.onInput?.("abc");
    terminal.onInput?.("\t");
    terminal.onInput?.("\x1b[Z");
    expect(shiftTab).toHaveBeenCalledOnce();
    expect(ui.editor.getText()).toBe("abc");
    terminal.onInput?.("\x03");
    expect(ui.editor.getText()).toBe("");
    expect(render).toHaveBeenCalledTimes(2);
    await ui.shutdown();
  });
});

describe("slash autocomplete provider (T31.1)", () => {
  test("empty prefix → null; / → 7+ items; /co → /compact first", async () => {
    const { CombinedAutocompleteProvider } = await import("@earendil-works/pi-tui");
    const { KUMO_COMMANDS } = await import("../src/plugins/repl.js");
    const provider = new CombinedAutocompleteProvider(KUMO_COMMANDS, process.cwd());
    const signal = new AbortController().signal;
    expect(await provider.getSuggestions([""], 0, 0, { signal })).toBeNull();
    const all = await provider.getSuggestions(["/"], 0, 1, { signal });
    expect(all).not.toBeNull();
    expect(all!.items.length).toBeGreaterThanOrEqual(7);
    const co = await provider.getSuggestions(["/co"], 0, 3, { signal });
    expect(co).not.toBeNull();
    expect(co!.items[0]!.value).toBe("/compact");
  });
});

describe("settings.yaml reader (real YAML, kumo's own list style)", () => {
  test("finds name and window when `- id:` sits at the same indent as `models:`", async () => {
    const { writeFileSync } = await import("node:fs");
    const { readSettingsRoute } = await import("../src/ui/kumo-ui.js");
    const home = mkdtempSync(join(tmpdir(), "kumo-settings-"));
    writeFileSync(join(home, "settings.yaml"), [
      "llm-pi-ai:",
      "  providers:",
      "    local:",
      "      baseURL: 'http://192.168.1.64:8081/v1'",
      "      models:",
      "      - id: '/m/Ornith.gguf'",
      "        name: 'Ornith 1.5 9B'",
      "        contextWindow: 100096",
      "agent-default-model:",
      "  provider: 'local'",
      "  model: '/m/Ornith.gguf'",
      "",
    ].join("\n"));
    expect(readSettingsRoute(home)).toEqual({
      provider: "local", model: "/m/Ornith.gguf", baseUrl: "http://192.168.1.64:8081/v1", name: "Ornith 1.5 9B", contextWindow: 100096,
    });
  });
});

describe("every provider in settings.yaml (T37)", () => {
  test("all routes come back, not only the default one", async () => {
    const { writeFileSync } = await import("node:fs");
    const { readSettingsProviders } = await import("../src/ui/kumo-ui.js");
    const home = mkdtempSync(join(tmpdir(), "kumo-providers-"));
    writeFileSync(join(home, "settings.yaml"), [
      "llm-pi-ai:",
      "  providers:",
      "    local:",
      "      displayName: Local Server",
      "      baseURL: 'http://192.168.1.64:8081/v1'",
      "      apiKeyEnv: KUMO_LOCAL_API_KEY",
      "      models:",
      "        - id: '/m/Ornith.gguf'",
      "          name: 'Ornith 1.5 9B'",
      "          contextWindow: 100096",
      "    openrouter:",
      "      apiKeyEnv: OPENROUTER_API_KEY",
      "      models:",
      "        - id: 'qwen/qwen3-32b'",
      "    empty:",
      "      displayName: No Models Yet",
      "agent-default-model:",
      "  provider: 'local'",
      "  model: '/m/Ornith.gguf'",
      "",
    ].join("\n"));
    expect(readSettingsProviders(home)).toEqual([
      {
        id: "local",
        displayName: "Local Server",
        baseUrl: "http://192.168.1.64:8081/v1",
        apiKeyEnv: "KUMO_LOCAL_API_KEY",
        models: [{ id: "/m/Ornith.gguf", name: "Ornith 1.5 9B", contextWindow: 100096 }],
      },
      { id: "openrouter", apiKeyEnv: "OPENROUTER_API_KEY", models: [{ id: "qwen/qwen3-32b" }] },
      { id: "empty", displayName: "No Models Yet", models: [] },
    ]);
  });

  test("a missing, empty or broken settings.yaml is an empty list, never a throw", async () => {
    const { writeFileSync } = await import("node:fs");
    const { readSettingsProviders } = await import("../src/ui/kumo-ui.js");
    const home = mkdtempSync(join(tmpdir(), "kumo-providers-"));
    expect(readSettingsProviders(join(home, "nope"))).toEqual([]);
    writeFileSync(join(home, "settings.yaml"), "");
    expect(readSettingsProviders(home)).toEqual([]);
    writeFileSync(join(home, "settings.yaml"), "llm-pi-ai:\n  providers:\n    a: not-a-map\n    b: null\n");
    expect(readSettingsProviders(home)).toEqual([]);
    writeFileSync(join(home, "settings.yaml"), "llm-pi-ai: [oops\n");
    expect(readSettingsProviders(home)).toEqual([]);
  });
});

describe("the picker overlay (T37)", () => {
  test("askChoice starts the cursor on the row the caller names", async () => {
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, terminal, UNICODE_ICONS);
    ui.start();
    const p = ui.askChoice(
      "Model",
      [{ value: "a", label: "alpha" }, { value: "b", label: "beta" }, { value: "c", label: "gamma" }],
      { initial: 2 },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(strip(ui.tui.render(60).join("\n"))).toContain("→ gamma");
    terminal.onInput?.("\r");
    expect(await p).toBe(2);
    await ui.shutdown();
  });

  test("an out-of-range initial is ignored rather than throwing", async () => {
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, terminal, UNICODE_ICONS);
    ui.start();
    const p = ui.askChoice("Model", [{ value: "a", label: "alpha" }], { initial: 9 });
    await new Promise((r) => setTimeout(r, 50));
    terminal.onInput?.("\r");
    expect(await p).toBe(0);
    await ui.shutdown();
  });

  test("resetRouteCache drops the memoized host so a new route shows its own", async () => {
    const { writeFileSync, mkdtempSync: mk } = await import("node:fs");
    const { tmpdir: tmp } = await import("node:os");
    const home = mk(join(tmp(), "kumo-header-"));
    const settings = (baseUrl: string): string =>
      [
        "llm-pi-ai:",
        "  providers:",
        "    local:",
        `      baseURL: '${baseUrl}'`,
        "      models:",
        "        - id: m",
        "agent-default-model:",
        "  provider: 'local'",
        "  model: 'm'",
        "",
      ].join("\n");
    writeFileSync(join(home, "settings.yaml"), settings("http://192.168.1.64:8081/v1"));
    vi.stubEnv("DSH_HOME", home);
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {} }, terminal, UNICODE_ICONS);
    ui.start();
    ui.footer.set({ model: "m", provider: "local" });
    expect(strip(ui.headerFirstLine())).toContain("192.168.1.64");
    writeFileSync(join(home, "settings.yaml"), settings("http://127.0.0.1:9999/v1"));
    // Memoized: still the old host until the route cache is dropped.
    expect(strip(ui.headerFirstLine())).toContain("192.168.1.64");
    ui.resetRouteCache();
    expect(strip(ui.headerFirstLine())).toContain("127.0.0.1");
    await ui.shutdown();
    vi.unstubAllEnvs();
  });
});

describe("tool output display (Nuage polish)", () => {
  test("read output hides dsh's <path>/<type>/<content> wrapper lines", () => {
    const c = new ToolCallComponent("read", () => 0);
    c.setArgs(JSON.stringify({ path: "src/a.ts" }));
    c.result(true, "<path>/p/src/a.ts</path>\n<type>file</type>\n<content>\n1: const a = 1;\n</content>\n");
    const text = c.render(80).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(text).toContain("1: const a = 1;");
    expect(text).not.toContain("<path>");
    expect(text).not.toContain("<content>");
  });
});
