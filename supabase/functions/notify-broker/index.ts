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
  | "listing_rejected"
  | "listing_reported"
  | "moa_sent"
  | "moa_signed"
  | "moa_declined";

interface Payload {
  broker_id: string;
  action: Action;
  reason?: string;
  listing_id?: string;
}

// Email transport: SMTP (e.g. Gmail) — replaces the previous Resend HTTP API.
// Reuses the original SMTP secret names so existing Supabase secrets work:
// SMTP_USER, SMTP_PASS, SMTP_FROM_NAME (+ optional SMTP_HOST/SMTP_PORT).
// For Gmail use an App Password (not the account password) and port 465.
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "465");
const SMTP_USERNAME = Deno.env.get("SMTP_USER")!;
const SMTP_PASSWORD = Deno.env.get("SMTP_PASS")!;
const FROM_NAME = Deno.env.get("SMTP_FROM_NAME") ?? "ProList";
// Many SMTP servers (Gmail included) require the From address to match the
// authenticated user, so default FROM_EMAIL to the SMTP username.
const FROM_EMAIL = Deno.env.get("SMTP_FROM_EMAIL") ?? SMTP_USERNAME;
const APP_URL = Deno.env.get("APP_URL") ?? "https://app.prolistph.com";
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "konekph2026@gmail.com";
const ADMIN_URL = Deno.env.get("ADMIN_URL") ?? "https://app.prolistph.com/admin";

// Send an email over SMTP with a small retry (2 attempts) so a single
// transient connection blip doesn't silently drop an approval/signup email.
// A fresh client per send keeps the connection state simple in the
// short-lived Edge Function runtime.
async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: { username: SMTP_USERNAME, password: SMTP_PASSWORD },
      },
    });
    try {
      await client.send({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to,
        subject,
        content: text,
      });
      await client.close();
      return;
    } catch (err) {
      lastErr = err;
      try { await client.close(); } catch (_) { /* ignore */ }
      console.warn(`SMTP send attempt ${attempt} failed:`, String((err as Error)?.message ?? err));
    }
  }
  throw lastErr;
}

interface Broker {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  preferences: { email_notifs?: boolean } | null;
}

function renderBrokerEmail(action: "approved" | "rejected", name: string, reason?: string) {
  if (action === "approved") {
    return {
      subject: "Your ProList broker account has been approved",
      text:
        `Hi ${name},\n\n` +
        `Good news — your ProList broker account has been approved. ` +
        `You can now sign in and start using the platform.\n\n` +
        `Sign in: ${APP_URL}\n\n` +
        `— The ProList Team`,
    };
  }
  return {
    subject: "Update on your ProList broker application",
    text:
      `Hi ${name},\n\n` +
      `Thank you for applying to ProList. After review, we were unable to ` +
      `approve your application at this time.\n\n` +
      (reason ? `Reason from our team:\n${reason}\n\n` : "") +
      `You may sign back in to update your details and resubmit your ` +
      `application: ${APP_URL}\n\n` +
      `— The ProList Team`,
  };
}

// Strip CR/LF and other control chars from user-supplied strings before
// using them in email headers (Subject especially). Without this, a broker
// could inject a "\r\nBcc: attacker@…" line by setting their last_name to
// something exotic. Also cap length to keep subjects readable.
function safeHeader(s: string, max = 80): string {
  return s.replace(/[\r\n\t]/g, " ").trim().slice(0, max);
}

// Sanitize free-text user input (decline/report reasons) before placing it in an
// email body or in-app notification. Strips control chars (keeps tab/newline) and
// caps length so a broker can't inject misleading multi-line "system" text.
function safeBody(s: string, max = 500): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
}

