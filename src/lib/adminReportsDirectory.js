import { getSupabaseClient } from "./supabase.js";

export const adminReportsDirectoryNotConfiguredMessage =
  "The reports directory is not set up yet. Apply the NexTech reports directory migration, then try again.";

// The real report status column values, and the only ones the status filter
// offers: reports.status is one of 'pending' | 'reviewing' | 'resolved' |
// 'rejected'. The OPEN states are 'pending' and 'reviewing'; the closed states
// are 'resolved' and 'rejected'.
export const adminReportStatuses = ["pending", "reviewing", "resolved", "rejected"];

// The real report target types: reports.target_type is 'service' or 'order'.
export const adminReportTargetTypes = ["service", "order"];

// The real report category values: reports.category is a fixed enumeration.
export const adminReportCategories = ["spam", "abuse", "fraud", "inappropriate", "other"];

// PostgREST reports a missing function as PGRST202 (and a missing table as
// PGRST205); Postgres reports the same conditions as 42883 / 42P01. Any of them
// means the directory backend is not in place, which is "not configured" rather
// than "no reports".
export function isMissingAdminReportsDirectoryError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getAdminReportsDirectoryErrorMessage(error) {
  if (isMissingAdminReportsDirectoryError(error)) return adminReportsDirectoryNotConfiguredMessage;
  // 42501 is the RPC's own has_admin_access() gate: the caller is neither the
  // owner nor an approved admin.
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can view the reports directory.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The reports directory could not be loaded. Please try again.";
}

export function formatReportTargetType(targetType) {
  const normalized = typeof targetType === "string" ? targetType.trim().toLowerCase() : "";
  if (normalized === "service") return "Service";
  if (normalized === "order") return "Order";
  return "Unknown target";
}

export function formatReportCategory(category) {
  const normalized = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (!adminReportCategories.includes(normalized)) return "Other";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatReportStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  // A report with no recognised status is shown as "Pending", which is the
  // state every new report starts in.
  if (!adminReportStatuses.includes(normalized)) return "Pending";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// The RPC returns a read-only list of real report rows. The shape is normalized
// so a missing or renamed field renders as an empty state instead of
// "undefined", and so any unexpected extra field is dropped rather than passed
// through to the UI.
//
// NOTE: the reporter identity (reporter_id), the resolver identity (resolved_by)
// and the resolution fields are private and are never read, returned or
// displayed. target_type is 'service' or 'order'; status is 'pending',
// 'reviewing', 'resolved' or 'rejected'; reason may be an empty string because it
// is optional.
export function normalizeAdminReports(payload) {
  if (!Array.isArray(payload)) return [];

  return payload.map((row) => ({
    id: typeof row?.id === "string" ? row.id : "",
    targetType: typeof row?.target_type === "string" ? row.target_type : "",
    targetLabel: typeof row?.target_label === "string" ? row.target_label : "",
    category: typeof row?.category === "string" ? row.category : "",
    reason: typeof row?.reason === "string" ? row.reason : "",
    status: typeof row?.status === "string" ? row.status : "",
    createdAt: row?.created_at ?? null,
  }));
}

// Search by target label, category or reason text and filter by the real status
// column. Only the fields the RPC returns to authorized admins are matched; no
// reporter identity is ever read.
export function filterAdminReports(reports, { query, status } = {}) {
  const list = Array.isArray(reports) ? reports : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  const normalizedStatus = adminReportStatuses.includes(status) ? status : "all";

  return list.filter((report) => {
    const matchesStatus = normalizedStatus === "all"
      || String(report?.status || "").toLowerCase() === normalizedStatus;
    const matchesSearch = !needle || [
      report?.targetLabel,
      report?.category,
      report?.reason,
      formatReportTargetType(report?.targetType),
    ].some((value) => String(value || "").toLowerCase().includes(needle));
    return matchesStatus && matchesSearch;
  });
}

// One read-only RPC call. Authorization is decided entirely on the server by
// public.has_admin_access(); the browser sends no role, id or filter, so an
// approved admin can never ask for more than the RPC is willing to return.
export async function getAdminReportsDirectory() {
  const { data, error } = await getSupabaseClient().rpc("admin_reports_directory");
  if (error) throw error;
  return normalizeAdminReports(data);
}
