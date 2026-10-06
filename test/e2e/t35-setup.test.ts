/**
 * T35 E2E — `bruine setup` in a real pty (isolated BRUINE_HOME temp dir, never
 * the real ~/.bruine):
 * - existing install → change-one-thing menu → Theme → light → Save changes and exit
 *   → only `theme` changed.
 * - first install → `s` on Web search, Skills, Theme, Telemetry → saved with
 *   defaults.
 */
import { readdirSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { parse as parseYaml } from "yaml";
import { beforeAll, expect, test } from "vitest";
import * as pty from "node-pty";
import type { Terminal as TerminalType } from "@xterm/headless";
import { build, root } from "./harness.js";

// A first setup starts with every shipped skill on, remotion apart, even when the step is skipped.
const DEFAULT_SKILLS = readdirSync(join(root, "skills")).filter((n) => n !== "remotion").sort();
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
    "      apiKeyEnv: BRUINE_LOCAL_API_KEY",
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

/** A minimal `bruine setup` pty over an isolated home. */
class SetupPty {
  readonly term = new Terminal({ cols: 100, rows: 30, allowProposedApi: true, scrollback: 1000 });
  private pending = Promise.resolve();
  exit: { exitCode: number; signal?: number } | undefined;
  private constructor(readonly home: string) {}

  static async start(home: string, extraEnv?: Record<string, string>): Promise<SetupPty> {
    const h = new SetupPty(home);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !/(API_KEY|TOKEN|SECRET|^DSH_|^BRUINE_|^KUMO_)/i.test(k)) env[k] = v;
    }
    Object.assign(env, {
      BRUINE_HOME: home,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: "1",
      BRUINE_NO_UPDATE_CHECK: "1",
      // The setup tests read the screen as text: the rain behind the panel has its own test.
      BRUINE_NO_RAIN: "1",
      ...(extraEnv ?? {}),
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
    return this.screen().map((l) => l.replace(/^[ │|]+/, "")).find((l) => l.startsWith("→")) ?? "";
  }

  /** Wait until the change-one-thing menu is on screen (cursor on Models). */
  async waitMenu(label = "menu"): Promise<void> {
    // The review screen only comes before the menu on the way in; after a step
    // the menu is already on its way back, so decide once one of the two shows.
    await this.until(
      () => this.text().includes("Choose a setting to edit.") || this.text().includes("Review your setup"),
      20_000,
      `${label}: the menu or the review before it`,
    );
    if (this.text().includes("Review your setup")) this.press("enter");
    await this.until(
      () => this.screen().some((l) => l.replace(/^[ │|]+/, "").startsWith("→ Models")),
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
  const home = await mkdtemp(join(tmpdir(), "bruine-t35-home-"));
  await writeFile(join(home, "settings.yaml"), aronSettings(`${server.url}/v1`));
  const before = parseYaml(await readFile(join(home, "settings.yaml"), "utf8")) as Record<string, any>;
  const h = await SetupPty.start(home);
  try {
    // Returning users see the branded welcome before their settings menu.
    await h.waitMenu("the change-one-thing menu");
    expect(h.text()).toContain("Bruine setup");
    expect(h.text()).toContain("Choose a setting to edit.");
    expect(h.text()).toContain("↑/↓ move");
    await h.waitFor("Ornith 1.5 9B · 127.0.0.1"); // the model line is drawn a frame after the menu
    expect(h.text()).not.toContain("Welcome to Bruine");
    await h.dump("t35-menu");

    // Theme is the 5th line: Models, Default mode, Web search, Skills, Theme.
    await h.pressN("down", 4);
    expect(await h.selectedLine()).toContain("Theme");
    h.press("enter");
    await h.waitFor("Select your preferred theme");
    expect(h.text()).toContain("high-contrast");
    await h.pressN("down", 1); // light
    expect(h.text()).toContain("› light ‹");
    h.press("enter");

    // Back at the menu, which reopens on Models; the pending value is read off
    // the row you are standing on.
    await h.waitMenu("the menu after the Theme step");
    await h.pressN("down", 4);
    expect(h.text()).toContain("Current Theme: light");
    await h.dump("t35-menu-after-theme");
    await h.pressN("up", 4); // back to Models

    // Save and exit (the menu restarts on Models each time).
    await h.pressN("down", 6);
    expect(await h.selectedLine()).toContain("Save changes and exit");
    h.press("enter");
    await h.waitFor("bruine: configuration saved.");

    const after = parseYaml(await readFile(join(home, "settings.yaml"), "utf8")) as Record<string, any>;
    // settings.yaml: the route is byte-for-byte the same meaning.
    expect(after["llm-pi-ai"]).toEqual(before["llm-pi-ai"]);
    expect(after["agent-default-model"]).toEqual(before["agent-default-model"]);
    // The only settings.yaml change: the theme.
    expect(after["ui-theme"]).toEqual({ preference: "light" });
    expect(before["ui-theme"]).toBeUndefined();

    const bruine = JSON.parse(await readFile(join(home, "bruine.json"), "utf8")) as Record<string, any>;
    expect(bruine.theme).toBe("light");
    expect((bruine.models as any).main).toMatchObject({
      provider: "local",
      model: "/etc/ajean/models/Ornith-1.5-9B-Q4_K_M.gguf",
      contextWindow: 100096,
    });
    // Untouched answers keep their defaults, not invented values.
    expect(bruine.search).toEqual({ provider: "none" });
    expect([...bruine.skills].sort()).toEqual(DEFAULT_SKILLS);
    expect(bruine.telemetry).toBe(false);
  } finally {
    await h.dump("t35-menu-failure");
    await h.close();
    await server.close();
  }
});

test("existing setup menu explains navigation and keeps exit without saving visible", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruine-setup-menu-"));
  const settings = [
    "agent-default-model:",
    "  provider: deepseek-official",
    "  model: deepseek-chat",
    "",
  ].join("\n");
  await writeFile(join(home, "settings.yaml"), settings);
  const h = await SetupPty.start(home);
  try {
    await h.waitMenu("existing setup menu");
    expect(h.text()).toContain("Choose a setting to edit.");
    expect(h.text()).toContain("Changes stay pending until you save.");
    expect(h.text()).toContain("↑/↓ move");
    expect(h.text()).toContain("Enter open");
    expect(h.text()).toContain("Esc back");
    expect(h.text()).toContain("Current Models: deepseek-official · deepseek-chat");

    // Escape walks back through setup rather than terminating the process.
    h.press("escape");
    await h.waitFor("Review your setup");
    expect(h.exit).toBeUndefined();
    h.press("escape");
    await h.waitFor("Review your setup");
    expect(h.exit).toBeUndefined();
    h.press("enter");
    await h.waitFor("Review your setup");
    h.press("enter");
    await h.waitFor("Choose a setting to edit.");

    // Theme preview follows the selection, and Escape returns to the menu
    // without applying the unconfirmed preview.
    await h.pressN("down", 4);
    h.press("enter");
    await h.waitFor("Select your preferred theme");
    expect(h.text()).toContain("› dark ‹");
    await h.pressN("down", 1);
    expect(h.text()).toContain("› light ‹");
    h.press("escape");
    await h.waitFor("Choose a setting to edit.");
    await h.pressN("down", 4);
    expect(h.text()).toContain("Current Theme: dark");

    await h.pressN("down", 3);
    expect(await h.selectedLine()).toContain("Exit without saving");
    h.press("enter");
    await h.waitFor("configuration postponed");
    // The message is printed a moment before the process is gone.
    await h.until(() => h.exit !== undefined, 5000, "the process to exit");
    expect(h.exit?.exitCode).toBe(0);
    expect(await readFile(join(home, "settings.yaml"), "utf8")).toBe(settings);
  } finally {
    await h.close();
  }
});

test("T35: first install → s on Web search, Skills, Theme, Telemetry → defaults saved", async () => {
  const server = await startServer([]);
  const home = await mkdtemp(join(tmpdir(), "bruine-t35-home-"));
  const h = await SetupPty.start(home);
  try {
    await h.waitFor("Choose your setup");
    await h.waitFor("Quick setup");
    await h.pressN("down", 1); // Full setup
    expect(h.text()).toContain("Customize setup");
    h.press("enter");

    // Models: enter the fake server address (whatever the local scan found).
    await h.waitFor("AI servers: found, add, or remove");
    h.type("address");
    await h.until(() => h.text().includes("Filter: address_"), 20_000, "filtered server choices");
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
    // A first setup offers the free model as a yes or no, with No under the cursor.
    await h.waitFor("Free model");
    expect(h.text()).toContain("Space Bunny Free");
    expect(await h.selectedLine()).toContain("No, I will choose my own model");
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
    await h.until(() => h.text().includes("Select your preferred theme"), 20_000, "theme step");
    h.type("s");
    await h.until(() => h.text().includes("Share anonymous usage data"), 20_000, "telemetry step");
    h.type("s");
    await h.until(() => h.text().includes("Summary"), 20_000, "summary step");
    await h.dump("t35-first-install-summary");
    expect(h.text()).toMatch(/Search\s+none/);
    expect(h.text()).toMatch(/Theme\s+dark/);
    expect(h.text()).toMatch(/Telemetry\s+no/);
    h.press("enter");
    await h.waitFor("bruine: configuration saved.");

    const bruine = JSON.parse(await readFile(join(home, "bruine.json"), "utf8")) as Record<string, any>;
    expect(bruine.search).toEqual({ provider: "none" });
    expect([...bruine.skills].sort()).toEqual(DEFAULT_SKILLS);
    expect(bruine.theme).toBe("dark");
    expect(bruine.telemetry).toBe(false);
    expect(bruine.permissionMode).toBe("auto");
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

test("first install → Yes to Space Bunny Free → its own route, nothing asked about a key", async () => {
  const server = await startServer([]);
  const home = await mkdtemp(join(tmpdir(), "bruine-t35-zen-"));
  const h = await SetupPty.start(home);
  try {
    await h.waitFor("Choose your setup");
    await h.waitFor("Quick setup");
    await h.pressN("down", 1);
    h.press("enter");
    await h.waitFor("AI servers: found, add, or remove");
    h.type("address");
    await h.until(() => h.text().includes("Filter: address_"), 20_000, "filtered server choices");
    h.press("enter");
    await h.waitFor("Server URL (e.g. http://192.168.1.64:8081):");
    h.type(server.url);
    h.press("enter");
    await h.until(() => h.text().includes("1 model"), 20_000, "the probed server in the models list");
    for (let i = 0; i < 8 && !(await h.selectedLine()).includes("Continue →"); i++) {
      await h.pressN("down", 1);
    }
    h.press("enter");
    await h.waitFor("Free model");
    // The notice says where the code goes and that the offer can end.
    expect(h.text()).toMatch(/sent to/i);
    expect(h.text()).toMatch(/end without notice/i);
    await h.pressN("down", 1);
    expect(await h.selectedLine()).toContain("Yes, use Space Bunny Free");
    h.press("enter");
    // Main is chosen: the next question is fast, and the server found earlier is still offered.
    await h.until(() => h.text().includes("Role: fast"), 20_000, "fast role");
    h.press("enter");
    await h.until(() => h.text().includes("Role: vision"), 20_000, "vision role");
    h.press("enter");
    await h.until(() => h.text().includes("No API keys needed"), 20_000, "keys step");
    h.press("enter");
    await h.until(() => h.text().includes("Default access mode"), 20_000, "mode step");
    h.press("enter");
    await h.until(() => h.text().includes("Web search"), 20_000, "search step");
    h.type("s");
    await h.until(() => h.text().includes("Skills: Space toggles"), 20_000, "skills step");
    h.type("s");
    await h.until(() => h.text().includes("Select your preferred theme"), 20_000, "theme step");
    h.type("s");
    await h.until(() => h.text().includes("Share anonymous usage data"), 20_000, "telemetry step");
    h.type("s");
    await h.until(() => h.text().includes("Summary"), 20_000, "summary step");
    h.press("enter");
    await h.waitFor("bruine: configuration saved.");
    const settings = parseYaml(await readFile(join(home, "settings.yaml"), "utf8")) as Record<string, any>;
    expect(settings["agent-default-model"]).toEqual({ provider: "opencode-zen", model: "space-bunny-free" });
    expect(settings["llm-pi-ai"].providers["opencode-zen"]).toMatchObject({
      baseURL: "https://opencode.ai/zen/v1",
      headers: { Authorization: "Bearer public" },
    });
    const bruine = JSON.parse(await readFile(join(home, "bruine.json"), "utf8")) as Record<string, any>;
    expect(bruine.models.main).toMatchObject({ provider: "opencode-zen", model: "space-bunny-free", contextWindow: 1_000_000 });
  } finally {
    await h.dump("t35-zen-failure");
    await h.close();
    await server.close();
  }
});

test("first install with a cloud model: no Skip trap on the main model, and the keys step goes straight to the key", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruine-t35-cloud-"));
  const h = await SetupPty.start(home);
  try {
    await h.waitFor("Choose your setup");
    await h.waitFor("Quick setup");
    await h.pressN("down", 1);
    h.press("enter");
    await h.waitFor("AI servers: found, add, or remove");
    for (let i = 0; i < 8 && !(await h.selectedLine()).includes("Continue →"); i++) {
      await h.pressN("down", 1);
    }
    h.press("enter");
    await h.waitFor("Free model");
    h.press("enter"); // No
    await h.until(() => h.text().includes("Role: main"), 20_000, "roles step");
    // Nothing is kept on a first install, so there is no Skip row to fall into.
    expect(h.text()).not.toContain("Skip (keep");
    expect(h.text()).not.toContain("(s skips)");
    // The list is: Space Bunny Free, then Cloud provider…
    await h.pressN("down", 1);
    h.press("enter"); // Cloud provider…
    await h.waitFor("Cloud provider for main");
    // Not two providers any more: the engine's catalog, DeepSeek first.
    expect(h.text()).toContain("Anthropic");
    expect(h.text()).toContain("Groq");
    expect(h.text()).toContain("GROQ_API_KEY");
    h.press("enter"); // DeepSeek
    await h.waitFor("Model id on DeepSeek");
    h.press("enter");
    await h.until(() => h.text().includes("Role: fast"), 20_000, "fast role");
    expect(h.text()).not.toContain("(s skips)");
    h.press("enter");
    await h.until(() => h.text().includes("Role: vision"), 20_000, "vision role");
    h.press("enter");
    // A key is missing: the step asks for it, with no menu in front.
    await h.waitFor("Enter DEEPSEEK_API_KEY (input is hidden):");
    expect(h.text()).not.toContain("Enter API keys →");
    // An empty key is refused on the step; the setup is still there.
    h.press("enter");
    await h.waitFor("DEEPSEEK_API_KEY is required");
    await h.waitFor("Enter DEEPSEEK_API_KEY (input is hidden):");
    expect(h.exit).toBeUndefined();
  } finally {
    await h.dump("t35-cloud-failure");
    await h.close();
  }
});

test("first install → Groq from the catalog → model, key, saved as a catalog route", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruine-t35-groq-"));
  const h = await SetupPty.start(home);
  try {
    await h.waitFor("Choose your setup");
    await h.waitFor("Quick setup");
    await h.pressN("down", 1);
    h.press("enter");
    await h.waitFor("AI servers: found, add, or remove");
    for (let i = 0; i < 8 && !(await h.selectedLine()).includes("Continue →"); i++) {
      await h.pressN("down", 1);
    }
    h.press("enter");
    await h.waitFor("Free model");
    h.press("enter"); // No
    await h.until(() => h.text().includes("Role: main"), 20_000, "roles step");
    // The list is: Space Bunny Free, then Cloud provider…
    await h.pressN("down", 1);
    h.press("enter"); // Cloud provider…
    await h.waitFor("Cloud provider for main");
    h.type("groq");
    await h.until(() => h.text().includes("Filter: groq_"), 20_000, "filtered providers");
    h.press("enter");
    await h.waitFor("Model on Groq");
    expect(h.text()).toMatch(/\(\S+\)\s+·\s+\d+k ctx/);
    h.press("enter"); // first model
    await h.until(() => h.text().includes("Role: fast"), 20_000, "fast role");
    h.press("enter"); // use main
    await h.until(() => h.text().includes("Role: vision"), 20_000, "vision role");
    h.press("enter"); // none
    await h.waitFor("Enter GROQ_API_KEY (input is hidden):");
    h.type("gsk_e2e_secret");
    h.press("enter");
    await h.until(() => h.text().includes("Default access mode"), 20_000, "mode step");
    h.press("enter");
    await h.until(() => h.text().includes("Web search"), 20_000, "search step");
    h.type("s");
    await h.until(() => h.text().includes("Skills: Space toggles"), 20_000, "skills step");
    h.type("s");
    await h.until(() => h.text().includes("Select your preferred theme"), 20_000, "theme step");
    h.type("s");
    await h.until(() => h.text().includes("Share anonymous usage data"), 20_000, "telemetry step");
    h.type("s");
    await h.until(() => h.text().includes("Summary"), 20_000, "summary step");
    expect(h.text()).toMatch(/Main\s+groq/);
    h.press("enter");
    await h.waitFor("bruine: configuration saved.");
    const settings = parseYaml(await readFile(join(home, "settings.yaml"), "utf8")) as Record<string, any>;
    expect(settings["agent-default-model"].provider).toBe("groq");
    expect(settings["llm-pi-ai"].providers.groq).toEqual({ apiKeyEnv: "GROQ_API_KEY" });
    expect(await readFile(join(home, ".env"), "utf8")).toContain("GROQ_API_KEY=gsk_e2e_secret");
  } finally {
    await h.dump("t35-groq-failure");
    await h.close();
  }
});

test("the rain behind the setup follows the option under the cursor: heavy on Quick setup, light on Set up later", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruine-t35-rain-"));
  const h = await SetupPty.start(home, { BRUINE_NO_RAIN: "0" });
  try {
    await h.waitFor("Choose your setup");
    await h.waitFor("Quick setup");
    const drops = (): number => (h.text().match(/[·╷╎]/g) ?? []).length;
    const sample = async (): Promise<number> => {
      let total = 0;
      const frames = new Set<string>();
      for (let i = 0; i < 22; i += 1) {
        await delay(100);
        // Every word of the screen is always there, whatever falls behind it.
        const text = h.text();
        expect(text).toContain("Quick setup");
        expect(text).toContain("Customize setup");
        expect(text).toContain("Set up later");
        frames.add(text);
        total += drops();
      }
      expect(frames.size).toBeGreaterThan(5);
      return total;
    };
    const heavy = await sample();
    await h.pressN("down", 2);
    await h.until(() => {
      const rows = h.screen();
      const at = rows.findIndex((l) => l.includes("› ╭"));
      return at >= 0 && (rows[at + 1] ?? "").includes("Set up later");
    }, 10_000, "the cursor on Set up later");
    await delay(900); // the rain eases to its new weather
    const light = await sample();
    expect(heavy, `heavy ${String(heavy)} light ${String(light)}`).toBeGreaterThan(0);
    expect(light).toBeLessThan(heavy);
  } finally {
    await h.dump("t35-rain-failure");
    await h.close();
  }
});

test("one tap of Escape from Models is one step back to the menu, even when the terminal reports the release too", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruine-t35-esc-"));
  await writeFile(join(home, "settings.yaml"), "agent-default-model:\n  provider: deepseek-official\n  model: deepseek-chat\n");
  const h = await SetupPty.start(home);
  try {
    await h.waitMenu("existing setup menu");
    h.press("enter"); // Models
    await h.waitFor("AI servers: found, add, or remove");
    // What a kitty-protocol terminal sends for one tap: the press, then the release.
    h.child.write("\x1b[27u\x1b[27;1:3u");
    await h.waitFor("Choose a setting to edit.");
    await delay(700);
    // Still on the menu: the release was not a second Escape.
    expect(h.text()).toContain("Choose a setting to edit.");
    expect(h.text()).not.toContain("Review your setup");
    expect(h.exit).toBeUndefined();
  } finally {
    await h.dump("t35-esc-release-failure");
    await h.close();
  }
});

