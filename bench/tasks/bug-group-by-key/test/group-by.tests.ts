import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBy, type User } from "../src/group-by.ts";

const ada: User = { name: "Ada", role: "admin" };
const lin: User = { name: "Lin", role: "user" };
const bo: User = { name: "Bo", role: "user" };

test("one key per distinct role", () => {
  assert.deepEqual(Object.keys(groupBy([ada, lin, bo], (u) => u.role)).sort(), ["admin", "user"]);
});

test("every user lands in its own bucket", () => {
  const groups = groupBy([ada, lin, bo], (u) => u.role);
  assert.deepEqual(groups["admin"], [ada]);
  assert.deepEqual(groups["user"], [lin, bo]);
});

test("an empty list gives no keys", () => {
  assert.deepEqual(groupBy([], (u) => u.role), {});
});
