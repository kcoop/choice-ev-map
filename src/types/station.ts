// Matches the NLR Alt Fuel Stations API response (subset of fields we use)
export interface RawStation {
  id: number;
  station_name: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  status_code: 'E' | 'P' | 'T';
  access_code: 'public' | 'private';
  restricted_access: boolean | null;
  access_days_time: string | null;
  ev_level1_evse_num: number | null;
  ev_level2_evse_num: number | null;
  ev_dc_fast_num: number | null;
  ev_connector_types: string[] | null;
  ev_network: string | null;
  ev_pricing: string | null;
  facility_type: string | null;
  date_last_confirmed: string | null;
  updated_at: string;
}

// A Choice Hotels property. EV fields are only meaningful when hasEV is true.
export interface Hotel {
  osmId: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  hasEV: boolean;
  l2Ports: number;
  dcFastPorts: number;
  connectors: string[];
  evNetwork: string | null;
  evPricing: string | null;
  evHours: string | null;
  evLastConfirmed: string | null;
  evUpdatedAt: string | null;
}

export interface HotelsData {
  fetchedAt: string;
  totalCount: number;
  evCount: number;
  hotels: Hotel[];
}

// Choice Hotels brand names and their display labels
export const CHOICE_BRANDS: { keyword: string; label: string }[] = [
  { keyword: 'cambria', label: 'Cambria' },
  { keyword: 'comfort inn', label: 'Comfort Inn' },
  { keyword: 'comfort suites', label: 'Comfort Suites' },
  { keyword: 'quality inn', label: 'Quality Inn' },
  { keyword: 'quality suites', label: 'Quality Suites' },
  { keyword: 'sleep inn', label: 'Sleep Inn' },
  { keyword: 'clarion pointe', label: 'Clarion Pointe' },
  { keyword: 'clarion', label: 'Clarion' },
  { keyword: 'woodspring', label: 'WoodSpring Suites' },
  { keyword: 'mainstay', label: 'MainStay Suites' },
  { keyword: 'suburban studios', label: 'Suburban Studios' },
  { keyword: 'suburban extended', label: 'Suburban Extended Stay' },
  { keyword: 'econo lodge', label: 'Econo Lodge' },
  { keyword: 'rodeway', label: 'Rodeway Inn' },
  { keyword: 'ascend collection', label: 'Ascend Collection' },
  { keyword: 'radisson blu', label: 'Radisson Blu' },
  { keyword: 'radisson red', label: 'Radisson Red' },
  { keyword: 'radisson individuals', label: 'Radisson Individuals' },
  { keyword: 'park inn', label: 'Park Inn by Radisson' },
  { keyword: 'country inn', label: 'Country Inn & Suites' },
  { keyword: 'radisson', label: 'Radisson' },
];

export function detectBrand(name: string): string | null {
  const lower = name.toLowerCase();
  const sorted = [...CHOICE_BRANDS].sort((a, b) => b.keyword.length - a.keyword.length);
  for (const { keyword, label } of sorted) {
    if (lower.includes(keyword)) return label;
  }
  return null;
}
