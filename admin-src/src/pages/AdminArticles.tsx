import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { sb } from '../lib/supabase';
import type { Article, ArticleType } from '../types';

type FilterTab = 'all' | ArticleType;

const TYPES: ArticleType[] = ['news', 'announcement', 'memorandum'];

interface FormState {
  id: string | null;
  type: ArticleType;
  title: string;
  body: string;
  image_url: string;
  is_trending: boolean;
  publish: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  type: 'news',
  title: '',
  body: '',
  image_url: '',
  is_trending: false,
  publish: false,
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AdminArticles() {
  const [rows, setRows] = useState<Article[] | null>(null);
  const [tab, setTab] = useState<FilterTab>('all');
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  async function load() {
    const { data, error } = await sb
      .from('articles')
      .select('id, type, title, body, image_url, is_trending, published_at, created_at')
      .order('created_at', { ascending: false });
    if (error) { showToast(error.message, true); return; }
    setRows((data ?? []) as Article[]);
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (tab === 'all') return rows;
    return rows.filter(r => r.type === tab);
  }, [rows, tab]);

  async function uploadImage(file: File): Promise<string | null> {
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `articles/${crypto.randomUUID()}.${ext}`;
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
    setBusy(form.id ?? '__new');
    const { data: { user } } = await sb.auth.getUser();
    const payload: Partial<Article> & { created_by?: string | null } = {
      type: form.type,
      title: form.title.trim(),
      body: form.body.trim() || null,
      image_url: form.image_url.trim() || null,
      is_trending: form.is_trending,
      published_at: form.publish ? new Date().toISOString() : null,
    };
    let error;
    if (form.id) {
      ({ error } = await sb.from('articles').update(payload).eq('id', form.id));
    } else {
      payload.created_by = user?.id ?? null;
      ({ error } = await sb.from('articles').insert(payload));
    }
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast(form.id ? 'Article updated.' : 'Article created.');
    setForm(null);
    load();
  }

  async function togglePublish(a: Article) {
    setBusy(a.id);
    const { error } = await sb
      .from('articles')
      .update({ published_at: a.published_at ? null : new Date().toISOString() })
      .eq('id', a.id);
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast(a.published_at ? 'Unpublished.' : 'Published.');
    load();
  }

  async function toggleTrending(a: Article) {
    setBusy(a.id);
    const { error } = await sb
      .from('articles')
      .update({ is_trending: !a.is_trending })
      .eq('id', a.id);
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast(a.is_trending ? 'Removed from Trending.' : 'Added to Trending.');
    load();
  }

  async function remove(a: Article) {
    if (!confirm(`Delete article "${a.title}"? This cannot be undone.`)) return;
    setBusy(a.id);
    const { error } = await sb.from('articles').delete().eq('id', a.id);
    setBusy(null);
    if (error) { showToast(error.message, true); return; }
    showToast('Article deleted.');
    setRows(rs => rs?.filter(r => r.id !== a.id) ?? rs);
  }

