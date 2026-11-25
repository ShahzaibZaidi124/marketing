import { getSupabaseClient } from "./supabase.js";

// Mirrors public.reports.reason: OPTIONAL, defaults to an empty string, capped at
// 2,000 characters (counted in code points to match char_length()).
export const maximumReportReasonLength = 2000;

// The real target types enforced by public.reports.target_type.
export const reportTargetTypes = ["service", "order"];

// The real category enumeration enforced by public.reports.category.
export const reportCategories = ["spam", "abuse", "fraud", "inappropriate", "other"];

// Human-readable labels for the fixed category values. This is the only place
// the customer picks a category, so the options are the real DB values.
export const reportCategoryOptions = [
  { value: "spam", label: "Spam or misleading" },
  { value: "abuse", label: "Abuse or harassment" },
  { value: "fraud", label: "Fraud or scam" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "other", label: "Something else" },
];

export const reportsNotConfiguredMessage =
  "Reporting is not set up yet. Apply the NexTech customer reports migration, then try again.";

// A report is created by a plain INSERT, and the database does the rest:
//   * the BEFORE INSERT trigger (public.nextech_set_report_identity) derives
//     reporter_id, target_label, status = 'pending' and the resolution fields
//     from the verified JWT and the referenced target, and refuses an inactive
//     or unknown service and an order the caller does not own;
//   * the RLS INSERT policy re-checks that the row is the caller's own and still
//     open before it is stored.
// The browser therefore sends ONLY target_type, target_id, category and reason —
// it can never set reporter_id, target_label, status or a resolution field. No
// reporter identity or target label is read back either.
const reportColumns = "id, target_type, target_id, target_label, category, reason, status, created_at";

// PostgREST reports a missing table or function as PGRST205 / PGRST202; Postgres
// reports the same conditions as 42P01 / 42883.
export function isMissingReportsError(error) {
  return ["PGRST205", "PGRST202", "42P01", "42883"].includes(error?.code ?? "");
}

// 23505 = unique_violation, raised by reports_one_open_per_target_idx (one OPEN
// report per reporter per target).
export function isDuplicateReportError(error) {
  return error?.code === "23505";
}

export function formatReportTargetType(targetType) {
  const normalized = typeof targetType === "string" ? targetType.trim().toLowerCase() : "";
  if (normalized === "service") return "service";
  if (normalized === "order") return "order";
  return "target";
}

// Mirrors the database checks: the target type is 'service' or 'order', the
// target id is present (1–120 characters, as char_length(btrim(target_id))), the
// category is one of the fixed values, and the reason is optional and at most
// 2,000 characters.
export function validateReportDraft({ targetType, targetId, category, reason } = {}) {
  const safeType = typeof targetType === "string" ? targetType.trim().toLowerCase() : "";
  if (!reportTargetTypes.includes(safeType)) {
    return { targetType: "", targetId: "", category: "", reason: "", error: "A report must target a service or an order." };
  }

  const safeId = typeof targetId === "string" ? targetId.trim() : "";
  if (!safeId || safeId.length > 120) {
    return { targetType: safeType, targetId: "", category: "", reason: "", error: "The service or order being reported is missing." };
  }

  const safeCategory = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (!reportCategories.includes(safeCategory)) {
    return { targetType: safeType, targetId: safeId, category: "", reason: "", error: "Choose a report category." };
  }

  const text = typeof reason === "string" ? reason.trim() : "";
  if (Array.from(text).length > maximumReportReasonLength) {
    return { targetType: safeType, targetId: safeId, category: safeCategory, reason: "", error: "Reports must be 2,000 characters or fewer." };
  }

  return { targetType: safeType, targetId: safeId, category: safeCategory, reason: text, error: "" };
}

export function getReportErrorMessage(error) {
  if (isMissingReportsError(error)) return reportsNotConfiguredMessage;
  if (isDuplicateReportError(error)) {
    return "You already have an open report for this service or order. Our team is reviewing it.";
  }
  // 42501 is the identity trigger refusing an order the caller does not own.
  if (error?.code === "42501") return "You can only report your own orders.";
  // 22023 is the identity trigger refusing an unknown/inactive service, a
  // malformed order id, or an invalid category.
  if (error?.code === "22023") {
    return typeof error?.message === "string" && error.message
      ? error.message
      : "This service or order cannot be reported.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "Your report could not be submitted. Please try again.";
}

// The browser sends only the four reporter-written columns. reporter_id,
// target_label, status, resolved_by, resolved_at and resolution_note are derived
// by the database trigger and are never sent or settable from here. A duplicate
// open report for the same target surfaces as a 23505 that the UI explains.
export async function submitReport({ targetType, targetId, category, reason = "" }) {
  const {
    targetType: safeType,
    targetId: safeId,
    category: safeCategory,
    reason: safeReason,
    error: validationError,
  } = validateReportDraft({ targetType, targetId, category, reason });
  if (validationError) throw new Error(validationError);

  const { data, error } = await getSupabaseClient()
    .from("reports")
    .insert({ target_type: safeType, target_id: safeId, category: safeCategory, reason: safeReason })
    .select(reportColumns)
    .single();

  if (error) throw error;
  if (!data) throw new Error("The reporting service returned an unexpected response. Please try again.");
  return data;
}
