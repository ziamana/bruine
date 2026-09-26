import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slug.ts";

test("lower case, words joined by one dash", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("punctuation is dropped", () => {
  assert.equal(slugify("Kumo, the terminal agent!"), "kumo-the-terminal-agent");
});

test("extra spaces and dashes collapse", () => {
  assert.equal(slugify("  Too   many--spaces  "), "too-many-spaces");
});

test("symbols are not words", () => {
  assert.equal(slugify("C++ & Rust"), "c-rust");
});

test("digits survive", () => {
  assert.equal(slugify("kumo 27b"), "kumo-27b");
});
