import { randomUUID } from "node:crypto";
import { db } from "./firebase";
import { HttpError } from "./http";
import type { SessionUser } from "@nodedr-restaurant/types";
import { assertRestaurant } from "./session";

export type DocRow = Record<string, unknown> & { id: string };

export async function listByBranch(
  collection: string,
  restaurantId: string,
  branchId: string,
): Promise<DocRow[]> {
  const snap = await db().collection(collection).where("branchId", "==", branchId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((row) => (row as { restaurantId?: string }).restaurantId === restaurantId);
}

export async function getOwned(
  collection: string,
  id: string,
  user: SessionUser,
): Promise<DocRow> {
  const snap = await db().collection(collection).doc(id).get();
  if (!snap.exists) throw new HttpError(404, "Not found");
  const data = snap.data() ?? {};
  assertRestaurant(user, String(data.restaurantId ?? ""));
  return { id: snap.id, ...data };
}

export async function createOwned(
  collection: string,
  user: SessionUser,
  branchId: string | null,
  data: Record<string, unknown>,
  id?: string,
) {
  const docId = id ?? randomUUID();
  const payload = {
    ...data,
    restaurantId: user.restaurantId,
    ...(branchId ? { branchId } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db().collection(collection).doc(docId).set(payload);
  return { id: docId, ...payload };
}

export async function patchOwned(
  collection: string,
  id: string,
  user: SessionUser,
  data: Record<string, unknown>,
) {
  const current = await getOwned(collection, id, user);
  const next = { ...current, ...data, updatedAt: new Date().toISOString() };
  await db().collection(collection).doc(id).set(next, { merge: true });
  return next;
}

export async function deleteOwned(collection: string, id: string, user: SessionUser) {
  await getOwned(collection, id, user);
  await db().collection(collection).doc(id).delete();
  return { ok: true };
}

export async function assertBranch(user: SessionUser, branchId: string) {
  const snap = await db().collection("branches").doc(branchId).get();
  if (!snap.exists) throw new HttpError(404, "Branch not found");
  const data = snap.data() ?? {};
  assertRestaurant(user, String(data.restaurantId ?? ""));
  return { id: snap.id, ...data };
}
