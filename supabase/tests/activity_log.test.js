// Static review of the persistent Activity Log migration. These tests do not
// connect to a database and do not execute SQL. They pin the security model of
// the review artifact:
//   supabase/migrations/20261126130000_add_activity_log.sql
//
//   * the log is append-only and unreadable/unwritable by clients;
//   * the ONLY writer, public.record_activity(), is not executable by the
//     authenticated or anon roles, so a browser cannot forge an entry;
//   * the reader, public.admin_activity_log(), is gated by has_admin_access()
//     (owner OR approved admin) and 42501s everyone else;
//   * the reader never selects actor_id, and no stored summary carries a setting
//     value, an email or a customer field;
//   * all six existing write paths log atomically inside their own transaction.
//
// Run: node --test supabase/tests/activity_log.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sql = readFileSync(join(migrationsDir, "20261126130000_add_activity_log.sql"), "utf8");

// The body of one function (or section), from its marker up to whichever of the
// next function / section separator / § marker comes first.
function sectionAfter(marker) {
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const from = start + marker.length;
  const candidates = [
    sql.indexOf("\ncreate or replace function", from),
    sql.indexOf("\n-- ============================================================================", from),
    sql.indexOf("\n-- §", from),
  ].filter((index) => index !== -1);
  assert.ok(candidates.length, `no section end after ${marker}`);
  return sql.slice(start, Math.min(...candidates));
}

const recordBody = sectionAfter("create or replace function public.record_activity(");
const readBody = sectionAfter("create or replace function public.admin_activity_log(");

const actionFunctions = [
  "create or replace function public.create_service_category(",
  "create or replace function public.update_service_category(",
  "create or replace function public.delete_service_category(",
  "create or replace function public.reassign_service_category(",
  "create or replace function public.update_platform_settings(",
  "create or replace function public.review_admin_application(",
];

test("the log is one append-only table with the reviewed shape", () => {
  assert.equal(sql.match(/create table public\.activity_log\b/g)?.length, 1);
  assert.match(sql, /id\s+bigint generated always as identity primary key/);
  // The actor is recorded for audit but is nullable (ON DELETE SET NULL keeps the
  // row when the account goes away).
  assert.match(sql, /actor_id\s+uuid references auth\.users\(id\) on delete set null/);
  assert.match(sql, /actor_role\s+text not null check \(actor_role in \('owner', 'admin'\)\)/);
  assert.match(sql, /created_at\s+timestamptz not null default clock_timestamp\(\)/);

  // Newest-first reads are the only access pattern.
  assert.match(sql, /create index activity_log_created_at_idx\s*\n\s*on public\.activity_log \(created_at desc, id desc\)/);
});

