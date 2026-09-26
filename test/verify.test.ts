import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { formatVerification, runVerification, verificationPlan } from "../src/plugins/verify.js";

describe("/verify", () => {
  test("chooses configured Node checks and reports their actual results", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumo-verify-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@12.0.0", scripts: { typecheck: "tsc --noEmit", test: "vitest run" } }));
      expect(verificationPlan(dir).map((check) => check.command)).toEqual(["pnpm run typecheck", "pnpm test"]);
      const called: string[] = [];
      const results = await runVerification(dir, async (command) => {
        called.push(command);
        return { code: command.includes("typecheck") ? 0 : 1, output: "check output", timedOut: false, truncated: false };
      });
      expect(called).toEqual(["pnpm run typecheck", "pnpm test"]);
      expect(formatVerification(results)).toContain("Verification: 1/2 passed");
      expect(formatVerification(results)).toContain("Tests: failed");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
