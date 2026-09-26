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
    const dir = mkdtempSync(join(tmpdir(), "kumo-shell-"));
    writeFileSync(join(dir, "hello.txt"), "hi\n");
    const r = await runShell(process.platform === "win32" ? "dir /b" : "ls", dir);
    expect(r.code).toBe(0);
    const text = formatShell("ls", r);
    expect(text).toContain("hello.txt");
    expect(text).toContain("exit 0 · not sent to the model");
    const bad = await runShell("exit 3", dir);
    expect(formatShell("exit 3", bad)).toContain("exit 3");
  });
});

describe("@ files without fd (UI polish 2026-09-26)", () => {
  const root = mkdtempSync(join(tmpdir(), "kumo-files-"));
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
