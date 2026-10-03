import { appEnv, runtimeHome } from "../compat.js";
import { createRequire } from "node:module";
import { TASKS_HELP } from "../ui/task-panel.js";
import { runEffectCommand } from "./effect-command.js";
import { formatShell, isShellLine, runShell } from "./shell.js";
import { randomUUID } from "node:crypto";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { Text, type SlashCommand } from "@earendil-works/pi-tui";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { bruineIcons } from "../render/chars.js";
import { BruineUi, readSettingsRoute } from "../ui/bruine-ui.js";
import { fetchProps, isPrivateIPv4 } from "../setup/discover.js";
import { BRUINE_MODES_SERVICE, NOTICE_ASK, NOTICE_AUTO, NOTICE_FULL } from "./modes.js";
import bruineEffort, { BRUINE_EFFORT_SERVICE } from "./effort.js";
import bruineModel, { BRUINE_MODEL_SERVICE } from "./model.js";
import { BRUINE_RENDER_SERVICE } from "./render.js";
import { readAvailableSkills, type AvailableSkill } from "../setup/skills.js";
import { recentSessions, replaySession, sessionChoice } from "./session-history.js";
import { configFiles, openInEditor, resolveEditor } from "./config-edit.js";
import { formatTasks, listTasks, stopTask, type JobsLike, type SubagentsLike } from "./tasks.js";
import { resolveDshHome } from "../update.js";
import { formatVerification, runVerification } from "./verify.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  attachFailureNotice,
  buildUserContent,
  NO_STORE_NOTICE,
  type AttachmentStoreLike,
  type UserContentPart,
} from "../image/attach.js";
import { stripImageChips } from "../image/pending.js";
import { NO_VISION_NOTICE } from "../image/vision.js";
import type { ClipboardImage } from "../image/clipboard.js";
import type { DshContext, BruineRepl, BruineStartup } from "./ctx.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/** Stable Cordis plugin name. */
export const name = "bruine-repl";

/** Core services required before the interactive loop can start. */
export const inject = ["agentDefaultModel", "agents", "sessions"];

/** The service provided by this plugin and injected by render/approval. */
export const BRUINE_REPL_SERVICE = "bruineRepl";

const EXIT_COMMANDS = new Set(["/exit", "/quit"]);

/** bruine's own slash commands (T31.1): source of truth for the palette. */
export const BRUINE_COMMANDS: Array<{ name: string; description?: string }> = [
  { name: "/new", description: "Start a new conversation" },
  { name: "/resume", description: "Resume a saved conversation in this project" },
  { name: "/verify", description: "Run this project's typecheck and tests" },
  { name: "/compact", description: "Summarize the conversation to free context" },
  { name: "/plan", description: "Toggle Plan / Build (also Shift+Tab)" },
  { name: "/permissions", description: "Choose Ask / Auto / Full access" },
  { name: "/auto", description: "Switch permissions directly" },
  { name: "/ask", description: "Switch permissions directly" },
  { name: "/full", description: "Switch permissions directly" },
  { name: "/skills", description: "List available skills" },
  { name: "/config", description: "Open settings.yaml and bruine.json in your editor" },
  { name: "/tasks", description: "List background tasks (commands and sub-agents); /tasks kill <id> stops one" },
  { name: "/reload", description: "Re-read settings.yaml and the terminal background" },
  { name: "/mouse", description: "Turn mouse selection on or off (the wheel scrolls while off)" },
  { name: "/effect", description: "Choose bruine, pluie, foudre, auto (on), or off" },
  { name: "/help", description: "Show commands and keys" },
  { name: "/exit", description: "Quit bruine (also ctrl+d)" },
];

/** Palette merge helper: bruine's commands plus dsh's, no duplicates (bruine wins). */
export function mergeCommands(
  dsh: Array<{ name?: unknown; description?: unknown }>,
): Array<{ name: string; description?: string }> {
  const seen = new Set(BRUINE_COMMANDS.map((c) => c.name));
  const out = [...BRUINE_COMMANDS];
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

function skillDescription(skill: AvailableSkill): string {
  return skill.description.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 140);
}

