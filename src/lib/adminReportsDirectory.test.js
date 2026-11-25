// Tests for the Admin Reports (reports directory) read path.
//
// The directory is read through ONE read-only RPC, public.admin_reports_directory(),
// which authorizes the caller server-side with has_admin_access() (owner OR
// approved admin) and returns only the report display fields. It never returns
// the reporter identity (reporter_id), the resolver identity (resolved_by) or any
// resolution field.
//
// Run: node --experimental-test-module-mocks --test src/lib/adminReportsDirectory.test.js
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
  adminReportsDirectoryNotConfiguredMessage,
  filterAdminReports,
  formatReportCategory,
  formatReportStatus,
  formatReportTargetType,
  getAdminReportsDirectory,
  getAdminReportsDirectoryErrorMessage,
  isMissingAdminReportsDirectoryError,
  normalizeAdminReports,
} = await import("./adminReportsDirectory.js");

const reportRows = [
  {
    id: "0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    target_type: "service",
    target_label: "Web development",
    category: "spam",
    reason: "The listing advertises work that was never delivered.",
    status: "pending",
    created_at: "2026-11-23T09:30:00Z",
  },
  {
    id: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    target_type: "order",
    target_label: "SEO audit",
    category: "fraud",
    reason: "Payment was requested off-platform.",
    status: "resolved",
    created_at: "2026-11-24T15:00:00Z",
  },
];

test("the owner reads the live reports directory", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reportRows, error: null });

  const reports = await getAdminReportsDirectory();

  assert.equal(reports.length, 2);
  assert.equal(reports[0].targetType, "service");
  assert.equal(reports[0].targetLabel, "Web development");
  assert.equal(reports[0].category, "spam");
  assert.equal(reports[0].status, "pending");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_reports_directory");
});

test("an approved admin uses the same server gate and sends no identity or role", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reportRows, error: null });

  const reports = await getAdminReportsDirectory();

  assert.equal(reports.length, 2);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_reports_directory");
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
    message: "The reports directory is available to the owner and approved admins only.",
  };
  rpcResponder = () => ({ data: null, error: unauthorized });

  await assert.rejects(() => getAdminReportsDirectory(), (error) => error === unauthorized);
  assert.equal(isMissingAdminReportsDirectoryError(unauthorized), false);
  assert.match(
    getAdminReportsDirectoryErrorMessage(unauthorized),
    /Only the NexTech owner and approved admins/,
  );
});

test("an empty reports directory is an empty list, not an error", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: [], error: null });

  const reports = await getAdminReportsDirectory();
  assert.deepEqual(reports, []);
});

test("report records are returned correctly", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reportRows, error: null });

  const reports = await getAdminReportsDirectory();

  assert.deepEqual(reports[0], {
    id: "0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    targetType: "service",
    targetLabel: "Web development",
    category: "spam",
    reason: "The listing advertises work that was never delivered.",
    status: "pending",
    createdAt: "2026-11-23T09:30:00Z",
  });
  assert.equal(reports[1].status, "resolved");
});

test("reporter and resolver identities and resolution fields are dropped, never shown", () => {
  const reports = normalizeAdminReports([{
    id: "0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    target_type: "service",
    target_label: "Web development",
    category: "spam",
    reason: "The listing advertises work that was never delivered.",
    status: "pending",
    created_at: "2026-11-23T09:30:00Z",
    // Never expected from the RPC; must be dropped rather than shown if a future
    // change ever leaked them.
    reporter_id: "should-be-ignored",
    resolved_by: "should-be-ignored",
    resolved_at: "2026-11-24T00:00:00Z",
    resolution_note: "should-be-ignored",
    target_id: "should-be-ignored",
    updated_at: "2026-11-24T00:00:00Z",
    email: "reporter@example.com",
    access_token: "should-never-appear",
  }]);

  assert.deepEqual(
    Object.keys(reports[0]).sort(),
    ["category", "createdAt", "id", "reason", "status", "targetLabel", "targetType"],
  );
});

test("a missing or malformed payload renders as an empty directory", () => {
  assert.deepEqual(normalizeAdminReports(undefined), []);
  assert.deepEqual(normalizeAdminReports(null), []);
  assert.deepEqual(normalizeAdminReports({ reports: reportRows }), []);
});

