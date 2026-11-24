const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decisions = ["approved", "rejected"];
const maximumReasonLength = 2000;

// Counts code points, matching Postgres char_length() rather than UTF-16 units.
function countCharacters(value) {
  return Array.from(value).length;
}

// The reviewer identity is NEVER read from the body: it is derived from the
// verified JWT inside the function. Only the application, the decision and an
// optional reason are accepted here.
export function parseReviewAdminApplicationBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { value: null, error: "The review request is invalid." };
  }

  const applicationId = typeof body.application_id === "string" ? body.application_id.trim() : "";
  if (!uuidPattern.test(applicationId)) {
    return { value: null, error: "Choose a valid admin application to review." };
  }

  const decision = typeof body.decision === "string" ? body.decision.trim() : "";
  if (!decisions.includes(decision)) {
    return { value: null, error: "A decision must be either approved or rejected." };
  }

  const reason = body.reason === undefined || body.reason === null
    ? ""
    : (typeof body.reason === "string" ? body.reason.trim() : null);

  if (reason === null || countCharacters(reason) > maximumReasonLength) {
    return { value: null, error: "The decision reason must be 2,000 characters or fewer." };
  }

  return { value: { applicationId, decision, reason }, error: "" };
}
