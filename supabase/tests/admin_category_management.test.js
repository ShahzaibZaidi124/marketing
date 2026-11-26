// Static review of the category migrations. These tests do not connect to a
// database and do not execute SQL. They pin the authorization, validation and
// delete-guard assumptions in the review artifacts:
//   supabase/migrations/20261125200000_add_service_categories.sql
//   supabase/migrations/20261125210000_add_admin_category_management.sql
//
// Run: node --test supabase/tests/admin_category_management.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const tableSql = readFileSync(join(migrationsDir, "20261125200000_add_service_categories.sql"), "utf8");
const rpcSql = readFileSync(join(migrationsDir, "20261125210000_add_admin_category_management.sql"), "utf8");

function functionBody(sql, signatureStart) {
  const start = sql.indexOf(signatureStart);
  assert.notEqual(start, -1, `missing ${signatureStart}`);
  const next = sql.indexOf("\n-- ============================================================================", start + signatureStart.length);
  assert.notEqual(next, -1, `missing the section after ${signatureStart}`);
  return sql.slice(start, next);
}

const seededCategoryIds = [
  "business-websites",
  "ecommerce-websites",
  "portfolio-websites",
  "restaurant-websites",
  "landing-pages",
  "wordpress-development",
  "blog-websites",
  "custom-react-websites",
];

test("categories are one table, with the existing ids preserved and names unique", () => {
  assert.equal(tableSql.match(/create table public\.categories\b/g)?.length, 1);
  assert.equal(rpcSql.includes("create table"), false);
  assert.match(tableSql, /create unique index categories_name_lower_key/);
  assert.match(tableSql, /on public\.categories \(lower\(btrim\(name\)\)\)/);
  assert.match(tableSql, /on delete restrict/i);
  for (const id of seededCategoryIds) {
    assert.match(tableSql, new RegExp(`'${id}'`));
  }
  assert.doesNotMatch(tableSql, /drop table/i);
  assert.doesNotMatch(tableSql, /delete from public\.services/i);
});

test("customers can read categories and cannot write them directly", () => {
  assert.match(tableSql, /grant select on public\.categories to authenticated/);
  assert.match(tableSql, /revoke all on public\.categories from public, anon, authenticated/);
  assert.doesNotMatch(tableSql, /grant insert on public\.categories to authenticated/i);
  assert.doesNotMatch(tableSql, /grant update on public\.categories to authenticated/i);
  assert.doesNotMatch(tableSql, /grant delete on public\.categories to authenticated/i);
  assert.match(tableSql, /create policy "Authenticated users can view active categories"/);
  assert.match(tableSql, /using \(is_active\)/);
  assert.match(tableSql, /create policy "Owners can read all categories"/);
  assert.doesNotMatch(tableSql, /for insert/i);
  assert.doesNotMatch(tableSql, /for update/i);
  assert.doesNotMatch(tableSql, /for delete/i);
  assert.doesNotMatch(tableSql, /grant\s+(select|insert|update|delete|all)\s+on\s+public\.categories\s+to\s+anon/i);
});

test("every category RPC authorizes with has_admin_access before it writes", () => {
  const signatures = [
    "create or replace function public.admin_service_categories()",
    "create or replace function public.create_service_category(",
    "create or replace function public.update_service_category(",
    "create or replace function public.delete_service_category(p_id text)",
    "create or replace function public.reassign_service_category(",
  ];

  for (const signature of signatures) {
    const body = functionBody(rpcSql, signature);
    const gate = body.indexOf("public.has_admin_access()");
    assert.ok(gate > -1, `${signature} must call has_admin_access()`);
    assert.match(body, /errcode = '42501'/);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = ''/);

    for (const mutation of ["insert into", "update public.", "delete from"]) {
      const writeAt = body.toLowerCase().indexOf(mutation);
      if (writeAt !== -1) {
        assert.ok(gate < writeAt, `${signature} must check access before ${mutation}`);
      }
    }
  }
});