test("the table allows exactly the seven reviewed actions and no others", () => {
  for (const action of [
    "admin_application.approved",
    "admin_application.rejected",
    "category.created",
    "category.updated",
    "category.deleted",
    "category.reassigned",
    "settings.updated",
  ]) {
    assert.match(sql, new RegExp(`'${action.replace(/\./g, "\\.")}'`));
  }
  // The CHECK enumerates them; there is no open-ended text action column.
  assert.match(sql, /action\s+text not null check \(action in \(/);
});

test("RLS is on with no policy, and NO role has any direct table privilege", () => {
  assert.match(sql, /alter table public\.activity_log enable row level security;/);
  // Least privilege: no role — not even service_role — gets a direct table grant.
  // The only writer is the postgres-owned SECURITY DEFINER functions, which act as
  // the table owner and need no explicit privilege.
  assert.match(sql, /revoke all on public\.activity_log from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete|all) on public\.activity_log\b/i);
  // The migration creates no RLS policy at all: a policy-less table denies clients.
  assert.doesNotMatch(sql, /create policy/);
});

test("record_activity is the only writer, derives the role, and is not callable by clients", () => {
  assert.match(recordBody, /security definer/i);
  assert.match(recordBody, /set search_path = ''/);
  // Actor and role are derived server-side; the caller cannot supply a role (the
  // signature has no role parameter at all).
  assert.match(recordBody, /coalesce\(p_actor, \(select auth\.uid\(\)\)\)/);
  assert.doesNotMatch(recordBody, /p_role/);
  // The role comes ONLY from the membership tables: owner → 'owner'; otherwise a
  // matching approved admin_accounts row → 'admin'; otherwise 42501.
  assert.match(recordBody, /from public\.owner_accounts o where o\.user_id = v_actor/);
  assert.match(recordBody, /v_role := 'owner'/);
  assert.match(recordBody, /from public\.admin_accounts a where a\.user_id = v_actor/);
  assert.match(recordBody, /v_role := 'admin'/);
  const refuseAt = recordBody.indexOf("v_role := 'admin'");
  assert.ok(
    recordBody.indexOf("errcode = '42501'") > refuseAt,
    "an actor who is neither the owner nor an approved admin must be refused with 42501",
  );

  // It refuses junk input rather than writing a half-record.
  assert.match(recordBody, /An activity actor is required\./);
  assert.match(recordBody, /An activity summary is required\./);
  assert.match(recordBody, /errcode = '22023'/);

  // NO grant to a client role; the default PUBLIC grant is revoked.
  assert.match(sql, /revoke all on function public\.record_activity\(uuid, text, text, text, text\) from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /grant execute on function public\.record_activity\(/);
});

test("admin_activity_log is gated by has_admin_access and 42501s everyone else", () => {
  assert.match(readBody, /security definer/i);
  assert.match(readBody, /set search_path = ''/);
  const gate = readBody.indexOf("public.has_admin_access()");
  assert.ok(gate > -1, "the reader must call has_admin_access()");
  assert.match(readBody, /if not public\.has_admin_access\(\) then/);
  assert.match(readBody, /errcode = '42501'/);
  // Anon may not reach it; authenticated may (the gate still applies).
  assert.match(sql, /revoke all on function public\.admin_activity_log\(int, int, text, text\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.admin_activity_log\(int, int, text, text\) to authenticated, service_role;/);
});

test("the reader is newest-first, paginated, and never returns actor identity", () => {
  assert.match(readBody, /order by l\.created_at desc, l\.id desc/);
  assert.match(readBody, /greatest\(1, least\(coalesce\(p_limit, 50\), 200\)\)/);
  assert.match(readBody, /greatest\(0, coalesce\(p_offset, 0\)\)/);
  // Filters: exact action, and actor role limited to the two role words.
  assert.match(readBody, /l\.action = v_action/);
  assert.match(readBody, /l\.actor_role = v_role/);
  assert.match(readBody, /v_role not in \('owner', 'admin'\)/);

  // actor_id is NEVER selected — the actor identity cannot be exposed.
  assert.doesNotMatch(readBody, /actor_id/);
  // Only the reviewed display fields are projected.
  for (const field of ["id", "action", "actor_role", "target_type", "target_id", "summary", "created_at"]) {
    assert.match(readBody, new RegExp(`l\\.${field}`));
  }
});

test("all six write paths log atomically inside their own function", () => {
  for (const signature of actionFunctions) {
    const body = sectionAfter(signature);
    const gateAt = Math.max(body.indexOf("public.has_admin_access()"), body.indexOf("public.is_owner()"), body.indexOf("public.owner_accounts"));
    const writeAt = body.search(/insert into|update public\.|delete from/);
    const logAt = body.indexOf("perform public.record_activity(");

    assert.ok(writeAt > -1, `${signature} should perform a mutation`);
    assert.ok(logAt > -1, `${signature} must call public.record_activity()`);
    assert.ok(gateAt > -1, `${signature} must keep its authorization gate`);

    // Authorization first, then the mutation, then the log — in that order, in the
    // same transaction body (so a failed log rolls the action back).
    assert.ok(gateAt < writeAt, `${signature} must authorize before it writes`);
    assert.ok(writeAt < logAt, `${signature} must log after the mutation succeeds`);

    // The reviewed denial error is intact.
    assert.match(body, /errcode = '42501'/);
  }
});

test("no stored summary leaks a setting value, an email or a customer field", () => {
  // Platform settings: a fixed, value-free sentence — never the field values.
  const settingsBody = sectionAfter("create or replace function public.update_platform_settings(");
  assert.match(settingsBody, /'Updated platform settings\.'/);
  const settingsLog = settingsBody.slice(settingsBody.indexOf("perform public.record_activity("));
  assert.doesNotMatch(settingsLog, /v_name|v_desc|v_contact|v_support/);

  // Admin application: only the opaque id, never the applicant's name or email.
  const applicationBody = sectionAfter("create or replace function public.review_admin_application(");
  assert.match(applicationBody, /left\(v_app\.id::text, 8\)/);
  assert.doesNotMatch(applicationBody, /applicant_name|applicant_email|v_app\.email/);
  const applicationLog = applicationBody.slice(applicationBody.indexOf("perform public.record_activity("));
  assert.doesNotMatch(applicationLog, /applicant_name|applicant_email/);
});

test("postconditions and preservation guards are present", () => {
  assert.match(sql, /-- §7  Postconditions/);
  assert.match(sql, /§7\.2 failed: no role may hold % on public\.activity_log/);
  assert.match(sql, /§7\.4 failed: the authenticated role must not be able to EXECUTE record_activity\(\)\./);
  assert.match(sql, /§7\.5 failed: % does not call public\.record_activity\(\)\./);
  assert.match(sql, /§7\.6 failed: admin_activity_log\(\) allowed a non-admin caller\./);
  assert.match(sql, /§7\.7 failed: public\.owner_accounts must not have gained any RLS policy\./);

  // Prerequisite guard fails closed instead of silently creating a schema.
  assert.match(sql, /§1\.3 failed: % is missing\. Apply its migration before this one\./);
});