  function startEdit(a: Article) {
    setForm({
      id: a.id,
      type: a.type,
      title: a.title,
      body: a.body ?? '',
      image_url: a.image_url ?? '',
      is_trending: a.is_trending,
      publish: a.published_at !== null,
    });
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Articles</div>
          <div className="card-sub">{rows ? `${rows.length} total` : 'Loading…'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
          <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY_FORM })}>
            <i className="fa-solid fa-plus"></i> New article
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '0 4px 16px', flexWrap: 'wrap' }}>
        {(['all', ...TYPES] as FilterTab[]).map(t => (
          <button
            key={t}
            className={'btn ' + (tab === t ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setTab(t)}
            style={{ textTransform: 'capitalize' }}
          >
            {t}
          </button>
        ))}
      </div>

      {form && (
        <ArticleForm
          form={form}
          setForm={setForm}
          busy={busy}
          uploading={uploading}
          uploadImage={uploadImage}
          save={save}
        />
      )}

      {filtered && filtered.length === 0 && (
        <div className="empty">
          <i className="fa-regular fa-newspaper"></i>
          <h3>No articles</h3>
          <p>Click "New article" to publish your first.</p>
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <div className="lst-grid">
          {filtered.map(a => (
            <div key={a.id} className="lst-card">
              <div className="lst-img" style={a.image_url ? { backgroundImage: `url(${a.image_url})` } : undefined}>
                {!a.image_url && <i className="fa-regular fa-image"></i>}
              </div>
              <div className="lst-body">
                <div className="lst-title">{a.title}</div>
                <div className="lst-meta">
                  <span style={{ textTransform: 'capitalize', fontWeight: 700 }}>{a.type}</span>
                  <span style={{ marginLeft: 8 }}>· {fmtDate(a.created_at)}</span>
                </div>
                <div className="lst-meta">
                  <span style={{ color: a.published_at ? '#0a7a3f' : '#a16207', fontWeight: 600 }}>
                    {a.published_at ? `Published ${fmtDate(a.published_at)}` : 'Draft'}
                  </span>
                  {a.is_trending && <span style={{ marginLeft: 8 }}><i className="fa-solid fa-fire" style={{ color: '#dc2626' }}></i> Trending</span>}
                </div>
                <div className="lst-actions" style={{ flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost" disabled={busy === a.id} onClick={() => startEdit(a)}>Edit</button>
                  <button className="btn btn-ghost" disabled={busy === a.id} onClick={() => toggleTrending(a)}>
                    {a.is_trending ? 'Untrend' : 'Trend'}
                  </button>
                  <button className="btn btn-ghost" disabled={busy === a.id} onClick={() => togglePublish(a)}>
                    {a.published_at ? 'Unpublish' : 'Publish'}
                  </button>
                  <button className="btn btn-danger" disabled={busy === a.id} onClick={() => remove(a)}>Delete</button>
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

interface ArticleFormProps {
  form: FormState;
  setForm: (f: FormState | null | ((prev: FormState | null) => FormState | null)) => void;
  busy: string | null;
  uploading: boolean;
  uploadImage: (file: File) => Promise<string | null>;
  save: () => Promise<void>;
}

function ArticleForm({ form, setForm, busy, uploading, uploadImage, save }: ArticleFormProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
        <div className="form-title">{form.id ? 'Edit article' : 'New article'}</div>
        <button className="btn btn-ghost" onClick={() => setForm(null)}>
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div className="form-grid">
        <div className="form-field">
          <div className="form-label">Type</div>
          <div className="seg" role="tablist">
            {TYPES.map(t => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={form.type === t}
                className={'seg-btn' + (form.type === t ? ' active' : '')}
                onClick={() => setForm({ ...form, type: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="form-field">
          <div className="form-label">Title <span className="req">*</span></div>
          <input
            className="input"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="A short, descriptive headline"
          />
        </div>

        <div className="form-field">
          <div className="form-label">Image</div>
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
                <div className="dz-hint">PNG, JPG, or WebP · up to ~5 MB</div>
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
          <div className="form-label">Body</div>
          <textarea
            className="input"
            style={{ minHeight: 160 }}
            value={form.body}
            onChange={e => setForm({ ...form, body: e.target.value })}
            placeholder="Write the full article body. Plain text or simple HTML."
          />
          <div className="form-counter">{wordCount} {wordCount === 1 ? 'word' : 'words'}</div>
        </div>

        <div>
          <label className="toggle-row">
            <div className="toggle-text">
              <div className="toggle-title">Trending</div>
              <div className="toggle-help">Pin this article to the Trending sidebar on the broker home page.</div>
            </div>
            <span className="toggle">
              <input
                type="checkbox"
                checked={form.is_trending}
                onChange={e => setForm({ ...form, is_trending: e.target.checked })}
              />
              <span className="slider"></span>
            </span>
          </label>
          <label className="toggle-row">
            <div className="toggle-text">
              <div className="toggle-title">Publish</div>
              <div className="toggle-help">Make visible to brokers. Leave off to save as a draft.</div>
            </div>
            <span className="toggle">
              <input
                type="checkbox"
                checked={form.publish}
                onChange={e => setForm({ ...form, publish: e.target.checked })}
              />
              <span className="slider"></span>
            </span>
          </label>
        </div>
      </div>

      <div className="form-footer">
        <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={busy !== null} onClick={save}>
          {form.id ? 'Save changes' : 'Create article'}
        </button>
      </div>
    </div>
  );
}
