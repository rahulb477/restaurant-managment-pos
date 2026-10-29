import type { TaxMode } from "@nodedr-restaurant/types";

class BillError extends Error {
  status = 400;
}

export function toEffectiveInclusiveUnitPrice(
  rawUnitPrice: number,
  taxRatePercent: number,
  taxMode: TaxMode,
): number {
  if (taxMode === "EXCLUSIVE" && taxRatePercent > 0) {
    return round2(rawUnitPrice * (1 + taxRatePercent / 100));
  }
  return round2(rawUnitPrice);
}

export interface PricedLine {
  lineTotal: number;
  taxAmount: number;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function priceLine(input: {
  quantity: number;
  unitPriceInclusive: number;
  taxRatePercent: number;
}): PricedLine {
  const lineTotal = round2(input.unitPriceInclusive * input.quantity);
  const rate = input.taxRatePercent / 100;
  const taxAmount = rate > 0 ? round2(lineTotal - lineTotal / (1 + rate)) : 0;
  return { lineTotal, taxAmount };
}

export function computeOrderTotals(
  lines: PricedLine[],
  discountPercent = 0,
  discountFlat = 0,
) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const taxAmount = round2(lines.reduce((sum, l) => sum + l.taxAmount, 0));
  const percentDiscount = round2((subtotal * discountPercent) / 100);
  const discountAmount = round2(Math.min(percentDiscount + discountFlat, subtotal));
  const totalAmount = round2(subtotal - discountAmount);
  return { subtotal, taxAmount, discountAmount, totalAmount };
}

export function discountPercentOf(subtotal: number, discountAmount: number): number {
  if (subtotal <= 0 || discountAmount <= 0) return 0;
  return round2((discountAmount / subtotal) * 100);
}

export function computeBill(input: {
  lines: PricedLine[];
  discountPercent?: number;
  discountFlat?: number;
  autoDiscount?: number;
  loyaltyDiscountRequested?: number;
  tip?: number;
  deliveryFee?: number;
}) {
  const totals = computeOrderTotals(
    input.lines,
    input.discountPercent ?? 0,
    (input.discountFlat ?? 0) + (input.autoDiscount ?? 0),
  );
  const loyaltyDiscountAmount = round2(
    Math.min(Math.max(input.loyaltyDiscountRequested ?? 0, 0), totals.totalAmount),
  );
  const tipAmount = round2(input.tip ?? 0);
  const deliveryFee = round2(input.deliveryFee ?? 0);
  const taxAmount =
    totals.subtotal > 0
      ? round2((totals.taxAmount * (totals.subtotal - totals.discountAmount)) / totals.subtotal)
      : 0;
  return {
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    discountPercent: discountPercentOf(totals.subtotal, totals.discountAmount),
    taxAmount,
    loyaltyDiscountAmount,
    tipAmount,
    deliveryFee,
    totalDue: round2(totals.totalAmount - loyaltyDiscountAmount + tipAmount + deliveryFee),
  };
}

export function settlePayments(args: {
  balance: number;
  payments: { method: string; amount: number; tendered?: number; reference?: string }[];
  giftCardApplied?: number;
  allowPartial?: boolean;
}) {
  const balance = round2(args.balance);
  const giftCardApplied = round2(args.giftCardApplied ?? 0);
  const lines = args.payments.map((p) => {
    const amount = round2(p.amount);
    if (!(amount > 0)) throw new BillError("Each payment must be more than zero");
    if (p.tendered !== undefined) {
      if (p.method !== "CASH") {
        throw new BillError("Only a cash payment can have an amount received");
      }
      const tendered = round2(p.tendered);
      if (tendered < amount) {
        throw new BillError("The amount received cannot be less than the payment");
      }
      return {
        method: p.method,
        amount,
        tendered,
        changeGiven: round2(tendered - amount),
        reference: p.reference,
      };
    }
    return {
      method: p.method,
      amount,
      tendered: null as number | null,
      changeGiven: null as number | null,
      reference: p.reference,
    };
  });

  let excess = round2(lines.reduce((s, l) => s + l.amount, 0) + giftCardApplied - balance);
  if (excess > 0) {
    for (let i = lines.length - 1; i >= 0 && excess > 0; i--) {
      const line = lines[i];
      if (line.method !== "CASH") continue;
      const take = Math.min(excess, line.amount);
      const handedOver = line.tendered ?? line.amount;
      line.amount = round2(line.amount - take);
      line.tendered = handedOver;
      line.changeGiven = round2(handedOver - line.amount);
      excess = round2(excess - take);
    }
    if (excess > 0) {
      throw new BillError(`Payments exceed the amount due (${balance}) - only cash can be over-tendered`);
    }
  }

  const kept = lines.filter((l) => l.amount > 0);
  const paidNow = round2(kept.reduce((s, l) => s + l.amount, 0) + giftCardApplied);
  const balanceAfter = round2(balance - paidNow);
  const fullyPaid = balanceAfter <= 0;
  if (!fullyPaid && !args.allowPartial) {
    throw new BillError(`Payments (${paidNow}) do not cover the total due (${balance})`);
  }
  if (!fullyPaid && paidNow <= 0) {
    throw new BillError("Enter a payment to record");
  }
  return {
    payments: kept,
    paidNow,
    balanceAfter: Math.max(balanceAfter, 0),
    changeDue: round2(kept.reduce((s, l) => s + (l.changeGiven ?? 0), 0)),
    fullyPaid,
  };
}
