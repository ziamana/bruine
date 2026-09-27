/**
 * T35 E2E — `kumo setup` in a real pty (isolated KUMO_HOME temp dir, never
 * the real ~/.kumo):
 * - existing install → change-one-thing menu → Theme → light → Save and exit
 *   → only `theme` changed.
 * - first install → `s` on Web search, Skills, Theme, Telemetry → saved with
 *   defaults.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { parse as parseYaml } from "yaml";
import { beforeAll, expect, test } from "vitest";
import * as pty from "node-pty";
import type { Terminal as TerminalType } from "@xterm/headless";
import { build, root } from "./harness.js";
import { startServer } from "./sse-server.js";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as { Terminal: typeof TerminalType };
const keys = { enter: "\r", down: "\x1b[B", up: "\x1b[A", escape: "\x1b", ctrlC: "\x03" };

beforeAll(build, 120_000);

/** Aron's real settings.yaml shape: compat + reasoningEfforts, pretty name, window. */
function aronSettings(baseUrl: string): string {
  return [
    "llm-pi-ai:",
    "  providers:",
    "    local:",
    "      displayName: Ornith 1.5 9B (home server)",
    "      api: openai-completions",
    `      baseURL: ${baseUrl}`,
    "      apiKeyEnv: KUMO_LOCAL_API_KEY",
    "      models:",
    "        - id: /etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf",
    "          name: Ornith 1.5 9B",
    "          contextWindow: 100096",
    "          compat:",
    "            thinkingFormat: chat-template",
    "            chatTemplateKwargs:",
    "              enable_thinking:",
    "                $var: thinking.enabled",
    "          reasoningEfforts:",
    "            off: null",
    "            low: 'on'",
    "agent-default-model:",
    "  provider: local",
    "  model: /etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf",
    "",
  ].join("\n");
}

/** A minimal `kumo setup` pty over an isolated home. */
class SetupPty {
  readonly term = new Terminal({ cols: 100, rows: 30, allowProposedApi: true, scrollback: 1000 });
  private pending = Promise.resolve();
  exit: { exitCode: number; signal?: number } | undefined;
  private constructor(readonly home: string) {}

