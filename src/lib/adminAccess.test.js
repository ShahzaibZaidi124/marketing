import assert from "node:assert/strict";
import test from "node:test";
import {
  adminAccessNotConfiguredMessage,
  getAdminApplicationErrorMessage,
  isMissingAdminAccessError,
  validateAdminReason,
} from "./adminAccess.js";

test("requires a non-empty admin reason", () => {
  assert.equal(validateAdminReason("   ").error, "Explain why you need admin access.");
  assert.equal(validateAdminReason(undefined).error, "Explain why you need admin access.");
});

test("accepts and trims a reason up to 2,000 characters", () => {
  const result = validateAdminReason("  I help manage the customer inbox.  ");
  assert.equal(result.error, "");
  assert.equal(result.value, "I help manage the customer inbox.");
  assert.equal(validateAdminReason("x".repeat(2000)).error, "");
});

test("rejects a reason longer than 2,000 characters", () => {
  assert.equal(
    validateAdminReason("x".repeat(2001)).error,
    "Your reason must be 2,000 characters or fewer.",
  );
});

test("treats a missing admin migration as not-configured, not as an allow", () => {
  for (const code of ["PGRST202", "PGRST205", "42P01", "42883"]) {
    assert.equal(isMissingAdminAccessError({ code }), true);
  }
  assert.equal(isMissingAdminAccessError({ code: "23505" }), false);
  assert.equal(getAdminApplicationErrorMessage({ code: "PGRST205" }), adminAccessNotConfiguredMessage);
});

test("maps the duplicate-pending unique violation to a friendly message", () => {
  assert.match(getAdminApplicationErrorMessage({ code: "23505" }), /already have a pending admin access application/);
});
