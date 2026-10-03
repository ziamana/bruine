import { appHome } from "../src/compat.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildLaunch, dshInvocation, flagMode, resolveDshEntry } from "../src/launch.js";
import { localDefaultRoute } from "../src/setup/discover.js";

describe("flagMode (T11.2)", () => {
  test("intercepts only as the FIRST argument", () => {
    expect(flagMode(["--version"])).toBe("version");
    expect(flagMode(["-V"])).toBe("version");
    expect(flagMode(["--help"])).toBe("help");
    expect(flagMode(["-h"])).toBe("help");
  });

  test("flags inside a prompt are not intercepted", () => {
    expect(flagMode(["explain the --help flag"])).toBeNull();
    expect(flagMode(["fix", "-V"])).toBeNull();
    expect(flagMode([])).toBeNull();
  });
});

describe("buildLaunch", () => {
  test("default home → DSH_HOME is the .kumo dir under home", () => {
    const { env } = buildLaunch([], { PATH: "/usr/bin" }, "/home/tu44");
    expect(env.DSH_HOME).toBe(appHome({}, "/home/tu44"));
    expect([".bruine", ".kumo"]).toContain(path.basename(env.DSH_HOME));
  });

  test("KUMO_HOME overrides DSH_HOME", () => {
    const { env } = buildLaunch([], { KUMO_HOME: "/tmp/x" }, "/home/tu44");
    expect(env.DSH_HOME).toBe("/tmp/x");
  });

  test("argv is passed through after --profile kumo", () => {
    const { command, args } = buildLaunch(["fix the tests"], {}, "/home/x");
    expect(command).toBe("dsh");
    expect(args).toEqual(["--profile", "bruine", "fix the tests"]);
  });

  test("original env keys are preserved", () => {
    const { env } = buildLaunch([], { PATH: "/usr/bin", HOME: "/home/x" }, "/home/x");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
  });

  test("input env is not mutated", () => {
    const input: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    buildLaunch([], input, "/home/x");
    expect(input.DSH_HOME).toBeUndefined();
  });

  test("telemetry is disabled by default (T14.3)", () => {
    const { env } = buildLaunch([], {}, "/home/x");
    expect(env.DSH_TELEMETRY_DISABLED).toBe("1");
  });

  test("tool catalog defaults to lean and accepts the full setting", () => {
    expect(buildLaunch([], { KUMO_TOOLS: "full" }, "/home/x").env.KUMO_TOOLS).toBe("lean");
    expect(buildLaunch([], {}, "/home/x", { tools: "full" }).env.KUMO_TOOLS).toBe("full");
  });

  test("kumo.json telemetry opt-in does not disable (T14.3)", () => {
    const { env } = buildLaunch([], {}, "/home/x", { telemetry: true });
    expect(env.DSH_TELEMETRY_DISABLED).toBeUndefined();
  });

  test("pinned dsh entry launches that copy with node itself (T14.2)", () => {
    const { command, args } = buildLaunch(["hi"], {}, "/home/x", {
      dshEntry: "/opt/dsh/lib/bin.js",
    });
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["/opt/dsh/lib/bin.js", "--profile", "bruine", "hi"]);
  });

  test("win32-style home joins with backslashes (T14.4)", () => {
    const { env } = buildLaunch([], {}, "C:\\Users\\x", { pathMod: path.win32 });
    expect(env.DSH_HOME).toBe("C:\\Users\\x\\.bruine");
  });
});

describe("resolveDshEntry (T14.2)", () => {
  test("resolves the pinned @deepseek-ai/dsh copy bundled with kumo", () => {
    const entry = resolveDshEntry();
    expect(entry).toBeDefined();
    expect(existsSync(entry as string)).toBe(true);
    expect(entry!.endsWith(join("lib", "bin.js")) || entry!.endsWith("lib\\bin.js")).toBe(true);
  });
});

describe("dshInvocation", () => {
  test("PATH fallback", () => {
    expect(dshInvocation(undefined, ["plugin"])).toEqual({ command: "dsh", args: ["plugin"] });
  });
  test("pinned copy runs under the current node binary", () => {
    const inv = dshInvocation("/x/bin.js", ["plugin", "--profile", "bruine"]);
    expect(inv.command).toBe(process.execPath);
    expect(inv.args[0]).toBe("/x/bin.js");
    expect(inv.args.slice(1)).toEqual(["plugin", "--profile", "bruine"]);
  });
});

// T31c: the launcher turns the session-title LLM off for local routes.
const settingsWith = (baseURL: string) =>
  `llm-pi-ai:\n  providers:\n    local:\n      baseURL: ${baseURL}\nagent-default-model:\n  provider: local\n  model: m\n`;

describe("localDefaultRoute (T31c)", () => {
  const read = (text: string) => () => text;
  test("localhost and private ranges are local", () => {
    expect(localDefaultRoute("/h", read(settingsWith("http://127.0.0.1:8081/v1")))).toBe(true);
    expect(localDefaultRoute("/h", read(settingsWith("http://localhost:11434/v1")))).toBe(true);
    expect(localDefaultRoute("/h", read(settingsWith("http://192.168.1.64:8081/v1")))).toBe(true);
    expect(localDefaultRoute("/h", read(settingsWith("http://10.0.0.5:1234/v1")))).toBe(true);
  });
  test("public routes and unreadable homes are not", () => {
    expect(localDefaultRoute("/h", read(settingsWith("https://api.deepseek.com/v1")))).toBe(false);
    expect(localDefaultRoute("/h", read("not: [valid"))).toBe(false);
    expect(localDefaultRoute("/h", () => { throw new Error("ENOENT"); })).toBe(false);
  });
  test("buildLaunch passes an injected KUMO_TITLE_LLM through", () => {
    expect(buildLaunch([], {}, "/home").env.KUMO_TITLE_LLM).toBeUndefined();
    const off = buildLaunch([], { KUMO_TITLE_LLM: "off" }, "/home");
    expect(off.env.KUMO_TITLE_LLM).toBe("off");
  });
});
