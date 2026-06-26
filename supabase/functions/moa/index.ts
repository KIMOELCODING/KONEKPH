import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

// MOA (Memorandum of Agreement) generation + signing.
//
//  action: 'generate'  (admin only) — build the base MOA PDF for a listing,
//          store it, and mark the moa_agreements row 'sent'.
//  action: 'sign'      (owning broker only) — stamp the broker's saved e-signature
//          + the pre-set ProList signatory + the sending admin's name/date onto
//          the MOA, store the signed PDF, and mark the row 'signed'.
//
// In-app notifications: 'generate' notifies the broker here; 'sign' email/admin
// notifications are delegated to notify-broker (best-effort). Storage + DB writes
// use the service-role client (bypasses RLS); the caller is authorized first.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_URL = Deno.env.get("APP_URL") ?? "https://app.prolistph.com";
const MOA_BUCKET = "moa-documents";
const SIG_BUCKET = "id-documents";
const PROLIST_SIGNATORY_PATH = "_assets/prolist_signatory.png";

interface Payload {
  action: "generate" | "sign";
  listing_id?: string;   // generate
  agreement_id?: string; // sign
}

interface MoaData {
  brokerName: string;
  brokerLicense: string;
  listingTitle: string;
  address: string;
  price: number | null;
  repName: string;       // ProList authorized representative (sending admin)
  agreementDate: string; // human-readable
  signedDate?: string;   // human-readable, signed version only
}

// ---- PDF layout ----------------------------------------------------------
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

function wrap(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.trim() === "") { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const trial = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function peso(n: number | null): string {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  return "PHP " + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Builds the full MOA. When brokerSigPng / prolistSigPng are provided the
// signature images are stamped; otherwise blank signature lines are drawn.
async function buildMoaPdf(
  d: MoaData,
  brokerSigPng?: Uint8Array | null,
  prolistSigPng?: Uint8Array | null,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.07);
  const muted = rgb(0.4, 0.4, 0.4);

  let y = PAGE_H - 64;

  const title = "MEMORANDUM OF AGREEMENT";
  const tSize = 16;
  page.drawText(title, {
    x: (PAGE_W - bold.widthOfTextAtSize(title, tSize)) / 2,
    y, size: tSize, font: bold, color: ink,
  });
  y -= 12;
  const sub = "Listing Marketing Authorization";
  const sSize = 10;
  page.drawText(sub, {
    x: (PAGE_W - font.widthOfTextAtSize(sub, sSize)) / 2,
    y: y - 6, size: sSize, font, color: muted,
  });
  y -= 36;

  const bodySize = 10;
  const lh = 14;
  const drawPara = (text: string, f = font, size = bodySize, color = ink) => {
    for (const ln of wrap(text, f, size, CONTENT_W)) {
      if (ln === "") { y -= lh * 0.6; continue; }
      page.drawText(ln, { x: MARGIN, y, size, font: f, color });
      y -= lh;
    }
  };

  drawPara(
    `This Memorandum of Agreement ("Agreement") is made and entered into on ` +
    `${d.agreementDate} by and between ProList Realty Technologies ("ProList") ` +
    `and ${d.brokerName}, a licensed real estate broker holding PRC License No. ` +
    `${d.brokerLicense || "—"} ("Broker").`,
  );
  y -= 6;

  drawPara("PROPERTY LISTING", bold, 11);
  y -= 2;
  drawPara(`Title:    ${d.listingTitle}`);
  drawPara(`Location: ${d.address}`);
  drawPara(`Price:    ${peso(d.price)}`);
  y -= 8;

  drawPara("The parties agree as follows:", bold, 11);
  y -= 2;
  drawPara(
    "1. Authorization to Market. The Broker authorizes ProList to publish, " +
    "display, and market the above listing on the ProList platform and its " +
    "public website for the purpose of advertising the property to the public.",
  );
  drawPara(
    "2. Accuracy and Authority. The Broker warrants that all information " +
    "provided for the listing is true, accurate, and complete, and that the " +
    "Broker is the listing broker of record for the property, in compliance " +
    "with Republic Act No. 9646 (Real Estate Service Act, RESA) and its rules.",
  );
  drawPara(
    "3. Review and Approval. ProList shall review the listing and, upon " +
    "approval, make it publicly available. ProList reserves the right to " +
    "decline, suspend, or remove any listing at its sole discretion.",
  );
  drawPara(
    "4. Term. This Agreement applies to the listing described above and " +
    "remains in effect for as long as the listing is active on the platform.",
  );
  y -= 6;
  drawPara(
    "IN WITNESS WHEREOF, the parties have caused this Agreement to be signed " +
    "as of the date first written above.",
  );

  // ---- Signature blocks (anchored near the bottom) ----
  const blockY = 150;          // baseline of the signature line
  const colW = 200;
  const leftX = MARGIN;
  const rightX = PAGE_W - MARGIN - colW;

  const drawSig = async (
    x: number, png: Uint8Array | null | undefined,
    line1: string, line2: string, line3: string,
  ) => {
    if (png && png.length) {
      try {
        const img = await pdf.embedPng(png);
        // Fit within the column with padding on both sides; sit just above the
        // line and bottom-align so signatures of different heights share a baseline.
        const maxW = colW - 28, maxH = 44;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x: x + (colW - w) / 2, y: blockY + 5, width: w, height: h });
      } catch (_) { /* if embed fails, leave the line blank */ }
    }
    page.drawLine({
      start: { x, y: blockY }, end: { x: x + colW, y: blockY },
      thickness: 0.75, color: ink,
    });
    page.drawText(line1, { x, y: blockY - 14, size: 9, font: bold, color: ink });
    if (line2) page.drawText(line2, { x, y: blockY - 27, size: 8.5, font, color: muted });
    if (line3) page.drawText(line3, { x, y: blockY - 39, size: 8.5, font, color: muted });
  };

  await drawSig(
    leftX, brokerSigPng,
    d.brokerName,
    `PRC License No. ${d.brokerLicense || "—"}`,
    d.signedDate ? `Signed: ${d.signedDate}` : "Broker (Signature over Printed Name)",
  );
  await drawSig(
    rightX, prolistSigPng,
    "ProList Realty Technologies",
    d.repName ? `Authorized Representative: ${d.repName}` : "Authorized Representative",
    d.signedDate ? `Date: ${d.signedDate}` : `Date: ${d.agreementDate}`,
  );

  return await pdf.save();
}

