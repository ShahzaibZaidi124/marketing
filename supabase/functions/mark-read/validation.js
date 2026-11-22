const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMarkReadBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { value: null, error: "The mark-read request is invalid." };
  }

  const rawConversationId = body.conversation_id;
  const conversationId = rawConversationId === undefined || rawConversationId === null
    ? null
    : (typeof rawConversationId === "string" ? rawConversationId.trim() : "");

  if (conversationId !== null && !uuidPattern.test(conversationId)) {
    return { value: null, error: "Choose a valid conversation." };
  }

  return { value: { conversationId }, error: "" };
}
