import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('firestore.rules', () => {
  const rules = readFileSync(
    join(__dirname, '../../../../firestore.rules'),
    'utf8',
  );

  it('defaults to deny', () => {
    expect(rules).toContain('allow read, write: if false');
  });

  it('does not contain a global allow-all', () => {
    expect(rules).not.toMatch(/allow read, write:\s*if true/);
  });

  it('blocks client writes to financial collections', () => {
    for (const col of ['orders', 'payments', 'refunds', 'stockMovements', 'payrollRuns']) {
      expect(rules).toContain(`match /${col}/{id}`);
    }
    expect(rules).toContain('denyClientWrites');
  });

  it('scopes reads to restaurant via userDoc', () => {
    expect(rules).toContain('sameRestaurant');
    expect(rules).toContain('userDoc().restaurantId');
  });
});
