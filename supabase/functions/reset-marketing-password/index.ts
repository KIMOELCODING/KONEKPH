import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Admin-only: set a new password for a marketing-portal account. Marketing has no
// self-serve forgot-password flow, so when a marketing user is locked out an admin
// resets it here. Changing another user's password requires the service_role key,
// which must NEVER ship to a browser — so it lives in this Edge Function.
// Flow: verify the caller's JWT belongs to an admin -> confirm the target account
// is role='marketing' -> set the new password with service_role.
//
// Scoped to role='marketing' on purpose: this endpoint must not be a path to
// take over an admin or broker account. Brokers reset their own password via the
// email OTP flow in the broker app.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  user_id: string;
  password: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Identify the caller from their JWT and confirm they're an admin.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid token" }, 401);

    const { data: callerProfile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    if (callerProfile?.role !== "admin") {
      return json({ error: "Forbidden — admin only" }, 403);
    }

    // 2. Validate input.
    const body = (await req.json()) as Payload;
    const userId = (body.user_id ?? "").trim();
    const password = body.password ?? "";
    if (!userId) return json({ error: "user_id is required." }, 400);
    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters." }, 400);
    }

    // 3. Confirm the target is a marketing account before touching its password.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (targetErr || !target) {
      return json({ error: "Target account not found." }, 404);
    }
    if (target.role !== "marketing") {
      return json({ error: "This tool only resets marketing accounts." }, 403);
    }

    // 4. Set the new password (service_role). The account already exists and is
    //    email-confirmed, so it can sign in immediately with the new password.
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
    });
    if (updErr) {
      return json({ error: "Could not set the password: " + updErr.message }, 400);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("reset-marketing-password error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
