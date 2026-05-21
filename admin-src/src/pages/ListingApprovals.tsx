import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Listing } from '../types';

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

export default function ListingApprovals() {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  async function load() {
    const { data, error } = await sb
      .from('listings')
      .select('*, profiles!broker_id(first_name,last_name,phone)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) { setToast({ msg: error.message, err: true }); return; }
    setRows((data ?? []) as Listing[]);
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
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Listing approved.');
    setRows(rs => rs?.filter(r => r.id !== l.id) ?? rs);
  }

  async function reject(l: Listing) {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
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
    }
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Listing rejected.');
    setRows(rs => rs?.filter(r => r.id !== l.id) ?? rs);
  }

  return (
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
                <div className="lst-img" style={img ? { backgroundImage: `url(${img})` } : undefined}>
                  {!img && <i className="fa-regular fa-image"></i>}
                </div>
                <div className="lst-body">
                  <div className="lst-title">{l.title}</div>
                  <div className="lst-price">{peso(Number(l.price))}</div>
                  <div className="lst-meta">
                    <i className="fa-solid fa-location-dot"></i> {l.city}, {l.province}
                  </div>
                  <div className="lst-meta">
                    <i className="fa-solid fa-user"></i> {l.profiles?.first_name} {l.profiles?.last_name}
                    <span style={{ marginLeft: 8 }}>· {fmtDate(l.created_at)}</span>
                  </div>
                  <div className="lst-actions">
                    <button className="btn btn-danger" disabled={busy === l.id} onClick={() => reject(l)}>Reject</button>
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
  );
}
