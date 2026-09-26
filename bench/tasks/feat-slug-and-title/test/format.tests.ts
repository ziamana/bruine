import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTitle, type Article } from "../src/index.ts";

const article = (title: string): Article => ({ title, body: "" });

test("the slug is appended to the title", () => {
  assert.equal(formatTitle(article("Hello World")), "Hello World (hello-world)");
});

test("a title that is already a slug still works", () => {
  assert.equal(formatTitle(article("kumo-bench")), "kumo-bench (kumo-bench)");
});
