import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Action =
  | "approved"
  | "rejected"
  | "new_signup"
  | "reapply"
  | "new_listing"
  | "listing_approved"
  | "listing_rejected";

interface Payload {
  broker_id: string;
  action: Action;
  reason?: string;
  listing_id?: string;
}

const SMTP_USER = Deno.env.get("SMTP_USER")!;
const SMTP_PASS = Deno.env.get("SMTP_PASS")!;
const FROM_NAME = Deno.env.get("SMTP_FROM_NAME") ?? "Konek.PH";
const APP_URL = Deno.env.get("APP_URL") ?? "https://app.konek.ph";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "konekph2026@gmail.com";
const ADMIN_URL = Deno.env.get("ADMIN_URL") ?? "https://admin.konek.ph";

interface Broker {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  license_number: string | null;
}

function renderBrokerEmail(action: "approved" | "rejected", name: string, reason?: string) {
  if (action === "approved") {
    return {
      subject: "Your Konek.PH broker account has been approved",
      text:
        `Hi ${name},\n\n` +
        `Good news — your Konek.PH broker account has been approved. ` +
        `You can now sign in and start using the platform.\n\n` +
        `Sign in: ${APP_URL}\n\n` +
        `— The Konek.PH Team`,
    };
  }
  return {
    subject: "Update on your Konek.PH broker application",
    text:
      `Hi ${name},\n\n` +
      `Thank you for applying to Konek.PH. After review, we were unable to ` +
      `approve your application at this time.\n\n` +
      (reason ? `Reason from our team:\n${reason}\n\n` : "") +
      `You may sign back in to update your details and resubmit your ` +
      `application: ${APP_URL}\n\n` +
      `— The Konek.PH Team`,
  };
}

function renderAdminEmail(b: Broker) {
  const name = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "(no name)";
  return {
    subject: `New broker application: ${name}`,
    text:
      `A new broker has signed up and is awaiting your review.\n\n` +
      `Name:    ${name}\n` +
      `Email:   ${b.email ?? "—"}\n` +
      `Phone:   ${b.phone ?? "—"}\n` +
      `License: ${b.license_number ?? "—"}\n\n` +
      `Review pending applications: ${ADMIN_URL}\n\n` +
      `— Konek.PH`,
  };
}

function renderListingEmail(
  action: "listing_approved" | "listing_rejected",
  name: string,
  listingTitle: string,
  reason?: string,
) {
  if (action === "listing_approved") {
    return {
      subject: `Your listing "${listingTitle}" has been approved`,
      text:
        `Hi ${name},\n\n` +
        `Good news — your listing "${listingTitle}" has been approved and is ` +
        `now live on Konek.PH.\n\n` +
        `View your listings: ${APP_URL}\n\n` +
        `— The Konek.PH Team`,
    };
  }
  return {
    subject: `Update on your listing "${listingTitle}"`,
    text:
      `Hi ${name},\n\n` +
      `Thank you for posting on Konek.PH. After review, your listing ` +
      `"${listingTitle}" was not approved at this time.\n\n` +
      (reason ? `Reason from our team:\n${reason}\n\n` : "") +
      `You may edit the listing and resubmit it for review: ${APP_URL}\n\n` +
      `— The Konek.PH Team`,
  };
}

function renderAdminNewListingEmail(b: Broker, listingTitle: string) {
  const name = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "(no name)";
  return {
    subject: `New listing pending review: ${listingTitle}`,
    text:
      `A broker has posted a new listing awaiting your approval.\n\n` +
      `Broker:  ${name}\n` +
      `Email:   ${b.email ?? "—"}\n` +
      `Phone:   ${b.phone ?? "—"}\n` +
      `License: ${b.license_number ?? "—"}\n` +
      `Listing: ${listingTitle}\n\n` +
      `Review pending listings: ${ADMIN_URL}\n\n` +
      `— Konek.PH`,
  };
}

function renderAdminReapplyEmail(b: Broker) {
  const name = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "(no name)";
  return {
    subject: `Broker resubmitted application: ${name}`,
    text:
      `A previously rejected broker has updated their details and resubmitted ` +
      `their application for review.\n\n` +
      `Name:    ${name}\n` +
      `Email:   ${b.email ?? "—"}\n` +
      `Phone:   ${b.phone ?? "—"}\n` +
      `License: ${b.license_number ?? "—"}\n\n` +
      `Review pending applications: ${ADMIN_URL}\n\n` +
      `— Konek.PH`,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "Invalid token" }, 401);
    }

    const body = (await req.json()) as Payload;
    if (
      !body.broker_id ||
      !["approved", "rejected", "new_signup", "reapply", "new_listing", "listing_approved", "listing_rejected"]
        .includes(body.action)
    ) {
      return json({ error: "Invalid payload" }, 400);
    }
    if (
      (body.action === "new_listing" || body.action === "listing_approved" || body.action === "listing_rejected") &&
      !body.listing_id
    ) {
      return json({ error: "listing_id required for listing actions" }, 400);
    }

    // Authorization:
    //  - approved / rejected / listing_approved / listing_rejected → admin only
    //  - new_signup / reapply / new_listing → caller must be the broker themselves
    const { data: callerProfile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (body.action === "new_signup" || body.action === "reapply" || body.action === "new_listing") {
      if (userData.user.id !== body.broker_id) {
        return json({ error: "Forbidden — broker_id must match caller" }, 403);
      }
    } else {
      if (callerProfile?.role !== "admin") {
        return json({ error: "Forbidden — admin only" }, 403);
      }
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: broker, error: brokerErr } = await admin
      .from("profiles")
      .select("first_name, last_name, email, phone, license_number")
      .eq("id", body.broker_id)
      .single();
    if (brokerErr || !broker?.email) {
      return json({ error: "Broker not found" }, 404);
    }

    let to: string;
    let subject: string;
    let text: string;

    if (body.action === "new_signup") {
      to = ADMIN_EMAIL;
      ({ subject, text } = renderAdminEmail(broker as Broker));
    } else if (body.action === "reapply") {
      to = ADMIN_EMAIL;
      ({ subject, text } = renderAdminReapplyEmail(broker as Broker));
    } else if (body.action === "new_listing") {
      const { data: listing } = await admin
        .from("listings")
        .select("title")
        .eq("id", body.listing_id!)
        .single();
      const listingTitle = listing?.title || "(untitled listing)";
      to = ADMIN_EMAIL;
      ({ subject, text } = renderAdminNewListingEmail(broker as Broker, listingTitle));
    } else if (body.action === "listing_approved" || body.action === "listing_rejected") {
      const { data: listing } = await admin
        .from("listings")
        .select("title")
        .eq("id", body.listing_id!)
        .single();
      const listingTitle = listing?.title || "your listing";
      to = broker.email;
      const fullName =
        `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() || "there";
      ({ subject, text } = renderListingEmail(body.action, fullName, listingTitle, body.reason));
    } else {
      to = broker.email;
      const fullName =
        `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() || "there";
      ({ subject, text } = renderBrokerEmail(
        body.action as "approved" | "rejected",
        fullName,
        body.reason,
      ));
    }

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    await client.send({
      from: `${FROM_NAME} <${SMTP_USER}>`,
      to,
      subject,
      content: text,
    });
    await client.close();

    return json({ ok: true });
  } catch (err) {
    console.error("notify-broker error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
