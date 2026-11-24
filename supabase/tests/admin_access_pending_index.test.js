import assert from "node:assert/strict";
import test from "node:test";

// Regression test for §8.6 of
// supabase/migrations/20261124120000_add_admin_access.sql.
//
// §8.6 verifies the partial unique index that prevents one applicant from having
// more than one pending application:
//
//   create unique index admin_applications_pending_unique_idx
//     on public.admin_applications (applicant_id)
//     where status = 'pending';
//
// PostgreSQL stores/renders that predicate via pg_get_expr with an implicit cast
// because the literal is coerced to the (text) column type, so pg_policies /
// pg_index reports:
//
//   (status = 'pending'::text)
//
// The original §8.6 assertion stripped only whitespace, parentheses and quotes,
// leaving `status=pending::text`, which never equals `status=pending`, so the
// postcondition failed for a correct index. These tests pin the fixed
// normalization (strip the harmless cast first, then whitespace/parentheses/
// quotes) against the exact rendered predicate and confirm weakened or wrong
// predicates are still rejected.

// Mirrors the migration:
//   regexp_replace(regexp_replace(lower(v_where), '::\s*[a-z_][a-z0-9_]*', '', 'g'),
//                  '[\s()'']', '', 'g') = 'status=pending'
function compactIndexPredicate(value) {
  return String(value)
    .toLowerCase()
    .replace(/::\s*[a-z_][a-z0-9_]*/g, "")
    .replace(/[\s()']/g, "");
}

function isPendingPartialPredicate(value) {
  return compactIndexPredicate(value) === "status=pending";
}

test("accepts the PostgreSQL-rendered predicate with an implicit cast", () => {
  assert.equal(isPendingPartialPredicate("(status = 'pending'::text)"), true);
});

test("accepts equivalent renderings without the cast", () => {
  assert.equal(isPendingPartialPredicate("status = 'pending'"), true);
  assert.equal(isPendingPartialPredicate("(status = 'pending')"), true);
  assert.equal(isPendingPartialPredicate("((status = 'pending'::text))"), true);
  assert.equal(isPendingPartialPredicate("STATUS = 'PENDING'::text"), true);
});

test("rejects a predicate on a different status value", () => {
  assert.equal(isPendingPartialPredicate("(status = 'approved'::text)"), false);
  assert.equal(isPendingPartialPredicate("(status = 'rejected')"), false);
});

test("rejects a negated or redeclared comparison", () => {
  assert.equal(isPendingPartialPredicate("(status <> 'pending'::text)"), false);
  assert.equal(isPendingPartialPredicate("(status is not null)"), false);
});

test("rejects a predicate that adds or widens conditions", () => {
  assert.equal(
    isPendingPartialPredicate("(status = 'pending'::text) AND (reviewed_by IS NULL)"),
    false,
  );
  assert.equal(isPendingPartialPredicate("(status = 'pending'::text) OR true"), false);
  assert.equal(isPendingPartialPredicate("lower(status) = 'pending'::text"), false);
});

test("rejects a missing predicate (an unconditional unique index)", () => {
  assert.equal(isPendingPartialPredicate(""), false);
  assert.equal(isPendingPartialPredicate(null), false);
});
