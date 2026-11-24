// Tests for the Admin Orders (orders directory) read path.
//
// The directory is read through ONE read-only RPC, public.admin_orders_directory(),
// which authorizes the caller server-side with has_admin_access() (owner OR
// approved admin) and returns only the order display fields. It never returns the
// client identity (client_id) or the client-written free text (order_description,
// requirements).
//
// Run: node --experimental-test-module-mocks --test src/lib/adminOrdersDirectory.test.js
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const rpcCalls = [];
let rpcResponder = () => ({ data: null, error: null });

// Stands in for supabase-js: records the RPC name and arguments and resolves like
// a real request. Nothing here touches the network.
mock.module(new URL("./supabase.js", import.meta.url), {
  exports: {
    getSupabaseClient: () => ({
      rpc(name, args) {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResponder(name, args));
      },
    }),
  },
});

const {
  adminOrdersDirectoryNotConfiguredMessage,
  filterAdminOrders,
  getAdminOrdersDirectory,
  getAdminOrdersDirectoryErrorMessage,
  isMissingAdminOrdersDirectoryError,
  normalizeAdminOrders,
} = await import("./adminOrdersDirectory.js");

const orderRows = [
  {
    id: "0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    project_name: "Nexus storefront",
    service_name: "Web development",
    status: "pending",
    price: 12500,
    currency: "PKR",
    created_at: "2026-11-20T09:30:00Z",
  },
  {
    id: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    project_name: "Search audit",
    service_name: "SEO audit",
    status: "completed",
    price: 2500,
    currency: "PKR",
    created_at: "2026-10-20T15:00:00Z",
  },
];

test("the owner reads the live orders directory", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: orderRows, error: null });

  const orders = await getAdminOrdersDirectory();

  assert.equal(orders.length, 2);
  assert.equal(orders[0].serviceName, "Web development");
  assert.equal(orders[0].status, "pending");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_orders_directory");
});

test("an approved admin uses the same server gate and sends no identity or role", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: orderRows, error: null });

  const orders = await getAdminOrdersDirectory();

  assert.equal(orders.length, 2);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_orders_directory");
  // The owner and an approved admin call the exact same thing: no role, id, or
  // owner flag is ever sent, because the server decides who is allowed.
  assert.equal(
    rpcCalls[0].args,
    undefined,
    "the browser must not send a role, id, or owner flag — authorization is server-side",
  );
});

test("an unauthorized caller is rejected by the server and gets no data", async () => {
  rpcCalls.length = 0;
  const unauthorized = {
    code: "42501",
    message: "The orders directory is available to the owner and approved admins only.",
  };
  rpcResponder = () => ({ data: null, error: unauthorized });

  await assert.rejects(() => getAdminOrdersDirectory(), (error) => error === unauthorized);
  assert.equal(isMissingAdminOrdersDirectoryError(unauthorized), false);
  assert.match(
    getAdminOrdersDirectoryErrorMessage(unauthorized),
    /Only the NexTech owner and approved admins/,
  );
});

test("an empty orders directory is an empty list, not an error", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: [], error: null });

  const orders = await getAdminOrdersDirectory();
  assert.deepEqual(orders, []);
});

test("order records are returned correctly", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: orderRows, error: null });

  const orders = await getAdminOrdersDirectory();

  assert.deepEqual(orders[0], {
    id: "0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    projectName: "Nexus storefront",
    serviceName: "Web development",
    status: "pending",
    price: 12500,
    currency: "PKR",
    createdAt: "2026-11-20T09:30:00Z",
  });
  assert.equal(orders[1].status, "completed");
});

test("sensitive, client and unexpected fields are dropped, never shown", () => {
  const orders = normalizeAdminOrders([{
    id: "0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    project_name: "Nexus storefront",
    service_name: "Web development",
    status: "pending",
    price: 12500,
    currency: "PKR",
    created_at: "2026-11-20T09:30:00Z",
    // Never expected from the RPC; must be dropped rather than shown if a future
    // change ever leaked them.
    client_id: "should-be-ignored",
    order_description: "should-be-ignored",
    requirements: { notes: "should-be-ignored" },
    package_name: "should-be-ignored",
    updated_at: "2026-11-21T00:00:00Z",
    email: "client@example.com",
    access_token: "should-never-appear",
  }]);

  assert.deepEqual(
    Object.keys(orders[0]).sort(),
    ["createdAt", "currency", "id", "price", "projectName", "serviceName", "status"],
  );
});

test("a missing or malformed payload renders as an empty directory", () => {
  assert.deepEqual(normalizeAdminOrders(undefined), []);
  assert.deepEqual(normalizeAdminOrders(null), []);
  assert.deepEqual(normalizeAdminOrders({ orders: orderRows }), []);
});

test("search matches the order id, service name or project name, case-insensitively", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: orderRows, error: null });
  const orders = await getAdminOrdersDirectory();

  assert.equal(filterAdminOrders(orders, {}).length, 2);
  assert.deepEqual(filterAdminOrders(orders, { query: "web" }).map((o) => o.id), [orderRows[0].id]);
  assert.deepEqual(filterAdminOrders(orders, { query: "audit" }).map((o) => o.id), [orderRows[1].id]);
  assert.deepEqual(filterAdminOrders(orders, { query: "NEXUS" }).map((o) => o.id), [orderRows[0].id]);
  assert.deepEqual(filterAdminOrders(orders, { query: "0f1c2d3e" }).map((o) => o.id), [orderRows[0].id]);
  assert.deepEqual(filterAdminOrders(orders, { query: "nobody" }), []);
});

test("status filter uses the real status field only", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: orderRows, error: null });
  const orders = await getAdminOrdersDirectory();

  assert.deepEqual(filterAdminOrders(orders, { status: "pending" }).map((o) => o.id), [orderRows[0].id]);
  assert.deepEqual(filterAdminOrders(orders, { status: "completed" }).map((o) => o.id), [orderRows[1].id]);
  assert.equal(filterAdminOrders(orders, { status: "all" }).length, 2);
  // A value that is not a real status must not filter anything out (falls back
  // to "all").
  assert.equal(filterAdminOrders(orders, { status: "cancelled" }).length, 2);
});

test("search and status filter combine", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: orderRows, error: null });
  const orders = await getAdminOrdersDirectory();

  assert.deepEqual(
    filterAdminOrders(orders, { query: "web", status: "completed" }),
    [],
  );
  assert.deepEqual(
    filterAdminOrders(orders, { query: "web", status: "pending" }).map((o) => o.id),
    [orderRows[0].id],
  );
});

test("a database error surfaces a readable message and is not swallowed", async () => {
  rpcCalls.length = 0;
  const failure = { code: "57014", message: "canceling statement due to statement timeout" };
  rpcResponder = () => ({ data: null, error: failure });

  await assert.rejects(() => getAdminOrdersDirectory(), (error) => error === failure);
  assert.equal(getAdminOrdersDirectoryErrorMessage(failure), "canceling statement due to statement timeout");
});

test("a missing directory migration is reported as not configured, not as empty success", async () => {
  rpcCalls.length = 0;
  const missing = {
    code: "PGRST202",
    message: "Could not find the function public.admin_orders_directory",
  };
  rpcResponder = () => ({ data: null, error: missing });

  await assert.rejects(() => getAdminOrdersDirectory());
  assert.equal(isMissingAdminOrdersDirectoryError(missing), true);
  assert.equal(
    getAdminOrdersDirectoryErrorMessage(missing),
    adminOrdersDirectoryNotConfiguredMessage,
  );
});
