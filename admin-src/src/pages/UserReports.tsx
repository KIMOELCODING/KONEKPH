import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { UserReport, UserReportReason } from '../types';

const REASON_LABELS: Record<UserReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  fraud: 'Fraud',
  fake_listing: 'Fake Listing',
  inappropriate: 'Inappropriate Behavior',
  scam: 'Scam',
  other: 'Other',
};

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function personName(p: UserReport['reporter']): string {
  return `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || '—';
}

export default function UserReports() {
  const [rows, setRows] = useState<UserReport[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  async function load() {
    setRows(null);
    const { data, error } = await sb
      .from('user_reports')
      .select('id, reporter_id, reported_user_id, conversation_id, reason, description, status, created_at, reporter:profiles!reporter_id(first_name,last_name,email), reported:profiles!reported_user_id(first_name,last_name,email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) { setToast({ msg: error.message, err: true }); setRows([]); return; }
    // supabase-js types a to-one FK embed as an array; runtime is a single object.
    setRows((data ?? []) as unknown as UserReport[]);
  }

  useEffect(() => { load(); }, []);

  // Record-only moderation: mark the report resolved or dismissed + stamp the
  // reviewer. No action is taken against the reported user's account.
  async function review(r: UserReport, status: 'resolved' | 'dismissed') {
    setBusy(r.id);
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
      .from('user_reports')
      .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', r.id)
      .select('id');
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    if (!data || data.length === 0) {
      showToast('Update blocked by RLS — confirm your account has role=admin in profiles.', true);
      return;
    }
    setRows(rs => rs?.filter(x => x.id !== r.id) ?? rs);
    showToast(status === 'resolved' ? 'Report resolved.' : 'Report dismissed.');
  }

  const count = rows?.length ?? 0;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">User reports</div>
          <div className="card-sub">{rows ? `${count} awaiting review` : 'Loading…'}</div>
        </div>
        <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
      </div>

      {rows && rows.length === 0 && (
        <div className="empty">
          <i className="fa-solid fa-circle-check"></i>
          <h3>All caught up</h3>
          <p>No user reports awaiting review.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Reported user</th>
              <th>Reporter</th>
              <th>Reason</th>
              <th>Details</th>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>
                  <div><strong>{personName(r.reported)}</strong></div>
                  <div className="muted txt-sm">{r.reported?.email ?? '—'}</div>
                </td>
                <td>
                  <div>{personName(r.reporter)}</div>
                  <div className="muted txt-sm">{r.reporter?.email ?? '—'}</div>
                </td>
                <td>
                  <span style={{ display: 'inline-block', background: 'rgba(200,68,68,.1)', color: '#c44', border: '1px solid rgba(200,68,68,.25)', borderRadius: 8, padding: '2px 9px', fontSize: 12, fontWeight: 600 }}>
                    <i className="fa-solid fa-flag" style={{ marginRight: 5 }}></i>{REASON_LABELS[r.reason] ?? r.reason}
                  </span>
                </td>
                <td style={{ maxWidth: 360 }}>
                  <div className="muted txt-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{r.description || '—'}</div>
                </td>
                <td className="muted txt-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                    <button className="btn btn-ghost" disabled={busy === r.id} onClick={() => review(r, 'dismissed')}>Dismiss</button>
                    <button className="btn btn-primary" disabled={busy === r.id} onClick={() => review(r, 'resolved')}>Resolve</button>
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
