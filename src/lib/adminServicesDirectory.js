import { getSupabaseClient } from "./supabase.js";

export const adminServicesDirectoryNotConfiguredMessage =
  "The services directory is not set up yet. Apply the NexTech services directory migration, then try again.";

// PostgREST reports a missing function as PGRST202 (and a missing table as
// PGRST205); Postgres reports the same conditions as 42883 / 42P01. Any of them
// means the directory backend is not in place, which is "not configured" rather
// than "no services".
export function isMissingAdminServicesDirectoryError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getAdminServicesDirectoryErrorMessage(error) {
  if (isMissingAdminServicesDirectoryError(error)) return adminServicesDirectoryNotConfiguredMessage;
  // 42501 is the RPC's own has_admin_access() gate: the caller is neither the
  // owner nor an approved admin.
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can view the services directory.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The services directory could not be loaded. Please try again.";
}

// The RPC returns a read-only list of real catalog rows. The shape is normalized
// so a missing or renamed field renders as an empty state instead of
// "undefined", and so any unexpected extra field is dropped rather than passed
// through to the UI.
//
// The directory RPC does not return a seller or a category, so neither is invented.
export function normalizeAdminServices(payload) {
  if (!Array.isArray(payload)) return [];

  return payload.map((row) => ({
    id: typeof row?.id === "string" ? row.id : "",
    name: typeof row?.name === "string" ? row.name : "",
    description: typeof row?.description === "string" ? row.description : "",
    price: row?.base_price ?? null,
    currency: typeof row?.currency === "string" ? row.currency : "PKR",
    active: row?.is_active === true,
    createdAt: row?.created_at ?? null,
  }));
}

// Search by service name or description and filter by the real is_active field.
// Only the fields the RPC returns to authorized admins are matched.
export function filterAdminServices(services, { query, status } = {}) {
  const list = Array.isArray(services) ? services : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  const normalizedStatus = status === "active" || status === "inactive" ? status : "all";

  return list.filter((service) => {
    const matchesStatus = normalizedStatus === "all"
      || (normalizedStatus === "active" ? service?.active === true : service?.active === false);
    const matchesSearch = !needle || [service?.name, service?.description]
      .some((value) => String(value || "").toLowerCase().includes(needle));
    return matchesStatus && matchesSearch;
  });
}

// One read-only RPC call. Authorization is decided entirely on the server by
// public.has_admin_access(); the browser sends no role, id or filter, so an
// approved admin can never ask for more than the RPC is willing to return.
export async function getAdminServicesDirectory() {
  const { data, error } = await getSupabaseClient().rpc("admin_services_directory");
  if (error) throw error;
  return normalizeAdminServices(data);
}
