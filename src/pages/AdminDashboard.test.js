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
//   * Platform Settings is a live, owner-only record: it loads and saves through
//     the management RPCs and exposes loading / saving / success / error states.
//   * the Activity log is a live, server-persisted, read-only feed for the owner
//     and approved admins: it reads through the gated RPC, exposes loading / error
//     / empty / filter / pagination states, and shows no actor id or setting value.
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

test("Platform Settings loads and saves through the owner-only management RPCs", () => {
  // The lib exposes the two owner-gated RPCs and their validators.
  assert.match(dashboardSource, /import \{[\s\S]*?getPlatformSettings,[\s\S]*?\} from "\.\.\/lib\/platformSettings\.js"/);
  assert.match(dashboardSource, /getPlatformSettings\(\)/);
  assert.match(dashboardSource, /updatePlatformSettings\(values\)/);
  assert.match(dashboardSource, /validatePlatformSettingsDraft\(settings\)/);

  // The save no longer stops in browser memory: it calls the server and re-reads
  // the row the server returns.
  const saveSettings = sliceBetween(dashboardSource, "const saveSettings = async (event) => {", "const unavailableSections");
  assert.match(saveSettings, /updatePlatformSettings\(values\)/);
  assert.match(saveSettings, /getSavePlatformSettingsErrorMessage\(error\)/);
  assert.match(saveSettings, /setNotice\("Platform settings saved\./);

  // The old browser-preview copy is gone.
  assert.doesNotMatch(dashboardSource, /local preview only/);
  assert.doesNotMatch(dashboardSource, /Save preview settings/);
});

test("Platform Settings exposes loading, saving, success and error states", () => {
  assert.match(dashboardSource, /const \[settingsLoading, setSettingsLoading\] = useState\(false\)/);
  assert.match(dashboardSource, /const \[settingsSaving, setSettingsSaving\] = useState\(false\)/);
  assert.match(dashboardSource, /const \[settingsLoadError, setSettingsLoadError\] = useState\(""\)/);
  assert.match(dashboardSource, /const \[settingsFormError, setSettingsFormError\] = useState\(""\)/);
  // States are rendered: loading notice, error notice, saving button label.
  assert.match(dashboardSource, /Loading platform settings from the server…/);
  assert.match(dashboardSource, /Platform settings unavailable\./);
  assert.match(dashboardSource, /\{settingsSaving \? "Saving…" : "Save settings"\}/);
  // The submit button is disabled while a save is in flight.
  assert.match(dashboardSource, /disabled=\{settingsSaving\}/);
});

test("Platform Settings is a live section, not a preview", () => {
  // It is excluded from the browser-preview set (no "Demo mode" chip / preview note).
  assert.match(dashboardSource, /&& activeSection !== "settings"\s*&& activeSection !== "activity";/);
  // It is loaded only for a confirmed owner (fails closed for admins/customers).
  assert.match(dashboardSource, /if \(!user \|\| !isOwner\) \{/);
});

test("the Activity log loads live from the read-only RPC, not browser memory", () => {
  // The lib exposes the reader and its error mapper.
  assert.match(dashboardSource, /import \{[\s\S]*?getAdminActivityLog,[\s\S]*?\} from "\.\.\/lib\/adminActivityLog\.js"/);
  assert.match(dashboardSource, /getAdminActivityLog\(\{/);
  assert.match(dashboardSource, /getAdminActivityLogErrorMessage\(error\)/);

  // The old browser-memory writer and its copy are gone.
  assert.doesNotMatch(dashboardSource, /const logAction = /);
  assert.doesNotMatch(dashboardSource, /logAction\(/);
  assert.doesNotMatch(dashboardSource, /Actions are held in browser memory and disappear when this page is refreshed\./);
  assert.doesNotMatch(dashboardSource, /Browser preview/);
  assert.doesNotMatch(dashboardSource, /Settings changes made in this session will be listed here\./);
});

test("the Activity log exposes loading, error, empty, filter, pagination and refresh states", () => {
  assert.match(dashboardSource, /const \[activityEntries, setActivityEntries\] = useState\(\[\]\)/);
  assert.match(dashboardSource, /const \[activityLoading, setActivityLoading\] = useState\(false\)/);
  assert.match(dashboardSource, /const \[activityError, setActivityError\] = useState\(""\)/);
  assert.match(dashboardSource, /const \[activityActionFilter, setActivityActionFilter\] = useState\("all"\)/);
  assert.match(dashboardSource, /const \[activityActorRoleFilter, setActivityActorRoleFilter\] = useState\("all"\)/);
  assert.match(dashboardSource, /const \[activityLimit, setActivityLimit\] = useState\(adminActivityPageSize\)/);

  // Rendered affordances.
  assert.match(dashboardSource, /Loading the activity log from the server…/);
  assert.match(dashboardSource, /Activity log unavailable\./);
  assert.match(dashboardSource, /Load older activity/);
  assert.match(dashboardSource, /aria-label="Filter activity by action"/);
  assert.match(dashboardSource, /aria-label="Filter activity by actor role"/);
  // The neutral empty state never claims the log is complete.
  assert.match(dashboardSource, /were never recorded and cannot be recovered\./);
});

test("the Activity log shows only the action, role and time — never an actor id or setting value", () => {
  // The row renders the derived role word and the summary, never an id.
  assert.match(dashboardSource, /formatActivityActorRole\(entry\.actorRole\)/);
  assert.match(dashboardSource, /formatActivityAction\(entry\.action\)/);
  assert.match(dashboardSource, /formatActivityTime\(entry\.createdAt\)/);
  assert.doesNotMatch(dashboardSource, /entry\.actorId/);
  assert.doesNotMatch(dashboardSource, /entry\.actor_id/);
});

test("the Activity log is a live section available to the owner and approved admins", () => {
  // It is excluded from the browser-preview set.
  assert.match(dashboardSource, /&& activeSection !== "settings"\s*&& activeSection !== "activity";/);
  // It is NOT wrapped in RequireOwner: approved admins may read it, and the RPC is
  // the real gate. RequireOwner still gates exactly Messages + Platform Settings.
  const uses = dashboardSource.match(/<RequireOwner\b/g) ?? [];
  assert.equal(uses.length, 2, "Activity log must not add a third RequireOwner");
  assert.doesNotMatch(dashboardSource, /\{activeSection === "activity" && \(\s*<RequireOwner/);
});
