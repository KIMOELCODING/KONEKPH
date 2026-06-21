import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Public lead intake for the marketing site. This is the ONLY path that may
// create a `leads` row — migration 0030 revokes the anon direct-insert grant so
// bots can't bypass the form by hitting PostgREST. Every submission must pass:
//   1. honeypot   (hidden `company` field must be empty)
//   2. Cloudflare Turnstile token verification (TURNSTILE_SECRET_KEY)
// before we insert with the service role.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";

interface LeadBody {
  token?: string;
  company?: string; // honeypot — real browsers leave this empty
  marketing_listing_id?: string | null;
  name?: string;
  location?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
}

function clean(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const form = new FormData();
  form.append("secret", TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form },
    );
    const data = await r.json();
    return !!data?.success;
  } catch (err) {
    console.error("Turnstile verify request failed:", err);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json()) as LeadBody;

    // 1. Honeypot — silently accept (so bots don't learn) but insert nothing.
    if (typeof body.company === "string" && body.company.trim() !== "") {
      return json({ ok: true });
    }

    // 2. Turnstile — fail closed if not configured.
    if (!TURNSTILE_SECRET) {
      console.error("TURNSTILE_SECRET_KEY is not set");
      return json({ error: "Verification is not configured. Please try again later." }, 500);
    }
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return json({ error: "Please complete the verification check." }, 400);

    const fwd = req.headers.get("CF-Connecting-IP") ??
      req.headers.get("x-forwarded-for");
    const ip = fwd ? fwd.split(",")[0].trim() : null;
    if (!(await verifyTurnstile(token, ip))) {
      return json({ error: "Verification failed. Please try again." }, 403);
    }

    // 3. Validate + sanitize the lead.
    const name = clean(body.name, 120);
    const email = clean(body.email, 200);
    const phone = clean(body.phone, 40);
    const location = clean(body.location, 160);
    const message = clean(body.message, 1000);
    const mlId = clean(body.marketing_listing_id, 64);

    if (!name) return json({ error: "Please enter your name." }, 400);
    if (!email && !phone) {
      return json({ error: "Please give an email or phone so we can reach you." }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error } = await admin.from("leads").insert({
      marketing_listing_id: mlId,
      name,
      location,
      email,
      phone,
      message,
    });
    if (error) {
      console.error("lead insert failed:", error.message);
      return json({ error: "Could not submit right now. Please try again." }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("submit-lead error:", err);
    return json({ error: "Unexpected error. Please try again." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
