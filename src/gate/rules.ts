/**
 * The kumo permission gate — pure rules (T16.C, hardened by T18). Modes never
 * change the tool catalog or system prompt (ARCHITECTURE section 0 cache
 * rule): enforcement happens here, on `tools/pre-execute`, plus appended
 * announcement messages.
 */
import path from "node:path";

export type PermissionMode = "ask" | "auto" | "full";

export type Rule = "allow" | "ask" | "judge" | "deny";

/** Real dsh tool names that are read-only by construction. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "read_image",
  "glob",
  "grep",
  "web_fetch",
  "web_search",
  "ask_user_question",
  "job_list",
  "job_output",
  "subagent",
  "subagent_fork",
]);

/** File-mutating tools. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "write",
  "edit",
  "str_replace_editor",
]);

/**
 * bash commands that are read-only when they are ONE simple command
 * (T18.1: no chaining/redirects/substitution) (first word, exact).
 * T18.2 removed: env, less, sort (-o), tree (-o), date.
 */
export const READONLY_COMMANDS: ReadonlySet<string> = new Set([
  "ls", "cat", "head", "tail", "wc", "pwd", "which", "whereis", "whoami",
  "printenv", "uname", "df", "du", "free", "uptime",
  "grep", "rg", "echo", "printf", "uniq", "jq",
  "diff", "file", "stat", "type", "alias", "ps",
]);

