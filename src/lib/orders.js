import { getSupabaseClient } from "./supabase.js";
import { verifyAuthenticatedUser } from "./auth.js";

const clientOrderColumns = "id, client_id, service_id, service_name, order_description, project_name, package_name, status, price, currency, created_at, updated_at, requirements";

export async function getClientOrders(userId) {
  await verifyAuthenticatedUser(userId);
  const { data, error } = await getSupabaseClient()
    .from("orders")
    .select(clientOrderColumns)
    .eq("client_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Supabase returned an invalid order list.");
  return data;
}

export async function getClientOrder(userId, orderId) {
  if (!orderId) throw new Error("An order ID is required.");
  await verifyAuthenticatedUser(userId);
  const { data, error } = await getSupabaseClient()
    .from("orders")
    .select(clientOrderColumns)
    .eq("client_id", userId)
    .eq("id", orderId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function filterClientOrders(orders, status) {
  if (status === "all") return orders;
  return orders.filter((order) => String(order.status || "").toLowerCase() === status);
}

export function getOrderLoadErrorMessage(error) {
  if (error?.code === "PGRST205" || error?.code === "42P01") {
    return "Order storage is not set up yet. Apply the NexTech client orders migration, then try again.";
  }
  if (typeof error?.message === "string" && error.message) {
    return `We couldn't load your orders: ${error.message}`;
  }
  return "We couldn't load your orders. Please try again.";
}

export function formatClientOrderStatus(status) {
  const normalizedStatus = typeof status === "string" ? status.trim().replace(/_/g, " ") : "";
  if (!normalizedStatus) return "Status unavailable";
  return normalizedStatus.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatClientOrderDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatClientOrderPrice(price, currency = "PKR") {
  if (price === null || price === undefined || price === "") return "Price not available";
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) return "Price not available";
  const currencyCode = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "PKR";
  return `${currencyCode} ${new Intl.NumberFormat("en-PK", {
    maximumFractionDigits: 2,
  }).format(numericPrice)}`;
}
