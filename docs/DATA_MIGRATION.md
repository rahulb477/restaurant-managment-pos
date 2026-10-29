# PostgreSQL → Firestore data migration

Do **not** drop PostgreSQL until this is run, reconciled, and approved.

## Script (dry-run first)

`apps/backend` remains in the repo for one-time export. A repeatable approach:

1. `pg_dump` the production database.
2. For each Prisma model, export JSON: `id` plus scalar fields plus FKs.
3. Write documents to the collections in `docs/FIRESTORE_SCHEMA.md` using Admin SDK, **preserving IDs**.
4. Compare `COUNT(*)` vs Firestore `select count`.
5. Sum `orders.totalAmount` where `status=PAID` vs Firestore.
6. Spot-check 20 orders’ line items and payments.

No automated live copy is executed in this environment (no production credentials).

## Incompatible bits

- SQL joins / report views must be replaced by application aggregation.
- `Decimal` → string or number (this app stores money as strings on order docs, matching the existing API).
- Socket.IO rooms have no documents.
- Local `uploads/` files: re-upload public images to ImgBB; keep private files off ImgBB.

## Rollback

Keep Postgres running; point a previous Nest+Next rewrite deploy at `DATABASE_URL`. Firestore data can remain.
