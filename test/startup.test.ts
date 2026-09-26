import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { internals } from "@deepseek-ai/dsh-cmdline";
import { apply, KUMO_STARTUP_SERVICE } from "../src/plugins/startup.js";
import { fakeCtx } from "./fakes.js";

const realStdout = internals.stdout;
const realStderr = internals.stderr;
beforeAll(() => {
  // keep commander's help output out of the test log
  (internals as any).stdout = { write: () => true };
  (internals as any).stderr = { write: () => true };
});
afterAll(() => {
  (internals as any).stdout = realStdout;
  (internals as any).stderr = realStderr;
});

function run(args: string[]) {
  const fake = fakeCtx();
  const exits: number[] = [];
  const services: Record<string, unknown> = {
    cmdlineArgs: { get: () => args },
    appExit: (code: number) => {
      exits.push(code);
    },
  };
  const ctx = {
    ...fake.ctx,
    get: (s: string) => fake.ctx.get(s) ?? services[s],
  };
  apply(ctx as any);
  return { fake, exits };
}

describe("kumo-startup", () => {
  test("positional words become the initial prompt", () => {
    const { fake, exits } = run(["fix", "the", "tests"]);
    expect(fake.provided.get(KUMO_STARTUP_SERVICE)).toEqual({
      initialPrompt: "fix the tests",
    });
    expect(exits).toEqual([]);
  });

  test("no args provides an empty startup", () => {
    const { fake } = run([]);
    expect(fake.provided.get(KUMO_STARTUP_SERVICE)).toEqual({});
  });

  test("headless flags publish ordered prompts and output format", () => {
    const { fake } = run(["-p", "first", "--print", "second", "--output-format", "json"]);
    expect(fake.provided.get(KUMO_STARTUP_SERVICE)).toEqual({
      headless: { prompts: ["first", "second"], format: "json" },
    });
  });

  test("--help exits 0 without providing", () => {
    const { fake, exits } = run(["--help"]);
    expect(exits).toEqual([0]);
    expect(fake.provided.has(KUMO_STARTUP_SERVICE)).toBe(false);
  });

  test("-h exits 0 without providing", () => {
    const { fake, exits } = run(["-h"]);
    expect(exits).toEqual([0]);
    expect(fake.provided.has(KUMO_STARTUP_SERVICE)).toBe(false);
  });
});
