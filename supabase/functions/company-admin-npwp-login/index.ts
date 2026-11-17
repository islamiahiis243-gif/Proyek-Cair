const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const INVALID_CREDENTIALS = "NPWP atau kata sandi tidak valid.";
const TEMPORARY_FAILURE = "Layanan masuk sementara tidak tersedia.";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function readKeyMap(name: string): string | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.default === "string" ? parsed.default : null;
  } catch {
    return null;
  }
}

function getClientIp(req: Request): string | null {
  // Cloudflare overwrites this edge header. Do not trust caller-supplied
  // x-forwarded-for or x-real-ip values for an authentication rate-limit key.
  const candidate = req.headers.get("cf-connecting-ip")?.trim() || "";
  if (!candidate || candidate.length > 64 || !/^[0-9a-fA-F:.]+$/.test(candidate)) return null;
  return candidate;
}

function isAllowedPublicApiKey(req: Request): boolean {
  const supplied = req.headers.get("apikey") || "";
  if (!supplied) return false;
  const allowed = [
    readKeyMap("SUPABASE_PUBLISHABLE_KEYS"),
    Deno.env.get("SUPABASE_ANON_KEY"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return allowed.some((key) => key === supplied);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  // Opaque sb_publishable keys are not JWTs. The function is deployed with
  // verify_jwt=false and validates the project's public API key explicitly.
  if (!isAllowedPublicApiKey(req)) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (declaredLength > 4096) return jsonResponse(413, { error: INVALID_CREDENTIALS });

  let body: Record<string, unknown>;
  try {
    const rawBody = await req.text();
    if (rawBody.length > 4096) return jsonResponse(413, { error: INVALID_CREDENTIALS });
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(400, { error: INVALID_CREDENTIALS });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: INVALID_CREDENTIALS });
  }

  const npwp = typeof body.npwp === "string" ? body.npwp.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (npwp.length > 32 || password.length > 256) {
    return jsonResponse(401, { error: INVALID_CREDENTIALS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const secretKey = readKeyMap("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = readKeyMap("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY");
  const clientIp = getClientIp(req);

  if (!supabaseUrl || !secretKey || !publishableKey || !clientIp) {
    return jsonResponse(503, { error: TEMPORARY_FAILURE });
  }

  const secretIsNewFormat = secretKey.startsWith("sb_secret_");
  const serverHeaders: Record<string, string> = {
    apikey: secretKey,
    "Content-Type": "application/json",
  };
  if (!secretIsNewFormat) serverHeaders.Authorization = `Bearer ${secretKey}`;

  const recordLoginEvent = async (
    outcome: "SUCCESS" | "INVALID_CREDENTIALS" | "RATE_LIMITED" | "AUTH_SERVICE_ERROR",
    authUserId: string | null = null,
    companyId: string | null = null,
  ): Promise<boolean> => {
    try {
      const auditResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/record_company_admin_npwp_login_event`, {
        method: "POST",
        headers: serverHeaders,
        body: JSON.stringify({
          p_npwp: npwp,
          p_client_ip: clientIp,
          p_outcome: outcome,
          p_auth_user_id: authUserId,
          p_company_id: companyId,
        }),
      });
      return auditResponse.ok;
    } catch {
      return false;
    }
  };

  let broker: { allowed?: boolean; email?: string | null; user_id?: string | null; company_id?: string | null };
  try {
    const brokerResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_company_admin_npwp_login`, {
      method: "POST",
      headers: serverHeaders,
      body: JSON.stringify({ p_npwp: npwp, p_client_ip: clientIp }),
    });
    if (!brokerResponse.ok) return jsonResponse(503, { error: TEMPORARY_FAILURE });
    broker = await brokerResponse.json();
  } catch {
    return jsonResponse(503, { error: TEMPORARY_FAILURE });
  }

  if (broker.allowed !== true) {
    if (!(await recordLoginEvent("RATE_LIMITED"))) {
      return jsonResponse(503, { error: TEMPORARY_FAILURE });
    }
    return jsonResponse(429, { error: "Terlalu banyak percobaan. Coba lagi nanti." });
  }

  // Always call Supabase Auth, even for an unknown NPWP, to reduce identifier-enumeration timing signals.
  const resolvedEmail = typeof broker.email === "string" ? broker.email : null;
  const authIdentifier = resolvedEmail || "npwp-login-invalid@invalid.example";
  const authHeaders: Record<string, string> = {
    apikey: secretIsNewFormat ? secretKey : publishableKey,
    "Content-Type": "application/json",
  };
  if (secretIsNewFormat) authHeaders["Sb-Forwarded-For"] = clientIp;

  let authResponse: Response;
  try {
    authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ email: authIdentifier, password }),
    });
  } catch {
    await recordLoginEvent("AUTH_SERVICE_ERROR");
    return jsonResponse(503, { error: TEMPORARY_FAILURE });
  }

  if (authResponse.status === 429) {
    if (!(await recordLoginEvent("RATE_LIMITED"))) {
      return jsonResponse(503, { error: TEMPORARY_FAILURE });
    }
    return jsonResponse(429, { error: "Terlalu banyak percobaan. Coba lagi nanti." });
  }

  if (!resolvedEmail || !authResponse.ok) {
    if (!(await recordLoginEvent("INVALID_CREDENTIALS"))) {
      return jsonResponse(503, { error: TEMPORARY_FAILURE });
    }
    return jsonResponse(401, { error: INVALID_CREDENTIALS });
  }

  let session: Record<string, any>;
  try {
    session = await authResponse.json();
  } catch {
    await recordLoginEvent("AUTH_SERVICE_ERROR");
    return jsonResponse(503, { error: TEMPORARY_FAILURE });
  }
  if (
    typeof session.access_token !== "string" ||
    typeof session.refresh_token !== "string" ||
    typeof session.user?.id !== "string" ||
    typeof broker.user_id !== "string" ||
    typeof broker.company_id !== "string" ||
    session.user.id !== broker.user_id
  ) {
    await recordLoginEvent("AUTH_SERVICE_ERROR");
    return jsonResponse(503, { error: TEMPORARY_FAILURE });
  }

  // Record a successful authentication against the still-active seat before releasing tokens.
  if (!(await recordLoginEvent("SUCCESS", session.user.id, broker.company_id))) {
    return jsonResponse(503, { error: TEMPORARY_FAILURE });
  }

  // The Auth response is returned only after the server-side NPWP->seat lookup,
  // Supabase Auth password verification, and successful audit write.
  return jsonResponse(200, session);
});
