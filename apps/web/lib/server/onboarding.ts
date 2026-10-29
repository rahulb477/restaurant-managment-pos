import { randomUUID } from "node:crypto";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  STAFF_ROLES,
  TAX_REGIME_PRESETS,
  TAX_REGIMES,
  type SessionUser,
  type TaxRegime,
} from "@nodedr-restaurant/types";
import {
  restaurantSetupSchema,
  type RestaurantSetupDto,
  type SetupAccess,
} from "../onboarding.ts";
import type { Firestore } from "./firebase.ts";
import { HttpError } from "./http.ts";

export type Account = {
  uid: string;
  docId: string;
  user: SessionUser;
  data: Record<string, unknown>;
};

type SetupDetails = SetupAccess & { initialValues?: RestaurantSetupDto };

type Row = { id: string; data: Record<string, unknown> };

// A Firebase UID, not an email address supplied at login, binds an account to
// its membership. Legacy documents may use a non-UID document ID, but then
// their firebaseUid field must match exactly and unambiguously.
export function accountFromDocument(uid: string, docId: string, data: Record<string, unknown>): Account {
  if (
    (docId !== uid && data.firebaseUid !== uid) ||
    (data.firebaseUid != null && data.firebaseUid !== uid)
  ) {
    throw new HttpError(403, "Account membership does not match this sign-in", "MEMBERSHIP_INVALID");
  }
  if (data.isActive === false) throw new HttpError(401, "Session no longer valid");
  return {
    uid,
    docId,
    data,
    user: {
      id: docId,
      restaurantId: typeof data.restaurantId === "string" ? data.restaurantId : "",
      name: typeof data.name === "string" ? data.name : "",
      roleId: typeof data.roleId === "string" ? data.roleId : "",
      roleName: typeof data.roleName === "string" ? data.roleName : "",
      permissions: Array.isArray(data.permissions)
        ? data.permissions.filter((p): p is string => typeof p === "string")
        : [],
    },
  };
}

export async function loadAccount(store: Firestore, uid: string): Promise<Account> {
  const direct = await store.collection("users").doc(uid).get();
  if (direct.exists) return accountFromDocument(uid, direct.id, direct.data() ?? {});

  const matches = await store.collection("users").where("firebaseUid", "==", uid).limit(2).get();
  if (matches.docs.length !== 1) {
    throw new HttpError(403, "No unambiguous restaurant account is assigned to this sign-in", "MEMBERSHIP_INVALID");
  }
  return accountFromDocument(uid, matches.docs[0].id, matches.docs[0].data());
}

function canCreate(account: Account): boolean {
  const onboarding = account.data.onboarding;
  return Boolean(
    onboarding && typeof onboarding === "object" &&
      (onboarding as { canCreateRestaurant?: unknown }).canCreateRestaurant === true,
  );
}

function canConfigure(account: Account): boolean {
  const permissions = account.user.permissions;
  return account.user.roleName === "OWNER" || permissions.includes("*") || permissions.includes("settings.manage");
}

function activeBranch(rows: Row[]): Row | undefined {
  return rows.find((row) => row.data.isActive !== false && typeof row.data.name === "string" && row.data.name.trim())
    ?? rows.find((row) => row.data.isActive !== false);
}

