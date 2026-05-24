import { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import type { PromotedSlide } from '../types';

interface FormState {
  id: string | null;
  title: string;
  company_name: string;
  image_url: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  title: '',
  company_name: '',
  image_url: '',
  body: '',
  sort_order: 0,
  is_active: true,
  starts_at: '',
  ends_at: '',
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function toIsoOrNull(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminPromotions() {
  const [rows, setRows] = useState<PromotedSlide[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  async function load() {
    const { data, error } = await sb
      .from('promoted_slides')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) { showToast(error.message, true); return; }
    setRows((data ?? []) as PromotedSlide[]);
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  async function uploadImage(file: File): Promise<string | null> {
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `slides/${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage.from('article-images').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'image/jpeg',
      });
      if (error) { showToast(error.message, true); return null; }
      const { data } = sb.storage.from('article-images').getPublicUrl(path);
      return data.publicUrl;
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form) return;
    if (!form.title.trim()) { showToast('Title is required.', true); return; }
    if (!form.image_url.trim()) { showToast('Image is required.', true); return; }
    setBusy(form.id ?? '__new');
    const { data: { user } } = await sb.auth.getUser();
    const payload: Partial<PromotedSlide> & { created_by?: string | null } = {
      title: form.title.trim(),
      company_name: form.company_name.trim() || null,
      image_url: form.image_url.trim(),
      body: form.body.trim() || null,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
      starts_at: toIsoOrNull(form.starts_at),
      ends_at: toIsoOrNull(form.ends_at),
    };
    let error;
    if (form.id) {
      ({ error } = await sb.from('promoted_slides').update(payload).eq('id', form.id));
    } else {
      payload.created_by = user?.id ?? null;
      ({ error } = await sb.from('promoted_slides').insert(payload));
    }
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast(form.id ? 'Slide updated.' : 'Slide created.');
    setForm(null);
    load();
  }

  async function toggleActive(s: PromotedSlide) {
    setBusy(s.id);
    const { error } = await sb
      .from('promoted_slides')
      .update({ is_active: !s.is_active })
      .eq('id', s.id);
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast(s.is_active ? 'Deactivated.' : 'Activated.');
    load();
  }

  async function move(s: PromotedSlide, dir: -1 | 1) {
    if (!rows) return;
    const idx = rows.findIndex(r => r.id === s.id);
    const swap = rows[idx + dir];
    if (!swap) return;
    setBusy(s.id);
    const a = sb.from('promoted_slides').update({ sort_order: swap.sort_order }).eq('id', s.id);
    const b = sb.from('promoted_slides').update({ sort_order: s.sort_order }).eq('id', swap.id);
    const [r1, r2] = await Promise.all([a, b]);
    setBusy(null);
    if (r1.error || r2.error) { showToast((r1.error || r2.error)!.message, true); return; }
    load();
  }

  async function remove(s: PromotedSlide) {
    if (!confirm(`Delete slide "${s.title}"? This cannot be undone.`)) return;
    setBusy(s.id);
    const { error } = await sb.from('promoted_slides').delete().eq('id', s.id);
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Slide deleted.');
    setRows(rs => rs?.filter(r => r.id !== s.id) ?? rs);
  }

  function startEdit(s: PromotedSlide) {
    setForm({
      id: s.id,
      title: s.title,
      company_name: s.company_name ?? '',
      image_url: s.image_url,
      body: s.body ?? '',
      sort_order: s.sort_order,
      is_active: s.is_active,
      starts_at: toLocalInput(s.starts_at),
      ends_at: toLocalInput(s.ends_at),
    });
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Promotions (carousel slides)</div>
          <div className="card-sub">{rows ? `${rows.length} slides` : 'Loading…'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
          <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY_FORM, sort_order: (rows?.length ?? 0) * 10 })}>
            <i className="fa-solid fa-plus"></i> New slide
          </button>
        </div>
      </div>

      {form && (
        <div className="card" style={{ marginBottom: 16, background: 'rgba(255,255,255,.65)' }}>
          <div className="card-header">
            <div className="card-title">{form.id ? 'Edit slide' : 'New slide'}</div>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
          </div>
          <div style={{ display: 'grid', gap: 12, padding: 4 }}>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Title *</div>
              <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Company name</div>
              <input className="input" value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} placeholder="Shown as the byline" />
            </label>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Image *</div>
              {form.image_url && (
                <div style={{ marginBottom: 8 }}>
                  <img src={form.image_url} alt="" style={{ maxWidth: 320, maxHeight: 200, borderRadius: 8, objectFit: 'cover' }} />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const url = await uploadImage(file);
                  if (url) setForm(f => f ? { ...f, image_url: url } : f);
                }}
              />
              {uploading && <span style={{ marginLeft: 10, fontSize: 12 }}>Uploading…</span>}
              <input
                className="input"
                placeholder="…or paste an image URL"
                value={form.image_url}
                onChange={e => setForm({ ...form, image_url: e.target.value })}
                style={{ marginTop: 6 }}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Body (shown when the slide is clicked)</div>
              <textarea
                className="input"
                rows={5}
                value={form.body}
                onChange={e => setForm({ ...form, body: e.target.value })}
                placeholder="Describe the promotion in detail."
              />
            </label>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <label>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Starts at</div>
                <input type="datetime-local" className="input" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} />
              </label>
              <label>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Ends at</div>
                <input type="datetime-local" className="input" value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Sort order
                <input
                  type="number"
                  className="input"
                  style={{ width: 80, marginLeft: 6 }}
                  value={form.sort_order}
                  onChange={e => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                Active
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy !== null} onClick={save}>
                {form.id ? 'Save changes' : 'Create slide'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="empty">
          <i className="fa-solid fa-bullhorn"></i>
          <h3>No slides yet</h3>
          <p>Add a slide to start showing carousel promotions on the broker home page.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="lst-grid">
          {rows.map((s, i) => (
            <div key={s.id} className="lst-card">
              <div className="lst-img" style={s.image_url ? { backgroundImage: `url(${s.image_url})` } : undefined}>
                {!s.image_url && <i className="fa-regular fa-image"></i>}
              </div>
              <div className="lst-body">
                <div className="lst-title">{s.title}</div>
                {s.company_name && <div className="lst-meta">{s.company_name}</div>}
                <div className="lst-meta">
                  <span style={{ color: s.is_active ? '#0a7a3f' : '#a16207', fontWeight: 600 }}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span style={{ marginLeft: 8 }}>· order {s.sort_order}</span>
                </div>
                <div className="lst-meta">
                  {fmtDate(s.starts_at)} → {fmtDate(s.ends_at)}
                </div>
                <div className="lst-actions" style={{ flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost" disabled={busy === s.id || i === 0} onClick={() => move(s, -1)}>↑</button>
                  <button className="btn btn-ghost" disabled={busy === s.id || i === rows.length - 1} onClick={() => move(s, 1)}>↓</button>
                  <button className="btn btn-ghost" disabled={busy === s.id} onClick={() => startEdit(s)}>Edit</button>
                  <button className="btn btn-ghost" disabled={busy === s.id} onClick={() => toggleActive(s)}>
                    {s.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button className="btn btn-danger" disabled={busy === s.id} onClick={() => remove(s)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </div>
  );
}
