/**
 * T30 — update check + `kumo update`: the pure half (registry check with a
 * fake fetch, the 24 h cache, semver, the off switches, install-kind
 * detection) plus the persistent notice on the KumoUi shell.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import {
  checkForUpdate,
  compareSemver,
  detectInstallKind,
  formatUpdateNotice,
  noticeForStartup,
  parseSemver,
  readKumoJsonDoc,
  readUpdateCache,
  readUpdateCheckChoice,
  setUpdateCheck,
  updateCheckEnabled,
  updateCommand,
  UPDATE_CACHE_FILE,
  type FetchLike,
} from "../src/update.js";
import { KumoUi } from "../src/ui/kumo-ui.js";
import { UNICODE_ICONS } from "../src/render/chars.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function freshHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "kumo-t30-"));
}

/** A fake registry: counts calls, answers with one version or fails. */
function fakeRegistry(
  opts: { version?: string; ok?: boolean; reject?: boolean } = {},
): { fetchImpl: FetchLike; calls: () => number } {
  let n = 0;
  const fetchImpl: FetchLike = async () => {
    n += 1;
    if (opts.reject === true) throw new Error("ECONNREFUSED");
    if (opts.ok === false) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ version: opts.version ?? "0.3.0" }) };
  };
  return { fetchImpl, calls: () => n };
}

describe("semver (T30)", () => {
  test("numeric ordering, prerelease tolerated", () => {
    expect(parseSemver("0.3.0")).toEqual([0, 3, 0]);
    expect(parseSemver(" 1.22.3 ")).toEqual([1, 22, 3]);
    expect(parseSemver("0.3.0-rc.1")).toEqual([0, 3, 0]);
    expect(parseSemver("test")).toBeNull();
    expect(compareSemver("0.3.0", "0.2.9")).toBeGreaterThan(0);
    expect(compareSemver("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.0.0+build")).toBe(0);
    expect(compareSemver("test", "0.1.0")).toBeNull();
  });
});

describe("checkForUpdate (T30)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("newer version → cache written with the checked time", async () => {
    const home = await freshHome();
    const reg = fakeRegistry({ version: "0.3.0" });
    const r = await checkForUpdate({
      dshHome: home,
      fetchImpl: reg.fetchImpl,
      now: () => 1000,
      env: {},
      isTTY: true,
    });
    expect(r).toEqual({ ran: "fetched", cache: { checkedAt: 1000, latest: "0.3.0" } });
    expect(await readUpdateCache(home)).toEqual({ checkedAt: 1000, latest: "0.3.0" });
  });

  test("accepted: checked less than 24 h ago → no request at all", async () => {
    const home = await freshHome();
    const first = fakeRegistry({ version: "0.3.0" });
    await checkForUpdate({ dshHome: home, fetchImpl: first.fetchImpl, now: () => 1000, env: {}, isTTY: true });
    const second = fakeRegistry({ version: "0.4.0" });
    const r = await checkForUpdate({
      dshHome: home,
      fetchImpl: second.fetchImpl,
      now: () => 1000 + 24 * 60 * 60 * 1000 - 1, // one ms inside the window
      env: {},
      isTTY: true,
    });
    expect(r).toEqual({ ran: "cached", cache: { checkedAt: 1000, latest: "0.3.0" } });
    expect(second.calls()).toBe(0);
    // once the window passes, it re-checks
    const r2 = await checkForUpdate({
      dshHome: home,
      fetchImpl: second.fetchImpl,
      now: () => 1000 + 24 * 60 * 60 * 1000 + 1,
      env: {},
      isTTY: true,
    });
    expect(r2).toEqual({ ran: "fetched", cache: { checkedAt: 1000 + 24 * 60 * 60 * 1000 + 1, latest: "0.4.0" } });
    expect(second.calls()).toBe(1);
  });

  test("accepted: registry down → nothing, no error, no cache file", async () => {
    const home = await freshHome();
    const down = fakeRegistry({ reject: true });
    const r = await checkForUpdate({ dshHome: home, fetchImpl: down.fetchImpl, env: {}, isTTY: true });
    expect(r).toEqual({ ran: "failed" });
    expect(existsSync(join(home, UPDATE_CACHE_FILE))).toBe(false);
    const notOk = fakeRegistry({ ok: false });
    expect(await checkForUpdate({ dshHome: home, fetchImpl: notOk.fetchImpl, env: {}, isTTY: true })).toEqual({ ran: "failed" });
    const junk: FetchLike = async () => ({ ok: true, json: async () => ({}) });
    expect(await checkForUpdate({ dshHome: home, fetchImpl: junk, env: {}, isTTY: true })).toEqual({ ran: "failed" });
    expect(existsSync(join(home, UPDATE_CACHE_FILE))).toBe(false);
  });

  test("a corrupt cache file reads as absent and re-fetches", async () => {
    const home = await freshHome();
    await writeFile(join(home, UPDATE_CACHE_FILE), "not json {{{");
    expect(await readUpdateCache(home)).toBeUndefined();
    const reg = fakeRegistry({ version: "0.3.0" });
    const r = await checkForUpdate({ dshHome: home, fetchImpl: reg.fetchImpl, env: {}, isTTY: true });
    expect(r.ran).toBe("fetched");
  });
});