test("duplicate names, dependent services and anonymous execute are refused", () => {
  const createBody = functionBody(rpcSql, "create or replace function public.create_service_category(");
  const updateBody = functionBody(rpcSql, "create or replace function public.update_service_category(");
  const deleteBody = functionBody(rpcSql, "create or replace function public.delete_service_category(p_id text)");
  const reassignBody = functionBody(rpcSql, "create or replace function public.reassign_service_category(");

  assert.match(createBody, /A category with that name already exists\./);
  assert.match(createBody, /errcode = '23505'/);
  assert.match(updateBody, /A category with that name already exists\./);
  assert.match(updateBody, /c\.id <> p_id/);
  assert.match(deleteBody, /errcode = '23503'/);
  assert.match(deleteBody, /from public\.services/);
  assert.match(deleteBody, /delete from public\.categories where id = p_id/);
  assert.match(reassignBody, /set category_id = p_to_id/);
  assert.match(reassignBody, /where category_id = p_from_id/);

  assert.match(rpcSql, /revoke all on function public\.create_service_category\(text, text, text\) from public, anon/);
  assert.match(rpcSql, /grant execute on function public\.create_service_category\(text, text, text\) to authenticated/);
  assert.doesNotMatch(rpcSql, /grant execute on function public\.\w+ to anon/i);
  assert.doesNotMatch(rpcSql, /grant insert on public\.categories/i);
  assert.doesNotMatch(rpcSql, /grant update on public\.categories/i);
  assert.doesNotMatch(rpcSql, /grant delete on public\.categories/i);
});

test("a missing category or a write from an ordinary customer is an error path, not a silent success", () => {
  for (const signature of [
    "create or replace function public.create_service_category(",
    "create or replace function public.update_service_category(",
    "create or replace function public.delete_service_category(p_id text)",
  ]) {
    const body = functionBody(rpcSql, signature);
    assert.match(body, /using errcode = '22023'/);
    assert.match(body, /Only the NexTech owner and approved admins can manage categories\./);
  }

  assert.match(functionBody(rpcSql, "create or replace function public.update_service_category("), /errcode = 'P0002'/);
  assert.match(functionBody(rpcSql, "create or replace function public.delete_service_category(p_id text)"), /errcode = 'P0002'/);
  assert.match(rpcSql, /The category directory is available to the owner and approved admins only\./);
});

test("the only extra service mapping is the guarded, reviewed landing-page change", () => {
  // The exact-ID backfill is retained.
  assert.match(tableSql, /where s\.category_id is null\s*\n\s*and s\.id = c\.id/);

  // Exactly one explicit literal mapping exists, and it is the reviewed one.
  const literalMappings = tableSql.match(/set category_id = '[^']+'/gi) ?? [];
  assert.deepEqual(
    literalMappings.map((entry) => entry.replace(/\s+/g, " ").toLowerCase()),
    ["set category_id = 'landing-pages'"],
  );

  // It is guarded: only when the row is still unassigned and the target exists.
  assert.match(tableSql, /where s\.id = 'landing-page'/);
  assert.match(tableSql, /and s\.category_id is null/);
  assert.match(tableSql, /and exists \(select 1 from public\.categories c where c\.id = 'landing-pages'\)/);

  // website-development is never assigned, and no mapping is name/keyword based.
  assert.doesNotMatch(tableSql, /set category_id = 'website-development'/i);
  assert.doesNotMatch(tableSql, /where[^;]*s\.name[^;]*=/i);

  // The foreign key stays ON DELETE RESTRICT.
  assert.match(tableSql, /references public\.categories \(id\) on delete restrict/i);

  // The mapping postcondition is present and does not require every service to
  // be assigned.
  assert.match(tableSql, /landing-page must be mapped to landing-pages/);
  assert.match(tableSql, /website-development must remain unassigned/);
  assert.match(tableSql, /does NOT assume every service has a category/i);
});

test("the categories.id slug CHECK accepts the seeded ids and rejects invalid slugs", () => {
  const constraint = tableSql.match(/id\s+text primary key check \(id ~ '([^']+)'\)/);
  assert.ok(constraint, "the categories.id slug CHECK constraint should be present");
  const slugPattern = new RegExp(constraint[1]);

  for (const id of seededCategoryIds) {
    assert.ok(slugPattern.test(id), `the slug CHECK must accept the seeded id ${id}`);
  }

  for (const invalid of [
    "",
    "-landing-pages",
    "landing-pages-",
    "Landing-Pages",
    "landing_pages",
    "landing pages",
    "a".repeat(121),
  ]) {
    assert.ok(!slugPattern.test(invalid), `the slug CHECK must reject ${JSON.stringify(invalid)}`);
  }

  // 120 characters is the documented maximum and must still be accepted.
  assert.ok(slugPattern.test("a".repeat(120)));
});

