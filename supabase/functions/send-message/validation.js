const maximumMessageLength = 4000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Counts code points, matching Postgres char_length() rather than UTF-16 units.
function countCharacters(value) {
  return Array.from(value).length;
}

export function parseSendMessageBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { value: null, error: "The message request is invalid." };
  }

  const messageBody = typeof body.body === "string" ? body.body.trim() : "";

  const rawConversationId = body.conversation_id;
  const conversationId = rawConversationId === undefined || rawConversationId === null
    ? null
    : (typeof rawConversationId === "string" ? rawConversationId.trim() : "");

  if (conversationId !== null && !uuidPattern.test(conversationId)) {
    return { value: null, error: "Choose a valid conversation to reply to." };
  }

  if (!messageBody || countCharacters(messageBody) > maximumMessageLength) {
    return { value: null, error: "Enter a message between 1 and 4,000 characters." };
  }

  return { value: { conversationId, body: messageBody }, error: "" };
}
