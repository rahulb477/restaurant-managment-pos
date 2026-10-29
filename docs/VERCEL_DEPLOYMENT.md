# Vercel deployment

The production app is **only** `apps/web` (Next.js App Router). It serves the UI and `/api/v1/*` route handlers. It does **not** start NestJS, PostgreSQL, Prisma, Socket.IO, or write durable files to local disk.

Do not deploy until Firebase Admin, Firestore rules, and ImgBB are configured. This document does not claim a live deploy succeeded.

## Vercel project settings

| Setting | Value |
|---|---|
| Framework | Next.js |
| Node.js | **22.x** |
| Root Directory | **repository root** (pnpm workspace) |
| Install Command | `pnpm install` |
| Build Command | `pnpm --filter @nodedr-restaurant/types build && pnpm --filter web build` |
| Output | Next default (`apps/web/.next`) |
| Ignored build step | leave empty |

If Root Directory is set to `apps/web` instead, Vercel must still see the workspace (`pnpm-workspace.yaml` one level up). Prefer **root**.

Do **not** set `BACKEND_URL`. `next.config.ts` has **no** rewrite to Nest.

## Environment variables

### Server only (never `NEXT_PUBLIC_`)

| Name | Purpose |
|---|---|
| `FIREBASE_PROJECT_ID` | Admin SDK |
| `FIREBASE_CLIENT_EMAIL` | Service account email |
| `FIREBASE_PRIVATE_KEY` | PEM; store with literal `\n` escapes |
| `FIREBASE_WEB_API_KEY` | Identity Toolkit email/password login (same string as the web API key) |
| `IMGBB_API_KEY` | Server-side image upload |
| `COOKIE_SECURE` | Set `true` (also implied when `VERCEL=1`) |

### Public (project identity, not authorization)

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Optional client config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Project id |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Web app id |

Do **not** set `DATABASE_URL`, `JWT_SECRET`, or `NEXT_PUBLIC_IMGBB_API_KEY` on Vercel.

Missing Admin credentials: protected APIs return **HTTP 503** with `code: FIREBASE_UNCONFIGURED`. Missing ImgBB key: image uploads return **503**. The API does not invent mock restaurants or fake payments.

## Firebase console (manual)

1. Create a Firebase project (Spark is enough for Auth + Firestore at small scale).
2. Authentication → Email/Password enabled.
3. Authentication → Settings → Authorized domains: add `*.vercel.app` and any custom domain.
4. Firestore → production mode. Deploy `firestore.rules` from the repo root (`firebase deploy --only firestore:rules`).
5. Project settings → Service accounts → generate key → paste into Vercel env vars.
6. Do **not** enable Cloud Functions / Blaze unless you explicitly choose to.

## After deploy — smoke checklist (you run this)

With real credentials, in a browser on the Vercel URL:

1. Open `/login`. Unconfigured backend should fail login with a server error, not a silent success.
2. `/signup` → register owner (creates Firebase user + Firestore restaurant/branch).
3. `/auth` session: reload stays signed in (HttpOnly `nodedr_session`).
4. Logout clears the cookie.
5. Create a menu category and item; upload a photo (ImgBB URL, not `/api/uploads/...`).
6. Open POS, send an order: number increments; totals match GST-inclusive math; retry with the same `requestId` does not duplicate.
7. Checkout: client cannot mark PAID; only the server write does.
8. KDS list updates within a few seconds (polling, not Socket.IO).
9. Second restaurant account cannot read the first restaurant’s orders.

Until those steps pass on **your** project, do not treat the app as production-verified.

## What this runtime does not include

USB/network receipt printers, LAN peer sync, Nest cron/report schedules, Verifactu certificate files, MCP, Socket.IO, local `UPLOADS_DIR`.

## Offline

LAN PostgreSQL offline POS is **not** available on Vercel. The app needs network to Firebase.

## Fonts

Production CSS uses the system UI stack (`--font-geist-sans` / `--font-geist-mono`). The repo has **no** bundled Geist files; Google Fonts are **not** fetched at build time.
