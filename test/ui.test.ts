import { Text, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import stringWidth from "string-width";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { KumoUi } from "../src/ui/kumo-ui.js";
import { ReasoningComponent } from "../src/ui/reasoning-component.js";
import { ToolCallComponent } from "../src/ui/tool-call-component.js";
import { AssistantTextComponent, userMessageComponent } from "../src/ui/assistant-text.js";
import { TpsMeter } from "../src/ui/tps.js";
import { attachTui } from "../src/plugins/render.js";
import { LineEmitter, Repl } from "../src/plugins/repl.js";
import { ASCII_ICONS, UNICODE_ICONS } from "../src/render/chars.js";

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
    // A moving clock, so this still pins where the duration sits. The instant
    // case (no duration at all) is the T55 P1a test below.
    let clock = 0;
    const t = new ToolCallComponent("bash", () => clock, UNICODE_ICONS);
    // T55 P1c: a tool in flight owns the rail; it only settles once it has a result.
    expect(t.rail).toBe("active");
    expect(strip(t.render(60)[0])).toBe("· bash   ");
    t.args('{"command":"ls -la"}');
    expect(strip(t.render(60)[0])).toBe("· bash     ls -la");
    clock = 1500;
    t.result(true, "a\nb");
    expect(t.rail).toBe("blue");
    const lines = t.render(60).map(strip);
    expect(lines[0].startsWith("✓ bash   ")).toBe(true);
    expect(lines[0]).toContain("ls -la");
    expect(lines.at(-1)).toBe("Took 1.5s");
    expect(lines[1].trim()).toBe("⎿ a");
    expect(lines[2].trim()).toBe("b");
  });

  test("a settled tool links its path, and the link never costs a cell (T55 P2)", async () => {
    const { fileLink, linkToolSummary } = await import("../src/ui/links.js");
    const savedColor = process.env.KUMO_COLOR;
    process.env.KUMO_COLOR = "truecolor";
    const { resetColorDepth } = await import("../src/ui/palette.js");
    resetColorDepth();
    try {
      const t = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
      t.setArgs(JSON.stringify({ path: `${process.cwd()}/src/ui/links.ts` }));
      t.result(true, "x");
      const raw = t.render(100)[0]!;
      // The link is there, and the text is still the plain path underneath it.
      expect(raw).toContain("\x1b]8;;file://");
      expect(raw).toContain("links.ts");
      // And the escape is zero-width: the line is not one cell longer.
      expect(stringWidth(raw)).toBeLessThanOrEqual(100);
      // The link is closed, so it cannot bleed into the next line.
      expect(raw.lastIndexOf("\x1b]8;;\x1b\\")).toBeGreaterThan(raw.indexOf("\x1b]8;;file://"));
    } finally {
      if (savedColor === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = savedColor;
      resetColorDepth();
    }
    // A relative path has no target, so it is never linked.
    expect(fileLink("src/a.ts", "src/a.ts")).toBe("src/a.ts");
    // A summary that is not a path is never linked.
    expect(linkToolSummary("ls -la", '{"command":"ls -la"}')).toBe("ls -la");
    // A clipped path is a prefix: linking it would make the label lie.
    expect(linkToolSummary("a-very-long-file…", JSON.stringify({ path: "/x/a-very-long-file-name-indeed.ts" }))).toBe(
      "a-very-long-file…",
    );
    // A command with a path inside it is still just a command.
    expect(linkToolSummary("cat /etc/hosts", '{"command":"cat /etc/hosts"}')).toBe("cat /etc/hosts");
  });

  test("a tool in flight is not linked: the line is about to be replaced (T55 P2)", () => {
    const t = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
    t.setArgs(JSON.stringify({ path: `${process.cwd()}/src/ui/links.ts` }));
    // No result yet: streaming. A link here would be replaced a frame later.
    expect(t.render(100)[0]).not.toContain("\x1b]8;;");
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
    // T55 P1a: the collapsed group is the same TOOL, not the same file. It used to
    // say "+2 files", which is a lie for a run of `grep` or `web_fetch`.
    expect(strip(c.render(60)[0])).toContain("+2 more");
    // And a group that took 0.2s keeps its duration.
    expect(strip(c.render(60).at(-1)!)).toBe("Took 0.2s");
    const mixed = [
      { tool: "read", ok: true, seconds: 0.1 },
      { tool: "read", ok: false, seconds: 0.1 },
      { tool: "read", ok: true, seconds: 0.1 },
    ];
    expect(groupRuns(mixed)).toHaveLength(3);
  });

  test("the receipt carries the turn and the cache, and stays silent when it cannot (T55 P1b)", async () => {
    const { turnSummary } = await import("../src/ui/tool-group.js");
    const base = { tools: 5, wallSec: 41, outputTokens: 1200, cancelled: false };
    // Unchanged when there is nothing new to say, so T27.3's shape still holds.
    expect(turnSummary(base)).toBe("✓ 5 tools · 41s · 1.2k tokens");
    expect(turnSummary({ ...base, turn: 3 })).toBe("turn 3 · ✓ 5 tools · 41s · 1.2k tokens");
    expect(turnSummary({ ...base, cachePct: 82 })).toBe("✓ 5 tools · 41s · 1.2k tokens · cache 82%");
    expect(turnSummary({ ...base, turn: 3, cachePct: 82 })).toBe(
      "turn 3 · ✓ 5 tools · 41s · 1.2k tokens · cache 82%",
    );
    // A cache the model never reported is not invented as 0%.
    expect(turnSummary({ ...base, cachePct: 0 })).not.toContain("cache");
    // A cancelled turn is not a receipt with a turn number on it.
    expect(turnSummary({ ...base, cancelled: true, turn: 3, cachePct: 82 })).toBe("· cancelled after 41s");
  });

  test("a turn too fast to measure prints no stopwatch at all (T55 P1b)", async () => {
    const { turnSummary } = await import("../src/ui/tool-group.js");
    const fast = { tools: 0, wallSec: 0.03, outputTokens: 12, cancelled: false };
    // The defect shape: `✓ 0s · 12 tokens` is a stopwatch on nothing.
    expect(turnSummary(fast)).not.toContain("0s");
    expect(turnSummary(fast)).toContain("12 tokens");
  });

  test("the receipt is structured, so the numbers are readable and the labels recede (T55)", async () => {
    const { turnReceipt, turnSummary } = await import("../src/ui/tool-group.js");
    const base = { tools: 5, wallSec: 41, outputTokens: 1200, cancelled: false, turn: 3, cachePct: 82 };
    // Plain text is unchanged: the string contract other code and tests rely on.
    expect(turnSummary(base)).toBe("turn 3 · ✓ 5 tools · 41s · 1.2k tokens · cache 82%");

    const seg = turnReceipt(base);
    const roleOf = (needle: string): string | undefined =>
      seg.find((s) => s.text.includes(needle))?.role;
    // The numbers are the point of the line, so they get the readable ink.
    expect(roleOf("41")).toBe("value");
    expect(roleOf("1.2k")).toBe("value");
    expect(roleOf("82")).toBe("value");
    // The labels and the separators are chrome and recede.
    expect(roleOf("turn 3")).toBe("label");
    expect(roleOf(" tokens")).toBe("label");
    expect(roleOf(" cache ")).toBe("label");
    // Exactly one accent, and it is the mark.
    expect(seg.filter((s) => s.role === "ok" || s.role === "fail").map((s) => s.text)).toEqual(["✓"]);
    // Every character of the line is accounted for, so painting cannot drop any.
    expect(seg.map((s) => s.text).join("")).toBe(turnSummary(base));
  });

  test("a failed turn gets its receipt, in rose, and is never a silent omission (T55)", async () => {
    const { turnReceipt, turnSummary } = await import("../src/ui/tool-group.js");
    const failed = turnReceipt({ tools: 0, wallSec: 12, outputTokens: 340, cancelled: false, turn: 4, error: true });
    expect(failed.some((s) => s.role === "fail")).toBe(true);
    expect(failed.some((s) => s.role === "ok")).toBe(false);
    // A long minute reads as value + unit, so the "s" can recede on its own.
    const minute = turnReceipt({ tools: 0, wallSec: 65, outputTokens: 0, cancelled: false, turn: 1 });
    expect(minute.filter((s) => s.role === "value").map((s) => s.text).join("")).toContain("1m05");
    expect(minute.some((s) => s.text === "s" && s.role === "label")).toBe(true);
    expect(turnSummary({ tools: 0, wallSec: 12, outputTokens: 340, cancelled: false, turn: 4, error: true })).toBe(
      "turn 4 · ✗ 12s · 340 tokens",
    );
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
    expect(lines).toHaveLength(8);
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
    // D3: the footer's three rows are the place, the turn and the route — a session
    // with no turn yet says `no model` rather than a made-up reading.
    expect(text).toContain("no model");
    expect(text).toMatch(/~\/|\/home\/|ask/);
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

  test("a duration is only printed when it means something (T55 P1a)", async () => {
    const { formatDuration } = await import("../src/ui/tool-group.js");
    // The defect: every tool printed a stopwatch, so forty instant reads were
    // forty `0.0s`, and a twelve-second one was `12.0s`. Zero information.
    expect(formatDuration(0.04)).toBeUndefined();
    expect(formatDuration(0)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
    expect(formatDuration(0.4)).toBe("0.4s");
    expect(formatDuration(9.94)).toBe("9.9s");
    // Past ten seconds the decimal is noise too.
    expect(formatDuration(12)).toBe("12s");
    expect(formatDuration(65)).toBe("1m05s");
    expect(formatDuration(600)).toBe("10m00s");
  });

  test("an instant tool and a cancelled tool print no duration at all (T55 P1a)", () => {
    const instant = new ToolCallComponent("read", () => 0, UNICODE_ICONS);
    instant.setArgs('{"path":"note.txt"}');
    instant.result(true, "hello");
    const line = strip(instant.render(80)[0]!).trimEnd();
    expect(line).toContain("read");
    expect(line).toContain("note.txt");
    expect(line).not.toContain("s ");  // no "0.0s" tail

    // A cancelled call used to print `0.0s` next to the red mark.
    const cancelled = new ToolCallComponent("bash", () => 0, UNICODE_ICONS);
    cancelled.setArgs('{"command":"ls"}');
    cancelled.cancel();
    const stopped = cancelled.render(80).map(strip).join("\n");
    expect(stopped).toContain("Cancelled");
    expect(stopped).not.toContain("0.0s");
  });

  test("a slow tool keeps its duration, so the number still has somewhere to go (T55 P1a)", () => {
    let t = 0;
    const slow = new ToolCallComponent("bash", () => t, UNICODE_ICONS);
    slow.setArgs('{"command":"npm test"}');
    t = 4200;
    slow.result(true, "ok");
    const line = strip(slow.render(80).at(-1)!);
    expect(line).toContain("4.2s");
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

  test("a tool line keeps 2 cells of card after the duration (UI polish 2026-09-27)", () => {
    const { ui } = makeUi();
    let clock = 0;
    const slow = new ToolCallComponent("bash", () => clock, UNICODE_ICONS);
    slow.setArgs('{"command":"pnpm test"}');
    clock = 2200;
    slow.result(true, "ok");
    ui.addChat(slow);
    const line = ui.tui.render(100).map(strip).find((l) => l.includes("Took 2.2s"))!;
    // The card reaches the right margin, so a line that ends in a measurement used
    // to end on the card border with nothing after it. Two cells of card now follow
    // the number: the same margin the page has on the other side.
    expect(line.trimEnd().endsWith("Took 2.2s")).toBe(true);
    expect(visibleWidth(line)).toBe(98);
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

  test("the help line is readable, not decorative: 4.5:1 on a color terminal (T55 P0)", async () => {
    const { NUAGE, contrastRatio, fgCode, resetColorDepth } = await import("../src/ui/palette.js");
    const savedColor = process.env.KUMO_COLOR;
    process.env.KUMO_COLOR = "truecolor";
    resetColorDepth();
    try {
      const { ui } = makeUi();
      const line = ui.tui.render(80).find((l) => l.includes("escape interrupt"));
      expect(line).toBeDefined();
      // Resolve the role the line is actually painted in, not the one we hope:
      // it used to be `faint` here (2.64:1) while the plain terminal got `muted`.
      const role = (Object.keys(NUAGE) as Array<keyof typeof NUAGE>).find((r) =>
        line!.includes(fgCode(r, "truecolor")),
      );
      expect(role).toBe("muted");
      expect(contrastRatio(NUAGE[role!].hex, NUAGE.surface.hex)).toBeGreaterThanOrEqual(4.5);
    } finally {
      if (savedColor === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = savedColor;
      resetColorDepth();
    }
  });

  test("every turn is numbered on its own band, and the number moves on (T55 P1b)", async () => {
    const { userMessageComponent } = await import("../src/ui/assistant-text.js");
    const savedColor = process.env.KUMO_COLOR;
    process.env.KUMO_COLOR = "truecolor";
    const { resetColorDepth } = await import("../src/ui/palette.js");
    resetColorDepth();
    try {
      const { ui } = makeUi();
      expect(ui.turn).toBe(0);
      ui.addUserPrompt("first question");
      expect(ui.turn).toBe(1);
      ui.addUserPrompt("second question");
      expect(ui.turn).toBe(2);
      // The fake terminal is 60 columns, and the screen clips to it, so the
      // render has to ask for that width: a 100-column render is not a wider
      // band, it is a 100-column band clipped to 60.
      const text = ui.tui.render(60).map(strip);
      const first = text.findIndex((l) => l.includes("first question"));
      const second = text.findIndex((l) => l.includes("second question"));
      expect(first).toBeGreaterThan(0);
      expect(second).toBeGreaterThan(first);
      // The label sits on the band's own top line, one line above the prompt, so
      // it costs no extra row and is exactly where the eye already goes.
      expect(text[first - 1]).toContain("turn 1");
      expect(text[second - 1]).toContain("turn 2");
      // And it is right-aligned, inside the 2-column margin the page keeps
      // everywhere else: 2 cells of band after the number, never zero.
      expect(text[first - 1]!.trimEnd().endsWith("turn 1")).toBe(true);
      expect(text[first - 1]).toMatch(/turn 1 {2}$/);
      expect(text[second - 1]).toMatch(/turn 2 {2}$/);
      // The band still spans the full width: the margin is inside the tint.
      expect(visibleWidth(text[first - 1]!)).toBe(60);
    } finally {
      if (savedColor === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = savedColor;
      resetColorDepth();
    }
  });

  test("a prompt band with no number is still a plain band, never a fake turn 0 (T55 P1b)", async () => {
    const { ChatTranscript } = await import("../src/ui/chat-layout.js");
    const { userMessageComponent } = await import("../src/ui/assistant-text.js");
    const savedColor = process.env.KUMO_COLOR;
    process.env.KUMO_COLOR = "truecolor";
    const { resetColorDepth } = await import("../src/ui/palette.js");
    resetColorDepth();
    try {
      const t = new ChatTranscript();
      t.addChild(userMessageComponent("unstamped"));
      const text = t.render(60).map(strip);
      expect(text.join("\n")).not.toContain("turn");
    } finally {
      if (savedColor === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = savedColor;
      resetColorDepth();
    }
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
      // The bottom area is the terminal's own background; the painted surface left in
      // the transcript is the user's block.
      quiet.ui.addUserPrompt("ship it");
      expect(quiet.ui.tui.render(80).join("\n")).toContain(bgCode("userBlock", "truecolor"));

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
      live.ui.addUserPrompt("ship it");
      const probed = bgCode("userBlock", "truecolor");
      expect(probed).not.toBe("\x1b[48;2;21;42;54m");
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
      ui.addUserPrompt("ship it");
      const authored = bgCode("userBlock", "truecolor");
      expect(ui.tui.render(80).join("\n")).toContain(authored);
      // The editor and the status bar sit on the terminal's own background.
      expect(ui.tui.render(80).join("\n")).not.toContain(bgCode("surface", "truecolor"));

      // The query for the terminal's own background really goes out on the wire,
      // and a terminal that never answers simply keeps the authored surfaces.
      expect(await ui.probeBackdrop()).toBeUndefined();
      expect(terminal.writes.join("")).toContain("\x1b]11;?\x07");
      expect(ui.tui.render(80).join("\n")).toContain(authored);

      // Once a light background is known, every painted surface follows it.
      setTerminalBackdrop({ r: 255, g: 255, b: 255 });
      const probed = bgCode("userBlock", "truecolor");
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

  test("header shows model and host; condensation frames hold a fixed wordmark grid", async () => {
    const { ui } = makeUi();
    ui.footer.set({ model: "Ornith 1.5 9B", provider: "local", modelName: "Ornith 1.5 9B" });
    ui.updateHeader();
    const text = ui.tui.render(80).map(strip).join("\n");
    expect(text).toContain("kumo");
    expect(text).toContain("Ornith 1.5 9B");
    expect(strip(ui.headerFirstLine(false))).not.toContain("kumo");
    const { headerHost } = await import("../src/ui/kumo-ui.js");
    const { LOGO, ignitionFrame, litCells, terminalMotionAllowed } = await import("../src/ui/logo-motion.js");
    const frames = Array.from({ length: 8 }, (_, step) => ignitionFrame(step / 7));
    expect(frames.every((frame) => frame.length === 2 && frame.every((line) => [...line].length === LOGO[0].length))).toBe(true);
    expect(frames.flat().join("")).not.toMatch(/\p{Extended_Pictographic}/u);
    // The wordmark is legible from the first frame — light travels through it,
    // and the head stops short of the end while the session is still unknown.
    expect(litCells(0)).toBeGreaterThan(0);
    expect(litCells(1)).toBeLessThan(LOGO[0].length);
    expect(frames[0]!.join("")).not.toEqual(frames.at(-1)!.join(""));
    expect(terminalMotionAllowed({ stdoutTTY: false })).toBe(false);
    expect(terminalMotionAllowed({ stdoutTTY: true, env: { CI: "1" } })).toBe(false);
    expect(terminalMotionAllowed({ stdoutTTY: true, env: { KUMO_NO_ANIMATION: "1" } })).toBe(false);
    expect(terminalMotionAllowed({ stdoutTTY: true, env: {}, ascii: false })).toBe(true);
    expect(headerHost({ models: { main: { baseUrl: "http://192.168.1.64:8081/v1" } } }, "local")).toBe("192.168.1.64");
    expect(headerHost({ models: { main: { provider: "openrouter" } } }, undefined)).toBe("openrouter");
  });

  test("color header uses the finished wordmark and sweeps only on the first working turn", async () => {
    vi.useFakeTimers();
    const saved = { tty: process.stdout.isTTY, color: process.env.KUMO_COLOR, ci: process.env.CI, anim: process.env.KUMO_NO_ANIMATION, term: process.env.TERM };
    process.stdout.isTTY = true;
    process.env.KUMO_COLOR = "truecolor";
    delete process.env.CI;
    delete process.env.KUMO_NO_ANIMATION;
    process.env.TERM = "xterm-256color";
    const { resetColorDepth } = await import("../src/ui/palette.js");
    const { wordmarkFrame } = await import("../src/ui/logo-motion.js");
    const { WorkingComponent } = await import("../src/ui/working.js");
    resetColorDepth();
    const ui = new KumoUi("0.2.0", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, new FakeTerminal(), UNICODE_ICONS);
    try {
      const final = wordmarkFrame(1);
      expect(strip(ui.headerText())).toContain(final[0]);
      expect(strip(ui.headerText())).toContain(final[1]);
      const initial = ui.headerText();
      ui.addChat(new WorkingComponent(() => Date.now(), ui.icons));
      vi.advanceTimersByTime(200);
      const midway = ui.headerText();
      expect(midway).not.toBe(initial);
      vi.advanceTimersByTime(500);
      const settled = ui.headerText();
      expect(settled).toBe(initial);
      ui.addChat(new WorkingComponent(() => Date.now(), ui.icons));
      vi.advanceTimersByTime(500);
      expect(ui.headerText()).toBe(settled);
    } finally {
      await ui.shutdown();
      process.stdout.isTTY = saved.tty;
      if (saved.color === undefined) delete process.env.KUMO_COLOR;
      else process.env.KUMO_COLOR = saved.color;
      if (saved.ci === undefined) delete process.env.CI;
      else process.env.CI = saved.ci;
      if (saved.anim === undefined) delete process.env.KUMO_NO_ANIMATION;
      else process.env.KUMO_NO_ANIMATION = saved.anim;
      if (saved.term === undefined) delete process.env.TERM;
      else process.env.TERM = saved.term;
      resetColorDepth();
      vi.useRealTimers();
    }
  });

  test("the interactive screen opens on the finished header without replaying boot motion", async () => {
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
      expect(ui.fancyHeader).toBe(false);
      ui.start();
      await new Promise((r) => setTimeout(r, 100));
      expect(phases.every((frame) => !frame.includes("░"))).toBe(true);
      const after = phases.length;
      await new Promise((r) => setTimeout(r, 200));
      expect(phases.length).toBe(after);
    } finally {
      await ui.shutdown();
      process.stdout.isTTY = saved.tty;
      if (saved.anim === undefined) delete process.env.KUMO_NO_ANIMATION;
      else process.env.KUMO_NO_ANIMATION = saved.anim;
    }
  });

  test("CI leaves the finished header still", async () => {
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
    expect(text).toContain("+2 more");
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
    expect(ui.tui.render(100).map(strip).join("\n")).toContain("+2 more");
    terminal.onInput?.("\x0f");
    const expanded = ui.tui.render(100).map(strip).join("\n");
    expect(expanded).not.toContain("+2 more");
    expect(expanded.match(/read/g)?.length).toBeGreaterThanOrEqual(4);
    terminal.onInput?.("\x0f");
    expect(ui.tui.render(100).map(strip).join("\n")).toContain("+2 more");
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
    addUserPrompt(text: string): void;
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
      addUserPrompt: (text) => ui.addChat(userMessageComponent(text)),
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

  test("contextUsed climbs during a turn, not only when it ends (T55)", () => {
    const { chats, ui, stream, event } = setup();
    const session = { id: "s", requestContext: () => ({ contextWindow: 100_000 }) };
    void session;
    event("turn/start", { turn: 1 });
    // A server that streams usage tells us the running total as it goes. That is
    // the only honest way to watch the context climb: never from a guess.
    stream({ type: "usage", usage: { inputTokens: 40_000, outputTokens: 0 } });
    expect(ui.footerState.contextUsed).toBe(40_000);
    stream({ type: "usage", usage: { inputTokens: 40_000, outputTokens: 1_200 } });
    expect(ui.footerState.contextUsed).toBe(41_200);
    stream({ type: "usage", usage: { inputTokens: 40_000, outputTokens: 5_500 } });
    expect(ui.footerState.contextUsed).toBe(45_500);
    // Still no turn/end: the number moved because the server said so.
    expect(ui.footerState.contextWindow).toBe(100_000);
    void chats;
  });

  test("the row reads the request's own usage: ↑ prompt, ↓ answer, R cache (D3)", () => {
    const { ui, stream } = setup();
    stream({
      type: "usage",
      usage: { inputTokens: 1_500, outputTokens: 320, cacheReadTokens: 34_000 },
    });
    expect(ui.footerState).toMatchObject({ inputTokens: 1_500, outputTokens: 320, cacheRead: 34_000 });
    // A later chunk replaces the reading rather than adding to it: the row says
    // what the last request cost, not what the session has cost so far.
    stream({
      type: "usage",
      usage: { inputTokens: 1_900, outputTokens: 750, cacheReadTokens: 34_000 },
    });
    expect(ui.footerState).toMatchObject({ inputTokens: 1_900, outputTokens: 750, cacheRead: 34_000 });
  });

  test("a usage chunk that says nothing is not read as a zero (D3)", () => {
    const { ui, stream } = setup();
    stream({ type: "usage", usage: { inputTokens: 900, outputTokens: 12, cacheReadTokens: 4000 } });
    // The server stopped counting. The last reading it gave stays on the row,
    // because printing `↓0` because a field was missing is a lie about the turn.
    stream({ type: "usage", usage: {} });
    expect(ui.footerState).toMatchObject({ inputTokens: 900, outputTokens: 12, cacheRead: 4000 });
    // A zero the server really sent is published: it is a reading, not a gap.
    stream({ type: "usage", usage: { outputTokens: 0 } });
    expect(ui.footerState.outputTokens).toBe(0);
  });

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
    expect(rendered(chats[0])).toMatch(/Waiting for model/);
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

  test("Other opens the custom answer in the question popup", async () => {
    const terminal = new FakeTerminal();
    const ui = new KumoUi("test", { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} }, terminal, UNICODE_ICONS);
    await ui.start();
    const answers = ui.askQuestions([
      { id: "q1", question: "Quelle base ?", options: [{ label: "SQLite" }, { label: "Redis" }] },
    ]);
    terminal.onInput?.("\x1b[B");
    terminal.onInput?.("\x1b[B");
    terminal.onInput?.("\r");
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

  test("the cursor's inverse video is closed before the suggestion (real bug: white line)", async () => {
    // Aron's real terminal, 2026-09-26: the suggestion line turned white and the white
    // spilled into the cockpit. Slicing the editor line at the cursor kept the cursor's
    // "\x1b[7m" (inverse) and dropped its closing code, so everything after stayed inverse.
    const { ui } = await started();
    ui.editor.setGhost("run the tests");
    for (const width of [60, 90]) {
      const row = ui.editor.render(width)[1]!;
      const ghostAt = row.indexOf("run the tests");
      expect(ghostAt).toBeGreaterThan(0);
      const before = row.slice(0, ghostAt);
      const open = before.lastIndexOf("\x1b[7m");
      if (open !== -1) {
        const after = before.slice(open);
        expect(/\x1b\[(27|0)?m/.test(after.slice(4)), JSON.stringify(before)).toBe(true);
      }
      // And nothing after the suggestion is inverse either.
      expect(row.slice(ghostAt)).not.toContain("\x1b[7m");
    }
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
      addUserPrompt: () => {},
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
    const ui = { icons: UNICODE_ICONS, addChat: (c: any) => chats.push(c), addUserPrompt: (t: string) => chats.push(userMessageComponent(t)), setTasks: (items: unknown) => lists.push(items), requestRender: () => {}, footer: { set: () => {} } };
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

describe("server label (UI polish 2026-09-26)", () => {
  test("LAN and localhost keep the address, cloud APIs show the provider name", async () => {
    const { serverLabel } = await import("../src/ui/kumo-ui.js");
    expect(serverLabel("192.168.1.64", "Ornith (home)")).toBe("192.168.1.64");
    expect(serverLabel("localhost")).toBe("localhost");
    expect(serverLabel("100.101.5.2")).toBe("100.101.5.2");
    expect(serverLabel("token-plan.ap-southeast-1.maas.aliyuncs.com", "Alibaba Cloud (Qwen)")).toBe("Alibaba Cloud (Qwen)");
    expect(serverLabel("openrouter.ai")).toBe("openrouter.ai");
    expect(serverLabel("api.deepseek.com")).toBe("deepseek.com");
  });
});

describe("file change diff (UI polish 2026-09-26)", () => {
  test("edit shows removed and added lines with the counter, write shows added lines", async () => {
    const { diffForCall, renderDiff, diffCounter } = await import("../src/ui/diff-view.js");
    const d = diffForCall("edit", JSON.stringify({ path: "/nonexistent/x.ts", old_string: "a\nb\n", new_string: "a\nc\nd\n" }))!;
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    const lines = renderDiff(d, 40).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(lines.some((l) => l.includes("-b"))).toBe(true);
    expect(lines.some((l) => l.includes("+c"))).toBe(true);
    expect(diffCounter(d).replace(/\x1b\[[0-9;]*m/g, "")).toBe("+2 -1");
    const w = diffForCall("write", JSON.stringify({ path: "n.ts", content: "x\ny\n" }))!;
    expect(w.added).toBe(2);
    expect(renderDiff(w, 40).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""))[0]).toMatch(/^\s*1 │\+x/);
  });
  test("a long diff is capped at 12 lines with a count of the rest", async () => {
    const { diffForCall, renderDiff } = await import("../src/ui/diff-view.js");
    const content = Array.from({ length: 30 }, (_, i) => `line ${String(i)}`).join("\n");
    const out = renderDiff(diffForCall("write", JSON.stringify({ path: "big.ts", content }))!, 60);
    expect(out).toHaveLength(13);
    expect(out.at(-1)!.replace(/\x1b\[[0-9;]*m/g, "")).toContain("18 more lines");
  });
});

describe("code fences (UI polish 2026-09-26)", () => {
  test("typescript is highlighted, unknown languages stay plain, lines are kept", async () => {
    const { highlightCode } = await import("../src/ui/highlight.js");
    const out = highlightCode("export function f() {\n  return 1;\n}", "ts");
    expect(out).toHaveLength(3);
    expect(out.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""))).toEqual(["export function f() {", "  return 1;", "}"]);
    expect(out[0]).toContain("\x1b[");
    expect(highlightCode("hello", "klingon")).toEqual(["hello"]);
  });
});

describe("diff alignment (UI polish 2026-09-26)", () => {
  test("appending after a closing brace reads as added lines after it", async () => {
    const { diffForCall } = await import("../src/ui/diff-view.js");
    const d = diffForCall("edit", JSON.stringify({ path: "/nonexistent", old_string: "}", new_string: "}\n\nexport function b() {\n}" }))!;
    expect(d.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(["ctx:}", "add:", "add:export function b() {", "add:}"]);
  });
});
