import assert from "node:assert/strict";
import { test } from "node:test";
import { branchSettingsSchema, restaurantSettingsSchema, STAFF_ROLES } from "@nodedr-restaurant/types";
import { destinationFor, restaurantSetupSchema } from "../onboarding.ts";
import type { Firestore } from "./firebase.ts";
import { HttpError } from "./http.ts";
import { assertSetupReady, completeRestaurantSetup, getSetupDetails, loadAccount } from "./onboarding.ts";

type Data = Record<string, unknown>;
type Ref = { kind: "doc"; key: string; id: string };
type Query = { kind: "query"; collection: string; filters: [string, unknown][]; max?: number };

// A transaction-capable test double. Production always uses Firebase Admin;
// the fake simulates optimistic retries and commits all queued writes at once.
function memoryFirestore() {
  const rows = new Map<string, Data>();
  const versions = new Map<string, number>();
  let failCommit = false;
  const version = (key: string) => versions.get(key) ?? 0;
  const bump = (key: string) => versions.set(key, version(key) + 1);
  const clone = (data: Data) => structuredClone(data);
  const collectionOf = (key: string) => key.split("/")[0];
  const write = (key: string, data: Data, merge = false) => {
    rows.set(key, merge ? { ...rows.get(key), ...clone(data) } : clone(data));
    bump(key);
    bump(`query:${collectionOf(key)}`);
  };
  const snapshot = (ref: Ref) => {
    const value = rows.get(ref.key);
    return { id: ref.id, exists: value !== undefined, data: () => value === undefined ? undefined : clone(value) };
  };
  const querySnapshot = (query: Query) => {
    const prefix = `${query.collection}/`;
    const docs = [...rows.entries()]
      .filter(([key, value]) => key.startsWith(prefix) && query.filters.every(([field, expected]) => value[field] === expected))
      .slice(0, query.max)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => clone(value) }));
    return { docs };
  };
  const query = (collection: string, filters: [string, unknown][] = [], max?: number) => {
    const value: Query = { kind: "query", collection, filters, max };
    return {
      ...value,
      where: (field: string, _op: string, expected: unknown) => query(collection, [...filters, [field, expected]], max),
      limit: (n: number) => query(collection, filters, n),
      orderBy: () => query(collection, filters, max),
      get: async () => querySnapshot(value),
    };
  };
  const doc = (collection: string, id: string) => {
    const ref: Ref = { kind: "doc", key: `${collection}/${id}`, id };
    return {
      ...ref,
      get: async () => snapshot(ref),
      set: async (data: Data, options?: { merge?: boolean }) => write(ref.key, data, options?.merge),
      delete: async () => { rows.delete(ref.key); bump(ref.key); bump(`query:${collection}`); },
    };
  };
  const store = {
    collection: (name: string) => ({
      doc: (id: string) => doc(name, id),
      where: (field: string, _op: string, expected: unknown) => query(name, [[field, expected]]),
      limit: (n: number) => query(name, [], n),
    }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const reads = new Map<string, number>();
        const writes: { ref: Ref; data: Data; merge: boolean }[] = [];
        const tx = {
          get: async (ref: Ref | Query) => {
            const key = ref.kind === "doc" ? ref.key : `query:${ref.collection}`;
            reads.set(key, version(key));
            return ref.kind === "doc" ? snapshot(ref) : querySnapshot(ref);
          },
          set: (ref: Ref, data: Data, options?: { merge?: boolean }) => {
            writes.push({ ref, data, merge: options?.merge ?? false });
          },
          update: (ref: Ref, data: Data) => writes.push({ ref, data, merge: true }),
        };
        const result = await fn(tx);
        // Let other simultaneous transactions reach their commit point.
        await Promise.resolve();
        if ([...reads].some(([key, old]) => version(key) !== old)) continue;
        if (failCommit) { failCommit = false; throw new Error("simulated transaction failure"); }
        for (const entry of writes) write(entry.ref.key, entry.data, entry.merge);
        return result;
      }
      throw new Error("too many transaction retries");
    },
  } as unknown as Firestore;
  return {
    store,
    seed: (path: string, data: Data) => write(path, data),
    get: (path: string) => rows.get(path),
    all: (collection: string) => [...rows.entries()].filter(([key]) => key.startsWith(`${collection}/`)),
    failNextCommit: () => { failCommit = true; },
  };
}

