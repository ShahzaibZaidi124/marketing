import assert from "node:assert/strict";
import test from "node:test";
import { getClientProfilePictureValidationError } from "./auth.js";

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
