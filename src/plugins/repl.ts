import { randomUUID } from "node:crypto";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { DshContext, KumoRepl, KumoStartup } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "kumo-repl";

/** Core services required before the interactive loop can start. */
export const inject = ["agentDefaultModel", "agents", "sessions"];

/** The service provided by this plugin and injected by render/approval. */
export const KUMO_REPL_SERVICE = "kumoRepl";

const PROMPT = "› ";
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

  async #turn(text: string): Promise<void> {
    this.#inTurn = true;
    this.#deps.lines.pause();
    try {
      this.#deps.followup(text);
      await this.#deps.agent.whenIdle();
    } finally {
      this.#inTurn = false;
      await this.#flushQuietly();
    }
  }

  #onSigint(): void {
    // Ctrl+C during a turn cancels the turn, never the app.
    if (this.#inTurn) this.#deps.agent.cancel({ kind: "user" });
  }

  async #quit(): Promise<void> {
    if (this.#done) return;
    this.#done = true;
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

/** Wrap a node:readline interface as a {@link LineSource}. */
export function readlineSource(rl: ReadlineInterface): LineSource {
  rl.setPrompt(PROMPT);
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

async function runRepl(ctx: DshContext, exit: (code: number) => void): Promise<void> {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  const startup: KumoStartup | undefined = ctx.get("kumoStartup");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return;

  const selection = defaultModel.currentSelection();
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx: unknown) =>
      installModelSelection(agentCtx as any, { current: selection, assembled: undefined }),
  });
  await agent.whenIdle();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
  });

  const service: KumoRepl = {
    agent,
    ask: (question) => askViaReadline(rl, question),
  };
  ctx.provide(KUMO_REPL_SERVICE, service);

  const repl = new Repl({
    agent,
    followup: (text) =>
      agent.followup(
        createUserMessage({
          content: [{ type: "text", text }],
          source: { kind: "user" },
        }),
      ),
    flush: (session) => sessions.flush(session),
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
