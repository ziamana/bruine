import { test } from "node:test";
import assert from "node:assert/strict";
import { totalWithTax } from "../src/money.ts";

test("20% on 1000 cents is 1200", () => {
  assert.equal(totalWithTax({ cents: 1000, taxRate: 0.2 }), 1200);
});

test("no cent is invented or lost", () => {
  assert.equal(totalWithTax({ cents: 1050, taxRate: 0.2 }), 1260);
  assert.equal(totalWithTax({ cents: 1999, taxRate: 0.075 }), 2149);
});

test("a zero tax is the same amount", () => {
  assert.equal(totalWithTax({ cents: 1234, taxRate: 0 }), 1234);
});
