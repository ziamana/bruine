import { Text, type Terminal } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { describe, expect, test, vi } from "vitest";
import { KumoUi } from "../src/ui/kumo-ui.js";
import { ReasoningComponent } from "../src/ui/reasoning-component.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";
import { AssistantTextComponent } from "../src/ui/assistant-text.js";
import { FooterComponent } from "../src/ui/footer.js";
import { TpsMeter } from "../src/ui/tps.js";
import { attachTui } from "../src/plugins/render.js";
import { LineEmitter, Repl } from "../src/plugins/repl.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
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
    expect(text).toContain("│");
    expect(text).toContain("\x1b[34m");
    expect(text).toContain("\x1b[31m");
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

  test("turn/end with usage fills footer context + error prints line", () => {
    const { chats, ui, stream, event } = setup();
    stream({ type: "usage", usage: { inputTokens: 1000, outputTokens: 50 } });
    event("turn/end", { turn: 1, reason: { kind: "error", error: { code: "E1", message: "boom" } } });
    expect(ui.footerState.contextWindow).toBe(100_000);
    expect(ui.footerState.contextUsed).toBe(1050);
    const last = chats[chats.length - 1];
    expect(rendered(last)).toContain("✗ E1: boom");
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
    const tab = vi.fn(); const shiftTab = vi.fn();
    const ui = new KumoUi("test", { onSubmit() {}, onEscape() {}, onQuit() {}, onTab: tab, onShiftTab: shiftTab }, terminal, UNICODE_ICONS);
    const render = vi.spyOn(ui, "requestRender");
    ui.start();
    terminal.onInput?.("abc");
    terminal.onInput?.("\t");
    terminal.onInput?.("\x1b[Z");
    expect(tab).toHaveBeenCalledOnce();
    expect(shiftTab).toHaveBeenCalledOnce();
    expect(ui.editor.getText()).toBe("abc");
    terminal.onInput?.("\x03");
    expect(ui.editor.getText()).toBe("");
    expect(render).toHaveBeenCalledTimes(3);
    await ui.shutdown();
  });
});