describe("off switches (T30)", () => {
  test("accepted: KUMO_NO_UPDATE_CHECK=1 → zero requests", async () => {
    const home = await freshHome();
    const reg = fakeRegistry();
    const r = await checkForUpdate({
      dshHome: home,
      fetchImpl: reg.fetchImpl,
      env: { KUMO_NO_UPDATE_CHECK: "1" },
      isTTY: true,
    });
    expect(r).toEqual({ ran: "disabled" });
    expect(reg.calls()).toBe(0);
  });

  test("CI set, non-TTY, or updateCheck:false all disable; empty CI does not", () => {
    expect(updateCheckEnabled({ env: { CI: "1" }, isTTY: true })).toBe(false);
    expect(updateCheckEnabled({ env: { CI: "" }, isTTY: true })).toBe(true);
    expect(updateCheckEnabled({ env: {}, isTTY: false })).toBe(false);
    expect(updateCheckEnabled({ doc: { updateCheck: false }, env: {}, isTTY: true })).toBe(false);
    expect(updateCheckEnabled({ doc: { updateCheck: true }, env: {}, isTTY: true })).toBe(true);
    expect(updateCheckEnabled({ env: {}, isTTY: true })).toBe(true); // default on
  });

  test("kumo.json updateCheck survives the merge and keeps the other fields", async () => {
    const home = await freshHome();
    await writeFile(join(home, "bruine.json"), JSON.stringify({ mode: "full", telemetry: false }, null, 2));
    await setUpdateCheck(home, false);
    const doc = await readKumoJsonDoc(home);
    expect(doc).toMatchObject({ mode: "full", telemetry: false, updateCheck: false });
    expect(readUpdateCheckChoice(doc)).toBe(false);
    await setUpdateCheck(home, true);
    expect(readUpdateCheckChoice(await readKumoJsonDoc(home))).toBe(true);
    // No POSIX mode bits on Windows: privacy there is an ACL, not a 0600.
    if (process.platform !== "win32") {
      expect((await stat(join(home, "bruine.json"))).mode & 0o777).toBe(0o600);
    }
  });

  test("kumo.json missing → readUpdateCheckChoice undefined (default on)", async () => {
    const home = await freshHome();
    expect(readUpdateCheckChoice(await readKumoJsonDoc(home))).toBeUndefined();
  });
});

describe("update notice text (T30)", () => {
  test("accepted: newer → the exact line; same or older → nothing", () => {
    const cache = { checkedAt: 1, latest: "0.3.0" };
    expect(noticeForStartup({ cache, current: "0.2.0" })).toBe(
      "kumo 0.3.0 is available (you have 0.2.0). Run: kumo update",
    );
    expect(noticeForStartup({ cache: { checkedAt: 1, latest: "0.2.0" }, current: "0.2.0" })).toBeUndefined();
    expect(noticeForStartup({ cache: { checkedAt: 1, latest: "0.1.0" }, current: "0.2.0" })).toBeUndefined();
    expect(noticeForStartup({ cache: undefined, current: "0.2.0" })).toBeUndefined();
    expect(formatUpdateNotice("2.0.0", "1.9.9")).toBe("kumo 2.0.0 is available (you have 1.9.9). Run: kumo update");
  });
});

