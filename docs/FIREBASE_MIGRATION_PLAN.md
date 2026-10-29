# Firebase + ImgBB migration plan

Audited from source in this repository (not README claims). Date: 2026-10-29.

## 1. Current architecture (verified)

| Layer | Actual implementation |
|---|---|
| Monorepo | pnpm workspaces + Turborepo (`apps/backend`, `apps/web`, `packages/types`) |
| Backend | NestJS 11, Prisma 6, PostgreSQL |
| Auth | JWT in httpOnly cookie `nodedr_session`, Passport JWT, bcrypt passwords, optional TOTP, PIN login |
| Realtime | Single Socket.IO gateway, rooms per `branchId`, cookie-authenticated |
| Frontend | Next.js 16 App Router, TanStack Query, `fetch` to `/api/v1` rewritten to Nest |
| Images | Multer disk storage under `UPLOADS_DIR`, served at `/api/uploads/*`. S3 used for backups, not menu photos |
| Offline | Local LAN stack (Postgres + Nest + Next). Not client-side CRDT offline |

### Prisma models (complete list)

Restaurant, Branch, Permission, Role, RolePermission, User, StaffApiKey, IntegrationApiKey, UserBranch, AuditLog, Notification, Backup, BackupConfig, Floor, Table, MenuCategory, KitchenStation, Ingredient, RecipeIngredient, Supplier, PurchaseOrder, PurchaseOrderItem, GoodsReceipt, GoodsReceiptItem, PurchaseRequest, PurchaseRequestItem, SupplierQuotation, SupplierQuotationItem, SupplierInvoice, SupplierPayment, StockBatch, StockMovement, WasteLog, MenuItem, ModifierGroup, Modifier, MenuItemModifierGroup, Customer, GiftCard, GiftCardRedemption, ComboComponent, Order, OrderItem, OrderItemModifier, Kot, KotItem, Reservation, WaitlistEntry, Payment, Refund, OrderItemStockReturn, DownloadStat, Attendance, DeliveryZone, TableRequest, Shift, LeaveRequest, StaffPay, PayrollRun, PayrollLine, Expense, CashClosing, Coupon, Promotion, Campaign, Equipment, ServiceLog, Document, WebhookEndpoint, WebhookDelivery, Budget, BankTransaction, StockTransfer, DocumentFile, ReportSchedule, VerifactuSettings, VerifactuRecord, SyncState, SyncChange.

### Nest modules (verified under `apps/backend/src`)

auth, prisma, realtime, permissions, roles, audit, notifications, backup, integrations, mcp, system, sync, modules/{accounting, attendance, customers, dashboard, delivery, downloads, email, gift-cards, hr, inventory, kds, marketing, menu, operations, orders, public, reports, reservations, restaurants, settings, tables, users, verifactu, waitlist, webhooks}.

### Frontend API consumers

`apps/web/lib/api.ts` + hooks (`use-auth`, `use-orders`, `use-menu`, `use-kds`, `use-realtime`, …). Socket.IO client in `use-realtime.ts`.

## 2. Migration mapping

| Domain | Postgres | Firestore collection | Trusted writes |
|---|---|---|---|
| Tenancy | restaurants, branches | `restaurants`, `branches` | Admin SDK on register/settings |
| Auth/RBAC | users, roles, permissions | `users`, `roles`, `permissions` | Never client-writable roles |
| Menu | menuCategories, menuItems, modifiers | `menuCategories`, `menuItems`, `modifierGroups` | Staff with `menu.manage` via API |
| Floor | floors, tables | `floors`, `tables` | API |
| Orders | orders, orderItems, payments, refunds, kots | `orders`, `orderItems`, `payments`, `refunds`, `kitchenTickets` | **Server only** |
| Inventory | ingredients, stock*, PO, GRN | `inventory/*` | **Server only** for qty |
| Customers / loyalty | customers, giftCards | `customers`, `giftCards` | Balance changes server-only |
| HR | attendance, shifts, leave, payroll | `attendance`, `shifts`, `leaveRequests`, `payrollRuns` | API |
| Accounting | expenses, cashClosings, budgets | `expenses`, `cashClosings`, `accounting` | API |
| Marketing | coupons, promotions, campaigns | `coupons`, `promotions` | API |
| Delivery | deliveryZones | `deliveryZones`, `deliveryOrders` | API |
| Audit / settings | auditLogs | `auditLogs`, `settings` | Server only |
| Images | local disk URLs | URL fields on docs | ImgBB via Nest |

IDs stay CUID-compatible strings. Restaurant + branch IDs are required on every tenant document.

## 3. Phased approach (do not delete Prisma yet)

1. **Adapter layer** — `DATA_STORE=postgres|firestore`, `AUTH_PROVIDER=jwt|firebase`. Default remains postgres+jwt so existing deploys keep working.
2. **Firebase Auth** — Nest verifies ID tokens / session cookies; staff roles still live in application data, never in client claims alone.
3. **ImgBB** — menu/logo public images; documents/backups stay off ImgBB.
4. **Dual-write** on register and image metadata.
5. **Realtime** — keep Socket.IO until Firestore listeners are wired per screen; then remove.
6. **Cutover** — `DATA_STORE=firestore` after reconciliation.
7. **Remove Prisma** only when no module reads it (see `MIGRATION_AND_ROLLBACK.md`).

## 4. Trusted operations (must stay on Nest / Admin SDK)

Order create/checkout, price/tax/discount (`settlement.ts` / `pricing.ts`), inventory deduction, refunds, loyalty, payment status, order numbering, role changes, audit logs.

Client must not submit authoritative prices, tax totals, payment “success”, or stock quantities.

Currency: keep existing Decimal/GST rules; store minor units in Firestore numbers where new writes occur.

## 5. Offline

Honest scope from `ARCHITECTURE.md`: offline means the **LAN server** stays up without WAN. Firestore-hosted mode **requires network** to Firebase. Limitations:

- Firestore offline persistence can cache reads and queue non-financial writes.
- Order capture while fully offline must use local `requestId` idempotency and **must not** mark payments received until the server confirms.
- Conflicting stock: last-write-wins is unsafe; use transactions + version fields.
- True multi-writer CRDT is out of scope (same as original product).

## 6. Risks

- Firestore 1 MiB doc limit vs large order snapshots.
- No SQL joins — reports need denormalized counters or Cloud Functions (Blaze billing).
- Socket.IO and Firestore listeners can double-notify during dual run.
- Firebase Auth PIN login has no native equivalent — keep PIN on Nest + hashed pin in user doc.
- ImgBB is public hosting — never send IDs, payroll, or backups.
- Admin SDK bypasses security rules — Nest must authorize independently.

## 7. Testing plan

Unit: ImgBB client (mocked HTTP), settlement (existing), Firebase token guard (mocked admin).
Integration: register/login isolation, menu upload auth, order numbering transaction.
Rules: emulator tests when emulator is available (not claimed unless run).
Regression: existing `apps/backend` jest + `apps/web` node:test.

## 8. Cost

Spark (free): Auth, Firestore modest usage, no Cloud Functions gen2 at scale.
Blaze required for: outbound Cloud Functions to ImgBB if moved off Nest, some Auth SMS, exceeding free quotas.

This migration keeps **Nest as the trusted server** so Cloud Functions are optional and **not enabled** without permission.
