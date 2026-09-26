import { test } from "node:test";
import assert from "node:assert/strict";
import { debounce } from "../src/debounce.ts";
import { RateLimiter } from "../src/rate-limit.ts";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("debounce runs once for a burst", async () => {
  let calls = 0;
  const run = debounce(() => {
    calls += 1;
  }, 10);
  run();
  run();
  run();
  await wait(60);
  assert.equal(calls, 1);
});

test("debounce runs again after the wait", async () => {
  let calls = 0;
  const run = debounce(() => {
    calls += 1;
  }, 10);
  run();
  await wait(40);
  run();
  await wait(40);
  assert.equal(calls, 2);
});

test("a later call replaces the arguments", async () => {
  const seen: string[] = [];
  const run = debounce((value: string) => {
    seen.push(value);
  }, 10);
  run("first");
  run("second");
  await wait(60);
  assert.deepEqual(seen, ["second"]);
});

test("the limiter runs the last call of a burst, once", async () => {
  const ran: number[] = [];
  const limiter = new RateLimiter({ waitMs: 30 });
  limiter.schedule(() => ran.push(1));
  limiter.schedule(() => ran.push(2));
  limiter.schedule(() => ran.push(3));
  await wait(10);
  assert.deepEqual(ran, []);
  await wait(120);
  assert.deepEqual(ran, [3]);
});

test("the limiter lets the next burst through", async () => {
  const ran: number[] = [];
  const limiter = new RateLimiter({ waitMs: 20 });
  limiter.schedule(() => ran.push(1));
  await wait(120);
  limiter.schedule(() => ran.push(2));
  await wait(120);
  assert.deepEqual(ran, [1, 2]);
});
