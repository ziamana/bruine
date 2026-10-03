import { appEnv } from "../compat.js";
/**
 * T62 — herdr integration: bruine reports its state.
 *
 * Inside a herdr pane (`HERDR_ENV=1`, `HERDR_SOCKET_PATH` and `HERDR_PANE_ID`
 * all set) this plugin reports `idle` / `working` / `blocked` so `herdr agent
 * list`, `herdr agent wait` and notifications work with bruine like with
 * OpenCode or Claude Code. Outside herdr (any variable missing, or a
 * headless `bruine -p` run) it registers nothing and opens nothing.
 *
 * Rules (from the ticket): fire and forget, requests chained so they arrive
 * in order, 500 ms timeout per request, every error swallowed silently.
 * Nothing is ever printed. `node:net` only, Unix socket on Linux/macOS and
 * `\\.\pipe\…` on Windows.
 */
import net from "node:net";
import type { DshContext } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "bruine-herdr";

/** The states herdr knows. `unknown` is herdr-side only, never sent. */
export type HerdrState = "idle" | "working" | "blocked";

/** One request must never hold the loop longer than this. */
export const REQUEST_TIMEOUT_MS = 500;

export interface HerdrEnv {
  socketPath: string;
  paneId: string;
}

/**
 * The three variables herdr sets in every pane it manages. Undefined unless
 * all three are present (zero cost outside herdr).
 */
export function readHerdrEnv(env: NodeJS.ProcessEnv = process.env): HerdrEnv | undefined {
  try {
    if (env.HERDR_ENV !== "1") return undefined;
    const socketPath = env.HERDR_SOCKET_PATH;
    const paneId = env.HERDR_PANE_ID;
    if (socketPath === undefined || socketPath === "" || paneId === undefined || paneId === "") {
      return undefined;
    }
    return { socketPath, paneId };
  } catch {
    return undefined;
  }
}

/**
 * Where one request connects. Same rule as herdr's own OpenCode plugin: a
 * bare value is a Unix socket path, on Windows it is a named pipe.
 */
export function endpointFor(socketPath: string, platform: string = process.platform): string {
  return platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;
}

/** Send one JSON line, resolve with the reply line. Injectable for tests. */
export type HerdrConnect = (endpoint: string, line: string) => Promise<string>;

/** One connection, one JSON line out, one JSON line back, then close. */
export function netConnect(
  endpoint: string,
  line: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let socket: net.Socket;
    try {
      socket = net.createConnection({ path: endpoint });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // silent by rule
      }
      reject(new Error("herdr: request timed out"));
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    let buf = "";
    socket.on("connect", () => {
      try {
        socket.write(`${line}\n`);
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const reply = buf.slice(0, nl);
        finish(() => {
          try {
            socket.destroy();
          } catch {
            // silent by rule
          }
          resolve(reply);
        });
      }
    });
    socket.on("error", (err) => {
      finish(() => {
        try {
          socket.destroy();
        } catch {
          // silent by rule
        }
        reject(err);
      });
    });
    socket.on("close", () => {
      finish(() => reject(new Error("herdr: connection closed")));
    });
  });
}

function randomSuffix(): string {
  try {
    const s = Math.random().toString(36).slice(2, 10);
    return s === "" ? "0" : s;
  } catch {
    return "0";
  }
}

export interface HerdrReporterOptions {
  paneId: string;
  endpoint: string;
  /** Live reader for the current dsh session id (follows /new). */
  sessionId: () => string | undefined;
  connect?: HerdrConnect;
  timeoutMs?: number;
}

/**
 * The reporter: `reportState` / `reportSession` / `release` over an
 * injectable `connect`. All sends are fire and forget, chained so they
 * arrive in order; `seq` starts at `Date.now() * 1000` and strictly
 * increases. Nothing ever throws, nothing is ever printed.
 */
export class HerdrReporter {
  readonly paneId: string;
  readonly endpoint: string;
  #sessionId: () => string | undefined;
  #connect: HerdrConnect;
  #timeoutMs: number;
  #seq: number;
  #tail: Promise<void> = Promise.resolve();

  constructor(opts: HerdrReporterOptions) {
    this.paneId = opts.paneId;
    this.endpoint = opts.endpoint;
    this.#sessionId = opts.sessionId;
    this.#timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const timeoutMs = this.#timeoutMs;
    this.#connect = opts.connect ?? ((endpoint, line) => netConnect(endpoint, line, timeoutMs));
    this.#seq = Date.now() * 1000;
  }

  currentSession(): string | undefined {
    try {
      return this.#sessionId();
    } catch {
      return undefined;
    }
  }

