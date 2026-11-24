import { getSupabaseClient } from "./supabase.js";

export const adminOrdersDirectoryNotConfiguredMessage =
  "The orders directory is not set up yet. Apply the NexTech orders directory migration, then try again.";

// PostgREST reports a missing function as PGRST202 (and a missing table as
// PGRST205); Postgres reports the same conditions as 42883 / 42P01. Any of them
// means the directory backend is not in place, which is "not configured" rather
// than "no orders".
export function isMissingAdminOrdersDirectoryError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getAdminOrdersDirectoryErrorMessage(error) {
  if (isMissingAdminOrdersDirectoryError(error)) return adminOrdersDirectoryNotConfiguredMessage;
  // 42501 is the RPC's own has_admin_access() gate: the caller is neither the
  // owner nor an approved admin.
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can view the orders directory.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The orders directory could not be loaded. Please try again.";
}

// The RPC returns a read-only list of real order rows. The shape is normalized
// so a missing or renamed field renders as an empty state instead of
// "undefined", and so any unexpected extra field is dropped rather than passed
// through to the UI.
//
// NOTE: the client identity (client_id) and the client-written free text
// (order_description, requirements) are private and are never read, returned or
// displayed. status is one of the real column values: pending, active,
// completed or rejected.
export function normalizeAdminOrders(payload) {
  if (!Array.isArray(payload)) return [];

  return payload.map((row) => ({
    id: typeof row?.id === "string" ? row.id : "",
    projectName: typeof row?.project_name === "string" ? row.project_name : "",
    serviceName: typeof row?.service_name === "string" ? row.service_name : "",
    status: typeof row?.status === "string" ? row.status : "",
    price: row?.price ?? null,
    currency: typeof row?.currency === "string" ? row.currency : "PKR",
    createdAt: row?.created_at ?? null,
  }));
}

// Search by order id, service name or project name and filter by the real status
// column. Only the fields the RPC returns to authorized admins are matched.
export function filterAdminOrders(orders, { query, status } = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  const normalizedStatus = ["pending", "active", "completed", "rejected"].includes(status)
    ? status
    : "all";

  return list.filter((order) => {
    const matchesStatus = normalizedStatus === "all"
      || String(order?.status || "").toLowerCase() === normalizedStatus;
    const matchesSearch = !needle || [order?.serviceName, order?.projectName, order?.id]
      .some((value) => String(value || "").toLowerCase().includes(needle));
    return matchesStatus && matchesSearch;
  });
}

// One read-only RPC call. Authorization is decided entirely on the server by
// public.has_admin_access(); the browser sends no role, id or filter, so an
// approved admin can never ask for more than the RPC is willing to return.
export async function getAdminOrdersDirectory() {
  const { data, error } = await getSupabaseClient().rpc("admin_orders_directory");
  if (error) throw error;
  return normalizeAdminOrders(data);
}
