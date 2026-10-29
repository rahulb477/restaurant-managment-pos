export const MIGRATABLE_DOMAINS = [
  'menu',
  'settings',
  'tables',
  'reservations',
  'customers',
  'orders',
  'kds',
  'inventory',
] as const;

export type MigratableDomain = (typeof MIGRATABLE_DOMAINS)[number];

/** Comma-separated FIRESTORE_DOMAINS. Empty = all domains stay on Postgres. */
export function parseFirestoreDomains(raw: string | undefined): Set<MigratableDomain> {
  const set = new Set<MigratableDomain>();
  if (!raw) return set;
  for (const part of raw.split(',')) {
    const d = part.trim() as MigratableDomain;
    if ((MIGRATABLE_DOMAINS as readonly string[]).includes(d)) set.add(d);
  }
  return set;
}

export function domainOnFirestore(
  domain: MigratableDomain,
  raw: string | undefined,
): boolean {
  return parseFirestoreDomains(raw).has(domain);
}
