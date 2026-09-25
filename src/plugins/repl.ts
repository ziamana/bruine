import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { kumoIcons } from "../render/chars.js";
import { KumoUi } from "../ui/kumo-ui.js";
import type { DshContext, KumoRepl, KumoStartup } from "./ctx.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/** Stable Cordis plugin name. */
export const name = "kumo-repl";

/** Core services required before the interactive loop can start. */
export const inject = ["agentDefaultModel", "agents", "sessions"];

/** The service provided by this plugin and injected by render/approval. */
export const KUMO_REPL_SERVICE = "kumoRepl";

const EXIT_COMMANDS = new Set(["/exit", "/quit"]);

/** The terminal line source the loop drives; readline in production, fakes in tests. */
export interface LineSource {
  onLine(cb: (line: string) => void): void;
  onClose(cb: () => void): void;
  onSigint(cb: () => void): void;
  pause(): void;
  resume(): void;
}

/** The agent surface the loop uses. */
export interface AgentLike {
  session: unknown;
  whenIdle(): Promise<void>;
  cancel(cause: { kind: "user" }): void;
}

export interface ReplDeps {
  agent: AgentLike;
  /** Send one user turn. */
  followup(text: string): void;
  /** Persist the session log; called after every turn and on quit. */
  flush(session: unknown): Promise<unknown>;
  appExit(code: number): void;
  lines: LineSource;
}

/**
 * The interactive loop: read a line, run one turn, redraw the prompt.
 * Pure orchestration over {@link ReplDeps} so it is testable without dsh.
 */
export class Repl {
  #deps: ReplDeps;
  #inTurn = false;
  #done = false;
  #turnPromise: Promise<void> | undefined;

  constructor(deps: ReplDeps) {
    this.#deps = deps;
  }

  async run(initialPrompt?: string): Promise<void> {
    this.#deps.lines.onLine((line) => {
      void this.#onLine(line);
    });
    this.#deps.lines.onClose(() => {
      void this.#quit();
    });
    this.#deps.lines.onSigint(() => this.#onSigint());

    if (initialPrompt !== undefined && initialPrompt.trim() !== "") {
      await this.#turn(initialPrompt);
    }
    if (!this.#done) this.#prompt();
  }

  async #onLine(line: string): Promise<void> {
    if (this.#inTurn || this.#done) return;
    const text = line.trim();
    if (EXIT_COMMANDS.has(text)) {
      await this.#quit();
      return;
    }
    if (text === "") {
      this.#prompt();
      return;
    }
    await this.#turn(text);
    if (!this.#done) this.#prompt();
  }

  #turn(text: string): Promise<void> {
    this.#inTurn = true;
    this.#deps.lines.pause();
    this.#turnPromise = (async () => {
      try {
        this.#deps.followup(text);
        await this.#deps.agent.whenIdle();
      } finally {
        this.#inTurn = false;
        await this.#flushQuietly();
      }
    })();
    return this.#turnPromise;
  }

  #onSigint(): void {
    // Escape / Ctrl+C during a turn cancels the turn, never the app.
    if (this.#inTurn) this.#deps.agent.cancel({ kind: "user" });
  }

  async #quit(): Promise<void> {
    if (this.#done) return;
    this.#done = true;
    // EOF (or /exit) during a turn: let the turn settle before exiting.
    if (this.#turnPromise !== undefined) await this.#turnPromise.catch(() => {});
    await this.#flushQuietly();
    this.#deps.appExit(0);
  }

  async #flushQuietly(): Promise<void> {
    try {
      await this.#deps.flush(this.#deps.agent.session);
    } catch {
      // A failed flush must not kill the loop.
    }
  }

  #prompt(): void {
    this.#deps.lines.resume();
  }
}

/** Fan-out hub feeding a {@link LineSource} from UI events. */
export class LineEmitter {
  #lines: Array<(line: string) => void> = [];
  #closes: Array<() => void> = [];
  #sigints: Array<() => void> = [];