describe("detectInstallKind (T30)", () => {
  test("accepted: npm / pnpm / bun / developer, posix and win32", () => {
    expect(detectInstallKind("/usr/local/lib/node_modules/kumo-code/dist/bin.js")).toBe("npm");
    expect(
      detectInstallKind("C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\kumo-code\\dist\\bin.js"),
    ).toBe("npm");
    expect(
      detectInstallKind("/home/x/.local/share/pnpm/global/5/node_modules/kumo-code/dist/bin.js"),
    ).toBe("pnpm");
    expect(
      detectInstallKind(
        "/home/x/.pnpm-store/v3/files/kumo-code/node_modules/.pnpm/kumo-code@0.2.0/node_modules/kumo-code/dist/bin.js",
      ),
    ).toBe("pnpm");
    expect(
      detectInstallKind("C:\\Users\\x\\AppData\\Local\\pnpm\\node_modules\\kumo-code\\dist\\bin.js"),
    ).toBe("pnpm");
    expect(detectInstallKind("/home/x/.bun/install/global/node_modules/kumo-code/dist/bin.js")).toBe("bun");
    expect(
      detectInstallKind("C:\\Users\\x\\.bun\\install\\global\\node_modules\\kumo-code\\dist\\bin.js"),
    ).toBe("bun");
    expect(detectInstallKind("/home/x/projets/kumo/dist/bin.js")).toBe("developer");
    expect(detectInstallKind("C:\\Users\\x\\projets\\kumo\\dist\\bin.js")).toBe("developer");
    // a git checkout parked under node_modules is still developer only when
    // the package dir is the real one; keep the documented order honest:
    expect(detectInstallKind("/srv/kumo/node_modules/kumo-code/dist/bin.js")).toBe("npm");
  });

  test("updateCommand is exact per kind; developer runs nothing", () => {
    expect(updateCommand("npm")).toEqual(["npm", "install", "-g", "kumo-code@latest"]);
    expect(updateCommand("pnpm")).toEqual(["pnpm", "add", "-g", "kumo-code@latest"]);
    expect(updateCommand("bun")).toEqual(["bun", "add", "-g", "kumo-code@latest"]);
    expect(updateCommand("developer")).toBeUndefined();
  });
});

class FakeTerminal implements Terminal {
  writes: string[] = [];
  onInput?: (data: string) => void;
  columns = 80;
  rows = 20;
  kittyProtocolActive = false;
  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

const strip = (s: string): string =>
  s.replace(/\r/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

describe("KumoUi persistent update notice (T30)", () => {
  async function uiWithCache(latest: string): Promise<KumoUi> {
    const home = await freshHome();
    await writeFile(
      join(home, UPDATE_CACHE_FILE),
      JSON.stringify({ checkedAt: Date.now(), latest }),
      "utf8",
    );
    vi.stubEnv("KUMO_HOME", home);
    vi.stubEnv("KUMO_NO_UPDATE_CHECK", "");
    vi.stubEnv("CI", "");
    const ui = new KumoUi(
      "0.2.0",
      { onSubmit: () => {}, onEscape: () => {}, onQuit: () => {} },
      new FakeTerminal(),
      UNICODE_ICONS,
    );
    await new Promise((r) => setTimeout(r, 20)); // the notice check is async
    return ui;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("newer cached version → notice above the editor; gone after the first submit", async () => {
    const ui = await uiWithCache("0.3.0");
    const text = ui.tui.render(80).map(strip).join("\n");
    expect(text).toContain("kumo 0.3.0 is available (you have 0.2.0). Run: kumo update");
    ui.editor.onSubmit?.("first prompt");
    const after = ui.tui.render(80).map(strip).join("\n");
    expect(after).not.toContain("0.3.0 is available");
    ui.clearNoticeBox();
  });

  test("same cached version → no notice", async () => {
    const ui = await uiWithCache("0.2.0");
    const text = ui.tui.render(80).map(strip).join("\n");
    expect(text).not.toContain("is available");
  });
});

describe("kumo update command (T30)", () => {
  test("developer install prints the git message and runs nothing", () => {
    // dist/bin.js inside a git checkout realpath-detects as developer.
    const out = execFileSync(process.execPath, [join(repoRoot, "dist", "bin.js"), "update"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toContain("Developer install: run git pull && pnpm build");
    expect(out).not.toContain("Update now?");
  }, 30_000);
});
