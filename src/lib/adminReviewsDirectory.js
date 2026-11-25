import { getSupabaseClient } from "./supabase.js";

export const adminReviewsDirectoryNotConfiguredMessage =
  "The reviews directory is not set up yet. Apply the NexTech reviews directory migration, then try again.";

// The real review status column values, and the only ones the status filter
// offers. Public profiles have no such concept; this is the reviews.status column.
export const adminReviewStatuses = ["pending", "published", "rejected"];

// PostgREST reports a missing function as PGRST202 (and a missing table as
// PGRST205); Postgres reports the same conditions as 42883 / 42P01. Any of them
// means the directory backend is not in place, which is "not configured" rather
// than "no reviews".
export function isMissingAdminReviewsDirectoryError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getAdminReviewsDirectoryErrorMessage(error) {
  if (isMissingAdminReviewsDirectoryError(error)) return adminReviewsDirectoryNotConfiguredMessage;
  // 42501 is the RPC's own has_admin_access() gate: the caller is neither the
  // owner nor an approved admin.
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can view the reviews directory.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The reviews directory could not be loaded. Please try again.";
}

// The RPC returns a read-only list of real review rows. The shape is normalized
// so a missing or renamed field renders as an empty state instead of
// "undefined", and so any unexpected extra field is dropped rather than passed
// through to the UI.
//
// NOTE: the reviewer identity (reviewer_id), the moderator identity (moderated_by)
// and the moderation fields are private and are never read, returned or
// displayed. status is one of the real column values: pending, published or
// rejected.
export function normalizeAdminReviews(payload) {
  if (!Array.isArray(payload)) return [];

  return payload.map((row) => {
    const rating = Number(row?.rating);
    return {
      id: typeof row?.id === "string" ? row.id : "",
      serviceName: typeof row?.service_name === "string" ? row.service_name : "",
      rating: Number.isInteger(rating) ? rating : 0,
      body: typeof row?.body === "string" ? row.body : "",
      status: typeof row?.status === "string" ? row.status : "",
      createdAt: row?.created_at ?? null,
    };
  });
}

// Search by service name or review text and filter by the real status column.
// Only the fields the RPC returns to authorized admins are matched; no reviewer
// identity is ever read.
export function filterAdminReviews(reviews, { query, status } = {}) {
  const list = Array.isArray(reviews) ? reviews : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  const normalizedStatus = adminReviewStatuses.includes(status) ? status : "all";

  return list.filter((review) => {
    const matchesStatus = normalizedStatus === "all"
      || String(review?.status || "").toLowerCase() === normalizedStatus;
    const matchesSearch = !needle || [review?.serviceName, review?.body]
      .some((value) => String(value || "").toLowerCase().includes(needle));
    return matchesStatus && matchesSearch;
  });
}

// One read-only RPC call. Authorization is decided entirely on the server by
// public.has_admin_access(); the browser sends no role, id or filter, so an
// approved admin can never ask for more than the RPC is willing to return.
export async function getAdminReviewsDirectory() {
  const { data, error } = await getSupabaseClient().rpc("admin_reviews_directory");
  if (error) throw error;
  return normalizeAdminReviews(data);
}
