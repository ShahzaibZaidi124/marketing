// Static review of the Admin → Platform Configuration access control. The project
// has no DOM test runner installed, so — like supabase/tests and
// ExploreServices.test.js — these tests pin the source-level guarantees that
// matter:
//
//   * Platform Configuration is wrapped in the existing server-verified
//     RequireOwner guard, so a direct /admin/settings URL is blocked too;
//   * the sidebar link is hidden for non-owners, but that is defence-in-depth,
//     not the only protection;
//   * /admin/messages stays owner-only;
//   * the guard reuses the existing owner check (isOwnerAccount → public.is_owner)
//     and never falls back to the admin check (has_admin_access);
//   * Platform Settings stays a local preview: no Supabase call, no RPC.
//
// Run: node --test src/pages/AdminDashboard.test.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(here, "AdminDashboard.jsx"), "utf8");
const guardsSource = readFileSync(join(here, "..", "components", "RouteGuards.jsx"), "utf8");

// Returns the source between two top-level markers (the start marker is included,
// the end marker is excluded).
function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `expected to find ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `expected to find ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

test("Platform Configuration is wrapped in the server-verified RequireOwner guard", () => {
  // The settings section renders through RequireOwner, not a bare <section>.
  assert.match(dashboardSource, /\{activeSection === "settings" && \(\s*<RequireOwner/);
  // The owner gate component is imported from the shared guards module.
  assert.match(dashboardSource, /import \{ RequireOwner \} from "\.\.\/components\/RouteGuards\.jsx"/);
  // RequireOwner appears exactly twice: the inbox and the settings form. Adding it
  // anywhere else would change access to another Admin section.
  const uses = dashboardSource.match(/<RequireOwner\b/g) ?? [];
  assert.equal(uses.length, 2, "RequireOwner must gate only Messages and Platform Configuration");
});

test("the Platform Configuration link is hidden for non-owners as defence-in-depth", () => {
  // Both owner-only keys are declared once and filtered from the sidebar.
  assert.match(dashboardSource, /const ownerOnlyKeys = \["messages", "settings"\];/);
  assert.match(dashboardSource, /!ownerOnlyKeys\.includes\(item\.key\) \|\| isOwner/);
  // The nav entry still exists (it is hidden, not deleted).
  assert.match(dashboardSource, /\{ key: "settings", label: "Platform settings", Icon: Settings \}/);
});

test("/admin/messages stays owner-only", () => {
  assert.match(dashboardSource, /\{isMessagesSection && \(\s*<RequireOwner>\s*<AdminMessages \/>\s*<\/RequireOwner>\s*\)\}/);
  assert.match(dashboardSource, /const isMessagesSection = activeSection === "messages";/);
});

test("the settings gate reuses the existing owner check, not the admin check", () => {
  const guardBody = sliceBetween(guardsSource, "export function RequireOwner({", "export function RequireAdminAccess");
  // Owner verification goes through the existing server-side isOwnerAccount().
  assert.match(guardBody, /isOwnerAccount\(\)/);
  // It must not fall back to the admin check (which is true for approved admins).
  assert.doesNotMatch(guardBody, /hasAdminAccess/);
  // The denial copy is caller-overridable, and the defaults keep the inbox wording
  // so /admin/messages is unchanged.
  assert.match(guardBody, /signInMessage = <>This inbox is limited to the NexTech owner\./);
  assert.match(guardBody, /deniedMessage = <>This account is not the NexTech owner, so the customer inbox is not available\./);
  assert.match(guardBody, /<p>\{deniedMessage\}<\/p>/);
  assert.match(guardBody, /<p>\{signInMessage\}<\/p>/);
  assert.match(guardBody, /<p>\{errorMessage\} \{errorNote\}<\/p>/);
});

test("Platform Settings stays a local preview with no server calls", () => {
  const saveSettings = sliceBetween(dashboardSource, "const saveSettings = (event) => {", "const unavailableSections");
  assert.doesNotMatch(saveSettings, /getSupabaseClient|\.rpc\(|from\(/);
  assert.match(saveSettings, /browser preview only/);
  // The heading still tells the owner the values are not persisted.
  assert.match(dashboardSource, /a local preview only\. Saving does not update the public website or persist after refresh\./);
});
