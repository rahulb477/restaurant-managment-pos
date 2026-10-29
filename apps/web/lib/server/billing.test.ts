import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBill, round2, settlePayments } from "./billing.ts";

test("GST inclusive: discount scales tax", () => {
  const bill = computeBill({
    lines: [{ lineTotal: 118, taxAmount: 18 }],
    discountPercent: 10,
  });
  assert.equal(bill.subtotal, 118);
  assert.equal(bill.discountAmount, 11.8);
  assert.equal(bill.taxAmount, 16.2);
});

test("idempotent cash settlement covers the bill", () => {
  const s = settlePayments({
    balance: 100,
    payments: [{ method: "CASH", amount: 100, tendered: 100 }],
  });
  assert.equal(s.fullyPaid, true);
  assert.equal(s.paidNow, 100);
});

test("card cannot overpay", () => {
  assert.throws(() =>
    settlePayments({
      balance: 50,
      payments: [{ method: "CARD", amount: 80 }],
    }),
  );
});

test("round2 is stable", () => {
  assert.equal(round2(1.005), 1.01);
});
