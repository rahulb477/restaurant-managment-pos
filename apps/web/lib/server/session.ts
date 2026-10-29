import { cookies } from "next/headers";
import type { SessionUser } from "@nodedr-restaurant/types";
import { adminAuth, db, firebaseConfigured } from "./firebase";
import { HttpError } from "./http";

export const SESSION_COOKIE = "nodedr_session";
const SESSION_MS = 12 * 60 * 60 * 1000;

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

export async function requireUser(): Promise<SessionUser> {
  if (!firebaseConfigured()) {
    throw new HttpError(503, "Firebase Admin is not configured", "FIREBASE_UNCONFIGURED");
  }
  const token = await readSessionToken();
  if (!token) throw new HttpError(401, "Unauthorized");
  let email: string | undefined;
  let uid: string;
  try {
    const decoded = await adminAuth().verifySessionCookie(token, true);
    email = decoded.email;
    uid = decoded.uid;
  } catch {
    throw new HttpError(401, "Session no longer valid");
  }
  const users = await db().collection("users").where("email", "==", email ?? "").limit(5).get();
  const doc = users.docs.find((d) => d.data().isActive !== false) ?? users.docs[0];
  if (!doc) {
    const byUid = await db().collection("users").doc(uid).get();
    if (!byUid.exists) throw new HttpError(401, "Session no longer valid");
    return toSession(byUid.id, byUid.data() ?? {});
  }
  return toSession(doc.id, doc.data());
}

function toSession(id: string, data: Record<string, unknown>): SessionUser {
  if (data.isActive === false) throw new HttpError(401, "Session no longer valid");
  return {
    id,
    restaurantId: String(data.restaurantId ?? ""),
    name: String(data.name ?? ""),
    roleId: String(data.roleId ?? ""),
    roleName: String(data.roleName ?? ""),
    permissions: Array.isArray(data.permissions) ? (data.permissions as string[]) : [],
  };
}

export function assertRestaurant(user: SessionUser, restaurantId: string) {
  if (user.restaurantId !== restaurantId) {
    throw new HttpError(403, "Cross-tenant access denied");
  }
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
