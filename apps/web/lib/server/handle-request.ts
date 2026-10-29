import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  STAFF_ROLES,
  loginSchema,
  registerSchema,
  type SessionUser,
} from "@nodedr-restaurant/types";
import { randomUUID } from "node:crypto";
import { computeBill, priceLine, round2, settlePayments } from "./billing";
import { adminAuth, db, firebaseConfigured } from "./firebase";
import { HttpError, requireBranchId } from "./http";
import { uploadToImgbb } from "./imgbb";
import {
  clearSessionCookie,
  requirePermission,
  requireUser,
  setSessionCookie,
} from "./session";
import {
  assertBranch,
  createOwned,
  deleteOwned,
  getOwned,
  listByBranch,
  patchOwned,
} from "./store";

const SESSION_MS = 12 * 60 * 60 * 1000;

async function signInPassword(email: string, password: string): Promise<string> {
  const apiKey =
    process.env.FIREBASE_WEB_API_KEY ?? process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new HttpError(503, "FIREBASE_WEB_API_KEY / NEXT_PUBLIC_FIREBASE_API_KEY missing");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const json = (await res.json()) as { idToken?: string; error?: { message?: string } };
  if (!res.ok || !json.idToken) {
    throw new HttpError(401, "Invalid email or password");
  }
  return json.idToken;
}

function needFirebase() {
  if (!firebaseConfigured()) {
    throw new HttpError(503, "Firebase Admin is not configured", "FIREBASE_UNCONFIGURED");
  }
}

type Ctx = { method: string; parts: string[]; url: URL; body: unknown; form?: FormData };

