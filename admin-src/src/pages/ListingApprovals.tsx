import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Listing, MoaAgreement } from '../types';
import RejectModal from '../components/RejectModal';

// The per-listing MOA is unique on listing_id, so the embed returns 0 or 1 row.
function moaOf(l: Listing): MoaAgreement | null {
  return l.moa_agreements?.[0] ?? null;
}

const MOA_LABEL: Record<MoaAgreement['status'], string> = {
  pending: 'MOA not sent',
  sent: 'MOA sent — awaiting signature',
  signed: 'MOA signed',
  declined: 'MOA declined by broker',
};

const MOA_COLOR: Record<MoaAgreement['status'], string> = {
  pending: '#94a3b8',
  sent: '#d97706',
  signed: '#16a34a',
  declined: '#dc2626',
};

function peso(n: number) {
  return '₱' + n.toLocaleString('en-PH');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function publicImg(path: string | undefined): string | null {
  if (!path) return null;
  const base = window.SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/listing-images/${path}`;
}

// Small transformed thumbnail for card images (the full original loads only in
// the details modal). Uses the SDK transform like the broker app's __plImg.
function thumbImg(path: string | undefined): string | null {
  if (!path) return null;
  return sb.storage.from('listing-images')
    .getPublicUrl(path, { transform: { width: 400, height: 300, resize: 'cover', quality: 70 } })
    .data.publicUrl || null;
}

function fullAddress(l: Listing): string {
  return [l.street_address, l.barangay, l.city, l.province, l.region]
    .filter(Boolean)
    .join(', ');
}

const PENDING_SELECT = 'id, broker_id, title, category, property_type, price, region, province, city, barangay, street_address, lot_area_sqm, floor_area_sqm, bedrooms, bathrooms, amenities, description, images, status, rejection_reason, created_at, profiles!broker_id(first_name,last_name,phone,email,license_number), moa_agreements(id,status,signed_pdf_path,broker_signed_at)';

export default function ListingApprovals() {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [viewing, setViewing] = useState<Listing | null>(null);
  const [rejecting, setRejecting] = useState<Listing | null>(null);

  async function load(): Promise<Listing[] | null> {
    const { data, error } = await sb
      .from('listings')
      .select(PENDING_SELECT)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) { setToast({ msg: error.message, err: true }); return null; }
    // supabase-js infers the embedded `profiles!broker_id(...)` as an array, but
    // a to-one FK embed returns a single object at runtime (and the UI reads it
    // as one). Cast through unknown to reconcile the type with reality.
    const next = (data ?? []) as unknown as Listing[];
    setRows(next);
    return next;
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  async function sendMoa(l: Listing) {
    setBusy(l.id);
    const { error } = await sb.functions.invoke('moa', {
      body: { action: 'generate', listing_id: l.id },
    });
    setBusy(null);
    if (error) {
      // surface the function's JSON error body when available
      let msg = error.message;
      try {
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        const j = ctx?.json ? await ctx.json() : null;
        if (j?.error) msg = j.error;
      } catch { /* ignore */ }
      showToast(msg, true);
      return;
    }
    showToast('MOA sent to broker for signing.');
    // Refetch just the mutated row (not the whole pending list with per-row
    // embeds) to refresh its MOA badge/buttons — mirrors ManageListings.sendMoa.
    const { data } = await sb.from('listings').select(PENDING_SELECT).eq('id', l.id).maybeSingle();
    if (data) {
      const nl = data as unknown as Listing;
      setRows(rs => rs?.map(r => (r.id === l.id ? nl : r)) ?? rs);
      setViewing(v => (v && v.id === l.id ? nl : v));
    }
  }

  async function viewSignedMoa(l: Listing) {
    const moa = moaOf(l);
    if (!moa?.signed_pdf_path) { showToast('No signed MOA yet.', true); return; }
    const { data, error } = await sb.storage
      .from('moa-documents')
      .createSignedUrl(moa.signed_pdf_path, 120);
    if (error || !data?.signedUrl) { showToast(error?.message ?? 'Could not open MOA.', true); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function approve(l: Listing) {
    if (moaOf(l)?.status !== 'signed') {
      showToast('The broker must sign the MOA before you can approve this listing.', true);
      return;
    }
    setBusy(l.id);
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
      .from('listings')
      .update({ status: 'active', approved_at: new Date().toISOString(), approved_by: user?.id })
      .eq('id', l.id)
      .select('id');
    if (error) { setBusy(null); showToast(error.message, true); return; }
    if (!data || data.length === 0) {
      setBusy(null);
      showToast('Update blocked by RLS — confirm your account has role=admin in profiles.', true);
      return;
    }
    await sb.from('notifications').insert({
      user_id: l.broker_id,
      type: 'listing_approved',
      title: 'Listing approved',
      body: `${l.title} is now live on ProList.`,
    });
    sb.functions.invoke('notify-broker', {
      body: { broker_id: l.broker_id, action: 'listing_approved', listing_id: l.id },
    }).then(({ error: mailErr }) => { if (mailErr) showToast('Listing approved, but the broker email could not be sent.', true); })
      .catch(() => showToast('Listing approved, but the broker email could not be sent.', true));
    setBusy(null);
    showToast('Listing approved.');
    setViewing(v => v?.id === l.id ? null : v);
    setRows(rs => rs?.filter(r => r.id !== l.id) ?? rs);
  }

  async function confirmReject(l: Listing, reason: string) {
    setBusy(l.id);
    const { data, error } = await sb
      .from('listings')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', l.id)
      .select('id');
    if (error) { setBusy(null); setRejecting(null); showToast(error.message, true); return; }
    if (!data || data.length === 0) {
      setBusy(null);
      setRejecting(null);
      showToast('Update blocked by RLS — confirm your account has role=admin in profiles.', true);
      return;
    }
    await sb.from('notifications').insert({
      user_id: l.broker_id,
      type: 'listing_rejected',
      title: 'Listing rejected',
      body: `${l.title}: ${reason}`,
    });
    sb.functions.invoke('notify-broker', {
      body: {
        broker_id: l.broker_id,
        action: 'listing_rejected',
        listing_id: l.id,
        reason,
      },
    }).then(({ error: mailErr }) => { if (mailErr) showToast('Listing rejected, but the broker email could not be sent.', true); })
      .catch(() => showToast('Listing rejected, but the broker email could not be sent.', true));
    setBusy(null);
    setRejecting(null);
    showToast('Listing rejected.');
    setViewing(v => v?.id === l.id ? null : v);
    setRows(rs => rs?.filter(r => r.id !== l.id) ?? rs);
  }

  // MOA-aware action buttons, shared by the card and the details modal.
  function moaActions(l: Listing) {
    const status = moaOf(l)?.status;
    const signed = status === 'signed';
    return (
      <>
        {signed ? (
          <button className="btn btn-secondary" disabled={busy === l.id} onClick={() => viewSignedMoa(l)}>
            <i className="fa-regular fa-file-lines"></i> Signed MOA
          </button>
        ) : (
          <button className="btn btn-secondary" disabled={busy === l.id || status === 'sent'} onClick={() => sendMoa(l)}>
            <i className="fa-regular fa-paper-plane"></i> {status === 'sent' ? 'MOA sent' : 'Send MOA'}
          </button>
        )}
        <button className="btn btn-danger" disabled={busy === l.id} onClick={() => setRejecting(l)}>Decline</button>
        <button
          className="btn btn-primary"
          disabled={busy === l.id || !signed}
          onClick={() => approve(l)}
          title={signed ? undefined : 'The broker must sign the MOA before approval'}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          Approve
        </button>
      </>
    );
  }

  return (
    <>
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Pending listings</div>
          <div className="card-sub">{rows ? `${rows.length} waiting for review` : 'Loading…'}</div>
        </div>
        <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
      </div>

      {rows && rows.length === 0 && (
        <div className="empty">
          <i className="fa-solid fa-circle-check"></i>
          <h3>All caught up</h3>
          <p>No listings awaiting approval.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="lst-grid">
          {rows.map(l => {
            const img = thumbImg(l.images?.[0]);
            return (
              <div key={l.id} className="lst-card">
                <div
                  className="lst-img"
                  style={{ ...(img ? { backgroundImage: `url(${img})` } : undefined), cursor: 'pointer' }}
                  onClick={() => setViewing(l)}
                  title="View details"
                >
                  {!img && <i className="fa-regular fa-image"></i>}
                </div>
                <div className="lst-body">
                  <div className="lst-title" style={{ cursor: 'pointer' }} onClick={() => setViewing(l)}>{l.title}</div>
                  <div className="lst-price">{peso(Number(l.price))}</div>
                  <div className="lst-meta">
                    <i className="fa-solid fa-location-dot"></i> {l.city}, {l.province}
                  </div>
                  <div className="lst-meta">
                    <i className="fa-solid fa-user"></i> {l.profiles?.first_name} {l.profiles?.last_name}
                    <span style={{ marginLeft: 8 }}>· {fmtDate(l.created_at)}</span>
                  </div>
                  <MoaBadge l={l} />
                  <div className="lst-actions" style={{ flexWrap: 'wrap' }}>
                    {moaActions(l)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </div>

    {rejecting && (
      <RejectModal
        title="Reject listing"
        subject={rejecting.title}
        busy={busy === rejecting.id}
        onCancel={() => setRejecting(null)}
        onConfirm={(reason) => confirmReject(rejecting, reason)}
      />
    )}

    {viewing && (
      <div className="modal-overlay" onClick={() => setViewing(null)}>
        <div className="modal-box" style={{ maxWidth: 760 }} onClick={e => e.stopPropagation()}>
          <h2>{viewing.title}</h2>
          <p className="modal-sub">
            {viewing.category}
            {viewing.property_type ? ` · ${viewing.property_type}` : ''}
            {' · '}Submitted {fmtDate(viewing.created_at)}
          </p>

          {viewing.images && viewing.images.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 18 }}>
              {viewing.images.map((path, i) => {
                const url = publicImg(path);
                return url ? (
                  <a key={i} href={url} target="_blank" rel="noopener">
                    <img
                      src={url}
                      alt={`Image ${i+1}`}
                      style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--br)', display: 'block', cursor: 'zoom-in' }}
                    />
                  </a>
                ) : null;
              })}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px', marginBottom: 18, fontSize: 13.5 }}>
            <Field label="Price" value={peso(Number(viewing.price))} bold />
            <Field label="Status" value={viewing.status} />
            <Field label="Lot area" value={viewing.lot_area_sqm != null ? `${viewing.lot_area_sqm} sqm` : '—'} />
            <Field label="Floor area" value={viewing.floor_area_sqm != null ? `${viewing.floor_area_sqm} sqm` : '—'} />
            <Field label="Bedrooms" value={viewing.bedrooms != null ? String(viewing.bedrooms) : '—'} />
            <Field label="Bathrooms" value={viewing.bathrooms != null ? String(viewing.bathrooms) : '—'} />
            <Field label="Address" value={fullAddress(viewing) || '—'} full />
            {viewing.amenities && viewing.amenities.length > 0 && (
              <Field label="Amenities" value={viewing.amenities.join(', ')} full />
            )}
            {viewing.description && (
              <Field label="Description" value={viewing.description} full pre />
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--br)', paddingTop: 14, marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--td)' }}>Submitted by</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13.5 }}>
              <Field label="Name" value={`${viewing.profiles?.first_name ?? ''} ${viewing.profiles?.last_name ?? ''}`.trim() || '—'} />
              <Field label="License #" value={viewing.profiles?.license_number || '—'} />
              <Field label="Email" value={viewing.profiles?.email || '—'} />
              <Field label="Phone" value={viewing.profiles?.phone || '—'} />
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--br)', paddingTop: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--td)' }}>Memorandum of Agreement</div>
            <MoaBadge l={viewing} />
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => setViewing(null)}>Close</button>
            {moaActions(viewing)}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function MoaBadge({ l }: { l: Listing }) {
  const status = moaOf(l)?.status ?? 'pending';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: MOA_COLOR[status], margin: '4px 0' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: MOA_COLOR[status], display: 'inline-block' }} />
      {MOA_LABEL[status]}
    </div>
  );
}

function Field({ label, value, full, bold, pre }: { label: string; value: string; full?: boolean; bold?: boolean; pre?: boolean }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <div style={{ fontSize: 11.5, color: 'var(--ts)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>{label}</div>
      <div style={{ color: 'var(--td)', fontWeight: bold ? 700 : 500, whiteSpace: pre ? 'pre-wrap' : undefined }}>{value}</div>
    </div>
  );
}
