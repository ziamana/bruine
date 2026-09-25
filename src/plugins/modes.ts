import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { askJudge, judgePrompt, JUDGE_MAX_COMMAND_CHARS, type JudgeLlm, type JudgeRoute } from "../gate/judge.js";
import { decide, parseArgs, ruleKey, type PermissionMode } from "../gate/rules.js";
import type { DshContext, KumoRepl } from "./ctx.js";

/** Stable Cordis plugin name. */
export const name = "kumo-modes";

/** Service published for the REPL (Tab / Shift+Tab / slash commands) and approvals. */
export const KUMO_MODES_SERVICE = "kumoModes";

export const PLAN_ON_TEXT = "Plan mode is on: do not modify files or run modifying commands.";
export const PLAN_OFF_TEXT = "Plan mode is off.";

export interface ModesLogEntry {
  tool: string;
  summary: string;
  decision: "allow" | "ask" | "deny";
  via: string;
}

export interface KumoModesService {
  readonly plan: boolean;
  readonly permission: PermissionMode;
  togglePlan(): void;
  cyclePermission(): Promise<PermissionMode>;
  rememberFor(callId: string | undefined): void;
  readonly log: ModesLogEntry[];
  onChange(cb: () => void): () => void;
  describe(): { plan: boolean; permission: PermissionMode; badges: string[] };
  runCommand(line: string): string | undefined;
}

const PERMISSION_ORDER: PermissionMode[] = ["ask", "auto", "full"];

function readKumoJson(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  try {
    const home = env.DSH_HOME ?? join(homedir(), ".kumo");
    const path = join(home, "kumo.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readDefaultMode(env: NodeJS.ProcessEnv = process.env): PermissionMode {
  const v = readKumoJson(env).permissionMode;
  return v === "auto" || v === "full" || v === "ask" ? v : "ask";
}

export class Modes implements KumoModesService {
  plan = false;
  permission: PermissionMode = "ask";
  readonly log: ModesLogEntry[] = [];
  readonly sessionAllowed = new Set<string>();
  readonly pendingKeys = new Map<string, string>();
  #listeners: Array<() => void> = [];
  #confirmFullAccess: (() => Promise<boolean>) | undefined;
  /** Announce plan toggles into the model context (cache-safe: appended message). */
  announce: ((text: string) => void) | undefined;
  /** UI feedback for slash commands. */
  notify: ((text: string) => void) | undefined;

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

  togglePlan(): void {
    this.plan = !this.plan;
    this.announce?.(this.plan ? PLAN_ON_TEXT : PLAN_OFF_TEXT);
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

  describe(): { plan: boolean; permission: PermissionMode; badges: string[] } {
    const badges: string[] = [];
    if (this.plan) badges.push("PLAN");
    if (this.permission === "full") badges.push("FULL ACCESS");
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
  // kumo.json models.fast, falling back to the main selection.
  const models = readKumoJson().models as
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

  let repl: KumoRepl | undefined;
  ctx.inject(["kumoRepl"], (c: any) => {
    repl = c.kumoRepl;
    const ui = repl?.ui;
    if (ui !== undefined) {
      modes.setConfirmFullAccess(async () => {
        const choice = await ui.askChoice(
          "Switch to FULL ACCESS? kumo will stop asking before commands run.",
          [
            { value: "stay", label: "Stay in current mode" },
            { value: "full", label: "Yes, grant full access" },
          ],
        );
        return choice === 1;
      });
      modes.onChange(() => {
        repl?.ui?.footer.set({ badges: modes.describe().badges });
      });
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

  ctx.provide(KUMO_MODES_SERVICE, modes);

  const judge = async (toolName: string, summary: string): Promise<"ALLOW" | "ASK"> => {
    // T18.7: oversized commands are never sent to the model.
    if (summary.length > JUDGE_MAX_COMMAND_CHARS) return "ASK";
    const llm: JudgeLlm | undefined = ctx.get("llm");
    const route = judgeRoute(ctx);
    const message = createUserMessage({
      content: [{ type: "text", text: judgePrompt(`${toolName} ${summary}`) }],
      source: { kind: "plugin", plugin: "kumo-modes" },
    });
    return askJudge(llm, route, [message]);
  };

  // The gate (T16.C): kumo's own pre-tool decision. The tools array and the
  // system prompt never change, so the prompt cache survives mode flips.
  ctx.on("tools/pre-execute", async (exec: any, next: () => Promise<any>) => {
    const current = repl;
    if (current === undefined || exec.agent !== current.agent) return next();
    const args = parseArgs(String(exec.arguments ?? "{}"));
    const summary = execSummary(exec.name, args);
    const rule = decide(exec.name, args, {
      mode: modes.permission,
      plan: modes.plan,
      sessionAllowed: modes.sessionAllowed,
      projectDir: process.cwd(),
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
        const verdict = await judge(exec.name, summary);
        via = "fast-model";
        decision = verdict === "ALLOW" ? { kind: "allow" } : { kind: "ask", reason: summary };
        break;
      }
      case "ask":
      default: {
        decision = { kind: "ask", reason: summary };
        if (exec.callId !== undefined) modes.pendingKeys.set(String(exec.callId), ruleKey(exec.name, args));
        break;
      }
    }
    modes.log.push({ tool: exec.name, summary, decision: decision.kind, via });
    return decision;
  });
}
