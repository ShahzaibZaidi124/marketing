import { getSupabaseClient } from "./supabase.js";

export const adminActivityLogNotConfiguredMessage =
  "The activity log is not set up yet. Apply the NexTech activity log migration, then try again.";

// The read defaults and hard cap, matching the RPC's own clamp (1..200).
export const adminActivityPageSize = 50;

// The fixed set of recorded actions (activity_log.action CHECK constraint). The
// action filter offers "all" plus exactly these.
export const adminActivityActions = [
  "admin_application.approved",
  "admin_application.rejected",
  "category.created",
  "category.updated",
  "category.deleted",
  "category.reassigned",
  "settings.updated",
];

// The actor is surfaced as a role word only. Names, emails and actor ids are
// never read or displayed.
export const adminActivityActorRoles = ["owner", "admin"];

// PostgREST reports a missing function as PGRST202 (and a missing table as
// PGRST205); Postgres reports the same conditions as 42883 / 42P01. Any of them
// means the activity log backend is not in place, which is "not configured"
// rather than "no activity".
export function isMissingAdminActivityLogError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getAdminActivityLogErrorMessage(error) {
  if (isMissingAdminActivityLogError(error)) return adminActivityLogNotConfiguredMessage;
  // 42501 is the RPC's own has_admin_access() gate: the caller is neither the
  // owner nor an approved admin.
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can view the activity log.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The activity log could not be loaded. Please try again.";
}

// A short, human label for the recorded action. The server already supplies a
// descriptive summary; this is the tag shown above it.
export function formatActivityAction(action) {
  switch (typeof action === "string" ? action.trim().toLowerCase() : "") {
    case "admin_application.approved": return "Admin approved";
    case "admin_application.rejected": return "Admin rejected";
    case "category.created": return "Category created";
    case "category.updated": return "Category updated";
    case "category.deleted": return "Category deleted";
    case "category.reassigned": return "Services reassigned";
    case "settings.updated": return "Platform settings updated";
    default: return "Activity";
  }
}

export function formatActivityActorRole(actorRole) {
  const normalized = typeof actorRole === "string" ? actorRole.trim().toLowerCase() : "";
  if (normalized === "owner") return "Owner";
  if (normalized === "admin") return "Admin";
  return "Admin";
}

export function formatActivityTime(value) {
  // new Date(null) is the epoch, not an invalid date, so guard the empty case.
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The RPC returns a read-only list of activity rows. The shape is normalized so a
// missing or renamed field renders as an empty state instead of "undefined", and
// so any unexpected extra field is dropped. In particular actor_id is NEVER
// mapped: the actor identity cannot leak into the UI even if a future RPC
// accidentally selected it.
export function normalizeActivityEntries(payload) {
  if (!Array.isArray(payload)) return [];

  return payload.map((row) => ({
    id: row?.id ?? "",
    action: typeof row?.action === "string" ? row.action : "",
    actorRole: typeof row?.actor_role === "string" ? row.actor_role : "",
    targetType: typeof row?.target_type === "string" ? row.target_type : "",
    targetId: typeof row?.target_id === "string" ? row.target_id : "",
    summary: typeof row?.summary === "string" ? row.summary : "",
    createdAt: row?.created_at ?? null,
  }));
}

// One read-only, paginated RPC call. Authorization is decided entirely on the
// server by public.has_admin_access(); the browser sends no identity, so it can
// never ask for more than the RPC is willing to return. Action and role filters
// are applied server-side; an invalid role is ignored by the RPC.
export async function getAdminActivityLog({ limit = adminActivityPageSize, offset = 0, action = "", actorRole = "" } = {}) {
  const { data, error } = await getSupabaseClient().rpc("admin_activity_log", {
    p_limit: limit,
    p_offset: offset,
    p_action: adminActivityActions.includes(action) ? action : null,
    p_actor_role: adminActivityActorRoles.includes(actorRole) ? actorRole : null,
  });
  if (error) throw error;
  return normalizeActivityEntries(data);
}
