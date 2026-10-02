/**
 * T59 — what the turn did to the files.
 *
 * A tool call says what it was asked to do (`write src/ui/mouse.ts`), and a
 * receipt says how long the turn took. Neither says what is now different on
 * disk, which is the only question that matters after a command ran: a `bash`
 * line that ends in a quiet `ok` could have touched eleven files, and nothing in
 * the transcript would ever admit it.
 *
 * So the turn is measured against the workspace, not against the tool names.
 * `git status --porcelain` is read at the start of the turn and at the end, and
 * the difference is what the turn did. That is ground truth rather than a guess:
 * it covers a `sed -i` in a command just as well as a `write` tool, and it costs
 * two process spawns per turn.
 *
 * Outside a git workspace there is nothing to measure against, and the honest
 * fallback is what the tools themselves declared. That is a smaller claim, and
 * the two are never mixed: git wins, wholesale.
 */

import { isAbsolute, join } from "node:path";
import stringWidth from "string-width";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { runTool, hasTool, type RunTool } from "../platform/tool.js";
import { fileLink } from "./links.js";
import { ansi } from "./theme.js";
import { relCwd } from "./tool-call-component.js";
import { clipStart } from "../render/reasoning.js";

/** Paths to a status, keyed by the path git reports (relative to the repo root). */
export type GitStatus = ReadonlyMap<string, string>;

export interface ChangedFile {
  path: string;
  /** git's own two-letter code, trimmed: `M`, `A`, `D`, `R`, `??`. */
  status: string;
  /**
   * Lines added and removed in the workspace, when git can count them.
   *
   * Undefined is the honest answer for a file git does not diff numerically (an
   * untracked file, a binary one) and outside a repository: the path is still
   * shown, without a number that would be a guess.
   */
  added?: number;
  removed?: number;
}

/** How long git gets before we assume the workspace is not measurable. */
const GIT_TIMEOUT_MS = 4000;

/**
 * `git status --porcelain=v1 -z` into a map.
 *
 * `-z` because a path may hold a space, a quote or anything else a porcelain
 * line would otherwise quote and escape, and because NUL is the only separator
 * that cannot appear in a filename. A rename carries its source in the next
 * field, which is skipped: the destination is the path that exists now.
 */
export function parsePorcelain(raw: string): GitStatus {
  const out = new Map<string, string>();
  const fields = raw.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i] as string;
    if (field.length < 4) continue;
    const code = `${field[0]}${field[1]}`.trim();
    const path = field.slice(3);
    if (code.startsWith("R") || code.startsWith("C")) i += 1;
    if (path !== "") out.set(path, code);
  }
  return out;
}

/**
 * What a turn did: the paths that differ between two readings of the workspace.
 *
 * A path that changed *state* (modified, then deleted) is still something the
 * turn did, so the union of both sides is taken rather than the intersection of
 * the codes. The code reported is the later one, which is the state the user is
 * going to look at.
 */
export function changedSince(before: GitStatus, after: GitStatus): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const [path, code] of after) {
    if (before.get(path) === code) continue;
    out.push({ path, status: code });
  }
  for (const [path, code] of before) {
    if (after.has(path)) continue;
    out.push({ path, status: "gone" });
  }
  return out;
}

/**
 * `git diff --numstat -z` into a path -> [added, removed] map.
 *
 * `-z` for the same reason the porcelain reader needs it: a filename may hold a
 * space, a quote or a tab. A binary file reports `-\t-`, which is not a number, and
 * is left out rather than counted as zero.
 */
export function parseNumstat(raw: string): Map<string, { added: number; removed: number }> {
  const out = new Map<string, { added: number; removed: number }>();
  const fields = raw.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const row = fields[i] as string;
    const tab = row.indexOf("\t");
    if (tab < 0) continue;
    const added = Number(row.slice(0, tab));
    const removed = Number(row.slice(tab + 1, row.indexOf("\t", tab + 1)));
    const path = row.slice(row.indexOf("\t", tab + 1) + 1);
    if (!Number.isFinite(added) || !Number.isFinite(removed) || path === "") continue;
    out.set(path, { added, removed });
  }
  return out;
}

/** The workspace's status, or undefined when there is nothing to measure. */
export async function gitStatus(cwd: string, run: RunTool = runTool): Promise<GitStatus | undefined> {
  if (!(await hasTool("git"))) return undefined;
  const result = await run("git", ["status", "--porcelain=v1", "-z"], {
    timeoutMs: GIT_TIMEOUT_MS,
  });
  // Outside a repository git exits 128, and a failure is not a measurement.
  if (result.code !== 0) return undefined;
  return parsePorcelain(result.stdout.toString("utf8"));
}

