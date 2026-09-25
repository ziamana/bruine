/**
 * The kumo permission gate — pure rules (T16.C). Modes never change the tool
 * catalog or system prompt (ARCHITECTURE section 0 cache rule): enforcement
 * happens here, on `tools/pre-execute`, plus appended announcement messages.
 */

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

/** bash commands that are read-only (first word, exact). */
export const READONLY_COMMANDS: ReadonlySet<string> = new Set([
  "ls", "cat", "head", "tail", "wc", "pwd", "which", "whereis", "whoami",
  "date", "env", "printenv", "uname", "df", "du", "free", "uptime",
  "find", "grep", "rg", "tree", "echo", "printf", "sort", "uniq", "jq",
  "less", "diff", "file", "stat", "type", "alias", "ps",
]);

/** `git` sub-commands that are read-only. */
export const GIT_READONLY: ReadonlySet<string> = new Set([
  "status", "log", "diff", "show", "branch", "remote", "config", "ls-files",
]);

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
  /\bdd\b/,
  /\bmkfs\b/,
  /\.ssh\b/,
  /\.env\b/,
  /\.[zbo]sh(rc|profile)?\b/, // shell config / dotfiles
  /\bcrontab\b/,
  /\b(launchctl|systemctl)\b/,
];

export interface ExecLike {
  name: string;
  /** Raw JSON arguments string, exactly as the model produced them. */
  arguments: string;
}

export interface DecisionContext {
  mode: PermissionMode;
  plan: boolean;
  /** Keys the user chose "Always for this session" for. */
  sessionAllowed: ReadonlySet<string>;
  /** Absolute project dir. */
  projectDir: string;
  /** POSIX-style path normalization hook (win32 in production stays plain). */
  isAbsoluteWithin?: (target: string, root: string) => boolean;
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

/** Stable identity for a call's "always allow" rule (coarse by design). */
export function ruleKey(name: string, args: Record<string, unknown>): string {
  if (name === "bash") {
    const command = String(args.command ?? args.cmd ?? "").trim();
    const first = command.split(/\s+/)[0] ?? "";
    return `bash:${first}`;
  }
  return name;
}

function isReadonlyBash(command: string): boolean {
  const words = command.trim().split(/\s+/);
  const first = words[0] ?? "";
  if (first === "git") return GIT_READONLY.has(words[1] ?? "");
  if (first === "find") {
    // `find … -delete` is a mutation
    return !/\s-delete\b/.test(command);
  }
  return READONLY_COMMANDS.has(first);
}

function withinDir(target: string, root: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const t = norm(target);
  const r = norm(root);
  return t === r || t.startsWith(`${r}/`);
}

/**
 * Decide a tool call under the current mode. "judge" means: consult the fast
 * model (auto mode); the caller maps it to allow/ask.
 */
export function decide(name: string, execArgs: Record<string, unknown>, ctx: DecisionContext): Rule {
  // Plan mode refuses mutations in EVERY permission mode: that is what makes
  // a plan trustworthy. Read-only work continues in all modes.
  if (ctx.plan && (WRITE_TOOLS.has(name) || name === "bash")) {
    if (name === "bash" && isReadonlyBash(String(execArgs.command ?? execArgs.cmd ?? ""))) {
      return "allow";
    }
    return "deny";
  }

  if (ctx.mode === "full") return "allow";
  if (ctx.sessionAllowed.has(ruleKey(name, execArgs))) return "allow";

  if (READ_ONLY_TOOLS.has(name)) return "allow";

  if (name === "bash") {
    const command = String(execArgs.command ?? execArgs.cmd ?? "");
    if (ALWAYS_ASK_PATTERNS.some((re) => re.test(command))) return "ask";
    if (ctx.mode === "ask") return "ask";
    if (isReadonlyBash(command)) return "allow";
    return "judge";
  }

  if (WRITE_TOOLS.has(name)) {
    if (ctx.mode === "ask") return "ask";
    const path = String(execArgs.path ?? execArgs.file_path ?? "");
    // Relative paths resolve against the project directory (cwd) → inside.
    const absolute = /^([A-Za-z]:[\\/]|[\\/])/.test(path);
    const inside = path === "" || !absolute || withinDir(path, ctx.projectDir);
    return inside ? "allow" : "ask";
  }

  // Unknown / future tools: never silent.
  return ctx.mode === "ask" ? "ask" : "judge";
}