  #enqueue(method: string, params: Record<string, unknown>): void {
    const seq = this.#seq;
    this.#seq += 1;
    let line: string;
    try {
      line = JSON.stringify({
        id: `bruine:${String(Date.now())}:${randomSuffix()}`,
        method,
        params: { ...params, seq },
      });
    } catch {
      return;
    }
    const endpoint = this.endpoint;
    const connect = this.#connect;
    const timeoutMs = this.#timeoutMs;
    this.#tail = this.#tail.then(() =>
      Promise.race([
        Promise.resolve()
          .then(() => connect(endpoint, line))
          .then(() => undefined),
        new Promise<void>((_resolve, reject) => {
          const t = setTimeout(() => reject(new Error("herdr: request timed out")), timeoutMs);
          if (typeof t.unref === "function") t.unref();
        }),
      ]).then(
        () => undefined,
        () => undefined,
      ),
    );
  }

  /** `pane.report_agent` with the current (or given) session id. */
  reportState(state: HerdrState, sessionId?: string): void {
    try {
      const sid = sessionId ?? this.currentSession();
      if (sid === undefined) return;
      this.#enqueue("pane.report_agent", {
        pane_id: this.paneId,
        source: "bruine",
        agent: "bruine",
        state,
        agent_session_id: sid,
      });
    } catch {
      // silent by rule
    }
  }

  /** `pane.report_agent_session` on /new (a new dsh session took over). */
  reportSession(sessionId: string): void {
    try {
      this.#enqueue("pane.report_agent_session", {
        pane_id: this.paneId,
        source: "bruine",
        agent: "bruine",
        agent_session_id: sessionId,
        session_start_source: "new",
      });
    } catch {
      // silent by rule
    }
  }

  /** `pane.release_agent` on exit. Fire and forget. */
  release(): void {
    try {
      this.#enqueue("pane.release_agent", {
        pane_id: this.paneId,
        source: "bruine",
        agent: "bruine",
      });
    } catch {
      // silent by rule
    }
  }

  /**
   * Enqueue a release after everything before it and wait for the queue,
   * never longer than the request timeout. Never throws. The exit path.
   */
  async close(): Promise<void> {
    this.release();
    try {
      await Promise.race([
        this.#tail,
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, this.#timeoutMs);
          if (typeof t.unref === "function") t.unref();
        }),
      ]);
    } catch {
      // silent by rule
    }
  }

  /** Settle the queue (tests). Never throws. */
  async settled(timeoutMs = 10000): Promise<void> {
    try {
      await Promise.race([
        this.#tail,
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, timeoutMs);
          if (typeof t.unref === "function") t.unref();
        }),
      ]);
    } catch {
      // silent by rule
    }
  }
}

export interface HerdrApplyOptions {
  /** Process-wide exit hooks. Disable in tests (they patch process.exit). */
  installExitHooks?: boolean;
  connect?: HerdrConnect;
}

function sessionIdOf(agent: unknown): string | undefined {
  try {
    const id = (agent as { session?: { id?: unknown } } | undefined)?.session?.id;
    return id === undefined || id === null ? undefined : String(id);
  } catch {
    return undefined;
  }
}

