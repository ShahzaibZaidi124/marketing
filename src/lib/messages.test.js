// Regression guard for the owner inbox read path.
//
// The owner SELECT policies already scope the read to the owner, so
// getOwnerConversations() must send NO filter at all. A stray
// .eq("customer_id", ownerId) silently returns zero rows — the owner's own id
// never matches a customer conversation, and RLS filtering is not an error — so
// the inbox renders "No customer conversations yet" with a healthy database.
// That is exactly the failure these tests prevent from coming back.
//
// Run: node --experimental-test-module-mocks --test src/lib/messages.test.js
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const recorded = [];

// Records every call in the PostgREST builder chain and resolves like a real
// request would. Nothing here touches the network.
const query = new Proxy({}, {
  get(_target, property) {
    if (property === "then") return (resolve) => resolve({ data: [], error: null });
    return (...args) => {
      recorded.push(`.${String(property)}(${args.map((value) => JSON.stringify(value)).join(", ")})`);
      return query;
    };
  },
});

mock.module(new URL("./supabase.js", import.meta.url), {
  exports: {
    getSupabaseClient: () => ({
      from(table) {
        recorded.push(`.from(${JSON.stringify(table)})`);
        return query;
      },
    }),
  },
});

const { getMyConversation, getOwnerConversations, getUnreadCustomerMessages } =
  await import("./messages.js");

const filterCall = /^\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|match|not|or|filter|textSearch)\(/;

test("owner inbox reads every conversation with no filter", async () => {
  recorded.length = 0;
  await getOwnerConversations();

  assert.deepEqual(recorded.filter((call) => filterCall.test(call)), [],
    `getOwnerConversations() must not filter by customer_id: RLS already restricts rows to the owner, so a customer_id filter hides every customer conversation. Sent: ${recorded.join("")}`);
  assert.ok(recorded.includes('.from("conversations")'), "must read the conversations table");
  assert.ok(
    recorded.includes('.order("last_message_at", {"ascending":false,"nullsFirst":false})'),
    "must keep ordering by last_message_at",
  );
});

test("owner unread count is filtered by role, never by customer_id", async () => {
  recorded.length = 0;
  await getUnreadCustomerMessages();

  assert.ok(recorded.includes('.from("messages")'), "must read the messages table");
  assert.ok(recorded.includes('.eq("sender_role", "customer")'), "must count customer messages");
  assert.equal(recorded.some((call) => call.startsWith('.eq("customer_id"')), false,
    "the owner unread query must not be scoped to one customer");
});

test("customer inbox stays scoped to the caller's own customer_id", async () => {
  recorded.length = 0;
  const userId = "9f1b7d3e-0000-4000-8000-000000000001";
  await getMyConversation(userId);

  assert.ok(recorded.includes('.from("conversations")'), "must read the conversations table");
  assert.deepEqual(recorded.filter((call) => filterCall.test(call)),
    [`.eq("customer_id", ${JSON.stringify(userId)})`],
    "the customer query must be scoped to the signed-in customer's own id, and to nothing else");
});
