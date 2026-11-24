// Tests for the Admin Services (services directory) read path.
//
// The directory is read through ONE read-only RPC,
// public.admin_services_directory(), which authorizes the caller server-side with
// has_admin_access() (owner OR approved admin) and returns only the catalog
// display fields. It never returns seller/provider or category data (neither
// column exists on public.services) and no customer personal information.
//
// Run: node --experimental-test-module-mocks --test src/lib/adminServicesDirectory.test.js
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
  adminServicesDirectoryNotConfiguredMessage,
  filterAdminServices,
  getAdminServicesDirectory,
  getAdminServicesDirectoryErrorMessage,
  isMissingAdminServicesDirectoryError,
  normalizeAdminServices,
} = await import("./adminServicesDirectory.js");

const catalogRows = [
  {
    id: "web-development",
    name: "Web development",
    description: "Custom Nexus storefront builds",
    base_price: 12500,
    currency: "PKR",
    is_active: true,
    created_at: "2026-11-05T09:30:00Z",
  },
  {
    id: "seo-audit",
    name: "SEO audit",
    description: "Technical search audit",
    base_price: 2500,
    currency: "PKR",
    is_active: false,
    created_at: "2026-10-20T15:00:00Z",
  },
];

test("the owner reads the live services directory", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: catalogRows, error: null });

  const services = await getAdminServicesDirectory();

  assert.equal(services.length, 2);
  assert.equal(services[0].name, "Web development");
  assert.equal(services[0].active, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_services_directory");
});

test("an approved admin uses the same server gate and sends no identity or role", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: catalogRows, error: null });

  const services = await getAdminServicesDirectory();

  assert.equal(services.length, 2);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_services_directory");
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
    message: "The services directory is available to the owner and approved admins only.",
  };
  rpcResponder = () => ({ data: null, error: unauthorized });

  await assert.rejects(() => getAdminServicesDirectory(), (error) => error === unauthorized);
  assert.equal(isMissingAdminServicesDirectoryError(unauthorized), false);
  assert.match(
    getAdminServicesDirectoryErrorMessage(unauthorized),
    /Only the NexTech owner and approved admins/,
  );
});

test("an empty services directory is an empty list, not an error", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: [], error: null });

  const services = await getAdminServicesDirectory();
  assert.deepEqual(services, []);
});

test("service records are returned correctly", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: catalogRows, error: null });

  const services = await getAdminServicesDirectory();

  assert.deepEqual(services[0], {
    id: "web-development",
    name: "Web development",
    description: "Custom Nexus storefront builds",
    price: 12500,
    currency: "PKR",
    active: true,
    createdAt: "2026-11-05T09:30:00Z",
  });
  assert.equal(services[1].active, false);
});

test("sensitive, seller and unexpected fields are dropped, never shown", () => {
  const services = normalizeAdminServices([{
    id: "web-development",
    name: "Web development",
    description: "Custom builds",
    base_price: 12500,
    currency: "PKR",
    is_active: true,
    created_at: "2026-11-05T09:30:00Z",
    // Never expected from the RPC; must be dropped rather than shown if a future
    // change ever leaked them.
    seller: "should-be-ignored",
    ownerUsername: "should-be-ignored",
    seller_details: { store: "secret" },
    email: "seller@example.com",
    client_id: "should-be-ignored",
    updated_at: "2026-11-06T00:00:00Z",
    access_token: "should-never-appear",
  }]);

  assert.deepEqual(
    Object.keys(services[0]).sort(),
    ["active", "createdAt", "currency", "description", "id", "name", "price"],
  );
});

test("a missing or malformed payload renders as an empty directory", () => {
  assert.deepEqual(normalizeAdminServices(undefined), []);
  assert.deepEqual(normalizeAdminServices(null), []);
  assert.deepEqual(normalizeAdminServices({ services: catalogRows }), []);
});

test("search matches the service name or description, case-insensitively", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: catalogRows, error: null });
  const services = await getAdminServicesDirectory();

  assert.equal(filterAdminServices(services, {}).length, 2);
  assert.deepEqual(filterAdminServices(services, { query: "web" }).map((s) => s.id), ["web-development"]);
  assert.deepEqual(filterAdminServices(services, { query: "SEO" }).map((s) => s.id), ["seo-audit"]);
  assert.deepEqual(filterAdminServices(services, { query: "audit" }).map((s) => s.id), ["seo-audit"]);
  assert.deepEqual(filterAdminServices(services, { query: "nobody" }), []);
});

test("status filter uses the real is_active field only", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: catalogRows, error: null });
  const services = await getAdminServicesDirectory();

  assert.deepEqual(filterAdminServices(services, { status: "active" }).map((s) => s.id), ["web-development"]);
  assert.deepEqual(filterAdminServices(services, { status: "inactive" }).map((s) => s.id), ["seo-audit"]);
  assert.equal(filterAdminServices(services, { status: "all" }).length, 2);
  // A preview-only status like "pending" is not a real field; it must not filter
  // anything out (falls back to "all").
  assert.equal(filterAdminServices(services, { status: "pending" }).length, 2);
});

test("search and status filter combine", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: catalogRows, error: null });
  const services = await getAdminServicesDirectory();

  assert.deepEqual(
    filterAdminServices(services, { query: "web", status: "inactive" }),
    [],
  );
  assert.deepEqual(
    filterAdminServices(services, { query: "web", status: "active" }).map((s) => s.id),
    ["web-development"],
  );
});

test("a database error surfaces a readable message and is not swallowed", async () => {
  rpcCalls.length = 0;
  const failure = { code: "57014", message: "canceling statement due to statement timeout" };
  rpcResponder = () => ({ data: null, error: failure });

  await assert.rejects(() => getAdminServicesDirectory(), (error) => error === failure);
  assert.equal(getAdminServicesDirectoryErrorMessage(failure), "canceling statement due to statement timeout");
});

test("a missing directory migration is reported as not configured, not as empty success", async () => {
  rpcCalls.length = 0;
  const missing = {
    code: "PGRST202",
    message: "Could not find the function public.admin_services_directory",
  };
  rpcResponder = () => ({ data: null, error: missing });

  await assert.rejects(() => getAdminServicesDirectory());
  assert.equal(isMissingAdminServicesDirectoryError(missing), true);
  assert.equal(
    getAdminServicesDirectoryErrorMessage(missing),
    adminServicesDirectoryNotConfiguredMessage,
  );
});
