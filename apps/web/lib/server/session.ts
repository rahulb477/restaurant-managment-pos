import { cookies } from "next/headers";
import type { SessionUser } from "@nodedr-restaurant/types";
import { adminAuth, db, firebaseConfigured } from "./firebase";
import { HttpError } from "./http";
import { assertSetupReady, getSetupDetails, loadAccount, type Account } from "./onboarding";

export const SESSION_COOKIE = "nodedr_session";
export const SESSION_MS = 12 * 60 * 60 * 1000;

function cookieSecure() {
  return process.env.COOKIE_SECURE === "true" || process.env.VERCEL === "1";
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 0,
  });
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function accountFromSessionToken(token: string): Promise<Account> {
  if (!firebaseConfigured()) {
    throw new HttpError(503, "Firebase Admin is not configured", "FIREBASE_UNCONFIGURED");
  }
  let uid: string;
  try {
    uid = (await adminAuth().verifySessionCookie(token, true)).uid;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if ([
      "auth/argument-error", "auth/invalid-session-cookie", "auth/session-cookie-expired",
      "auth/session-cookie-revoked", "auth/user-disabled", "auth/user-not-found",
    ].includes(code)) {
      throw new HttpError(401, "Session no longer valid");
    }
    throw new HttpError(503, "Could not verify the session with Firebase", "FIREBASE_UNAVAILABLE");
  }
  return loadAccount(db(), uid);
}

export async function requireAccount(): Promise<Account> {
  // A missing cookie is unauthenticated even on an unconfigured installation.
  const token = await readSessionToken();
  if (!token) throw new HttpError(401, "Unauthorized");
  return accountFromSessionToken(token);
}

export async function optionalAccount(): Promise<Account | null> {
  try {
    return await requireAccount();
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export async function requireReadyUser(): Promise<SessionUser> {
  const account = await requireAccount();
  const setup = await getSetupDetails(db(), account);
  assertSetupReady(setup);
  return account.user;
}

export function hasPermission(user: SessionUser, key: string) {
  const perms = user.permissions;
  if (perms.includes("*")) return true;
  if (perms.includes(key)) return true;
  const [ns, action] = key.split(".");
  if (action === "view" && perms.includes(`${ns}.manage`)) return true;
  return false;
}

export function requirePermission(user: SessionUser, key: string) {
  if (!hasPermission(user, key)) throw new HttpError(403, "Forbidden");
}