  static async start(home: string): Promise<SetupPty> {
    const h = new SetupPty(home);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !/(API_KEY|TOKEN|SECRET|^DSH_|^KUMO_)/i.test(k)) env[k] = v;
    }
    Object.assign(env, {
      KUMO_HOME: home,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: "1",
      KUMO_NO_UPDATE_CHECK: "1",
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    });
    h.child = pty.spawn(process.execPath, [join(root, "dist", "bin.js"), "setup"], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: root,
      env,
    });
    h.child.onData((data) => {
      h.pending = h.pending.then(() => new Promise<void>((done) => h.term.write(data, () => done())));
    });
    h.term.onData((data) => {
      if (!h.exit) h.child.write(data);
    });
    h.child.onExit((event) => {
      h.exit = event;
    });
    return h;
  }

  child!: pty.IPty;

  async flush(): Promise<void> {
    await this.pending;
  }

  screen(): string[] {
    const buffer = this.term.buffer.active;
    return Array.from({ length: this.term.rows }, (_, row) =>
      buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "",
    );
  }

  text(): string {
    return this.screen().join("\n");
  }

  press(key: keyof typeof keys): void {
    this.child.write(keys[key]);
  }

  async pressN(key: keyof typeof keys, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      this.press(key);
      await delay(60);
      await this.flush();
    }
  }

  type(text: string): void {
    this.child.write(text);
  }

  async until(predicate: () => boolean, ms = 20_000, label = "condition"): Promise<void> {
    const deadline = Date.now() + ms;
    do {
      await this.flush();
      if (predicate()) return;
      if (Date.now() >= deadline) {
        throw new Error(`Timeout waiting for ${label}\n${this.text()}`);
      }
      await delay(25);
    } while (true);
  }

  waitFor(text: string, ms = 20_000): Promise<void> {
    return this.until(() => this.text().includes(text), ms, JSON.stringify(text));
  }

  /** The line the cursor is on (SelectList marks it with `→`). */
  async selectedLine(): Promise<string> {
    await this.flush();
    return this.screen().find((l) => l.trim().startsWith("→")) ?? "";
  }

  /** Wait until the change-one-thing menu is on screen (cursor on Models). */
  async waitMenu(label = "menu"): Promise<void> {
    await this.until(
      () => this.screen().some((l) => l.trimStart().startsWith("→ Models")),
      20_000,
      label,
    );
  }

  async dump(name: string): Promise<void> {
    await this.flush();
    const { mkdir } = await import("node:fs/promises");
    const dir = join(root, "test", "e2e", "__screens__", "run");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.txt`), this.text() + "\n");
  }

  async close(): Promise<void> {
    if (!this.exit) {
      this.press("ctrlC");
      await delay(400);
      this.press("ctrlC");
      const deadline = Date.now() + 4000;
      while (!this.exit && Date.now() < deadline) await delay(50);
      if (!this.exit) this.child.kill();
    }
    await this.flush();
    this.term.dispose();
  }
}

test("T35: existing install → menu → Theme → light → Save and exit (only theme changed)", async () => {
  const server = await startServer([]);
  const home = await mkdtemp(join(tmpdir(), "kumo-t35-home-"));
  await writeFile(join(home, "settings.yaml"), aronSettings(`${server.url}/v1`));
  const before = parseYaml(await readFile(join(home, "settings.yaml"), "utf8")) as Record<string, any>;
  const h = await SetupPty.start(home);
  try {
    // T35 §2: an existing install opens the menu, not the linear wizard.
    await h.waitMenu("the change-one-thing menu");
    expect(h.text()).toContain("kumo setup: what do you want to change?");
    expect(h.text()).toContain("Ornith 1.5 9B · 127.0.0.1");
    expect(h.text()).not.toContain("Welcome to kumo");
    await h.dump("t35-menu");

    // Theme is the 5th line: Models, Default mode, Web search, Skills, Theme.
    await h.pressN("down", 4);
    expect(await h.selectedLine()).toContain("Theme");
    h.press("enter");
    await h.waitFor("Theme (s skips)");
    expect(h.text()).toContain("high-contrast");
    await h.pressN("down", 1); // light
    expect(await h.selectedLine()).toContain("light");
    h.press("enter");

    // Back at the menu with the new value shown.
    await h.waitMenu("the menu after the Theme step");
    const themeRow = h.screen().find((l) => /^ {2}Theme\s/.test(l)) ?? "";
    expect(themeRow).toContain("light");
    await h.dump("t35-menu-after-theme");

    // Save and exit (the menu restarts on Models each time).
    await h.pressN("down", 6);
    expect(await h.selectedLine()).toContain("Save and exit");
    h.press("enter");
    await h.waitFor("kumo: configuration saved.");

    const after = parseYaml(await readFile(join(home, "settings.yaml"), "utf8")) as Record<string, any>;
    // settings.yaml: the route is byte-for-byte the same meaning.
    expect(after["llm-pi-ai"]).toEqual(before["llm-pi-ai"]);
    expect(after["agent-default-model"]).toEqual(before["agent-default-model"]);
    // The only settings.yaml change: the theme.
    expect(after["ui-theme"]).toEqual({ preference: "light" });
    expect(before["ui-theme"]).toBeUndefined();

    const kumo = JSON.parse(await readFile(join(home, "kumo.json"), "utf8")) as Record<string, any>;
    expect(kumo.theme).toBe("light");
    expect((kumo.models as any).main).toMatchObject({
      provider: "local",
      model: "/etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf",
      contextWindow: 100096,
    });
    // Untouched answers keep their defaults, not invented values.
    expect(kumo.search).toEqual({ provider: "none" });
    expect(kumo.skills).toEqual([]);
    expect(kumo.telemetry).toBe(false);
  } finally {
    await h.dump("t35-menu-failure");
    await h.close();
    await server.close();
  }
});

test("T35: first install → s on Web search, Skills, Theme, Telemetry → defaults saved", async () => {
  const server = await startServer([]);
  const home = await mkdtemp(join(tmpdir(), "kumo-t35-home-"));
  const h = await SetupPty.start(home);
  try {
    await h.waitFor("Welcome to kumo. How should we set it up?");
    await h.pressN("down", 1); // Full setup
    expect(await h.selectedLine()).toContain("Full setup");
    h.press("enter");

    // Models: enter the fake server address (whatever the local scan found).
    await h.waitFor("AI servers: found, add, or remove");
    for (let i = 0; i < 8 && !(await h.selectedLine()).includes("Enter a server address"); i++) {
      await h.pressN("down", 1);
    }
    expect(await h.selectedLine()).toContain("Enter a server address");
    h.press("enter");
    // No trailing space: the blank cell after the colon is not painted on
    // every terminal, and the prompt itself is what this step is about.
    await h.waitFor("Server URL (e.g. http://192.168.1.64:8081):");
    h.type(server.url); // already http://host:port/v1
    h.press("enter");
    await h.until(
      () => h.text().includes("1 model"),
      20_000,
      "the probed server in the models list",
    );
    for (let i = 0; i < 8 && !(await h.selectedLine()).includes("Continue →"); i++) {
      await h.pressN("down", 1);
    }
    expect(await h.selectedLine()).toContain("Continue →");
    h.press("enter");
    await h.until(() => h.text().includes("Role: main"), 20_000, "roles step");

    // Roles: main = the discovered server + its model, fast = use main, vision = none.
    h.press("enter");
    await h.waitFor("Main model on");
    h.press("enter");
    await h.waitFor("Context window for e2e-model");
    h.type("100000");
    h.press("enter");
    await h.until(() => h.text().includes("Role: fast"), 20_000, "fast role");
    h.press("enter");
    await h.until(() => h.text().includes("Role: vision"), 20_000, "vision role");
    h.press("enter");
    await h.until(() => h.text().includes("No API keys needed"), 20_000, "keys step");
    h.press("enter");

    // Default mode: keep the recommended Auto.
    await h.until(() => h.text().includes("Default access mode"), 20_000, "mode step");
    h.press("enter");

    // T35 §3: `s` skips Web search, Skills, Theme, Telemetry.
    await h.until(() => h.text().includes("Web search"), 20_000, "search step");
    h.type("s");
    await h.until(() => h.text().includes("Skills: Space toggles"), 20_000, "skills step");
    h.type("s");
    await h.until(() => h.text().includes("Theme (s skips)"), 20_000, "theme step");
    h.type("s");
    await h.until(() => h.text().includes("Share anonymous usage data"), 20_000, "telemetry step");
    h.type("s");
    await h.until(() => h.text().includes("Summary"), 20_000, "summary step");
    await h.dump("t35-first-install-summary");
    expect(h.text()).toContain("Search   none");
    expect(h.text()).toContain("Theme    dark");
    expect(h.text()).toContain("Telemetry no");
    h.press("enter");
    await h.waitFor("kumo: configuration saved.");

    const kumo = JSON.parse(await readFile(join(home, "kumo.json"), "utf8")) as Record<string, any>;
    expect(kumo.search).toEqual({ provider: "none" });
    expect(kumo.skills).toEqual([]);
    expect(kumo.theme).toBe("dark");
    expect(kumo.telemetry).toBe(false);
    expect(kumo.permissionMode).toBe("auto");
    const settings = parseYaml(await readFile(join(home, "settings.yaml"), "utf8")) as Record<string, any>;
    expect(settings["agent-default-model"]).toEqual({ provider: "local", model: "e2e-model" });
    expect(settings["llm-pi-ai"].providers.local.models[0]).toMatchObject({
      id: "e2e-model",
      contextWindow: 100000,
    });
  } finally {
    await h.dump("t35-first-install-failure");
    await h.close();
    await server.close();
  }
});
