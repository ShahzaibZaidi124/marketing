import { createClient } from "npm:@supabase/supabase-js@2";
import { getMessageFunctionCors } from "./cors.js";
import { parseSendMessageBody } from "./validation.js";

const notConfiguredMessage =
  "Messaging is not configured yet. Apply the NexTech messaging migration and redeploy this function.";

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// PostgREST reports an unknown table or function as PGRST205 / PGRST202;
// Postgres reports the same conditions as 42P01 / 42883.
function isMissingDatabaseObjectError(error: { code?: string } | null | undefined) {
  return ["PGRST202", "PGRST205", "42883", "42P01"].includes(error?.code ?? "");
}

Deno.serve(async (request) => {
  const cors = getMessageFunctionCors(
    request.headers.get("Origin"),
    Deno.env.get("CORS_ALLOWED_ORIGINS") || "",
  );

  const respond = (body: Record<string, unknown>, status: number) => (
    jsonResponse(body, status, cors.headers)
  );

  // Every branch below is a failure: success is only ever returned after the
  // database function has returned a message id.
  const respondToRpcError = (
    error: { code?: string; message?: string } | null | undefined,
    context: string,
  ) => {
    if (isMissingDatabaseObjectError(error)) {
      return respond({ error: notConfiguredMessage }, 503);
    }

    switch (error?.code) {
      case "22023":
        return respond({ error: "Enter a message between 1 and 4,000 characters." }, 400);
      case "42501":
        return respond({ error: "You are not allowed to send this message." }, 403);
      case "P0002":
        return respond({ error: "That conversation no longer exists." }, 404);
      default:
        console.error(context, error);
        return respond({ error: "Your message could not be sent. Please try again." }, 500);
    }
  };

  if (!cors.allowed) {
    return respond({ error: "This application origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors.headers });
  }
  if (request.method !== "POST") {
    return respond({ error: "Use POST to send a message." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond({ error: "Sign in before sending a message." }, 401);

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return respond({ error: "The message request is invalid." }, 400);
  }

  const parsedMessage = parseSendMessageBody(parsedBody);
  if (!parsedMessage.value) return respond({ error: parsedMessage.error }, 400);
  const { conversationId, body } = parsedMessage.value;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Send-message function is missing Supabase server environment configuration.");
    return respond({ error: "Messaging is not configured. Please try again later." }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return respond({ error: "Your session is invalid or expired. Sign in and try again." }, 401);
  }

  const userId = authData.user.id;
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The identity comes from the verified JWT, never from the request body, and the
  // owner lookup happens server-side: the caller cannot choose which path runs.
  const { data: ownerAccount, error: ownerError } = await adminClient
    .from("owner_accounts")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (ownerError) {
    if (isMissingDatabaseObjectError(ownerError)) {
      return respond({ error: notConfiguredMessage }, 503);
    }
    console.error("Could not verify owner membership.", ownerError);
    return respond({ error: "Your account could not be verified. Please try again." }, 500);
  }

  if (ownerAccount) {
    // Owner path: reply into an existing conversation only. The database function
    // re-checks owner membership and refuses to create a conversation.
    if (!conversationId) {
      return respond({ error: "Choose a conversation to reply to." }, 400);
    }

    const { data: messageId, error: replyError } = await adminClient.rpc("append_message", {
      p_conversation_id: conversationId,
      p_sender_id: userId,
      p_sender_role: "owner",
      p_body: body,
    });

    if (replyError) return respondToRpcError(replyError, "Owner reply failed.");

    return respond({ message_id: messageId, conversation_id: conversationId }, 201);
  }

  // Customer path: the database creates or reuses this customer's own conversation.
  const { data: messageId, error: sendError } = await adminClient.rpc("send_customer_message", {
    p_sender_id: userId,
    p_body: body,
  });

  if (sendError) return respondToRpcError(sendError, "Customer message failed.");

  return respond({ message_id: messageId }, 201);
});
