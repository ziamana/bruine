import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { configFiles, openInEditor, resolveEditor, type Spawner } from "../src/plugins/config-edit.js";

const homes: string[] = [];
const home = (files: Record<string, string> = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), "bruine-config-"));
  homes.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }); });

/** A PATH that holds exactly these programs. */
const withPrograms = (...names: string[]) => ({
  env: { PATH: ["/bin", "/usr/bin"].join(delimiter) } as NodeJS.ProcessEnv,
  exists: (p: string) => names.some((n) => p.replaceAll("\\", "/") === `/usr/bin/${n}`),
});

describe("configFiles", () => {
  test("is the files that exist, settings first, and never .env", () => {
    const dir = home({ "bruine.json": "{}", "settings.yaml": "x: 1", ".env": "KEY=secret" });
    expect(configFiles(dir)).toEqual([join(dir, "settings.yaml"), join(dir, "bruine.json")]);
    expect(configFiles(home({ "bruine.json": "{}" }))).toEqual([expect.stringMatching(/bruine\.json$/)]);
    expect(configFiles(home())).toEqual([]);
  });
});

describe("resolveEditor: the user's word, then the desktop's", () => {
  test("BRUINE_EDITOR wins, with its arguments", () => {
    const { exists } = withPrograms("kate");
    expect(resolveEditor(home(), { PATH: "/usr/bin", BRUINE_EDITOR: "code --wait", VISUAL: "gedit" }, "linux", exists))
      .toEqual({ command: "code", args: ["--wait"], source: "BRUINE_EDITOR" });
  });

  test("then `editor` in bruine.json", () => {
    const dir = home({ "bruine.json": JSON.stringify({ editor: "kwrite" }) });
    const { env, exists } = withPrograms("kate");
    expect(resolveEditor(dir, env, "linux", exists)).toEqual({ command: "kwrite", args: [], source: "bruine.json" });
  });

  test("a quoted path with spaces stays one program", () => {
    expect(resolveEditor(home(), { BRUINE_EDITOR: '"/opt/My Editor/edit" -n' }, "linux", () => false))
      .toEqual({ command: "/opt/My Editor/edit", args: ["-n"], source: "BRUINE_EDITOR" });
  });

  test("$VISUAL and $EDITOR count when they are graphical", () => {
    const { exists } = withPrograms("kate");
    expect(resolveEditor(home(), { PATH: "/usr/bin", VISUAL: "gedit" }, "linux", exists)?.source).toBe("VISUAL");
    expect(resolveEditor(home(), { PATH: "/usr/bin", EDITOR: "/usr/bin/code" }, "linux", exists)).toMatchObject({ command: "/usr/bin/code", source: "EDITOR" });
  });

  test("a terminal editor is passed over, never launched from inside the screen", () => {
    const { exists } = withPrograms("kate");
    for (const editor of ["vim", "nvim", "nano", "/usr/bin/emacs", "micro", "hx"]) {
      const choice = resolveEditor(home(), { PATH: "/usr/bin", VISUAL: editor, EDITOR: editor }, "linux", exists);
      expect(choice, editor).toEqual({ command: "kate", args: [], source: "PATH" });
    }
  });

  test("with nothing said, a graphical editor on the PATH is found, Kate first", () => {
    const both = withPrograms("gedit", "kate");
    expect(resolveEditor(home(), both.env, "linux", both.exists)?.command).toBe("kate");
    const only = withPrograms("gedit");
    expect(resolveEditor(home(), only.env, "linux", only.exists)?.command).toBe("gedit");
  });

  test("and the system's opener is the last resort", () => {
    const xdg = withPrograms("xdg-open");
    expect(resolveEditor(home(), xdg.env, "linux", xdg.exists)).toEqual({ command: "xdg-open", args: [], source: "system" });
    expect(resolveEditor(home(), {}, "darwin", () => false)).toEqual({ command: "open", args: ["-t"], source: "system" });
    expect(resolveEditor(home(), {}, "win32", () => false)).toEqual({ command: "notepad", args: [], source: "system" });
    expect(resolveEditor(home(), { PATH: "/usr/bin" }, "linux", () => false)).toBeUndefined();
  });
});

/** A child process that starts, or fails to, on the next tick. */
function fakeSpawner(outcome: "spawn" | { code: string }) {
  const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
  const unref = vi.fn();
  const spawner = ((command: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = unref;
    queueMicrotask(() => {
      if (outcome === "spawn") child.emit("spawn");
      else child.emit("error", Object.assign(new Error("boom"), { code: outcome.code }));
    });
    return child;
  }) as unknown as Spawner;
  return { spawner, calls, unref };
}

describe("openInEditor", () => {
  const files = ["/h/settings.yaml", "/h/bruine.json"];

  test("launches the editor on both files, detached, with no stdio of bruine's", async () => {
    const { spawner, calls, unref } = fakeSpawner("spawn");
    const result = await openInEditor({ command: "kate", args: [], source: "PATH" }, files, spawner, "linux");
    expect(result).toEqual({ ok: true, editor: "kate" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(files);
    expect(calls[0]!.options).toMatchObject({ detached: true, stdio: "ignore" });
    expect(unref).toHaveBeenCalled();
  });

  test("keeps the editor's own arguments before the files", async () => {
    const { spawner, calls } = fakeSpawner("spawn");
    await openInEditor({ command: "code", args: ["--reuse-window"], source: "BRUINE_EDITOR" }, files, spawner, "linux");
    expect(calls[0]!.args).toEqual(["--reuse-window", ...files]);
  });

  test("xdg-open opens one file per call, because that is all it takes", async () => {
    const { spawner, calls } = fakeSpawner("spawn");
    const result = await openInEditor({ command: "xdg-open", args: [], source: "system" }, files, spawner, "linux");
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.args)).toEqual([[files[0]], [files[1]]]);
  });

  test("Notepad gets one file per call too: it ignores every file after the first", async () => {
    const { spawner, calls } = fakeSpawner("spawn");
    await openInEditor({ command: "notepad", args: [], source: "system" }, ["C:\\a.yaml", "C:\\b.json"], spawner, "win32");
    expect(calls.map((c) => c.args)).toEqual([['"C:\\a.yaml"'], ['"C:\\b.json"']]);
  });

  test("a program that is not there says so, in words", async () => {
    const { spawner } = fakeSpawner({ code: "ENOENT" });
    const result = await openInEditor({ command: "kate", args: [], source: "BRUINE_EDITOR" }, files, spawner, "linux");
    expect(result).toEqual({ ok: false, editor: "kate", error: "kate was not found" });
  });

  test("a spawn that throws is a failure, not a crash", async () => {
    const spawner = (() => { throw new Error("EACCES"); }) as unknown as Spawner;
    const result = await openInEditor({ command: "kate", args: [], source: "PATH" }, files, spawner, "linux");
    expect(result).toEqual({ ok: false, editor: "kate", error: "EACCES" });
  });

  test("on Windows the paths are quoted for the shell", async () => {
    const { spawner, calls } = fakeSpawner("spawn");
    await openInEditor({ command: "notepad", args: [], source: "system" }, ["C:\\Users\\a b\\settings.yaml"], spawner, "win32");
    expect(calls[0]!.args).toEqual(['"C:\\Users\\a b\\settings.yaml"']);
    expect(calls[0]!.options).toMatchObject({ shell: true });
  });
});
