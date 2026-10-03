import { appEnv, runtimeHome, configReadPath } from "../compat.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { Text } from "@earendil-works/pi-tui";
import { dim } from "../render/reasoning.js";
import { askJudge, judgePrompt, JUDGE_MAX_COMMAND_CHARS, type JudgeLlm, type JudgeRoute, type JudgeVerdict } from "../gate/judge.js";
import { decide, parseArgs, ruleKey, type PermissionMode } from "../gate/rules.js";
import type { DshContext, BruineRepl } from "./ctx.js";
import { BRUINE_MCP_SERVICE, type BruineMcpService } from "./mcp.js";
import { toolPrefix } from "../mcp/config.js";

/** The gate's view of an MCP tool: is its server read-only, is the tool on its alwaysAllow list. */
export function mcpPolicy(service: BruineMcpService | undefined, tool: string): { readOnly: boolean; allowed: boolean } | undefined {
  const server = service?.serverOf(tool);
  if (server === undefined) return undefined;
  const raw = tool.slice(toolPrefix(server.id).length);
  return { readOnly: server.readOnly, allowed: server.alwaysAllow.includes(raw) || server.alwaysAllow.includes(tool) };
}

/** Stable Cordis plugin name. */
export const name = "bruine-modes";

/** Service published for the REPL (Tab / Shift+Tab / slash commands) and approvals. */
export const BRUINE_MODES_SERVICE = "bruineModes";

export const PLAN_ON_TEXT = "Plan mode is on: do not modify files or run modifying commands.";
export const PLAN_OFF_TEXT = "Plan mode is off.";

/** Announcement texts injected to the model; never shown as user chat. */
export const MODE_ANNOUNCEMENTS: ReadonlySet<string> = new Set([PLAN_ON_TEXT, PLAN_OFF_TEXT]);

export const NOTICE_PLAN_ON = "Plan mode: bruine reads and plans, no file changes. Shift+Tab to leave.";
export const NOTICE_PLAN_OFF = "Build mode: bruine can change files again.";
export const NOTICE_ASK = "Ask: bruine asks before every command and file change.";
export const NOTICE_AUTO = "Auto: bruine decides, risky actions still ask.";
export const NOTICE_FULL = "Full access: bruine never asks. Shift+Tab to leave.";

export const FULL_CONFIRM_TITLE = "Enable full access? bruine will run commands and edit files without asking.";

/**
 * T42: the reason a headless run gives when the rule table says `ask`. It names
 * both ways out, because "denied" with no way forward is a dead end in a script.
 */
export const NO_TERMINAL_DENY =
  "bruine has no terminal to ask on (headless run). Re-run with --permission-mode full, " +
  "or --dangerously-skip-permissions, or narrow the task to what the gate allows.";

export interface ModesLogEntry {
  tool: string;
  summary: string;
  decision: "allow" | "ask" | "deny";
  via: string;
}

export interface BruineModesService {
  readonly plan: boolean;
  readonly permission: PermissionMode;
  togglePlan(): void;
  cyclePermission(): Promise<PermissionMode>;
  rememberFor(callId: string | undefined): void;
  decisionFor(callId: string | undefined): "allow" | "ask" | "deny" | undefined;
  governs(agent: unknown): boolean;
  readonly log: ModesLogEntry[];
  onChange(cb: () => void): () => void;
  describe(): { plan: boolean; permission: PermissionMode; badges: string[] };
  runCommand(line: string): string | undefined;
  /**
   * T42: the agent the gate governs when there is no REPL. Headless runs one
   * task with no line editor, and the gate has to cover it too, otherwise
   * `tools/pre-execute` falls through to `next()` and every tool runs
   * undecided with the sandbox open.
   */
  govern(agent: unknown): void;
}


const PERMISSION_ORDER: PermissionMode[] = ["ask", "auto", "full"];