/** Characters that turn "one simple read-only command" into anything goes (T18.1). */
const NOT_SIMPLE = /[;&|<>`]|\$\(|\n/;

/** find flags that make it a mutation (T18.2). */
const FIND_MUTATING = /\s-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)\b/;

/** `git config` is read-only only in query mode (T18.2). */
function gitConfigReadonly(words: string[]): boolean {
  return ["--get", "--get-regexp", "--list", "-l"].includes(words[2] ?? "");
}

/** git branch is read-only only without destructive/moving flags (T18.2). */
const GIT_BRANCH_MUTATING = /\s-(d|D|m|M|c|C)\b|--delete\b|--move\b|--copy\b/;

/** bash command fragments that must always ask, in every mode below full. */
export const ALWAYS_ASK_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-[a-zA-Z]+\s+)*[-a-zA-Z]*[rR]/, // rm -r / -R / -rf / --recursive
  /\bsudo\b/,
  /\bgit\s+push\b/,
  /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|fish)\b/,
  /\b(npm|pnpm|yarn|bun|pip|pip3|uv|cargo|brew|apt|apt-get|dnf|pacman)\s+(install|add|remove|uninstall)\b/,
  /\b(scp|rsync|sftp|nc)\b/,
  /\bkill\b|\bpkill\b|\bkillall\b/,
  /\bchmod\b|\bchown\b/,
  /\bgit\s+(reset\s+--hard|clean)\b/,
  /\bgit\s+config\s+--global\b/, // T18 row: global config hijack
  /\bgit\s+branch\b[^\n]*(\s-(d|D|m|M|c|C)\b|--delete\b|--move\b|--copy\b)/, // T18 row
  /\bfind\b[^\n]*-(exec|execdir|ok|okdir)\b/, // T18 row: -exec runs anything
  /\bdd\b/,
  /\bmkfs\b/,
  /\bcrontab\b/,
  /\b(launchctl|systemctl)\b/,
];

/**
 * Sensitive path fragments (T18.4) — ask even INSIDE the project, for both
 * write-tool paths and bash commands.
 */
export const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\.env\b|\.env[._A-Za-z0-9-]/, // .env, .env.local, .env.production, …
  /(^|[/\\])\.git([/\\]|\b)/,
  /(^|[/\\])\.ssh([/\\]|\b)/,
  /\.pem\b/i,
  /\.key\b/i,
  /id_rsa/,
  /id_ed25519/,
  /(^|[/\\])\.npmrc\b/,
  /(^|[/\\])\.pypirc\b/,
  /\.[zbo]sh(rc|profile)?\b/,
  /(^|[/\\])\.bashrc\b|(^|[/\\])\.bash_profile\b/,
];

export interface DecisionContext {
  mode: PermissionMode;
  plan: boolean;
  /** Full commands / tool names the user chose "Always for this session" for. */
  sessionAllowed: ReadonlySet<string>;
  /** Absolute project dir. */
  projectDir: string;
}

export function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Stable identity for a call's "always allow" rule. For bash the FULL trimmed
 * command (T18.6): remembering `rm -rf build` must not cover `rm -rf ~`.
 */
export function ruleKey(name: string, args: Record<string, unknown>): string {
  if (name === "bash") {
    return `bash:${String(args.command ?? args.cmd ?? "").trim()}`;
  }
  return name;
}

/** One simple read-only command (T18.1 + T18.2). Exported for tests. */
export function isReadonlyBash(command: string): boolean {
  if (NOT_SIMPLE.test(command)) return false;
  const words = command.trim().split(/\s+/);
  const first = words[0] ?? "";
  if (first === "find") return !FIND_MUTATING.test(command);
  if (first === "git") {
    const sub = words[1] ?? "";
    switch (sub) {
      case "status":
      case "log":
      case "diff":
      case "show":
      case "ls-files":
        return true;
      case "branch":
        return !GIT_BRANCH_MUTATING.test(command);
      case "remote":
        return words.length === 2 || (words.length === 3 && words[2] === "-v");
      case "config":
        return gitConfigReadonly(words);
      default:
        return false;
    }
  }
  return READONLY_COMMANDS.has(first);
}

/** Sensitive location in a path or command (T18.4). Exported for tests. */
export function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

function looksWin32(root: string, target: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || /^[A-Za-z]:[\\/]/.test(target) || target.includes("\\");
}

/**
 * Is the (possibly relative) target inside projectDir after resolution
 * (T18.3)? `~` targets are ALWAYS outside. win32-style paths compare
 * case-insensitively.
 */
export function isPathInside(target: string, projectDir: string): boolean {
  const raw = target.trim();
  if (raw === "") return true;
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\") || raw.startsWith("~")) {
    return false;
  }
  const mod = looksWin32(projectDir, raw) ? path.win32 : path;
  let abs = mod.resolve(projectDir, raw);
  let root = mod.resolve(projectDir);
  if (mod === path.win32) {
    abs = abs.toLowerCase();
    root = root.toLowerCase();
  }
  const rel = mod.relative(root, abs);
  return rel !== "" && !rel.startsWith("..") && !mod.isAbsolute(rel) ? true : rel === "";
}

/**
 * Decide a tool call under the current mode (T18.5 order: plan → full →
 * dangerous & sensitive → session rules → the rest). "judge" means: consult
 * the fast model (auto mode); the caller maps it to allow/ask. A dangerous
 * command can NEVER be covered by "Always".
 */
export function decide(
  name: string,
  execArgs: Record<string, unknown>,
  ctx: DecisionContext,
): Rule {
  const isBash = name === "bash";
  const command = isBash ? String(execArgs.command ?? execArgs.cmd ?? "") : "";

  // 1. Plan mode refuses mutations in EVERY permission mode; simple
  // read-only commands keep working without interruption.
  if (ctx.plan && isBash && isReadonlyBash(command)) return "allow";
  if (ctx.plan && (WRITE_TOOLS.has(name) || isBash)) {
    return "deny";
  }

  // 2. Full access asks for nothing.
  if (ctx.mode === "full") return "allow";

  // 3. Danger that no session rule may cover.
  if (isBash && (ALWAYS_ASK_PATTERNS.some((re) => re.test(command)) || isSensitive(command))) {
    return "ask";
  }
  if (WRITE_TOOLS.has(name)) {
    const target = String(execArgs.path ?? execArgs.file_path ?? "");
    if (isSensitive(target)) return "ask";
  }

  // 4. "Always for this session" rules.
  if (ctx.sessionAllowed.has(ruleKey(name, execArgs))) return "allow";

  // 5. Read-only tools.
  if (READ_ONLY_TOOLS.has(name)) return "allow";

  if (isBash) {
    if (ctx.mode === "ask") return "ask";
    return isReadonlyBash(command) ? "allow" : "judge";
  }

  if (WRITE_TOOLS.has(name)) {
    if (ctx.mode === "ask") return "ask";
    const target = String(execArgs.path ?? execArgs.file_path ?? "");
    return isPathInside(target, ctx.projectDir) ? "allow" : "ask";
  }

  // Unknown / future tools: never silent.
  return ctx.mode === "ask" ? "ask" : "judge";
}
