import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import * as pty from "node-pty";
import type { Terminal as TerminalType } from "@xterm/headless";
import { ensureProfile } from "../../src/profile.js";
import { localServerSettings, renderSettingsYaml } from "../../src/setup/simple.js";
import { startServer, type Script } from "./sse-server.js";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as { Terminal: typeof TerminalType };
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const screens = join(root, "test", "e2e", "__screens__", "run");
const keys = { enter: "\r", escape: "\x1b", tab: "\t", shiftTab: "\x1b[Z", down: "\x1b[B", ctrlC: "\x03", ctrlD: "\x04", ctrlO: "\x0f" };

export function build() {
  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["build"], {
    cwd: root, stdio: "inherit", shell: process.platform === "win32",
  });
}

export class Harness {
  readonly term = new Terminal({ cols: 100, rows: 30, allowProposedApi: true, scrollback: 1000 });
  child!: pty.IPty;
  exit: { exitCode: number; signal?: number } | undefined;
  private pending = Promise.resolve();
  readonly emojiScreens: string[] = [];
  private constructor(readonly home: string, readonly project: string, readonly server: Awaited<ReturnType<typeof startServer>>) {}

  static async start(scripts: Script[], permissionMode = "ask", ascii = false) {
    const home = await mkdtemp(join(tmpdir(), "kumo-e2e-home-"));
    const project = await mkdtemp(join(tmpdir(), "kumo-e2e-project-"));
    const server = await startServer(scripts);
    const h = new Harness(home, project, server);
    try {
      await writeFile(join(home, "settings.yaml"), renderSettingsYaml(localServerSettings({ baseUrl: server.url, models: ["e2e-model"] }, "e2e-model")));
      await writeFile(join(home, ".env"), "KUMO_LOCAL_API_KEY=e2e\n");
      await writeFile(
        join(home, "kumo.json"),
        JSON.stringify({
          permissionMode,
          search: { provider: "none" },
          models: {
            main: {
              provider: "local",
              model: "e2e-model",
              name: "e2e-model Pretty",
              baseUrl: server.url,
              contextWindow: 100000,
            },
          },
        }),
      );
      await writeFile(join(project, "note.txt"), "E2E_READ_SENTINEL\n");
      const { dir } = await ensureProfile(home);
      // Reuse the installed bundles offline. Windows junctions need no symlink privilege.
      const modules = join(dir, "node_modules");
      await mkdir(join(modules, "@deepseek-ai"), { recursive: true });
      const dshRequire = createRequire(require.resolve("@deepseek-ai/dsh/package.json"));
      await symlink(root, join(modules, (require(join(root, "package.json")) as { name: string }).name), process.platform === "win32" ? "junction" : "dir");
      await symlink(dirname(dshRequire.resolve("@deepseek-ai/dsh-base/package.json")), join(modules, "@deepseek-ai", "dsh-base"), process.platform === "win32" ? "junction" : "dir");
      const env: Record<string, string> = {};
      // Preserve OS/runtime variables, but prevent model credentials and inherited
      // dsh settings from affecting the isolated test profile.
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !/(API_KEY|TOKEN|SECRET|^DSH_|^KUMO_)/i.test(key)) env[key] = value;
      }
      Object.assign(env, { KUMO_HOME: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1", KUMO_LOCAL_API_KEY: "e2e", KUMO_ASCII: ascii ? "1" : "0", TERM: "xterm-256color", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" });
      h.child = pty.spawn(process.execPath, [join(root, "dist", "bin.js")], { name: "xterm-256color", cols: 100, rows: 30, cwd: project, env });
      h.child.onData((data) => {
        h.pending = h.pending.then(() => new Promise<void>((done) => h.term.write(data, () => {
          const screen = h.screen().join("\n");
          if (/\p{Extended_Pictographic}/u.test(screen) && h.emojiScreens.length < 5) h.emojiScreens.push(screen);
          done();
        })));
      });
      // Reply to terminal queries just as a real terminal would.
      h.term.onData((data) => { if (!h.exit) h.child.write(data); });
      h.child.onExit((event) => { h.exit = event; });
      return h;
    } catch (error) {
      await h.close();
      throw error;
    }
  }

  async flush() { await this.pending; }
  screen(): string[] {
    const buffer = this.term.buffer.active;
    return Array.from({ length: this.term.rows }, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? "");
  }
  async until(predicate: () => boolean, ms = 15_000, label = "condition") {
    const deadline = Date.now() + ms;
    do {
      await this.flush();
      if (predicate()) return;
      if (Date.now() >= deadline) throw new Error(`Timeout waiting for ${label}; exit=${JSON.stringify(this.exit)}\n${this.screen().join("\n")}`);
      await delay(25);
    } while (true);
  }
  waitFor(text: string, ms = 15_000) { return this.until(() => this.screen().join("\n").includes(text), ms, JSON.stringify(text)); }
  async waitStable(ms: number, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    await this.flush();
    let previous = this.screen().join("\n");
    let since = Date.now();
    while (Date.now() <= deadline) {
      await delay(25);
      await this.flush();
      const current = this.screen().join("\n");
      if (current !== previous) { since = Date.now(); previous = current; }
      if (Date.now() - since >= ms) return;
    }
    throw new Error(`Screen did not stay stable for ${ms}ms within ${timeoutMs}ms`);
  }
  press(key: keyof typeof keys) { this.child.write(keys[key]); }
  type(text: string) { this.child.write(text); }
  async prompt(text: string) { this.type(text); await this.waitFor(text); this.press("enter"); }
  resize(cols: number, rows: number) { this.term.resize(cols, rows); this.child.resize(cols, rows); }
  async dump(name: string) {
    await this.flush();
    await mkdir(screens, { recursive: true });
    await writeFile(join(screens, `${name}.txt`), this.screen().join("\n") + "\n");
  }
  async close() {
    if (this.child && !this.exit) {
      this.press("ctrlC");
      await delay(550);
      this.press("ctrlD");
      const deadline = Date.now() + 1500;
      while (!this.exit && Date.now() < deadline) await delay(25);
      if (!this.exit) this.child.kill();
    }
    await this.server.close();
    await this.flush();
    this.term.dispose();
    await rm(this.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(this.project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
