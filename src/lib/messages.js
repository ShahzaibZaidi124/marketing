import { getSupabaseClient } from "./supabase.js";

export const maximumMessageLength = 4000;

export const messagingNotConfiguredMessage =
  "Messaging is not set up yet. Apply the NexTech messaging migration, then try again.";

// Reads go straight to the two messaging tables: RLS lets a customer see only
// their own conversation and the owner see every conversation. Nothing here
// writes — every message and read receipt goes through an Edge Function.
const conversationColumns =
  "id, customer_id, customer_display_name, last_message_at, last_message_preview, created_at, updated_at";

const messageColumns =
  "id, conversation_id, customer_id, sender_id, sender_role, body, created_at, read_at";

// PostgREST reports a missing table or function as PGRST205 / PGRST202; Postgres
// reports the same conditions as 42P01 / 42883.
export function isMissingMessagingError(error) {
  return ["PGRST205", "PGRST202", "42P01", "42883"].includes(error?.code ?? "");
}

// Counts code points so the client limit matches char_length() in the database
// function rather than UTF-16 units.
export function validateMessageDraft(draft) {
  const body = typeof draft === "string" ? draft.trim() : "";
  if (!body) return { value: "", error: "Write a message before sending." };
  if (Array.from(body).length > maximumMessageLength) {
    return { value: "", error: "Messages must be 4,000 characters or fewer." };
  }
  return { value: body, error: "" };
}

export function getMessagesLoadErrorMessage(error) {
  if (isMissingMessagingError(error)) return messagingNotConfiguredMessage;
  if (typeof error?.message === "string" && error.message) {
    return `We couldn't load your messages: ${error.message}`;
  }
  return "We couldn't load your messages. Please try again.";
}

export function getSendMessageErrorMessage(error) {
  if (isMissingMessagingError(error)) return messagingNotConfiguredMessage;
  if (typeof error?.message === "string" && error.message) return error.message;
  return "Your message could not be sent. Please try again.";
}

export function initialsFor(name = "") {
  return String(name).trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0] || "").join("").toUpperCase();
}

export function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Mirrors the messages_conversation_created_idx ordering (created_at, id) so a
// locally merged list matches what the database would return.
export function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    const left = new Date(a?.created_at ?? 0).getTime();
    const right = new Date(b?.created_at ?? 0).getTime();
    if (left !== right) return left - right;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
}

export function sortConversationsByRecency(conversations) {
  return [...conversations].sort((a, b) => {
    const left = a?.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const right = b?.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    if (left !== right) return right - left;
    const leftCreated = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const rightCreated = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return rightCreated - leftCreated;
  });
}

export function countUnreadCustomerMessages(messages) {
  const counts = new Map();
  for (const message of messages ?? []) {
    if (message?.sender_role !== "customer" || message.read_at) continue;
    if (!message.conversation_id) continue;
    counts.set(message.conversation_id, (counts.get(message.conversation_id) ?? 0) + 1);
  }
  return counts;
}

export function resolveCustomerName(conversation, profile) {
  const candidates = [
    conversation?.customer_display_name,
    profile?.full_name,
    profile?.username,
    profile?.email,
  ];
  const name = candidates.find((value) => typeof value === "string" && value.trim());
  return name ? name.trim() : "NexTech customer";
}

// The owner layer is the existing server-side check: public.is_owner() is
// SECURITY DEFINER, owned by postgres, and only reads public.owner_accounts.
// A missing function means "not the owner" rather than "allow".
export async function isOwnerAccount() {
  const { data, error } = await getSupabaseClient().rpc("is_owner");
  if (error) {
    if (isMissingMessagingError(error)) return false;
    throw error;
  }
  return data === true;
}

export async function getMyConversation(userId) {
  const { data, error } = await getSupabaseClient()
    .from("conversations")
    .select(conversationColumns)
    .eq("customer_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function getConversationMessages(conversationId) {
  const { data, error } = await getSupabaseClient()
    .from("messages")
    .select(messageColumns)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getOwnerConversations() {
  const { data, error } = await getSupabaseClient()
    .from("conversations")
    .select(conversationColumns)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getUnreadCustomerMessages() {
  const { data, error } = await getSupabaseClient()
    .from("messages")
    .select("id, conversation_id, sender_role, read_at")
    .eq("sender_role", "customer")
    .is("read_at", null);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getCustomerProfiles(userIds) {
  const uniqueIds = [...new Set((userIds ?? []).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("id, full_name, username, email")
    .in("id", uniqueIds);

  if (error) throw error;
  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

async function readFunctionErrorMessage(response) {
  if (!response || typeof response.clone !== "function") return "";
  try {
    const payload = await response.clone().json();
    return typeof payload?.error === "string" ? payload.error : "";
  } catch {
    return "";
  }
}

// supabase-js surfaces a non-2xx Edge Function response as FunctionsHttpError
// with the raw Response on `context`; the function's own message is in its body.
async function toEdgeFunctionError(error, response, fallback) {
  const message = await readFunctionErrorMessage(error?.context ?? response);
  if (message) return new Error(message);
  if (typeof error?.message === "string" && error.message) return new Error(error.message);
  return new Error(fallback);
}

export async function sendMessage({ conversationId = null, body }) {
  const { data, error, response } = await getSupabaseClient().functions.invoke("send-message", {
    // Omitting conversation_id lets the function create the caller's own
    // conversation; the server never takes the customer id from the client.
    body: conversationId ? { conversation_id: conversationId, body } : { body },
  });

  if (error) {
    throw await toEdgeFunctionError(error, response, "Your message could not be sent. Please try again.");
  }
  if (!data || typeof data.message_id !== "string") {
    throw new Error("The messaging service returned an unexpected response. Please try again.");
  }
  return data;
}

export async function markMessagesRead({ conversationId = null } = {}) {
  const { data, error, response } = await getSupabaseClient().functions.invoke("mark-read", {
    body: conversationId ? { conversation_id: conversationId } : {},
  });

  if (error) {
    throw await toEdgeFunctionError(error, response, "Messages could not be marked as read.");
  }
  const markedRead = typeof data?.marked_read === "number" ? data.marked_read : 0;
  return { markedRead };
}
