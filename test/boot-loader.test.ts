import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { awaitBootHandoff, BootLoader } from "../src/ui/boot-loader.js";
import { WorkingComponent } from "../src/ui/working.js";

afterEach(() => vi.useRealTimers());

describe("boot loader handoff", () => {
  test("fast startup paints nothing and the child can take the terminal", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const boot = new BootLoader({ isTTY: true, columns: 80, rows: 24, write: (text) => writes.push(text) }, {});
    boot.start();
    boot.processSpawned();
    vi.advanceTimersByTime(249);
    boot.stop();
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual([]);
  });

  test("slow startup draws synchronized deltas, then clears the folded two-row mark", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const boot = new BootLoader({ isTTY: true, columns: 100, rows: 24, write: (text) => writes.push(text) }, {});
    boot.start();
    boot.processSpawned();
    vi.advanceTimersByTime(250);
    expect(writes[0]).toContain("starting the session");
    expect(writes[0]).toContain("\x1b[?2026h");
    expect(writes[0]).toContain("\x1b[?2026l");
    expect(writes[0]).toContain("\x1b[?25l");
    vi.advanceTimersByTime(700);
    expect(writes.length).toBeLessThanOrEqual(32);
    expect(writes.some((write) => write.includes("\x1b[3A"))).toBe(true);
    const beforeStop = writes.length;
    boot.stop();
    expect(writes.at(-1)).toContain("\x1b[1A");
    expect(writes.at(-1)).toContain("\x1b[?25h");
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(beforeStop + 1);
  });

  test("motion opt-out keeps a single readable status", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const boot = new BootLoader({ isTTY: true, columns: 80, rows: 24, write: (text) => writes.push(text) }, { KUMO_NO_ANIMATION: "1" });
    boot.start();
    boot.processSpawned();
    vi.advanceTimersByTime(2000);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("starting the session");
    expect(writes[0]).not.toContain("\n");
    expect(writes[0]).not.toContain("\x1b[?2026h");
    boot.stop();
  });

  test.each([{ CI: "1" }, { TERM: "dumb" }, { KUMO_ASCII: "1" }])(
    "disabled motion with %j uses one compact write",
    (env) => {
      vi.useFakeTimers();
      const writes: string[] = [];
      const boot = new BootLoader({ isTTY: true, columns: 80, rows: 24, write: (text) => writes.push(text) }, env);
      boot.start();
      boot.processSpawned();
      vi.advanceTimersByTime(2000);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toBe("kumo  starting the session");
      boot.stop();
    },
  );

  test("a key finishes the mark and stops the loop", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const boot = new BootLoader({ isTTY: true, columns: 80, rows: 24, write: (text) => writes.push(text) }, {});
    boot.start();
    boot.processSpawned();
    vi.advanceTimersByTime(280);
    boot.skip();
    const count = writes.length;
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(count);
    boot.stop();
  });

  test("resize to forty columns clears the scene and lands on one line", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const output = { isTTY: true, columns: 100, rows: 24, write: (text: string) => writes.push(text) };
    const boot = new BootLoader(output, {});
    boot.start();
    boot.processSpawned();
    vi.advanceTimersByTime(280);
    output.columns = 40;
    process.emit("SIGWINCH");
    vi.advanceTimersByTime(33);
    expect(writes.at(-1)).toContain("\x1b[3A");
    expect(writes.at(-1)).toContain("kumo");
    boot.stop();
  });

  test("unchanged resize writes nothing and short terminals keep two rows", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const boot = new BootLoader({ isTTY: true, columns: 80, rows: 7, write: (text) => writes.push(text) }, {});
    boot.start();
    boot.processSpawned();
    vi.advanceTimersByTime(250);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("\r\n");
    expect(writes[0]!.split("\r\n")).toHaveLength(2);
    process.emit("SIGWINCH");
    expect(writes).toHaveLength(1);
    boot.stop();
  });

  test("status is shown only after the corresponding observed event", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const boot = new BootLoader({ isTTY: true, columns: 100, rows: 24, write: (text) => writes.push(text) }, {});
    boot.start();
    vi.advanceTimersByTime(250);
    expect(writes.join("")).not.toContain("starting the session");
    boot.processSpawned();
    expect(writes.at(-1)).toContain("starting the session");
    boot.processReady();
    expect(writes.at(-1)).not.toContain("starting the session");
    boot.stop();
  });

  test("child waits for the launcher to clear its drawing", async () => {
    const bus = new EventEmitter() as EventEmitter & { send(message: unknown): void };
    const sent: unknown[] = [];
    bus.send = (message) => { sent.push(message); };
    const pending = awaitBootHandoff({ KUMO_BOOT_IPC: "1" }, bus as never);
    expect(sent).toEqual([{ type: "kumo:ui-ready" }]);
    bus.emit("message", { type: "kumo:boot-cleared" });
    await pending;
    expect(bus.listenerCount("message")).toBe(0);
  });

  test("child reports a route only when settings name a model and host", async () => {
    const home = mkdtempSync(join(tmpdir(), "kumo-boot-route-"));
    writeFileSync(join(home, "settings.yaml"), [
      "agent-default-model:",
      "  provider: local",
      "  model: model.gguf",
      "llm-pi-ai:",
      "  providers:",
      "    local:",
      "      baseURL: http://127.0.0.1:8080/v1",
      "      models:",
      "        - id: model.gguf",
      "          name: Model",
      "",
    ].join("\n"));
    const bus = new EventEmitter() as EventEmitter & { send(message: unknown): void };
    const sent: unknown[] = [];
    bus.send = (message) => { sent.push(message); };
    try {
      const pending = awaitBootHandoff({ KUMO_BOOT_IPC: "1", DSH_HOME: home }, bus as never);
      expect(sent).toEqual([{ type: "kumo:ui-ready", route: { model: "Model", host: "127.0.0.1" } }]);
      bus.emit("message", { type: "kumo:boot-cleared" });
      await pending;
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("response waiting uses the same small motif and has a still fallback", () => {
  const prior = process.env.KUMO_NO_ANIMATION;
  process.env.KUMO_NO_ANIMATION = "1";
  try {
    const waiting = new WorkingComponent(() => 0);
    expect(waiting.active).toBe(false);
    expect(waiting.render(80)[0]).toContain("Waiting for model");
    expect(waiting.render(80)[0]).toContain("Esc cancels");
  } finally {
    if (prior === undefined) delete process.env.KUMO_NO_ANIMATION;
    else process.env.KUMO_NO_ANIMATION = prior;
  }
});