test("fresh setup offers Set up later and exits without writing configuration", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruine-setup-later-"));
  const h = await SetupPty.start(home);
  try {
    await h.waitFor("Choose your setup");
    await h.waitFor("Set up later");
    expect(h.text()).toContain("Set up later");
    await h.pressN("down", 2);
    expect(h.text()).toMatch(/›\s+╭/);
    h.press("enter");
    await h.waitFor("configuration postponed");
    expect(h.exit?.exitCode).toBe(0);
    expect(await readdir(home)).toEqual([]);
  } finally {
    await h.close();
  }
});


test("setup cards keep Mode, Search and the three Telemetry choices independently editable", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruine-setup-cards-"));
  await writeFile(join(home, "settings.yaml"), "agent-default-model:\n  provider: deepseek-official\n  model: deepseek-chat\n");
  const h = await SetupPty.start(home);
  try {
    await h.waitMenu();
    await h.pressN("down", 1); h.press("enter");
    await h.waitFor("Default access mode");
    expect(h.text()).toContain("Recommended");
    await h.dump("t35-mode-cards");
    await h.pressN("up", 1); h.press("enter"); // Ask instead of Auto
    await h.waitMenu();
    await h.pressN("down", 2); h.press("enter");
    await h.waitFor("Nothing is scraped for free");
    await h.dump("t35-search-cards");
    h.press("enter"); // None
    await h.waitMenu();
    await h.pressN("down", 5); h.press("enter");
    await h.waitFor("Usage data · 1/3");
    await h.dump("t35-telemetry-cards");
    h.press("enter"); // No usage data
    await h.waitFor("Updates · 2/3");
    await h.pressN("down", 1); h.press("enter"); // No updates
    await h.waitFor("Suggestions · 3/3");
    await h.pressN("down", 1); h.press("enter"); // No suggestions
    await h.waitMenu();
    await h.pressN("down", 6); h.press("enter");
    await h.waitFor("bruine: configuration saved.");
    const doc = JSON.parse(await readFile(join(home, "bruine.json"), "utf8"));
    expect(doc.permissionMode).toBe("ask");
    expect(doc.search).toEqual({ provider: "none" });
    expect(doc.telemetry).toBe(false);
    expect(doc.suggestions).toBe(false);
    expect(doc.updateCheck).toBe(false);
  } finally {
    await h.close();
  }
});
