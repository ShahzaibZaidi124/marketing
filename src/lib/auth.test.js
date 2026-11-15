import assert from "node:assert/strict";
import test from "node:test";
import {
  duplicateUsernameMessage,
  getClientProfilePictureValidationError,
  getDuplicateUsernameErrorMessage,
} from "./auth.js";

test("maps case-insensitive username unique violations to the profile validation message", () => {
  assert.equal(
    getDuplicateUsernameErrorMessage({
      code: "23505",
      constraint: "profiles_username_normalized_unique_idx",
    }),
    duplicateUsernameMessage,
  );
  assert.equal(
    getDuplicateUsernameErrorMessage({
      code: "23505",
      message: 'duplicate key value violates unique constraint "profiles_username_key"',
    }),
    duplicateUsernameMessage,
  );
});

test("does not map unrelated unique violations to username errors", () => {
  assert.equal(
    getDuplicateUsernameErrorMessage({
      code: "23505",
      constraint: "profiles_pkey",
    }),
    "",
  );
  assert.equal(
    getDuplicateUsernameErrorMessage({
      code: "PGRST116",
      message: "No rows found",
    }),
    "",
  );
});

test("accepts supported profile pictures up to and including 2 MB", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(
      getClientProfilePictureValidationError({ type, size: 2 * 1024 * 1024 }),
      "",
    );
  }
});

test("rejects profile pictures larger than 2 MB", () => {
  assert.equal(
    getClientProfilePictureValidationError({ type: "image/png", size: 2 * 1024 * 1024 + 1 }),
    "Profile pictures must be 2 MB or smaller.",
  );
});

test("rejects unsupported image formats and missing files", () => {
  assert.equal(
    getClientProfilePictureValidationError({ type: "image/gif", size: 100 }),
    "Choose a JPG, PNG, or WebP profile picture.",
  );
  assert.equal(getClientProfilePictureValidationError(null), "Choose a profile picture to upload.");
});
