# Firebase setup

Do not invent project IDs or API keys. Create them in the Firebase console.

## 1. Create a project

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Add a project (Spark/free is enough for Auth + Firestore in this architecture).
3. Do **not** enable Cloud Functions or Blaze unless you explicitly choose to.

## 2. Authentication

1. Build → Authentication → Get started.
2. Enable **Email/Password**.
3. Do not enable anonymous auth for staff POS.

## 3. Firestore

1. Build → Firestore Database → Create database.
2. Start in **production** mode (not open test rules).
3. Deploy rules from `firestore.rules` (see `docs/FIRESTORE_SECURITY.md`).
4. Indexes: composite `restaurantId + branchId + createdAt` on `orders`, `kitchenTickets`, `menuItems`.

## 4. Service account (Admin SDK, server only)

1. Project settings → Service accounts → Generate new private key.
2. Set on the **Nest** process only:

```
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Never put the private key in `NEXT_PUBLIC_*`, Git, or browser bundles.

## 5. Web app config (public, not a secret)

Project settings → Your apps → Web:

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

These identify the project; **authorization is Auth + rules + Nest**.

## 6. Application flags

```
AUTH_PROVIDER=jwt          # default: existing JWT cookie
# AUTH_PROVIDER=firebase   # verify Firebase session cookie / ID token

DATA_STORE=postgres        # default
# DATA_STORE=firestore     # read/write tenant data via Admin SDK
```

On Vercel, set Auth to Email/Password and paste Admin credentials into the Next.js project. NestJS is not required for production. The API returns 503 until Admin env vars exist.

## 7. Session cookies

When `AUTH_PROVIDER=firebase`, Nest calls `createSessionCookie` and still sets httpOnly `nodedr_session`. Protected SSR/API routes verify that cookie with Admin SDK, then load roles from Firestore/Postgres — never from the client.

## 8. Manual steps you must complete

- Create the Firebase project.
- Enable Email/Password.
- Create Firestore.
- Deploy `firestore.rules`.
- Paste service account env vars on the server.
- Paste public web config in `.env` for the Next app if client Auth is used.
