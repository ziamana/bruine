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

/** `ps e` / `ps eww` / `ps auxe` print every process's environment, API keys included. */
const PS_ENVIRONMENT = /^ps\s(?:[^\n]*\s)?(?!-)[A-Za-z]*e[A-Za-z]*(?:\s|$)|^ps\b[^\n]*--environment/;

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
  // Cloud, cluster and registry credentials, and the tool's own config (MCP tokens may sit in it).
  /(^|[/\\])\.(aws|gnupg|kube|azure)([/\\]|$)/,
  /(^|[/\\])\.config[/\\](gh|gcloud|glab-cli)([/\\]|$)/,
  /(^|[/\\])\.docker[/\\]config\.json\b/,
  /(^|[/\\])\.(netrc|git-credentials)\b|(^|[/\\])_netrc\b/,
  /(^|[/\\])(bruine|kumo)\.json\b/,
];

export interface DecisionContext {
  mode: PermissionMode;
  plan: boolean;
  /** Full commands / tool names the user chose "Always for this session" for. */
  sessionAllowed: ReadonlySet<string>;
  /** Absolute project dir. */
  projectDir: string;
  /** Folders outside the project that may be read without asking (the installed skills). */
  readRoots?: readonly string[];
  /**
   * What the user said about the MCP server a tool comes from, when it is one (`mcp__<server>__…`):
   * `readOnly` servers only read, `allowed` is a tool on the server's `alwaysAllow` list.
   */
  mcp?: (name: string) => { readOnly: boolean; allowed: boolean } | undefined;
}

/**
 * A call's arguments as an object. dsh hands `tools/pre-execute` the arguments already
 * parsed (`ToolExecutionInput.arguments: unknown`); the raw JSON string is accepted too.
 *
 * It used to take only the string, and was called as `parseArgs(String(exec.arguments))`:
 * an object became "[object Object]", which parses to nothing, so every bash call was
 * judged as `bash` with no command. Read-only commands always asked, and an "Always" on
 * one command was remembered as `bash:`, which then allowed every command after it.
 */
export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw !== null && typeof raw === "object") return Array.isArray(raw) ? {} : (raw as Record<string, unknown>);
  if (typeof raw !== "string") return {};
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
  if (SHELL_TOOLS.has(name)) {
    return `${name}:${String(args.command ?? args.cmd ?? "").trim()}`;
  }
  return name;
}

/**
 * The tools that run a command line: `bash` everywhere dsh finds a POSIX shell, `pwsh` on
 * Windows (dsh mounts tool-pwsh instead of tool-bash there). Both are analysed command by
 * command; an "Always" on one command never covers another.
 */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "pwsh"]);

/** PowerShell cmdlets (and their usual aliases) that only read, when they are one simple command. */
export const READONLY_PWSH: ReadonlySet<string> = new Set([
  "get-childitem", "gci", "ls", "dir",
  "get-content", "gc", "cat", "type",
  "get-location", "gl", "pwd",
  "select-string", "sls",
  "test-path", "get-item", "gi", "resolve-path", "rvpa", "split-path", "join-path",
  "get-command", "gcm", "get-help", "where.exe",
  "get-date", "get-host", "hostname", "whoami",
  "write-output", "echo", "write-host",
  "measure-object", "get-filehash", "compare-object", "get-process", "ps",
]);

