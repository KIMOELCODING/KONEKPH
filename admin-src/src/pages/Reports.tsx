import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Report } from '../types';
import RejectModal from '../components/RejectModal';

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

// Small transformed thumbnail for the report card image (full original loads in
// the report detail modal). Uses the SDK transform like the broker app's __plImg.
function thumbImg(path: string | undefined): string | null {
  if (!path) return null;
  return sb.storage.from('listing-images')
    .getPublicUrl(path, { transform: { width: 400, height: 300, resize: 'cover', quality: 70 } })
    .data.publicUrl || null;
}

function reporterName(r: Report): string {
  return `${r.profiles?.first_name ?? ''} ${r.profiles?.last_name ?? ''}`.trim() || '—';
}

export default function Reports() {
  const [rows, setRows] = useState<Report[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [viewing, setViewing] = useState<Report | null>(null);
  const [takingDown, setTakingDown] = useState<Report | null>(null);

  async function load() {
    const { data, error } = await sb
      .from('listing_reports')
      .select('id, listing_id, reporter_id, reason, description, status, created_at, listings!listing_id(id,title,broker_id,status,images,price,city,province), profiles!reporter_id(first_name,last_name,email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) { setToast({ msg: error.message, err: true }); return; }
    // supabase-js types a to-one FK embed as an array, but at runtime it's a
    // single object (and the UI reads it that way). Cast through unknown.
    setRows((data ?? []) as unknown as Report[]);
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  async function markReviewed(r: Report, status: 'resolved' | 'dismissed', adminId?: string): Promise<{ message: string } | null> {
    const { data, error } = await sb
      .from('listing_reports')
      .update({ status, reviewed_by: adminId, reviewed_at: new Date().toISOString() })
      .eq('id', r.id)
      .select('id');
    if (error) return error;
    if (!data || data.length === 0) return { message: 'Update blocked by RLS — confirm your account has role=admin in profiles.' };
    return null;
  }

  // Take the reported listing down: set it to 'rejected' (disappears from the
  // broker app), notify the listing's broker (reusing the existing
  // listing_rejected flow), then resolve the report.
  async function confirmTakeDown(r: Report, reason: string) {
    const listing = r.listings;
    if (!listing) { showToast('Listing no longer exists.', true); setTakingDown(null); return; }
    setBusy(r.id);
    const { data: { user } } = await sb.auth.getUser();

    const { data: listData, error: listErr } = await sb
      .from('listings')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', listing.id)
      .select('id');
    if (listErr) { setBusy(null); setTakingDown(null); showToast(listErr.message, true); return; }
    if (!listData || listData.length === 0) {
      setBusy(null); setTakingDown(null);
      showToast('Update blocked by RLS — confirm your account has role=admin in profiles.', true);
      return;
    }

    await sb.from('notifications').insert({
      user_id: listing.broker_id,
      type: 'listing_rejected',
      title: 'Listing removed',
      body: `${listing.title}: ${reason}`,
    });
    sb.functions.invoke('notify-broker', {
      body: { broker_id: listing.broker_id, action: 'listing_rejected', listing_id: listing.id, reason },
    }).then(({ error: mailErr }) => { if (mailErr) showToast('Listing taken down, but the broker email could not be sent.', true); })
      .catch(() => showToast('Listing taken down, but the broker email could not be sent.', true));

    const repErr = await markReviewed(r, 'resolved', user?.id);
    setBusy(null);
    setTakingDown(null);
    if (repErr) { showToast(repErr.message, true); return; }
    showToast('Listing taken down and broker notified.');
    setViewing(v => v?.id === r.id ? null : v);
    setRows(rs => rs?.filter(x => x.id !== r.id) ?? rs);
  }

  async function dismiss(r: Report) {
    setBusy(r.id);
    const { data: { user } } = await sb.auth.getUser();
    const repErr = await markReviewed(r, 'dismissed', user?.id);
    setBusy(null);
    if (repErr) { showToast(repErr.message, true); return; }
    showToast('Report dismissed.');
    setViewing(v => v?.id === r.id ? null : v);
    setRows(rs => rs?.filter(x => x.id !== r.id) ?? rs);
  }

  return (
    <>
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Listing reports</div>
          <div className="card-sub">{rows ? `${rows.length} awaiting review` : 'Loading…'}</div>
        </div>
        <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
      </div>

      {rows && rows.length === 0 && (
        <div className="empty">
          <i className="fa-solid fa-circle-check"></i>
          <h3>All caught up</h3>
          <p>No reports awaiting review.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="lst-grid">
          {rows.map(r => {
            const l = r.listings;
            const img = thumbImg(l?.images?.[0]);
            return (
              <div key={r.id} className="lst-card">
                <div
                  className="lst-img"
                  style={{ ...(img ? { backgroundImage: `url(${img})` } : undefined), cursor: 'pointer' }}
                  onClick={() => setViewing(r)}
                  title="View report"
                >
                  {!img && <i className="fa-regular fa-image"></i>}
                </div>
                <div className="lst-body">
                  <div className="lst-title" style={{ cursor: 'pointer' }} onClick={() => setViewing(r)}>{l?.title ?? '(listing removed)'}</div>
                  <div style={{ display: 'inline-block', background: 'rgba(200,68,68,.1)', color: '#c44', border: '1px solid rgba(200,68,68,.25)', borderRadius: 8, padding: '2px 9px', fontSize: 12, fontWeight: 600, margin: '2px 0 6px' }}>
                    <i className="fa-solid fa-flag" style={{ marginRight: 5 }}></i>{r.reason}
                  </div>
                  {l && <div className="lst-price">{peso(Number(l.price))}</div>}
                  <div className="lst-meta">
                    <i className="fa-solid fa-user"></i> Reported by {reporterName(r)}
                    <span style={{ marginLeft: 8 }}>· {fmtDate(r.created_at)}</span>
                  </div>
                  {l?.status && l.status !== 'active' && (
                    <div className="lst-meta" style={{ color: '#c44' }}>
                      <i className="fa-solid fa-circle-info"></i> Listing status: {l.status}
                    </div>
                  )}
                  <div className="lst-actions">
                    <button className="btn btn-secondary" disabled={busy === r.id} onClick={() => setViewing(r)}>
                      <i className="fa-regular fa-eye"></i> View
                    </button>
                    <button className="btn btn-ghost" disabled={busy === r.id} onClick={() => dismiss(r)}>Dismiss</button>
                    <button className="btn btn-danger" disabled={busy === r.id || !l} onClick={() => setTakingDown(r)} style={{ flex: 1, justifyContent: 'center' }}>Take down</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </div>

    {takingDown && (
      <RejectModal
        title="Take down listing"
        subject={takingDown.listings?.title ?? 'this listing'}
        busy={busy === takingDown.id}
        onCancel={() => setTakingDown(null)}
        onConfirm={(reason) => confirmTakeDown(takingDown, reason)}
      />
    )}

    {viewing && (
      <div className="modal-overlay" onClick={() => setViewing(null)}>
        <div className="modal-box" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
          <h2>{viewing.listings?.title ?? '(listing removed)'}</h2>
          <p className="modal-sub">Reported {fmtDate(viewing.created_at)}</p>

          {viewing.listings?.images && viewing.listings.images.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 18 }}>
              {viewing.listings.images.map((path, i) => {
                const url = publicImg(path);
                return url ? (
                  <a key={i} href={url} target="_blank" rel="noopener">
                    <img src={url} alt={`Image ${i + 1}`} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--br)', display: 'block', cursor: 'zoom-in' }} />
                  </a>
                ) : null;
              })}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px', marginBottom: 18, fontSize: 13.5 }}>
            <Field label="Reason" value={viewing.reason} bold />
            <Field label="Listing status" value={viewing.listings?.status ?? '—'} />
            {viewing.listings && <Field label="Price" value={peso(Number(viewing.listings.price))} />}
            <Field label="Location" value={[viewing.listings?.city, viewing.listings?.province].filter(Boolean).join(', ') || '—'} />
            {viewing.description && <Field label="Details from reporter" value={viewing.description} full pre />}
          </div>

          <div style={{ borderTop: '1px solid var(--br)', paddingTop: 14, marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--td)' }}>Reported by</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13.5 }}>
              <Field label="Name" value={reporterName(viewing)} />
              <Field label="Email" value={viewing.profiles?.email || '—'} />
            </div>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setViewing(null)}>Close</button>
            <button className="btn btn-ghost" disabled={busy === viewing.id} onClick={() => dismiss(viewing)}>Dismiss</button>
            <button className="btn btn-danger" disabled={busy === viewing.id || !viewing.listings} onClick={() => setTakingDown(viewing)}>Take down</button>
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
