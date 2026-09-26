import { createRequire } from "node:module";
import { TASKS_HELP } from "../ui/task-panel.js";
import { randomUUID } from "node:crypto";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { Text } from "@earendil-works/pi-tui";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { kumoIcons } from "../render/chars.js";
import { KumoUi, readSettingsRoute } from "../ui/kumo-ui.js";
import { fetchProps, isPrivateIPv4 } from "../setup/discover.js";
import { KUMO_MODES_SERVICE, NOTICE_ASK, NOTICE_AUTO, NOTICE_FULL } from "./modes.js";
import kumoEffort, { KUMO_EFFORT_SERVICE } from "./effort.js";
import { KUMO_RENDER_SERVICE } from "./render.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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

/** kumo's own slash commands (T31.1): source of truth for the palette. */
export const KUMO_COMMANDS: Array<{ name: string; description?: string }> = [
  { name: "/new", description: "Start a new conversation" },
  { name: "/compact", description: "Summarize the conversation to free context" },
  { name: "/plan", description: "Toggle Plan / Build (also Shift+Tab)" },
  { name: "/permissions", description: "Choose Ask / Auto / Full access" },
  { name: "/auto", description: "Switch permissions directly" },
  { name: "/ask", description: "Switch permissions directly" },
  { name: "/full", description: "Switch permissions directly" },
  { name: "/skills", description: "List the enabled skills" },
  { name: "/help", description: "Show commands and keys" },
  { name: "/exit", description: "Quit kumo (also ctrl+d)" },
];

