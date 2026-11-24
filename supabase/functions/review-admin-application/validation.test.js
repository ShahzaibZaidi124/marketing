import assert from "node:assert/strict";
import test from "node:test";
import { parseReviewAdminApplicationBody } from "./validation.js";

const applicationId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("accepts an approved decision and normalizes the reason", () => {
  const result = parseReviewAdminApplicationBody({
    application_id: ` ${applicationId} `,
    decision: " approved ",
    reason: "  Trusted teammate.  ",
  });

  assert.equal(result.error, "");
  assert.deepEqual(result.value, {
    applicationId,
    decision: "approved",
    reason: "Trusted teammate.",
  });
});

test("accepts a rejection without a reason", () => {
  const result = parseReviewAdminApplicationBody({
    application_id: applicationId,
    decision: "rejected",
  });

  assert.equal(result.error, "");
  assert.deepEqual(result.value, { applicationId, decision: "rejected", reason: "" });
});

test("rejects malformed review requests", () => {
  assert.match(parseReviewAdminApplicationBody([]).error, /request is invalid/);
  assert.match(
    parseReviewAdminApplicationBody({ application_id: "not-a-uuid", decision: "approved" }).error,
    /valid admin application/,
  );
  assert.match(
    parseReviewAdminApplicationBody({ application_id: applicationId, decision: "maybe" }).error,
    /approved or rejected/,
  );
  assert.match(
    parseReviewAdminApplicationBody({
      application_id: applicationId,
      decision: "approved",
      reason: "x".repeat(2001),
    }).error,
    /2,000 characters or fewer/,
  );
});

test("ignores a client-supplied reviewer identity and extra fields", () => {
  const result = parseReviewAdminApplicationBody({
    application_id: applicationId,
    decision: "approved",
    reason: "ok",
    reviewer_id: "00000000-0000-0000-0000-000000000000",
    status: "approved",
  });

  assert.equal(result.error, "");
  assert.deepEqual(Object.keys(result.value).sort(), ["applicationId", "decision", "reason"]);
});
