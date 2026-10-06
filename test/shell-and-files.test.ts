import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { formatShell, isShellLine, runShell } from "../src/plugins/shell.js";
import { createAutocomplete, fuzzyScore, walkProject } from "../src/ui/file-complete.js";

describe("!command (UI polish 2026-09-26)", () => {
  test("detection", () => {
    expect(isShellLine("!git status")).toBe(true);
    expect(isShellLine("  !ls")).toBe(true);
    expect(isShellLine("!")).toBe(false);
    expect(isShellLine("hello !x")).toBe(false);
  });
  test("runs in the cwd, shows output and exit code, never claims it went to the model", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bruine-shell-"));
    writeFileSync(join(dir, "hello.txt"), "hi\n");
    const r = await runShell(process.platform === "win32" ? "dir" : "ls", dir);
    expect(r.code).toBe(0);
    const text = formatShell("ls", r);
    expect(text).toContain("hello.txt");
    expect(text).toContain("exit 0 · not sent to the model");
    const bad = await runShell("exit 3", dir);
    expect(formatShell("exit 3", bad)).toContain("exit 3");
  });
});

describe("@ files without fd (UI polish 2026-09-26)", () => {
  const root = mkdtempSync(join(tmpdir(), "bruine-files-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(root, "src", "math.ts"), "");
  writeFileSync(join(root, "README.md"), "");
  writeFileSync(join(root, "node_modules", "junk", "math.js"), "");

  test("the walker skips node_modules and returns files and folders", () => {
    const paths = walkProject(root).map((e) => e.path).sort();
    expect(paths).toEqual(["README.md", "src/", "src/math.ts"]);
  });
  test("fuzzy scoring prefers basename matches, accepts subsequences, rejects misses", () => {
    expect(fuzzyScore("src/math.ts", "math")).toBeGreaterThan(fuzzyScore("docs/mathematics/x.ts", "math") - 100);
    expect(fuzzyScore("src/math.ts", "smt")).toBeGreaterThan(0);
    expect(fuzzyScore("src/math.ts", "zzz")).toBe(0);
  });
  test("the provider suggests @src/math.ts for @mat, with no fd", async () => {
    const p = createAutocomplete([], root, null) as unknown as {
      getFuzzyFileSuggestions: (q: string, o: { signal: AbortSignal }) => Promise<Array<{ value: string; label: string }>>;
    };
    const s = await p.getFuzzyFileSuggestions("mat", { signal: new AbortController().signal });
    expect(s[0]).toMatchObject({ value: "@src/math.ts", label: "math.ts" });
  });
});

describe("!cmd on Windows runs in PowerShell, like the agent's commands", () => {
  const on = (found: string[]) => (p: string): boolean => found.includes(p);
  const env = { PATH: ["C:\\Program Files\\PowerShell\\7", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0"].join(";") };

  test("pwsh first, then Windows PowerShell, with no profile and the policy bypassed for this run", async () => {
    const { shellInvocation } = await import("../src/plugins/shell.js");
    const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const withPwsh = shellInvocation("ls", "win32", env, on([pwsh, ps]));
    expect(withPwsh.file).toBe(pwsh);
    expect(withPwsh.args).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "ls"]);
    expect(withPwsh.shell).toBe(false);
    expect(shellInvocation("ls", "win32", env, on([ps])).file).toBe(ps);
  });

  test("no PowerShell at all: cmd.exe, through Node's shell; elsewhere the user's shell", async () => {
    const { shellInvocation } = await import("../src/plugins/shell.js");
    expect(shellInvocation("dir", "win32", env, on([]))).toEqual({ file: "dir", args: [], shell: true });
    expect(shellInvocation("ls", "linux", env, on([]))).toEqual({ file: "ls", args: [], shell: true });
  });
});
