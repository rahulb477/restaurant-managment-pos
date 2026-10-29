# Vercel + Firebase + ImgBB — final architecture

Audited 2026-10-29 from source. Nest dual-write adapters are **not** treated as migrated.

## Existing Nest controllers → Next `/api/v1/*`

| Nest controller | Prefix | Next handler |
|---|---|---|
| auth | `/v1/auth` | `lib/server/handlers/auth.ts` |
| branches | `/v1/branches` | collections + settings |
| settings | `/v1/settings` | settings handler |
| menu | `/v1/menu` | menu handler + ImgBB |
| tables | `/v1/tables` | tables |
| orders | `/v1/orders` | orders (trusted billing) |
| kds | `/v1/kds` | kds |
| customers | `/v1/customers` | generic branch CRUD |
| reservations / waitlist | `/v1/reservations`, `/v1/waitlist` | generic |
| inventory / transfers | `/v1/inventory*` | inventory |
| accounting | `/v1/accounting` | accounting |
| attendance / hr | `/v1/attendance`, `/v1/hr` | hr |
| marketing / gift-cards | `/v1/marketing`, `/v1/gift-cards` | generic |
| delivery | `/v1/delivery` | delivery |
| dashboard / reports | `/v1/dashboard`, `/v1/reports` | reports |
| users / roles | `/v1/users`, `/v1/roles` | staff |
| notifications / audit | `/v1/notifications`, `/v1/audit-logs` | generic |
| public / kiosk | `/v1/public*` | public |
| backups | `/v1/backups` | JSON export (no local disk) |
| webhooks / api-keys | `/v1/webhooks`, `*-api-keys` | firestore secrets hashed |
| operations | `/v1/operations` | metadata only; files not ImgBB |
| verifactu / mcp / sync / system / usb print | same prefixes | **not portable to serverless** — explicit 501 |

Frontend `apps/web/lib/api.ts` still calls `/api/v1`. Production **does not** rewrite to Nest.

## Prisma models → Firestore

See `docs/FIRESTORE_SCHEMA.md`. IDs remain string CUIDs/UUIDs. `branchId` + `restaurantId` on every tenant document.

## External services

| Service | Role | Cost |
|---|---|---|
| Firebase Auth | identity | Spark OK for email/password |
| Cloud Firestore | database | Spark free quota; Blaze if exceeded |
| Firebase Admin | server | free |
| ImgBB | public photos | free API key |
| Identity Toolkit REST | login | included with Auth |
| SMTP / Verifactu / USB ESC-POS / local Postgres backups / Socket.IO | **not on Vercel** | document 501 |

Cloud Functions **not** enabled.

## Scheduled jobs

Nest `ScheduleModule` (report schedules, backup cron, scheduled orders) cannot run inside a Vercel serverless route. Use Vercel Cron **only if** the operator adds `vercel.json` crons later (not enabled here). Until then, report schedules are stored but not auto-fired.

## Offline

LAN Postgres offline is **gone** in this architecture. Firestore needs network. Client cache is not a POS source of truth. Payments stay OPEN until Admin SDK writes PAID.

## Security risks

Admin SDK bypasses rules → every route must `requireSession` + restaurant/branch checks. No client writes to orders/payments. ImgBB is public.

## Phased plan

1. Next route handlers + Admin SDK (this change).
2. Stop Next rewrites to Nest.
3. Replace Socket.IO with polling/listeners.
4. ImgBB server route.
5. Keep `apps/backend` in git as reference until data migration is approved; **production Next does not start Nest**.
