import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionUser } from "@nodedr-restaurant/types";
import { HttpError } from "./http.ts";
import { assertRestaurant, belongsToBranch, tenantSafeChanges } from "./tenant.ts";

const user: SessionUser = {
  id: "user-1", restaurantId: "restaurant-1", name: "Owner", roleId: "owner", roleName: "OWNER", permissions: [],
};

test("only the authenticated restaurant can be used for records and branch access", () => {
  assert.doesNotThrow(() => assertRestaurant(user, "restaurant-1"));
  assert.throws(() => assertRestaurant(user, "restaurant-2"), (e: unknown) => e instanceof HttpError && e.status === 403);
  assert.throws(() => assertRestaurant({ ...user, restaurantId: "" }, ""), (e: unknown) => e instanceof HttpError && e.status === 403);
});

test("generic edits cannot transfer a record or replace its identity", () => {
  const input = { id: "other-id", restaurantId: "restaurant-2", branchId: "branch-2", name: "Updated" };
  assert.deepEqual(tenantSafeChanges(input), { name: "Updated" });
  assert.equal(input.restaurantId, "restaurant-2");
});

test("an order retry never returns a same-key order from another tenant or branch", () => {
  assert.equal(belongsToBranch(user, "branch-1", { restaurantId: "restaurant-1", branchId: "branch-1" }), true);
  assert.equal(belongsToBranch(user, "branch-1", { restaurantId: "restaurant-2", branchId: "branch-1" }), false);
  assert.equal(belongsToBranch(user, "branch-1", { restaurantId: "restaurant-1", branchId: "branch-2" }), false);
  assert.equal(belongsToBranch({ ...user, restaurantId: "" }, "branch-1", { restaurantId: "", branchId: "branch-1" }), false);
});
