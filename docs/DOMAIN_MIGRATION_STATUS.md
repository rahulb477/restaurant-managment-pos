# Domain-by-domain migration status

Default: **PostgreSQL + JWT**. Firestore is opt-in per domain via `FIRESTORE_DOMAINS` (comma list). Socket.IO remains the live KDS channel until Firestore listeners are tested against a real project.

| Domain | Runtime source of truth | Firestore | Notes |
|---|---|---|---|
| Auth session | JWT cookie (`AUTH_PROVIDER=jwt`) | Firebase session cookie if `AUTH_PROVIDER=firebase` **and** Admin + web API key work | Roles still loaded from Postgres |
| Menu | Postgres | Dual-write categories/items when `menu` listed | Reads still Postgres |
| Settings | Postgres | Dual-write restaurant when `settings` listed | |
| Tables / reservations | Postgres | Not cut over | |
| Customers | Postgres | Not cut over | |
| Orders / checkout / GST / refunds | Postgres (`settlement.ts`) | Engine in `trusted-order-engine.ts` unit-tested; **not** live Firestore checkout | |
| Inventory | Postgres | CAS/deduction helpers unit-tested only | |
| KDS / realtime | Socket.IO | **Not migrated** | Do not remove gateway |
| Images | Local disk or ImgBB | Metadata dual-write if Admin configured | |
| HR, accounting, reports, Verifactu, backups | Postgres | Not migrated | |

Rollback: unset `FIRESTORE_DOMAINS`, keep `AUTH_PROVIDER=jwt`, restart Nest.

## Manual setup still required

Firebase project, Email/Password, Firestore, service account env, `firestore.rules` deploy, `IMGBB_API_KEY`, optional `FIRESTORE_DOMAINS=menu,settings`.

## Blockers for a full cutover

- No Firebase credentials in this environment — live Auth/Firestore/ImgBB **not** executed.
- Prisma generate/engine download may fail without binaries.prisma.sh.
- Cloud Functions not used (would need Blaze).
- Reports/joins have no Firestore equivalent yet.
