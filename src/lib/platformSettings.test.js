// Unit tests for the platform settings data layer: normalization, defaults,
// validation and error mapping. These are pure functions, so they run under the
// Node test runner with no DOM or database.
//
// Run: node --test src/lib/platformSettings.test.js
import assert from "node:assert/strict";
import test from "node:test";
import {
  brandNameWithoutTrailingPeriod,
  defaultPlatformSettings,
  getPlatformSettingsErrorMessage,
  getSavePlatformSettingsErrorMessage,
  isMissingPlatformSettingsError,
  maximumWebsiteDescriptionLength,
  maximumWebsiteNameLength,
  normalizePlatformSettings,
  platformSettingsNotConfiguredMessage,
  validatePlatformSettingsDraft,
  withPlatformSettingsDefaults,
} from "./platformSettings.js";

test("normalizePlatformSettings trims the four fields and drops anything else", () => {
  const normalized = normalizePlatformSettings({
    website_name: "  NexTech  ",
    website_description: "  A marketplace.  ",
    contact_email: "  hello@techstudio.pk  ",
    support_email: "  help@techstudio.pk  ",
    id: true,
    updated_by: "00000000-0000-0000-0000-000000000000",
  });

  assert.deepEqual(normalized, {
    websiteName: "NexTech",
    websiteDescription: "A marketplace.",
    contactEmail: "hello@techstudio.pk",
    supportEmail: "help@techstudio.pk",
  });
  assert.equal("id" in normalized, false);
  assert.equal("updated_by" in normalized, false);
});

test("normalizePlatformSettings renders a missing or invalid payload as empty strings", () => {
  for (const payload of [null, undefined, "nope", 42, []]) {
    assert.deepEqual(normalizePlatformSettings(payload), {
      websiteName: "",
      websiteDescription: "",
      contactEmail: "",
      supportEmail: "",
    });
  }
});

test("withPlatformSettingsDefaults fills empty fields with the shipped defaults", () => {
  const filled = withPlatformSettingsDefaults({
    websiteName: "Studio Nine",
    websiteDescription: "",
    contactEmail: "",
    supportEmail: "",
  });

  assert.equal(filled.websiteName, "Studio Nine");
  assert.equal(filled.websiteDescription, defaultPlatformSettings.websiteDescription);
  assert.equal(filled.contactEmail, defaultPlatformSettings.contactEmail);
  // supportEmail has no shipped default, so it stays empty (the UI falls back to
  // the contact address).
  assert.equal(filled.supportEmail, "");
});

test("validatePlatformSettingsDraft requires a name and trims every field", () => {
  assert.equal(validatePlatformSettingsDraft({}).error, "Enter a website name.");
  assert.equal(
    validatePlatformSettingsDraft({ websiteName: "   " }).error,
    "Enter a website name.",
  );

  const { values, error } = validatePlatformSettingsDraft({
    websiteName: "  NexTech  ",
    websiteDescription: "  hello  ",
    contactEmail: "  hello@techstudio.pk  ",
    supportEmail: "  help@techstudio.pk  ",
  });
  assert.equal(error, "");
  assert.deepEqual(values, {
    websiteName: "NexTech",
    websiteDescription: "hello",
    contactEmail: "hello@techstudio.pk",
    supportEmail: "help@techstudio.pk",
  });
});

test("validatePlatformSettingsDraft enforces the length limits", () => {
  assert.match(
    validatePlatformSettingsDraft({ websiteName: "x".repeat(maximumWebsiteNameLength + 1) }).error,
    /Website names must be/,
  );
  assert.match(
    validatePlatformSettingsDraft({
      websiteName: "NexTech",
      websiteDescription: "x".repeat(maximumWebsiteDescriptionLength + 1),
    }).error,
    /Website descriptions must be/,
  );
  // Exactly at the limit is allowed.
  assert.equal(
    validatePlatformSettingsDraft({ websiteName: "x".repeat(maximumWebsiteNameLength) }).error,
    "",
  );
});

test("validatePlatformSettingsDraft validates emails but allows them to be empty", () => {
  assert.equal(
    validatePlatformSettingsDraft({ websiteName: "NexTech", contactEmail: "not-an-email" }).error,
    "Enter a valid contact email address.",
  );
  assert.equal(
    validatePlatformSettingsDraft({ websiteName: "NexTech", supportEmail: "nope@nope" }).error,
    "Enter a valid support email address.",
  );
  assert.equal(
    validatePlatformSettingsDraft({ websiteName: "NexTech", contactEmail: "", supportEmail: "" }).error,
    "",
  );
  assert.equal(
    validatePlatformSettingsDraft({ websiteName: "NexTech", contactEmail: "a@b.co" }).error,
    "",
  );
});

test("brandNameWithoutTrailingPeriod keeps a single styled period", () => {
  assert.equal(brandNameWithoutTrailingPeriod("NexTech"), "NexTech");
  assert.equal(brandNameWithoutTrailingPeriod("NexTech."), "NexTech");
  assert.equal(brandNameWithoutTrailingPeriod("NexTech..."), "NexTech");
  assert.equal(brandNameWithoutTrailingPeriod("  Studio Nine  "), "Studio Nine");
  // Empty names fall back to the default brand.
  assert.equal(brandNameWithoutTrailingPeriod(""), defaultPlatformSettings.websiteName);
  assert.equal(brandNameWithoutTrailingPeriod(undefined), defaultPlatformSettings.websiteName);
});

test("error messages map missing backend, owner-gate and validation codes", () => {
  for (const code of ["PGRST202", "PGRST205", "42883", "42P01"]) {
    assert.equal(isMissingPlatformSettingsError({ code }), true);
    assert.equal(getPlatformSettingsErrorMessage({ code }), platformSettingsNotConfiguredMessage);
    assert.equal(getSavePlatformSettingsErrorMessage({ code }), platformSettingsNotConfiguredMessage);
  }
  assert.equal(isMissingPlatformSettingsError({ code: "23505" }), false);

  // 42501 is the is_owner() gate.
  assert.equal(getPlatformSettingsErrorMessage({ code: "42501" }), "Only the NexTech owner can manage platform settings.");
  assert.equal(getSavePlatformSettingsErrorMessage({ code: "42501" }), "Only the NexTech owner can manage platform settings.");

  // 22023 is the server-side validation error; its message is passed through.
  assert.equal(
    getSavePlatformSettingsErrorMessage({ code: "22023", message: "Enter a valid contact email address." }),
    "Enter a valid contact email address.",
  );
  assert.match(getSavePlatformSettingsErrorMessage({ code: "22023" }), /could not be saved/);
});
