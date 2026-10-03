import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  apply,
  endpointFor,
  HerdrReporter,
  readHerdrEnv,
} from "../src/plugins/herdr.js";
import { fakeCtx, flushInjects } from "./fakes.js";

const ENV_KEYS = ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID", "BRUINE_HEADLESS"] as const;

let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

let pipeCounter = 0;
/** Temp socket (Unix) or named pipe (Windows) for one fake server. */
function socketPaths(): { envValue: string; listenPath: string; cleanup: () => void } {
  if (process.platform === "win32") {
    const name = `bruine-herdr-test-${String(process.pid)}-${String(pipeCounter++)}`;
    return { envValue: name, listenPath: `\\\\.\\pipe\\${name}`, cleanup: () => {} };
  }
  const dir = mkdtempSync(join(tmpdir(), "bruine-herdr-test-"));
  return {
    envValue: join(dir, "herdr.sock"),
    listenPath: join(dir, "herdr.sock"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

interface Recorded {
  raw: string;
  msg: any;
}

/** Fake herdr: records every JSON line, answers `{"result":{"type":"ok"}}`. */
class FakeHerdrServer {
  lines: Recorded[] = [];
  connections = 0;
  server = net.createServer((socket) => {
    this.connections++;
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(raw);
        } catch {
          msg = undefined;
        }
        this.lines.push({ raw, msg });
        if (!this.silent && msg !== undefined) {
          socket.write(`${JSON.stringify({ id: msg.id, result: { type: "ok" } })}\n`, () => socket.end());
        }
      }
    });
    socket.on("error", () => {});
  });

  constructor(private silent = false) {}

  listen(path: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(path, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  async waitFor(n: number, ms = 5000): Promise<void> {
    const start = Date.now();
    while (this.lines.length < n) {
      if (Date.now() - start > ms) {
        throw new Error(`timeout waiting for ${n} lines, got ${this.lines.length}`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setEnv(socketPath: string, paneId = "wG:p2"): void {
  process.env.HERDR_ENV = "1";
  process.env.HERDR_SOCKET_PATH = socketPath;
  process.env.HERDR_PANE_ID = paneId;
}

function makeService(sessionId: string): { agent: { session: { id: string } } } {
  return { agent: { session: { id: sessionId } } };
}

describe("readHerdrEnv / endpointFor", () => {
  test("needs all three variables", () => {
    expect(readHerdrEnv({})).toBeUndefined();
    expect(readHerdrEnv({ HERDR_ENV: "1" })).toBeUndefined();
    expect(readHerdrEnv({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/x" })).toBeUndefined();
    expect(readHerdrEnv({ HERDR_ENV: "1", HERDR_PANE_ID: "wG:p2" })).toBeUndefined();
    expect(readHerdrEnv({ HERDR_ENV: "0", HERDR_SOCKET_PATH: "/tmp/x", HERDR_PANE_ID: "wG:p2" })).toBeUndefined();
    expect(
      readHerdrEnv({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/x", HERDR_PANE_ID: "wG:p2" }),
    ).toEqual({ socketPath: "/tmp/x", paneId: "wG:p2" });
  });

  test("windows endpoint is a named pipe", () => {
    expect(endpointFor("herdr-123", "win32")).toBe("\\\\.\\pipe\\herdr-123");
    expect(endpointFor("/tmp/herdr.sock", "linux")).toBe("/tmp/herdr.sock");
    expect(endpointFor("/tmp/herdr.sock", "darwin")).toBe("/tmp/herdr.sock");
  });
});

describe("herdr plugin", () => {
  test("env missing (each variable in turn) → registers nothing, server receives nothing", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer();
    await server.listen(paths.listenPath);
    try {
      const cases: Array<Record<string, string>> = [
        { HERDR_SOCKET_PATH: paths.envValue, HERDR_PANE_ID: "wG:p2" },
        { HERDR_ENV: "1", HERDR_PANE_ID: "wG:p2" },
        { HERDR_ENV: "1", HERDR_SOCKET_PATH: paths.envValue },
      ];
      const exitBefore = process.exit;
      for (const vars of cases) {
        for (const [k, v] of Object.entries(vars)) process.env[k] = v;
        try {
          const fake = fakeCtx();
          const dispose = apply(fake.ctx as any, { installExitHooks: false });
          expect(fake.injected, JSON.stringify(vars)).toEqual([]);
          const service = makeService("sess-1");
          for (const { cb } of fake.injected) cb({ bruineRepl: service });
          fake.emit("session/event", service.agent.session, { type: "turn/start", data: {} });
          const p = fake.emit("approval/request", { agent: service.agent, toolName: "bash" }, async () => "allowed-once");
          await p;
          fake.emit("session/event", service.agent.session, { type: "turn/end", data: { reason: { kind: "completed" } } });
          dispose();
        } finally {
          delete process.env.HERDR_ENV;
          delete process.env.HERDR_SOCKET_PATH;
          delete process.env.HERDR_PANE_ID;
        }
      }
      await sleep(300);
      expect(server.lines).toEqual([]);
      expect(process.exit).toBe(exitBefore);
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("headless run registers nothing", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer();
    await server.listen(paths.listenPath);
    try {
      setEnv(paths.envValue);
      process.env.BRUINE_HEADLESS = "1";
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any, { installExitHooks: false });
      expect(fake.injected).toEqual([]);
      dispose();
      await sleep(200);
      expect(server.lines).toEqual([]);
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("scripted turn with one approval → idle, working, blocked, working, idle", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer();
    await server.listen(paths.listenPath);
    try {
      setEnv(paths.envValue, "wG:p2");
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any, { installExitHooks: false });
      const service = makeService("sess-1");
      flushInjects(fake, { bruineRepl: service });
      await server.waitFor(1);
      fake.emit("session/event", service.agent.session, { type: "turn/start", data: {} });
      await server.waitFor(2);
      const answered = fake.emit(
        "approval/request",
        { agent: (service as any).agent, toolName: "bash" },
        async () => "allowed-once",
      ) as Promise<string>;
      await server.waitFor(3);
      await expect(answered).resolves.toBe("allowed-once");
      await server.waitFor(4);
      fake.emit("session/event", (service as any).agent.session, {
        type: "turn/end",
        data: { reason: { kind: "completed" } },
      });
      await server.waitFor(5);
      await sleep(250);
      dispose();
      // The dispose release lands after; the turn itself is exactly 5.
      expect(server.lines.length).toBeGreaterThanOrEqual(5);
      const turn = server.lines.slice(0, 5);
      expect(turn.map((l) => l.msg.method)).toEqual([
        "pane.report_agent",
        "pane.report_agent",
        "pane.report_agent",
        "pane.report_agent",
        "pane.report_agent",
      ]);
      expect(turn.map((l) => l.msg.params.state)).toEqual(["idle", "working", "blocked", "working", "idle"]);
      for (const l of turn) {
        expect(l.msg.params.agent).toBe("bruine");
        expect(l.msg.params.source).toBe("bruine");
        expect(l.msg.params.pane_id).toBe("wG:p2");
        expect(l.msg.params.agent_session_id).toBe("sess-1");
        expect(l.msg.id).toMatch(/^bruine:\d+:[a-z0-9]+$/);
      }
      const seqs = turn.map((l) => l.msg.params.seq as number);
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
      // One request = one connection, one line each.
      expect(server.connections).toBeGreaterThanOrEqual(5);
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("user question waits → blocked, then working", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer();
    await server.listen(paths.listenPath);
    try {
      setEnv(paths.envValue);
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any, { installExitHooks: false });
      const service = makeService("sess-1");
      flushInjects(fake, { bruineRepl: service });
      await server.waitFor(1);
      const answered = fake.emit(
        "user-questions/request",
        { agent: (service as any).agent, questions: [] },
        async () => ({ answers: [] }),
      ) as Promise<unknown>;
      await server.waitFor(2);
      await answered;
      await server.waitFor(3);
      dispose();
      expect(server.lines.slice(0, 3).map((l) => l.msg.params.state)).toEqual(["idle", "blocked", "working"]);
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("error turn ends on blocked, aborted turn ends on idle", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer();
    await server.listen(paths.listenPath);
    try {
      setEnv(paths.envValue);
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any, { installExitHooks: false });
      const service = makeService("sess-1");
      flushInjects(fake, { bruineRepl: service });
      await server.waitFor(1);
      fake.emit("session/event", (service as any).agent.session, { type: "turn/start", data: {} });
      fake.emit("session/event", (service as any).agent.session, {
        type: "turn/end",
        data: { reason: { kind: "error", error: { message: "boom" } } },
      });
      await server.waitFor(3);
      fake.emit("session/event", (service as any).agent.session, { type: "turn/start", data: {} });
      fake.emit("session/event", (service as any).agent.session, {
        type: "turn/end",
        data: { reason: { kind: "aborted" } },
      });
      await server.waitFor(5);
      dispose();
      expect(server.lines.slice(0, 5).map((l) => l.msg.params.state)).toEqual([
        "idle",
        "working",
        "blocked",
        "working",
        "idle",
      ]);
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("/new → one report_agent_session with session_start_source new, then idle", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer();
    await server.listen(paths.listenPath);
    try {
      setEnv(paths.envValue);
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any, { installExitHooks: false });
      const service: any = makeService("sess-1");
      flushInjects(fake, { bruineRepl: service });
      await server.waitFor(1);
      service.agent = { session: { id: "sess-2" } };
      await server.waitFor(3);
      dispose();
      const first = server.lines.slice(0, 3).map((l) => l.msg);
      expect(first[0].method).toBe("pane.report_agent");
      expect(first[0].params.state).toBe("idle");
      expect(first[0].params.agent_session_id).toBe("sess-1");
      expect(first[1].method).toBe("pane.report_agent_session");
      expect(first[1].params.session_start_source).toBe("new");
      expect(first[1].params.agent_session_id).toBe("sess-2");
      expect(first[1].params.agent).toBe("bruine");
      expect(first[2].method).toBe("pane.report_agent");
      expect(first[2].params.state).toBe("idle");
      expect(first[2].params.agent_session_id).toBe("sess-2");
      const seqs = first.map((m) => m.params.seq as number);
      expect(seqs[1]).toBeGreaterThan(seqs[0]!);
      expect(seqs[2]).toBeGreaterThan(seqs[1]!);
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("foreign approval delegates to next() and reports nothing", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer();
    await server.listen(paths.listenPath);
    try {
      setEnv(paths.envValue);
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any, { installExitHooks: false });
      const service = makeService("sess-1");
      flushInjects(fake, { bruineRepl: service });
      await server.waitFor(1);
      let delegated = false;
      const outcome = (await fake.emit(
        "approval/request",
        { agent: { other: true }, toolName: "bash" },
        async () => {
          delegated = true;
          return "unavailable";
        },
      )) as string;
      expect(delegated).toBe(true);
      expect(outcome).toBe("unavailable");
      await sleep(250);
      dispose();
      // Only the ready idle plus the dispose release; no blocked/working.
      expect(server.lines.length).toBeLessThanOrEqual(2);
      expect(server.lines[0].msg.params.state).toBe("idle");
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("server down → no throw, nothing delayed", async () => {
    const paths = socketPaths();
    // No server listens: every connect is refused.
    setEnv(paths.envValue);
    const fake = fakeCtx();
    const dispose = apply(fake.ctx as any, { installExitHooks: false });
    const service = makeService("sess-1");
    const start = Date.now();
    flushInjects(fake, { bruineRepl: service });
    fake.emit("session/event", service.agent.session, { type: "turn/start", data: {} });
    const p = fake.emit("approval/request", { agent: service.agent, toolName: "bash" }, async () => "allowed-once");
    await p;
    fake.emit("session/event", service.agent.session, { type: "turn/end", data: { reason: { kind: "completed" } } });
    expect(Date.now() - start).toBeLessThan(500);
    dispose();
    paths.cleanup();
    // Direct reporter timing: close() is capped by the request timeout.
    const dead = socketPaths();
    const reporter = new HerdrReporter({
      paneId: "wG:p2",
      endpoint: endpointFor(dead.envValue),
      sessionId: () => "sess-1",
    });
    reporter.reportState("working");
    const t0 = Date.now();
    await reporter.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    dead.cleanup();
  });

  test("server that never answers → no throw, lines still arrive in order", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer(true);
    await server.listen(paths.listenPath);
    try {
      setEnv(paths.envValue);
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any, { installExitHooks: false });
      const service = makeService("sess-1");
      const start = Date.now();
      flushInjects(fake, { bruineRepl: service });
      fake.emit("session/event", service.agent.session, { type: "turn/start", data: {} });
      // The handlers are fire and forget: the turn is never held up.
      expect(Date.now() - start).toBeLessThan(500);
      // Even with no replies, chained requests each arrive (each after a timeout).
      await server.waitFor(2, 8000);
      dispose();
      await server.waitFor(3, 8000);
      expect(server.lines.slice(0, 3).map((l) => l.msg.method)).toEqual([
        "pane.report_agent",
        "pane.report_agent",
        "pane.release_agent",
      ]);
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("exit (dispose) → pane.release_agent is the last line", async () => {
    const paths = socketPaths();
    const server = new FakeHerdrServer();
    await server.listen(paths.listenPath);
    try {
      setEnv(paths.envValue);
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any, { installExitHooks: false });
      const service = makeService("sess-1");
      flushInjects(fake, { bruineRepl: service });
      await server.waitFor(1);
      fake.emit("session/event", (service as any).agent.session, { type: "turn/start", data: {} });
      fake.emit("session/event", (service as any).agent.session, {
        type: "turn/end",
        data: { reason: { kind: "completed" } },
      });
      await server.waitFor(3);
      dispose();
      await server.waitFor(4);
      const last = server.lines[server.lines.length - 1]!.msg;
      expect(last.method).toBe("pane.release_agent");
      expect(last.params.pane_id).toBe("wG:p2");
      expect(last.params.agent).toBe("bruine");
      expect(last.params.source).toBe("bruine");
      const seqs = server.lines.map((l) => l.msg.params.seq as number);
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
    } finally {
      await server.close();
      paths.cleanup();
    }
  });

  test("exit hooks patch process.exit only inside herdr and restore on dispose", () => {
    const paths = socketPaths();
    try {
      setEnv(paths.envValue);
      const exitBefore = process.exit;
      const fake = fakeCtx();
      const dispose = apply(fake.ctx as any);
      try {
        expect(process.exit).not.toBe(exitBefore);
      } finally {
        dispose();
      }
      expect(process.exit).toBe(exitBefore);
    } finally {
      paths.cleanup();
    }
  });
});
