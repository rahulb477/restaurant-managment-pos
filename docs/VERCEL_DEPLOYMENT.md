# Vercel deployment

The current production request path is `apps/web` (Next.js App Router). It serves the UI and `/api/v1/*` route handlers. Those handlers implement the app's Firebase-backed API; they do **not** proxy to NestJS. The web runtime does **not** start NestJS, PostgreSQL, Prisma, Socket.IO, or write durable files to local disk.

The repository-root `vercel.json` declares **only** the `web` service (`apps/web`, Next.js) and routes `/(.*)` to it. `apps/backend` remains in the repository for legacy and migration use, but is not a Vercel service. The web service runs `pnpm install --frozen-lockfile --filter web...` to install only web and its workspace dependencies, then `pnpm --filter @nodedr-restaurant/types build && pnpm --filter web build`; it does not run the repository's unfiltered `turbo run build`, which also selects the legacy NestJS backend.

Do not deploy until Firebase Admin, Firestore rules, and ImgBB are configured. This document does not claim a live deploy succeeded.

## Vercel project and dashboard settings

The project must use the repository root so Vercel reads the root `vercel.json`, `pnpm-workspace.yaml`, and lockfile. `services.web.root` selects `apps/web` and its Next.js framework. Keep build/install configuration **inside** `services.web`: Services mode does not support top-level build/install overrides in `vercel.json`. Leave the `/(.*)` rewrite pointed at `web` so Next.js serves the existing `/api/v1/*` handlers as well as the UI.

In the Vercel dashboard, open the **same project and environment** that produced the failed deployment. Check **Settings → Build and Deployment** (or **General → Build & Development Settings**, depending on the dashboard version), and **Settings → General**:

| Setting | Required value |
|---|---|
| **Root Directory** | Repository root (`.` / empty), not `apps/web` or `apps/backend`. |
| **Framework** | Use Services mode and leave framework selection to `services.web.framework: "nextjs"`; don't replace the service configuration with a root-level framework override. |
| **Build Command** | Turn the dashboard **Override off** so `services.web.buildCommand` is used. If an override is required, set exactly `pnpm --filter @nodedr-restaurant/types build && pnpm --filter web build`; do not use `turbo run build` or `pnpm build`. |
| **Install Command** | Turn **Override off** so `services.web.installCommand` is used; if an override is required, use `pnpm install --frozen-lockfile --filter web...`, not a build command. |
| **Output Directory** | Turn **Override off**; the web service's Next.js builder handles `.next`. |
| **Node.js Version** | **22.x**, consistent with the root `package.json` engine. |

Under **Settings → Environment Variables**, set `ENABLE_EXPERIMENTAL_COREPACK=1` for the Development environment so Vercel uses the root `packageManager` pin, `pnpm@11.10.0`. Apply it to any other non-production environment you intend to deploy, then redeploy that environment. Confirm the install log reports pnpm 11.10.0. Vercel can otherwise select a different pnpm version from the lockfile and project creation date; for example, pnpm 9 fails the frozen install because it does not match this workspace's lockfile overrides. Do not change the lockfile to work around that version mismatch.

Dashboard overrides and Git/environment selection cannot be verified from the repository alone. After pushing the fix to the branch used by this project, open the new **Development** deployment and check its **Source** branch and commit SHA. Inspect its build log: the selected service should be `web`, the build command should be the filtered command above, and `@nodedr-restaurant/backend#build` must not run. If the log still says `turbo run build`, recheck the project/environment overrides, Root Directory, and deployed commit before retrying. A branch deployment can be triggered by the Git integration; verify that this branch is not configured as the production branch before pushing if a production deployment is not intended.

Do **not** set `BACKEND_URL`. The web app's `next.config.ts` has no rewrite to Nest, and no application code currently calls a fixed internal backend URL.

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

Missing Admin credentials: login/signup and requests with a session return **HTTP 503** with `code: FIREBASE_UNCONFIGURED`; unauthenticated protected requests return **401**. Missing ImgBB key: image uploads return **503**. The API does not invent mock restaurants or fake payments.

## Firebase console (manual)

