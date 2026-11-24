import { getSupabaseClient } from "./supabase.js";

export const maximumAdminReasonLength = 2000;

export const adminAccessNotConfiguredMessage =
  "Admin access is not set up yet. Apply the NexTech admin access migration, then try again.";

// Reads go straight to admin_applications: RLS lets an applicant see only their own
// rows and the owner see every row. Every decision is written by the
// review-admin-application Edge Function, never from the browser.
const applicationColumns =
  "id, applicant_id, applicant_name, email, reason, status, reviewed_by, reviewed_at, decision_reason, created_at, updated_at";

// PostgREST reports a missing table or function as PGRST205 / PGRST202; Postgres
// reports the same conditions as 42P01 / 42883.
export function isMissingAdminAccessError(error) {
  return ["PGRST205", "PGRST202", "42P01", "42883"].includes(error?.code ?? "");
}

// Counts code points so the client limit matches char_length() in the database
// rather than UTF-16 units.
export function validateAdminReason(reason) {
  const value = typeof reason === "string" ? reason.trim() : "";
  if (!value) return { value: "", error: "Explain why you need admin access." };
  if (Array.from(value).length > maximumAdminReasonLength) {
    return { value: "", error: "Your reason must be 2,000 characters or fewer." };
  }
  return { value, error: "" };
}

export function getAdminApplicationErrorMessage(error) {
  if (isMissingAdminAccessError(error)) return adminAccessNotConfiguredMessage;
  // 23505 is the duplicate-pending partial unique index: one pending row per applicant.
  if (error?.code === "23505") {
    return "You already have a pending admin access application. Wait for the owner to review it.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "Your application could not be submitted. Please try again.";
}

// public.has_admin_access() is the server-side gate: the owner is always true and an
// approved admin is true. A missing function means "no access" rather than "allow".
export async function hasAdminAccess() {
  const { data, error } = await getSupabaseClient().rpc("has_admin_access");
  if (error) {
    if (isMissingAdminAccessError(error)) return false;
    throw error;
  }
  return data === true;
}

export async function getMyAdminApplication(userId) {
  if (!userId) return null;

  const { data, error } = await getSupabaseClient()
    .from("admin_applications")
    .select(applicationColumns)
    .eq("applicant_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

// Only the applicant name and reason are sent: the applicant id, email and status are
// written by a BEFORE INSERT database trigger from the verified JWT, so the browser
// cannot choose who it is applying as or pre-approve itself.
export async function submitAdminApplication({ applicantName, reason }) {
  const { data, error } = await getSupabaseClient()
    .from("admin_applications")
    .insert({
      applicant_name: applicantName.trim(),
      reason: reason.trim(),
    })
    .select(applicationColumns)
    .single();

  if (error) throw error;
  return data;
}

// Owner-only read of every application. RLS "Owners read all admin applications"
// returns every row to the owner; a non-owner only ever sees their own rows.
export async function listAdminApplications() {
  const { data, error } = await getSupabaseClient()
    .from("admin_applications")
    .select(applicationColumns)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function readFunctionErrorMessage(response) {
  if (!response || typeof response.clone !== "function") return "";
  try {
    const payload = await response.clone().json();
    return typeof payload?.error === "string" ? payload.error : "";
  } catch {
    return "";
  }
}

// supabase-js surfaces a non-2xx Edge Function response as FunctionsHttpError with the
// raw Response on `context`; the function's own message is in its body.
export async function reviewAdminApplication({ applicationId, decision, reason = "" }) {
  const { data, error, response } = await getSupabaseClient().functions.invoke(
    "review-admin-application",
    { body: { application_id: applicationId, decision, reason } },
  );

  if (error) {
    const message = await readFunctionErrorMessage(error?.context ?? response);
    if (message) throw new Error(message);
    if (typeof error?.message === "string" && error.message) throw new Error(error.message);
    throw new Error("The decision could not be saved. Please try again.");
  }
  if (!data || !data.application) {
    throw new Error("The review service returned an unexpected response. Please try again.");
  }
  return data.application;
}

export function adminApplicationStatusLabel(status) {
  switch (status) {
    case "approved": return "Approved";
    case "rejected": return "Rejected";
    case "pending": return "Pending review";
    default: return "Unknown";
  }
}

export function formatAdminApplicationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