const valid = {
  restaurantName: "Spice Route",
  branchName: "Main Branch",
  address: "1 Market Road",
  phone: "+91 1234567890",
  currency: "INR",
  timezone: "Asia/Kolkata",
  country: "IN",
  taxRegime: "INDIA_GST" as const,
  taxMode: "INCLUSIVE" as const,
  taxId: "GST-123",
};
const pending = { firebaseUid: "new-user", name: "Priya", isActive: true, onboarding: { canCreateRestaurant: true } };

test("root destinations distinguish logged-out, first-time, completed and forbidden accounts", () => {
  assert.equal(destinationFor(null), "/login");
  assert.equal(destinationFor({ status: "needs_setup", canSetup: true }), "/setup");
  assert.equal(destinationFor({ status: "ready", canSetup: true }), "/dashboard");
  assert.equal(destinationFor({ status: "forbidden", canSetup: false }), "/setup");
  assert.doesNotThrow(() => assertSetupReady({ status: "ready", canSetup: false }));
  assert.throws(() => assertSetupReady({ status: "needs_setup", canSetup: true }),
    (e: unknown) => e instanceof HttpError && e.status === 403 && e.code === "SETUP_REQUIRED");
  assert.throws(() => assertSetupReady({ status: "forbidden", canSetup: false }),
    (e: unknown) => e instanceof HttpError && e.status === 403 && e.code === "MEMBERSHIP_INVALID");
});

test("membership is bound to Firebase UID, never a matching email", async () => {
  const mem = memoryFirestore();
  mem.seed("users/old-id", { firebaseUid: "uid-1", email: "same@example.com", isActive: true });
  assert.equal((await loadAccount(mem.store, "uid-1")).docId, "old-id");
  await assert.rejects(loadAccount(mem.store, "uid-2"), (e: unknown) => e instanceof HttpError && e.status === 403);
  mem.seed("users/uid-2", { firebaseUid: "uid-1", email: "same@example.com" });
  await assert.rejects(loadAccount(mem.store, "uid-2"), (e: unknown) => e instanceof HttpError && e.status === 403);
  mem.seed("users/duplicate", { firebaseUid: "uid-1" });
  await assert.rejects(loadAccount(mem.store, "uid-1"), (e: unknown) => e instanceof HttpError && e.status === 403);
  mem.seed("users/disabled", { firebaseUid: "disabled", isActive: false });
  await assert.rejects(loadAccount(mem.store, "disabled"), (e: unknown) => e instanceof HttpError && e.status === 401);
});

test("another restaurant never makes a first-time account complete", async () => {
  const mem = memoryFirestore();
  mem.seed("users/new-user", pending);
  mem.seed("restaurants/other", { name: "Other", setupComplete: true });
  const account = await loadAccount(mem.store, "new-user");
  const state = await getSetupDetails(mem.store, account);
  assert.equal(state.status, "needs_setup");
  assert.equal(state.canSetup, true);
  assert.equal(destinationFor(state), "/setup");
});

test("setup transaction persists real model fields, roles and membership and is idempotent", async () => {
  const mem = memoryFirestore();
  mem.seed("users/new-user", pending);
  const account = await loadAccount(mem.store, "new-user");
  assert.deepEqual(await completeRestaurantSetup(mem.store, account, valid), { alreadyComplete: false });
  const user = mem.get("users/new-user")!;
  const restaurantId = String(user.restaurantId);
  const restaurant = mem.get(`restaurants/${restaurantId}`)!;
  const branch = mem.all("branches")[0][1];
  assert.equal(restaurant.name, valid.restaurantName);
  assert.equal(restaurant.currency, valid.currency);
  assert.equal(restaurant.timezone, valid.timezone);
  assert.equal(restaurant.ownerUid, "new-user");
  assert.equal(restaurant.setupComplete, true);
  assert.ok(restaurant.setupCompletedAt);
  assert.equal(branch.restaurantId, restaurantId);
  assert.equal(branch.name, valid.branchName);
  assert.equal(branch.address, valid.address);
  assert.equal(branch.phone, valid.phone);
  assert.equal(branch.taxRegime, valid.taxRegime);
  assert.equal(branch.taxMode, valid.taxMode);
  assert.equal(branch.taxId, valid.taxId);
  assert.equal(user.roleName, "OWNER");
  assert.equal((user.onboarding as Data).canCreateRestaurant, false);
  assert.equal(mem.all("roles").length, STAFF_ROLES.length);
  const refreshed = await loadAccount(mem.store, "new-user");
  assert.equal((await getSetupDetails(mem.store, refreshed)).status, "ready");
  assert.deepEqual(await completeRestaurantSetup(mem.store, account, { ...valid, restaurantName: "Must not overwrite" }), { alreadyComplete: true });
  assert.equal(mem.all("restaurants").length, 1);
  assert.equal(mem.all("branches").length, 1);
  assert.equal(mem.get(`restaurants/${restaurantId}`)?.name, valid.restaurantName);
});

