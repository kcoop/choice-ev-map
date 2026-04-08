import type { Hotel } from '../types/station';
import { CHOICE_BRANDS } from '../types/station';

export const ALL_BRANDS = CHOICE_BRANDS.map((b) => b.label).sort();

export interface BrandTier {
  label: string;
  brands: string[];
}

export const BRAND_TIERS: BrandTier[] = [
  {
    label: 'Upper Upscale',
    brands: ['Cambria', 'Radisson Blu', 'Radisson Red', 'Radisson Individuals', 'Ascend Collection', 'Strawberry'],
  },
  {
    label: 'Upscale',
    brands: ['Radisson', 'Country Inn & Suites', 'Park Inn by Radisson', 'Clarion', 'Everhome'],
  },
  {
    label: 'Midscale',
    brands: ['Comfort Inn', 'Comfort Suites', 'Quality Inn', 'Quality Suites', 'Sleep Inn', 'Clarion Pointe'],
  },
  {
    label: 'Extended Stay',
    brands: ['MainStay Suites', 'WoodSpring Suites', 'Suburban Studios', 'Suburban Extended Stay'],
  },
  {
    label: 'Economy',
    brands: ['Econo Lodge', 'Rodeway Inn'],
  },
];

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC',
];

export function formatConnectors(connectors: string[]): string {
  const map: Record<string, string> = {
    J1772: 'J1772',
    TESLA: 'NACS',
    J1772COMBO: 'CCS',
    CHADEMO: 'CHAdeMO',
    NEMA1450: 'NEMA 14-50',
    NEMA515: 'NEMA 5-15',
    NEMA520: 'NEMA 5-20',
  };
  return connectors.map((c) => map[c] ?? c).join(', ');
}

export function formatPorts(hotel: Hotel): string {
  const parts: string[] = [];
  if (hotel.l2Ports > 0) parts.push(`${hotel.l2Ports} L2`);
  if (hotel.dcFastPorts > 0) parts.push(`${hotel.dcFastPorts} DC Fast`);
  return parts.join(' · ') || 'Unknown';
}

export function filterHotels(
  hotels: Hotel[],
  {
    brands,
    states,
    connectorType,
    search,
    evOnly,
  }: {
    brands: string[];
    states: string[];
    connectorType: string;
    search: string;
    evOnly: boolean;
  },
): Hotel[] {
  const q = search.toLowerCase().trim();
  return hotels.filter((h) => {
    if (evOnly && !h.hasEV) return false;
    if (brands.length > 0 && !brands.includes(h.brand)) return false;
    if (states.length > 0 && !states.includes(h.state)) return false;
    if (connectorType && !h.connectors.includes(connectorType)) return false;
    if (q) {
      const hay = `${h.name} ${h.city} ${h.state} ${h.zip} ${h.brand}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function timeSince(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}yr ago`;
}
