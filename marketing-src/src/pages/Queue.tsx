import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sb } from '../lib/supabase';
import type { MarketingListing } from '../types';
import { storageUrl } from '../lib/img';

function peso(n: number) {
  return '₱' + Number(n).toLocaleString('en-PH');
}

type Filter = 'queued' | 'published' | 'unpublished' | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'published', label: 'Published' },
  { key: 'unpublished', label: 'Unpublished' },
  { key: 'all', label: 'All' },
];

const SELECT =
  'id, listing_id, public_title, public_description, highlights, hero_image, gallery, tags, featured, published, published_at, status, created_at, updated_at, ' +
  'listings:listing_id(id, title, price, category, property_type, region, province, city, barangay, bedrooms, bathrooms, lot_area_sqm, floor_area_sqm, description, images, status)';

export default function Queue() {
  const [rows, setRows] = useState<MarketingListing[] | null>(null);
  const [filter, setFilter] = useState<Filter>('queued');
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const nav = useNavigate();

  async function load() {
    setRows(null);
    let q = sb.from('marketing_listings').select(SELECT).order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    const { data, error } = await q;
    if (error) { setToast({ msg: error.message, err: true }); setRows([]); return; }
    setRows((data ?? []) as unknown as MarketingListing[]);
  }

  useEffect(() => { load(); }, [filter]);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Listing queue</div>
          <div className="card-sub">{rows ? `${rows.length} ${filter === 'all' ? 'total' : filter}` : 'Loading…'}</div>
        </div>
        <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-arrows-rotate"></i> Refresh</button>
      </div>

      <div className="seg" style={{ marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={'seg-btn' + (filter === f.key ? ' active' : '')}
            onClick={() => setFilter(f.key)}
          >{f.label}</button>
        ))}
      </div>

      {rows && rows.length === 0 && (
        <div className="empty">
          <i className="fa-solid fa-layer-group"></i>
          <h3>Nothing here</h3>
          <p>No listings in “{filter}”. Approved listings appear here automatically.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="lst-grid">
          {rows.map(m => {
            const facts = m.listings;
            const img = storageUrl(m.hero_image) || storageUrl(m.gallery?.[0]);
            return (
              <div key={m.id} className="lst-card" style={{ cursor: 'pointer' }} onClick={() => nav(`/queue/${m.id}`)}>
                <div className="lst-img" style={img ? { backgroundImage: `url(${img})` } : undefined}>
                  {!img && <i className="fa-regular fa-image"></i>}
                  <span className={'badge-status badge-' + m.status}>{m.status}</span>
                  {m.featured && <span className="badge-status badge-featured" style={{ left: 10, right: 'auto' }}>★ featured</span>}
                </div>
                <div className="lst-body">
                  <div className="lst-title">{m.public_title || facts?.title || 'Untitled'}</div>
                  <div className="lst-price">{facts ? peso(facts.price) : '—'}</div>
                  <div className="lst-meta">
                    <i className="fa-solid fa-location-dot"></i> {facts ? `${facts.city}, ${facts.province}` : '—'}
                  </div>
                  <div className="lst-meta">
                    <i className="fa-solid fa-bed"></i> {facts?.bedrooms ?? '—'} bd
                    <span style={{ marginLeft: 10 }}><i className="fa-solid fa-bath"></i> {facts?.bathrooms ?? '—'} ba</span>
                  </div>
                  <div className="lst-actions">
                    <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); nav(`/queue/${m.id}`); }}>
                      <i className="fa-solid fa-pen"></i> {m.published ? 'Edit' : 'Curate'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className={'toast' + (toast.err ? ' error' : '')}><i className={'fa-solid ' + (toast.err ? 'fa-circle-exclamation' : 'fa-circle-check')}></i> {toast.msg}</div>}
    </div>
  );
}
