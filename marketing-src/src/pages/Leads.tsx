import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Lead } from '../types';

const STATUSES: Lead['status'][] = ['new', 'contacted', 'forwarded', 'closed'];

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function Leads() {
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  async function load() {
    setRows(null);
    const { data, error } = await sb
      .from('leads')
      .select('id, marketing_listing_id, name, location, email, phone, message, status, created_at, marketing_listings:marketing_listing_id(public_title)')
      .order('created_at', { ascending: false });
    if (error) { setToast({ msg: error.message, err: true }); setRows([]); return; }
    setRows((data ?? []) as unknown as Lead[]);
  }

  useEffect(() => { load(); }, []);

  async function setStatus(lead: Lead, status: Lead['status']) {
    setBusy(lead.id);
    const { error } = await sb.from('leads').update({ status }).eq('id', lead.id);
    setBusy(null);
    if (error) { setToast({ msg: error.message, err: true }); setTimeout(() => setToast(null), 2800); return; }
    setRows(rs => rs?.map(r => r.id === lead.id ? { ...r, status } : r) ?? rs);
  }

  const newCount = rows?.filter(r => r.status === 'new').length ?? 0;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Buyer leads</div>
          <div className="card-sub">{rows ? `${rows.length} total · ${newCount} new` : 'Loading…'}</div>
        </div>
        <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
      </div>

      {rows && rows.length === 0 && (
        <div className="empty">
          <i className="fa-solid fa-inbox"></i>
          <h3>No leads yet</h3>
          <p>Buyer inquiries from the public site land here.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="lead-table">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Contact</th>
                <th>Interested in</th>
                <th>Message</th>
                <th>Received</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(l => (
                <tr key={l.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: 'var(--td)' }}>{l.name}</div>
                    {l.location && <div className="muted" style={{ fontSize: 12 }}>{l.location}</div>}
                  </td>
                  <td>
                    {l.email && <div><a href={`mailto:${l.email}`}>{l.email}</a></div>}
                    {l.phone && <div className="muted" style={{ fontSize: 12.5 }}>{l.phone}</div>}
                    {!l.email && !l.phone && '—'}
                  </td>
                  <td>{l.marketing_listings?.public_title || (l.marketing_listing_id ? 'A listing' : 'General inquiry')}</td>
                  <td style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{l.message || '—'}</td>
                  <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDate(l.created_at)}</td>
                  <td>
                    <select
                      className="input"
                      style={{ padding: '6px 8px', fontSize: 12.5 }}
                      value={l.status}
                      disabled={busy === l.id}
                      onChange={e => setStatus(l, e.target.value as Lead['status'])}
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </div>
  );
}
