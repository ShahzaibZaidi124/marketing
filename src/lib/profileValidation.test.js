import assert from "node:assert/strict";
import test from "node:test";
import { validateClientProfileDraft } from "./profileValidation.js";

test("requires a two-character name, a valid username, and a country", () => {
  const missingNameErrors = validateClientProfileDraft({
    fullName: "  ",
    username: "alex",
    country: "Canada",
  }).errors;
  const { errors } = validateClientProfileDraft({
    fullName: " A ",
    username: "ab-",
    country: " ",
    city: "",
    bio: "",
    serviceInterests: "",
    projectInterests: "",
  });

  assert.equal(missingNameErrors.fullName, "Enter your full name.");
  assert.equal(errors.fullName, "Full name must be at least 2 characters.");
  assert.equal(errors.username, "Use 3–20 letters, numbers, or underscores.");
  assert.equal(errors.country, "Enter your country.");
});

test("requires a username and limits it to 3–20 allowed characters", () => {
  const profile = {
    fullName: "Alex",
    username: "",
    country: "Canada",
    city: "",
    bio: "",
    serviceInterests: "",
    projectInterests: "",
  };
  assert.equal(validateClientProfileDraft(profile).errors.username, "Enter a username.");
  assert.equal(
    validateClientProfileDraft({ ...profile, username: "a".repeat(21) }).errors.username,
    "Use 3–20 letters, numbers, or underscores.",
  );
  assert.equal(validateClientProfileDraft({ ...profile, username: "a".repeat(20) }).errors.username, undefined);
});

test("trims and normalizes profile values while leaving optional fields empty", () => {
  const { values, errors } = validateClientProfileDraft({
    fullName: "  Alex Rivera  ",
    username: "  Alex_7 ",
    country: "  Canada ",
    city: "  Toronto ",
    bio: "  Hello there.  ",
    serviceInterests: " Web Development,  Graphic Design \n Video Editing ",
    projectInterests: " React, UX ",
  });

  assert.deepEqual(values, {
    fullName: "Alex Rivera",
    username: "alex_7",
    country: "Canada",
    city: "Toronto",
    bio: "Hello there.",
    serviceInterests: "Web Development, Graphic Design, Video Editing",
    projectInterests: "React, UX",
  });
  assert.deepEqual(errors, {});
});

test("accepts a 300-character bio and rejects a longer bio", () => {
  const base = {
    fullName: "Alex Rivera",
    username: "alex7",
    country: "Canada",
    city: "",
    serviceInterests: "",
    projectInterests: "",
  };
  assert.equal(validateClientProfileDraft({ ...base, bio: "x".repeat(300) }).errors.bio, undefined);
  assert.equal(
    validateClientProfileDraft({ ...base, bio: "x".repeat(301) }).errors.bio,
    "Bio must be 300 characters or fewer.",
  );
});
