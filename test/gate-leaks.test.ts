import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { bashLeaks, decide } from "../src/gate/rules.js";

describe("gate: read-only commands that still leak (BOS review 2026-09-26)", () => {
  const proj = mkdtempSync(join(tmpdir(), "gate-leak-"));
  writeFileSync(join(proj, ".env"), "KEY=x\n");
  symlinkSync(join(proj, ".env"), join(proj, "notes.txt"));
  mkdirSync(join(proj, "src"));
  writeFileSync(join(proj, "src", "a.ts"), "x");
  const ctx = (mode: string, plan = false) => ({ mode, plan, sessionAllowed: new Set(), projectDir: proj }) as any;
  const asks: string[] = [
    "echo $BRUINE_ALIBABA_API_KEY", "echo ${OPENAI_API_KEY}", "printf %s $GITHUB_TOKEN",
    "cat /proc/self/environ", "cat notes.txt", "grep -r sk- /home", "cat ~/.bashrc", "ls ..",
  ];
  for (const command of asks) {
    test(`auto asks: ${command}`, () => expect(decide("bash", { command }, ctx("auto"))).toBe("ask"));
    test(`plan asks: ${command}`, () => expect(decide("bash", { command }, ctx("auto", true))).toBe("ask"));
  }
  const allows = ["ls", "cat src/a.ts", "grep -r foo src", "echo hello", "ls src", "rg https://example.com src", "echo $HOME"];
  for (const command of allows) {
    test(`auto still allows: ${command}`, () => expect(decide("bash", { command }, ctx("auto"))).toBe("allow"));
  }
  test("full access is not second-guessed", () => {
    expect(decide("bash", { command: "echo $OPENAI_API_KEY" }, ctx("full"))).toBe("allow");
  });
  test("bashLeaks is pure on plain words", () => {
    expect(bashLeaks("wc -l README", proj)).toBe(false);
  });
});
