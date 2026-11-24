import assert from "node:assert/strict";
import test from "node:test";

// Regression test for §8.5b2 of
// supabase/migrations/20261124120000_add_admin_access.sql.
//
// §8.5b2 reads the WITH CHECK clause of the
// "Applicants create their own pending admin application" INSERT policy out of
// pg_policies and asserts it pins the caller identity and a pending, decision-free
// row. PostgreSQL renders that policy as (real output from the failing run):
//
//   ((SELECT auth.uid() AS uid) = applicant_id)
//   AND status = 'pending'
//   AND reviewed_by IS NULL
//   AND reviewed_at IS NULL
//   AND decision_reason IS NULL
//
// The assertion normalizes the predicate with `regexp_replace(lower(...), '\s',
// '', 'g')` and then requires six fragments. An earlier revision compacted with
// '[\s()]' instead, which stripped the parentheses out of the function call
// `auth.uid()`, so the `auth.uid()` fragment could never be found and a perfectly
// valid policy failed the postcondition. These tests pin the whitespace-only
// normalization and prove the weakened forms are still rejected.

const RENDERED_POLICY = [
  "((SELECT auth.uid() AS uid) = applicant_id)",
  "AND status = 'pending'",
  "AND reviewed_by IS NULL",
  "AND reviewed_at IS NULL",
  "AND decision_reason IS NULL",
].join("\n");

const RAW_POLICY =
  "(select auth.uid()) = applicant_id and status = 'pending' " +
  "and reviewed_by is null and reviewed_at is null and decision_reason is null";

// The fragments required by §8.5b2, written in their compacted (whitespace-free,
// lower-case) form.
const REQUIRED_FRAGMENTS = [
  "auth.uid()",
  "=applicant_id",
  "status='pending'",
  "reviewed_byisnull",
  "reviewed_atisnull",
  "decision_reasonisnull",
];

// Mirrors the migration: regexp_replace(lower(v_check), '\s', '', 'g').
function compactPredicate(value) {
  return String(value).toLowerCase().replace(/\s/g, "");
}

function policyPinsIdentityAndPending(value) {
  const compact = compactPredicate(value);
  return REQUIRED_FRAGMENTS.every((fragment) => compact.includes(fragment));
}

test("accepts the PostgreSQL-rendered applicant INSERT policy", () => {
  assert.equal(policyPinsIdentityAndPending(RENDERED_POLICY), true);
});

test("accepts the raw CREATE POLICY predicate", () => {
  assert.equal(policyPinsIdentityAndPending(RAW_POLICY), true);
});

test("still rejects a policy that drops the identity condition", () => {
  const withoutIdentity =
    "status = 'pending' and reviewed_by is null and reviewed_at is null " +
    "and decision_reason is null";
  assert.equal(policyPinsIdentityAndPending(withoutIdentity), false);
});

test("still rejects a policy that drops or inverts a security condition", () => {
  const notNull =
    "((SELECT auth.uid() AS uid) = applicant_id) and status = 'pending' " +
    "and reviewed_by IS NOT NULL and reviewed_at is null and decision_reason is null";
  assert.equal(policyPinsIdentityAndPending(notNull), false);

  const approved =
    "((SELECT auth.uid() AS uid) = applicant_id) and status = 'approved' " +
    "and reviewed_by is null and reviewed_at is null and decision_reason is null";
  assert.equal(policyPinsIdentityAndPending(approved), false);

  const otherApplicant =
    "((SELECT auth.uid() AS uid) = other_user_id) and status = 'pending' " +
    "and reviewed_by is null and reviewed_at is null and decision_reason is null";
  assert.equal(policyPinsIdentityAndPending(otherApplicant), false);
});

test("the old parenthesis-stripping compaction is what broke the identity check", () => {
  const stripParens = (value) => String(value).toLowerCase().replace(/[\s()]/g, "");
  assert.equal(stripParens(RENDERED_POLICY).includes("auth.uid()"), false);
  assert.equal(compactPredicate(RENDERED_POLICY).includes("auth.uid()"), true);
});
