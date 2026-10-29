import { domainOnFirestore, parseFirestoreDomains } from './domain-flags';

describe('domain flags', () => {
  it('defaults to postgres for every domain', () => {
    expect(parseFirestoreDomains(undefined).size).toBe(0);
    expect(domainOnFirestore('menu', undefined)).toBe(false);
    expect(domainOnFirestore('orders', '')).toBe(false);
  });

  it('enables only listed domains', () => {
    expect(domainOnFirestore('menu', 'menu,settings')).toBe(true);
    expect(domainOnFirestore('settings', 'menu,settings')).toBe(true);
    expect(domainOnFirestore('orders', 'menu,settings')).toBe(false);
  });

  it('ignores unknown names', () => {
    expect(parseFirestoreDomains('menu,nope,orders').has('orders')).toBe(true);
    expect(parseFirestoreDomains('menu,nope').size).toBe(1);
  });
});
