// Tests for the Admin Reviews (reviews directory) read path.
//
// The directory is read through ONE read-only RPC, public.admin_reviews_directory(),
// which authorizes the caller server-side with has_admin_access() (owner OR
// approved admin) and returns only the review display fields. It never returns
// the reviewer identity (reviewer_id), the moderator identity (moderated_by) or
// any moderation field.
//
// Run: node --experimental-test-module-mocks --test src/lib/adminReviewsDirectory.test.js
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const rpcCalls = [];
let rpcResponder = () => ({ data: null, error: null });

// Stands in for supabase-js: records the RPC name and arguments and resolves like
// a real request. Nothing here touches the network.
mock.module(new URL("./supabase.js", import.meta.url), {
  exports: {
    getSupabaseClient: () => ({
      rpc(name, args) {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResponder(name, args));
      },
    }),
  },
});

const {
  adminReviewsDirectoryNotConfiguredMessage,
  filterAdminReviews,
  getAdminReviewsDirectory,
  getAdminReviewsDirectoryErrorMessage,
  isMissingAdminReviewsDirectoryError,
  normalizeAdminReviews,
} = await import("./adminReviewsDirectory.js");

const reviewRows = [
  {
    id: "8f0e1d2c-3b4a-5968-7788-99aabbccddee",
    service_name: "Web development",
    rating: 5,
    body: "Fast delivery and clear communication.",
    status: "published",
    created_at: "2026-11-22T09:30:00Z",
  },
  {
    id: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
    service_name: "SEO audit",
    rating: 2,
    body: "The report arrived late.",
    status: "pending",
    created_at: "2026-11-23T15:00:00Z",
  },
];

test("the owner reads the live reviews directory", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reviewRows, error: null });

  const reviews = await getAdminReviewsDirectory();

  assert.equal(reviews.length, 2);
  assert.equal(reviews[0].serviceName, "Web development");
  assert.equal(reviews[0].rating, 5);
  assert.equal(reviews[0].status, "published");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_reviews_directory");
});

test("an approved admin uses the same server gate and sends no identity or role", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reviewRows, error: null });

  const reviews = await getAdminReviewsDirectory();

  assert.equal(reviews.length, 2);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "admin_reviews_directory");
  // The owner and an approved admin call the exact same thing: no role, id, or
  // owner flag is ever sent, because the server decides who is allowed.
  assert.equal(
    rpcCalls[0].args,
    undefined,
    "the browser must not send a role, id, or owner flag — authorization is server-side",
  );
});

test("an unauthorized caller is rejected by the server and gets no data", async () => {
  rpcCalls.length = 0;
  const unauthorized = {
    code: "42501",
    message: "The reviews directory is available to the owner and approved admins only.",
  };
  rpcResponder = () => ({ data: null, error: unauthorized });

  await assert.rejects(() => getAdminReviewsDirectory(), (error) => error === unauthorized);
  assert.equal(isMissingAdminReviewsDirectoryError(unauthorized), false);
  assert.match(
    getAdminReviewsDirectoryErrorMessage(unauthorized),
    /Only the NexTech owner and approved admins/,
  );
});

test("an empty reviews directory is an empty list, not an error", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: [], error: null });

  const reviews = await getAdminReviewsDirectory();
  assert.deepEqual(reviews, []);
});

test("review records are returned correctly", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reviewRows, error: null });

  const reviews = await getAdminReviewsDirectory();

  assert.deepEqual(reviews[0], {
    id: "8f0e1d2c-3b4a-5968-7788-99aabbccddee",
    serviceName: "Web development",
    rating: 5,
    body: "Fast delivery and clear communication.",
    status: "published",
    createdAt: "2026-11-22T09:30:00Z",
  });
  assert.equal(reviews[1].status, "pending");
});

