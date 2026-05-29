import { useEffect, useMemo, useState } from 'react';
import { sb } from '../lib/supabase';
import type { Profile } from '../types';

type StatusFilter = 'active' | 'deactivated';

// Marker stored in rejected_reason so a deactivated (previously approved) broker
// is distinguishable from a freshly-rejected applicant and stays out of the
// BrokerApprovals queue (which filters rejected_at is null).
const DEACTIVATED_REASON = 'Deactivated by admin';

const COLS = 'id, first_name, last_name, email, phone, license_number, id_photo_url, prc_id_url, is_approved, approved_at, role, subscription_status, created_at';

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Confirm {
  profile: Profile;
  kind: 'deactivate' | 'reactivate' | 'promote' | 'demote';
}

export default function AdminUsers() {
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  async function load() {
    setRows(null);
    let q = sb.from('profiles').select(COLS);
    q = filter === 'active'
      ? q.eq('is_approved', true)
      : q.eq('rejected_reason', DEACTIVATED_REASON);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) { showToast(error.message, true); setRows([]); return; }
    setRows((data ?? []) as Profile[]);
  }

  useEffect(() => { load(); }, [filter]);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  const visible = useMemo(() => {
    if (!rows) return null;
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(p =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(term) ||
      (p.email ?? '').toLowerCase().includes(term) ||
      (p.license_number ?? '').toLowerCase().includes(term)
    );
  }, [rows, query]);

  async function runConfirm() {
    if (!confirm) return;
    const { profile: p, kind } = confirm;
    setBusy(p.id);
    let patch: Record<string, unknown>;
    if (kind === 'deactivate') {
      patch = { is_approved: false, rejected_at: new Date().toISOString(), rejected_reason: DEACTIVATED_REASON };
    } else if (kind === 'reactivate') {
      patch = { is_approved: true, rejected_at: null, rejected_reason: null };
    } else {
      patch = { role: kind === 'promote' ? 'admin' : 'broker' };
    }
    const { data, error } = await sb.from('profiles').update(patch).eq('id', p.id).select();
    setBusy(null);
    setConfirm(null);
    if (error) { showToast(error.message, true); return; }
    if (!data || data.length === 0) {
      showToast('Update blocked by RLS — confirm your account has role=admin in profiles.', true);
      return;
    }
    const verb = kind === 'deactivate' ? 'deactivated'
      : kind === 'reactivate' ? 'reactivated'
      : kind === 'promote' ? 'promoted to admin'
      : 'set to broker';
    showToast(`${p.first_name} ${p.last_name} ${verb}.`);
    // Deactivate/reactivate move the row between filters; role change stays put.
    if (kind === 'deactivate' || kind === 'reactivate') {
      setRows(rs => rs?.filter(r => r.id !== p.id) ?? rs);
    } else {
      setRows(rs => rs?.map(r => r.id === p.id ? { ...r, ...(patch as Partial<Profile>) } : r) ?? rs);
    }
  }

  const confirmCopy = (c: Confirm) => {
    const nm = `${c.profile.first_name} ${c.profile.last_name}`;
    switch (c.kind) {
      case 'deactivate': return { title: 'Deactivate account', body: `${nm} will lose access and be signed out on next load. You can reactivate them later from the Deactivated filter.`, cta: 'Deactivate', danger: true };
      case 'reactivate': return { title: 'Reactivate account', body: `${nm} will regain access to the broker app.`, cta: 'Reactivate', danger: false };
      case 'promote': return { title: 'Grant admin access', body: `${nm} will become an admin with full access to this portal.`, cta: 'Make admin', danger: true };
      case 'demote': return { title: 'Revoke admin access', body: `${nm} will be downgraded to a regular broker.`, cta: 'Set to broker', danger: true };
    }
  };

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Users</div>
            <div className="card-sub">{visible ? `${visible.length} ${filter === 'active' ? 'active' : 'deactivated'}` : 'Loading…'}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Search name, email, license…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ minWidth: 240 }}
            />
            <select className="input" value={filter} onChange={e => setFilter(e.target.value as StatusFilter)}>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
            <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
          </div>
        </div>

        {visible && visible.length === 0 && (
          <div className="empty">
            <i className="fa-solid fa-users"></i>
            <h3>No users</h3>
            <p>{query ? 'No users match your search.' : `No ${filter} users right now.`}</p>
          </div>
        )}

        {visible && visible.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>License #</th>
                <th>Role</th>
                <th>Joined</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(p => {
                const isMe = p.id === meId;
                return (
                  <tr key={p.id}>
                    <td><strong>{p.first_name} {p.last_name}</strong>{isMe && <span className="muted txt-sm"> (you)</span>}</td>
                    <td className="muted txt-sm">{p.email}</td>
                    <td className="muted txt-sm">{p.license_number || '—'}</td>
                    <td>
                      <span className={'badge ' + (p.role === 'admin' ? 'badge-active' : 'badge-pending')} style={{ textTransform: 'capitalize' }}>{p.role}</span>
                    </td>
                    <td className="muted txt-sm">{fmtDate(p.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {p.role === 'admin'
                          ? <button className="btn btn-secondary" disabled={busy === p.id || isMe} title={isMe ? "You can't change your own role" : ''} onClick={() => setConfirm({ profile: p, kind: 'demote' })}>Set broker</button>
                          : <button className="btn btn-secondary" disabled={busy === p.id} onClick={() => setConfirm({ profile: p, kind: 'promote' })}>Make admin</button>}
                        {filter === 'active'
                          ? <button className="btn btn-danger" disabled={busy === p.id || isMe} title={isMe ? "You can't deactivate yourself" : ''} onClick={() => setConfirm({ profile: p, kind: 'deactivate' })}>Deactivate</button>
                          : <button className="btn btn-primary" disabled={busy === p.id} onClick={() => setConfirm({ profile: p, kind: 'reactivate' })}>Reactivate</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (() => {
        const c = confirmCopy(confirm);
        return (
          <div className="modal-overlay" onClick={() => setConfirm(null)}>
            <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
              <h2>{c.title}</h2>
              <p className="modal-sub">{c.body}</p>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
                <button className={'btn ' + (c.danger ? 'btn-danger' : 'btn-primary')} disabled={busy === confirm.profile.id} onClick={runConfirm}>{c.cta}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </>
  );
}
