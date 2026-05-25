import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
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
        <SlideForm
          form={form}
          setForm={setForm}
          busy={busy}
          uploading={uploading}
          uploadImage={uploadImage}
          save={save}
        />
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

interface SlideFormProps {
  form: FormState;
  setForm: (f: FormState | null | ((prev: FormState | null) => FormState | null)) => void;
  busy: string | null;
  uploading: boolean;
  uploadImage: (file: File) => Promise<string | null>;
  save: () => Promise<void>;
}

function SlideForm({ form, setForm, busy, uploading, uploadImage, save }: SlideFormProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const bodyChars = form.body.length;
  const wordCount = useMemo(
    () => form.body.trim().split(/\s+/).filter(Boolean).length,
    [form.body]
  );

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const url = await uploadImage(file);
    if (url) setForm(f => f ? { ...f, image_url: url } : f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  return (
    <div className="form-card">
      <div className="form-header">
        <div className="form-title">{form.id ? 'Edit slide' : 'New slide'}</div>
        <button className="btn btn-ghost" onClick={() => setForm(null)}>
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div className="form-grid">
        <div className="form-field">
          <div className="form-label">Title <span className="req">*</span></div>
          <input
            className="input"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="Headline shown on the carousel slide"
          />
        </div>

        <div className="form-field">
          <div className="form-label">Company name</div>
          <input
            className="input"
            value={form.company_name}
            onChange={e => setForm({ ...form, company_name: e.target.value })}
            placeholder="Shown as the byline"
          />
        </div>

        <div className="form-field">
          <div className="form-label">Image <span className="req">*</span></div>
          <div
            className={'dropzone' + (dragOver ? ' is-drag' : '') + (uploading ? ' is-busy' : '')}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={e => handleFile(e.target.files?.[0])}
            />
            {form.image_url ? (
              <div className="dz-preview">
                <img src={form.image_url} alt="" />
                <div className="dz-pmeta">
                  <strong>Image attached</strong>
                  {uploading ? 'Uploading…' : 'Click or drop another file to replace.'}
                </div>
              </div>
            ) : (
              <>
                <div className="dz-icon"><i className="fa-solid fa-cloud-arrow-up"></i></div>
                <div className="dz-title">{uploading ? 'Uploading…' : 'Drag & drop or click to upload'}</div>
                <div className="dz-hint">PNG, JPG, or WebP · up to ~5 MB · required</div>
              </>
            )}
          </div>
          <div className="or-divider">or</div>
          <input
            className="input"
            placeholder="Paste an image URL"
            value={form.image_url}
            onChange={e => setForm({ ...form, image_url: e.target.value })}
          />
        </div>

        <div className="form-field">
          <div className="form-label">Body (shown when slide is clicked)</div>
          <textarea
            className="input"
            style={{ minHeight: 140 }}
            value={form.body}
            onChange={e => setForm({ ...form, body: e.target.value })}
            placeholder="Describe the promotion in detail."
          />
          <div className="form-counter">{wordCount} {wordCount === 1 ? 'word' : 'words'} · {bodyChars} chars</div>
        </div>

        <div className="form-grid-2" style={{ alignItems: 'end' }}>
          <div className="form-field">
            <div className="form-label">Starts at</div>
            <input
              type="datetime-local"
              className="input"
              value={form.starts_at}
              onChange={e => setForm({ ...form, starts_at: e.target.value })}
            />
          </div>
          <div className="form-field">
            <div className="form-label">Ends at</div>
            <input
              type="datetime-local"
              className="input"
              value={form.ends_at}
              onChange={e => setForm({ ...form, ends_at: e.target.value })}
            />
          </div>
        </div>

        <div className="form-grid-2" style={{ alignItems: 'start' }}>
          <div className="form-field">
            <div className="form-label">Sort order</div>
            <input
              type="number"
              className="input"
              value={form.sort_order}
              onChange={e => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
            />
            <div className="form-help">Lower numbers appear first in the carousel.</div>
          </div>
          <label className="toggle-row" style={{ marginTop: 0 }}>
            <div className="toggle-text">
              <div className="toggle-title">Active</div>
              <div className="toggle-help">Inactive slides are hidden from the broker carousel.</div>
            </div>
            <span className="toggle">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => setForm({ ...form, is_active: e.target.checked })}
              />
              <span className="slider"></span>
            </span>
          </label>
        </div>
      </div>

      <div className="form-footer">
        <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={busy !== null} onClick={save}>
          {form.id ? 'Save changes' : 'Create slide'}
        </button>
      </div>
    </div>
  );
}