// Verify a broker-initiated action against real DB state using the service-role
// client. The client cannot be trusted to supply an honest listing_id/action, so
// confirm the caller actually owns the listing/MOA and that its true status
// matches the claim — otherwise a broker could forge admin notifications/emails.
async function verifyBrokerSelfAction(
  admin: ReturnType<typeof createClient>,
  action: Action,
  listingId: string | undefined,
  callerId: string,
): Promise<string | null> {
  switch (action) {
    case "new_signup":
    case "reapply":
      return null; // about the caller's own profile; broker_id===caller already checked
    case "new_listing": {
      const { data } = await admin.from("listings").select("broker_id").eq("id", listingId!).single();
      if (!data || data.broker_id !== callerId) return "Listing not found or not owned by caller";
      return null;
    }
    case "listing_reported": {
      const { data } = await admin.from("listing_reports").select("id")
        .eq("listing_id", listingId!).eq("reporter_id", callerId).limit(1);
      if (!data || data.length === 0) return "No matching report by caller";
      return null;
    }
    case "moa_signed":
    case "moa_declined": {
      const want = action === "moa_signed" ? "signed" : "declined";
      const { data } = await admin.from("moa_agreements").select("broker_id, status")
        .eq("listing_id", listingId!).single();
      if (!data || data.broker_id !== callerId) return "MOA not found or not owned by caller";
      if (data.status !== want) return `MOA status mismatch (expected ${want})`;
      return null;
    }
    default:
      return null;
  }
}

function renderAdminEmail(b: Broker) {
  const name = safeHeader(`${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "(no name)");
  return {
    subject: `New broker application: ${name}`,
    text:
      `A new broker has signed up and is awaiting your review.\n\n` +
      `Name:    ${name}\n` +
      `Email:   ${b.email ?? "—"}\n` +
      `Phone:   ${b.phone ?? "—"}\n` +
      `License: ${b.license_number ?? "—"}\n\n` +
      `Review pending applications: ${ADMIN_URL}\n\n` +
      `— ProList`,
  };
}

function renderListingEmail(
  action: "listing_approved" | "listing_rejected",
  name: string,
  listingTitle: string,
  reason?: string,
) {
  listingTitle = safeHeader(listingTitle, 60);
  if (action === "listing_approved") {
    return {
      subject: `Your listing "${listingTitle}" has been approved`,
      text:
        `Hi ${name},\n\n` +
        `Good news — your listing "${listingTitle}" has been approved and is ` +
        `now live on ProList.\n\n` +
        `View your listings: ${APP_URL}\n\n` +
        `— The ProList Team`,
    };
  }
  return {
    subject: `Update on your listing "${listingTitle}"`,
    text:
      `Hi ${name},\n\n` +
      `Thank you for posting on ProList. After review, your listing ` +
      `"${listingTitle}" was not approved at this time.\n\n` +
      (reason ? `Reason from our team:\n${reason}\n\n` : "") +
      `You may edit the listing and resubmit it for review: ${APP_URL}\n\n` +
      `— The ProList Team`,
  };
}

function renderAdminNewListingEmail(b: Broker, listingTitle: string) {
  const name = safeHeader(`${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "(no name)");
  listingTitle = safeHeader(listingTitle, 60);
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
      `— ProList`,
  };
}

