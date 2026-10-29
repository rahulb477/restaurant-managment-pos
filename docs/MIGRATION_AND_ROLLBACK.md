# Migration and rollback

## Do not

- Drop PostgreSQL or run destructive `migrate reset` on production.
- Overwrite production Firestore without a dry-run.
- Enable Blaze/Cloud Functions without approval.

## Forward

1. Deploy Nest with `AUTH_PROVIDER=jwt` and `DATA_STORE=postgres` (current).
2. Configure Firebase env vars; keep flags off.
3. Deploy Firestore rules.
4. Set `IMGBB_API_KEY` for public images.
5. Optional: `AUTH_PROVIDER=firebase` after users exist in Firebase Auth (script: `apps/backend/src/firebase/migrate-users.ts` when credentials exist).
6. Dual-write register/settings (`FirebaseFirestoreService` no-ops if unconfigured).
7. Cut `DATA_STORE=firestore` per module after reconciliation counts match.
8. Remove Prisma only when `grep prisma apps/backend/src` is clean.

## Rollback

1. Set `AUTH_PROVIDER=jwt` and `DATA_STORE=postgres`.
2. Restart Nest. Session cookie is the same name; JWT secret must still be valid.
3. ImgBB URLs already stored on menu rows keep working (absolute https). Local uploads still served.

## Data script

A repeatable export is `apps/backend/src/firebase/export-mapping.ts` (dry documentation of collections). Do not run a live copy until `FIREBASE_*` is set and a written approval is given.

## Reconciliation

Compare Postgres `COUNT(*)` per table vs Firestore collection counts for `orders`, `menuItems`, `users` before deleting anything.
