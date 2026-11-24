// Tests for the Admin User Management (customer directory) read path.
//
// The directory is read through ONE read-only RPC,
// public.admin_customer_directory(), which authorizes the caller server-side with
// has_admin_access() (owner OR approved admin) and returns only the display
// fields for verified customer profiles. It never returns status (there is no
// status column), seller details, auth data, or password/token material.
//
// Run: node --experimental-test-module-mocks --test src/lib/adminCustomerDirectory.test.js
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
  adminCustomerDirectoryNotConfiguredMessage,
  filterCustomerDirectory,
  getAdminCustomerDirectory,
  getAdminCustomerDirectoryErrorMessage,
  isMissingAdminCustomerDirectoryError,
  normalizeCustomerDirectory,
} = await import("./adminCustomerDirectory.js");

const ownerRows = [
  {
    full_name: "Ayesha Khan",
    username: "ayesha",
    email: "ayesha@example.com",
    role: "customer",
    created_at: "2026-11-01T09:30:00Z",
  },
  {
    full_name: "Bilal Ahmed",
    username: "bilal",
    email: "bilal@example.com",
    role: "customer",
    created_at: "2026-10-20T15:00:00Z",
  },
];

test("the owner reads the live customer directory", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: ownerRows, error: null });

  const customers = await getAdminCustomerDirectory();

  assert.equal(customers.length, 2);
  assert.equal(customers[0].name, "Ayesha Khan");
  assert.equal(customers[0].email, "ayesha@example.com");
  assert.equal(customers[0].role, "customer");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_customer_directory");
});

test("an approved admin uses the same server gate and sends no identity or role", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: ownerRows, error: null });

  const customers = await getAdminCustomerDirectory();

  assert.equal(customers.length, 2);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_customer_directory");
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
    message: "The customer directory is available to the owner and approved admins only.",
  };
  rpcResponder = () => ({ data: null, error: unauthorized });

  await assert.rejects(() => getAdminCustomerDirectory(), (error) => error === unauthorized);
  assert.equal(isMissingAdminCustomerDirectoryError(unauthorized), false);
  assert.match(
    getAdminCustomerDirectoryErrorMessage(unauthorized),
    /Only the NexTech owner and approved admins/,
  );
});

test("an empty customer directory is an empty list, not an error", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: [], error: null });

  const customers = await getAdminCustomerDirectory();
  assert.deepEqual(customers, []);
});

test("customer records are returned correctly", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: ownerRows, error: null });

  const customers = await getAdminCustomerDirectory();

  assert.deepEqual(customers[0], {
    name: "Ayesha Khan",
    username: "ayesha",
    email: "ayesha@example.com",
    role: "customer",
    createdAt: "2026-11-01T09:30:00Z",
  });
  assert.equal(customers[1].name, "Bilal Ahmed");
});

test("sensitive or unexpected fields are dropped, never shown", () => {
  const customers = normalizeCustomerDirectory([{
    full_name: "Ayesha Khan",
    username: "ayesha",
    email: "ayesha@example.com",
    role: "customer",
    created_at: "2026-11-01T09:30:00Z",
    // Never expected from the RPC; must be dropped rather than shown if a future
    // change ever leaked them.
    id: "00000000-0000-0000-0000-000000000000",
    seller_details: { store: "secret" },
    updated_at: "2026-11-02T00:00:00Z",
    avatar_path: "avatars/x.png",
    encrypted_password: "should-never-appear",
    access_token: "should-never-appear",
  }]);

  assert.deepEqual(
    Object.keys(customers[0]).sort(),
    ["createdAt", "email", "name", "role", "username"],
  );
});

test("a missing or malformed payload renders as an empty directory", () => {
  assert.deepEqual(normalizeCustomerDirectory(undefined), []);
  assert.deepEqual(normalizeCustomerDirectory(null), []);
  assert.deepEqual(normalizeCustomerDirectory({ customers: ownerRows }), []);
});

test("search matches the customer name or username, case-insensitively", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: ownerRows, error: null });
  const customers = await getAdminCustomerDirectory();

  assert.deepEqual(filterCustomerDirectory(customers, "").map((c) => c.name), ["Ayesha Khan", "Bilal Ahmed"]);
  assert.deepEqual(filterCustomerDirectory(customers, "   ").map((c) => c.name), ["Ayesha Khan", "Bilal Ahmed"]);
  assert.deepEqual(filterCustomerDirectory(customers, "ayesha").map((c) => c.name), ["Ayesha Khan"]);
  assert.deepEqual(filterCustomerDirectory(customers, "BILAL").map((c) => c.name), ["Bilal Ahmed"]);
  assert.deepEqual(filterCustomerDirectory(customers, "khan").map((c) => c.name), ["Ayesha Khan"]);
  assert.deepEqual(filterCustomerDirectory(customers, "nobody"), []);
});

test("a database error surfaces a readable message and is not swallowed", async () => {
  rpcCalls.length = 0;
  const failure = { code: "57014", message: "canceling statement due to statement timeout" };
  rpcResponder = () => ({ data: null, error: failure });

  await assert.rejects(() => getAdminCustomerDirectory(), (error) => error === failure);
  assert.equal(getAdminCustomerDirectoryErrorMessage(failure), "canceling statement due to statement timeout");
});

test("a missing directory migration is reported as not configured, not as empty success", async () => {
  rpcCalls.length = 0;
  const missing = {
    code: "PGRST202",
    message: "Could not find the function public.admin_customer_directory",
  };
  rpcResponder = () => ({ data: null, error: missing });

  await assert.rejects(() => getAdminCustomerDirectory());
  assert.equal(isMissingAdminCustomerDirectoryError(missing), true);
  assert.equal(
    getAdminCustomerDirectoryErrorMessage(missing),
    adminCustomerDirectoryNotConfiguredMessage,
  );
});