test("the unmatched-service report runs after both backfill steps", () => {
  // The exact-id backfill (§2.4) and the explicit mapping (§2.4b) must both
  // precede the final report (§2.4c).
  assert.ok(tableSql.indexOf("§2.4b") < tableSql.indexOf("§2.4c"), "§2.4c must follow §2.4b");
  assert.match(tableSql, /raise notice '§2\.4c:/);
  // The old, premature report label is gone.
  assert.doesNotMatch(tableSql, /raise notice '§2\.4:/);
});

// The normalizer is what the §8 postconditions lean on to make a function body
// comparable. These tests pin the properties that make it correct on real
// PostgreSQL: it removes only real comments, keeps comment-like text that sits
// inside quoted strings, and uses escape-free ARE patterns. Behaviour on the
// actual engine is checked separately; a Node-only regex test cannot prove it.
const normBody = functionBody(rpcSql, "create or replace function pg_temp.norm_sql(input text)");

test("pg_temp.norm_sql scans for comments instead of regex-stripping them blindly", () => {
  // It is a real scan, not the old single regexp_replace chain over raw text.
  assert.match(normBody, /language plpgsql/i);
  assert.equal(
    normBody.match(/regexp_replace\(/g)?.length,
    1,
    "only the whitespace collapse may use regexp_replace",
  );
  assert.doesNotMatch(normBody, /'\/\\\*/, "the old blind block-comment regex must be gone");

  // --  line comments, ended with chr(10) (never a backslash-escaped \n)
  assert.match(normBody, /v_ch = '-' and substr\(v_src, v_i \+ 1, 1\) = '-'/);
  assert.match(normBody, /<> chr\(10\)/);
  assert.doesNotMatch(normBody, /\\n/);

  // /* */  block comments, honouring PostgreSQL's nesting rule
  assert.match(normBody, /v_ch = '\/' and substr\(v_src, v_i \+ 1, 1\) = '\*'/);
  assert.match(normBody, /v_depth := 1/);
  assert.match(normBody, /v_depth := v_depth \+ 1/);

  // The postconditions must keep calling it the same way.
  assert.match(rpcSql, /pg_temp\.norm_sql\(v_live\.prosrc\)/);
});

test("pg_temp.norm_sql keeps comment-like text inside strings, identifiers and dollar quotes", () => {
  // single-quoted literal, with '' treated as an escaped quote
  assert.match(normBody, /if v_ch = '''' then/);
  assert.match(normBody, /substr\(v_src, v_i \+ 1, 1\) = ''''/);

  // double-quoted identifier, with "" treated as an escaped quote
  assert.match(normBody, /elsif v_ch = '"' then/);
  assert.match(normBody, /substr\(v_src, v_i \+ 1, 1\) = '"'/);

  // dollar-quoted body: $tag$ ... $tag$ (and bare $$ ... $$)
  assert.match(normBody, /v_tag := '\$\$'/);
  assert.match(normBody, /substr\(v_src, v_i, v_j - v_i \+ 1\)/);

  // The copied regions are emitted verbatim, so a literal such as
  // 'a -- b' or '/* c */' survives instead of being mistaken for a comment.
  // (characters are appended, one at a time, never handed to a comment stripper)
  assert.match(normBody, /v_out := v_out \|\| v_ch;/);
  assert.match(normBody, /v_out := v_out \|\| substr\(v_src, v_i, 1\);/);
});

test("pg_temp.norm_sql collapses whitespace with escape-free ARE patterns", () => {
  // POSIX class, no backslash: unaffected by standard_conforming_strings.
  assert.match(normBody, /regexp_replace\(v_out, '\[\[:space:\]\]\+', ' ', 'g'\)/);
  assert.match(normBody, /return btrim\(regexp_replace\(v_out/);

  // No backslash escapes anywhere in its patterns.
  assert.doesNotMatch(normBody, /\\s/);
  assert.doesNotMatch(normBody, /\\\*/);
});


