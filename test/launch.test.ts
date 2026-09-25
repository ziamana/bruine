import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { buildLaunch, flagMode } from "../src/launch.js";

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
  test("default home → DSH_HOME ends with /.kumo", () => {
    const { env } = buildLaunch([], { PATH: "/usr/bin" }, "/home/tu44");
    expect(env.DSH_HOME).toBe(join("/home/tu44", ".kumo"));
    expect(env.DSH_HOME.endsWith("/.kumo")).toBe(true);
  });

  test("KUMO_HOME overrides DSH_HOME", () => {
    const { env } = buildLaunch([], { KUMO_HOME: "/tmp/x" }, "/home/tu44");
    expect(env.DSH_HOME).toBe("/tmp/x");
  });

  test("argv is passed through after --profile kumo", () => {
    const { command, args } = buildLaunch(["fix the tests"], {}, "/home/x");
    expect(command).toBe("dsh");
    expect(args).toEqual(["--profile", "kumo", "fix the tests"]);
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
});
