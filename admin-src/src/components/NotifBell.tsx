import { useEffect, useRef, useState } from 'react';
import { sb } from '../lib/supabase';

interface NotifRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

interface Props {
  userId: string;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  if (s < 172800) return 'Yesterday';
  if (s < 604800) return Math.floor(s / 86400) + ' days ago';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function iconFor(type: string): { cls: string; tone: string } {
  switch (type) {
    case 'broker_signup':   return { cls: 'fa-solid fa-user-plus',   tone: 'green' };
    case 'broker_reapply':  return { cls: 'fa-solid fa-rotate',      tone: 'gold'  };
    case 'new_listing':     return { cls: 'fa-solid fa-house-circle-check', tone: 'blue' };
    case 'listing_approved':return { cls: 'fa-solid fa-circle-check',tone: 'green' };
    case 'listing_rejected':return { cls: 'fa-solid fa-circle-xmark',tone: 'red'   };
    default:                return { cls: 'fa-regular fa-bell',      tone: 'gray'  };
  }
}

const TONE_BG: Record<string, string> = {
  green: 'rgba(232,245,238,.95)',
  red:   'rgba(248,228,228,.95)',
  blue:  'rgba(225,235,248,.95)',
  gold:  'rgba(249,239,215,.95)',
  gray:  'rgba(232,232,232,.95)',
};
const TONE_FG: Record<string, string> = {
  green: '#1a8050',
  red:   '#c83e3e',
  blue:  '#3a5db8',
  gold:  '#c98512',
  gray:  '#666',
};

export default function NotifBell({ userId }: Props) {
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  async function load() {
    const { data, error } = await sb
      .from('notifications')
      .select('id, type, title, body, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) { console.warn('[admin-notif] load error', error); return; }
    setRows((data ?? []) as NotifRow[]);
  }

  useEffect(() => {
    load();
    const ch = sb
      .channel('admin-notif-' + userId)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId },
          () => load())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [userId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unread = rows.filter(r => !r.read_at).length;

  async function markAll() {
    if (!unread) return;
    const nowIso = new Date().toISOString();
    setRows(rs => rs.map(r => r.read_at ? r : { ...r, read_at: nowIso }));
    const { error } = await sb
      .from('notifications')
      .update({ read_at: nowIso })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) { console.warn('[admin-notif] markAll error', error); load(); }
  }

  async function markOne(id: string) {
    const row = rows.find(r => r.id === id);
    if (!row || row.read_at) return;
    const nowIso = new Date().toISOString();
    setRows(rs => rs.map(r => r.id === id ? { ...r, read_at: nowIso } : r));
    const { error } = await sb
      .from('notifications')
      .update({ read_at: nowIso })
      .eq('id', id);
    if (error) { console.warn('[admin-notif] markOne error', error); load(); }
  }

  return (
    <div className="notif-bell" ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{
          background: 'transparent', border: 0, cursor: 'pointer', padding: 6,
          borderRadius: 8, position: 'relative', color: 'var(--td, #1a2a1f)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <i className="fa-regular fa-bell" style={{ fontSize: 17 }}></i>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#d63838', color: '#fff', fontSize: 10, fontWeight: 700,
            minWidth: 16, height: 16, borderRadius: 999, padding: '0 4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1.5px solid #fff',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 340,
          background: '#fff', border: '1px solid var(--br, #e4e7e5)',
          borderRadius: 12, boxShadow: '0 10px 30px rgba(10,30,18,.12)',
          zIndex: 99999, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid var(--br, #e4e7e5)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>Notifications</div>
            <button
              type="button"
              onClick={markAll}
              disabled={!unread}
              style={{
                background: 'transparent', border: 0,
                color: unread ? 'var(--gd, #1a8050)' : '#aaa',
                fontSize: 12, fontWeight: 600, cursor: unread ? 'pointer' : 'default',
              }}
            >Mark all read</button>
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {rows.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#777', fontSize: 12.5 }}>
                No notifications yet.
              </div>
            ) : (
              rows.slice(0, 12).map(r => {
                const info = iconFor(r.type);
                return (
                  <div
                    key={r.id}
                    onClick={() => markOne(r.id)}
                    style={{
                      display: 'flex', gap: 10, padding: '10px 14px',
                      borderBottom: '1px solid #f1f2f1', cursor: 'pointer',
                      background: r.read_at ? '#fff' : 'rgba(234,245,238,.4)',
                    }}
                  >
                    <div style={{
                      width: 30, height: 30, borderRadius: 8,
                      background: TONE_BG[info.tone], color: TONE_FG[info.tone],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, fontSize: 13,
                    }}>
                      <i className={info.cls}></i>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--td, #1a2a1f)', lineHeight: 1.35 }}>
                        <strong>{r.title}</strong>
                        {r.body ? <> — {r.body}</> : null}
                      </div>
                      <div style={{ fontSize: 10.5, color: '#888', marginTop: 2 }}>
                        {timeAgo(r.created_at)}
                      </div>
                    </div>
                    {!r.read_at && (
                      <div style={{
                        width: 8, height: 8, borderRadius: 999,
                        background: 'var(--gd, #1a8050)', flexShrink: 0, marginTop: 6,
                      }}></div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
