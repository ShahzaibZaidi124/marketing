import { createClient } from "npm:@supabase/supabase-js@2";
import { getReviewAdminApplicationCors } from "./cors.js";
import { parseReviewAdminApplicationBody } from "./validation.js";

const notConfiguredMessage =
  "Admin access review is not configured yet. Apply the NexTech admin access migration and redeploy this function.";

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
  const cors = getReviewAdminApplicationCors(
    request.headers.get("Origin"),
    Deno.env.get("CORS_ALLOWED_ORIGINS") || "",
  );

  const respond = (body: Record<string, unknown>, status: number) => (
    jsonResponse(body, status, cors.headers)
  );

  // Every branch below is a failure: success is only returned after the database
  // function records the decision. The database re-checks ownership, so a forged
  // request can never decide an application even if it reaches the RPC.
  const respondToRpcError = (
    error: { code?: string; message?: string } | null | undefined,
    context: string,
  ) => {
    if (isMissingDatabaseObjectError(error)) {
      return respond({ error: notConfiguredMessage }, 503);
    }

    switch (error?.code) {
      case "22023":
        return respond({ error: "That application has already been reviewed or the request is invalid." }, 409);
      case "42501":
        return respond({ error: "Only the NexTech owner can review admin applications." }, 403);
      case "P0002":
        return respond({ error: "That admin application no longer exists." }, 404);
      default:
        console.error(context, error);
        return respond({ error: "The decision could not be saved. Please try again." }, 500);
    }
  };

  if (!cors.allowed) {
    return respond({ error: "This application origin is not allowed." }, 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors.headers });
  }
  if (request.method !== "POST") {
    return respond({ error: "Use POST to review an admin application." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond({ error: "Sign in before reviewing admin applications." }, 401);

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return respond({ error: "The review request is invalid." }, 400);
  }

  const parsedReview = parseReviewAdminApplicationBody(parsedBody);
  if (!parsedReview.value) return respond({ error: parsedReview.error }, 400);
  const { applicationId, decision, reason } = parsedReview.value;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Review-admin-application function is missing Supabase server environment configuration.");
    return respond({ error: "Admin access review is not configured. Please try again later." }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return respond({ error: "Your session is invalid or expired. Sign in and try again." }, 401);
  }

  // The reviewer identity comes from the verified JWT, never from the request body.
  const reviewerId = authData.user.id;
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Owner check happens server-side against owner_accounts: the caller cannot
  // choose whether the owner path runs. review_admin_application() re-checks the
  // same membership inside the database, so this is defence in depth.
  const { data: ownerAccount, error: ownerError } = await adminClient
    .from("owner_accounts")
    .select("user_id")
    .eq("user_id", reviewerId)
    .maybeSingle();

  if (ownerError) {
    if (isMissingDatabaseObjectError(ownerError)) {
      return respond({ error: notConfiguredMessage }, 503);
    }
    console.error("Could not verify owner membership.", ownerError);
    return respond({ error: "Your account could not be verified. Please try again." }, 500);
  }

  if (!ownerAccount) {
    return respond({ error: "Only the NexTech owner can review admin applications." }, 403);
  }

  const { data: application, error: reviewError } = await adminClient.rpc("review_admin_application", {
    p_application_id: applicationId,
    p_decision: decision,
    p_reviewer_id: reviewerId,
    p_reason: reason,
  });

  if (reviewError) return respondToRpcError(reviewError, "Admin application review failed.");

  return respond({ application }, 200);
});
