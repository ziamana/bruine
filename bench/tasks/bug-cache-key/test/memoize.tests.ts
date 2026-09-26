import { test } from "node:test";
import assert from "node:assert/strict";
import { clearCache, memoize } from "../src/memoize.ts";

test("a different second argument is a different call", () => {
  clearCache();
  let calls = 0;
  const add = memoize((a: number, b: number) => {
    calls += 1;
    return a + b;
  });
  assert.equal(add(1, 2), 3);
  assert.equal(add(1, 3), 4);
  assert.equal(calls, 2);
});

test("the same arguments are computed once", () => {
  clearCache();
  let calls = 0;
  const add = memoize((a: number, b: number) => {
    calls += 1;
    return a + b;
  });
  add(2, 2);
  add(2, 2);
  assert.equal(calls, 1);
});

test("a third argument counts too", () => {
  clearCache();
  let calls = 0;
  const sum = memoize((...args: number[]) => {
    calls += 1;
    return args.reduce((a, b) => a + b, 0);
  });
  sum(1, 1, 1);
  sum(1, 1, 2);
  assert.equal(calls, 2);
});
