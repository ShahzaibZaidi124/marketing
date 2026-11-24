// Tests for the Customer Review Submission path (Phase 2).
//
// A customer may review one of their own COMPLETED orders, exactly once, with a
// 1–5 star rating and optional feedback. The browser sends only order_id, rating
// and body: the database trigger derives reviewer_id / status / moderation fields
// and the RLS policies enforce the same rules, so this module never sends an
// identity, a status, or a moderation field, and never updates or deletes.
//
// Run: node --experimental-test-module-mocks --test src/lib/reviews.test.js
import assert from "node:assert/strict";
import test, { mock } from "node:test";

let readResult = { data: [], error: null };
let insertResult = { data: null, error: null };
const insertCalls = [];
const readCalls = [];

// Stands in for supabase-js: a chainable query builder that never touches the
// network, plus the auth.getUser() used by verifyAuthenticatedUser().
function makeQuery() {
  const state = { columns: null, eqs: [], order: null, insert: null };
  const query = {
    select(columns) { state.columns = columns; return query; },
    eq(column, value) { state.eqs.push([column, value]); return query; },
    order(column, options) { state.order = [column, options]; return query; },
    insert(row) { state.insert = row; insertCalls.push(row); return query; },
    single() { return Promise.resolve(insertResult); },
    then(resolve, reject) {
      readCalls.push(state);
      return Promise.resolve(readResult).then(resolve, reject);
    },
  };
  return query;
}

mock.module(new URL("./supabase.js", import.meta.url), {
  exports: {
    getSupabaseClient: () => ({
      from: () => makeQuery(),
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    }),
  },
});

const {
  formatReviewRating,
  formatReviewStatus,
  getMyReviews,
  getReviewsLoadErrorMessage,
  getSubmitReviewErrorMessage,
  isDuplicateReviewError,
  isMissingReviewsError,
  maximumReviewBodyLength,
  reviewsNotConfiguredMessage,
  submitOrderReview,
  validateReviewDraft,
} = await import("./reviews.js");

const reviewRow = {
  id: "8f0e1d2c-3b4a-5968-7788-99aabbccddee",
  order_id: "11111111-2222-3333-4444-555555555555",
  rating: 4,
  body: "Fast delivery and clear communication.",
  status: "pending",
  created_at: "2026-11-25T10:00:00Z",
  updated_at: "2026-11-25T10:00:00Z",
};

test("rating must be an integer from 1 to 5", () => {
  for (const rating of [1, 2, 3, 4, 5]) {
    assert.equal(validateReviewDraft({ rating, body: "" }).error, "");
    assert.equal(validateReviewDraft({ rating, body: "" }).rating, rating);
  }
  for (const rating of [0, 6, -1, 2.5, "abc", null, undefined, ""]) {
    const result = validateReviewDraft({ rating, body: "" });
    assert.equal(result.rating, null);
    assert.match(result.error, /rating from 1 to 5 stars/);
  }
});

test("feedback is optional, trimmed, and limited to 4,000 characters", () => {
  assert.equal(validateReviewDraft({ rating: 5, body: "   " }).body, "");
  assert.equal(validateReviewDraft({ rating: 5, body: "  great  " }).body, "great");
  assert.equal(validateReviewDraft({ rating: 5, body: "a".repeat(maximumReviewBodyLength) }).error, "");
  const tooLong = validateReviewDraft({ rating: 5, body: "a".repeat(maximumReviewBodyLength + 1) });
  assert.match(tooLong.error, /4,000 characters or fewer/);
  assert.equal(tooLong.body, "");
});

test("submitting sends only order_id, rating and body — never an identity or a status", async () => {
  insertCalls.length = 0;
  insertResult = { data: reviewRow, error: null };

  const created = await submitOrderReview({
    orderId: reviewRow.order_id,
    rating: 5,
    body: "  Excellent work.  ",
  });

  assert.equal(insertCalls.length, 1);
  assert.deepEqual(Object.keys(insertCalls[0]).sort(), ["body", "order_id", "rating"]);
  assert.deepEqual(insertCalls[0], {
    order_id: reviewRow.order_id,
    rating: 5,
    body: "Excellent work.",
  });
  assert.equal(created.status, "pending");
});

test("a review must never be submitted without an order or a valid rating", async () => {
  insertCalls.length = 0;
  insertResult = { data: reviewRow, error: null };

  await assert.rejects(() => submitOrderReview({ orderId: "", rating: 5 }), /order ID is required/);
  await assert.rejects(() => submitOrderReview({ orderId: reviewRow.order_id, rating: 9 }), /rating from 1 to 5 stars/);
  assert.equal(insertCalls.length, 0);
});

test("a duplicate review is detected and explained, not swallowed", async () => {
  const duplicate = {
    code: "23505",
    message: 'duplicate key value violates unique constraint "reviews_order_id_key"',
  };
  insertCalls.length = 0;
  insertResult = { data: null, error: duplicate };

  await assert.rejects(
    () => submitOrderReview({ orderId: reviewRow.order_id, rating: 5 }),
    (error) => error === duplicate,
  );
  assert.equal(isDuplicateReviewError(duplicate), true);
  assert.equal(isDuplicateReviewError({ code: "42501" }), false);
  assert.equal(getSubmitReviewErrorMessage(duplicate), "You have already reviewed this order.");
});

test("server-side eligibility failures keep their meaning", () => {
  assert.equal(
    getSubmitReviewErrorMessage({ code: "42501" }),
    "You can only review your own completed orders.",
  );
  assert.equal(
    getSubmitReviewErrorMessage({ code: "22023", message: "Only completed orders can be reviewed." }),
    "Only completed orders can be reviewed.",
  );
});

test("the customer reads only their own reviews", async () => {
  readCalls.length = 0;
  readResult = { data: [reviewRow], error: null };

  const reviews = await getMyReviews("user-1");

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].status, "pending");
  assert.equal(readCalls.length, 1);
  assert.deepEqual(readCalls[0].eqs, [["reviewer_id", "user-1"]]);
  assert.deepEqual(readCalls[0].order, ["created_at", { ascending: false }]);
  // Moderation identities are never requested or returned.
  assert.doesNotMatch(readCalls[0].columns, /moderated/);
});

test("a malformed review list is an error, not an empty success", async () => {
  readResult = { data: null, error: null };
  await assert.rejects(() => getMyReviews("user-1"), /invalid review list/);
});

test("a missing reviews migration is reported as not configured, not as empty success", () => {
  const missing = { code: "PGRST202", message: "Could not find the table public.reviews" };
  assert.equal(isMissingReviewsError(missing), true);
  assert.equal(isMissingReviewsError({ code: "23505" }), false);
  assert.equal(getReviewsLoadErrorMessage(missing), reviewsNotConfiguredMessage);
  assert.equal(getSubmitReviewErrorMessage(missing), reviewsNotConfiguredMessage);
});

test("display helpers render the rating and moderation status", () => {
  assert.equal(formatReviewRating(5), "★★★★★");
  assert.equal(formatReviewRating(3), "★★★☆☆");
  assert.equal(formatReviewRating(0), "Not rated");
  assert.equal(formatReviewRating("x"), "Not rated");
  assert.equal(formatReviewStatus("pending"), "Pending review");
  assert.equal(formatReviewStatus("published"), "Published");
  assert.equal(formatReviewStatus("rejected"), "Rejected");
});

test("submitted reviews cannot be edited or deleted from the client", async () => {
  const reviews = await import("./reviews.js");
  for (const name of Object.keys(reviews)) {
    assert.doesNotMatch(name, /update|delete|remove|edit|moderate/i);
  }
});
