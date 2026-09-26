/**
 * "@" file completion. pi-tui's CombinedAutocompleteProvider finds files with the `fd`
 * binary and returns nothing without it, which is most Windows and macOS machines.
 * kumo passes fd when it is installed (fast, respects .gitignore) and otherwise swaps in
 * a small Node walker with the same suggestion shape.
 */
import { CombinedAutocompleteProvider, type SlashCommand } from "@earendil-works/pi-tui";
import { existsSync, readdirSync } from "node:fs";
import { basename, delimiter, join, relative } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", ".next", ".nuxt",
  ".venv", "venv", "__pycache__", ".cache", ".turbo", "coverage", ".idea", ".vscode",
]);

/** The fd binary on PATH (fd, Debian's fdfind, or fd.exe), or null. */
export function findFd(env: NodeJS.ProcessEnv = process.env): string | null {
  const names = process.platform === "win32" ? ["fd.exe", "fd.cmd"] : ["fd", "fdfind"];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Subsequence score: consecutive and basename matches rank higher; 0 = no match. */
export function fuzzyScore(path: string, query: string): number {
  if (query === "") return 1;
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  if (basename(p).includes(q)) return 100 - Math.min(50, p.length / 4);
  if (p.includes(q)) return 60 - Math.min(40, p.length / 4);
  let i = 0;
  for (const ch of p) if (ch === q[i]) i += 1;
  return i === q.length ? 20 - Math.min(15, p.length / 8) : 0;
}

/** Walk the project (bounded) and return files and folders relative to root. */
export function walkProject(root: string, maxEntries = 5000, maxDepth = 8): Array<{ path: string; isDirectory: boolean }> {
  const out: Array<{ path: string; isDirectory: boolean }> = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0 && out.length < maxEntries) {
    const { dir, depth } = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      const full = join(dir, e.name);
      const rel = relative(root, full).split("\\").join("/");
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        out.push({ path: `${rel}/`, isDirectory: true });
        if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile()) {
        out.push({ path: rel, isDirectory: false });
      }
      if (out.length >= maxEntries) break;
    }
  }
  return out;
}

function completionValue(path: string, quoted: boolean): string {
  return quoted || path.includes(" ") ? `@"${path}"` : `@${path}`;
}

/** The editor's provider: slash commands + "@" files, with or without fd. */
export function createAutocomplete(commands: SlashCommand[], basePath: string, fdPath: string | null = findFd()): CombinedAutocompleteProvider {
  const provider = new CombinedAutocompleteProvider(commands, basePath, fdPath);
  const argumentCommand = (lines: string[], cursorLine: number, cursorCol: number) => {
    const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
    const match = /^\/([^\s]+)\s(.*)$/.exec(before);
    if (match === null) return undefined;
    const command = commands.find((item) => item.name === `/${match[1]}`);
    if (command?.getArgumentCompletions === undefined) return undefined;
    return { command, prefix: match[2] ?? "" };
  };
  const originalSuggestions = provider.getSuggestions.bind(provider);
  const originalFileTrigger = provider.shouldTriggerFileCompletion.bind(provider);
  // pi-tui matches argument commands without their leading slash, while kumo
  // stores slash-prefixed names. Handle those arguments before file fallback.
  provider.getSuggestions = async (lines, cursorLine, cursorCol, options) => {
    const argument = argumentCommand(lines, cursorLine, cursorCol);
    if (argument !== undefined && !/(?:^|\s)@\S*$/.test(argument.prefix)) {
      const items = await argument.command.getArgumentCompletions!(argument.prefix);
      return items === null || items.length === 0 ? null : { items, prefix: argument.prefix };
    }
    return originalSuggestions(lines, cursorLine, cursorCol, options);
  };
  provider.shouldTriggerFileCompletion = (lines, cursorLine, cursorCol) =>
    argumentCommand(lines, cursorLine, cursorCol) !== undefined || originalFileTrigger(lines, cursorLine, cursorCol);
  if (fdPath === null) {
    (provider as unknown as {
      getFuzzyFileSuggestions: (q: string, o: { signal: AbortSignal; isQuotedPrefix?: boolean }) => Promise<unknown[]>;
    }).getFuzzyFileSuggestions = async (query, options) => {
      if (options.signal.aborted) return [];
      return walkProject(basePath)
        .map((e) => ({ ...e, score: fuzzyScore(e.path, query) }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
        .slice(0, 20)
        .map(({ path, isDirectory }) => {
          const display = isDirectory ? path.slice(0, -1) : path;
          return {
            value: completionValue(isDirectory ? `${display}/` : display, options.isQuotedPrefix === true),
            label: basename(display) + (isDirectory ? "/" : ""),
            description: display,
          };
        });
    };
  }
  return provider;
}
