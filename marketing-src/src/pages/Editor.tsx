import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { MarketingListing } from '../types';
import { storageUrl, marketingRef } from '../lib/img';

function peso(n: number) {
  return '₱' + Number(n).toLocaleString('en-PH');
}

const SELECT =
  'id, listing_id, public_title, public_description, highlights, hero_image, gallery, tags, featured, published, published_at, status, created_at, updated_at, ' +
  'listings:listing_id(id, title, price, category, property_type, region, province, city, barangay, bedrooms, bathrooms, lot_area_sqm, floor_area_sqm, description, images, status)';

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [row, setRow] = useState<MarketingListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Editable fields (local state)
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [highlights, setHighlights] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [featured, setFeatured] = useState(false);
  const [hero, setHero] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [hlInput, setHlInput] = useState('');
  const [tagInput, setTagInput] = useState('');

  function hydrate(m: MarketingListing) {
    setRow(m);
    setTitle(m.public_title ?? '');
    setDesc(m.public_description ?? '');
    setHighlights(m.highlights ?? []);
    setTags(m.tags ?? []);
    setFeatured(!!m.featured);
    setHero(m.hero_image ?? null);
    setGallery(m.gallery ?? []);
  }

  async function load() {
    const { data, error } = await sb.from('marketing_listings').select(SELECT).eq('id', id).single();
    if (error) { setToast({ msg: error.message, err: true }); return; }
    hydrate(data as unknown as MarketingListing);
  }

  useEffect(() => { load(); }, [id]);

  function showToast(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  }

  function addHighlight() {
    const v = hlInput.trim();
    if (v && !highlights.includes(v)) setHighlights([...highlights, v]);
    setHlInput('');
  }
  function addTag() {
    const v = tagInput.trim();
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setTagInput('');
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !row) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const f of files) {
        const ext = f.name.split('.').pop() || 'jpg';
        const key = `${row.listing_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await sb.storage.from('marketing-images').upload(key, f, { upsert: false });
        if (error) { showToast(error.message, true); continue; }
        added.push(marketingRef(key));
      }
      if (added.length) {
        const next = [...gallery, ...added];
        setGallery(next);
        if (!hero) setHero(added[0]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removeImage(ref: string) {
    setGallery(gallery.filter(g => g !== ref));
    if (hero === ref) setHero(gallery.find(g => g !== ref) ?? null);
  }

  async function save(): Promise<boolean> {
    setBusy(true);
    const { error } = await sb.from('marketing_listings').update({
      public_title: title.trim() || null,
      public_description: desc.trim() || null,
      highlights,
      tags,
      featured,
      hero_image: hero,
      gallery,
    }).eq('id', id);
    setBusy(false);
    if (error) { showToast(error.message, true); return false; }
    showToast('Saved.');
    return true;
  }

  async function togglePublish() {
    // Persist edits first so what goes public matches the editor.
    const ok = await save();
    if (!ok) return;
    setBusy(true);
    const publish = !row?.published;
    const { data, error } = await sb.from('marketing_listings').update({
      published: publish,
      published_at: publish ? new Date().toISOString() : null,
      status: publish ? 'published' : 'unpublished',
    }).eq('id', id).select(SELECT).single();
    setBusy(false);
    if (error) { showToast(error.message, true); return; }
    hydrate(data as unknown as MarketingListing);
    showToast(publish ? 'Published to the public site.' : 'Unpublished.');
  }

  if (!row) {
    return <div className="card"><p className="muted">Loading…</p></div>;
  }

  const facts = row.listings;
  const fullLocation = facts ? [facts.barangay, facts.city, facts.province, facts.region].filter(Boolean).join(', ') : '—';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn btn-ghost" onClick={() => nav('/queue')}><i className="fa-solid fa-arrow-left"></i> Queue</button>
        <span className={'badge-status badge-' + row.status} style={{ position: 'static' }}>{row.status}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 18, alignItems: 'start' }}>
        {/* LEFT — editable presentation */}
        <div className="card">
          <div className="card-header"><div className="card-title">Public presentation</div></div>

          <div className="field">
            <label>Public title</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder={facts?.title || 'Headline buyers see'} />
          </div>

          <div className="field">
            <label>Public description</label>
            <textarea className="input" rows={5} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Rewrite the broker's description into sales copy…" />
          </div>

          <div className="field">
            <label>Highlights</label>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" value={hlInput} onChange={e => setHlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHighlight(); } }}
                placeholder="e.g. Beachfront · Move-in ready" />
              <button className="btn btn-secondary" onClick={addHighlight}>Add</button>
            </div>
            <div className="chip-row">
              {highlights.map(h => (
                <span key={h} className="chip">{h} <button onClick={() => setHighlights(highlights.filter(x => x !== h))}><i className="fa-solid fa-xmark"></i></button></span>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Tags (SEO / search)</label>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="e.g. condo, makati, rfo" />
              <button className="btn btn-secondary" onClick={addTag}>Add</button>
            </div>
            <div className="chip-row">
              {tags.map(t => (
                <span key={t} className="chip">{t} <button onClick={() => setTags(tags.filter(x => x !== t))}><i className="fa-solid fa-xmark"></i></button></span>
              ))}
            </div>
          </div>

          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} style={{ width: 'auto' }} />
              Feature on the public homepage
            </label>
          </div>

          {/* Images */}
          <div className="field">
            <label>Photos <span className="muted" style={{ fontWeight: 400 }}>· click a photo to set it as the hero</span></label>
            <div className="img-grid">
              {gallery.map(ref => {
                const url = storageUrl(ref);
                return (
                  <div key={ref} className={'img-tile' + (hero === ref ? ' is-hero' : '')} style={url ? { backgroundImage: `url(${url})` } : undefined}>
                    <div className="tile-actions">
                      <button onClick={() => setHero(ref)}>{hero === ref ? '★ Hero' : 'Set hero'}</button>
                      <button onClick={() => removeImage(ref)}>Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 10 }}>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={onUpload} style={{ display: 'none' }} />
              <button className="btn btn-secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <i className="fa-solid fa-upload"></i> {uploading ? 'Uploading…' : 'Upload photos'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT — locked facts + actions */}
        <div className="card" style={{ position: 'sticky', top: 16 }}>
          <div className="card-header"><div className="card-title">Locked facts</div></div>
          <div className="locked-grid">
            <div className="locked-field"><div className="lf-label">Price</div><div className="lf-value">{facts ? peso(facts.price) : '—'}</div></div>
            <div className="locked-field"><div className="lf-label">Category</div><div className="lf-value">{facts?.category}{facts?.property_type ? ` · ${facts.property_type}` : ''}</div></div>
            <div className="locked-field"><div className="lf-label">Bedrooms</div><div className="lf-value">{facts?.bedrooms ?? '—'}</div></div>
            <div className="locked-field"><div className="lf-label">Bathrooms</div><div className="lf-value">{facts?.bathrooms ?? '—'}</div></div>
            <div className="locked-field"><div className="lf-label">Lot area</div><div className="lf-value">{facts?.lot_area_sqm != null ? `${facts.lot_area_sqm} sqm` : '—'}</div></div>
            <div className="locked-field"><div className="lf-label">Floor area</div><div className="lf-value">{facts?.floor_area_sqm != null ? `${facts.floor_area_sqm} sqm` : '—'}</div></div>
            <div className="locked-field" style={{ gridColumn: '1 / -1' }}><div className="lf-label">Location (broker truth)</div><div className="lf-value">{fullLocation}</div></div>
          </div>
          <div className="lock-note"><i className="fa-solid fa-lock"></i> These come from the broker's listing and can't be edited here.</div>

          <div style={{ borderTop: '1px solid var(--br)', marginTop: 16, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-secondary" disabled={busy} onClick={save}><i className="fa-solid fa-floppy-disk"></i> Save draft</button>
            <button className={'btn ' + (row.published ? 'btn-danger' : 'btn-primary')} disabled={busy} onClick={togglePublish} style={{ justifyContent: 'center' }}>
              {row.published ? <><i className="fa-solid fa-eye-slash"></i> Unpublish</> : <><i className="fa-solid fa-globe"></i> Publish</>}
            </button>
            {row.published && row.published_at && (
              <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Live since {new Date(row.published_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            )}
          </div>
        </div>
      </div>

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </>
  );
}
