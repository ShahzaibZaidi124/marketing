import { getSupabaseClient } from "./supabase.js";

export const adminOverviewNotConfiguredMessage =
  "The platform overview is not set up yet. Apply the NexTech admin overview migration, then try again.";

// PostgREST reports a missing function as PGRST202 (and a missing table as
// PGRST205); Postgres reports the same conditions as 42883 / 42P01. Any of them
// means the overview backend is not in place, which is "not configured" rather
// than "no data".
export function isMissingAdminOverviewError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getAdminOverviewErrorMessage(error) {
  if (isMissingAdminOverviewError(error)) return adminOverviewNotConfiguredMessage;
  // 42501 is the RPC's own has_admin_access() gate: the caller is neither the
  // owner nor an approved admin.
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can view the platform overview.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The platform overview could not be loaded. Please try again.";
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// The RPC returns a read-only snapshot that never includes customer identity, so
// there is nothing here to redact. The shape is still normalized so a missing or
// renamed field renders as an empty state instead of "undefined", and so any
// unexpected extra field is dropped rather than passed through to the UI.
export function normalizeAdminOverview(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const recentOrders = Array.isArray(source.recent_orders) ? source.recent_orders : [];

  return {
    totalCustomers: toCount(source.total_customers),
    publishedServices: toCount(source.published_services),
    pendingOrders: toCount(source.pending_orders),
    totalOrders: toCount(source.total_orders),
    recentOrders: recentOrders.map((order) => ({
      serviceName: typeof order?.service_name === "string" ? order.service_name : "",
      projectName: typeof order?.project_name === "string" ? order.project_name : "",
      status: typeof order?.status === "string" ? order.status : "",
      price: order?.price ?? null,
      currency: typeof order?.currency === "string" ? order.currency : "PKR",
      createdAt: order?.created_at ?? null,
    })),
  };
}

// One read-only RPC call. Authorization is decided entirely on the server by
// public.has_admin_access(); the browser sends no role, id or filter, so an
// approved admin can never ask for more than the RPC is willing to return.
export async function getAdminOverview() {
  const { data, error } = await getSupabaseClient().rpc("admin_overview");
  if (error) throw error;
  return normalizeAdminOverview(data);
}