/** The working tree's per-file line counts, or undefined when git cannot say. */
export async function gitNumstat(cwd: string, run: RunTool = runTool): Promise<Map<string, { added: number; removed: number }> | undefined> {
  if (!(await hasTool("git"))) return undefined;
  const result = await run("git", ["diff", "--numstat", "-z", "HEAD"], { timeoutMs: GIT_TIMEOUT_MS });
  if (result.code !== 0) return undefined;
  // `git diff HEAD` counts what is staged and what is not, against the commit: an
  // untracked file is not in it at all, and a new file appears only once staged.
  // Those two are reported without numbers rather than with ones that would be a
  // guess about lines nobody has counted yet.
  return parseNumstat(result.stdout.toString("utf8"));
}

export interface TurnChangesOptions {
  /** The reading taken when the turn started. Undefined means unmeasurable. */
  before: GitStatus | undefined;
  /** The paths the turn's own tools named, for a workspace git cannot measure. */
  declared?: readonly string[];
  cwd: string;
  run?: RunTool;
}

/**
 * The one rule for attribution: git when it can answer, the tools when it
 * cannot, and never a blend of the two.
 */
export async function turnChanges(opts: TurnChangesOptions): Promise<ChangedFile[]> {
  const after = await gitStatus(opts.cwd, opts.run);
  if (opts.before !== undefined && after !== undefined) {
    // The counts are read from the working tree as it is now, not from the diff
    // between the two readings: the user wants to know how big the change is, and a
    // file the turn edited twice is one file with one size.
    const counts = await gitNumstat(opts.cwd, opts.run);
    return changedSince(opts.before, after).map((file) => {
      const n = counts?.get(file.path);
      return n === undefined ? file : { ...file, added: n.added, removed: n.removed };
    });
  }
  const seen = new Set<string>();
  const out: ChangedFile[] = [];
  for (const path of opts.declared ?? []) {
    if (path === "" || seen.has(path)) continue;
    seen.add(path);
    // The tool said it wrote here. Whether the file existed before is not
    // something the tool said, so the code stays the neutral one.
    out.push({ path, status: "M" });
  }
  return out;
}

/** How many paths are printed before the rest becomes a count. */
const SHOWN_PATHS = 3;

/**
 * The line under the receipt: what this turn did to the files.
 *
 * Paths first and strongest, because they are the payload; the count last and
 * dim, because it is arithmetic. A line that cannot fit its paths is dropped
 * rather than wrapped: a wrapped path list is a path list nobody reads.
 */
export class ChangedFilesComponent implements Component {
  constructor(
    private readonly files: readonly ChangedFile[],
    private readonly cwd: string,
  ) {}

  render(width: number): string[] {
    if (this.files.length === 0 || width < 12) return [];
    const shown = this.files.slice(0, SHOWN_PATHS);
    const rest = this.files.length - shown.length;
    const label = ansi.gray("changed");
    const more = rest > 0 ? ansi.gray(`  +${String(rest)} more`) : "";
    // The payload is the path and its size: `src/ui/mouse.ts +12 -3` says what the
    // turn did, where a bare list of paths says only that something happened. A file
    // git could not count keeps its path and shows no number.
    // Three answers, best first: the paths with their sizes, the paths alone, and
    // only then the count. The sizes are what a turn actually did, so they are the
    // first thing to go, not the first thing to squeeze everything else out of.
    const prefix = 2 + visibleWidth("changed") + 2 + (rest > 0 ? 2 + String(rest).length + 6 : 0);
    for (const counted of [true, false]) {
      const rows = shown.map((f) => this.#entry(f, width - prefix, counted));
      const cells = rows.reduce((n, r) => n + r.width, 0) + Math.max(0, rows.length - 1) * 2;
      if (prefix + cells <= width) return [`  ${label}  ${rows.map((r) => r.text).join("  ")}${more}`];
    }
    return [`  ${label}  ${ansi.gray(`${String(this.files.length)} files`)}`];
  }

  /**
   * One file: the shortest path that still names it, and its counters.
   *
   * Clipped from the LEFT, because the end of a path is the file name and the part
   * that goes is the part a person already knows (they are in the directory). The
   * link still points at the absolute path.
   */
  #entry(file: ChangedFile, width: number, counted: boolean): { text: string; width: number } {
    const absolute = isAbsolute(file.path) ? file.path : join(this.cwd, file.path);
    const rel = relCwd(absolute);
    const counts = counted ? fileCounts(file) : "";
    const room = Math.max(8, width - (counts === "" ? 0 : visibleWidth(counts) + 1));
    // Clipped from the left, like every other path in the app: the end of a path is
    // the file name, and the part that goes is the directory the user is already in.
    const name = clipStart(rel, room, "…");
    const linked = fileLink(name, absolute);
    const text = counts === "" ? linked : `${linked} ${counts}`;
    return { text, width: stringWidth(name) + (counts === "" ? 0 : visibleWidth(counts) + 1) };
  }

  invalidate(): void {}
}

/** `+12 -3`, the counts git could give, in the two colours that mean them. */
function fileCounts(file: ChangedFile): string {
  if (file.added === undefined || file.removed === undefined) return "";
  const out: string[] = [];
  if (file.added > 0) out.push(ansi.green(`+${String(file.added)}`));
  if (file.removed > 0) out.push(ansi.red(`-${String(file.removed)}`));
  return out.join(" ");
}