export async function handleApi(ctx: Ctx): Promise<unknown> {
  const { method, parts, url, body } = ctx;
  const p = parts.join("/");

  if (p === "auth/setup-status" && method === "GET") {
    if (!firebaseConfigured()) return { isSetup: false };
    const restaurants = await db().collection("restaurants").limit(1).get();
    return { isSetup: restaurants.docs.length > 0 };
  }

  if (p === "auth/register" && method === "POST") {
    needFirebase();
    const dto = registerSchema.parse(body);
    const existing = await db().collection("users").where("email", "==", dto.email).limit(1).get();
    if (existing.docs.length) throw new HttpError(400, "An account with this email already exists");
    const rec = await adminAuth().createUser({
      email: dto.email,
      password: dto.password,
      displayName: dto.ownerName,
    });
    const restaurantId = randomUUID();
    const branchId = randomUUID();
    const roleId = randomUUID();
    const userId = rec.uid;
    const permissions = PERMISSIONS.map((x) => x.key);
    await db().collection("restaurants").doc(restaurantId).set({
      name: dto.restaurantName,
      currency: "INR",
      timezone: "Asia/Kolkata",
      createdAt: new Date().toISOString(),
    });
    await db().collection("branches").doc(branchId).set({
      restaurantId,
      name: dto.branchName,
      taxRegime: "INDIA_GST",
      taxMode: "INCLUSIVE",
      country: "IN",
      isActive: true,
    });
    for (const roleName of STAFF_ROLES) {
      const id = roleName === "OWNER" ? roleId : randomUUID();
      await db().collection("roles").doc(id).set({
        restaurantId,
        name: roleName,
        label: roleName.replace(/_/g, " "),
        permissions: DEFAULT_ROLE_PERMISSIONS[roleName],
      });
    }
    await db().collection("users").doc(userId).set({
      restaurantId,
      email: dto.email,
      name: dto.ownerName,
      roleId,
      roleName: "OWNER",
      permissions,
      isActive: true,
      firebaseUid: rec.uid,
    });
    const idToken = await signInPassword(dto.email, dto.password);
    const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_MS });
    await setSessionCookie(cookie);
    return {
      user: {
        id: userId,
        restaurantId,
        name: dto.ownerName,
        roleId,
        roleName: "OWNER",
        permissions,
      } satisfies SessionUser,
    };
  }

  if (p === "auth/login" && method === "POST") {
    needFirebase();
    const dto = loginSchema.parse(body);
    const idToken = await signInPassword(dto.email, dto.password);
    const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_MS });
    await setSessionCookie(cookie);
    const users = await db().collection("users").where("email", "==", dto.email).limit(1).get();
    if (!users.docs.length) throw new HttpError(401, "Invalid email or password");
    const u = users.docs[0];
    const d = u.data();
    if (d.isActive === false) throw new HttpError(401, "Session no longer valid");
    return {
      user: {
        id: u.id,
        restaurantId: d.restaurantId,
        name: d.name,
        roleId: d.roleId,
        roleName: d.roleName,
        permissions: d.permissions ?? [],
      },
    };
  }

  if (p === "auth/logout" && method === "POST") {
    await clearSessionCookie();
    return { ok: true };
  }

  if (p === "auth/password-reset" && method === "POST") {
    const email = (body as { email?: string })?.email;
    if (email && firebaseConfigured()) {
      try {
        await adminAuth().generatePasswordResetLink(email);
      } catch {
        /* do not reveal */
      }
    }
    return { ok: true };
  }

  if (p === "auth/me" && method === "GET") {
    const user = await requireUser();
    return { user };
  }

  if (p.startsWith("auth/2fa") && method === "GET") {
    return { enabled: false, recoveryCodesLeft: 0 };
  }
  if (p.startsWith("auth/2fa") && method === "POST") {
    throw new HttpError(501, "TOTP 2FA is not available on the Firebase/Vercel deployment yet");
  }

  const user = await requireUser();

  if (p === "branches" && method === "GET") {
    const snap = await db().collection("branches").where("restaurantId", "==", user.restaurantId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  if (p === "settings" && method === "GET") {
    const branchId = requireBranchId(url);
    await assertBranch(user, branchId);
    const restaurant = await db().collection("restaurants").doc(user.restaurantId).get();
    const branch = await db().collection("branches").doc(branchId).get();
    return { restaurant: { id: restaurant.id, ...restaurant.data() }, branch: { id: branch.id, ...branch.data() } };
  }

  if (p === "settings/restaurant" && method === "PATCH") {
    requirePermission(user, "settings.manage");
    await db().collection("restaurants").doc(user.restaurantId).set(body as object, { merge: true });
    const snap = await db().collection("restaurants").doc(user.restaurantId).get();
    return { id: snap.id, ...snap.data() };
  }

  if (p === "settings/restaurant/logo" && method === "POST") {
    requirePermission(user, "settings.manage");
    const file = ctx.form?.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No file uploaded");
    const uploaded = await uploadToImgbb(file, { kind: "logo", restaurantId: user.restaurantId });
    await db().collection("restaurants").doc(user.restaurantId).set({ logoUrl: uploaded.url }, { merge: true });
    return uploaded;
  }

  if (p === "settings/branch" && method === "PATCH") {
    requirePermission(user, "settings.manage");
    const branchId = requireBranchId(url);
    await assertBranch(user, branchId);
    await db().collection("branches").doc(branchId).set(body as object, { merge: true });
    const snap = await db().collection("branches").doc(branchId).get();
    return { id: snap.id, ...snap.data() };
  }

  if (p.startsWith("settings/kiosk/") && method === "POST") {
    requirePermission(user, "settings.manage");
    const branchId = requireBranchId(url);
    await assertBranch(user, branchId);
    const action = parts[2];
    const kioskToken = action === "enable" ? randomUUID() : null;
    await db().collection("branches").doc(branchId).set({ kioskToken }, { merge: true });
    return { kioskToken };
  }

  if (p === "menu/items/upload-image" && method === "POST") {
    requirePermission(user, "menu.manage");
    const file = ctx.form?.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No file uploaded");
    const branchId = url.searchParams.get("branchId") ?? "";
    return uploadToImgbb(file, { kind: "menu", restaurantId: user.restaurantId, branchId });
  }

  const branchCrud = matchBranchCrud(p, method);
  if (branchCrud) {
    const branchId = requireBranchId(url);
    await assertBranch(user, branchId);
    requirePermission(user, branchCrud.perm);
    if (method === "GET" && !branchCrud.id) {
      const rows = await listByBranch(branchCrud.col, user.restaurantId, branchId);
      return filterSearch(rows, url);
    }
    if (method === "GET" && branchCrud.id) {
      return getOwned(branchCrud.col, branchCrud.id, user);
    }
    if (method === "POST" && !branchCrud.id) {
      return createOwned(branchCrud.col, user, branchId, (body as Record<string, unknown>) ?? {});
    }
    if ((method === "PATCH" || method === "PUT") && branchCrud.id) {
      return patchOwned(branchCrud.col, branchCrud.id, user, (body as Record<string, unknown>) ?? {});
    }
    if (method === "DELETE" && branchCrud.id) {
      return deleteOwned(branchCrud.col, branchCrud.id, user);
    }
  }

  if (p === "menu/categories" || p.startsWith("menu/categories/")) {
    return menuCollection(user, url, method, p, body, "menuCategories", "menu.view");
  }
  if (p === "menu/stations" || p.startsWith("menu/stations/")) {
    return menuCollection(user, url, method, p, body, "kitchenStations", "menu.view");
  }
  if (p === "menu/items" || (p.startsWith("menu/items/") && !p.includes("upload"))) {
    return menuItems(user, url, method, p, body);
  }
  if (p === "menu/modifier-groups" || p.startsWith("menu/modifier-groups/")) {
    return menuCollection(user, url, method, p, body, "modifierGroups", "menu.view");
  }

  if (p === "tables/floors" || p.startsWith("tables/floors/")) {
    return floors(user, url, method, p, body);
  }
  if (p === "tables" || p.startsWith("tables/")) {
    return tables(user, url, method, p, body);
  }

  if (p.startsWith("orders")) {
    return orders(user, url, method, p, parts, body);
  }

  if (p.startsWith("kds")) {
    return kds(user, url, method, p, parts, body);
  }

  if (p === "dashboard/summary" && method === "GET") {
    const branchId = requireBranchId(url);
    await assertBranch(user, branchId);
    const ordersSnap = await listByBranch("orders", user.restaurantId, branchId);
    const paid = ordersSnap.filter((o) => (o as { status?: string }).status === "PAID");
    const sales = paid.reduce((s, o) => s + Number((o as { totalAmount?: string }).totalAmount ?? 0), 0);
    return {
      todaySales: sales,
      orderCount: paid.length,
      openOrders: ordersSnap.filter((o) => (o as { status?: string }).status === "OPEN").length,
    };
  }
  if (p === "dashboard/trends" && method === "GET") {
    return { points: [] };
  }

  if (p === "users" && method === "GET") {
    requirePermission(user, "users.manage");
    const snap = await db().collection("users").where("restaurantId", "==", user.restaurantId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data(), passwordHash: undefined }));
  }
  if (p === "users/roles" && method === "GET") {
    const snap = await db().collection("roles").where("restaurantId", "==", user.restaurantId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  if (p === "roles" && method === "GET") {
    const snap = await db().collection("roles").where("restaurantId", "==", user.restaurantId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  if (p === "roles" && method === "POST") {
    requirePermission(user, "users.manage");
    const id = randomUUID();
    const dto = body as { name: string; permissions?: string[] };
    await db().collection("roles").doc(id).set({
      restaurantId: user.restaurantId,
      name: dto.name,
      permissions: dto.permissions ?? [],
    });
    return { id, restaurantId: user.restaurantId, ...dto };
  }

  if (p === "reports" && method === "GET") {
    return [];
  }

  if (p === "system/update/check" && method === "GET") {
    return { current: "vercel", latest: "vercel", upToDate: true };
  }

  if (p === "sync/status" && method === "GET") {
    return { enabled: false, reason: "Peer LAN sync is not available on Vercel/Firebase" };
  }

  if (p === "backups/status" && method === "GET") {
    return { configured: false, reason: "Use Firestore export; local disk backups are not used on Vercel" };
  }
  if (p === "backups" && method === "GET") return [];

  if (p.startsWith("verifactu") || p.startsWith("mcp") || p.includes("print/usb") || p === "orders/print/drawer") {
    throw new HttpError(501, "This integration is not available on the serverless Vercel runtime");
  }

  if (method === "GET" && p.startsWith("public/")) {
    return publicMenu(p, url);
  }

  throw new HttpError(404, `No handler for ${method} /${p}`);
}

function filterSearch(rows: Record<string, unknown>[], url: URL) {
  const search = url.searchParams.get("search");
  if (!search) return rows;
  const q = search.toLowerCase();
  return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
}

function matchBranchCrud(p: string, _method: string) {
  const map: { prefix: string; col: string; perm: string }[] = [
    { prefix: "customers", col: "customers", perm: "customers.manage" },
    { prefix: "reservations", col: "reservations", perm: "reservations.manage" },
    { prefix: "waitlist", col: "waitlist", perm: "reservations.manage" },
    { prefix: "gift-cards", col: "giftCards", perm: "customers.manage" },
    { prefix: "marketing/coupons", col: "coupons", perm: "marketing.manage" },
    { prefix: "marketing/promotions", col: "promotions", perm: "marketing.manage" },
    { prefix: "marketing/campaigns", col: "campaigns", perm: "marketing.manage" },
    { prefix: "delivery/zones", col: "deliveryZones", perm: "delivery.manage" },
    { prefix: "inventory/ingredients", col: "ingredients", perm: "inventory.manage" },
    { prefix: "inventory/suppliers", col: "suppliers", perm: "inventory.manage" },
    { prefix: "inventory/purchase-orders", col: "purchaseOrders", perm: "inventory.manage" },
    { prefix: "inventory/waste", col: "wasteLogs", perm: "inventory.manage" },
    { prefix: "accounting/expenses", col: "expenses", perm: "accounting.manage" },
    { prefix: "hr/shifts", col: "shifts", perm: "staff.manage" },
    { prefix: "hr/leave", col: "leaveRequests", perm: "staff.manage" },
    { prefix: "attendance", col: "attendance", perm: "attendance.manage" },
    { prefix: "notifications", col: "notifications", perm: "dashboard.sales.view" },
    { prefix: "operations/equipment", col: "equipment", perm: "operations.manage" },
    { prefix: "operations/documents", col: "documents", perm: "operations.manage" },
    { prefix: "webhooks", col: "webhookEndpoints", perm: "settings.manage" },
  ];
  for (const m of map) {
    if (p === m.prefix) return { ...m, id: undefined as string | undefined };
    if (p.startsWith(m.prefix + "/")) {
      const rest = p.slice(m.prefix.length + 1).split("/")[0];
      if (rest) return { ...m, id: rest };
    }
  }
  return null;
}

async function menuCollection(
  user: SessionUser,
  url: URL,
  method: string,
  p: string,
  body: unknown,
  col: string,
  viewPerm: string,
) {
  const branchId = requireBranchId(url);
  await assertBranch(user, branchId);
  const id = p.split("/")[2];
  if (method === "GET" && !id) {
    requirePermission(user, viewPerm);
    const rows = await listByBranch(col, user.restaurantId, branchId);
    return rows.map((r) => ({ ...r, _count: { items: 0 }, isActive: r.isActive !== false, showOnWebsite: true, sortOrder: r.sortOrder ?? 0 }));
  }
  if (method === "POST") {
    requirePermission(user, "menu.manage");
    return createOwned(col, user, branchId, body as Record<string, unknown>);
  }
  if (method === "PATCH" && id) {
    requirePermission(user, "menu.manage");
    return patchOwned(col, id, user, body as Record<string, unknown>);
  }
  if (method === "DELETE" && id) {
    requirePermission(user, "menu.manage");
    return deleteOwned(col, id, user);
  }
  throw new HttpError(405, "Method not allowed");
}

async function menuItems(user: SessionUser, url: URL, method: string, p: string, body: unknown) {
  const branchId = requireBranchId(url);
  await assertBranch(user, branchId);
  const id = p.split("/")[2];
  if (method === "GET" && !id) {
    requirePermission(user, "menu.view");
    const rows = await listByBranch("menuItems", user.restaurantId, branchId);
    const catId = url.searchParams.get("categoryId");
    return rows
      .filter((r) => !catId || r.categoryId === catId)
      .map((r) => ({
        ...r,
        price: String(r.price ?? "0"),
        category: { id: r.categoryId, name: r.categoryName ?? "" },
        station: r.stationId ? { id: r.stationId, name: r.stationName ?? "" } : null,
        modifierGroups: r.modifierGroups ?? [],
        isVeg: Boolean(r.isVeg),
        isActive: r.isActive !== false,
        isCombo: Boolean(r.isCombo),
      }));
  }
  if (method === "POST" && !id) {
    requirePermission(user, "menu.manage");
    const dto = body as Record<string, unknown>;
    const { modifierGroupIds: _m, ...rest } = dto;
    return createOwned("menuItems", user, branchId, rest);
  }
  if (method === "PATCH" && id) {
    requirePermission(user, "menu.manage");
    return patchOwned("menuItems", id, user, body as Record<string, unknown>);
  }
  if (method === "DELETE" && id) {
    requirePermission(user, "menu.manage");
    return deleteOwned("menuItems", id, user);
  }
  throw new HttpError(405, "Method not allowed");
}

async function floors(user: SessionUser, url: URL, method: string, p: string, body: unknown) {
  const branchId = requireBranchId(url);
  await assertBranch(user, branchId);
  const id = p.split("/")[2];
  if (method === "GET") {
    requirePermission(user, "tables.view");
    const floorsRows = await listByBranch("floors", user.restaurantId, branchId);
    const tablesRows = await listByBranch("tables", user.restaurantId, branchId);
    return floorsRows
      .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
      .map((f) => ({
        ...f,
        tables: tablesRows.filter((t) => t.floorId === f.id),
      }));
  }
  if (method === "POST") {
    requirePermission(user, "tables.manage");
    return createOwned("floors", user, branchId, body as Record<string, unknown>);
  }
  if (method === "PATCH" && id) {
    requirePermission(user, "tables.manage");
    return patchOwned("floors", id, user, body as Record<string, unknown>);
  }
  throw new HttpError(405, "Method not allowed");
}

async function tables(user: SessionUser, url: URL, method: string, p: string, body: unknown) {
  const branchId = requireBranchId(url);
  await assertBranch(user, branchId);
  if (p === "tables/bulk" && method === "POST") {
    requirePermission(user, "tables.manage");
    const dto = body as { floorId: string; numbers: string[] };
    const created = [];
    for (const number of dto.numbers) {
      created.push(
        await createOwned("tables", user, branchId, {
          floorId: dto.floorId,
          number,
          status: "AVAILABLE",
        }),
      );
    }
    return created;
  }
  if (p === "tables/layout" && method === "PATCH") {
    requirePermission(user, "tables.manage");
    const updates = body as { id: string; x?: number; y?: number }[];
    for (const u of updates) {
      await patchOwned("tables", u.id, user, u as unknown as Record<string, unknown>);
    }
    return { ok: true };
  }
  const id = p.split("/")[1];
  if (p === "tables" && method === "POST") {
    requirePermission(user, "tables.manage");
    return createOwned("tables", user, branchId, { status: "AVAILABLE", ...(body as object) });
  }
  if (method === "PATCH" && id && p.endsWith("/status")) {
    requirePermission(user, "tables.manage");
    return patchOwned("tables", id, user, body as Record<string, unknown>);
  }
  if (method === "POST" && id && p.endsWith("/qr-token")) {
    requirePermission(user, "tables.manage");
    return patchOwned("tables", id, user, { qrToken: randomUUID() });
  }
  if (method === "PATCH" && id) {
    requirePermission(user, "tables.manage");
    return patchOwned("tables", id, user, body as Record<string, unknown>);
  }
  if (method === "DELETE" && id) {
    requirePermission(user, "tables.manage");
    return deleteOwned("tables", id, user);
  }
  throw new HttpError(405, "Method not allowed");
}

async function orders(
  user: SessionUser,
  url: URL,
  method: string,
  p: string,
  parts: string[],
  body: unknown,
) {
  const branchId = url.searchParams.get("branchId");
  if (p === "orders/print/diagnostics" && method === "GET") {
    return { available: false, reason: "USB/network printers are not attached to Vercel serverless" };
  }
  if (!branchId) throw new HttpError(400, "branchId is required");
  await assertBranch(user, branchId);

  if (p === "orders" && method === "GET") {
    requirePermission(user, "orders.create");
    let rows = await listByBranch("orders", user.restaurantId, branchId);
    const tableId = url.searchParams.get("tableId");
    if (tableId) rows = rows.filter((r) => r.tableId === tableId);
    if (!url.searchParams.get("tableId")) rows = rows.filter((r) => r.status === "OPEN");
    return rows;
  }

  if (p === "orders/manage" && method === "GET") {
    requirePermission(user, "orders.create");
    return listByBranch("orders", user.restaurantId, branchId);
  }

  if (p === "orders" && method === "POST") {
    requirePermission(user, "orders.create");
    const dto = body as {
      tableId?: string;
      items: { menuItemId: string; quantity: number; modifierIds?: string[] }[];
      requestId?: string;
      type?: string;
    };
    if (dto.requestId) {
      const dup = await db().collection("orders").where("requestId", "==", dto.requestId).limit(1).get();
      if (dup.docs.length) return { id: dup.docs[0].id, ...dup.docs[0].data() };
    }
    const menu = await listByBranch("menuItems", user.restaurantId, branchId);
    const byId = new Map(menu.map((m) => [m.id, m]));
    const pricedLines: { lineTotal: number; taxAmount: number }[] = [];
    const orderItems: Record<string, unknown>[] = [];
    for (const line of dto.items ?? []) {
      const item = byId.get(line.menuItemId);
      if (!item) throw new HttpError(400, "Unknown menu item");
      const unit = Number(item.price ?? 0);
      const tax = Number(item.taxRatePercent ?? 0);
      const pl = priceLine({
        quantity: line.quantity,
        unitPriceInclusive: unit,
        taxRatePercent: tax,
      });
      pricedLines.push(pl);
      orderItems.push({
        id: randomUUID(),
        menuItemId: line.menuItemId,
        name: item.name,
        quantity: line.quantity,
        unitPrice: String(unit),
        lineTotal: String(pl.lineTotal),
        taxAmount: String(pl.taxAmount),
      });
    }
    const bill = computeBill({ lines: pricedLines });
    const counterRef = db().collection("counters").doc(branchId);
    const orderId = randomUUID();
    const result = await db().runTransaction(async (tx) => {
      const c = await tx.get(counterRef);
      const last = Number(c.data()?.orderNumber ?? 0);
      const orderNumber = last + 1;
      tx.set(counterRef, { orderNumber, restaurantId: user.restaurantId, branchId }, { merge: true });
      const order = {
        restaurantId: user.restaurantId,
        branchId,
        tableId: dto.tableId ?? null,
        orderNumber: String(orderNumber),
        status: "OPEN",
        acceptance: "NOT_REQUIRED",
        subtotal: String(bill.subtotal),
        taxAmount: String(bill.taxAmount),
        discountAmount: String(bill.discountAmount),
        tipAmount: "0",
        loyaltyPointsRedeemed: 0,
        loyaltyDiscountAmount: "0",
        totalAmount: String(bill.totalDue),
        requestId: dto.requestId ?? null,
        items: orderItems,
        payments: [],
        createdAt: new Date().toISOString(),
      };
      tx.set(db().collection("orders").doc(orderId), order);
      const ticket = {
        restaurantId: user.restaurantId,
        branchId,
        orderId,
        orderNumber: String(orderNumber),
        status: "NEW",
        items: orderItems,
        createdAt: new Date().toISOString(),
      };
      tx.set(db().collection("kitchenTickets").doc(orderId), ticket);
      return { id: orderId, ...order };
    });
    if (dto.tableId) {
      await db().collection("tables").doc(dto.tableId).set({ status: "OCCUPIED" }, { merge: true });
    }
    return result;
  }

  const orderId = parts[1];
  if (!orderId) throw new HttpError(404, "Not found");

  if (p === `orders/${orderId}` && method === "GET") {
    return getOwned("orders", orderId, user);
  }

  if (p === `orders/${orderId}/bill-preview` && method === "POST") {
    const order = await getOwned("orders", orderId, user);
    const items = (order.items as { lineTotal?: string; taxAmount?: string }[]) ?? [];
    const lines = items.map((i) => ({
      lineTotal: Number(i.lineTotal ?? 0),
      taxAmount: Number(i.taxAmount ?? 0),
    }));
    const adj = (body ?? {}) as {
      discountPercent?: number;
      tipAmount?: number;
      loyaltyPointsToRedeem?: number;
    };
    const bill = computeBill({
      lines,
      discountPercent: adj.discountPercent,
      tip: adj.tipAmount,
      loyaltyDiscountRequested: adj.loyaltyPointsToRedeem,
    });
    const amountPaid = ((order.payments as { amount?: string }[]) ?? []).reduce(
      (s, x) => s + Number(x.amount ?? 0),
      0,
    );
    return {
      locked: false,
      status: order.status,
      ...bill,
      discountType: adj.discountPercent ? "PERCENT" : null,
      discountValue: adj.discountPercent ?? null,
      couponCode: null,
      promotionName: null,
      totalDue: bill.totalDue,
      amountPaid,
      balanceDue: round2(bill.totalDue - amountPaid),
    };
  }

  if (p === `orders/${orderId}/checkout` && method === "POST") {
    requirePermission(user, "bills.print");
    const order = await getOwned("orders", orderId, user);
    if (order.status === "PAID") {
      return {
        ...order,
        settlement: {
          amountDue: 0,
          amountPaid: Number(order.totalAmount),
          balanceDue: 0,
          changeDue: 0,
          fullyPaid: true,
        },
      };
    }
    const dto = body as {
      requestId?: string;
      payments?: { method: string; amount: number; tendered?: number }[];
      allowPartial?: boolean;
      discountPercent?: number;
      tipAmount?: number;
    };
    if (dto.requestId && order.checkoutRequestId === dto.requestId) {
      return order;
    }
    const items = (order.items as { lineTotal?: string; taxAmount?: string }[]) ?? [];
    const bill = computeBill({
      lines: items.map((i) => ({
        lineTotal: Number(i.lineTotal ?? 0),
        taxAmount: Number(i.taxAmount ?? 0),
      })),
      discountPercent: dto.discountPercent,
      tip: dto.tipAmount,
    });
    const already = ((order.payments as { amount?: string }[]) ?? []).reduce(
      (s, x) => s + Number(x.amount ?? 0),
      0,
    );
    const settlement = settlePayments({
      balance: round2(bill.totalDue - already),
      payments: dto.payments ?? [],
      allowPartial: dto.allowPartial,
    });
    const payments = [
      ...((order.payments as object[]) ?? []),
      ...settlement.payments.map((x) => ({
        ...x,
        amount: String(x.amount),
        tendered: x.tendered != null ? String(x.tendered) : null,
        changeGiven: x.changeGiven != null ? String(x.changeGiven) : null,
      })),
    ];
    const status = settlement.fullyPaid ? "PAID" : "OPEN";
    const next = {
      ...order,
      ...bill,
      subtotal: String(bill.subtotal),
      taxAmount: String(bill.taxAmount),
      discountAmount: String(bill.discountAmount),
      tipAmount: String(bill.tipAmount),
      totalAmount: String(bill.totalDue),
      payments,
      status,
      checkoutRequestId: dto.requestId ?? null,
      billedAt: settlement.fullyPaid ? new Date().toISOString() : order.billedAt,
    };
    await db().collection("orders").doc(orderId).set(next, { merge: true });
    if (settlement.fullyPaid && order.tableId) {
      await db().collection("tables").doc(String(order.tableId)).set({ status: "AVAILABLE" }, { merge: true });
    }
    return {
      ...next,
      settlement: {
        amountDue: bill.totalDue,
        amountPaid: round2(already + settlement.paidNow),
        balanceDue: settlement.balanceAfter,
        changeDue: settlement.changeDue,
        fullyPaid: settlement.fullyPaid,
      },
    };
  }

  if (p === `orders/${orderId}/accept` && method === "POST") {
    return patchOwned("orders", orderId, user, { acceptance: "ACCEPTED" });
  }
  if (p === `orders/${orderId}/reject` && method === "POST") {
    return patchOwned("orders", orderId, user, {
      acceptance: "REJECTED",
      status: "CANCELLED",
    });
  }
  if (p === `orders/${orderId}/cancel` && method === "POST") {
    return patchOwned("orders", orderId, user, { status: "CANCELLED" });
  }
  if (p === `orders/${orderId}/refund` && method === "POST") {
    requirePermission(user, "refunds.process");
    const order = await getOwned("orders", orderId, user);
    if (order.status !== "PAID") throw new HttpError(400, "Only paid orders can be refunded");
    const dto = body as { amount?: number; reason?: string };
    const amount = Number(dto.amount ?? order.totalAmount);
    await createOwned("refunds", user, branchId, {
      orderId,
      amount: String(amount),
      reason: dto.reason ?? "",
    });
    return patchOwned("orders", orderId, user, { status: "REFUNDED" });
  }

  throw new HttpError(404, `No order handler for ${method} /${p}`);
}

async function kds(
  user: SessionUser,
  url: URL,
  method: string,
  p: string,
  parts: string[],
  body: unknown,
) {
  const branchId = requireBranchId(url);
  await assertBranch(user, branchId);
  requirePermission(user, "kds.manage");
  if (p === "kds/stations" && method === "GET") {
    return listByBranch("kitchenStations", user.restaurantId, branchId);
  }
  if (p === "kds/tickets" && method === "GET") {
    return listByBranch("kitchenTickets", user.restaurantId, branchId);
  }
  if (p === "kds/incoming" && method === "GET") {
    const orders = await listByBranch("orders", user.restaurantId, branchId);
    return orders.filter((o) => o.acceptance === "PENDING");
  }
  if (p === "kds/progress" && method === "GET") {
    return listByBranch("kitchenTickets", user.restaurantId, branchId);
  }
  if (p === "kds/performance" && method === "GET") return [];
  if (parts[1] === "tickets" && parts[3] === "status" && method === "PATCH") {
    const id = parts[2];
    const status = (body as { status: string }).status;
    return patchOwned("kitchenTickets", id, user, { status });
  }
  if (parts[1] === "incoming" && parts[3] === "accept" && method === "POST") {
    return patchOwned("orders", parts[2], user, { acceptance: "ACCEPTED" });
  }
  if (parts[1] === "incoming" && parts[3] === "reject" && method === "POST") {
    return patchOwned("orders", parts[2], user, { acceptance: "REJECTED", status: "CANCELLED" });
  }
  throw new HttpError(404, `No KDS handler for ${method} /${p}`);
}

async function publicMenu(p: string, url: URL) {
  if (p.startsWith("public/menu")) {
    const token = url.searchParams.get("token") ?? partsLast(p);
    const tables = await db().collection("tables").where("qrToken", "==", token).limit(1).get();
    if (!tables.docs.length) throw new HttpError(404, "Unknown QR token");
    const table = tables.docs[0].data();
    const items = await db().collection("menuItems").where("branchId", "==", table.branchId).get();
    return items.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return [];
}

function partsLast(p: string) {
  const segs = p.split("/");
  return segs[segs.length - 1];
}
