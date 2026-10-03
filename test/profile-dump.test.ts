import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ensureProfile } from "../src/profile.js";
import { resolveDshEntry } from "../src/launch.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("profile composition (T15)", () => {
    test("dsh --dump-config carries bruine's identity, plugins and tools", async () => {
      const entry = resolveDshEntry();
      expect(entry).toBeDefined();
      const home = await mkdtemp(join(tmpdir(), "bruine-dump-"));
      const { dir } = await ensureProfile(home);
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        DSH_HOME: home,
        DSH_TELEMETRY_DISABLED: "1",
      };
      const add = spawnSync(
        process.execPath,
        [entry as string, "plugin", "--profile", "bruine", "add", repoRoot],
        { stdio: ["ignore", "pipe", "pipe"], env, cwd: repoRoot },
      );
      expect(add.status, String(add.stderr)).toBe(0);
      expect(dir).toBeTruthy();

      const dump = spawnSync(
        process.execPath,
        [entry as string, "--profile", "bruine", "--dump-config"],
        { encoding: "utf8", env },
      );
      expect(dump.status, dump.stderr).toBe(0);
      const out = dump.stdout;

      // Identity (T15.1)
      expect(out).toContain("includeHarnessIdentity: false");
      expect(out).toContain("You are bruine");
      expect(out).toContain("Your working directory is");
    // Plugins
    for (const needle of [
      "bruine/startup",
      "bruine/repl",
      "bruine/render",
      "bruine/approval",
      "bruine/modes",
      "bruine/web-search",
    ]) {
      expect(out).toContain(needle);
    }
    // Tools (T15.2) — fetch is already on the dsh-base tool-web row
    expect(out).toContain("dsh-tool-web");
    expect(out).toContain("dsh-tool-ask-user");
    for (const id of [
      "plan-mode", "tool-subagent-control", "tool-subagent-list-agents",
      "tool-subagent-fork", "tool-workflow", "tool-goal", "tool-ralph",
      "tool-str-replace-editor", "tool-present",
    ]) {
      const row = out.split(`- id: ${id}\n`)[1]?.split(/\n(?:# == |\- id: )/)[0];
      expect(row, id).toContain("disabled: !!js process.env.BRUINE_TOOLS !== 'full'");
    }
    // Modes groundwork (T16): sandbox left fully open, approvals always reach bruine
    expect(out).toContain("danger-full-access");
    expect(out).toMatch(/policy: *ask/);
      expect(out).toContain("dsh-subagent");
      // Search wiring (T15.3)
      expect(out).toContain("searchProvider");
      // T26: bruine owns USER skills — skill-filesystem's agentsHome is repointed
      // into $DSH_HOME (a dir bruine never fills), so ~/.agents/skills is no
      // longer read implicitly.
      expect(out).toMatch(
        /id: skill-filesystem[\s\S]{0,120}agentsHome: !!js dshHomePath\('agents'\)/,
      );
    }, 180_000);
});