// ---- helpers -------------------------------------------------------------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fullName(p: { first_name?: string | null; last_name?: string | null } | null): string {
  if (!p) return "";
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

function today(): string {
  return new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
}

async function downloadBytes(
  admin: ReturnType<typeof createClient>, bucket: string, path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid token" }, 401);
    const callerId = userData.user.id;

    const body = (await req.json()) as Payload;
    if (body.action !== "generate" && body.action !== "sign") {
      return json({ error: "Invalid action" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: caller } = await admin
      .from("profiles")
      .select("role, first_name, last_name")
      .eq("id", callerId)
      .single();

    // ---------------------------------------------------------------
    // GENERATE — admin sends the MOA to the broker
    // ---------------------------------------------------------------
    if (body.action === "generate") {
      if (caller?.role !== "admin") return json({ error: "Forbidden — admin only" }, 403);
      if (!body.listing_id) return json({ error: "listing_id required" }, 400);

      const { data: listing, error: lErr } = await admin
        .from("listings")
        .select("id, broker_id, title, price, region, province, city, barangay, street_address")
        .eq("id", body.listing_id)
        .single();
      if (lErr || !listing) return json({ error: "Listing not found" }, 404);

      const { data: broker } = await admin
        .from("profiles")
        .select("id, first_name, last_name, license_number")
        .eq("id", listing.broker_id)
        .single();
      if (!broker) return json({ error: "Broker not found" }, 404);

      // Don't clobber an already-signed agreement.
      const { data: existing } = await admin
        .from("moa_agreements")
        .select("id, status")
        .eq("listing_id", listing.id)
        .maybeSingle();
      if (existing?.status === "signed") {
        return json({ error: "This listing's MOA is already signed." }, 409);
      }

      let agId = existing?.id as string | undefined;
      if (!agId) {
        const { data: ins, error: insErr } = await admin
          .from("moa_agreements")
          .insert({ listing_id: listing.id, broker_id: broker.id, status: "pending" })
          .select("id")
          .single();
        if (insErr || !ins) return json({ error: `Could not create MOA: ${insErr?.message}` }, 500);
        agId = ins.id;
      }

      const address = [listing.street_address, listing.barangay, listing.city, listing.province, listing.region]
        .filter(Boolean).join(", ") || "—";
      const data: MoaData = {
        brokerName: fullName(broker) || "(broker)",
        brokerLicense: broker.license_number ?? "",
        listingTitle: listing.title ?? "(untitled)",
        address,
        price: listing.price,
        repName: fullName(caller),
        agreementDate: today(),
      };

      const pdfBytes = await buildMoaPdf(data);
      const pdfPath = `${broker.id}/${agId}/moa.pdf`;
      const up = await admin.storage.from(MOA_BUCKET).upload(pdfPath, pdfBytes, {
        contentType: "application/pdf", upsert: true,
      });
      if (up.error) return json({ error: `Upload failed: ${up.error.message}` }, 500);

      const { error: updErr } = await admin
        .from("moa_agreements")
        .update({
          status: "sent",
          pdf_path: pdfPath,
          sent_by: callerId,
          sent_at: new Date().toISOString(),
          signed_pdf_path: null,
          broker_signed_at: null,
          declined_at: null,
          decline_reason: null,
        })
        .eq("id", agId);
      if (updErr) return json({ error: `Could not update MOA: ${updErr.message}` }, 500);

      // Notify the broker in-app (best-effort).
      await admin.from("notifications").insert({
        user_id: broker.id,
        type: "moa_sent",
        title: "Action required: sign your listing MOA",
        body: `Please review and sign the Memorandum of Agreement for "${data.listingTitle}".`,
        link: "moa",
      });
      // Email the broker via notify-broker (best-effort).
      try {
        await admin.functions.invoke("notify-broker", {
          body: { action: "moa_sent", broker_id: broker.id, listing_id: listing.id },
          headers: { Authorization: authHeader },
        });
      } catch (_) { /* email is non-critical */ }

      return json({ ok: true, agreement_id: agId, pdf_path: pdfPath, status: "sent" });
    }

    // ---------------------------------------------------------------
    // SIGN — owning broker signs the MOA
    // ---------------------------------------------------------------
    if (!body.agreement_id) return json({ error: "agreement_id required" }, 400);

    const { data: ag, error: agErr } = await admin
      .from("moa_agreements")
      .select("id, listing_id, broker_id, status, pdf_path, sent_by")
      .eq("id", body.agreement_id)
      .single();
    if (agErr || !ag) return json({ error: "MOA not found" }, 404);
    if (ag.broker_id !== callerId) return json({ error: "Forbidden — not your MOA" }, 403);
    if (ag.status !== "sent") return json({ error: `MOA cannot be signed (status: ${ag.status}).` }, 409);

    const { data: broker } = await admin
      .from("profiles")
      .select("id, first_name, last_name, license_number, signature_url")
      .eq("id", ag.broker_id)
      .single();
    if (!broker) return json({ error: "Broker not found" }, 404);
    if (!broker.signature_url) {
      return json({ error: "No signature on file. Please capture your signature in your profile first." }, 422);
    }
    // signature_url is a broker-self-editable profile column, and downloadBytes
    // runs with the service-role client (bypasses storage RLS). Pin the path to
    // the broker's own folder so a broker can't point it at another user's
    // private id-documents file and have it embedded into their MOA.
    if (!broker.signature_url.startsWith(`${broker.id}/`)) {
      return json({ error: "Invalid signature path on file." }, 422);
    }

    const { data: listing } = await admin
      .from("listings")
      .select("title, price, region, province, city, barangay, street_address")
      .eq("id", ag.listing_id)
      .single();
    if (!listing) return json({ error: "Listing not found" }, 404);

    const brokerSig = await downloadBytes(admin, SIG_BUCKET, broker.signature_url);
    if (!brokerSig) return json({ error: "Could not load your signature image." }, 500);
    const prolistSig = await downloadBytes(admin, MOA_BUCKET, PROLIST_SIGNATORY_PATH);
    // prolistSig may be null if the asset hasn't been seeded — sign without it.

    let repName = "";
    if (ag.sent_by) {
      const { data: sender } = await admin
        .from("profiles").select("first_name, last_name").eq("id", ag.sent_by).single();
      repName = fullName(sender);
    }

    const address = [listing.street_address, listing.barangay, listing.city, listing.province, listing.region]
      .filter(Boolean).join(", ") || "—";
    const data: MoaData = {
      brokerName: fullName(broker) || "(broker)",
      brokerLicense: broker.license_number ?? "",
      listingTitle: listing.title ?? "(untitled)",
      address,
      price: listing.price,
      repName,
      agreementDate: today(),
      signedDate: today(),
    };

    const signedBytes = await buildMoaPdf(data, brokerSig, prolistSig);
    const signedPath = `${broker.id}/${ag.id}/moa_signed.pdf`;
    const up = await admin.storage.from(MOA_BUCKET).upload(signedPath, signedBytes, {
      contentType: "application/pdf", upsert: true,
    });
    if (up.error) return json({ error: `Upload failed: ${up.error.message}` }, 500);

    const { error: updErr } = await admin
      .from("moa_agreements")
      .update({
        status: "signed",
        signed_pdf_path: signedPath,
        broker_signed_at: new Date().toISOString(),
      })
      .eq("id", ag.id);
    if (updErr) return json({ error: `Could not update MOA: ${updErr.message}` }, 500);

    // Notify admins (email + in-app) via notify-broker (best-effort).
    try {
      await admin.functions.invoke("notify-broker", {
        body: { action: "moa_signed", broker_id: broker.id, listing_id: ag.listing_id },
        headers: { Authorization: authHeader },
      });
    } catch (_) { /* notification is non-critical */ }

    return json({ ok: true, agreement_id: ag.id, signed_pdf_path: signedPath, status: "signed" });
  } catch (err) {
    console.error("moa error:", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