function renderAdminReapplyEmail(b: Broker) {
  const name = safeHeader(`${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "(no name)");
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
      `— ProList`,
  };
}

function renderMoaSentEmail(name: string, listingTitle: string) {
  listingTitle = safeHeader(listingTitle, 60);
  return {
    subject: `Action required: sign the MOA for "${listingTitle}"`,
    text:
      `Hi ${name},\n\n` +
      `Your listing "${listingTitle}" has been reviewed and a Memorandum of ` +
      `Agreement (MOA) is ready for your signature. Please sign in, open the ` +
      `MOA section, review the agreement, and sign it so we can publish your ` +
      `listing on ProList.\n\n` +
      `Sign in: ${APP_URL}\n\n` +
      `— The ProList Team`,
  };
}

function renderAdminMoaSignedEmail(b: Broker, listingTitle: string) {
  const name = safeHeader(`${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "(no name)");
  listingTitle = safeHeader(listingTitle, 60);
  return {
    subject: `MOA signed: ${listingTitle}`,
    text:
      `A broker has signed the Memorandum of Agreement for their listing.\n\n` +
      `Broker:  ${name}\n` +
      `Email:   ${b.email ?? "—"}\n` +
      `Listing: ${listingTitle}\n\n` +
      `Review the signed MOA and approve the listing: ${ADMIN_URL}\n\n` +
      `— ProList`,
  };
}

function renderAdminMoaDeclinedEmail(b: Broker, listingTitle: string, reason?: string) {
  const name = safeHeader(`${b.first_name ?? ""} ${b.last_name ?? ""}`.trim() || "(no name)");
  listingTitle = safeHeader(listingTitle, 60);
  return {
    subject: `MOA declined: ${listingTitle}`,
    text:
      `A broker has declined the Memorandum of Agreement for their listing.\n\n` +
      `Broker:  ${name}\n` +
      `Email:   ${b.email ?? "—"}\n` +
      `Listing: ${listingTitle}\n` +
      `Reason:  ${reason ?? "—"}\n\n` +
      `Review pending listings: ${ADMIN_URL}\n\n` +
      `— ProList`,
  };
}

function renderAdminReportEmail(reporter: Broker, listingTitle: string, reason?: string) {
  const name = safeHeader(`${reporter.first_name ?? ""} ${reporter.last_name ?? ""}`.trim() || "(no name)");
  listingTitle = safeHeader(listingTitle, 60);
  return {
    subject: `Listing reported: ${listingTitle}`,
    text:
      `A broker has reported a listing for review.\n\n` +
      `Listing:  ${listingTitle}\n` +
      `Reason:   ${reason ?? "—"}\n` +
      `Reported by: ${name} (${reporter.email ?? "—"})\n\n` +
      `Review reports: ${ADMIN_URL}/reports\n\n` +
      `— ProList`,
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
      !["approved", "rejected", "new_signup", "reapply", "new_listing", "listing_approved", "listing_rejected", "listing_reported", "moa_sent", "moa_signed", "moa_declined"]
        .includes(body.action)
    ) {
      return json({ error: "Invalid payload" }, 400);
    }
    if (
      ["new_listing", "listing_approved", "listing_rejected", "listing_reported", "moa_sent", "moa_signed", "moa_declined"].includes(body.action) &&
      !body.listing_id
    ) {
      return json({ error: "listing_id required for listing actions" }, 400);
    }

    // Sanitize the free-text reason before it reaches any email body / notification.
    if (body.reason) body.reason = safeBody(body.reason);

    // Authorization:
    //  - approved / rejected / listing_approved / listing_rejected → admin only
    //  - new_signup / reapply / new_listing / listing_reported → caller must be
    //    the broker themselves (for listing_reported, the caller is the reporter)
    const { data: callerProfile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    // Broker-self actions: caller must be the broker themselves. moa_signed /
    // moa_declined are initiated by the broker but addressed to admins.
    const brokerSelfActions = ["new_signup", "reapply", "new_listing", "listing_reported", "moa_signed", "moa_declined"];
    if (brokerSelfActions.includes(body.action)) {
      if (userData.user.id !== body.broker_id) {
        return json({ error: "Forbidden — broker_id must match caller" }, 403);
      }
    } else {
      if (callerProfile?.role !== "admin") {
        return json({ error: "Forbidden — admin only" }, 403);
      }
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Beyond broker_id===caller, broker-initiated actions must come from an
    // actual broker and be backed by real DB state (owned listing/MOA, matching
    // status). This stops a logged-in broker from forging admin notifications.
    if (brokerSelfActions.includes(body.action)) {
      if (callerProfile?.role !== "broker") {
        return json({ error: "Forbidden — broker only" }, 403);
      }
      const verifyErr = await verifyBrokerSelfAction(admin, body.action, body.listing_id, userData.user.id);
      if (verifyErr) return json({ error: verifyErr }, 403);
    }

    const { data: broker, error: brokerErr } = await admin
      .from("profiles")
      .select("first_name, last_name, email, phone, license_number, preferences")
      .eq("id", body.broker_id)
      .single();
    if (brokerErr || !broker?.email) {
      return json({ error: "Broker not found" }, 404);
    }

    let to: string;
    let subject: string;
    let text: string;
    let adminNotif: { type: string; title: string; bodyText: string } | null = null;

    if (body.action === "new_signup") {
      to = ADMIN_EMAIL;
      ({ subject, text } = renderAdminEmail(broker as Broker));
      const nm = `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() || "A new broker";
      adminNotif = {
        type: "broker_signup",
        title: "New broker application",
        bodyText: `${nm} signed up and is awaiting review.`,
      };
    } else if (body.action === "reapply") {
      to = ADMIN_EMAIL;
      ({ subject, text } = renderAdminReapplyEmail(broker as Broker));
      const nm = `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() || "A broker";
      adminNotif = {
        type: "broker_reapply",
        title: "Broker resubmitted application",
        bodyText: `${nm} updated their details and resubmitted for review.`,
      };
    } else if (body.action === "new_listing") {
      const { data: listing } = await admin
        .from("listings")
        .select("title")
        .eq("id", body.listing_id!)
        .single();
      const listingTitle = listing?.title || "(untitled listing)";
      to = ADMIN_EMAIL;
      ({ subject, text } = renderAdminNewListingEmail(broker as Broker, listingTitle));
      const nm = `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() || "A broker";
      adminNotif = {
        type: "new_listing",
        title: "New listing pending review",
        bodyText: `${nm}: ${listingTitle}`,
      };
    } else if (body.action === "listing_reported") {
      // Caller is the reporter (broker fetched above = reporter). Alert admins
      // by email + in-app notification; do not email the listing owner.
      const { data: listing } = await admin
        .from("listings")
        .select("title")
        .eq("id", body.listing_id!)
        .single();
      const listingTitle = listing?.title || "(untitled listing)";
      to = ADMIN_EMAIL;
      ({ subject, text } = renderAdminReportEmail(broker as Broker, listingTitle, body.reason));
      adminNotif = {
        type: "listing_reported",
        title: "Listing reported",
        bodyText: `"${listingTitle}" reported${body.reason ? ` — ${body.reason}` : ""}.`,
      };
    } else if (body.action === "moa_sent" || body.action === "moa_signed" || body.action === "moa_declined") {
      const { data: listing } = await admin
        .from("listings")
        .select("title")
        .eq("id", body.listing_id!)
        .single();
      const listingTitle = listing?.title || "(untitled listing)";
      const nm = `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() || "A broker";
      if (body.action === "moa_sent") {
        // ProList -> broker: MOA ready to sign.
        to = broker.email;
        const fullName =
          `${broker.first_name ?? ""} ${broker.last_name ?? ""}`.trim() || "there";
        ({ subject, text } = renderMoaSentEmail(fullName, listingTitle));
      } else if (body.action === "moa_signed") {
        to = ADMIN_EMAIL;
        ({ subject, text } = renderAdminMoaSignedEmail(broker as Broker, listingTitle));
        adminNotif = {
          type: "moa_signed",
          title: "MOA signed — ready to approve",
          bodyText: `${nm} signed the MOA for "${listingTitle}".`,
        };
      } else {
        to = ADMIN_EMAIL;
        ({ subject, text } = renderAdminMoaDeclinedEmail(broker as Broker, listingTitle, body.reason));
        adminNotif = {
          type: "moa_declined",
          title: "MOA declined",
          bodyText: `${nm} declined the MOA for "${listingTitle}"${body.reason ? ` — ${body.reason}` : ""}.`,
        };
      }
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

    // Fan out in-app notifications to every admin for admin-bound actions.
    // Uses the service-role client so it bypasses RLS and writes even if
    // the caller is the broker themselves (new_signup / reapply / new_listing).
    if (adminNotif) {
      const { data: admins } = await admin
        .from("profiles")
        .select("id")
        .eq("role", "admin");
      if (admins && admins.length) {
        const rows = admins.map((a: { id: string }) => ({
          user_id: a.id,
          type: adminNotif!.type,
          title: adminNotif!.title,
          body: adminNotif!.bodyText,
        }));
        const { error: notifErr } = await admin.from("notifications").insert(rows);
        if (notifErr) console.warn("admin notifications insert failed:", notifErr.message);
      }
    }

    // Master email preference (Settings S2): gate ONLY mail addressed to the
    // broker (the recipient). When `to === broker.email` the broker IS the
    // recipient, so this reads the recipient's own preference. Admin-bound mail
    // (`to === ADMIN_EMAIL`) is never gated — the condition excludes it. Absent
    // pref ⇒ send (default ON). The admin in-app fan-out above is untouched.
    const recipientOptedOut =
      to === broker.email && broker.preferences?.email_notifs === false;
    let emailed = false;
    if (!recipientOptedOut) {
      try {
        await sendEmail(to, subject, text);
        emailed = true;
      } catch (err) {
        const errText = String((err as Error)?.message ?? err);
        console.error("SMTP send failed after retries:", errText);
        return json({ error: `Email send failed: ${errText}` }, 502);
      }
    }

    return json({ ok: true, emailed });
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