/** The same available-skill list backs the command output and its preview. */
export function formatAvailableSkills(skills: AvailableSkill[]): string {
  if (skills.length === 0) return "No skills available. Run `bruine setup` to add skills.";
  return [
    `Available skills (${skills.length}):`,
    ...skills.map((skill) => {
      const description = skillDescription(skill);
      return `  ${skill.name} (${skill.scope})${description === "" ? "" : `  ${description}`}`;
    }),
  ].join("\n");
}

/** Argument preview for `/skills <name>`, read when the editor asks for it. */
export function skillCommand(homeSkillsDir: string, cwd: string): SlashCommand {
  return {
    name: "/skills",
    description: "List available skills",
    argumentHint: "[skill name]",
    getArgumentCompletions: async (prefix) => {
      const needle = prefix.trim().toLowerCase();
      const skills = await readAvailableSkills(homeSkillsDir, cwd);
      return skills
        .filter((skill) => skill.name.toLowerCase().includes(needle))
        .map((skill) => ({
          value: skill.name,
          label: skill.name,
          description: skillDescription(skill) || skill.scope,
        }));
    },
  };
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
  /** The prompts waiting for the running turn to end changed (shown above the input box). */
  onQueue?(queued: readonly string[]): void;
  /** The turn was stopped with prompts still queued: they are handed back, never sent. */
  onRecall?(prompts: string[]): void;
}

/**
 * The interactive loop: read a line, run one turn, redraw the prompt.
 * Pure orchestration over {@link ReplDeps} so it is testable without dsh.
 *
 * A prompt sent while a turn runs is not lost: it waits in a queue and goes out, as its own
 * turn, when the running one ends; several go out one after the other, in the order typed.
 * Stopping the turn (Escape) does not send them: it hands them back (see {@link takeQueue}).
 */
