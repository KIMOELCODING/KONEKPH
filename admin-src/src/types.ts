export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  id_photo_url: string | null;
  prc_id_url: string | null;
  is_approved: boolean;
  approved_at: string | null;
  role: 'broker' | 'admin' | 'marketing';
  subscription_status: string;
  created_at: string;
}

export interface MoaAgreement {
  id: string;
  status: 'pending' | 'sent' | 'signed' | 'declined';
  signed_pdf_path: string | null;
  broker_signed_at: string | null;
}

export interface Listing {
  id: string;
  broker_id: string;
  title: string;
  category: string;
  property_type: string | null;
  price: number;
  region: string;
  province: string;
  city: string;
  barangay: string | null;
  street_address: string | null;
  lot_area_sqm: number | null;
  floor_area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  description: string | null;
  images: string[];
  status: 'pending' | 'active' | 'archive' | 'rejected';
  rejection_reason: string | null;
  created_at: string;
  profiles?: { first_name: string; last_name: string; phone: string | null; email: string | null; license_number: string | null } | null;
  // to-one embed of the per-listing MOA (unique on listing_id) — returned as an array by supabase-js.
  moa_agreements?: MoaAgreement[] | null;
}

export type ArticleType = 'news' | 'announcement' | 'memorandum';

export interface Article {
  id: string;
  type: ArticleType;
  title: string;
  body: string | null;
  image_url: string | null;
  is_trending: boolean;
  published_at: string | null;
  created_at: string;
}

export interface Report {
  id: string;
  listing_id: string;
  reporter_id: string;
  reason: string;
  description: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  created_at: string;
  listings?: { id: string; title: string; broker_id: string; status: string; images: string[] | null; price: number; city: string | null; province: string | null } | null;
  profiles?: { first_name: string; last_name: string; email: string | null } | null;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  category: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  reference_no: string | null;
  created_at: string;
  profiles?: { first_name: string; last_name: string; email: string | null } | null;
}

export interface PromotedSlide {
  id: string;
  title: string;
  company_name: string | null;
  image_url: string;
  body: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}