  source(): LineSource {
    return {
      onLine: (cb) => this.#lines.push(cb),
      onClose: (cb) => this.#closes.push(cb),
      onSigint: (cb) => this.#sigints.push(cb),
      pause: () => {},
      resume: () => {},
    };
  }

  emitLine(line: string): void {
    for (const cb of this.#lines) cb(line);
  }
  emitClose(): void {
    for (const cb of this.#closes) cb();
  }
  emitSigint(): void {
    for (const cb of this.#sigints) cb();
  }
}

/** Wrap a node:readline interface as a {@link LineSource} (non-TTY mode). */
export function readlineSource(rl: ReadlineInterface): LineSource {
  rl.setPrompt(`${kumoIcons().prompt} `);
  return {
    onLine: (cb) => rl.on("line", cb),
    onClose: (cb) => rl.on("close", cb),
    onSigint: (cb) => rl.on("SIGINT", cb),
    pause: () => rl.pause(),
    resume: () => {
      rl.resume();
      rl.prompt();
    },
  };
}

/** Ask one question on the (paused) readline interface. */
export function askViaReadline(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.resume();
    rl.question(question, (answer) => {
      rl.pause();
      resolve(answer);
    });
  });
}

async function createAgent(ctx: DshContext): Promise<{ agent: any; selection: any } | undefined> {
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  if (agents === undefined || defaultModel === undefined) return undefined;
  const selection = defaultModel.currentSelection();
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx: unknown) => {
      // Block body on purpose: returning the disposer would be treated as a
      // setup commit object by the agent factory.
      installModelSelection(agentCtx as any, { current: selection, assembled: undefined });
    },
  });
  await agent.whenIdle();
  return { agent, selection };
}

async function runRepl(ctx: DshContext, exit: (code: number) => void): Promise<void> {
  await ctx.get("loader")?.await();
  const sessions = ctx.get("sessions");
  const startup: KumoStartup | undefined = ctx.get("kumoStartup");
  if (sessions === undefined) return;
  const created = await createAgent(ctx);
  if (created === undefined) return;
  const { agent, selection } = created;

  const followup = (text: string): void => {
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text }],
        source: { kind: "user" },
      }),
    );
  };
  const flush = (session: unknown): Promise<unknown> => sessions.flush(session);

  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;

  if (isTTY) {
    // pi-tui shell (T13a): header / chat / editor / footer.
    const emitter = new LineEmitter();
    let ui: KumoUi | undefined;
    ui = new KumoUi(
      pkg.version,
      {
        onSubmit: (text) => {
          if (text.trim() !== "" && ui !== undefined) ui.rememberHistory(text);
          emitter.emitLine(text);
        },
        onEscape: () => emitter.emitSigint(),
        onQuit: () => emitter.emitClose(),
      },
      undefined,
      kumoIcons(),
    );
    ui.footer.set({ model: selection.model, provider: selection.provider });
    const repl = new Repl({
      agent,
      followup,
      flush,
      appExit: (code) => {
        void ui?.shutdown().finally(() => exit(code));
      },
      lines: emitter.source(),
    });
    const service: KumoRepl = { agent, ui };
    ctx.provide(KUMO_REPL_SERVICE, service);
    ui.start();
    await repl.run(startup?.initialPrompt);
    return;
  }

  // Non-TTY (piped) mode: plain readline.
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  const service: KumoRepl = {
    agent,
    ask: (question) => askViaReadline(rl, question),
  };
  ctx.provide(KUMO_REPL_SERVICE, service);
  const repl = new Repl({
    agent,
    followup,
    flush,
    appExit: exit,
    lines: readlineSource(rl),
  });
  await repl.run(startup?.initialPrompt);
}

export function apply(ctx: DshContext): void {
  const exit = ctx.get("appExit") as ((code: number) => void) | undefined;
  if (exit === undefined) {
    throw new Error("kumo-repl: the launcher must provide ctx.appExit before the tree mounts");
  }
  runRepl(ctx, exit).catch((error) => {
    console.error(`kumo: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  });
}
