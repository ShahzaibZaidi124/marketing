// Tests for the Customer Report Submission path (Phase 3 — customer-facing UI).
//
// A customer may report an ACTIVE service or one of their OWN orders, once per
// target while their report is still open. The browser sends only target_type,
// target_id, category and reason: the database trigger derives reporter_id,
// target_label, status and the resolution fields, and the RLS policies enforce
// the same rules, so this module never sends or reads back an identity, a target
// label, a status, or a resolution field, and never updates or deletes.
//
// Run: node --experimental-test-module-mocks --test src/lib/reports.test.js
import assert from "node:assert/strict";
import test, { mock } from "node:test";

let insertResult = { data: null, error: null };
const insertCalls = [];

// Stands in for supabase-js: a chainable query builder that never touches the
// network.
function makeQuery() {
  const state = { columns: null, insert: null };
  const query = {
    select(columns) { state.columns = columns; return query; },
    insert(row) { state.insert = row; insertCalls.push(row); return query; },
    single() { return Promise.resolve(insertResult); },
  };
  return query;
}

mock.module(new URL("./supabase.js", import.meta.url), {
  exports: {
    getSupabaseClient: () => ({ from: () => makeQuery() }),
  },
});

const {
  formatReportTargetType,
  getReportErrorMessage,
  isDuplicateReportError,
  isMissingReportsError,
  maximumReportReasonLength,
  reportCategories,
  reportCategoryOptions,
  reportsNotConfiguredMessage,
  submitReport,
  validateReportDraft,
} = await import("./reports.js");

const reportRow = {
  id: "8f0e1d2c-3b4a-5968-7788-99aabbccddee",
  target_type: "service",
  target_id: "web-development",
  target_label: "Website Development",
  category: "fraud",
  reason: "The price changed after checkout.",
  status: "pending",
  created_at: "2026-11-25T10:00:00Z",
};

test("a report must target a service or an order", () => {
  for (const targetType of ["service", "order"]) {
    assert.equal(validateReportDraft({ targetType, targetId: "abc", category: "spam" }).error, "");
  }
  for (const targetType of ["", "user", null, undefined, "SERVICE!"]) {
    const result = validateReportDraft({ targetType, targetId: "abc", category: "spam" });
    assert.match(result.error, /must target a service or an order/);
  }
});

test("the target id is required and bounded to 120 characters", () => {
  assert.match(validateReportDraft({ targetType: "service", targetId: "  ", category: "spam" }).error, /being reported is missing/);
  assert.equal(validateReportDraft({ targetType: "service", targetId: "a".repeat(120), category: "spam" }).error, "");
  assert.match(validateReportDraft({ targetType: "service", targetId: "a".repeat(121), category: "spam" }).error, /being reported is missing/);
  assert.equal(validateReportDraft({ targetType: "order", targetId: "  11111111-2222-3333-4444-555555555555  " }).targetId, "11111111-2222-3333-4444-555555555555");
});

test("the category must be one of the five fixed values", () => {
  for (const category of reportCategories) {
    assert.equal(validateReportDraft({ targetType: "service", targetId: "abc", category }).error, "");
  }
  for (const category of ["", "harassment", "SPAM!", null, undefined]) {
    assert.match(validateReportDraft({ targetType: "service", targetId: "abc", category }).error, /Choose a report category/);
  }
  // The picker only ever offers real DB values.
  assert.deepEqual(reportCategoryOptions.map((option) => option.value).sort(), [...reportCategories].sort());
});

test("the explanation is optional, trimmed, and limited to 2,000 characters", () => {
  assert.equal(validateReportDraft({ targetType: "service", targetId: "abc", category: "spam", reason: "   " }).reason, "");
  assert.equal(validateReportDraft({ targetType: "service", targetId: "abc", category: "spam", reason: "  details  " }).reason, "details");
  assert.equal(validateReportDraft({ targetType: "service", targetId: "abc", category: "spam", reason: "a".repeat(maximumReportReasonLength) }).error, "");
  const tooLong = validateReportDraft({ targetType: "service", targetId: "abc", category: "spam", reason: "a".repeat(maximumReportReasonLength + 1) });
  assert.match(tooLong.error, /2,000 characters or fewer/);
  assert.equal(tooLong.reason, "");
});

