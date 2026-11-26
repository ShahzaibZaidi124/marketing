// Review of the Activity Log data layer. Pure functions are exercised directly;
// the one network call is pinned at the source level (no DOM test runner and no
// database are available, matching the rest of the suite).
//
// Run: node --test src/lib/adminActivityLog.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  adminActivityLogNotConfiguredMessage,
  formatActivityAction,
  formatActivityActorRole,
  formatActivityTime,
  getAdminActivityLogErrorMessage,
  isMissingAdminActivityLogError,
  normalizeActivityEntries,
} from "./adminActivityLog.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "adminActivityLog.js"), "utf8");

test("activity rows are normalized to the displayed fields, and actor id is dropped", () => {
  const rows = normalizeActivityEntries([
    {
      id: 7,
      action: "category.created",
      actor_role: "admin",
      target_type: "category",
      target_id: "web-design",
      summary: 'Created category "Web design".',
      created_at: "2026-11-26T10:00:00.000Z",
      // Fields the RPC must never expose. If one ever slipped through, it must not
      // reach the UI.
      actor_id: "9f1c0b1e-0000-0000-0000-000000000000",
      email: "someone@example.com",
      website_name: "NexTech",
    },
  ]);

  assert.deepEqual(rows, [{
    id: 7,
    action: "category.created",
    actorRole: "admin",
    targetType: "category",
    targetId: "web-design",
    summary: 'Created category "Web design".',
    createdAt: "2026-11-26T10:00:00.000Z",
  }]);

  // Explicitly: no actor id, no email, no settings value survives normalization.
  assert.equal("actor_id" in rows[0], false);
  assert.equal("email" in rows[0], false);
  assert.equal("website_name" in rows[0], false);
});

test("a missing or renamed field normalizes to an empty value, never undefined", () => {
  assert.deepEqual(normalizeActivityEntries(undefined), []);
  assert.deepEqual(normalizeActivityEntries(null), []);
  assert.deepEqual(normalizeActivityEntries("nope"), []);
  assert.deepEqual(normalizeActivityEntries([{}]), [{
    id: "",
    action: "",
    actorRole: "",
    targetType: "",
    targetId: "",
    summary: "",
    createdAt: null,
  }]);
});

test("actions and actor roles render as readable labels", () => {
  assert.equal(formatActivityAction("admin_application.approved"), "Admin approved");
  assert.equal(formatActivityAction("admin_application.rejected"), "Admin rejected");
  assert.equal(formatActivityAction("category.created"), "Category created");
  assert.equal(formatActivityAction("category.updated"), "Category updated");
  assert.equal(formatActivityAction("category.deleted"), "Category deleted");
  assert.equal(formatActivityAction("category.reassigned"), "Services reassigned");
  assert.equal(formatActivityAction("settings.updated"), "Platform settings updated");
  // An unrecognised action degrades to a neutral label rather than showing raw text.
  assert.equal(formatActivityAction("something.else"), "Activity");
  assert.equal(formatActivityAction(undefined), "Activity");

  // The actor is shown as a role word only.
  assert.equal(formatActivityActorRole("owner"), "Owner");
  assert.equal(formatActivityActorRole("admin"), "Admin");
  assert.equal(formatActivityActorRole("customer"), "Admin");
});

test("timestamps format to a readable string and bad input yields empty", () => {
  const formatted = formatActivityTime("2026-11-26T10:00:00.000Z");
  assert.equal(typeof formatted, "string");
  assert.notEqual(formatted, "");
  assert.match(formatted, /2026/);

  assert.equal(formatActivityTime("not a date"), "");
  assert.equal(formatActivityTime(null), "");
});

test("error mapping distinguishes 'not configured', 'not allowed' and other failures", () => {
  for (const code of ["PGRST202", "PGRST205", "42883", "42P01"]) {
    assert.equal(isMissingAdminActivityLogError({ code }), true);
    assert.equal(getAdminActivityLogErrorMessage({ code }), adminActivityLogNotConfiguredMessage);
  }
  assert.equal(isMissingAdminActivityLogError({ code: "42501" }), false);

  assert.equal(
    getAdminActivityLogErrorMessage({ code: "42501" }),
    "Only the NexTech owner and approved admins can view the activity log.",
  );
  assert.equal(getAdminActivityLogErrorMessage({ code: "XX000", message: "boom" }), "boom");
  assert.equal(
    getAdminActivityLogErrorMessage({}),
    "The activity log could not be loaded. Please try again.",
  );
});

test("the reader calls the RPC with pagination and filters, and sends no identity", () => {
  const callSource = source.slice(source.indexOf("export async function getAdminActivityLog("));
  assert.match(callSource, /rpc\("admin_activity_log", \{/);
  assert.match(callSource, /p_limit: limit/);
  assert.match(callSource, /p_offset: offset/);
  assert.match(callSource, /p_action: adminActivityActions\.includes\(action\) \? action : null/);
  assert.match(callSource, /p_actor_role: adminActivityActorRoles\.includes\(actorRole\) \? actorRole : null/);

  // The browser never sends an actor identity, role claim or any private field.
  assert.doesNotMatch(callSource, /actor_id/);
  assert.doesNotMatch(callSource, /user_id/);
  assert.doesNotMatch(callSource, /website_name|contact_email|support_email/);
});
