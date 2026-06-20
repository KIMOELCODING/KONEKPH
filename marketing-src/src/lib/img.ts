// Resolve a "<bucket>/<key>" image reference (the convention used across
// marketing_listings + public_listings) to a public storage URL. Returns null
// for empty/missing values so callers can fall back to a placeholder.
export function storageUrl(ref: string | null | undefined): string | null {
  if (!ref) return null;
  // Already a full URL (older rows / external) — pass through.
  if (/^https?:\/\//i.test(ref)) return ref;
  const base = window.SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${ref}`;
}

// Bucket-relative key (no bucket prefix) within the marketing-images bucket,
// for building the "<bucket>/<key>" value we store after an upload.
export function marketingRef(key: string): string {
  return `marketing-images/${key}`;
}
