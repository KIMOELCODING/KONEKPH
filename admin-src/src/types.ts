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
  role: 'broker' | 'admin';
  subscription_status: string;
  created_at: string;
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
  description: string | null;
  images: string[];
  status: 'pending' | 'active' | 'archive' | 'rejected';
  rejection_reason: string | null;
  created_at: string;
  profiles?: { first_name: string; last_name: string; phone: string | null } | null;
}