export class Repl {
  #deps: ReplDeps;
  #inTurn = false;
  #done = false;
  #turnPromise: Promise<void> | undefined;
  #queue: string[] = [];
  /** True from the moment a turn starts until the queue it leaves behind is drained. */
  #draining = false;

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
      await this.#drain(initialPrompt);
    }
    if (!this.#done) this.#prompt();
  }

  async #onLine(line: string): Promise<void> {
    if (this.#done) return;
    const text = line.trim();
    if (EXIT_COMMANDS.has(text)) {
      await this.#quit();
      return;
    }
    if (text === "") {
      if (!this.#draining) this.#prompt();
      return;
    }
    if (this.#draining) {
      this.#queue.push(text);
      this.#deps.onQueue?.([...this.#queue]);
      return;
    }
    await this.#drain(text);
    if (!this.#done) this.#prompt();
  }

  /** Run `first`, then every prompt queued meanwhile, one turn each, in order. */
  async #drain(first: string): Promise<void> {
    this.#draining = true;
    try {
      let next: string | undefined = first;
      while (next !== undefined && !this.#done) {
        await this.#turn(next);
        next = this.#queue.shift();
        if (next !== undefined) this.#deps.onQueue?.([...this.#queue]);
      }
    } finally {
      this.#draining = false;
    }
  }

  /** The prompts waiting for the running turn, oldest first. */
  get queued(): readonly string[] {
    return [...this.#queue];
  }

  /** Take the most recent queued prompt back out of the queue (to edit it), if there is one. */
  takeLastQueued(): string | undefined {
    const last = this.#queue.pop();
    if (last !== undefined) this.#deps.onQueue?.([...this.#queue]);
    return last;
  }

  /** Empty the queue and return what was in it, oldest first. */
  takeQueue(): string[] {
    const all = this.#queue.splice(0);
    if (all.length > 0) this.#deps.onQueue?.([]);
    return all;
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
    // Escape / Ctrl+C during a turn cancels the turn, never the app. Stopping means stopping:
    // what was queued behind the turn is handed back instead of going out next.
    if (!this.#inTurn) return;
    const queued = this.takeQueue();
    this.#deps.agent.cancel({ kind: "user" });
    if (queued.length > 0) this.#deps.onRecall?.(queued);
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

  /** Retire this loop without exiting (T31.2: replaced on /new). Queued prompts are dropped. */
  stop(): void {
    this.#done = true;
    this.takeQueue();
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
  rl.setPrompt(`${bruineIcons().prompt} `);
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

async function createAgent(ctx: DshContext, resumeSessionId?: string): Promise<{
  agent: any;
  dispose(): Promise<void>;
  selection: any;
  selectionRef: { current: any; assembled: unknown };
} | undefined> {
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  if (agents === undefined || defaultModel === undefined) return undefined;
  const selection = defaultModel.currentSelection();
  // T34: the holder dsh reads per request; bruine-effort replaces .current to
  // change the reasoning effort of the NEXT request only.
  const selectionRef: {
    current: { provider: string; model: string; reasoningEffort?: string } | undefined;
    assembled: unknown;
  } = { current: selection, assembled: undefined };
  const setup = (agentCtx: unknown): void => {
    // Returning the disposer would be treated as a setup commit object.
    installModelSelection(agentCtx as any, selectionRef as any);
  };
  const handle = resumeSessionId === undefined ? await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup,
  }) : await agents.resume({
    resumeSessionId: SessionId(resumeSessionId),
    agentOptions: { provider: selection.provider, model: selection.model },
    setup,
  });
  const { agent } = handle;
  await agent.whenIdle();
  return { agent, dispose: () => handle.dispose(), selection, selectionRef };
}

/**
 * dsh's own graceful shutdown can stall (observed with 0.1.5-rc.3); bruine
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

/**
 * T34/T37: has the plugin already said this out loud?
 *
 * `/effort high` and `/model <route>` reported the same sentence twice: once as the
 * notice above the editor (transient, with the level also sitting in the footer's
 * route row for as long as the session lasts) and once as a transcript line, which
 * never goes away. Four presses left four lines on the screen and a reader could
 * not tell which one was the answer.
 *
 * So the router only echoes a line the plugin did not already show. An error, an
 * unknown level and the list of levels are answers rather than notices: those keep
 * their transcript line.
 */
export function saidAlready(text: string | undefined, noticeShown: string | undefined): boolean {
  return text !== undefined && noticeShown !== undefined && text === noticeShown;
}

async function runRepl(ctx: DshContext, exit: (code: number) => void): Promise<void> {
  await ctx.get("loader")?.await();
  const sessions = ctx.get("sessions");
  const startup: BruineStartup | undefined = ctx.get("bruineStartup");
  if (sessions === undefined) return;
  const query = ctx.get("sessionQuery");
  const availableSessions = (excludeId?: string) => recentSessions(query, process.cwd(), excludeId);
  const continuing = appEnv("CONTINUE") === "1";
  let latest: Awaited<ReturnType<typeof availableSessions>>[number] | undefined;
  try { if (continuing) latest = (await availableSessions())[0]; }
  catch { /* a broken listing must not prevent a fresh conversation */ }
  let resumeNotice = "";
  let created: Awaited<ReturnType<typeof createAgent>>;
  try {
    created = await createAgent(ctx, latest?.id);
    if (latest !== undefined) resumeNotice = `Resumed: ${latest.title}`;
    else if (continuing) resumeNotice = "No saved conversation in this project. Started a new one.";
  } catch (error) {
    created = await createAgent(ctx);
    resumeNotice = `Could not resume the previous conversation: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (created === undefined) return;
  let currentHandle = created;
  let { agent } = created;
  const { selection, selectionRef } = created;

  const send = (parts: UserContentPart[]): void => {
    agent.followup(createUserMessage({ content: parts, source: { kind: "user" } }));
  };

  /**
   * T29: the dsh attachment store, when this build has one. dsh-base ships the
   * local backend, so this is normally there; a build without it still sends
   * the words.
   */
  const attachmentStore = (): AttachmentStoreLike | undefined => {
    const store = ctx.get("attachments") as AttachmentStoreLike | undefined;
    return typeof store?.saveImage === "function" ? store : undefined;
  };

  /**
   * T29: a prompt carrying `[Image N]` chips. The chips stay in the text when
   * an image really was attached, because the label and the image belong
   * together; when none was, they are stripped so the model is never told about
   * an image it cannot see.
   */
  const sendWithImages = async (text: string, images: ClipboardImage[], target: typeof agent = agent): Promise<void> => {
    if (ui !== undefined && (await ui.routeSeesImages()) === "no") {
      ui.showNotice(NO_VISION_NOTICE, { red: true });
      ui.pendingImages.release(images);
      target.followup(createUserMessage({ content: [{ type: "text", text: stripImageChips(text) }], source: { kind: "user" } }));
      return;
    }
    const built = await buildUserContent(text, images, attachmentStore());
    ui?.pendingImages.release(images);
    if (built.noStore) ui?.showNotice(NO_STORE_NOTICE, { red: true });
    else if (built.failures.length > 0) ui?.showNotice(attachFailureNotice(built.failures), { red: true });
    const label = built.attached > 0 ? text : stripImageChips(text);
    target.followup(
      createUserMessage({
        content: built.attached > 0 ? built.parts : [{ type: "text", text: label }],
        source: { kind: "user" },
      }),
    );
  };

  const followup = (text: string): void => {
    const images = ui?.pendingImages.resolve(text) ?? [];
    if (images.length === 0) {
      send([{ type: "text", text }]);
      return;
    }
    // The store validates and normalizes the bytes, so the send is async. The
    // prompt echo already happened, and a refusal costs the image, not the
    // message.
    void sendWithImages(text, images);
  };
  const flush = (session: unknown): Promise<unknown> => sessions.flush(session);

  /** Palette items: bruine's commands plus dsh's, no duplicates (bruine wins). */
  const skillsDir = join(runtimeHome(), "skills");
  const completeCommandList = (): SlashCommand[] => {
    let commands: SlashCommand[];
    try {
      const svc = ctx.get("commands") as
        | { list?: (agent: unknown) => Array<{ name?: unknown; description?: unknown }> }
        | undefined;
      commands = mergeCommands(svc?.list?.(agent) ?? []);
    } catch {
      // palette works with bruine's own commands alone
      commands = [...BRUINE_COMMANDS];
    }
    return commands.map((command) => command.name === "/skills" ? skillCommand(skillsDir, process.cwd()) : command);
  };

  // Slash-command router: /exit is handled by Repl itself; the rest is
  // answered here and never sent to the model (except unknown → notice).
  const modes = (): any => ctx.get(BRUINE_MODES_SERVICE);
  let repl: Repl | undefined;
  let ui: BruineUi | undefined;
  let startNewConversation: () => Promise<void> = async () => {};
  let resumeConversation: () => Promise<void> = async () => {};
  const setPermission = (next: "ask" | "auto" | "full"): void => {
    const m = modes();
    if (m === undefined || m === null) return;
    m.permission = next;
    m.notifyChange?.();
    if (next === "ask") m.showNotice?.(NOTICE_ASK);
    else if (next === "auto") m.showNotice?.(NOTICE_AUTO);
    else m.showNotice?.(NOTICE_FULL, { red: true });
  };
  const effort = (): any => ctx.get(BRUINE_EFFORT_SERVICE);
  const modelPicker = (): any => ctx.get(BRUINE_MODEL_SERVICE);
  const router = async (
    text: string,
    emitLine: (t: string) => void,
    reply: (s: string) => void,
  ): Promise<void> => {
    const trimmed = text.trim();
    // "!cmd": the user's own shell command, output shown, never sent to the model.
    if (isShellLine(trimmed)) {
      const command = trimmed.slice(1).trim();
      const r = await runShell(command);
      reply(formatShell(command, r));
      return;
    }
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
    // T56: the wheel and the drag cannot both have the mouse, so the choice is
    // the user's to make, mid-session, without restarting.
    if (cmd === "/mouse" && ui !== undefined) {
      const arg = clean.split(/\s+/)[1]?.toLowerCase();
      const want = arg === "on" ? true : arg === "off" ? false : undefined;
      reply(ui.mouse.toggle(want));
      return;
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
        { value: "auto", label: `Auto: bruine decides, risky actions still ask${current === "auto" ? " (current)" : ""}` },
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
        // The plugin showed the change itself; a second copy in the transcript is
        // the line that stays on the screen long after the notice is gone.
        if (t !== undefined && !saidAlready(t, effort()?.noticeShown)) reply(t);
      } else {
        ui?.showNotice("Effort control is not available for this model.");
      }
      return;
    }
    // T37: /model and /provider are answered by the model plugin (picker,
    // direct route, or the read-only provider list).
    if (cmd === "/model" || cmd === "/provider") {
      const picker = modelPicker();
      if (picker === undefined || picker === null) {
        reply(`${cmd} is not available in this build.`);
        return;
      }
      const t: string | undefined = await Promise.resolve(
        cmd === "/model"
          ? picker.runCommand(clean)
          : picker.runProviderCommand(clean.replace(/^\/provider\s*/, "")),
      );
      if (t !== undefined && !saidAlready(t, picker.noticeShown)) reply(t);
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
          "/resume  Resume a saved conversation in this project",
          "/verify  Run this project's typecheck and tests on demand",
          "/compact  Summarize the conversation to free context",
          "/plan  Toggle Plan / Build (also Shift+Tab)",
          "/permissions  Choose Ask / Auto / Full access",
          "/auto /ask /full  Switch permissions directly",
          "/effort  Choose the reasoning effort (also ctrl+e)",
          "/model  Switch provider and model (also f2)",
          "/provider  List the providers (also /provider all)",
          "/skills  List available skills (or /skills <name>)",
          "/config  Open settings.yaml and bruine.json in your editor (/config path lists them)",
          "/tasks  List background tasks; /tasks kill <id> stops one",
          "/reload  Re-read settings.yaml and the terminal background",
          "/effect  Weather: bruine, pluie, foudre, auto (also on), off",
          "/help  Show commands and keys",
          "!cmd  Run a shell command yourself (output not sent to the model)",
          "@file  Attach a file (a list opens as you type)",
          "/exit  Quit bruine (also ctrl+d)",
          `Esc interrupt, ctrl+c clear (quits when empty), ctrl+d exit, Shift+Tab Plan/Build, → accept suggestion, ctrl+o expand tools, f2 next model, PageUp/PageDown read back (the input bar stays), ${TASKS_HELP}`,
        ].join("\n"),
      );
      return;
    }
    if (cmd === "/effect") {
      const message = await runEffectCommand(clean.slice(cmd.length), ui, runtimeHome());
      if (ui === undefined) reply(message);
      else ui.showNotice(message);
      return;
    }
    if (cmd === "/skills") {
      const skills = await readAvailableSkills(skillsDir, process.cwd());
      const requested = clean.slice(cmd.length).trim();
      if (requested === "") {
        reply(formatAvailableSkills(skills));
      } else {
        const selected = skills.find((skill) => skill.name.toLowerCase() === requested.toLowerCase());
        reply(selected === undefined
          ? `Skill "${requested}" is not available. Run /skills to see the list.`
          : formatAvailableSkills([selected]));
      }
      return;
    }
    if (cmd === "/tasks") {
      const services = { jobs: ctx.get("jobs") as JobsLike | undefined, subagents: ctx.get("subagents") as SubagentsLike | undefined };
      if (services.jobs === undefined && services.subagents === undefined) {
        reply("Background tasks are not available in this build.");
        return;
      }
      const sessionId = (agent as { session?: { id?: string } } | undefined)?.session?.id;
      const [verb, ...rest] = clean.replace(/^\/tasks\s*/, "").trim().split(/\s+/);
      if (verb === "kill" || verb === "stop") {
        reply(await stopTask(services, agent, sessionId, rest.join(" ").trim()));
        return;
      }
      reply(formatTasks(await listTasks(services, agent, sessionId), Date.now(), process.stdout.columns ?? 100));
      return;
    }
    if (cmd === "/config") {
      const home = resolveDshHome();
      const files = configFiles(home);
      if (files.length === 0) {
        reply(`No settings yet in ${home}. Run \`bruine setup\` first.`);
        return;
      }
      const list = files.map((f) => `  ${f}`).join("\n");
      // A piped run has no desktop to open anything on, and `path` asks only for the names.
      if (ui === undefined || clean.replace(/^\/config\s*/, "").trim() === "path") {
        reply(`Config files:\n${list}`);
        return;
      }
      const choice = resolveEditor(home);
      if (choice === undefined) {
        reply(`No graphical editor found. Set BRUINE_EDITOR (for example BRUINE_EDITOR=kate), or open:\n${list}`);
        return;
      }
      const result = await openInEditor(choice, files);
      if (!result.ok) {
        reply(`Could not open ${result.editor}: ${result.error ?? "it did not start"}.\nSet BRUINE_EDITOR to another editor, or open:\n${list}`);
        return;
      }
      const names = files.map((f) => f.split(/[\\/]/).pop()).join(" and ");
      reply(`Opened ${names} in ${result.editor}. Save, then /reload re-reads settings.yaml; bruine.json is read when bruine starts.`);
      return;
    }
    if (cmd === "/reload") {
      if (ui === undefined) {
        reply("/reload needs the terminal UI. In a piped run there is nothing to redraw.");
        return;
      }
      // Never a silent lie: a route that moved under us is named, not adopted.
      const report = await ui.reload();
      const lines = [`Reloaded. Route still ${report.live}.`];
      if (report.route === "moved" && report.moved !== undefined) {
        lines.push(`settings.yaml now points at ${report.moved}. This session is still on ${report.live}: /model to switch.`);
      } else if (report.route === "unreadable") {
        lines.push("settings.yaml could not be read; kept what this session started with.");
      }
      lines.push(
        report.background === "read"
          ? "Terminal background re-read; the painted surfaces follow it."
          : "The terminal did not report a background; the painted surfaces are unchanged.",
      );
      reply(lines.join("\n"));
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
    if (cmd === "/resume") {
      await resumeConversation();
      return;
    }
    if (cmd === "/verify") {
      ui?.showNotice("Running project checks…");
      reply(formatVerification(await runVerification(process.cwd())));
      return;
    }
    ui?.showNotice(`Unknown command ${clean}. Type / to see the list.`);
    if (ui === undefined) reply(`Unknown command "${clean}". Available: /plan, /permissions, /exit`);
  };

  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;

  if (isTTY) {
    // pi-tui shell (T13a): header / chat / editor / footer.
    const emitter = new LineEmitter();
    ui = new BruineUi(
      pkg.version,
      {
        onSubmit: (text) => {
          ctx.get(BRUINE_RENDER_SERVICE)?.cancelSuggest?.();
          ui?.clearGhost();
          if (text.trim() !== "" && ui !== undefined) ui.rememberHistory(text);
          void router(text, (t) => emitter.emitLine(t), (s) => {
            ui?.addChat(new Text(s, 1, 0));
            ui?.requestRender();
          });
        },
        onUserActivity: () => {
          ctx.get(BRUINE_RENDER_SERVICE)?.cancelSuggest?.();
          ui?.clearGhost();
        },
        onEscape: () => emitter.emitSigint(),
        onQuit: () => emitter.emitClose(),
        onQueueEdit: () => repl?.takeLastQueued(),
        // T31.4: Shift+Tab toggles Plan/Build. Tab is completion only.
        onShiftTab: () => {
          modes()?.togglePlan?.();
          ui?.requestRender();
        },
      },
      undefined,
      bruineIcons(),
    );
    ui.footer.set({ model: selection.model, provider: selection.provider });
    ui.setAutocompleteCommands(completeCommandList());
    // Prompts typed while a turn runs wait above the box; Escape hands them back.
    const queueUi = {
      onQueue: (queued: readonly string[]): void => ui?.setQueued(queued),
      onRecall: (prompts: string[]): void => {
        if (ui === undefined) return;
        const typed = ui.editor.getText();
        ui.editor.setText([...prompts, ...(typed.trim() === "" ? [] : [typed])].join("\n\n"));
        ui.showNotice(`Stopped. ${prompts.length === 1 ? "The queued prompt is" : `The ${String(prompts.length)} queued prompts are`} back in the box, not sent.`);
        ui.requestRender();
      },
    };
    repl = new Repl({
      agent,
      followup,
      flush,
      appExit: (code) => {
        void ui?.shutdown().finally(() => gracefulExit(exit)(code));
      },
      lines: emitter.source(),
      ...queueUi,
    });
    const service: BruineRepl = { agent, ui, selection: selectionRef };
    ctx.provide(BRUINE_REPL_SERVICE, service);

    const showSavedDialogue = (saved: typeof agent): void => {
      if (ui !== undefined) replaySession(saved.session, ui as never);
    };
    if (latest !== undefined && resumeNotice.startsWith("Resumed:")) showSavedDialogue(agent);
    if (resumeNotice !== "") ui.showNotice(resumeNotice);

    const settleForSwitch = async (): Promise<boolean> => {
      if (ui === undefined || repl === undefined) return false;
      if (!repl.isInTurn()) return true;
      const choice = await ui.askChoice("A reply is running. Stop it and switch conversations? (y/N)", [
        { value: "no", label: "No, keep going" },
        { value: "yes", label: "Yes, stop it" },
      ]);
      if (choice !== 1) return false;
      agent.cancel({ kind: "user" });
      await repl.idle();
      return true;
    };

    const activateConversation = async (next: NonNullable<Awaited<ReturnType<typeof createAgent>>>, notice: string, restore: boolean): Promise<void> => {
      if (ui === undefined || repl === undefined) return;
      const previous = currentHandle;
      repl.stop();
      agent = next.agent;
      currentHandle = next;
      service.agent = next.agent;
      (service as any).selection = next.selectionRef;
      effort()?.rebind?.(next.selectionRef);
      modelPicker()?.rebind?.(next.selectionRef);
      const m = modes();
      if (m !== undefined && m !== null) {
        m.plan = false;
        m.notifyChange?.();
      }
      ui.clearChat();
      ui.clearTasks();
      ui.pendingImages.clear();
      ui.footer.set({ model: next.selection.model, provider: next.selection.provider, contextUsed: 0, tps: 0, pp: undefined, cachePct: undefined });
      if (restore) showSavedDialogue(next.agent);
      ui.updateHeader();
      ui.showNotice(notice);
      await previous.dispose().catch(() => undefined);
      const fresh = new Repl({
        agent: next.agent,
        followup: (t: string) => {
          const images = ui?.pendingImages.resolve(t) ?? [];
          if (images.length === 0) {
            next.agent.followup(createUserMessage({ content: [{ type: "text", text: t }], source: { kind: "user" } }));
            return;
          }
          void sendWithImages(t, images, next.agent);
        },
        flush,
        appExit: (code: number) => {
          void ui?.shutdown().finally(() => gracefulExit(exit)(code));
        },
        lines: emitter.source(),
        ...queueUi,
      });
      repl = fresh;
      await fresh.run();
    };

    startNewConversation = async (): Promise<void> => {
      if (!(await settleForSwitch())) return;
      await flush(agent.session);
      const created2 = await createAgent(ctx);
      if (created2 === undefined) {
        ui?.showNotice("Could not start a new conversation.");
        return;
      }
      await activateConversation(created2, "New conversation.", false);
    };

    resumeConversation = async (): Promise<void> => {
      if (ui === undefined || !(await settleForSwitch())) return;
      await flush(agent.session);
      let choices: Awaited<ReturnType<typeof availableSessions>>;
      try { choices = await availableSessions(String(agent.session.id)); }
      catch (error) { ui.showNotice(`Could not list conversations: ${error instanceof Error ? error.message : String(error)}`, { red: true }); return; }
      if (choices.length === 0) { ui.showNotice("No other saved conversation in this project."); return; }
      const choice = await ui.askChoice("Resume a conversation", choices.map((row) => ({ value: row.id, label: sessionChoice(row) })));
      if (choice < 0 || choice >= choices.length) return;
      const selected = choices[choice]!;
      try {
        const resumed = await createAgent(ctx, selected.id);
        if (resumed === undefined) throw new Error("session service unavailable");
        await activateConversation(resumed, `Resumed: ${selected.title}`, true);
      } catch (error) {
        ui.showNotice(`Could not resume: ${error instanceof Error ? error.message : String(error)}`, { red: true });
      }
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
          }).showPersistentNotice?.("Effort control is available for this model: run bruine setup to enable it.");
        }
      } catch {
        // the probe is best effort
      }
    })();

    // C7: nothing waits on a boot drawing any more, so the session paints at once.
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
  const service: BruineRepl = {
    agent,
    ask: (question) => askViaReadline(rl, question),
    selection: selectionRef,
  };
  ctx.provide(BRUINE_REPL_SERVICE, service);
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
  // T34: bruine-effort registers /effort in dsh's commands service and owns the
  // reasoning effort of the live selection. Mounted here so the profile's
  // bundle patch stays untouched.
  ctx.plugin?.(bruineEffort);
  // T37: bruine-model owns /model and /provider — the provider/model picker and
  // the switch of the live route. Mounted here so the profile's bundle patch
  // stays untouched.
  ctx.plugin?.(bruineModel);
  const exit = ctx.get("appExit") as ((code: number) => void) | undefined;
  if (exit === undefined) {
    throw new Error("bruine-repl: the launcher must provide ctx.appExit before the tree mounts");
  }
  runRepl(ctx, exit).catch((error) => {
    console.error(`bruine: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
  });
}
