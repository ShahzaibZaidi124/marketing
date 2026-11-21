import { getSupabaseClient } from "./supabase.js";
import { verifyAuthenticatedUser } from "./auth.js";

export async function getOrderableService(serviceId) {
  const supabase = getSupabaseClient();
  const { data: service, error: serviceError } = await supabase
    .from("services")
    .select("id, name, description, base_price, currency")
    .eq("id", serviceId)
    .eq("is_active", true)
    .maybeSingle();

  if (serviceError) throw serviceError;
  if (!service) return null;

  const { data: packages, error: packagesError } = await supabase
    .from("service_packages")
    .select("id, name, description, price, currency")
    .eq("service_id", serviceId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (packagesError) throw packagesError;
  return { ...service, packages: Array.isArray(packages) ? packages : [] };
}

export function getCatalogLoadErrorMessage(error) {
  if (error?.code === "PGRST205" || error?.code === "42P01") {
    return "The service catalog is not set up yet. Apply its migration and add real services and packages before accepting orders.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The service catalog could not be loaded. Please try again.";
}

export async function submitClientOrder(userId, orderDraft) {
  await verifyAuthenticatedUser(userId);
  const { data, error } = await getSupabaseClient().functions.invoke("place-order", {
    body: orderDraft,
  });

  if (error) {
    let responseError = "";
    if (error.context && typeof error.context.json === "function") {
      try {
        const body = await error.context.json();
        if (typeof body?.error === "string") responseError = body.error;
      } catch {
        responseError = "";
      }
    }
    throw new Error(responseError || error.message || "Your order could not be submitted. Please try again.");
  }
  if (!data || typeof data.order_id !== "string" || !data.order_id) {
    throw new Error("The order service did not confirm the order. Please check My Orders before retrying.");
  }
  return data.order_id;
}

export function validateOrderDraft({ projectName, orderDescription, requirements }) {
  const errors = {};
  const normalizedProjectName = typeof projectName === "string" ? projectName.trim() : "";
  const normalizedDescription = typeof orderDescription === "string" ? orderDescription.trim() : "";
  const normalizedRequirements = typeof requirements === "string" ? requirements.trim() : "";

  if (!normalizedProjectName) errors.projectName = "Enter a project name.";
  else if (normalizedProjectName.length > 120) errors.projectName = "Project name must be 120 characters or fewer.";
  if (!normalizedDescription) errors.orderDescription = "Describe what you need for this order.";
  else if (normalizedDescription.length > 5000) errors.orderDescription = "Order description must be 5,000 characters or fewer.";
  if (normalizedRequirements.length > 10000) errors.requirements = "Requirements must be 10,000 characters or fewer.";

  return errors;
}

export function buildPlaceOrderRequest({ serviceId, packageId, projectName, orderDescription, requirements }) {
  return {
    service_id: serviceId,
    package_id: packageId || null,
    project_name: projectName.trim(),
    order_description: orderDescription.trim(),
    requirements: requirements.trim(),
  };
}
