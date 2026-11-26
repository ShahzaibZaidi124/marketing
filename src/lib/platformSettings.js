import { getSupabaseClient } from "./supabase.js";

// Platform settings are the four display values the owner can change from
// Admin → Platform Configuration. They live in a single server row and are read
// and written only through owner-gated SECURITY DEFINER RPCs, so the browser
// never talks to the table directly and a non-owner is refused on the server.
export const maximumWebsiteNameLength = 120;
export const maximumWebsiteDescriptionLength = 300;
export const maximumEmailLength = 320;

export const platformSettingsNotConfiguredMessage =
  "Platform settings are not set up yet. Apply the NexTech platform settings migration, then try again.";

// Sensible defaults so the public website never renders an empty brand,
// description or contact email when a value has not been set (or the server is
// unreachable). These match the copy the site shipped with.
export const defaultPlatformSettings = {
  websiteName: "NexTech",
  websiteDescription: "A marketplace connecting great website ideas with talented developers.",
  contactEmail: "hello@techstudio.pk",
  supportEmail: "",
};

// The email shape the server enforces in update_platform_settings(). Kept in sync
// so the client fails fast with the same rule the database applies.
export const platformEmailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// PostgREST reports a missing function/table as PGRST202 / PGRST205; Postgres
// reports the same conditions as 42883 / 42P01. Any of them means the settings
// backend is not in place, which is "not configured" rather than "empty".
export function isMissingPlatformSettingsError(error) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

export function getPlatformSettingsErrorMessage(error) {
  if (isMissingPlatformSettingsError(error)) return platformSettingsNotConfiguredMessage;
  // 42501 is the RPC's own public.is_owner() gate: the caller is not the owner.
  if (error?.code === "42501") return "Only the NexTech owner can manage platform settings.";
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The platform settings could not be loaded. Please try again.";
}

export function getSavePlatformSettingsErrorMessage(error) {
  if (isMissingPlatformSettingsError(error)) return platformSettingsNotConfiguredMessage;
  if (error?.code === "42501") return "Only the NexTech owner can manage platform settings.";
  // 22023 is the RPC's own validation error; its message names the field.
  if (error?.code === "22023") {
    return typeof error?.message === "string" && error.message
      ? error.message
      : "Those settings could not be saved. Check the values and try again.";
  }
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The platform settings could not be saved. Please try again.";
}

// The RPC returns snake_case columns (or a jsonb object with the same keys). The
// shape is normalized so a missing field renders as an empty string instead of
// "undefined", and any unexpected extra field is dropped.
export function normalizePlatformSettings(payload) {
  const row = payload && typeof payload === "object" ? payload : {};
  const read = (key) => (typeof row[key] === "string" ? row[key].trim() : "");
  return {
    websiteName: read("website_name"),
    websiteDescription: read("website_description"),
    contactEmail: read("contact_email"),
    supportEmail: read("support_email"),
  };
}

// Fills every empty field with its built-in default. Used for the public website,
// where an unset value must fall back to sensible copy rather than blank space.
export function withPlatformSettingsDefaults(settings) {
  const merged = { ...defaultPlatformSettings, ...(settings ?? {}) };
  const result = { ...merged };
  for (const key of Object.keys(defaultPlatformSettings)) {
    if (!result[key]) result[key] = defaultPlatformSettings[key];
  }
  return result;
}

// Validates and sanitizes a draft from the settings form. The server enforces the
// same rules; this only fails fast and gives a friendly message.
export function validatePlatformSettingsDraft({
  websiteName,
  websiteDescription = "",
  contactEmail = "",
  supportEmail = "",
} = {}) {
  const name = typeof websiteName === "string" ? websiteName.trim() : "";
  if (!name) return { values: null, error: "Enter a website name." };
  if (Array.from(name).length > maximumWebsiteNameLength) {
    return { values: null, error: `Website names must be ${maximumWebsiteNameLength} characters or fewer.` };
  }

  const description = typeof websiteDescription === "string" ? websiteDescription.trim() : "";
  if (Array.from(description).length > maximumWebsiteDescriptionLength) {
    return { values: null, error: `Website descriptions must be ${maximumWebsiteDescriptionLength} characters or fewer.` };
  }

  const contact = typeof contactEmail === "string" ? contactEmail.trim() : "";
  if (contact) {
    if (Array.from(contact).length > maximumEmailLength) {
      return { values: null, error: `The contact email must be ${maximumEmailLength} characters or fewer.` };
    }
    if (!platformEmailPattern.test(contact)) {
      return { values: null, error: "Enter a valid contact email address." };
    }
  }

  const support = typeof supportEmail === "string" ? supportEmail.trim() : "";
  if (support) {
    if (Array.from(support).length > maximumEmailLength) {
      return { values: null, error: `The support email must be ${maximumEmailLength} characters or fewer.` };
    }
    if (!platformEmailPattern.test(support)) {
      return { values: null, error: "Enter a valid support email address." };
    }
  }

  return {
    values: { websiteName: name, websiteDescription: description, contactEmail: contact, supportEmail: support },
    error: "",
  };
}

// The brand wordmark is rendered with a single styled trailing period. If the
// owner's website name already ends with one (or more), the extra periods are
// dropped so the mark keeps exactly one full stop and the layout is unchanged.
export function brandNameWithoutTrailingPeriod(name) {
  const trimmed = String(name ?? "").trim().replace(/\.+$/, "").trim();
  return trimmed || defaultPlatformSettings.websiteName;
}

// Owner-only read. Authorization is decided entirely on the server by
// public.is_owner(); the browser sends nothing and a non-owner gets 42501.
export async function getPlatformSettings() {
  const { data, error } = await getSupabaseClient().rpc("get_platform_settings");
  if (error) throw error;
  return normalizePlatformSettings(data);
}

// Owner-only write. Only the four display fields are sent; updated_at / updated_by
// are written by the function from the verified JWT.
export async function updatePlatformSettings(draft = {}) {
  const { values, error: validationError } = validatePlatformSettingsDraft(draft);
  if (validationError) throw new Error(validationError);

  const { data, error } = await getSupabaseClient().rpc("update_platform_settings", {
    p_website_name: values.websiteName,
    p_website_description: values.websiteDescription,
    p_contact_email: values.contactEmail,
    p_support_email: values.supportEmail,
  });

  if (error) throw error;
  return normalizePlatformSettings(data);
}

// Public read for the website chrome. Uses the curated projection RPC, which
// exposes only the four displayed values — never the table, never a management
// field, and never any private database information. If the backend is missing or
// unreachable the built-in defaults are used so the site still renders.
export async function getPublicSiteSettings() {
  try {
    const { data, error } = await getSupabaseClient().rpc("public_site_settings");
    if (error) throw error;
    return withPlatformSettingsDefaults(normalizePlatformSettings(data));
  } catch {
    return { ...defaultPlatformSettings };
  }
}
