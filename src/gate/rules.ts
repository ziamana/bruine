/**
 * The bruine permission gate — pure rules (T16.C, hardened by T18). Modes never
 * change the tool catalog or system prompt (ARCHITECTURE section 0 cache
 * rule): enforcement happens here, on `tools/pre-execute`, plus appended
 * announcement messages.
 */
import path from "node:path";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";

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
  // Agent-internal state, no effect on the machine (seen asking for approval on the real server, 2026-09-26).
  "todo_write",
  "skill",
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
  "uname", "df", "du", "free", "uptime",
  "grep", "rg", "echo", "printf", "uniq", "jq",
  "diff", "file", "stat", "type", "alias", "ps",
]);

/** Characters that turn "one simple read-only command" into anything goes (T18.1). */
const NOT_SIMPLE = /[;&|<>`]|\$\(|\n/;
/** These options can execute a helper, even though the command looks read-only. */
const EXECUTABLE_OPTION = /--(?:pre|ext-diff|textconv)(?=$|[=\s'"\\])/;

/** find flags that make it a mutation (T18.2 + T19.B prefix match). */
const FIND_MUTATING = /\s-(exec|ok|fprint|fls|delete)/;
/** find flags that WRITE or EXECUTE — never allow, always ask (T19.B). */
const FIND_DANGEROUS = /\s-(exec|execdir|ok|okdir|fprint|fprintf|fls)/;
/** Piping anything into an interpreter is a download-and-run shape (T19.B). */
const PIPE_TO_INTERPRETER = /[|]\s*(sh|bash|zsh|fish|python3?|node|perl|ruby|pwsh|powershell|iex)\b/;

/** `git config` is read-only only in query mode (T18.2). */
function gitConfigReadonly(args: string[]): boolean {
  return ["--get", "--get-regexp", "--list", "-l"].includes(args[0] ?? "");
}

interface GitParsed {
  /** Whether -c <key=value> (config injection) was passed before the sub-command. */
  hasConfig: boolean;
  sub: string;
  args: string[];
}

/**
 * Skip git's GLOBAL options (-C, -c, --git-dir, --work-tree, …) to reach the
 * real sub-command (T19.B): `git -C /tmp/r push` is a push.
 * Returns null when the shape cannot be understood.
 */
export function parseGit(words: string[]): GitParsed | null {
  let i = 1; // words[0] === "git"
  let hasConfig = false;
  while (i < words.length) {
    const w = words[i]!;
    if (w === "-c") {
      hasConfig = true;
      i += 2;
      continue;
    }
    if (w === "-C" || w === "--git-dir" || w === "--work-tree" || w === "--namespace" || w === "--exec-path") {
      i += 2;
      continue;
    }
    if (/^--(git-dir|work-tree|namespace|exec-path)=/.test(w)) {
      i += 1;
      continue;
    }
    if (w.startsWith("-")) return null; // unknown global option: unparseable
    return { hasConfig, sub: w, args: words.slice(i + 1) };
  }
  return null;
}

/** Structural danger for git beyond the plain regexes (T19.B). */
export function isDangerousGit(command: string): boolean {
  const words = command.trim().split(/\s+/);
  if (words[0] !== "git") return false;
  const parsed = parseGit(words);
  if (parsed === null) return false;
  if (parsed.hasConfig) return true; // git -c core.pager='sh -c evil' log
  if (parsed.sub === "push" || parsed.sub === "clean") return true;
  if (parsed.sub === "reset" && parsed.args.includes("--hard")) return true;
  return false;
}

function gitReadonly(words: string[], command: string): boolean {
  const parsed = parseGit(words);
  if (parsed === null || parsed.hasConfig) return false;
  if (FIND_OUTPUT.test(command) && ["log", "show", "diff"].includes(parsed.sub)) return false;
  switch (parsed.sub) {
    case "status":
    case "ls-files":
      return true;
    case "log":
    case "diff":
    case "show":
      return true;
    case "branch":
      return !GIT_BRANCH_MUTATING.test(command);
    case "remote":
      return parsed.args.length === 0 || (parsed.args.length === 1 && parsed.args[0] === "-v");
    case "config":
      return gitConfigReadonly(parsed.args);
    default:
      return false;
  }
}

/** log/show/diff writing files via --output is a mutation (T19.B row 1). */
const FIND_OUTPUT = /(?:^|\s)--output\b/;

/** git branch is read-only only without destructive/moving flags (T18.2). */
const GIT_BRANCH_MUTATING = /\s-(d|D|m|M|c|C)\b|--delete\b|--move\b|--copy\b/;

/** bash command fragments that must always ask, in every mode below full. */
export const ALWAYS_ASK_PATTERNS: readonly RegExp[] = [
  /^\s*printenv\b/, // may print API keys into the model's tool result
  EXECUTABLE_OPTION,
  /\brm\s+(-[a-zA-Z]+\s+)*[-a-zA-Z]*[rR]/, // rm -r / -R / -rf / --recursive
  /\bsudo\b/,
  /\bgit\s+push\b/,
  /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|fish)\b/,
  /\b(npm|pnpm|yarn|bun|pip|pip3|uv|cargo|brew|apt|apt-get|dnf|pacman)\s+(install|add|remove|uninstall)\b/,
  /\b(scp|rsync|sftp|nc)\b/,
  /\bkill\b|\bpkill\b|\bkillall\b/,
  /\bchmod\b|\bchown\b/,
  /\bgit\s+(reset\s+--hard|clean)\b/,
  /\bgit\s+config\s+--(global|system)\b/, // T18 row: global config hijack
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
  /(^|[/\\])\.profile\b/,
  /(^|[/\\])\.zprofile\b/,
  /(^|[/\\])\.config[/\\]fish[/\\]/,
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
  if (NOT_SIMPLE.test(command) || EXECUTABLE_OPTION.test(command)) return false;
  const words = command.trim().split(/\s+/);
  const first = words[0] ?? "";
  if (first === "find") return !FIND_MUTATING.test(command);
  if (first === "git") return gitReadonly(words, command);
  return READONLY_COMMANDS.has(first);
}

/** An environment variable whose value is probably a secret. */
const SECRET_VAR = /\$\{?[A-Za-z_]*(KEY|TOKEN|SECRET|PASS|PASSWORD|PASSWD|AUTH|CREDENTIAL|COOKIE|SESSION)[A-Za-z0-9_]*\}?/i;
/** Whole-environment dumps. */
const ENV_DUMP = /\/proc\/[^\s/]+\/environ\b|\benviron\b/;

function expandHome(word: string): string {
  if (word === "~") return homedir();
  if (word.startsWith("~/")) return path.join(homedir(), word.slice(2));
  return word;
}

/**
 * Does a bash command leak something it should not, even when every word looks
 * read-only? Secret-looking variables ($OPENAI_API_KEY), environment dumps
 * (/proc/self/environ), a path argument that resolves to a sensitive file (a
 * symlink named notes.txt pointing at .env), or a path outside the project
 * (T16: reads outside the project always ask). Exported for tests.
 */
export function bashLeaks(command: string, projectDir: string): boolean {
  if (SECRET_VAR.test(command) || ENV_DUMP.test(command)) return true;
  const words = command.trim().split(/\s+/).slice(1);
  for (const raw of words) {
    const w = raw.replace(/^['"]|['"]$/g, "");
    if (w === "" || w.startsWith("-")) continue;
    const looksLikePath = w.startsWith("/") || w.startsWith("~") || w.startsWith("..") || w.includes("/");
    if (!looksLikePath && !existsSync(path.resolve(projectDir, w))) continue;
    const target = expandHome(w);
    if (isSensitiveTarget(target, projectDir)) return true;
    if (looksLikePath && !isPathInside(target, projectDir)) return true;
  }
  return false;
}

/** Sensitive location in a path or command (T18.4). Exported for tests. */
export function isSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(text));
}

function isSensitiveTarget(target: string, projectDir: string): boolean {
  if (isSensitive(target)) return true;
  try {
    return isSensitive(realpathSync(path.resolve(projectDir, target)));
  } catch {
    return false;
  }
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
  // Resolve existing ancestors: a new file below a symlink can leave the
  // project even though its lexical path starts inside it. Synthetic win32
  // paths on non-Windows hosts (used in tests) have no native realpath.
  const nativePath = process.platform === "win32" ? mod === path.win32 : mod === path;
  if (nativePath && existsSync(root)) {
    try {
      root = realpathSync(root);
      const missing: string[] = [];
      let parent = abs;
      for (;;) {
        try {
          abs = mod.join(realpathSync(parent), ...missing.reverse());
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
          // A dangling symlink is not a missing file that can be reconstructed.
          try { if (lstatSync(parent).isSymbolicLink()) return false; } catch { /* absent */ }
          const next = mod.dirname(parent);
          if (next === parent) return false;
          missing.push(mod.basename(parent));
          parent = next;
        }
      }
    } catch {
      return false;
    }
  }
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
  // Read-only in Plan, but a read-only command can still leak a secret: ask then.
  if (ctx.plan && isBash && isReadonlyBash(command)) return bashLeaks(command, ctx.projectDir) ? "ask" : "allow";
  if (ctx.plan && (WRITE_TOOLS.has(name) || isBash)) {
    return "deny";
  }

  // 2. Full access asks for nothing.
  if (ctx.mode === "full") return "allow";

  // 3. Danger that no session rule may cover.
  if (
    isBash &&
    (ALWAYS_ASK_PATTERNS.some((re) => re.test(command)) ||
      isDangerousGit(command) ||
      FIND_DANGEROUS.test(command) ||
      PIPE_TO_INTERPRETER.test(command) ||
      isSensitive(command))
  ) {
    return "ask";
  }
  if (WRITE_TOOLS.has(name)) {
    const target = String(execArgs.path ?? execArgs.file_path ?? "");
    if (isSensitive(target)) return "ask";
  }
  if (name === "read" || name === "read_image") {
    const target = String(execArgs.path ?? execArgs.file_path ?? "");
    if (isSensitiveTarget(target, ctx.projectDir)) return "ask";
  }
  // BOS review 2026-09-26: secrets and outside reads that a "read-only" command
  // still leaks into the model's context (and so to a cloud provider).
  if (isBash && bashLeaks(command, ctx.projectDir)) return "ask";

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