test("reviewer and moderator identities and moderation fields are dropped, never shown", () => {
  const reviews = normalizeAdminReviews([{
    id: "8f0e1d2c-3b4a-5968-7788-99aabbccddee",
    service_name: "Web development",
    rating: 5,
    body: "Fast delivery and clear communication.",
    status: "published",
    created_at: "2026-11-22T09:30:00Z",
    // Never expected from the RPC; must be dropped rather than shown if a future
    // change ever leaked them.
    reviewer_id: "should-be-ignored",
    moderated_by: "should-be-ignored",
    moderated_at: "2026-11-23T00:00:00Z",
    moderation_note: "should-be-ignored",
    order_id: "should-be-ignored",
    service_id: "should-be-ignored",
    updated_at: "2026-11-23T00:00:00Z",
    email: "reviewer@example.com",
    access_token: "should-never-appear",
  }]);

  assert.deepEqual(
    Object.keys(reviews[0]).sort(),
    ["body", "createdAt", "id", "rating", "serviceName", "status"],
  );
});

test("a missing or malformed payload renders as an empty directory", () => {
  assert.deepEqual(normalizeAdminReviews(undefined), []);
  assert.deepEqual(normalizeAdminReviews(null), []);
  assert.deepEqual(normalizeAdminReviews({ reviews: reviewRows }), []);
});

test("a non-numeric rating normalizes to zero rather than NaN", () => {
  const reviews = normalizeAdminReviews([{
    id: "x",
    service_name: "Web development",
    rating: "not-a-number",
    body: "",
    status: "pending",
    created_at: "2026-11-22T09:30:00Z",
  }]);

  assert.equal(reviews[0].rating, 0);
});

test("search matches the service name or review text, case-insensitively", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reviewRows, error: null });
  const reviews = await getAdminReviewsDirectory();

  assert.equal(filterAdminReviews(reviews, {}).length, 2);
  assert.deepEqual(filterAdminReviews(reviews, { query: "web" }).map((r) => r.id), [reviewRows[0].id]);
  assert.deepEqual(filterAdminReviews(reviews, { query: "LATE" }).map((r) => r.id), [reviewRows[1].id]);
  assert.deepEqual(filterAdminReviews(reviews, { query: "nobody" }), []);
});

test("status filter uses the real status field only", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reviewRows, error: null });
  const reviews = await getAdminReviewsDirectory();

  assert.deepEqual(filterAdminReviews(reviews, { status: "published" }).map((r) => r.id), [reviewRows[0].id]);
  assert.deepEqual(filterAdminReviews(reviews, { status: "pending" }).map((r) => r.id), [reviewRows[1].id]);
  assert.equal(filterAdminReviews(reviews, { status: "all" }).length, 2);
  // A value that is not a real status must not filter anything out (falls back
  // to "all").
  assert.equal(filterAdminReviews(reviews, { status: "removed" }).length, 2);
});

test("search and status filter combine", async () => {
  rpcCalls.length = 0;
  rpcResponder = () => ({ data: reviewRows, error: null });
  const reviews = await getAdminReviewsDirectory();

  assert.deepEqual(filterAdminReviews(reviews, { query: "web", status: "pending" }), []);
  assert.deepEqual(
    filterAdminReviews(reviews, { query: "web", status: "published" }).map((r) => r.id),
    [reviewRows[0].id],
  );
});

test("a database error surfaces a readable message and is not swallowed", async () => {
  rpcCalls.length = 0;
  const failure = { code: "57014", message: "canceling statement due to statement timeout" };
  rpcResponder = () => ({ data: null, error: failure });

  await assert.rejects(() => getAdminReviewsDirectory(), (error) => error === failure);
  assert.equal(getAdminReviewsDirectoryErrorMessage(failure), "canceling statement due to statement timeout");
});

test("a missing directory migration is reported as not configured, not as empty success", async () => {
  rpcCalls.length = 0;
  const missing = {
    code: "PGRST202",
    message: "Could not find the function public.admin_reviews_directory",
  };
  rpcResponder = () => ({ data: null, error: missing });

  await assert.rejects(() => getAdminReviewsDirectory());
  assert.equal(isMissingAdminReviewsDirectoryError(missing), true);
  assert.equal(
    getAdminReviewsDirectoryErrorMessage(missing),
    adminReviewsDirectoryNotConfiguredMessage,
  );
});
