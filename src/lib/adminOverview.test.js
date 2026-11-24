// Tests for the Admin Overview read path.
//
// The overview is read through ONE read-only RPC, public.admin_overview(), which
// authorizes the caller server-side with has_admin_access() (owner OR approved
// admin) and returns only the approved aggregates plus up to five recent orders
// with no customer personal information.
//
// Run: node --experimental-test-module-mocks --test src/lib/adminOverview.test.js
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
  adminOverviewNotConfiguredMessage,
  getAdminOverview,
  getAdminOverviewErrorMessage,
  isMissingAdminOverviewError,
  normalizeAdminOverview,
} = await import("./adminOverview.js");

test("returns the server's live totals for an authorized admin", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({
    data: {
      total_customers: 7,
      published_services: 3,
      pending_orders: 2,
      total_orders: 12,
      recent_orders: [{
        service_name: "Web development",
        project_name: "NexTech storefront",
        status: "pending",
        price: 12500,
        currency: "PKR",
        created_at: "2026-11-20T10:00:00Z",
      }],
    },
    error: null,
  });

  const overview = await getAdminOverview();

  assert.equal(overview.totalCustomers, 7);
  assert.equal(overview.publishedServices, 3);
  assert.equal(overview.pendingOrders, 2);
  assert.equal(overview.totalOrders, 12);
  assert.equal(overview.recentOrders.length, 1);
  assert.equal(overview.recentOrders[0].serviceName, "Web development");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_overview");
});

test("owner access uses the same server gate and sends no identity or role", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({
    data: {
      total_customers: 4,
      published_services: 1,
      pending_orders: 0,
      total_orders: 0,
      recent_orders: [],
    },
    error: null,
  });

  const overview = await getAdminOverview();

  assert.equal(overview.totalCustomers, 4);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_overview");
  // The owner and an approved admin call the exact same thing: no role, id, or
  // owner flag is ever sent, because the server decides who is allowed.
  assert.equal(
    rpcCalls[0].args,
    undefined,
    "the browser must not send a role, id, or owner flag — authorization is server-side",
  );
});

test("an unauthorized caller gets a clear error and never data", async () => {
  rpcCalls.length = 0;
  const unauthorized = {
    code: "42501",
    message: "Admin overview is available to the owner and approved admins only.",
  };
  rpcResponder = () => ({ data: null, error: unauthorized });

  await assert.rejects(() => getAdminOverview(), (error) => error === unauthorized);
  assert.equal(isMissingAdminOverviewError(unauthorized), false);
  assert.match(
    getAdminOverviewErrorMessage(unauthorized),
    /Only the NexTech owner and approved admins/,
  );
});

test("empty order data renders as an empty list, not an error", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({
    data: {
      total_customers: 4,
      published_services: 1,
      pending_orders: 0,
      total_orders: 0,
      recent_orders: [],
    },
    error: null,
  });

  const overview = await getAdminOverview();
  assert.equal(overview.totalOrders, 0);
  assert.deepEqual(overview.recentOrders, []);
});

test("a missing recent_orders field is treated as empty, never as undefined", () => {
  const overview = normalizeAdminOverview({
    total_customers: 4,
    published_services: 1,
    pending_orders: 0,
    total_orders: 0,
  });
  assert.equal(overview.totalCustomers, 4);
  assert.deepEqual(overview.recentOrders, []);
});

test("unknown or malformed counts collapse to 0 rather than NaN", () => {
  const overview = normalizeAdminOverview({
    total_customers: "5",
    published_services: null,
    pending_orders: -3,
    total_orders: "abc",
    recent_orders: null,
  });
  assert.equal(overview.totalCustomers, 5);
  assert.equal(overview.publishedServices, 0);
  assert.equal(overview.pendingOrders, 0);
  assert.equal(overview.totalOrders, 0);
  assert.deepEqual(overview.recentOrders, []);
});

test("recent orders carry only the approved, non-identifying fields", () => {
  const overview = normalizeAdminOverview({
    recent_orders: [{
      service_name: "SEO audit",
      project_name: "Q1 campaign",
      status: "active",
      price: 2500,
      currency: "PKR",
      created_at: "2026-11-01T00:00:00Z",
      // Never expected from the RPC; must be dropped rather than shown if a
      // future change ever leaked them.
      client_id: "should-be-ignored",
      email: "customer@example.com",
    }],
  });

  assert.deepEqual(
    Object.keys(overview.recentOrders[0]).sort(),
    ["createdAt", "currency", "price", "projectName", "serviceName", "status"],
  );
});

test("a missing overview migration is reported as not configured, not as empty success", async () => {
  rpcCalls.length = 0;
  const missing = { code: "PGRST202", message: "Could not find the function public.admin_overview" };
  rpcResponder = () => ({ data: null, error: missing });

  await assert.rejects(() => getAdminOverview());
  assert.equal(isMissingAdminOverviewError(missing), true);
  assert.equal(getAdminOverviewErrorMessage(missing), adminOverviewNotConfiguredMessage);
});