test("concurrent setup requests serialize on the account and cannot create duplicate tenants", async () => {
  const mem = memoryFirestore();
  mem.seed("users/new-user", pending);
  const account = await loadAccount(mem.store, "new-user");
  const results = await Promise.all([
    completeRestaurantSetup(mem.store, account, valid),
    completeRestaurantSetup(mem.store, account, valid),
    completeRestaurantSetup(mem.store, account, valid),
  ]);
  assert.equal(results.filter((result) => !result.alreadyComplete).length, 1);
  assert.equal(results.filter((result) => result.alreadyComplete).length, 2);
  assert.equal(mem.all("restaurants").length, 1);
  assert.equal(mem.all("branches").length, 1);
  assert.equal(mem.all("roles").length, STAFF_ROLES.length);
});

test("failed transaction does not mark setup complete and can be retried", async () => {
  const mem = memoryFirestore();
  mem.seed("users/new-user", pending);
  const account = await loadAccount(mem.store, "new-user");
  mem.failNextCommit();
  await assert.rejects(completeRestaurantSetup(mem.store, account, valid), /simulated transaction failure/);
  assert.equal(mem.all("restaurants").length, 0);
  assert.equal(mem.all("branches").length, 0);
  assert.equal(mem.get("users/new-user")?.restaurantId, undefined);
  assert.equal((await getSetupDetails(mem.store, account)).status, "needs_setup");
  await completeRestaurantSetup(mem.store, account, valid);
  assert.equal(mem.all("restaurants").length, 1);
});

test("legacy completed restaurants stay ready; explicit incomplete owners can configure an existing branch", async () => {
  const mem = memoryFirestore();
  mem.seed("users/owner", { firebaseUid: "owner", restaurantId: "legacy", roleName: "OWNER", isActive: true });
  mem.seed("restaurants/legacy", { name: "Old Restaurant", currency: "INR", timezone: "Asia/Kolkata" });
  mem.seed("branches/main", { restaurantId: "legacy", name: "Main", isActive: true });
  const owner = await loadAccount(mem.store, "owner");
  assert.equal((await getSetupDetails(mem.store, owner)).status, "ready");
  assert.equal(destinationFor(await getSetupDetails(mem.store, owner)), "/dashboard");
  mem.seed("restaurants/legacy", { name: "Old Restaurant", setupComplete: false });
  assert.equal((await getSetupDetails(mem.store, owner)).status, "needs_setup");
  await completeRestaurantSetup(mem.store, owner, valid);
  assert.equal(mem.all("restaurants").length, 1);
  assert.equal(mem.all("branches").length, 1);
  assert.equal(mem.get("branches/main")?.address, valid.address);
  assert.equal(mem.get("restaurants/legacy")?.setupComplete, true);
});