function readBruineJson(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  try {
    const home = runtimeHome(env);
    const path = configReadPath(home);
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readDefaultMode(env: NodeJS.ProcessEnv = process.env): PermissionMode {
  const permission = appEnv("PERMISSION_MODE", env);
  if (appEnv("HEADLESS", env) === "1" && (permission === "ask" || permission === "auto" || permission === "full")) {
    return permission;
  }
  const doc = readBruineJson(env) as { permissionMode?: unknown; access?: unknown };
  const v = doc.permissionMode ?? doc.access;
  return v === "auto" || v === "full" || v === "ask" ? v : "auto";
}

export class Modes implements BruineModesService {
  plan = false;
  permission: PermissionMode = "ask";
  readonly log: ModesLogEntry[] = [];
  readonly sessionAllowed = new Set<string>();
  readonly pendingKeys = new Map<string, string>();
  #decisions = new Map<string, "allow" | "ask" | "deny">();
  #listeners: Array<() => void> = [];
  #confirmFullAccess: (() => Promise<boolean>) | undefined;
  /** Announce plan toggles into the model context (cache-safe: appended message). */
  announce: ((text: string) => void) | undefined;
  /** UI feedback for slash commands. */
  notify: ((text: string) => void) | undefined;
  /**
   * T42: the agent to govern when no REPL published one (headless). Kept as a
   * plain field because the gate reads it on every tool call.
   */
  governed: unknown;
  governs: (agent: unknown) => boolean = () => false;
  /** Transient notice above the editor (T24.4), not in chat history. */
  showNotice: ((text: string, opts?: { red?: boolean }) => void) | undefined;

  constructor(permission: PermissionMode) {
    this.permission = permission;
  }

  onChange(cb: () => void): () => void {
    this.#listeners.push(cb);
    return () => {
      const i = this.#listeners.indexOf(cb);
      if (i !== -1) this.#listeners.splice(i, 1);
    };
  }

  notifyChange(): void {
    for (const cb of this.#listeners) cb();
  }

  /** T42: point the gate at a REPL-less agent. See BruineModesService.govern. */
  govern(agent: unknown): void {
    this.governed = agent;
  }

  togglePlan(): void {
    this.plan = !this.plan;
    this.announce?.(this.plan ? PLAN_ON_TEXT : PLAN_OFF_TEXT);
    this.showNotice?.(this.plan ? NOTICE_PLAN_ON : NOTICE_PLAN_OFF);
    this.notifyChange();
  }

  async cyclePermission(): Promise<PermissionMode> {
    const i = PERMISSION_ORDER.indexOf(this.permission);
    const next = PERMISSION_ORDER[(i + 1) % PERMISSION_ORDER.length]!;
    if (next === "full" && this.#confirmFullAccess !== undefined) {
      const ok = await this.#confirmFullAccess();
      if (!ok) return this.permission;
    }
    this.permission = next;
    if (next === "ask") this.showNotice?.(NOTICE_ASK);
    else if (next === "auto") this.showNotice?.(NOTICE_AUTO);
    else this.showNotice?.(NOTICE_FULL, { red: true });
    this.notifyChange();
    return next;
  }

  setConfirmFullAccess(fn: () => Promise<boolean>): void {
    this.#confirmFullAccess = fn;
  }

  rememberFor(callId: string | undefined): void {
    const key = callId === undefined ? undefined : this.pendingKeys.get(callId);
    if (key !== undefined) this.sessionAllowed.add(key);
  }

  decisionFor(callId: string | undefined): "allow" | "ask" | "deny" | undefined {
    return callId === undefined ? undefined : this.#decisions.get(callId);
  }

  recordDecision(callId: string | undefined, decision: "allow" | "ask" | "deny"): void {
    if (callId === undefined) return;
    // Calls that never request approval still get a decision. Bound their history.
    this.#decisions.delete(callId);
    this.#decisions.set(callId, decision);
    if (this.#decisions.size > 256) this.#decisions.delete(this.#decisions.keys().next().value!);
  }

  describe(): { plan: boolean; permission: PermissionMode; badges: string[] } {
    const badges: string[] = [];
    if (this.plan) badges.push("plan");
    badges.push(this.permission === "full" ? "FULL ACCESS" : this.permission);
    return { plan: this.plan, permission: this.permission, badges };
  }

  /** Handle a "/command" line; returns the reply text, or undefined if unknown. */
  runCommand(line: string): string | undefined {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    if (cmd === "/plan") {
      const arg = rest[0];
      if (arg === "on" && !this.plan) this.togglePlan();
      else if (arg === "off" && this.plan) this.togglePlan();
      else if (arg === undefined) this.togglePlan();
      return `Plan mode: ${this.plan ? "on (read-only)" : "off (build)"}`;
    }
    if (cmd === "/permissions") {
      if (this.log.length === 0) return "No permission decisions yet this session.";
      return this.log
        .slice(-20)
        .map((e) => `${e.decision.toUpperCase()} (${e.via}) ${e.tool} ${e.summary.split("\n")[0] ?? ""}`)
        .join("\n");
    }
    return undefined;
  }
}

function execSummary(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "bash") return String(args.command ?? args.cmd ?? "");
  if (typeof args.path === "string") return args.path;
  if (typeof args.file_path === "string") return args.file_path;
  return JSON.stringify(args).slice(0, 160);
}

function judgeRoute(ctx: DshContext): JudgeRoute {
  // bruine.json models.fast, falling back to the main selection.
  const models = readBruineJson().models as
    | { fast?: { provider?: string; model?: string } }
    | undefined;
  const fast = models?.fast;
  if (fast?.provider !== undefined && fast?.model !== undefined) {
    return { provider: fast.provider, model: fast.model };
  }
  const selection = ctx.get("agentDefaultModel")?.currentSelection();
  return { provider: selection?.provider ?? "unknown", model: selection?.model ?? "unknown" };
}

export function apply(ctx: DshContext): void {
  const modes = new Modes(readDefaultMode());

  modes.governs = (subject: unknown): boolean => {
    const root = repl?.agent ?? modes.governed;
    if (root === undefined || subject === undefined) return false;
    if (subject === root) return true;
    const registry = ctx.get("agents") as {
      list?(): Array<{ session?: { id?: unknown } }>;
      isOwnedBy?(id: unknown, owner: unknown): boolean;
    } | undefined;
    if (registry?.list === undefined || registry.isOwnedBy === undefined) return false;
    const owned = new Set<unknown>([root]);
    const candidates = registry.list();
    // The registry exposes direct ownership, so walk it to cover descendants.
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of candidates) {
        if (owned.has(candidate) || candidate.session?.id === undefined) continue;
        for (const parent of owned) {
          if (!registry.isOwnedBy(candidate.session.id, parent)) continue;
          owned.add(candidate);
          changed = true;
          break;
        }
      }
    }
    return owned.has(subject);
  };

  let repl: BruineRepl | undefined;
  ctx.inject(["bruineRepl"], (c: any) => {
    repl = c.bruineRepl;
    const ui = repl?.ui;
    if (ui !== undefined) {
      const anyUi = ui as unknown as {
        askChoice(title: string, items: Array<{ value: string; label: string }>): Promise<number>;
        confirmFullAccess?: () => Promise<boolean>;
        showNotice?: (text: string, opts?: { red?: boolean }) => void;
      };
      modes.setConfirmFullAccess(async () => {
        if (typeof anyUi.confirmFullAccess === "function") {
          return anyUi.confirmFullAccess();
        }
        const choice = await anyUi.askChoice(FULL_CONFIRM_TITLE, [
          { value: "cancel", label: "Cancel" },
          { value: "enable", label: "Enable" },
        ]);
        return choice === 1;
      });
      modes.showNotice = (text, opts) => {
        try {
          anyUi.showNotice?.(text, opts);
        } catch {
          // notice is best effort
        }
      };
      const refreshFooter = () => {
        ui.footer.set({ badges: modes.describe().badges });
        ui.requestRender();
      };
      modes.onChange(refreshFooter);
      refreshFooter();
      // Plan toggles append a message to the model context (cache rule: the
      // system prompt and tools never change).
      modes.announce = (text) => {
        try {
          repl?.agent?.inject?.(
            createUserMessage({
              content: [{ type: "text", text }],
              source: { kind: "user" },
            }),
          );
        } catch {
          // announcement is best effort
        }
      };
    } else if (repl?.agent !== undefined) {
      modes.announce = (text) => {
        try {
          repl?.agent?.inject?.(
            createUserMessage({
              content: [{ type: "text", text }],
              source: { kind: "user" },
            }),
          );
        } catch {
          // non-TTY: still announce
        }
      };
    }
  });

  ctx.provide(BRUINE_MODES_SERVICE, modes);

  const judge = async (toolName: string, summary: string): Promise<JudgeVerdict> => {
    // T18.7: oversized commands are never sent to the model.
    if (summary.length > JUDGE_MAX_COMMAND_CHARS) return { decision: "ASK" };
    const llm: JudgeLlm | undefined = ctx.get("llm");
    const route = judgeRoute(ctx);
    const message = createUserMessage({
      content: [{ type: "text", text: judgePrompt(`${toolName} ${summary}`) }],
      source: { kind: "plugin", plugin: "bruine-modes" },
    });
    return askJudge(llm, route, [message]);
  };

  // The gate (T16.C): bruine's own pre-tool decision. The tools array and the
  // system prompt never change, so the prompt cache survives mode flips.
  let screenUi: { screen: { write(s: string): void }; icons: { fail: string } } | undefined;
  ctx.inject(["bruineRender"], (c: any) => {
    screenUi = c.bruineRender?.screen;
  });
  let judgeWarned = false;
  const reportUnavailable = (reason: string): void => {
    if (judgeWarned) return;
    judgeWarned = true;
    const line = `auto: judge unavailable (${reason}), asking instead`;
    const ui = repl?.ui;
    if (ui !== undefined) {
      ui.addChat(new Text(dim(line), 1, 0));
      ui.requestRender();
    } else if (screenUi !== undefined) {
      screenUi.screen.write(`\n${line}\n`);
    }
  };

  ctx.on("tools/pre-execute", async (exec: any, next: () => Promise<any>) => {
    // T42: the gate governs the REPL agent *and* whatever agent a headless run
    // registered. It used to bail out when there was no REPL, which meant a
    // REPL-less process ran every tool undecided with the sandbox open.
    if (!modes.governs(exec.agent)) return next();
    // There is a terminal to ask on only when a REPL published a UI. Without
    // one, `ask` has no answer, so it becomes `deny`: failing open would make
    // the gate decorative.
    const canAsk = repl?.ui !== undefined;
    const args = parseArgs(String(exec.arguments ?? "{}"));
    const summary = execSummary(exec.name, args);
    const rule = decide(exec.name, args, {
      mode: modes.permission,
      plan: modes.plan,
      sessionAllowed: modes.sessionAllowed,
      projectDir: process.cwd(),
      mcp: (tool) => mcpPolicy(ctx.get(BRUINE_MCP_SERVICE) as BruineMcpService | undefined, tool),
    });

    let decision:
      | { kind: "allow" }
      | { kind: "ask"; reason?: string }
      | { kind: "deny"; reason: string };
    let via = "rule";
    switch (rule) {
      case "allow":
        decision = { kind: "allow" };
        break;
      case "deny":
        decision = {
          kind: "deny",
          reason:
            "Plan mode is on: do not modify files or run modifying commands. Press Tab (or /plan off) to switch to Build.",
        };
        break;
      case "judge": {
        // T42: no judge in headless. Its only possible answers are ALLOW and
        // ASK, and a terminal-less `ask` is already a deny, so a second model
        // call would buy nothing but latency nobody asked for.
        if (!canAsk) {
          via = "no-terminal";
          decision = { kind: "deny", reason: NO_TERMINAL_DENY };
          break;
        }
        const verdict = await judge(exec.name, summary);
        via = "fast-model";
        if (verdict.unavailable !== undefined) reportUnavailable(verdict.unavailable);
        decision = verdict.decision === "ALLOW" ? { kind: "allow" } : { kind: "ask", reason: summary };
        break;
      }
      case "ask":
      default: {
        if (!canAsk) {
          via = "no-terminal";
          decision = { kind: "deny", reason: NO_TERMINAL_DENY };
          break;
        }
        decision = { kind: "ask", reason: summary };
        if (exec.callId !== undefined) modes.pendingKeys.set(String(exec.callId), ruleKey(exec.name, args));
        break;
      }
    }
    modes.log.push({ tool: exec.name, summary, decision: decision.kind, via });
    modes.recordDecision(exec.callId === undefined ? undefined : String(exec.callId), decision.kind);
    return decision;
  });
}
