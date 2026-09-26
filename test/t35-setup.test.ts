/**
 * T35 — `kumo setup` on an existing install: prefill from settings.yaml,
 * change-one-thing menu, Skip everywhere.
 *
 * Unit: home with Aron's settings.yaml shape (compat + reasoningEfforts +
 * contextWindow, no kumo.json) → Models step lists the route as current;
 * Save without changes → settings.yaml semantically identical.
 */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";
import { SetupFlow } from "../src/setup/flow.js";
import { discoveredLabel, currentModelsSummary } from "../src/setup/discover.js";
import { loadPrefill, isExistingInstall } from "../src/setup/full.js";

const ARON_SETTINGS = `# Written by BOS on 2026-09-25, effort block added 2026-09-26 (same shape as kumo setup T34).
llm-pi-ai:
  providers:
    local:
      displayName: Ornith 1.5 9B (home server)
      api: openai-completions
      baseURL: http://192.168.1.64:8081/v1
      apiKeyEnv: KUMO_LOCAL_API_KEY
      models:
        - id: /etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf
          name: Ornith 1.5 9B
          contextWindow: 100096
          compat:
            thinkingFormat: chat-template
            chatTemplateKwargs:
              enable_thinking:
                $var: thinking.enabled
          reasoningEfforts:
            off: null
            low: 'on'
agent-default-model:
  provider: local
  model: /etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf
`;

describe("T35 prefill from settings.yaml (Aron shape, no kumo.json)", () => {
  test("Models step lists the route as current, preselected", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-t35-"));
    await writeFile(join(home, "settings.yaml"), ARON_SETTINGS);
    const pre = loadPrefill(home);
    expect(pre).toBeDefined();
    expect(isExistingInstall(pre)).toBe(true);
    const discoveries = pre!.discoveries;
    expect(discoveries).toHaveLength(1);
    const d = discoveries[0]!;
    expect(d.host).toBe("192.168.1.64");
    expect(d.port).toBe(8081);
    expect(d.current).toBe(true);
    expect(d.models).toEqual(["/etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf"]);
    expect(d.modelInfos[0]).toMatchObject({ id: "/etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf", contextWindow: 100096, name: "Ornith 1.5 9B" });
    const label = discoveredLabel(d);
    expect(label).toContain("✓");
    expect(label).toContain("Ornith 1.5 9B");
    expect(label).toContain("192.168.1.64");
    expect(label).toContain("(current)");
    expect(currentModelsSummary(discoveries)).toBe("Ornith 1.5 9B · 192.168.1.64");
    // Roles prefilled from agent-default-model.
    expect(pre!.roles.main?.model).toBe("/etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf");
    expect(pre!.roles.main?.discovered?.baseUrl).toBe("http://192.168.1.64:8081/v1");
    expect(pre!.roles.main?.contextWindow).toBe(100096);
  });

  test("Save without changes → settings.yaml semantically identical", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-t35-"));
    await writeFile(join(home, "settings.yaml"), ARON_SETTINGS);
    const pre = loadPrefill(home)!;
    const flow = new SetupFlow(pre);
    // Walk the linear wizard without changing anything (Skip = empty submit).
    flow.submit({ discoveries: pre.discoveries });
    flow.submit({});
    flow.submit({});
    flow.submit({ permissionMode: pre.permissionMode });
    flow.submit({});
    flow.submit({});
    flow.submit({});
    flow.submit({});
    expect(flow.atSummary).toBe(true);
    const plan = flow.buildPlan({ dshHome: home, bundledSkillsRoot: join(home, "none"), bundledSkills: [] });
    const before = parseYaml(await readFile(join(home, "settings.yaml"), "utf8"));
    const after = parseYaml(plan.settingsYaml);
    expect(after).toEqual(before);
  });

  test("first install (no files) → no prefill, no existing install", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-t35-"));
    expect(loadPrefill(home)).toBeUndefined();
    expect(isExistingInstall(undefined)).toBe(false);
  });

  test("installed skills survive a theme-only Save (no `skills` in kumo.json)", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-t35-"));
    await writeFile(join(home, "settings.yaml"), ARON_SETTINGS);
    await mkdir(join(home, "skills"), { recursive: true });
    await writeFile(
      join(home, "skills", ".kumo-installed.json"),
      JSON.stringify({ "git-workflow": { name: "git-workflow", kind: "shipped", source: "/p/skills/git-workflow" } }),
    );
    const pre = loadPrefill(home)!;
    expect(pre.skills).toEqual(["git-workflow"]);
    const flow = new SetupFlow(pre);
    flow.apply({ theme: "light" }); // exactly what the menu does
    const plan = flow.buildPlan({ dshHome: home, bundledSkillsRoot: "/none", bundledSkills: [] });
    expect(plan.skills.chosen).toEqual(["git-workflow"]);
  });

  test("an explicit empty skills list in kumo.json still wins over the manifest", async () => {
    const home = await mkdtemp(join(tmpdir(), "kumo-t35-"));
    await writeFile(join(home, "settings.yaml"), ARON_SETTINGS);
    await writeFile(join(home, "kumo.json"), JSON.stringify({ skills: [] }));
    await mkdir(join(home, "skills"), { recursive: true });
    await writeFile(
      join(home, "skills", ".kumo-installed.json"),
      JSON.stringify({ "git-workflow": { name: "git-workflow", kind: "shipped", source: "/p/skills/git-workflow" } }),
    );
    expect(loadPrefill(home)!.skills).toEqual([]);
  });
});

describe("default mode stays consistent with the runtime (BOS review 2026-09-26)", () => {
  test("a fresh flow defaults to auto, like modes.ts readDefaultMode", async () => {
    const { SetupFlow } = await import("../src/setup/flow.js");
    const flow = new (SetupFlow as any)();
    expect(flow.answers.permissionMode).toBe("auto");
  });
});
