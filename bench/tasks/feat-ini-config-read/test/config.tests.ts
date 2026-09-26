import { test } from "node:test";
import assert from "node:assert/strict";
import { readIni } from "../src/ini.ts";
import { DEFAULTS, loadConfig, type AppConfig } from "../src/config.ts";

test("key value pairs, trimmed", () => {
  assert.deepEqual(readIni("a = 1\nb=2\n"), { a: "1", b: "2" });
});

test("comments and blank lines are ignored", () => {
  assert.deepEqual(readIni("# note\n\n a = 1 \n"), { a: "1" });
});

test("quotes around the value are optional", () => {
  assert.deepEqual(readIni('a = "1"\nb = \'2\'\n'), { a: "1", b: "2" });
});

test("loadConfig merges the file over the defaults", () => {
  const config: AppConfig = loadConfig("host = 0.0.0.0\nport = 9\n");
  assert.deepEqual(config, { host: "0.0.0.0", port: 9, verbose: DEFAULTS.verbose });
});

test("a missing value keeps the default", () => {
  assert.deepEqual(loadConfig("verbose = true\n"), { ...DEFAULTS, verbose: true });
});
