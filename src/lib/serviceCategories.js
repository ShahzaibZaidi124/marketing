import { getSupabaseClient } from "./supabase.js";

export const serviceCategoriesNotConfiguredMessage =
  "Categories are not set up yet. Apply the NexTech service categories migration, then try again.";

export const maximumCategoryNameLength = 120;
export const maximumCategoryDescriptionLength = 500;
export const maximumCategoryIconNameLength = 120;

// PostgREST reports a missing function as PGRST202 (and a missing table as
// PGRST205); Postgres reports the same conditions as 42883 / 42P01. Any of them
// means the category backend is not in place, which is "not configured" rather
// than "no categories".
export function isMissingServiceCategoriesError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getServiceCategoriesErrorMessage(error) {
  if (isMissingServiceCategoriesError(error)) return serviceCategoriesNotConfiguredMessage;
  // 42501 is the RPC's own has_admin_access() gate: the caller is neither the
  // owner nor an approved admin.
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can manage categories.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The categories could not be loaded. Please try again.";
}

export function getSaveCategoryErrorMessage(error) {
  if (isMissingServiceCategoriesError(error)) return serviceCategoriesNotConfiguredMessage;
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can manage categories.";
  }
  // 23505 is a duplicate key: the derived id already exists.
  if (error?.code === "23505") {
    return "A category with that name already exists.";
  }
  if (error?.code === "22023") {
    return typeof error?.message === "string" && error.message
      ? error.message
      : "That category could not be saved. Check the name and try again.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "That category could not be saved. Please try again.";
}

// 23503 is the delete guard: the category still has dependent services (raised by
// the RPC, and backed by the ON DELETE RESTRICT foreign key). The server's own
// message names the number of services, so it is passed straight through.
export function getDeleteCategoryErrorMessage(error) {
  if (isMissingServiceCategoriesError(error)) return serviceCategoriesNotConfiguredMessage;
  if (error?.code === "42501") {
    return "Only the NexTech owner and approved admins can manage categories.";
  }
  if (error?.code === "23503") {
    return typeof error?.message === "string" && error.message
      ? error.message
      : "This category still has services assigned to it. Move them to another category before deleting it.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "This category could not be deleted. Please try again.";
}

// The RPC and the table both expose snake_case columns. The shape is normalized
// so a missing or renamed field renders as an empty value instead of
// "undefined", and so any unexpected extra field is dropped.
export function normalizeServiceCategories(payload) {
  if (!Array.isArray(payload)) return [];

  return payload.map((row) => ({
    id: typeof row?.id === "string" ? row.id : "",
    name: typeof row?.name === "string" ? row.name : "",
    description: typeof row?.description === "string" ? row.description : "",
    iconName: typeof row?.icon_name === "string" ? row.icon_name : "",
    active: row?.is_active === true,
    serviceCount: readServiceCount(row?.service_count),
    createdAt: row?.created_at ?? null,
  }));
}

export function normalizeServiceCategory(row) {
  const [category] = normalizeServiceCategories(row ? [row] : []);
  return category ?? null;
}

// The customer-facing list: only active categories that have an id and a name.
export function normalizeActiveCategories(payload) {
  return normalizeServiceCategories(payload).filter((category) => category.active && category.id && category.name);
}

// Search by name or description and filter by the real is_active field. Only
// fields the RPC/table actually returns are matched.
export function filterServiceCategories(categories, { query, status } = {}) {
  const list = Array.isArray(categories) ? categories : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  const normalizedStatus = status === "active" || status === "inactive" ? status : "all";

  return list.filter((category) => {
    const matchesStatus = normalizedStatus === "all"
      || (normalizedStatus === "active" ? category?.active === true : category?.active === false);
    const matchesSearch = !needle || [category?.name, category?.description, category?.iconName]
      .some((value) => String(value || "").toLowerCase().includes(needle));
    return matchesStatus && matchesSearch;
  });
}

export function readServiceCount(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
  return 0;
}

// Case-insensitive, trimmed comparison against categories the caller already
// loaded. The server unique index is the real guard; this only fails fast.
export function duplicateCategoryNameError(categories, { name, id } = {}) {
  const trimmed = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!trimmed) return "";
  const taken = (Array.isArray(categories) ? categories : []).some((category) =>
    category?.id !== id && String(category?.name || "").trim().toLowerCase() === trimmed);
  return taken ? "A category with that name already exists." : "";
}