1. Create a Firebase project (Spark is enough for Auth + Firestore at small scale).
2. Authentication → Email/Password enabled.
3. Authentication → Settings → Authorized domains: add the actual Vercel hostname and any custom domain if your authentication links/redirects use them.
4. Firestore → production mode. Deploy `firestore.rules` from the repo root (`firebase deploy --only firestore:rules`).
5. Project settings → Service accounts → generate key → paste into Vercel env vars.
6. Do **not** enable Cloud Functions / Blaze unless you explicitly choose to.

## Onboarding and existing data

- `/` reads the verified `nodedr_session` and the signed-in user's Firestore account. Logged-out users go to `/login`; users who need setup go to `/setup`; completed users go to `/dashboard`. The public product page is `/about`.
- `/signup` creates a Firebase Auth user and an active `users/{firebaseUid}` document with `onboarding.canCreateRestaurant: true`, but no restaurant or owner permissions. After successful sign-in the server checks that account's actual setup state. If automatic sign-in fails after account creation, sign in at `/login` to resume.
- `/setup` requires the registered creator, or an existing restaurant member with owner/`settings.manage` access. Restaurant name, first branch name, currency, IANA timezone, country, tax regime and tax mode are required. Address, phone and tax ID remain optional, as in the existing Branch model; item tax rates are configured per menu item.
- The authenticated setup API validates the data and atomically writes the restaurant, branch, roles, user membership and `restaurants/{id}.setupComplete: true` with `setupCompletedAt`. Retries and concurrent submissions cannot create a second restaurant for the same pending account. Existing incomplete restaurants are updated rather than replaced.
- Existing restaurants without `setupComplete` remain complete if the restaurant and an active branch both have names. No migration or extra setup is needed for these existing registrations. A missing/deleted restaurant or an unauthorized staff member cannot create or configure one through setup.
- Firestore membership is tied to Firebase UID, **not email**. A `users/{uid}` document is accepted directly, or an older document with exactly one matching `firebaseUid` is accepted. Older email-only documents without a UID binding must be linked to the correct Firebase Auth UID by a trusted administrator after verifying ownership; do not authorize or migrate by email alone. Ambiguous UID mappings must be corrected. Client Firestore writes must remain denied by `firestore.rules`.

## After deploy — smoke checklist (you run this)

With real credentials, in a browser on the Vercel URL:

1. Open `/` signed out: it redirects to `/login`, not pricing. `/about` still shows the product page. Direct `/setup`, `/dashboard` and `/pos` requests redirect to `/login`.
2. `/signup` → create an owner account → `/setup`. Reload or sign out/in before completing setup; the account should return to `/setup`.
3. Complete setup and confirm the dashboard loads. Reload and sign out/in; the account should go directly to `/dashboard`. Repeated setup submissions should not create a second restaurant or branch.
4. Test a previously registered restaurant and an authorized staff account. An unauthorized staff account cannot complete another restaurant's setup; two restaurant accounts cannot read each other's orders or use each other's branch IDs.
5. Confirm logout clears the HttpOnly `nodedr_session` cookie. Inspect Firestore: the new restaurant has `setupComplete: true`, a first branch, owner roles and the user membership.
6. Create a menu category and item; upload a photo (ImgBB URL, not `/api/uploads/...`).
7. Open POS, send an order: number increments; totals match GST-inclusive math; retry with the same `requestId` does not duplicate. Checkout cannot be marked PAID by the client.
8. KDS list updates within a few seconds (polling, not Socket.IO).

Until those steps pass on **your** project, do not treat the app as production-verified. The local unit tests use a transaction test double, not live Firebase; they do not create or replace production data.

## What this runtime does not include

USB/network receipt printers, LAN peer sync, Nest cron/report schedules, Verifactu certificate files, MCP, Socket.IO, local `UPLOADS_DIR`.

## Offline

LAN PostgreSQL offline POS is **not** available on Vercel. The app needs network to Firebase.

## Fonts

Production CSS uses the system UI stack (`--font-geist-sans` / `--font-geist-mono`). The repo has **no** bundled Geist files; Google Fonts are **not** fetched at build time.
