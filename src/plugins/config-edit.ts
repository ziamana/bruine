import { configReadPath } from "../compat.js";
import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

/** The files `/config` opens, in the order a person edits them. `.env` holds keys and is never opened for you. */
const CONFIG_FILES = ["settings.yaml", "bruine.json"] as const;

/**
 * Editors that take over the terminal kumo is drawing in. Opening one from inside the
 * screen would fight it for the keyboard, so an `$EDITOR` that is one of these is passed
 * over rather than launched.
 */
const TERMINAL_EDITORS = new Set([
  "vi", "vim", "nvim", "neovim", "ex", "ed", "nano", "pico", "micro", "joe", "jed", "mcedit",
  "emacs", "emacsclient", "hx", "helix", "kak", "kakoune", "tilde", "ne", "fte", "e3",
]);

/** Graphical editors worth finding on their own, the one a desktop is likely to have first. */
const GUI_EDITORS = ["kate", "kwrite", "gedit", "xed", "mousepad", "pluma", "code", "codium", "subl", "zed"] as const;

/** The config files that exist under `home`, as absolute paths. */
export function configFiles(home: string, exists: (p: string) => boolean = existsSync): string[] {
  return [join(home, "settings.yaml"), configReadPath(home)].filter((p) => exists(p));
}

/** How an editor is launched: the program, what goes before the files, and where the choice came from. */
export interface EditorChoice {
  command: string;
  args: string[];
  source: string;
}

function baseName(command: string): string {
  return command.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? command;
}

/** `kate -n` is the program `kate` with the argument `-n`: an editor setting is a command line. */
function splitCommand(line: string): { command: string; args: string[] } | undefined {
  const parts = line.match(/"[^"]*"|'[^']*'|\S+/g)?.map((p) => p.replace(/^(["'])(.*)\1$/, "$2"));
  const [command, ...args] = parts ?? [];
  return command === undefined || command === "" ? undefined : { command, args };
}

function onPath(command: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean): boolean {
  if (/[\\/]/.test(command)) return exists(command);
  const dirs = (env.PATH ?? "").split(delimiter).filter((d) => d !== "");
  const names = process.platform === "win32" ? [command, `${command}.exe`, `${command}.cmd`] : [command];
  return dirs.some((dir) => names.some((name) => exists(join(dir, name))));
}

/** What kumo.json says under `editor`, or nothing: a missing or broken file is no opinion. */
function editorFromKumoJson(home: string): string | undefined {
  try {
    const doc = JSON.parse(readFileSync(configReadPath(home), "utf8")) as { editor?: unknown };
    return typeof doc.editor === "string" && doc.editor.trim() !== "" ? doc.editor : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The editor to open the config in, and why.
 *
 * What the user said wins: `KUMO_EDITOR`, then `editor` in kumo.json. After that the
 * desktop's own: `$VISUAL` and `$EDITOR` when they are graphical, then a graphical editor
 * found on the PATH (Kate before the rest), then the system's opener. A terminal editor
 * is never launched from inside the screen.
 */
export function resolveEditor(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
): EditorChoice | undefined {
  const stated: Array<[string, string | undefined]> = [
    ["KUMO_EDITOR", env.KUMO_EDITOR],
    ["bruine.json", editorFromKumoJson(home)],
  ];
  for (const [source, line] of stated) {
    const split = line === undefined ? undefined : splitCommand(line);
    if (split !== undefined) return { ...split, source };
  }
  for (const source of ["VISUAL", "EDITOR"] as const) {
    const split = splitCommand(env[source] ?? "");
    if (split !== undefined && !TERMINAL_EDITORS.has(baseName(split.command).toLowerCase())) return { ...split, source };
  }
  for (const name of GUI_EDITORS) {
    if (onPath(name, env, exists)) return { command: name, args: [], source: "PATH" };
  }
  if (platform === "darwin") return { command: "open", args: ["-t"], source: "system" };
  if (platform === "win32") return { command: "notepad", args: [], source: "system" };
  return onPath("xdg-open", env, exists) ? { command: "xdg-open", args: [], source: "system" } : undefined;
}

export type Spawner = (command: string, args: string[], options: SpawnOptions) => ReturnType<typeof spawn>;

export interface OpenResult {
  ok: boolean;
  /** The program that was launched, for the line that says so. */
  editor: string;
  /** Why it could not be opened. */
  error?: string;
}

/**
 * Launch the editor on the files, detached: closing kumo must not close the editor, and
 * the editor must not read kumo's keyboard. Resolves once the program has started, or
 * says why it could not.
 */
export function openInEditor(
  choice: EditorChoice,
  files: readonly string[],
  spawner: Spawner = spawn,
  platform: NodeJS.Platform = process.platform,
): Promise<OpenResult> {
  const editor = baseName(choice.command);
  // xdg-open takes one file; every other opener takes them all.
  const batches = choice.command === "xdg-open" ? files.map((f) => [f]) : [[...files]];
  return new Promise((resolve) => {
    let started = 0;
    const done = (result: OpenResult): void => resolve(result);
    for (const batch of batches) {
      try {
        // A shell on Windows splits on spaces: the paths are quoted for it.
        const operands = platform === "win32" ? batch.map((f) => `"${f}"`) : batch;
        const child = spawner(choice.command, [...choice.args, ...operands], {
          detached: true,
          stdio: "ignore",
          shell: platform === "win32",
          windowsHide: false,
        });
        child.once("error", (err: NodeJS.ErrnoException) =>
          done({ ok: false, editor, error: err.code === "ENOENT" ? `${choice.command} was not found` : err.message }),
        );
        child.once("spawn", () => {
          child.unref();
          started += 1;
          if (started === batches.length) done({ ok: true, editor });
        });
      } catch (err) {
        done({ ok: false, editor, error: (err as Error).message });
        return;
      }
    }
  });
}
