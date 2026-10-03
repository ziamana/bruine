import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeKey, normalize, searchKey } from "../src/text.ts";

test("normalize trims, lowercases and collapses", () => {
  assert.equal(normalize("  Hello   World "), "hello world");
});

test("searchKey keeps its behaviour", () => {
  assert.equal(searchKey("  Hello   World "), "hello world");
});

test("dedupeKey keeps its behaviour", () => {
  assert.equal(dedupeKey(" Bruine  Bench "), "bruine bench");
});

test("the three are the same normaliser", () => {
  assert.equal(searchKey, dedupeKey);
});