test("unauthorized staff, missing memberships and revoked users cannot submit setup", async () => {
  const mem = memoryFirestore();
  mem.seed("restaurants/r1", { name: "Incomplete", setupComplete: false });
  mem.seed("users/staff", { firebaseUid: "staff", restaurantId: "r1", roleName: "WAITER", permissions: [], isActive: true, onboarding: { canCreateRestaurant: true } });
  const staff = await loadAccount(mem.store, "staff");
  const state = await getSetupDetails(mem.store, staff);
  assert.equal(state.status, "needs_setup");
  assert.equal(state.canSetup, false);
  assert.equal(state.initialValues, undefined);
  await assert.rejects(completeRestaurantSetup(mem.store, staff, valid), (e: unknown) => e instanceof HttpError && e.status === 403);
  mem.seed("users/no-membership", { firebaseUid: "no-membership", isActive: true });
  const orphan = await loadAccount(mem.store, "no-membership");
  assert.equal((await getSetupDetails(mem.store, orphan)).status, "forbidden");
  await assert.rejects(completeRestaurantSetup(mem.store, orphan, valid), (e: unknown) => e instanceof HttpError && e.status === 403);
  mem.seed("users/new-user", pending);
  const revoked = await loadAccount(mem.store, "new-user");
  mem.seed("users/new-user", { ...pending, isActive: false });
  await assert.rejects(completeRestaurantSetup(mem.store, revoked, valid), (e: unknown) => e instanceof HttpError && e.status === 401);
  assert.equal(mem.all("restaurants").length, 1);
});

test("server rejects forged tenant/completion fields and malformed settings", () => {
  assert.equal(restaurantSetupSchema.safeParse({ ...valid, restaurantId: "victim", setupComplete: true }).success, false);
  assert.equal(restaurantSetupSchema.safeParse({ ...valid, restaurantName: "   " }).success, false);
  assert.equal(restaurantSetupSchema.safeParse({ ...valid, timezone: "Not/AZone" }).success, false);
  assert.equal(restaurantSetupSchema.safeParse({ ...valid, phone: "not a phone" }).success, false);
  assert.equal(restaurantSetupSchema.safeParse({ ...valid, currency: "FAKE" }).success, false);
  assert.equal(restaurantSetupSchema.safeParse({ ...valid, taxMode: "FORGED" }).success, false);
  assert.equal(restaurantSetupSchema.safeParse({ ...valid, address: "", phone: "", taxId: "" }).success, true);
  assert.deepEqual(restaurantSettingsSchema.parse({ name: "Safe", setupComplete: true, ownerUid: "attacker" }), { name: "Safe" });
  assert.deepEqual(branchSettingsSchema.parse({ name: "Safe", restaurantId: "victim" }), { name: "Safe" });
});

test("a pending creator cannot select or mark another tenant complete with forged fields", async () => {
  const mem = memoryFirestore();
  mem.seed("users/new-user", pending);
  mem.seed("restaurants/victim", { name: "Victim", setupComplete: false });
  mem.seed("branches/victim-branch", { restaurantId: "victim", name: "Victim branch" });
  const creator = await loadAccount(mem.store, "new-user");
  await assert.rejects(completeRestaurantSetup(mem.store, creator, {
    ...valid, restaurantId: "victim", branchId: "victim-branch", setupComplete: true,
  }));
  assert.equal(mem.get("restaurants/victim")?.setupComplete, false);
  assert.equal(mem.get("branches/victim-branch")?.name, "Victim branch");
  assert.equal(mem.get("users/new-user")?.restaurantId, undefined);
});

test("an authorized settings manager can complete only their existing incomplete restaurant", async () => {
  const mem = memoryFirestore();
  mem.seed("users/manager", { firebaseUid: "manager", restaurantId: "r1", roleName: "ADMINISTRATOR", permissions: ["settings.manage"], isActive: true });
  mem.seed("restaurants/r1", { name: "Old name", setupComplete: false });
  mem.seed("branches/r1-main", { restaurantId: "r1", name: "Old branch", isActive: true });
  mem.seed("restaurants/r2", { name: "Other restaurant", setupComplete: false });
  const manager = await loadAccount(mem.store, "manager");
  assert.equal((await getSetupDetails(mem.store, manager)).canSetup, true);
  await completeRestaurantSetup(mem.store, manager, valid);
  assert.equal(mem.get("restaurants/r1")?.setupComplete, true);
  assert.equal(mem.get("branches/r1-main")?.name, valid.branchName);
  assert.equal(mem.get("restaurants/r2")?.setupComplete, false);
  assert.equal(mem.all("restaurants").length, 2);
});
