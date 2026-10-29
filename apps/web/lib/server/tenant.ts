import type { SessionUser } from "@nodedr-restaurant/types";
import { HttpError } from "./http.ts";

export function assertRestaurant(user: SessionUser, restaurantId: string) {
  if (!user.restaurantId || !restaurantId || user.restaurantId !== restaurantId) {
    throw new HttpError(403, "Cross-tenant access denied");
  }
}

// Generic edit endpoints may update business fields, never the document's
// identity or ownership. This also prevents moving records into another tenant.
export function tenantSafeChanges(data: Record<string, unknown>): Record<string, unknown> {
  const changes = { ...data };
  delete changes.id;
  delete changes.restaurantId;
  delete changes.branchId;
  return changes;
}

export function belongsToBranch(user: SessionUser, branchId: string, data: Record<string, unknown>): boolean {
  return Boolean(user.restaurantId && branchId && data.restaurantId === user.restaurantId && data.branchId === branchId);
}
