export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  role: 'broker' | 'admin' | 'marketing';
  created_at: string;
}

// The broker's source-of-truth facts. Marketing reads these (joined) but never
// edits them — price/location/areas stay locked to the listing.
export interface ListingFacts {
  id: string;
  title: string;
  price: number;
  category: string;
  property_type: string | null;
  region: string;
  province: string;
  city: string;
  barangay: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  lot_area_sqm: number | null;
  floor_area_sqm: number | null;
  description: string | null;
  images: string[];
  status: string;
}

// The presentation record marketing owns and edits.
export interface MarketingListing {
  id: string;
  listing_id: string;
  public_title: string | null;
  public_description: string | null;
  highlights: string[];
  hero_image: string | null;
  gallery: string[];
  tags: string[];
  featured: boolean;
  published: boolean;
  published_at: string | null;
  status: 'queued' | 'published' | 'unpublished';
  created_at: string;
  updated_at: string;
  // Embedded source listing (supabase-js to-one FK embed).
  listings?: ListingFacts | null;
}

export interface Lead {
  id: string;
  marketing_listing_id: string | null;
  name: string;
  location: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  status: 'new' | 'contacted' | 'forwarded' | 'closed';
  created_at: string;
  marketing_listings?: { public_title: string | null } | null;
}