test("target type, category and status are formatted from the real values only", () => {
  assert.equal(formatReportTargetType("service"), "Service");
  assert.equal(formatReportTargetType("order"), "Order");
  assert.equal(formatReportTargetType("user"), "Unknown target");

  assert.equal(formatReportCategory("spam"), "Spam");
  assert.equal(formatReportCategory("inappropriate"), "Inappropriate");
  assert.equal(formatReportCategory("not-a-category"), "Other");

  assert.equal(formatReportStatus("pending"), "Pending");
  assert.equal(formatReportStatus("reviewing"), "Reviewing");
  assert.equal(formatReportStatus("resolved"), "Resolved");
  assert.equal(formatReportStatus("rejected"), "Rejected");
  // A status outside the real set (including the retired 'open') falls back to
  // the state every new report starts in.
  assert.equal(formatReportStatus("open"), "Pending");
  assert.equal(formatReportStatus("not-a-status"), "Pending");
});

test("an optional (empty) reason stays an empty string and does not break search", async () => {
  rpcCalls.length = 0;
  const rows = [
    { ...reportRows[0], reason: "" },
    reportRows[1],
  ];
  rpcResponder = () => ({ data: rows, error: null });
  const reports = await getAdminReportsDirectory();

  assert.equal(reports[0].reason, "");
  assert.deepEqual(filterAdminReports(reports, {}).map((r) => r.id), [rows[0].id, rows[1].id]);
  assert.deepEqual(filterAdminReports(reports, { query: "web" }).map((r) => r.id), [rows[0].id]);
});

test("search matches the target label, category, reason or target type, case-insensitively", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reportRows, error: null });
  const reports = await getAdminReportsDirectory();

  assert.equal(filterAdminReports(reports, {}).length, 2);
  assert.deepEqual(filterAdminReports(reports, { query: "web" }).map((r) => r.id), [reportRows[0].id]);
  assert.deepEqual(filterAdminReports(reports, { query: "off-platform" }).map((r) => r.id), [reportRows[1].id]);
  assert.deepEqual(filterAdminReports(reports, { query: "fraud" }).map((r) => r.id), [reportRows[1].id]);
  assert.deepEqual(filterAdminReports(reports, { query: "service" }).map((r) => r.id), [reportRows[0].id]);
  assert.deepEqual(filterAdminReports(reports, { query: "nobody" }), []);
});

test("status filter uses the real status field only", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reportRows, error: null });
  const reports = await getAdminReportsDirectory();

  assert.deepEqual(filterAdminReports(reports, { status: "pending" }).map((r) => r.id), [reportRows[0].id]);
  assert.deepEqual(filterAdminReports(reports, { status: "resolved" }).map((r) => r.id), [reportRows[1].id]);
  assert.equal(filterAdminReports(reports, { status: "all" }).length, 2);
  // A value that is not a real status must not filter anything out (falls back
  // to "all").
  assert.equal(filterAdminReports(reports, { status: "open" }).length, 2);
  assert.equal(filterAdminReports(reports, { status: "closed" }).length, 2);
});

test("search and status filter combine", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reportRows, error: null });
  const reports = await getAdminReportsDirectory();

  assert.deepEqual(filterAdminReports(reports, { query: "web", status: "resolved" }), []);
  assert.deepEqual(
    filterAdminReports(reports, { query: "web", status: "pending" }).map((r) => r.id),
    [reportRows[0].id],
  );
});

test("a database error surfaces a readable message and is not swallowed", async () => {
  rpcCalls.length = 0;
  const failure = { code: "57014", message: "canceling statement due to statement timeout" };
  rpcResponder = () => ({ data: null, error: failure });

  await assert.rejects(() => getAdminReportsDirectory(), (error) => error === failure);
  assert.equal(getAdminReportsDirectoryErrorMessage(failure), "canceling statement due to statement timeout");
});

test("a missing directory migration is reported as not configured, not as empty success", async () => {
  rpcCalls.length = 0;
  const missing = {
    code: "PGRST202",
    message: "Could not find the function public.admin_reports_directory",
  };
  rpcResponder = () => ({ data: null, error: missing });

  await assert.rejects(() => getAdminReportsDirectory());
  assert.equal(isMissingAdminReportsDirectoryError(missing), true);
  assert.equal(
    getAdminReportsDirectoryErrorMessage(missing),
    adminReportsDirectoryNotConfiguredMessage,
  );
});
