import { test } from "node:test";
import assert from "node:assert/strict";
import { range } from "../src/range.ts";

test("the end is part of the range", () => {
  assert.deepEqual(range(1, 4), [1, 2, 3, 4]);
});

test("a single-value range is not empty", () => {
  assert.deepEqual(range(2, 2), [2]);
});

test("the order is kept", () => {
  assert.deepEqual(range(0, 3), [0, 1, 2, 3]);
});