export function validateCategoryDraft({ name, description = "", iconName = "" } = {}) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return { name: "", description: "", iconName: "", error: "Enter a category name." };
  }
  if (Array.from(trimmedName).length > maximumCategoryNameLength) {
    return { name: "", description: "", iconName: "", error: `Category names must be ${maximumCategoryNameLength} characters or fewer.` };
  }
  if (!/[a-z0-9]/i.test(trimmedName)) {
    return { name: "", description: "", iconName: "", error: "A category name must contain at least one letter or number." };
  }

  const trimmedDescription = typeof description === "string" ? description.trim() : "";
  if (Array.from(trimmedDescription).length > maximumCategoryDescriptionLength) {
    return { name: trimmedName, description: "", iconName: "", error: `Category descriptions must be ${maximumCategoryDescriptionLength} characters or fewer.` };
  }

  const trimmedIconName = typeof iconName === "string" ? iconName.trim() : "";
  if (Array.from(trimmedIconName).length > maximumCategoryIconNameLength) {
    return { name: trimmedName, description: trimmedDescription, iconName: "", error: `Icon names must be ${maximumCategoryIconNameLength} characters or fewer.` };
  }

  return { name: trimmedName, description: trimmedDescription, iconName: trimmedIconName, error: "" };
}

// Customer-facing read for the service editor: active categories only. RLS also
// restricts this to active rows for ordinary users; the explicit filter keeps the
// result identical for an owner or admin who happens to be editing a service.
export async function getActiveServiceCategories() {
  const { data, error } = await getSupabaseClient()
    .from("categories")
    .select("id, name, description, icon_name, is_active, created_at")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Supabase returned an invalid category list.");
  return normalizeActiveCategories(data);
}

// Admin read: ONE read-only RPC. Authorization is decided entirely on the server
// by public.has_admin_access(); the browser sends no role, id or owner flag, so an
// approved admin can never ask for more than the RPC is willing to return.
export async function getAdminServiceCategories() {
  const { data, error } = await getSupabaseClient().rpc("admin_service_categories");
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Supabase returned an invalid category list.");
  return normalizeServiceCategories(data);
}

// Create: the browser sends only name / description / icon name. The id is
// derived on the server, so a caller can never choose or overwrite a row id.
export async function createServiceCategory(draft = {}) {
  const { name, description, iconName, error: validationError } = validateCategoryDraft(draft);
  if (validationError) throw new Error(validationError);

  const { data, error } = await getSupabaseClient().rpc("create_service_category", {
    p_name: name,
    p_description: description,
    p_icon_name: iconName,
  });

  if (error) throw error;
  return normalizeServiceCategory(data);
}

export async function updateServiceCategory({ id, name, description = "", iconName = "", active = true } = {}) {
  if (!id) throw new Error("A category id is required to update a category.");
  const { name: safeName, description: safeDescription, iconName: safeIconName, error: validationError } = validateCategoryDraft({ name, description, iconName });
  if (validationError) throw new Error(validationError);

  const { data, error } = await getSupabaseClient().rpc("update_service_category", {
    p_id: id,
    p_name: safeName,
    p_description: safeDescription,
    p_icon_name: safeIconName,
    p_is_active: active !== false,
  });

  if (error) throw error;
  return normalizeServiceCategory(data);
}

export async function deleteServiceCategory(id) {
  if (!id) throw new Error("A category id is required to delete a category.");

  const { data, error } = await getSupabaseClient().rpc("delete_service_category", { p_id: id });
  if (error) throw error;
  return data;
}

export async function reassignServiceCategory({ fromId, toId } = {}) {
  if (!fromId || !toId) throw new Error("Choose a category to move these services to.");
  if (fromId === toId) throw new Error("Choose a different category to move the services to.");

  const { data, error } = await getSupabaseClient().rpc("reassign_service_category", {
    p_from_id: fromId,
    p_to_id: toId,
  });

  if (error) throw error;
  return typeof data === "number" ? data : 0;
}
