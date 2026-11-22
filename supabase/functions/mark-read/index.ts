import { createClient } from "npm:@supabase/supabase-js@2";
import { getMessageFunctionCors } from "./cors.js";
import { parseMarkReadBody } from "./validation.js";

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

// PostgREST reports an unknown table as PGRST205; Postgres reports it as 42P01.
function isMissingRelationError(error: { code?: string } | null | undefined) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

Deno.serve(async (request) => {
  const cors = getMessageFunctionCors(
    request.headers.get("Origin"),
    Deno.env.get("CORS_ALLOWED_ORIGINS") || "",
  );

  const respond = (body: Record<string, unknown>, status: number) => (
    jsonResponse(body, status, cors.headers)
  );

  if (!cors.allowed) {
    return respond({ error: "This application origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors.headers });
  }
  if (request.method !== "POST") {
    return respond({ error: "Use POST to mark messages as read." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond({ error: "Sign in before updating messages." }, 401);

  // An absent body means "mark my own incoming messages as read".
  let parsedBody: unknown = {};
  const rawBody = await request.text();
  if (rawBody.trim()) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return respond({ error: "The mark-read request is invalid." }, 400);
    }
  }

  const parsedRequest = parseMarkReadBody(parsedBody);
  if (!parsedRequest.value) return respond({ error: parsedRequest.error }, 400);
  const { conversationId } = parsedRequest.value;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Mark-read function is missing Supabase server environment configuration.");
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

  // The service-role client bypasses RLS, so the update scope is derived here from
  // the verified JWT identity and never from anything the caller controls.
  const { data: ownerAccount, error: ownerError } = await adminClient
    .from("owner_accounts")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (ownerError) {
    if (isMissingRelationError(ownerError)) {
      return respond({ error: notConfiguredMessage }, 503);
    }
    console.error("Could not verify owner membership.", ownerError);
    return respond({ error: "Your account could not be verified. Please try again." }, 500);
  }

  const readAt = new Date().toISOString();

  if (ownerAccount) {
    // Owner: mark the customer messages of one conversation as read.
    if (!conversationId) {
      return respond({ error: "Choose a conversation to update." }, 400);
    }

    const { data: conversation, error: conversationError } = await adminClient
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();

    if (conversationError) {
      console.error("Could not load the conversation to update.", conversationError);
      if (isMissingRelationError(conversationError)) {
        return respond({ error: notConfiguredMessage }, 503);
      }
      return respond({ error: "That conversation could not be updated. Please try again." }, 500);
    }
    if (!conversation) {
      return respond({ error: "That conversation no longer exists." }, 404);
    }

    const { data: updated, error: updateError } = await adminClient
      .from("messages")
      .update({ read_at: readAt })
      .eq("conversation_id", conversationId)
      .eq("sender_role", "customer")
      .is("read_at", null)
      .select("id");

    if (updateError) {
      if (isMissingRelationError(updateError)) {
        return respond({ error: notConfiguredMessage }, 503);
      }
      console.error("Could not mark customer messages as read.", updateError);
      return respond({ error: "Messages could not be updated. Please try again." }, 500);
    }

    return respond({ marked_read: updated?.length ?? 0 }, 200);
  }

  // Customer: only ever their own conversation, and only the owner's messages.
  let customerUpdate = adminClient
    .from("messages")
    .update({ read_at: readAt })
    .eq("customer_id", userId)
    .eq("sender_role", "owner")
    .is("read_at", null);

  if (conversationId) {
    customerUpdate = customerUpdate.eq("conversation_id", conversationId);
  }

  const { data: updated, error: updateError } = await customerUpdate.select("id");

  if (updateError) {
    if (isMissingRelationError(updateError)) {
      return respond({ error: notConfiguredMessage }, 503);
    }
    console.error("Could not mark owner messages as read.", updateError);
    return respond({ error: "Messages could not be updated. Please try again." }, 500);
  }

  return respond({ marked_read: updated?.length ?? 0 }, 200);
});
