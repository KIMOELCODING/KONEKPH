import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Admin-only: create a marketing-portal account. Creating an auth user requires
// the service_role key, which must NEVER ship to a browser — so it lives here.
// Flow: verify the caller's JWT belongs to an admin -> create the auth user with
// service_role -> elevate the auto-created profile to role='marketing'.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
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
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const firstName = (body.first_name ?? "").trim().slice(0, 80);
    const lastName = (body.last_name ?? "").trim().slice(0, 80);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "A valid email is required." }, 400);
    }
    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters." }, 400);
    }

    // 3. Create the auth user (service_role). email_confirm so they can sign in
    //    immediately. The on_auth_user_created trigger seeds the profiles row.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (createErr || !created.user) {
      const msg = createErr?.message ?? "Could not create the account.";
      const status = /already|exists|registered/i.test(msg) ? 409 : 400;
      return json({ error: msg }, status);
    }

    // 4. Elevate the auto-created profile to marketing. service_role bypasses RLS
    //    and the 0016 privileged-column guard (auth.uid() is null = trusted path).
    const { error: updErr } = await admin
      .from("profiles")
      .update({
        role: "marketing",
        first_name: firstName,
        last_name: lastName,
        is_approved: true,
        approved_at: new Date().toISOString(),
      })
      .eq("id", created.user.id);
    if (updErr) {
      // Don't leave a half-provisioned account behind.
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: "Failed to set marketing role: " + updErr.message }, 500);
    }

    return json({ ok: true, user_id: created.user.id });
  } catch (err) {
    console.error("create-marketing-user error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
