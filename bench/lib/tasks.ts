/**
 * T36 — task discovery and run planning. Pure over the fs: a task is a
 * directory under `bench/tasks/<id>/` holding `task.md` (the prompt) and
 * `check.sh` (exit 0 = pass), plus the tiny repo the agent works on.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

export interface Task {
  /** Directory name: the task id. */
  id: string;
  /** Absolute directory (under the task root, or the path given to --tasks). */
  dir: string;
}

export interface PlannedRun {
  task: Task;
  repeat: number;
  /** Stable key for resume: `<id>#<repeat>`. */
  key: string;
}

/** Category from the id prefix (`bug-…`, `feat-…`, …); unknown → "other". */
export function taskKind(id: string): string {
  const prefix = id.split("-")[0] ?? "";
  const known: Record<string, string> = {
    bug: "bugfix",
    feat: "feature",
    refactor: "refactor",
    read: "read",
    shell: "shell",
    trap: "trap",
  };
  return known[prefix] ?? "other";
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Every task directory under `tasksDir`, sorted by id. */
export async function listTasks(tasksDir: string): Promise<Task[]> {
  let names: string[];
  try {
    names = (await readdir(tasksDir)).sort();
  } catch {
    return [];
  }
  const out: Task[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const dir = join(tasksDir, name);
    if (await isDir(dir)) out.push({ id: name, dir });
  }
  return out;
}

/**
 * Resolve `--tasks` entries: an id under `tasksDir`, or a path to a task
 * directory. A missing id is an error (a silent "0 tasks" run would look like
 * a pass rate of nothing).
 */
export async function resolveTasks(tasksDir: string, wanted: string[]): Promise<Task[]> {
  if (wanted.length === 0) {
    const all = await listTasks(tasksDir);
    if (all.length === 0) throw new Error(`no task found under ${tasksDir}`);
    return all;
  }
  const out: Task[] = [];
  for (const entry of wanted) {
    const looksLikePath = entry.includes("/") || entry.includes("\\") || isAbsolute(entry);
    const dir = looksLikePath ? resolve(entry) : join(tasksDir, entry);
    if (!(await isDir(dir))) throw new Error(`task "${entry}" not found (looked in ${dir})`);
    const id = basename(dir);
    if (!(await hasTaskFiles(dir))) {
      throw new Error(`task "${id}" has no task.md + check.sh (looked in ${dir})`);
    }
    out.push({ id, dir });
  }
  return out;
}

/** Both files every task must ship. */
export async function hasTaskFiles(dir: string): Promise<boolean> {
  for (const name of ["task.md", "check.sh"]) {
    try {
      await stat(join(dir, name));
    } catch {
      return false;
    }
  }
  return true;
}

/** The prompt handed to the agent: task.md, verbatim. */
export async function readTaskPrompt(task: Task): Promise<string> {
  return (await readFile(join(task.dir, "task.md"), "utf8")).trim();
}

/**
 * task × repeat, in a stable order, minus the keys `done` already holds
 * (`--resume`). Repeats of one task are contiguous so a killed run resumes at
 * the task it stopped on.
 */
export function buildPlan(tasks: Task[], repeat: number, done: ReadonlySet<string> = new Set()): PlannedRun[] {
  const out: PlannedRun[] = [];
  for (const task of tasks) {
    for (let n = 1; n <= repeat; n++) {
      const key = `${task.id}#${String(n)}`;
      if (done.has(key)) continue;
      out.push({ task, repeat: n, key });
    }
  }
  return out;
}
