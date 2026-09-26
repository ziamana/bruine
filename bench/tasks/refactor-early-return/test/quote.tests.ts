import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteFor, type Customer } from "../src/quote.ts";

const member = (extra: Partial<Customer> = {}): Customer => ({ country: "FR", member: true, ...extra });

test("a member with the welcome coupon over 100 gets 10% off", () => {
  assert.deepEqual(quoteFor(member({ coupon: "WELCOME" }), 200), { total: 180, currency: "EUR", discount: 10 });
});

test("a member with the welcome coupon under 100 gets 5% off", () => {
  assert.deepEqual(quoteFor(member({ coupon: "WELCOME" }), 50), { total: 47.5, currency: "EUR", discount: 5 });
});

test("a member without a coupon over 100 gets 5% off", () => {
  assert.deepEqual(quoteFor(member(), 200), { total: 190, currency: "EUR", discount: 5 });
});

test("a member without a coupon under 100 pays full price", () => {
  assert.deepEqual(quoteFor(member(), 50), { total: 50, currency: "EUR", discount: 0 });
});

test("a stranger abroad is converted to dollars", () => {
  const quote = quoteFor({ country: "US", member: false }, 200);
  assert.equal(quote.currency, "USD");
  assert.ok(Math.abs(quote.total - 220) < 1e-9, `expected about 220, got ${String(quote.total)}`);
});

test("an unknown country is left in euros", () => {
  assert.deepEqual(quoteFor({ country: "JP", member: false }, 200), { total: 200, currency: "EUR", discount: 0 });
});