/** A PowerShell command that is never simple: chaining, pipelines, redirects, scripts, subexpressions. */
const PWSH_NOT_SIMPLE = /[;&|<>`{}]|\$\(|@\(|\n/;

/** PowerShell shapes that always ask, whatever the mode's rules say (Windows twins of ALWAYS_ASK_PATTERNS). */
export const PWSH_ALWAYS_ASK: readonly RegExp[] = [
  /\b(remove-item|ri|rm|rmdir|rd|del|erase)\b[^\n]*-(r|recurse)\b/i,
  /\b(remove-item|ri|del|erase)\b[^\n]*-force\b/i,
  /\b(invoke-expression|iex)\b/i,
  /\b(start-process|saps|start)\b[^\n]*-verb\s+runas\b/i,
  /\bset-executionpolicy\b/i,
  /\b(stop-process|spps|kill|taskkill)\b/i,
  /\b(restart-computer|stop-computer|shutdown)\b/i,
  /\b(format-volume|clear-disk|initialize-disk|remove-partition)\b/i,
  /\b(set-itemproperty|new-itemproperty|remove-itemproperty)\b[^\n]*\b(hklm|hkcu|registry::)/i,
  /\breg(\.exe)?\s+(add|delete|import)\b/i,
  /\b(schtasks|sc(\.exe)?\s+(create|delete|config)|netsh|icacls|takeown|bcdedit)\b/i,
  /\b(invoke-webrequest|iwr|invoke-restmethod|irm|curl|wget)\b[^\n]*\|\s*(iex|invoke-expression|pwsh|powershell)\b/i,
  /\b(install-module|install-package|winget\s+install|choco\s+install|scoop\s+install)\b/i,
  /\b(set-content|add-content|out-file|new-item|copy-item|move-item|rename-item)\b[^\n]*\$(env:)?(profile|home)\b/i,
];

/** One simple read-only PowerShell command. Exported for tests. */
export function isReadonlyPwsh(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed === "" || PWSH_NOT_SIMPLE.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  const first = (words[0] ?? "").toLowerCase();
  if (first === "git" || first === "git.exe") return isReadonlyBash(["git", ...words.slice(1)].join(" "));
  return READONLY_PWSH.has(first);
}

/** One simple read-only command (T18.1 + T18.2). Exported for tests. */
export function isReadonlyBash(command: string): boolean {
  if (NOT_SIMPLE.test(command) || EXECUTABLE_OPTION.test(command)) return false;
  const words = command.trim().split(/\s+/);
  const first = words[0] ?? "";
  if (first === "find") return !FIND_MUTATING.test(command);
  if (first === "ps") return !PS_ENVIRONMENT.test(command.trim());
  if (first === "git") return gitReadonly(words, command);
  return READONLY_COMMANDS.has(first);
}

/** An environment variable whose value is probably a secret. */
const SECRET_VAR = /\$\{?(?:env:)?[A-Za-z_]*(KEY|TOKEN|SECRET|PASS|PASSWORD|PASSWD|AUTH|CREDENTIAL|COOKIE|SESSION)[A-Za-z0-9_]*\}?/i;
/** Whole-environment dumps. */
const ENV_DUMP = /\/proc\/[^\s/]+\/environ\b|\benviron\b|\b(get-childitem|gci|ls|dir)\s+env:|\[environment\]::getenvironmentvariables/i;

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
    const looksLikePath = w.startsWith("/") || w.startsWith("~") || w.startsWith("..") || w.includes("/") ||
      // Windows: a drive (C:\…), a UNC share (\\host\…) or any backslash path.
      /^[A-Za-z]:[\\/]/.test(w) || w.includes("\\");
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

/** The tools that look at files and take a path: reading outside the project is the user's call. */
const FILE_LOOKUP_TOOLS: ReadonlySet<string> = new Set(["read", "read_image", "glob", "grep"]);

/** Where a file-lookup call points: its path, or an absolute/home glob pattern. */
function lookupTargets(name: string, args: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["path", "file_path", "directory"]) if (typeof args[key] === "string") out.push(args[key] as string);
  if (name === "glob" && typeof args.pattern === "string" && /^(?:[/\\~]|[A-Za-z]:)/.test(args.pattern)) out.push(args.pattern);
  return out;
}

/** Does a file-lookup call touch a secret, or leave the project and the readable roots? */
export function lookupLeaks(name: string, args: Record<string, unknown>, projectDir: string, readRoots: readonly string[] = []): boolean {
  for (const raw of lookupTargets(name, args)) {
    const target = expandHome(raw.trim());
    if (isSensitiveTarget(target, projectDir)) return true;
    if (!isPathInside(target, projectDir) && !readRoots.some((root) => isPathInside(target, root))) return true;
  }
  return false;
}

/**
 * A URL web_fetch must not reach without asking: this machine, the LAN, a link-local or cloud
 * metadata address, or a URL with a password in it. The URL parser has already turned 2130706433
 * and 0x7f.1 into 127.0.0.1. A name that merely resolves to a private address is not caught here.
 */
export function isPrivateUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return true;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true;
  if (!host.includes(".") && !host.includes(":")) return true; // an intranet name: "nas", "router"
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    return host.startsWith("::ffff:"); // an IPv4 address in IPv6 clothes: ask, whichever it is
  }
  return false;
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
  const isPwsh = name === "pwsh";
  const isShell = isBash || isPwsh;
  const command = isShell ? String(execArgs.command ?? execArgs.cmd ?? "") : "";
  const readonly = isBash ? isReadonlyBash(command) : isPwsh ? isReadonlyPwsh(command) : false;

  // 1. Plan mode refuses mutations in EVERY permission mode; simple
  // read-only commands keep working without interruption.
  // Read-only in Plan, but a read-only command can still leak a secret: ask then.
  if (ctx.plan && isShell && readonly) return bashLeaks(command, ctx.projectDir) ? "ask" : "allow";
  if (ctx.plan && (WRITE_TOOLS.has(name) || isShell)) {
    return "deny";
  }
  // An MCP tool is an action on someone else's system (an issue filed, a row written) unless the
  // user declared its server read-only: Plan mode refuses it like any other change.
  const mcp = name.startsWith("mcp__") ? ctx.mcp?.(name) ?? { readOnly: false, allowed: false } : undefined;
  if (ctx.plan && mcp !== undefined && !mcp.readOnly) return "deny";

  // 2. Full access asks for nothing.
  if (ctx.mode === "full") return "allow";

  // 3. Danger that no session rule may cover. The bash patterns read PowerShell too (git push,
  // npm install, rm -r are the same words there); PowerShell adds its own cmdlets.
  if (
    isShell &&
    (ALWAYS_ASK_PATTERNS.some((re) => re.test(command)) ||
      isDangerousGit(command) ||
      FIND_DANGEROUS.test(command) ||
      PIPE_TO_INTERPRETER.test(command) ||
      (isPwsh && PWSH_ALWAYS_ASK.some((re) => re.test(command))) ||
      isSensitive(command))
  ) {
    return "ask";
  }
  if (WRITE_TOOLS.has(name)) {
    const target = String(execArgs.path ?? execArgs.file_path ?? "");
    if (isSensitive(target)) return "ask";
    // "Always for this session" on write/edit is for this project: a path outside it asks every time.
    if (!isPathInside(target, ctx.projectDir)) return "ask";
  }
  if (FILE_LOOKUP_TOOLS.has(name) && lookupLeaks(name, execArgs, ctx.projectDir, ctx.readRoots)) return "ask";
  if (name === "web_fetch" && isPrivateUrl(String(execArgs.url ?? ""))) return "ask";
  // BOS review 2026-09-26: secrets and outside reads that a "read-only" command
  // still leaks into the model's context (and so to a cloud provider).
  if (isShell && bashLeaks(command, ctx.projectDir)) return "ask";

  // 4. "Always for this session" rules.
  if (ctx.sessionAllowed.has(ruleKey(name, execArgs))) return "allow";

  // 5. Read-only tools, and the MCP tools the user let run on their own.
  if (READ_ONLY_TOOLS.has(name)) return "allow";
  if (mcp !== undefined && (mcp.readOnly || mcp.allowed)) return "allow";

  if (isShell) {
    if (ctx.mode === "ask") return "ask";
    return readonly ? "allow" : "judge";
  }

  if (WRITE_TOOLS.has(name)) {
    if (ctx.mode === "ask") return "ask";
    const target = String(execArgs.path ?? execArgs.file_path ?? "");
    return isPathInside(target, ctx.projectDir) ? "allow" : "ask";
  }

  // Unknown / future tools: never silent.
  return ctx.mode === "ask" ? "ask" : "judge";
}
