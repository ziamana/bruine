import { afterEach, expect, test, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TpsMeter } from "../src/ui/tps.js";
import { FooterComponent } from "../src/ui/footer.js";
import { attachTui } from "../src/plugins/render.js";
import { UNICODE_ICONS } from "../src/render/chars.js";
import { fakeCtx, strip } from "./fakes.js";
const saved = { ...process.env };
const tty = process.stdout.isTTY;
afterEach(() => { process.env = { ...saved }; process.stdout.isTTY = tty; vi.useRealTimers(); });
const text = (footer: FooterComponent, width = 100) => footer.render(width).map(strip).join("\n");

function motion() {
  vi.useFakeTimers(); vi.setSystemTime(0); process.stdout.isTTY = true;
  delete process.env.CI; delete process.env.BRUINE_ASCII; delete process.env.BRUINE_NO_ANIMATION;
  process.env.TERM = "xterm-256color";
}

test("live estimates respond to text volume, never the number of chunks", () => {
  const one = new TpsMeter(); const split = new TpsMeter();
  for (const meter of [one, split]) { meter.startCall(0); meter.delta(1000, "abcd"); }
  one.delta(2000, "x".repeat(32));
  for (let i = 1; i <= 4; i++) split.delta(1000 + i * 250, "x".repeat(8));
  expect(one.estimatedTps).toBe(8); expect(split.estimatedTps).toBe(8);
  expect(one.measuredTps).toBe(0);
  one.delta(3000, "x".repeat(8)); expect(one.estimatedTps).toBe(5);
  one.startCall(10000); expect(one.estimatedTps).toBe(0);
});

test("an initial buffered payload does not create an enormous live rate", () => {
  const meter = new TpsMeter(); meter.startCall(0);
  meter.delta(1000, "x".repeat(20000)); meter.delta(1001, "abcd");
  expect(meter.estimatedTps).toBe(0);
  meter.delta(1250, "abcd"); expect(meter.estimatedTps).toBe(8);
});

test("prefill is held during the answer and animates on completion without changing the measurement", () => {
  motion();
  const footer = new FooterComponent(UNICODE_ICONS, { cwd: "/tmp" });
  footer.beginTurn(); footer.set({ pp: 1200, tps: 8, tpsEstimated: true, subagents: 1 });
  expect(text(footer)).toContain("~8.0 tok/s"); expect(text(footer)).not.toContain("prefill");
  footer.endTurn(); expect(footer.active).toBe(true);
  vi.advanceTimersByTime(325);
  expect(text(footer)).toContain("prefill 1.1k tok/s"); expect(footer.state.pp).toBe(1200);
  for (const width of [100, 60, 30]) for (const row of footer.render(width)) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
  vi.advanceTimersByTime(325);
  expect(text(footer)).toContain("prefill 1.2k tok/s"); expect(footer.active).toBe(false);
  footer.beginTurn(); expect(text(footer)).not.toContain("prefill");
});

test("prefill finishes immediately with reduced motion", () => {
  motion(); process.env.BRUINE_NO_ANIMATION = "1";
  const footer = new FooterComponent(UNICODE_ICONS, { cwd: "/tmp" });
  footer.beginTurn(); footer.set({ pp: 1200 }); footer.endTurn();
  expect(text(footer)).toContain("prefill 1.2k tok/s"); expect(footer.active).toBe(false);
});

test("streamed text updates approximate TPS before usage; final usage replaces it and prefill waits for turn end", () => {
  motion();
  const fake = fakeCtx(); const footer = new FooterComponent(UNICODE_ICONS, { cwd: "/tmp" });
  const ui = { footer, icons: UNICODE_ICONS, requestRender() {}, addChat() {},
    showWorking() { footer.beginTurn(); }, onTurnEnd() { footer.endTurn(); } };
  const agent = { session: { id: "live-rate" } };
  const detach = attachTui(fake.ctx, agent, ui as never, {});
  const frame = (time: number, chunk: unknown) => fake.emit("agent/assistant-stream", { agent, frame: { type: "chunk", time, chunk } });
  try {
    fake.emit("agent/assistant-stream", { agent, frame: { type: "start", time: 0 } });
    frame(1000, { type: "text-delta", text: "abcd" });
    frame(2000, { type: "text-delta", text: "x".repeat(32) });
    expect(text(footer)).toContain("~8.0 tok/s");
    frame(3000, { type: "reasoning-delta", text: "x".repeat(8) });
    expect(text(footer)).toContain("~5.0 tok/s");
    frame(3100, { type: "usage", usage: { outputTokens: 60, inputTokens: 1200 } });
    expect(text(footer)).toContain("30.0 tok/s"); expect(footer.state.tpsEstimated).toBe(false);
    expect(text(footer)).not.toContain("prefill");
    frame(3200, { type: "finish" });
    fake.emit("session/event", agent.session, { type: "turn/end", data: {} });
    expect(footer.active).toBe(true);
    vi.advanceTimersByTime(650); expect(text(footer)).toContain("prefill 1.2k tok/s");
  } finally { detach(); }
});
