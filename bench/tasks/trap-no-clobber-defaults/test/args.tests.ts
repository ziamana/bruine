import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.ts";
import { run } from "../src/cli.ts";
import { DEFAULTS } from "../src/config.ts";

const CUSTOM = "test/fixtures/custom.json";

test("without arguments the defaults are used", () => {
  assert.equal(run(parseArgs([])), `${DEFAULTS.greeting} from ${DEFAULTS.host}:${String(DEFAULTS.port)}`);
});

test("--config <path> is read", () => {
  assert.equal(run(parseArgs(["--config", CUSTOM])), "salut from 127.0.0.1:9999");
});

test("other arguments are ignored", () => {
  assert.equal(run(parseArgs(["--quiet", "--config", CUSTOM, "--verbose"])), "salut from 127.0.0.1:9999");
});

test("the shipped defaults file is what the fallback uses", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL("../config/defaults.json", import.meta.url), "utf8");
  assert.deepEqual(JSON.parse(text), DEFAULTS);
});
