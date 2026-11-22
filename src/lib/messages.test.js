import assert from "node:assert/strict";
import test from "node:test";
import {
  countUnreadCustomerMessages,
  formatMessageTime,
  getMessagesLoadErrorMessage,
  getSendMessageErrorMessage,
  initialsFor,
  isMissingMessagingError,
  resolveCustomerName,
  sortConversationsByRecency,
  sortMessages,
  validateMessageDraft,
} from "./messages.js";

test("validates message drafts by trimming and enforcing the 4,000 character limit", () => {
  assert.deepEqual(validateMessageDraft("  Hello NexTech  "), { value: "Hello NexTech", error: "" });
  assert.equal(validateMessageDraft("   ").error, "Write a message before sending.");
  assert.equal(validateMessageDraft(undefined).value, "");
  assert.match(validateMessageDraft("a".repeat(4001)).error, /4,000 characters/);
  assert.equal(validateMessageDraft("a".repeat(4000)).error, "");
});

test("detects an unapplied messaging migration and explains each failure", () => {
  assert.equal(isMissingMessagingError({ code: "PGRST205" }), true);
  assert.equal(isMissingMessagingError({ code: "42P01" }), true);
  assert.equal(isMissingMessagingError({ code: "23503" }), false);
  assert.equal(isMissingMessagingError(null), false);
  assert.match(getMessagesLoadErrorMessage({ code: "PGRST205" }), /messaging migration/);
  assert.match(getMessagesLoadErrorMessage(new Error("network down")), /network down/);
  assert.match(getSendMessageErrorMessage(new Error("Not signed in")), /Not signed in/);
});

test("sorts messages by created time then id", () => {
  const sorted = sortMessages([
    { id: "b", created_at: "2026-01-02T10:00:00.000Z" },
    { id: "a", created_at: "2026-01-02T10:00:00.000Z" },
    { id: "c", created_at: "2026-01-02T09:00:00.000Z" },
  ]);
  assert.deepEqual(sorted.map((message) => message.id), ["c", "a", "b"]);
});

test("sorts conversations by most recent activity", () => {
  const sorted = sortConversationsByRecency([
    { id: "old", last_message_at: "2026-01-01T00:00:00.000Z", created_at: "2025-12-01T00:00:00.000Z" },
    { id: "new", last_message_at: "2026-02-01T00:00:00.000Z", created_at: "2025-12-01T00:00:00.000Z" },
    { id: "empty", last_message_at: null, created_at: "2026-03-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(sorted.map((conversation) => conversation.id), ["new", "old", "empty"]);
});

test("counts unread customer messages per conversation", () => {
  const counts = countUnreadCustomerMessages([
    { conversation_id: "c1", sender_role: "customer", read_at: null },
    { conversation_id: "c1", sender_role: "customer", read_at: "2026-01-01T00:00:00.000Z" },
    { conversation_id: "c1", sender_role: "owner", read_at: null },
    { conversation_id: "c2", sender_role: "customer", read_at: null },
  ]);
  assert.equal(counts.get("c1"), 1);
  assert.equal(counts.get("c2"), 1);
  assert.equal(counts.has("c3"), false);
});

test("resolves a customer display name from the available sources", () => {
  assert.equal(resolveCustomerName({ customer_display_name: "Ava Brooks" }, null), "Ava Brooks");
  assert.equal(resolveCustomerName({ customer_display_name: "  " }, { full_name: "Noah James" }), "Noah James");
  assert.equal(resolveCustomerName({}, { email: "mia@example.com" }), "mia@example.com");
  assert.equal(resolveCustomerName(null, null), "NexTech customer");
});

test("builds initials and formats message times for display", () => {
  assert.equal(initialsFor("Ava Brooks"), "AB");
  assert.equal(initialsFor("NexTech"), "N");
  assert.equal(initialsFor(""), "");
  assert.equal(formatMessageTime("not-a-date"), "");
  assert.notEqual(formatMessageTime("2026-01-02T10:00:00.000Z"), "");
});
