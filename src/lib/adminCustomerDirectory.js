import { getSupabaseClient } from "./supabase.js";
import { formatClientOrderDate } from "./orders.js";

export const adminCustomerDirectoryNotConfiguredMessage =
  "The customer directory is not set up yet. Apply the NexTech customer directory migration, then try again.";

// PostgREST reports a missing function as PGRST202 (and a missing table as
// PGRST205); Postgres reports the same conditions as 42883 / 42P01. Any of them
// means the directory backend is not in place, which is "not configured" rather
// than "no customers".
export function isMissingAdminCustomerDirectoryError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getAdminCustomerDirectoryErrorMessage(error) {
  if (isMissingAdminCustomerDirectoryError(error)) return adminCustomerDirectoryNotConfiguredMessage;
  // 42501 is the RPC's own has_admin_access() gate: the caller is neither the
  // owner nor an approved admin.
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can view the customer directory.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The customer directory could not be loaded. Please try again.";
}

export function formatCustomerCreatedDate(value) {
  return formatClientOrderDate(value);
}

// The RPC returns a read-only list of verified customer profiles. The shape is
// normalized so a missing or renamed field renders as an empty state instead of
// "undefined", and so any unexpected extra field (an id, seller details, auth
// data, a future column) is dropped rather than passed through to the UI.
//
// NOTE: public.profiles has no status / active column, so no account status is
// read, returned or displayed — it is never invented.
export function normalizeCustomerDirectory(payload) {
  if (!Array.isArray(payload)) return [];

  return payload.map((row) => ({
    name: typeof row?.full_name === "string" ? row.full_name.trim() : "",
    username: typeof row?.username === "string" ? row.username.trim() : "",
    email: typeof row?.email === "string" ? row.email.trim() : "",
    role: typeof row?.role === "string" ? row.role : "",
    createdAt: row?.created_at ?? null,
  }));
}

// Search by customer name. Only the name and username fields the RPC returns to
// authorized admins are matched; nothing else is read.
export function filterCustomerDirectory(customers, query) {
  const list = Array.isArray(customers) ? customers : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!needle) return list;

  return list.filter((customer) => [customer?.name, customer?.username]
    .some((value) => String(value || "").toLowerCase().includes(needle)));
}

// One read-only RPC call. Authorization is decided entirely on the server by
// public.has_admin_access(); the browser sends no role, id or filter, so an
// approved admin can never ask for more than the RPC is willing to return.
export async function getAdminCustomerDirectory() {
  const { data, error } = await getSupabaseClient().rpc("admin_customer_directory");
  if (error) throw error;
  return normalizeCustomerDirectory(data);
}
