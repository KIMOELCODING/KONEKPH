import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Profile } from '../types';

interface DocState { url: string | null; error: string | null }
interface DocUrls { id_photo: DocState; prc_id: DocState }
const emptyDocs: DocUrls = { id_photo: { url: null, error: null }, prc_id: { url: null, error: null } };

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function BrokerApprovals() {
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [viewing, setViewing] = useState<Profile | null>(null);
  const [docs, setDocs] = useState<DocUrls>(emptyDocs);

  async function load() {
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('is_approved', false)
      .eq('role', 'broker')
      .order('created_at', { ascending: false });
    if (error) { setToast({ msg: error.message, err: true }); return; }
    setRows((data ?? []) as Profile[]);
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  async function approve(p: Profile) {
    setBusy(p.id);
    const { error } = await sb
      .from('profiles')
      .update({ is_approved: true, approved_at: new Date().toISOString(), subscription_status: 'pending_approval' })
      .eq('id', p.id);
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Broker approved.');
    setRows(rs => rs?.filter(r => r.id !== p.id) ?? rs);
  }

  async function reject(p: Profile) {
    const reason = prompt('Rejection reason (will be sent to the broker):');
    if (!reason) return;
    setBusy(p.id);
    const { error } = await sb.from('notifications').insert({
      user_id: p.id,
      type: 'broker_rejected',
      title: 'Application rejected',
      body: reason,
    });
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Rejection sent.');
    setRows(rs => rs?.filter(r => r.id !== p.id) ?? rs);
  }

  async function openDocs(p: Profile) {
    setViewing(p);
    setDocs(emptyDocs);
    const next: DocUrls = { id_photo: { url: null, error: null }, prc_id: { url: null, error: null } };
    for (const [key, path] of [['id_photo', p.id_photo_url], ['prc_id', p.prc_id_url]] as const) {
      if (!path) { (next as any)[key].error = 'No path stored on profile.'; continue; }
      const { data, error } = await sb.storage.from('id-documents').createSignedUrl(path, 60 * 5);
      if (error) {
        console.error(`[openDocs] createSignedUrl failed for ${key} path="${path}":`, error);
        (next as any)[key].error = error.message || String(error);
      } else if (data?.signedUrl) {
        (next as any)[key].url = data.signedUrl;
      } else {
        (next as any)[key].error = 'createSignedUrl returned no URL and no error.';
      }
    }
    setDocs(next);
  }

  return (
    <>
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Pending broker applications</div>
          <div className="card-sub">{rows ? `${rows.length} waiting for review` : 'Loading…'}</div>
        </div>
        <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
      </div>

      {rows && rows.length === 0 && (
        <div className="empty">
          <i className="fa-solid fa-circle-check"></i>
          <h3>All caught up</h3>
          <p>No pending broker applications right now.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>License #</th>
              <th>Submitted</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id}>
                <td><strong>{p.first_name} {p.last_name}</strong></td>
                <td className="muted txt-sm">{p.email}</td>
                <td className="muted txt-sm">{p.license_number || '—'}</td>
                <td className="muted txt-sm">{fmtDate(p.created_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" disabled={busy === p.id} onClick={() => openDocs(p)}>
                      <i className="fa-regular fa-eye"></i> Docs
                    </button>
                    <button className="btn btn-danger" disabled={busy === p.id} onClick={() => reject(p)}>
                      Reject
                    </button>
                    <button className="btn btn-primary" disabled={busy === p.id} onClick={() => approve(p)}>
                      Approve
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>

      {viewing && (
        <div className="modal-overlay" onClick={() => setViewing(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2>{viewing.first_name} {viewing.last_name}</h2>
            <p className="modal-sub">PRC License #: {viewing.license_number || '—'}</p>
            <div className="docs-grid">
              <div className="doc">
                {docs.id_photo.url
                  ? <img src={docs.id_photo.url} alt="1×1 photo"
                      onClick={() => window.open(docs.id_photo.url!, '_blank', 'noopener')}
                      onError={() => console.error('[Docs] 1x1 photo image failed to load:', docs.id_photo.url)} />
                  : <div className="empty" style={{ padding: 30 }}>
                      <i className="fa-regular fa-image"></i>
                      <p>{docs.id_photo.error || 'No photo'}</p>
                    </div>}
                <div className="doc-label">1×1 Photo</div>
              </div>
              <div className="doc">
                {docs.prc_id.url
                  ? <img src={docs.prc_id.url} alt="PRC ID"
                      onClick={() => window.open(docs.prc_id.url!, '_blank', 'noopener')}
                      onError={() => console.error('[Docs] PRC ID image failed to load:', docs.prc_id.url)} />
                  : <div className="empty" style={{ padding: 30 }}>
                      <i className="fa-regular fa-id-card"></i>
                      <p>{docs.prc_id.error || 'No PRC ID'}</p>
                    </div>}
                <div className="doc-label">PRC ID</div>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setViewing(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </>
  );
}