// Pre-existing Firebase registrations predate setupComplete. A named
// restaurant with an active, named branch was already provisioned by the old
// registration flow, and must remain usable without rerunning setup.
export function classifySetup(account: Account, restaurant: Record<string, unknown> | null, branch?: Row): SetupAccess {
  if (!account.user.restaurantId) {
    return canCreate(account)
      ? { status: "needs_setup", canSetup: true }
      : { status: "forbidden", canSetup: false };
  }
  if (!restaurant) return { status: "forbidden", canSetup: false };

  const legacyReady = restaurant.setupComplete == null &&
    typeof restaurant.name === "string" && restaurant.name.trim().length > 0 &&
    typeof branch?.data.name === "string" && branch.data.name.trim().length > 0;
  const ready = restaurant.setupComplete === true || legacyReady;
  return { status: ready ? "ready" : "needs_setup", canSetup: canConfigure(account) };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function initialValues(restaurant?: Record<string, unknown>, branch?: Row): RestaurantSetupDto {
  const details = branch?.data ?? {};
  const candidate = stringOr(details.taxRegime, "INDIA_GST");
  const regime: TaxRegime = TAX_REGIMES.find((value) => value === candidate) ?? "INDIA_GST";
  const taxMode = details.taxMode === "EXCLUSIVE" || details.taxMode === "INCLUSIVE"
    ? details.taxMode : TAX_REGIME_PRESETS[regime].defaultMode;
  return {
    restaurantName: stringOr(restaurant?.name, ""),
    branchName: stringOr(details.name, "Main Branch"),
    address: stringOr(details.address, ""),
    phone: stringOr(details.phone, ""),
    currency: stringOr(restaurant?.currency, "INR"),
    timezone: stringOr(restaurant?.timezone, "Asia/Kolkata"),
    country: stringOr(details.country, TAX_REGIME_PRESETS[regime].defaultCountry),
    taxRegime: regime,
    taxMode,
    taxId: stringOr(details.taxId, ""),
  };
}

export async function getSetupDetails(store: Firestore, account: Account): Promise<SetupDetails> {
  const restaurantId = account.user.restaurantId;
  if (!restaurantId) {
    const access = classifySetup(account, null);
    return access.canSetup ? { ...access, initialValues: initialValues() } : access;
  }
  const restaurantSnap = await store.collection("restaurants").doc(restaurantId).get();
  if (!restaurantSnap.exists) return classifySetup(account, null);
  const restaurant = restaurantSnap.data() ?? {};
  // Explicitly completed setups need no branch lookup. The flag is written
  // atomically with the branch and is never accepted from a client.
  if (restaurant.setupComplete === true) return classifySetup(account, restaurant);

  const branches = await store.collection("branches").where("restaurantId", "==", restaurantId).get();
  const branch = activeBranch(branches.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
  const access = classifySetup(account, restaurant, branch);
  return access.status === "needs_setup" && access.canSetup
    ? { ...access, initialValues: initialValues(restaurant, branch) }
    : access;
}

export function publicSetupAccess(details: SetupAccess): SetupAccess {
  return { status: details.status, canSetup: details.canSetup };
}

/** Shared by every authenticated POS API request, independently of UI guards. */
export function assertSetupReady(details: SetupAccess): void {
  if (details.status === "forbidden") {
    throw new HttpError(403, "This account is not authorized for a restaurant", "MEMBERSHIP_INVALID");
  }
  if (details.status !== "ready") {
    throw new HttpError(403, "Restaurant setup must be completed first", "SETUP_REQUIRED");
  }
}

/**
 * All tenant IDs come from the freshly re-read membership, never the body.
 * Reading and updating that membership in the same transaction serializes
 * retries and concurrent submissions for a new account.
 */
export async function completeRestaurantSetup(store: Firestore, account: Account, input: unknown) {
  const dto = restaurantSetupSchema.parse(input);
  const newRestaurantId = randomUUID();
  const newBranchId = randomUUID();
  const roleIds = new Map(STAFF_ROLES.map((role) => [role, randomUUID()]));
  const userRef = store.collection("users").doc(account.docId);

  return store.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpError(403, "Account is no longer authorized");
    const fresh = accountFromDocument(account.uid, userSnap.id, userSnap.data() ?? {});
    const existingRestaurantId = fresh.user.restaurantId;
    const restaurantId = existingRestaurantId || newRestaurantId;
    const restaurantRef = store.collection("restaurants").doc(restaurantId);
    let restaurant: Record<string, unknown> | null = null;
    let branch: Row | undefined;

    if (existingRestaurantId) {
      const restaurantSnap = await tx.get(restaurantRef);
      restaurant = restaurantSnap.exists ? (restaurantSnap.data() ?? {}) : null;
      const branches = await tx.get(store.collection("branches").where("restaurantId", "==", restaurantId));
      branch = activeBranch(branches.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
    }

    const access = classifySetup(fresh, restaurant, branch);
    if (!access.canSetup || access.status === "forbidden") {
      throw new HttpError(403, "You are not authorized to set up this restaurant", "SETUP_FORBIDDEN");
    }
    if (access.status === "ready") return { alreadyComplete: true };

    const now = new Date().toISOString();
    const branchId = branch?.id ?? newBranchId;
    tx.set(restaurantRef, {
      name: dto.restaurantName,
      currency: dto.currency,
      timezone: dto.timezone,
      setupComplete: true,
      setupCompletedAt: now,
      updatedAt: now,
      ...(!existingRestaurantId ? { ownerUid: fresh.uid, createdAt: now } : {}),
    }, { merge: true });
    tx.set(store.collection("branches").doc(branchId), {
      restaurantId,
      name: dto.branchName,
      address: dto.address || null,
      phone: dto.phone || null,
      country: dto.country,
      taxRegime: dto.taxRegime,
      taxMode: dto.taxMode,
      taxId: dto.taxId || null,
      isActive: true,
      updatedAt: now,
      ...(!branch ? { createdAt: now } : {}),
    }, { merge: true });

    if (!existingRestaurantId) {
      for (const roleName of STAFF_ROLES) {
        tx.set(store.collection("roles").doc(roleIds.get(roleName)!), {
          restaurantId,
          name: roleName,
          label: roleName.replace(/_/g, " "),
          permissions: DEFAULT_ROLE_PERMISSIONS[roleName],
        });
      }
      tx.set(userRef, {
        restaurantId,
        roleId: roleIds.get("OWNER"),
        roleName: "OWNER",
        permissions: PERMISSIONS.map((permission) => permission.key),
        onboarding: { canCreateRestaurant: false },
        updatedAt: now,
      }, { merge: true });
    }
    return { alreadyComplete: false };
  });
}
