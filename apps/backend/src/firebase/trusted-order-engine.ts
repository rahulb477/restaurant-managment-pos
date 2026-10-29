/**
 * Server-authoritative order/checkout/inventory helpers used by both
 * Postgres and Firestore paths. Callers must never trust client totals.
 */
import { computeBill, settlePayments, type BillInput } from '../modules/orders/settlement';

export type StockRow = { id: string; quantity: number; version: number };

export class TenantIsolationError extends Error {
  constructor(message = 'Cross-tenant access denied') {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

export function assertSameRestaurant(
  actorRestaurantId: string,
  resourceRestaurantId: string,
) {
  if (actorRestaurantId !== resourceRestaurantId) {
    throw new TenantIsolationError();
  }
}

export function nextOrderNumber(last: number): number {
  if (!Number.isInteger(last) || last < 0) {
    throw new Error('Invalid order counter');
  }
  return last + 1;
}

/** Idempotent checkout: same requestId returns the first result. */
export function rememberRequest<T>(
  cache: Map<string, T>,
  requestId: string,
  compute: () => T,
): T {
  if (!requestId) throw new Error('requestId required');
  const hit = cache.get(requestId);
  if (hit) return hit;
  const value = compute();
  cache.set(requestId, value);
  return value;
}

export function applyInventoryDeduction(
  stock: StockRow,
  qty: number,
): StockRow {
  if (qty < 0) throw new Error('Deduction must be non-negative');
  if (stock.quantity < qty) throw new Error('Insufficient stock');
  return { ...stock, quantity: stock.quantity - qty, version: stock.version + 1 };
}

export function assertPaymentNotClientConfirmed(clientSaysPaid: boolean, serverStatus: string) {
  if (clientSaysPaid && serverStatus !== 'PAID') {
    throw new Error('Payment is not received until the server records it');
  }
}

export function serverBill(input: BillInput) {
  return computeBill(input);
}

export function serverSettle(
  balance: number,
  payments: Parameters<typeof settlePayments>[1],
  opts?: Parameters<typeof settlePayments>[2],
) {
  return settlePayments(balance, payments, opts);
}

/**
 * Compare-and-set stock: concurrent writers with a stale version lose.
 */
export function casStock(current: StockRow, expectedVersion: number, next: StockRow): StockRow {
  if (current.version !== expectedVersion) {
    throw new Error('Stock version conflict');
  }
  return next;
}