/** Palette merge helper: kumo's commands plus dsh's, no duplicates (kumo wins). */
export function mergeCommands(
  dsh: Array<{ name?: unknown; description?: unknown }>,
): Array<{ name: string; description?: string }> {
  const seen = new Set(KUMO_COMMANDS.map((c) => c.name));
  const out = [...KUMO_COMMANDS];
  for (const d of dsh) {
    if (typeof d?.name !== "string") continue;
    const name = d.name.startsWith("/") ? d.name : `/${d.name}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      ...(typeof d.description === "string" && d.description !== "" ? { description: d.description } : {}),
    });
  }
  return out;
}

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
    // No extra flush here: every turn already flushed, and a second
    // sessions.flush on the same session hangs in dsh rc.3.
    this.#deps.appExit(0);
  }

  /** True while a turn is running (T31.2: /new waits or asks first). */
  isInTurn(): boolean {
    return this.#inTurn;
  }

  /** Settle when the running turn (if any) finishes. */
  async idle(): Promise<void> {
    const p = this.#turnPromise;
    if (p !== undefined) await p.catch(() => {});
  }

  /** Retire this loop without exiting (T31.2: replaced on /new). */
  stop(): void {
    this.#done = true;
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

async function createAgent(ctx: DshContext): Promise<{
  agent: any;
  selection: any;
  selectionRef: { current: any; assembled: unknown };
} | undefined> {
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  if (agents === undefined || defaultModel === undefined) return undefined;
  const selection = defaultModel.currentSelection();
  // T34: the holder dsh reads per request; kumo-effort replaces .current to
  // change the reasoning effort of the NEXT request only.
  const selectionRef: {
    current: { provider: string; model: string; reasoningEffort?: string } | undefined;
    assembled: unknown;
  } = { current: selection, assembled: undefined };
  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx: unknown) => {
      // Block body on purpose: returning the disposer would be treated as a
      // setup commit object by the agent factory.
      installModelSelection(agentCtx as any, selectionRef as any);
    },
  });
  await agent.whenIdle();
  return { agent, selection, selectionRef };
}

/**
 * dsh's own graceful shutdown can stall (observed with 0.1.5-rc.3); kumo
 * requests it, then force-exits after a short grace period so the process
 * never lingers.
 */
export function gracefulExit(exit: (code: number) => void): (code: number) => void {
  return (code) => {
    try {
      exit(code);
    } catch {
      // the request itself must not keep the process alive
    }
    const timer = setTimeout(() => {
      process.exit(code);
    }, 4000);
    timer.unref();
  };
}

async function runRepl(ctx: DshContext, exit: (code: number) => void): Promise<void> {
  await ctx.get("loader")?.await();
  const sessions = ctx.get("sessions");
  const startup: KumoStartup | undefined = ctx.get("kumoStartup");
  if (sessions === undefined) return;
  const created = await createAgent(ctx);
  if (created === undefined) return;
  let { agent } = created;
  const { selection, selectionRef } = created;

  const followup = (text: string): void => {
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text }],
        source: { kind: "user" },
      }),
    );
  };
  const flush = (session: unknown): Promise<unknown> => sessions.flush(session);

  /** Palette items: kumo's commands plus dsh's, no duplicates (kumo wins). */
  const completeCommandList = (): Array<{ name: string; description?: string }> => {
    try {
      const svc = ctx.get("commands") as
        | { list?: (agent: unknown) => Array<{ name?: unknown; description?: unknown }> }
        | undefined;
      return mergeCommands(svc?.list?.(agent) ?? []);
    } catch {
      // palette works with kumo's own commands alone
      return [...KUMO_COMMANDS];
    }
  };

  // Slash-command router: /exit is handled by Repl itself; the rest is
  // answered here and never sent to the model (except unknown → notice).
  const modes = (): any => ctx.get(KUMO_MODES_SERVICE);
  let repl: Repl | undefined;
  let ui: KumoUi | undefined;
  let startNewConversation: () => Promise<void> = async () => {};
  const setPermission = (next: "ask" | "auto" | "full"): void => {
    const m = modes();
    if (m === undefined || m === null) return;
    m.permission = next;
    m.notifyChange?.();
    if (next === "ask") m.showNotice?.(NOTICE_ASK);
    else if (next === "auto") m.showNotice?.(NOTICE_AUTO);
    else m.showNotice?.(NOTICE_FULL, { red: true });
  };
  const effort = (): any => ctx.get(KUMO_EFFORT_SERVICE);
  const router = async (
    text: string,
    emitLine: (t: string) => void,
    reply: (s: string) => void,
  ): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) {
      emitLine(text);
      return;
    }
    // Tolerate doubled slashes from completion quirks (//auto → /auto).
    const clean = `/${trimmed.replace(/^\/+/, "")}`;
    const [cmd] = clean.split(/\s+/);
    if (EXIT_COMMANDS.has(clean)) {
      emitLine(clean);
      return;
    }
    if (cmd === "/plan") {
      const r: string | undefined = modes()?.runCommand?.(clean);
      if (r !== undefined) {
        reply(r);
        return;
      }
    }
    if (cmd === "/permissions") {
      if (ui === undefined) {
        const r: string | undefined = modes()?.runCommand?.(clean);
        if (r !== undefined) reply(r);
        return;
      }
      const m = modes();
      const current: string = m?.permission ?? "ask";
      const choice = await ui.askChoice("Permissions", [
        { value: "ask", label: `Ask: confirm every command and write${current === "ask" ? " (current)" : ""}` },
        { value: "auto", label: `Auto: kumo decides, risky actions still ask${current === "auto" ? " (current)" : ""}` },
        { value: "full", label: `Full access: never asks${current === "full" ? " (current)" : ""}` },
      ]);
      if (choice === 0) setPermission("ask");
      else if (choice === 1) setPermission("auto");
      else if (choice === 2) {
        const ok = await ui.confirmFullAccess();
        if (ok) setPermission("full");
      }
      return;
    }
    // T34: /effort is answered by the effort plugin (picker or direct level).
    if (cmd === "/effort") {
      if (effort()?.handles?.(clean) === true) {
        const t: string | undefined = await Promise.resolve(effort().runCommand(clean));
        if (t !== undefined) reply(t);
      } else {
        ui?.showNotice("Effort control is not available for this model.");
      }
      return;
    }
    if (cmd === "/ask" || cmd === "/auto" || cmd === "/full") {
      if (cmd === "/full") {
        if (ui !== undefined) {
          if (!(await ui.confirmFullAccess())) return;
        }
        setPermission("full");
      } else {
        setPermission(cmd === "/ask" ? "ask" : "auto");
      }
      return;
    }
    if (cmd === "/help") {
      reply(
        [
          "/new  Start a new conversation",
          "/compact  Summarize the conversation to free context",
          "/plan  Toggle Plan / Build (also Shift+Tab)",
          "/permissions  Choose Ask / Auto / Full access",
          "/auto /ask /full  Switch permissions directly",
          "/effort  Choose the reasoning effort (also ctrl+e)",
          "/skills  List the enabled skills",
          "/help  Show commands and keys",
          "/exit  Quit kumo (also ctrl+d)",
          `Esc interrupt, ctrl+c clear, ctrl+d exit, Shift+Tab Plan/Build, → accept suggestion, ctrl+o expand tools, ${TASKS_HELP}`,
        ].join("\n"),
      );
      return;
    }
    if (cmd === "/skills") {
      let names: string[] = [];
      try {
        const home = process.env.DSH_HOME ?? join(homedir(), ".kumo");
        const doc = JSON.parse(readFileSync(join(home, "kumo.json"), "utf8")) as { skills?: unknown };
        if (Array.isArray(doc.skills)) names = doc.skills.filter((s): s is string => typeof s === "string");
      } catch {
        names = [];
      }
      reply(names.length > 0 ? `Enabled skills: ${names.join(", ")}` : "No skills enabled.");
      return;
    }
    if (cmd === "/compact") {
      // T33b: manual compaction through dsh's compaction seam; the visible
      // notice + "Compacted:" line come from the compaction session events.
      const compaction = ctx.get("compaction") as
        | { compactNow?(a: unknown, signal: AbortSignal): Promise<{ shadowedTokenCount?: number } | null> }
        | undefined;
      if (compaction?.compactNow === undefined) {
        reply("Compaction is not available in this dsh build.");
        return;
      }
      try {
        const result = await compaction.compactNow(agent, new AbortController().signal);
        if (result === null) reply("No compactable history yet.");
      } catch (error) {
        const msg = error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? error.message) : String(error);
        if (/idle|busy|open turn/i.test(msg)) reply("Compaction needs an idle session: let the answer finish first.");
        else reply(`Compaction failed: ${msg}`);
      }
      return;
    }
    if (cmd === "/new") {
      await startNewConversation();
      return;
    }
    ui?.showNotice(`Unknown command ${clean}. Type / to see the list.`);
    if (ui === undefined) reply(`Unknown command "${clean}". Available: /plan, /permissions, /exit`);
  };

  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;

  if (isTTY) {
    // pi-tui shell (T13a): header / chat / editor / footer.
    const emitter = new LineEmitter();
    ui = new KumoUi(
      pkg.version,
      {
        onSubmit: (text) => {
          ctx.get(KUMO_RENDER_SERVICE)?.cancelSuggest?.();
          ui?.clearGhost();
          if (text.trim() !== "" && ui !== undefined) ui.rememberHistory(text);
          void router(text, (t) => emitter.emitLine(t), (s) => {
            ui?.addChat(new Text(s, 1, 0));
            ui?.requestRender();
          });
        },
        onUserActivity: () => {
          ctx.get(KUMO_RENDER_SERVICE)?.cancelSuggest?.();
          ui?.clearGhost();
        },
        onEscape: () => emitter.emitSigint(),
        onQuit: () => emitter.emitClose(),
        // T31.4: Shift+Tab toggles Plan/Build. Tab is completion only.
        onShiftTab: () => {
          modes()?.togglePlan?.();
          ui?.requestRender();
        },
      },
      undefined,
      kumoIcons(),
    );
    ui.footer.set({ model: selection.model, provider: selection.provider });
    ui.setAutocompleteCommands(completeCommandList());
    repl = new Repl({
      agent,
      followup,
      flush,
      appExit: (code) => {
        void ui?.shutdown().finally(() => gracefulExit(exit)(code));
      },
      lines: emitter.source(),
    });
    const service: KumoRepl = { agent, ui, selection: selectionRef };
    ctx.provide(KUMO_REPL_SERVICE, service);

    startNewConversation = async (): Promise<void> => {
      if (ui === undefined || repl === undefined) return;
      if (repl.isInTurn()) {
        const choice = await ui.askChoice("A reply is running. Stop it and start a new conversation? (y/N)", [
          { value: "no", label: "No, keep going" },
          { value: "yes", label: "Yes, stop it" },
        ]);
        if (choice !== 1) return;
        agent.cancel({ kind: "user" });
        await repl.idle();
      }
      await flush(agent.session);
      const created2 = await createAgent(ctx);
      if (created2 === undefined || ui === undefined) {
        ui?.showNotice("Could not start a new conversation.");
        return;
      }
      repl.stop();
      agent = created2.agent;
      service.agent = created2.agent;
      // T34: the effort plugin reads the live agent's selection; follow the new agent.
      (service as any).selection = created2.selectionRef;
      effort()?.rebind?.(created2.selectionRef);
      const m = modes();
      if (m !== undefined && m !== null) {
        m.plan = false;
        m.notifyChange?.();
      }
      ui.clearChat();
      ui.clearTasks();
      ui.footer.set({ contextUsed: 0, tps: 0, pp: undefined, cachePct: undefined });
      ui.updateHeader();
      ui.showNotice("New conversation.");
      const fresh = new Repl({
        agent: created2.agent,
        followup: (t: string) => {
          created2.agent.followup(
            createUserMessage({ content: [{ type: "text", text: t }], source: { kind: "user" } }),
          );
        },
        flush,
        appExit: (code: number) => {
          void ui?.shutdown().finally(() => gracefulExit(exit)(code));
        },
        lines: emitter.source(),
      });
      repl = fresh;
      await fresh.run();
    };

    // T33b: a route written before T34 has no compat block, so /effort and
    // ctrl+e cannot control it. If /props proves the template would support
    // enable_thinking, say so once — settings.yaml is never rewritten here.
    void (async (): Promise<void> => {
      try {
        const route = readSettingsRoute();
        if (route === undefined || route.baseUrl === undefined || route.hasCompat === true) return;
        const u = new URL(route.baseUrl);
        const host = u.hostname;
        if (!(host === "localhost" || host === "::1" || isPrivateIPv4(host))) return;
        const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
        const props = await fetchProps(host, port, undefined, 2000);
        if (props?.template?.enableThinking === true) {
          (ui as unknown as {
            showPersistentNotice?: (t: string) => void;
          }).showPersistentNotice?.("Effort control is available for this model: run kumo setup to enable it.");
        }
      } catch {
        // the probe is best effort
      }
    })();

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
    selection: selectionRef,
  };
  ctx.provide(KUMO_REPL_SERVICE, service);
  const base = readlineSource(rl);
  const wrapped: LineSource = {
    onLine: (cb) => base.onLine((line) => void router(line, cb, (s) => console.log(s))),
    onClose: base.onClose,
    onSigint: base.onSigint,
    pause: base.pause,
    resume: base.resume,
  };
  repl = new Repl({
    agent,
    followup,
    flush,
    appExit: gracefulExit(exit),
    lines: wrapped,
  });
  await repl.run(startup?.initialPrompt);
}

export function apply(ctx: DshContext): void {
  // T34: kumo-effort registers /effort in dsh's commands service and owns the
  // reasoning effort of the live selection. Mounted here so the profile's
  // bundle patch stays untouched.
  ctx.plugin?.(kumoEffort);
  const exit = ctx.get("appExit") as ((code: number) => void) | undefined;
  if (exit === undefined) {
    throw new Error("kumo-repl: the launcher must provide ctx.appExit before the tree mounts");
  }
  runRepl(ctx, exit).catch((error) => {
    console.error(`kumo: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  });
}
