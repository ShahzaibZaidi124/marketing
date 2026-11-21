import { createClient } from "npm:@supabase/supabase-js@2";
import { getOrderFunctionCors } from "./cors.js";
import { resolveOrderCatalogSelection } from "./catalogSelection.js";
import { parsePlaceOrderBody } from "./validation.js";

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
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
  const cors = getOrderFunctionCors(
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
    return respond({ error: "Use POST to place an order." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond({ error: "Sign in before placing an order." }, 401);

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return respond({ error: "The order request is invalid." }, 400);
  }

  const parsedOrder = parsePlaceOrderBody(parsedBody);
  if (!parsedOrder.value) return respond({ error: parsedOrder.error }, 400);
  const { serviceId, packageId, projectName, orderDescription, requirements } = parsedOrder.value;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Place-order function is missing Supabase server environment configuration.");
    return respond({ error: "Order submission is not configured. Please try again later." }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return respond({ error: "Your session is invalid or expired. Sign in and try again." }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Could not verify the authenticated customer's profile role.", profileError);
    return respond({ error: "Your client account could not be verified. Please try again." }, 500);
  }
  if (!profile || profile.role !== "customer") {
    return respond({ error: "Only signed-in client accounts can place orders." }, 403);
  }

  const { data: service, error: serviceError } = await adminClient
    .from("services")
    .select("id, name, base_price, currency, is_active")
    .eq("id", serviceId)
    .eq("is_active", true)
    .maybeSingle();
  if (serviceError) {
    console.error("Could not load the requested service from the trusted catalog.", serviceError);
    if (isMissingRelationError(serviceError)) {
      return respond({ error: "The service catalog is not configured. Apply the NexTech service catalog migration before accepting orders." }, 503);
    }
    return respond({ error: "The service catalog is temporarily unavailable." }, 500);
  }

  let servicePackage = null;
  let activePackage = null;

  if (packageId) {
    const { data, error: packageError } = await adminClient
      .from("service_packages")
      .select("id, service_id, name, price, currency, is_active")
      .eq("service_id", serviceId)
      .eq("id", packageId)
      .eq("is_active", true)
      .maybeSingle();
    if (packageError) {
      console.error("Could not load the requested package from the trusted catalog.", packageError);
      if (isMissingRelationError(packageError)) {
        return respond({ error: "The service catalog is not configured. Apply the NexTech service catalog migration before accepting orders." }, 503);
      }
      return respond({ error: "The service package is temporarily unavailable." }, 500);
    }
    servicePackage = data;
  } else {
    const { data, error: packageError } = await adminClient
      .from("service_packages")
      .select("id")
      .eq("service_id", serviceId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (packageError) {
      console.error("Could not verify whether the service requires a package selection.", packageError);
      if (isMissingRelationError(packageError)) {
        return respond({ error: "The service catalog is not configured. Apply the NexTech service catalog migration before accepting orders." }, 503);
      }
      return respond({ error: "The service package is temporarily unavailable." }, 500);
    }
    activePackage = data;
  }

  const selection = resolveOrderCatalogSelection({
    service,
    packageId,
    servicePackage,
    activePackageExists: Boolean(activePackage),
  });
  if (!selection.value) {
    return respond({ error: selection.error }, selection.status);
  }
  const { packageName, price, currency } = selection.value;

  const { data: order, error: orderError } = await adminClient
    .from("orders")
    .insert({
      client_id: authData.user.id,
      service_id: service.id,
      service_name: service.name,
      order_description: orderDescription,
      project_name: projectName,
      package_name: packageName,
      status: "pending",
      price,
      currency,
      requirements: requirements ? { notes: requirements } : {},
    })
    .select("id")
    .single();

  if (orderError || !order) {
    console.error("The trusted order insert failed.", orderError);
    if (orderError?.code === "PGRST205" || orderError?.code === "42P01") {
      return respond({ error: "Order storage is not configured. Apply the NexTech orders migration before accepting orders." }, 503);
    }
    return respond({ error: "We couldn't save your order. Please try again." }, 500);
  }

  return respond({ order_id: order.id }, 201);
});
