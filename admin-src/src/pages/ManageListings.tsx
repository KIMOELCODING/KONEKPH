import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Listing, MoaAgreement } from '../types';
import RejectModal from '../components/RejectModal';

// How many rows to fetch per page (server-side via .range()).
const PAGE = 60;

// Column list for a listing row, reused by the list query and single-row refetch.
const SELECT = 'id, broker_id, title, category, property_type, price, region, province, city, barangay, street_address, lot_area_sqm, floor_area_sqm, bedrooms, bathrooms, amenities, description, images, status, rejection_reason, created_at, profiles!broker_id(first_name,last_name,phone,email,license_number), moa_agreements(id,status,signed_pdf_path,broker_signed_at)';

type ManagedStatus = 'active' | 'rejected' | 'archive';

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

const STATUS_LABEL: Record<ManagedStatus, string> = {
  active: 'Active',
  rejected: 'Rejected',
  archive: 'Archived',
};

const STATUS_COLOR: Record<ManagedStatus, string> = {
  active: '#16a34a',
  rejected: '#dc2626',
  archive: '#64748b',
};

const FILTERS: ManagedStatus[] = ['active', 'rejected', 'archive'];

function peso(n: number) {
  return '₱' + Number(n || 0).toLocaleString('en-PH');
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

// Small transformed thumbnail for card images (full original is loaded only in
// the details modal). Cuts grid payload from multi-MB originals to ~tens of KB.
// Uses the SDK transform (same as the broker app's __plImg) so URL encoding and
// the render endpoint format are handled correctly.
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

export default function ManageListings() {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [filter, setFilter] = useState<ManagedStatus>('active');
  const [counts, setCounts] = useState<Record<ManagedStatus, number> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [viewing, setViewing] = useState<Listing | null>(null);
  const [rejecting, setRejecting] = useState<Listing | null>(null);

  // Per-status totals via cheap head-only COUNT queries — so the page never
  // loads the entire listings table just to show the filter-tab counts.
  async function loadCounts() {
    const results = await Promise.all(FILTERS.map(s =>
      sb.from('listings').select('id', { count: 'exact', head: true }).eq('status', s)));
    const next: Record<ManagedStatus, number> = { active: 0, rejected: 0, archive: 0 };
    FILTERS.forEach((s, i) => { next[s] = results[i].count ?? 0; });
    setCounts(next);
  }

  // Load one page of the selected status, server-side paginated via .range().
  // reset=true replaces the list (filter change / refresh); false appends (Load more).
  async function load(reset = true) {
    if (reset) setRows(null); else setLoadingMore(true);
    const from = reset ? 0 : (rows?.length ?? 0);
    const { data, error } = await sb
      .from('listings')
      .select(SELECT)
      .eq('status', filter)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    setLoadingMore(false);
    if (error) { setToast({ msg: error.message, err: true }); if (reset) setRows([]); return; }
    // supabase-js infers the to-one `profiles!broker_id(...)` embed as an array,
    // but it's a single object at runtime (and the UI reads it that way).
    const page = (data ?? []) as unknown as Listing[];
    setRows(prev => (reset || !prev) ? page : [...prev, ...page]);
  }

  // Reload the page whenever the status filter changes; counts load once.
  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);
  useEffect(() => { loadCounts(); }, []);

  const shown = rows ?? [];
  const hasMore = !!(counts && rows && rows.length < counts[filter]);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  // A status change moves the row out of the current filter's view: drop it from
  // the list, adjust the per-status counts, and close the details modal.
  function afterStatusChange(l: Listing, to: ManagedStatus) {
    const from = l.status as ManagedStatus;
    setRows(rs => rs?.filter(r => r.id !== l.id) ?? rs);
    setCounts(c => (c ? { ...c, [from]: Math.max(0, c[from] - 1), [to]: c[to] + 1 } : c));
    setViewing(v => (v && v.id === l.id ? null : v));
  }

  // Quiet, restorable unpublish: drops the listing from the public site and the
  // broker's active feed, but keeps it intact. In-app notice only (no email).
  async function archive(l: Listing) {
    setBusy(l.id);
    const { error } = await sb
      .from('listings')
      .update({ status: 'archive' })
      .eq('id', l.id);
    if (!error) {
      await sb.from('notifications').insert({
        user_id: l.broker_id,
        type: 'listing_archived',
        title: 'Listing unpublished',
        body: `${l.title} was temporarily unpublished by an admin.`,
      });
    }
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Listing archived.');
    afterStatusChange(l, 'archive');
  }

  // Bring an archived/rejected listing back live. Admin is the actor, so the
  // reset_listing_on_edit trigger does NOT bounce it to 'pending'.
  async function restore(l: Listing) {
    setBusy(l.id);
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb
      .from('listings')
      .update({ status: 'active', rejection_reason: null, approved_at: new Date().toISOString(), approved_by: user?.id })
      .eq('id', l.id);
    if (!error) {
      await sb.from('notifications').insert({
        user_id: l.broker_id,
        type: 'listing_restored',
        title: 'Listing live again',
        body: `${l.title} is live again on ProList.`,
      });
    }
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Listing restored.');
    afterStatusChange(l, 'active');
  }

  // Send (or re-send) the per-listing MOA — for older listings that went live
  // before the MOA flow existed, or to re-issue after a broker declined.
  async function sendMoa(l: Listing) {
    setBusy(l.id);
    const { error } = await sb.functions.invoke('moa', {
      body: { action: 'generate', listing_id: l.id },
    });
    setBusy(null);
    if (error) {
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
    // The listing stays in the current view (status unchanged) — refetch just this
    // row so its MOA badge/buttons update without reloading the whole page.
    const { data } = await sb.from('listings').select(SELECT).eq('id', l.id).single();
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

  // Reject with reason — mirrors ListingApprovals.confirmReject: notifies the
  // broker by email so they can edit and resubmit.
  async function confirmReject(l: Listing, reason: string) {
    setBusy(l.id);
    const { error } = await sb
      .from('listings')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', l.id);
    if (!error) {
      await sb.from('notifications').insert({
        user_id: l.broker_id,
        type: 'listing_rejected',
        title: 'Listing removed',
        body: `${l.title}: ${reason}`,
      });
      sb.functions.invoke('notify-broker', {
        body: { broker_id: l.broker_id, action: 'listing_rejected', listing_id: l.id, reason },
      }).catch(e => console.warn('notify-broker (listing_rejected) failed:', e));
    }
    setBusy(null);
    setRejecting(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Listing rejected and broker notified.');
    afterStatusChange(l, 'rejected');
  }

  // MOA button: Send / re-send for listings that lack a signed agreement, or
  // view the signed PDF once the broker has signed. Not shown for rejected.
  function moaButton(l: Listing) {
    const status = moaOf(l)?.status;
    const disabled = busy === l.id;
    if (status === 'signed') {
      return (
        <button className="btn btn-secondary" disabled={disabled} onClick={() => viewSignedMoa(l)}>
          <i className="fa-regular fa-file-lines"></i> Signed MOA
        </button>
      );
    }
    return (
      <button className="btn btn-secondary" disabled={disabled || status === 'sent'} onClick={() => sendMoa(l)}>
        <i className="fa-regular fa-paper-plane"></i> {status === 'sent' ? 'MOA sent' : 'Send MOA'}
      </button>
    );
  }

  // Status-aware action buttons, shared by the card and the details modal.
  function actions(l: Listing) {
    const disabled = busy === l.id;
    return (
      <>
        {(l.status === 'active' || l.status === 'archive') && moaButton(l)}
        {l.status === 'active' && (
          <button className="btn btn-secondary" disabled={disabled} onClick={() => archive(l)}>
            <i className="fa-regular fa-eye-slash"></i> Archive
          </button>
        )}
        {(l.status === 'archive' || l.status === 'rejected') && (
          <button className="btn btn-primary" disabled={disabled} onClick={() => restore(l)}>
            <i className="fa-solid fa-arrow-rotate-left"></i> Restore
          </button>
        )}
        {(l.status === 'active' || l.status === 'archive') && (
          <button className="btn btn-danger" disabled={disabled} onClick={() => setRejecting(l)}>Reject</button>
        )}
      </>
    );
  }

  return (
    <>
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Manage listings</div>
          <div className="card-sub">{counts ? `${counts[filter]} ${STATUS_LABEL[filter].toLowerCase()}` : 'Loading…'}</div>
        </div>
        <button className="btn btn-ghost" onClick={() => { load(true); loadCounts(); }}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button
            key={f}
            className={'btn ' + (filter === f ? 'btn-primary' : 'btn-secondary')}
            onClick={() => setFilter(f)}
          >
            {STATUS_LABEL[f]} {counts ? `(${counts[f]})` : ''}
          </button>
        ))}
      </div>

      {rows && shown.length === 0 && (
        <div className="empty">
          <i className="fa-regular fa-folder-open"></i>
          <h3>Nothing here</h3>
          <p>No {STATUS_LABEL[filter].toLowerCase()} listings.</p>
        </div>
      )}

      {rows && shown.length > 0 && (
        <div className="lst-grid">
          {shown.map(l => {
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
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <StatusBadge status={l.status} />
                    {l.status !== 'rejected' && <MoaBadge l={l} />}
                  </div>
                  <div className="lst-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-ghost" disabled={busy === l.id} onClick={() => setViewing(l)}>
                      <i className="fa-regular fa-eye"></i> View
                    </button>
                    {actions(l)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-secondary" disabled={loadingMore} onClick={() => load(false)}>
            {loadingMore ? 'Loading…' : `Load more (${(counts ? counts[filter] : 0) - (rows?.length ?? 0)} more)`}
          </button>
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
            {viewing.rejection_reason && viewing.status === 'rejected' && (
              <Field label="Rejection reason" value={viewing.rejection_reason} full pre />
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

          {viewing.status !== 'rejected' && (
            <div style={{ borderTop: '1px solid var(--br)', paddingTop: 14, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--td)' }}>Memorandum of Agreement</div>
              <MoaBadge l={viewing} />
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => setViewing(null)}>Close</button>
            {actions(viewing)}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function StatusBadge({ status }: { status: Listing['status'] }) {
  const s: ManagedStatus = status === 'active' || status === 'rejected' || status === 'archive' ? status : 'archive';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: STATUS_COLOR[s], margin: '4px 0' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[s], display: 'inline-block' }} />
      {STATUS_LABEL[s]}
    </div>
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
