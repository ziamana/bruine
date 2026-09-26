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
import type { Component } from "@earendil-works/pi-tui";
import { runTool, hasTool, type RunTool } from "../platform/tool.js";
import { fileLink } from "./links.js";
import { ansi } from "./theme.js";
import { relCwd } from "./tool-call-component.js";

/** Paths to a status, keyed by the path git reports (relative to the repo root). */
export type GitStatus = ReadonlyMap<string, string>;

export interface ChangedFile {
  path: string;
  /** git's own two-letter code, trimmed: `M`, `A`, `D`, `R`, `??`. */
  status: string;
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
  if (opts.before !== undefined && after !== undefined) return changedSince(opts.before, after);
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
    const paths = shown.map((f) => this.#link(f.path));
    const label = ansi.gray("changed");
    const more = rest > 0 ? ansi.gray(`  +${String(rest)} more`) : "";
    const line = `  ${label}  ${ansi.text(paths.join("  "))}${more}`;
    // The OSC 8 wrapper is invisible but has width: measure what the user sees.
    const cells = 2 + visibleWidthOf(paths, shown) + (rest > 0 ? 2 + String(rest).length + 6 : 0);
    if (cells > width) return [`  ${label}  ${ansi.gray(`${String(this.files.length)} files`)}`];
    return [line];
  }

  #link(path: string): string {
    const shown = relCwd(isAbsolute(path) ? path : join(this.cwd, path));
    return fileLink(shown, isAbsolute(path) ? path : join(this.cwd, path));
  }

  invalidate(): void {}
}

/** Cell width of the joined path list, links measured as their text. */
function visibleWidthOf(paths: readonly string[], files: readonly ChangedFile[]): number {
  return paths.reduce((sum, p, i) => sum + relCwd(files[i]?.path ?? "").length + (i === 0 ? 0 : 2), 0);
}
