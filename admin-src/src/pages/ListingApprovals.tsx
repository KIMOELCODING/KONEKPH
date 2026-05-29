import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Listing } from '../types';
import RejectModal from '../components/RejectModal';

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

function fullAddress(l: Listing): string {
  return [l.street_address, l.barangay, l.city, l.province, l.region]
    .filter(Boolean)
    .join(', ');
}

export default function ListingApprovals() {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [viewing, setViewing] = useState<Listing | null>(null);
  const [rejecting, setRejecting] = useState<Listing | null>(null);

  async function load() {
    const { data, error } = await sb
      .from('listings')
      .select('id, broker_id, title, category, property_type, price, region, province, city, barangay, street_address, lot_area_sqm, floor_area_sqm, bedrooms, bathrooms, amenities, description, images, status, rejection_reason, created_at, profiles!broker_id(first_name,last_name,phone,email,license_number)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) { setToast({ msg: error.message, err: true }); return; }
    // supabase-js infers the embedded `profiles!broker_id(...)` as an array, but
    // a to-one FK embed returns a single object at runtime (and the UI reads it
    // as one). Cast through unknown to reconcile the type with reality.
    setRows((data ?? []) as unknown as Listing[]);
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  async function approve(l: Listing) {
    setBusy(l.id);
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb
      .from('listings')
      .update({ status: 'active', approved_at: new Date().toISOString(), approved_by: user?.id })
      .eq('id', l.id);
    if (!error) {
      await sb.from('notifications').insert({
        user_id: l.broker_id,
        type: 'listing_approved',
        title: 'Listing approved',
        body: `${l.title} is now live on Konek.PH.`,
      });
      sb.functions.invoke('notify-broker', {
        body: { broker_id: l.broker_id, action: 'listing_approved', listing_id: l.id },
      }).catch(e => console.warn('notify-broker (listing_approved) failed:', e));
    }
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Listing approved.');
    setViewing(v => v?.id === l.id ? null : v);
    setRows(rs => rs?.filter(r => r.id !== l.id) ?? rs);
  }

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
      }).catch(e => console.warn('notify-broker (listing_rejected) failed:', e));
    }
    setBusy(null);
    setRejecting(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Listing rejected.');
    setViewing(v => v?.id === l.id ? null : v);
    setRows(rs => rs?.filter(r => r.id !== l.id) ?? rs);
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
            const img = publicImg(l.images?.[0]);
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
                  <div className="lst-actions">
                    <button className="btn btn-secondary" disabled={busy === l.id} onClick={() => setViewing(l)}>
                      <i className="fa-regular fa-eye"></i> View
                    </button>
                    <button className="btn btn-danger" disabled={busy === l.id} onClick={() => setRejecting(l)}>Reject</button>
                    <button className="btn btn-primary" disabled={busy === l.id} onClick={() => approve(l)} style={{ flex: 1, justifyContent: 'center' }}>Approve</button>
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

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setViewing(null)}>Close</button>
            <button className="btn btn-danger" disabled={busy === viewing.id} onClick={() => setRejecting(viewing)}>Reject</button>
            <button className="btn btn-primary" disabled={busy === viewing.id} onClick={() => approve(viewing)}>Approve</button>
          </div>
        </div>
      </div>
    )}
    </>
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
