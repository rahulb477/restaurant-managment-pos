import {
  applyInventoryDeduction,
  assertPaymentNotClientConfirmed,
  assertSameRestaurant,
  casStock,
  nextOrderNumber,
  rememberRequest,
  TenantIsolationError,
} from './trusted-order-engine';

describe('tenant isolation', () => {
  it('rejects another restaurant id', () => {
    expect(() => assertSameRestaurant('r1', 'r2')).toThrow(TenantIsolationError);
  });
  it('allows same restaurant', () => {
    expect(() => assertSameRestaurant('r1', 'r1')).not.toThrow();
  });
});

describe('order numbering', () => {
  it('increments from last', () => {
    expect(nextOrderNumber(41)).toBe(42);
  });
  it('serializes concurrent increments via a mutex-like counter', () => {
    let last = 0;
    const results = [0, 1, 2, 3, 4].map(() => {
      last = nextOrderNumber(last);
      return last;
    });
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(results).size).toBe(5);
  });
});

describe('duplicate checkout requestId', () => {
  it('does not double-charge', () => {
    const cache = new Map<string, { paid: number }>();
    const a = rememberRequest(cache, 'req-1', () => ({ paid: 100 }));
    const b = rememberRequest(cache, 'req-1', () => ({ paid: 100 }));
    expect(a).toBe(b);
    expect(cache.size).toBe(1);
  });
});

describe('inventory', () => {
  it('deducts and bumps version', () => {
    const next = applyInventoryDeduction({ id: 'i', quantity: 10, version: 1 }, 3);
    expect(next.quantity).toBe(7);
    expect(next.version).toBe(2);
  });
  it('refuses oversell', () => {
    expect(() =>
      applyInventoryDeduction({ id: 'i', quantity: 1, version: 0 }, 2),
    ).toThrow('Insufficient stock');
  });
  it('CAS rejects stale version', () => {
    const row = { id: 'i', quantity: 5, version: 3 };
    expect(() => casStock(row, 2, { ...row, quantity: 4, version: 4 })).toThrow(
      'Stock version conflict',
    );
  });
});

describe('payment integrity', () => {
  it('ignores client paid=true while server is OPEN', () => {
    expect(() => assertPaymentNotClientConfirmed(true, 'OPEN')).toThrow(
      /not received/,
    );
  });
  it('allows server PAID', () => {
    expect(() => assertPaymentNotClientConfirmed(true, 'PAID')).not.toThrow();
  });
});