export function apply(ctx: DshContext, opts?: HerdrApplyOptions): () => void {
  const noop = (): void => {};
  let env: HerdrEnv | undefined;
  try {
    env = readHerdrEnv();
  } catch {
    return noop;
  }
  // Zero cost outside herdr, and never in a headless run (the patch also
  // disables this plugin when BRUINE_HEADLESS=1).
  if (env === undefined || appEnv("HEADLESS") === "1") return noop;

  const paneId = env.paneId;
  const endpoint = endpointFor(env.socketPath);
  let repl: { agent?: unknown } | undefined;
  const reporter = new HerdrReporter({
    paneId,
    endpoint,
    sessionId: () => (repl === undefined ? undefined : sessionIdOf(repl.agent)),
    ...(opts?.connect !== undefined ? { connect: opts.connect } : {}),
  });
  let lastSessionId: string | undefined;
  let disposed = false;
  const offs: Array<() => void> = [];

  const liveAgent = (): unknown => {
    try {
      return repl?.agent;
    } catch {
      return undefined;
    }
  };

  /** Our agent, or a subagent it owns (those waits need a human too). */
  const isOurs = (agent: unknown): boolean => {
    try {
      if (repl === undefined || agent === undefined) return false;
      if (agent === liveAgent()) return true;
      const modes = ctx.get("bruineModes") as { governs?(a: unknown): boolean } | undefined;
      if (modes !== undefined && typeof modes.governs === "function") {
        try {
          return modes.governs(agent) === true;
        } catch {
          return false;
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  const liveAgentSession = (): unknown => {
    try {
      return (liveAgent() as { session?: unknown } | undefined)?.session;
    } catch {
      return undefined;
    }
  };

  try {
    offs.push(
      ctx.on("session/event", (session: unknown, event: { type?: unknown; data?: any }) => {
        try {
          if (disposed || repl === undefined) return;
          if (session !== liveAgentSession()) return;
          const type = event?.type;
          if (type === "turn/start") {
            const sid = sessionIdOf(liveAgent());
            if (sid !== undefined) reporter.reportState("working", sid);
          } else if (type === "turn/end") {
            const sid = sessionIdOf(liveAgent());
            if (sid === undefined) return;
            reporter.reportState(event?.data?.reason?.kind === "error" ? "blocked" : "idle", sid);
          }
        } catch {
          // silent by rule
        }
      }),
    );
  } catch {
    // silent by rule
  }

  // Approval and question waits: blocked while the user is asked, working
  // once answered. Outermost middleware (this plugin mounts before
  // bruine-approval), so the select opening is inside next(). Never breaks
  // the chain: foreign agents delegate, errors propagate after reporting.
  const trackWait = (req: { agent?: unknown }, next: () => unknown): unknown => {
    let ours = false;
    try {
      ours = isOurs(req?.agent);
    } catch {
      ours = false;
    }
    if (!ours) return next();
    const opened = sessionIdOf(liveAgent());
    if (opened !== undefined) reporter.reportState("blocked", opened);
    let result: unknown;
    try {
      result = next();
    } catch (err) {
      const sid = sessionIdOf(liveAgent());
      if (sid !== undefined) reporter.reportState("working", sid);
      throw err;
    }
    if (result !== undefined && result !== null && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(
        (value) => {
          const sid = sessionIdOf(liveAgent());
          if (sid !== undefined) reporter.reportState("working", sid);
          return value;
        },
        (err) => {
          const sid = sessionIdOf(liveAgent());
          if (sid !== undefined) reporter.reportState("working", sid);
          throw err;
        },
      );
    }
    const sid = sessionIdOf(liveAgent());
    if (sid !== undefined) reporter.reportState("working", sid);
    return result;
  };
  try {
    offs.push(ctx.on("approval/request", trackWait));
  } catch {
    // silent by rule
  }
  try {
    offs.push(ctx.on("user-questions/request", trackWait));
  } catch {
    // silent by rule
  }

  try {
    ctx.inject(["bruineRepl"], (c: any) => {
      try {
        if (disposed) return;
        const service = c?.bruineRepl as { agent?: unknown } | undefined;
        if (service === undefined || service === null || service.agent === undefined) return;
        if (repl === service) return;
        repl = service;
        // REPL ready: idle with the session id.
        const sid = sessionIdOf(service.agent);
        lastSessionId = sid;
        if (sid !== undefined) reporter.reportState("idle", sid);
        // /new and /resume swap service.agent for a new session: the report
        // the ticket wants, without touching the REPL. Live reads keep
        // working even where this redefine is unavailable.
        try {
          let current: unknown = service.agent;
          Object.defineProperty(service, "agent", {
            configurable: true,
            enumerable: true,
            get: () => current,
            set: (next: unknown) => {
              current = next;
              try {
                if (disposed) return;
                const nid = sessionIdOf(next);
                if (nid === undefined || nid === lastSessionId) return;
                lastSessionId = nid;
                reporter.reportSession(nid);
                reporter.reportState("idle", nid);
              } catch {
                // silent by rule
              }
            },
          });
        } catch {
          // silent by rule
        }
      } catch {
        // silent by rule
      }
    });
  } catch {
    // silent by rule
  }

  let restoreExit: (() => void) | undefined;
  if (opts?.installExitHooks !== false) {
    try {
      const origExit = process.exit;
      let exiting = false;
      const patched = ((code?: number) => {
        if (disposed || exiting) return origExit(code);
        exiting = true;
        void reporter.close().finally(() => origExit(code));
      }) as never;
      process.exit = patched;
      const onBeforeExit = (): void => {
        if (!disposed) void reporter.close();
      };
      const resignal = (sig: NodeJS.Signals): void => {
        void reporter.close().finally(() => {
          try {
            process.removeListener("SIGTERM", onSigTerm);
            process.removeListener("SIGINT", onSigInt);
          } catch {
            // silent by rule
          }
          try {
            process.kill(process.pid, sig);
          } catch {
            // silent by rule
          }
        });
      };
      const onSigTerm = (): void => {
        if (!disposed) resignal("SIGTERM");
      };
      const onSigInt = (): void => {
        if (!disposed) resignal("SIGINT");
      };
      process.once("beforeExit", onBeforeExit);
      process.once("SIGTERM", onSigTerm);
      process.once("SIGINT", onSigInt);
      restoreExit = (): void => {
        try {
          if (process.exit === (patched as unknown)) process.exit = origExit;
        } catch {
          // silent by rule
        }
        try {
          process.removeListener("beforeExit", onBeforeExit);
        } catch {
          // silent by rule
        }
        try {
          process.removeListener("SIGTERM", onSigTerm);
        } catch {
          // silent by rule
        }
        try {
          process.removeListener("SIGINT", onSigInt);
        } catch {
          // silent by rule
        }
      };
    } catch {
      // silent by rule
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
    for (const off of offs) {
      try {
        off();
      } catch {
        // silent by rule
      }
    }
    try {
      restoreExit?.();
    } catch {
      // silent by rule
    }
    // Last word, fire and forget: the pane stops showing bruine.
    try {
      reporter.release();
    } catch {
      // silent by rule
    }
  };
}
