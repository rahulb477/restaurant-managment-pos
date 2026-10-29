# Firestore schema

Derived from `apps/backend/prisma/schema.prisma`. Documents are scoped by `restaurantId` and, where operational, `branchId`.

## Naming

Top-level collections (not SQL-table clones):

- `restaurants/{restaurantId}` — `name`, `currency`, `timezone`, `setupComplete`, `setupCompletedAt`, `ownerUid` for new setups
- `branches/{branchId}` — `restaurantId`, `name`, optional `address`/`phone`/`taxId`, `country`, `taxRegime`, `taxMode`
- `users/{userId}` — `restaurantId`, `firebaseUid`, `roleId`, `isActive`, `email`, `name` (no password). A newly registered web account has no restaurant yet and has `onboarding.canCreateRestaurant: true` until its setup transaction commits.
- `roles/{roleId}` — `restaurantId`, `name`
- `rolePermissions/{id}` — `roleId`, `permissionKey`
- `permissions/{key}` — global catalog
- `menuCategories/{id}` — `restaurantId`, `branchId`
- `menuItems/{id}` — prices as integer **minor units** (`priceMinor`) plus legacy decimal string for cutover
- `modifierGroups/{id}`, `modifiers/{id}`
- `floors/{id}`, `tables/{id}`
- `orders/{id}` — `number`, `status`, `acceptance`, `totalsMinor`, `requestId` (idempotency)
- `orderItems/{id}`
- `kitchenTickets/{id}` — was `Kot`
- `payments/{id}`, `refunds/{id}`
- `customers/{id}`, `giftCards/{id}`
- `ingredients/{id}`, `stockBatches/{id}`, `stockMovements/{id}`
- `suppliers/{id}`, `purchaseOrders/{id}`, `goodsReceipts/{id}`
- `reservations/{id}`, `waitlist/{id}`
- `attendance/{id}`, `shifts/{id}`, `leaveRequests/{id}`, `payrollRuns/{id}`
- `expenses/{id}`, `cashClosings/{id}`
- `coupons/{id}`, `promotions/{id}`
- `deliveryZones/{id}`
- `auditLogs/{id}`
- `settings/{restaurantId}` — restaurant-level
- `images/{id}` — ImgBB url, deleteHash, owner, kind (`menu` | `logo` | `category`)

## Decisions

1. **No subcollections required** for v1 queries; indexes on `restaurantId`+`branchId`.
2. **Orders** denormalize line snapshots (same as Prisma JSON/snapshots) so kitchen/receipts survive menu edits.
3. **Users** never store password hashes in Firestore when Firebase Auth is on.
4. **Roles** are not Firebase custom claims as the only source of truth; Nest reloads permissions every request.
5. **Documents / backups / Verifactu certs** stay off ImgBB and off public collections.
6. **SyncState / SyncChange** remain Postgres until a dedicated sync agent is rewritten.

## Idempotency

`orders.requestId` is scoped per branch. Checkout retries reuse the same payment docs. Restaurant setup re-reads and updates the pending user document in a Firestore transaction, serializing concurrent retries; the completion marker is committed with restaurant, branch, roles and membership. Existing named restaurants with an active named branch but no marker remain complete for compatibility.

## Concurrency

Stock and order numbers use Firestore transactions (`FirebaseFirestoreService.runTransaction`). Retry transient failures; do not increment counters in the client.

## Vercel Next.js handlers
apps/web/lib/server uses these collections as the production source of truth when Firebase Admin env vars are set. The Vercel app does not connect to PostgreSQL.

