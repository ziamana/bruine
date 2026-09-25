import { Text, type Terminal } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
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

describe("ReasoningComponent (T13b)", () => {
  test("always renders exactly one line while streaming", () => {
    const r = new ReasoningComponent(() => 0, UNICODE_ICONS);
    r.push("thinking\n\nabout\nthis");
    const lines = r.render(40);
    expect(lines).toHaveLength(1);
    expect(strip(lines[0])).toBe("💭 this");
  });

  test("collapses to 'thought for Xs' after end()", () => {
    let t = 1000;
    const r = new ReasoningComponent(() => t, UNICODE_ICONS);
    r.push("hmm");
    t = 3200;
    r.end();
    const lines = r.render(40);
    expect(lines).toHaveLength(1);
    expect(strip(lines[0])).toBe("💭 thought for 2.2s");
  });

  test("renders nothing before the first push", () => {
    const r = new ReasoningComponent(() => 0, UNICODE_ICONS);
    expect(r.render(40)).toEqual([]);
    r.end(); // end without start
    expect(r.render(40)).toEqual([]);
  });

  test("truncates to the width in one line", () => {
    const r = new ReasoningComponent(() => 0, UNICODE_ICONS);
    r.push("x".repeat(100));
    const lines = r.render(20);
    expect(lines).toHaveLength(1);
    expect(strip(lines[0]).length).toBeLessThanOrEqual(19);
  });
});

describe("ToolCallComponent (T13c)", () => {
  test("streams one header line, then result + preview", () => {
    const t = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    expect(strip(t.render(60)[0])).toBe("● bash  ");
    t.args('{"command":"ls -la"}');
    expect(strip(t.render(60)[0])).toBe("● bash  ls -la");
    t.result(true, "a\nb");
    const lines = t.render(60).map(strip);
    expect(lines[0]).toBe("✓ bash  ls -la  0.0s");
    expect(lines[1].trim()).toBe("a");
    expect(lines[2].trim()).toBe("b");
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
});

describe("TpsMeter (T13d, honest numbers)", () => {
  test("computes tokens/s from its own timestamps", () => {
    const m = new TpsMeter();
    m.sample(0, 10);
    m.sample(1000, 60); // 50 tokens over 1 s
    expect(m.tps).toBeGreaterThan(0);
    expect(m.tps).toBeLessThanOrEqual(50);
    m.reset();
    expect(m.tps).toBe(0);
  });
});

describe("FooterComponent (T13d)", () => {
  test("shows context %, model and TPS", () => {
    const f = new FooterComponent(UNICODE_ICONS);
    f.set({
      contextUsed: 16_100,
      contextWindow: 131_000,
      model: "Ornith 1.5 9B",
      provider: "local",
      effort: "low",
      tps: 55.9,
    });
    const lines = f.render(80).map(strip);
    expect(lines[0]).toContain("12.3%/131k (auto)");
    expect(lines[0]).toContain("(local) Ornith 1.5 9B • low");
    expect(lines[1]).toContain("⚡ TPS: 55.9");
  });

  test("renders placeholder state", () => {
    const f = new FooterComponent(UNICODE_ICONS);
    expect(f.render(80)[0]).toContain("0%/— (auto)");
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
    expect(text).toContain("kumo v0.2.0");
    expect(text).toContain("escape interrupt");
    expect(text).toContain("(auto)");
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
});

describe("attachTui wiring", () => {
  interface FakeUi {
    addChat(c: any): void;
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
    stream({ type: "reasoning-delta", text: "one\n\ntwo" });
    expect(chats).toHaveLength(1);
    expect(rendered(chats[0])).toBe("💭 two");
    stream({ type: "block-end", block: { type: "reasoning", text: "x" } });
    expect(rendered(chats[0])).toMatch(/💭 thought for/);
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
    expect(rendered(chats[0])).toContain("● bash");
    expect(service.describe?.("t1")).toEqual({ tool: "bash", summary: "ls" });
    event("tool/result", {
      turn: 1,
      step: 0,
      message: { content: [{ type: "tool-result", toolCallId: "t1", content: [{ type: "text", text: "out" }], isError: false }] },
    });
    expect(rendered(chats[0])).toContain("✓ bash  ls");
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
});
