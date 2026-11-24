import { getSupabaseClient } from "./supabase.js";
import { verifyAuthenticatedUser } from "./auth.js";

export const minimumReviewRating = 1;
export const maximumReviewRating = 5;
export const maximumReviewBodyLength = 4000;

export const reviewsNotConfiguredMessage =
  "Reviews are not set up yet. Apply the NexTech customer reviews migration, then try again.";

// A review is created by a plain INSERT, and the database does the rest:
//   * the BEFORE INSERT trigger (public.nextech_set_review_identity) derives
//     reviewer_id, service_id, status = 'pending' and the moderation fields from
//     the verified JWT and the referenced order, and refuses orders the caller
//     does not own or has not completed;
//   * the RLS INSERT policy re-checks that the row is the caller's own and still
//     pending before it is stored.
// The browser therefore sends ONLY order_id, rating and body — it can never set
// reviewer_id, status or a moderation field, and reviews are never updated or
// deleted from here (there is no UPDATE/DELETE policy and no update/delete export).
const reviewColumns = "id, order_id, rating, body, status, created_at, updated_at";

// PostgREST reports a missing table or function as PGRST205 / PGRST202; Postgres
// reports the same conditions as 42P01 / 42883.
export function isMissingReviewsError(error) {
  return ["PGRST205", "PGRST202", "42P01", "42883"].includes(error?.code ?? "");
}

// 23505 = unique_violation, raised by reviews_order_id_key (one review per order).
export function isDuplicateReviewError(error) {
  return error?.code === "23505";
}

// Mirrors the database checks: rating is an integer 1–5, body is optional and at
// most 4,000 characters (counted in code points to match char_length()).
export function validateReviewDraft({ rating, body } = {}) {
  const numericRating = Number(rating);
  if (!Number.isInteger(numericRating)
    || numericRating < minimumReviewRating
    || numericRating > maximumReviewRating) {
    return { rating: null, body: "", error: "Choose a rating from 1 to 5 stars." };
  }

  const text = typeof body === "string" ? body.trim() : "";
  if (Array.from(text).length > maximumReviewBodyLength) {
    return { rating: numericRating, body: "", error: "Reviews must be 4,000 characters or fewer." };
  }

  return { rating: numericRating, body: text, error: "" };
}

export function getReviewsLoadErrorMessage(error) {
  if (isMissingReviewsError(error)) return reviewsNotConfiguredMessage;
  if (typeof error?.message === "string" && error.message) {
    return `We couldn't load your reviews: ${error.message}`;
  }
  return "We couldn't load your reviews. Please try again.";
}

export function getSubmitReviewErrorMessage(error) {
  if (isMissingReviewsError(error)) return reviewsNotConfiguredMessage;
  if (isDuplicateReviewError(error)) return "You have already reviewed this order.";
  if (error?.code === "42501") {
    return "You can only review your own completed orders.";
  }
  if (error?.code === "22023") {
    return typeof error?.message === "string" && error.message
      ? error.message
      : "Only completed orders can be reviewed.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "Your review could not be submitted. Please try again.";
}

export function formatReviewStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (normalized === "pending") return "Pending review";
  if (normalized === "published") return "Published";
  if (normalized === "rejected") return "Rejected";
  return "Under review";
}

export function formatReviewRating(rating) {
  const numericRating = Number(rating);
  if (!Number.isInteger(numericRating) || numericRating < minimumReviewRating || numericRating > maximumReviewRating) {
    return "Not rated";
  }
  return `${"★".repeat(numericRating)}${"☆".repeat(maximumReviewRating - numericRating)}`;
}

// RLS lets a reviewer read only its own rows, so filtering by reviewer_id keeps
// the query aligned with the policy instead of relying on it alone.
export async function getMyReviews(userId) {
  await verifyAuthenticatedUser(userId);
  const { data, error } = await getSupabaseClient()
    .from("reviews")
    .select(reviewColumns)
    .eq("reviewer_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Supabase returned an invalid review list.");
  return data;
}

export async function submitOrderReview({ orderId, rating, body = "" }) {
  if (!orderId) throw new Error("An order ID is required to write a review.");

  const { rating: safeRating, body: safeBody, error: validationError } = validateReviewDraft({ rating, body });
  if (validationError) throw new Error(validationError);

  const { data, error } = await getSupabaseClient()
    .from("reviews")
    .insert({ order_id: orderId, rating: safeRating, body: safeBody })
    .select(reviewColumns)
    .single();

  if (error) throw error;
  if (!data) throw new Error("The review service returned an unexpected response. Please try again.");
  return data;
}
