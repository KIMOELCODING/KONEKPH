import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { SupportTicket } from '../types';

const STATUSES: { v: SupportTicket['status']; label: string }[] = [
  { v: 'open', label: 'Open' },
  { v: 'in_progress', label: 'In progress' },
  { v: 'resolved', label: 'Resolved' },
  { v: 'closed', label: 'Closed' },
];

type Filter = 'all' | SupportTicket['status'];
type Kind = 'support' | 'feedback';
type KindFilter = 'all' | Kind;

// support_tickets has no `type` column: feedback submitted from the broker
// Settings panel is marked by a "Feedback …" category. Derive the kind from
// category so support vs feedback stays distinguishable (badge + filter) here.
function kindOf(t: SupportTicket): Kind {
  return (t.category ?? '').toLowerCase().startsWith('feedback') ? 'feedback' : 'support';
}

const KIND_BADGE: Record<Kind, React.CSSProperties> = {
  feedback: { background: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' },
  support:  { background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' },
};

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function requester(t: SupportTicket): string {
  return `${t.profiles?.first_name ?? ''} ${t.profiles?.last_name ?? ''}`.trim() || '—';
}

function statusBadgeClass(s: SupportTicket['status']): string {
  if (s === 'resolved') return 'badge badge-active';
  if (s === 'closed') return 'badge badge-rejected';
  return 'badge badge-pending'; // open / in_progress
}

const SELECT_STYLE: React.CSSProperties = {
  padding: '5px 8px', border: '1px solid var(--br)', borderRadius: 8,
  fontFamily: 'inherit', fontSize: 12.5, background: '#fff', color: 'var(--td)', cursor: 'pointer',
};

export default function SupportTickets() {
  const [rows, setRows] = useState<SupportTicket[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  async function load(f: Filter = filter) {
    setRows(null);
    let q = sb
      .from('support_tickets')
      .select('id, user_id, category, subject, message, status, reference_no, created_at, profiles!user_id(first_name,last_name,email)')
      .order('created_at', { ascending: false });
    if (f !== 'all') q = q.eq('status', f);
    const { data, error } = await q;
    if (error) { setToast({ msg: error.message, err: true }); setRows([]); return; }
    // supabase-js types a to-one FK embed as an array; runtime is a single object.
    setRows((data ?? []) as unknown as SupportTicket[]);
  }

  useEffect(() => { load(filter); /* eslint-disable-next-line */ }, [filter]);

  async function changeStatus(t: SupportTicket, status: SupportTicket['status']) {
    if (status === t.status) return;
    setBusy(t.id);
    const { data, error } = await sb
      .from('support_tickets')
      .update({ status })
      .eq('id', t.id)
      .select('id');
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    if (!data || data.length === 0) {
      showToast('Update blocked by RLS — confirm your account has role=admin in profiles.', true);
      return;
    }
    setRows(rs => rs?.map(x => (x.id === t.id ? { ...x, status } : x)) ?? rs);
    // If a status filter is active, drop rows that no longer match.
    if (filter !== 'all' && status !== filter) {
      setRows(rs => rs?.filter(x => x.id !== t.id) ?? rs);
    }
    showToast('Status updated.');
  }

  // Status is filtered server-side (load); kind is derived from category, so
  // filter it client-side over the loaded rows.
  const visible = (rows ?? []).filter(t => kindFilter === 'all' || kindOf(t) === kindFilter);
  const count = rows ? visible.length : 0;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Support tickets</div>
          <div className="card-sub">{rows ? `${count} ticket${count === 1 ? '' : 's'}${filter !== 'all' ? ' · ' + filter.replace('_', ' ') : ''}` : 'Loading…'}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select
            value={kindFilter}
            onChange={e => setKindFilter(e.target.value as KindFilter)}
            style={SELECT_STYLE}
            title="Filter by type"
          >
            <option value="all">All types</option>
            <option value="support">Support</option>
            <option value="feedback">Feedback</option>
          </select>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as Filter)}
            style={SELECT_STYLE}
            title="Filter by status"
          >
            <option value="all">All statuses</option>
            {STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={() => load(filter)}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
        </div>
      </div>

      {rows && visible.length === 0 && (
        <div className="empty">
          <i className="fa-solid fa-life-ring"></i>
          <h3>No tickets</h3>
          <p>{filter === 'all' && kindFilter === 'all' ? 'No support tickets have been submitted yet.' : 'No tickets match these filters.'}</p>
        </div>
      )}

      {rows && visible.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Requester</th>
              <th>Category</th>
              <th>Subject &amp; message</th>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(t => (
              <tr key={t.id}>
                <td><strong style={{ fontVariantNumeric: 'tabular-nums' }}>#{t.reference_no ?? '—'}</strong></td>
                <td>
                  <div><strong>{requester(t)}</strong></div>
                  <div className="muted txt-sm">{t.profiles?.email ?? '—'}</div>
                </td>
                <td>
                  <span className="badge" style={{ ...KIND_BADGE[kindOf(t)], display: 'inline-block', marginBottom: 4, textTransform: 'capitalize' }}>{kindOf(t)}</span>
                  <div>{t.category}</div>
                </td>
                <td style={{ maxWidth: 380 }}>
                  <div style={{ fontWeight: 600, color: 'var(--td)', marginBottom: 2 }}>{t.subject}</div>
                  <div className="muted txt-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{t.message}</div>
                </td>
                <td className="muted txt-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.created_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    <span className={statusBadgeClass(t.status)}>{t.status.replace('_', ' ')}</span>
                    <select
                      value={t.status}
                      disabled={busy === t.id}
                      onChange={e => changeStatus(t, e.target.value as SupportTicket['status'])}
                      style={SELECT_STYLE}
                      title="Change status"
                    >
                      {STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </div>
  );
}
