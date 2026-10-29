# Firestore security rules

Source of truth: `/firestore.rules`.

Admin SDK (Nest) **bypasses** these rules. Nest must still check JWT/Firebase session, restaurant, branch, and permission keys.

## Principles

- Default deny.
- Unauthenticated reads only for public menu fields if a future customer app uses the client SDK. Current QR/kiosk traffic goes through Nest `PublicModule`, so rules keep public client access **off** until that path is explicitly enabled.
- Staff client SDK (if used) may read own restaurant docs when `users/{uid}.restaurantId` matches and `isActive`.
- Sensitive writes (`orders`, `payments`, `refunds`, `stockMovements`, `payrollRuns`, `roles`) are **deny for clients** — Nest only.
- No `allow read, write: if true`.

## Deploy

```
firebase deploy --only firestore:rules
```

Or paste `firestore.rules` in Console → Firestore → Rules.

## Tests

`apps/backend/src/firebase/firestore-rules.spec.ts` asserts the rule file contains deny-by-default and blocks client writes to financial collections. Full emulator tests require the Firestore emulator (not started in CI here).

## Cross-tenant

A user document’s `restaurantId` must equal the resource `restaurantId`. Branch docs must match that restaurant. Rules never trust `request.resource.data.role`.