test("submitting sends only target_type, target_id, category and reason — never an identity, label, status or resolution field", async () => {
  insertCalls.length = 0;
  insertResult = { data: reportRow, error: null };

  const created = await submitReport({
    targetType: "service",
    targetId: "  web-development  ",
    category: "fraud",
    reason: "  The price changed after checkout.  ",
  });

  assert.equal(insertCalls.length, 1);
  assert.deepEqual(Object.keys(insertCalls[0]).sort(), ["category", "reason", "target_id", "target_type"]);
  assert.deepEqual(insertCalls[0], {
    target_type: "service",
    target_id: "web-development",
    category: "fraud",
    reason: "The price changed after checkout.",
  });
  // The server-derived fields are never sent by the browser.
  assert.equal("reporter_id" in insertCalls[0], false);
  assert.equal("target_label" in insertCalls[0], false);
  assert.equal("status" in insertCalls[0], false);
  assert.equal("resolved_by" in insertCalls[0], false);
  assert.equal(created.status, "pending");
});

test("an invalid draft is rejected before any insert is attempted", async () => {
  insertCalls.length = 0;
  insertResult = { data: reportRow, error: null };

  await assert.rejects(
    () => submitReport({ targetType: "service", targetId: "", category: "spam" }),
    /being reported is missing/,
  );
  await assert.rejects(
    () => submitReport({ targetType: "service", targetId: "abc", category: "" }),
    /Choose a report category/,
  );
  await assert.rejects(
    () => submitReport({ targetType: "user", targetId: "abc", category: "spam" }),
    /must target a service or an order/,
  );
  assert.equal(insertCalls.length, 0);
});

test("a duplicate open report for the same target is detected and explained, not swallowed", async () => {
  const duplicate = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "reports_one_open_per_target_idx"',
  };
  insertCalls.length = 0;
  insertResult = { data: null, error: duplicate };

  await assert.rejects(
    () => submitReport({ targetType: "order", targetId: "11111111-2222-3333-4444-555555555555", category: "other" }),
    (error) => error === duplicate,
  );
  assert.equal(isDuplicateReportError(duplicate), true);
  assert.equal(isDuplicateReportError({ code: "42501" }), false);
  assert.match(getReportErrorMessage(duplicate), /already have an open report/);
});

test("server-side eligibility failures keep their meaning", () => {
  assert.equal(
    getReportErrorMessage({ code: "42501" }),
    "You can only report your own orders.",
  );
  assert.equal(
    getReportErrorMessage({ code: "22023", message: "The service being reported does not exist or is not active." }),
    "The service being reported does not exist or is not active.",
  );
  assert.equal(
    getReportErrorMessage({ code: "22023" }),
    "This service or order cannot be reported.",
  );
});

test("a missing reports migration is reported as not configured, not as a silent success", () => {
  const missing = { code: "PGRST205", message: "Could not find the table public.reports" };
  assert.equal(isMissingReportsError(missing), true);
  assert.equal(isMissingReportsError({ code: "23505" }), false);
  assert.equal(getReportErrorMessage(missing), reportsNotConfiguredMessage);
});

test("target type helpers render the target noun", () => {
  assert.equal(formatReportTargetType("service"), "service");
  assert.equal(formatReportTargetType("order"), "order");
  assert.equal(formatReportTargetType("user"), "target");
});

test("submitted reports cannot be edited, deleted or moderated from the client", async () => {
  const reports = await import("./reports.js");
  for (const name of Object.keys(reports)) {
    assert.doesNotMatch(name, /update|delete|remove|edit|moderate|resolve/i);
  }
});
