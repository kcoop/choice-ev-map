/**
 * fetch-stations.ts
 *
 * Approach:
 *  1. Fetch Choice Hotel locations from OpenStreetMap via Overpass API
 *  2. Fetch ALL active US EV charging stations from the NLR API
 *  3. Match EV stations to hotels by proximity (≤ 100 m, Haversine)
 *  4. Write public/data/stations.json
 *
 * Run:  NLR_API_KEY=your_key npx tsx scripts/fetch-stations.ts
 * API key signup: https://developer.nlr.gov/signup/
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { RawStation, Hotel, HotelsData } from '../src/types/station.ts';
import { detectBrand } from '../src/types/station.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'stations.json');

const API_KEY = process.env.NLR_API_KEY;
if (!API_KEY) {
  console.error('❌  NLR_API_KEY environment variable is not set.');
  console.error('    Get a free key at https://developer.nlr.gov/signup/');
  console.error('    Then run: NLR_API_KEY=your_key npx tsx scripts/fetch-stations.ts');
  process.exit(1);
}

// ── Haversine distance (meters) ───────────────────────────────────────────────
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Overpass API ──────────────────────────────────────────────────────────────
interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function fetchChoiceHotels(): Promise<OverpassElement[]> {
  // Match on either the name tag or brand tag for any Choice Hotels brand.
  // Covers both well-tagged properties (brand=Comfort Inn) and less-tagged ones
  // where only the name contains the brand string.
  const brandPattern = [
    'Cambria', 'Comfort Inn', 'Comfort Suites', 'Quality Inn', 'Quality Suites',
    'Sleep Inn', 'Clarion', 'MainStay Suites', 'WoodSpring', 'Econo Lodge',
    'Rodeway Inn', 'Ascend Collection', 'Suburban Studios', 'Suburban Extended',
    'Radisson', 'Country Inn', 'Park Inn',
  ].join('|');

  const query = `
[out:json][timeout:300];
area["ISO3166-1"="US"][admin_level="2"]->.us;
(
  nwr(area.us)["tourism"~"hotel|motel|guest_house"][name~"${brandPattern}",i];
  nwr(area.us)[brand~"${brandPattern}",i];
);
out center tags;
`.trim();

  console.log('🗺️  Fetching Choice Hotel locations from Overpass API...');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass API error: ${res.status} ${res.statusText}`);
  const json = await res.json() as { elements: OverpassElement[] };
  console.log(`✅  Overpass returned ${json.elements.length} elements`);
  return json.elements;
}

// ── NLR API ───────────────────────────────────────────────────────────────────
async function fetchAllEVStations(): Promise<RawStation[]> {
  // No facility_type filter — we want all EV stations so we can match by
  // proximity rather than relying on NLR's hotel classification.
  const params = new URLSearchParams({
    api_key: API_KEY!,
    fuel_type: 'ELEC',
    status: 'E',
    country: 'US',
    limit: 'all',
  });

  console.log('⚡  Fetching all active US EV stations from NLR API...');
  const res = await fetch(`https://developer.nlr.gov/api/alt-fuel-stations/v1.json?${params}`);
  if (!res.ok) throw new Error(`NLR API error: ${res.status} ${res.statusText}`);
  const json = await res.json() as { fuel_stations: RawStation[]; total_results: number };
  console.log(`✅  NLR returned ${json.total_results} active EV stations`);
  return json.fuel_stations;
}

// ── Spatial index ─────────────────────────────────────────────────────────────
// Bucket EV stations into ~1.1 km grid cells (0.01° × 0.01°).
// For each hotel we check its cell + all 8 neighbors, guaranteeing we find
// everything within 100 m regardless of cell boundary position.
function buildSpatialIndex(stations: RawStation[]): Map<string, RawStation[]> {
  const index = new Map<string, RawStation[]>();
  for (const s of stations) {
    if (!s.latitude || !s.longitude) continue;
    const key = `${Math.floor(s.latitude * 100)},${Math.floor(s.longitude * 100)}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(s);
    else index.set(key, [s]);
  }
  return index;
}

function nearbyStations(
  lat: number,
  lng: number,
  index: Map<string, RawStation[]>,
  radiusMeters: number,
): RawStation[] {
  const gLat = Math.floor(lat * 100);
  const gLng = Math.floor(lng * 100);
  const candidates: RawStation[] = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const bucket = index.get(`${gLat + dLat},${gLng + dLng}`);
      if (bucket) candidates.push(...bucket);
    }
  }
  return candidates.filter(
    (s) => haversineMeters(lat, lng, s.latitude, s.longitude) <= radiusMeters,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const [osmElements, rawEVStations] = await Promise.all([
    fetchChoiceHotels(),
    fetchAllEVStations(),
  ]);

  const evIndex = buildSpatialIndex(rawEVStations);

  // Deduplicate OSM results — the same property can appear as both a node and
  // a way (one tagged, one just the building outline).
  const seen = new Set<string>();
  const hotels: Hotel[] = [];

  for (const el of osmElements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;

    const tags = el.tags ?? {};
    const rawName = tags['name'] ?? tags['brand'] ?? '';
    if (!rawName) continue;

    const brand = detectBrand(tags['brand'] ?? rawName);
    if (!brand) continue;

    const city = tags['addr:city'] ?? '';
    const state = tags['addr:state'] ?? '';

    // Deduplicate by brand + approximate position (0.01° ≈ 1 km)
    const dedupeKey = `${brand}|${Math.round(lat * 100)}|${Math.round(lng * 100)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const nearby = nearbyStations(lat, lng, evIndex, 100);

    const l2Ports = nearby.reduce((sum, s) => sum + (s.ev_level2_evse_num ?? 0), 0);
    const dcFastPorts = nearby.reduce((sum, s) => sum + (s.ev_dc_fast_num ?? 0), 0);
    const connectors = [...new Set(nearby.flatMap((s) => s.ev_connector_types ?? []))];
    const networks = [...new Set(nearby.map((s) => s.ev_network).filter(Boolean) as string[])];
    const pricing = nearby.find((s) => s.ev_pricing)?.ev_pricing ?? null;
    const hours = nearby.find((s) => s.access_days_time)?.access_days_time ?? null;
    const evLastConfirmed =
      nearby
        .map((s) => s.date_last_confirmed)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
    const evUpdatedAt =
      nearby
        .map((s) => s.updated_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    hotels.push({
      osmId: `${el.type}/${el.id}`,
      name: rawName,
      brand,
      address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
      city,
      state,
      zip: tags['addr:postcode'] ?? '',
      lat,
      lng,
      hasEV: nearby.length > 0,
      l2Ports,
      dcFastPorts,
      connectors,
      evNetwork: networks.length > 0 ? networks.join(', ') : null,
      evPricing: pricing,
      evHours: hours,
      evLastConfirmed,
      evUpdatedAt,
    });
  }

  hotels.sort((a, b) =>
    a.state.localeCompare(b.state) || a.city.localeCompare(b.city),
  );

  const evCount = hotels.filter((h) => h.hasEV).length;
  console.log(`\n🏨  ${hotels.length} Choice Hotels found (${evCount} with EV charging)`);

  const output: HotelsData = {
    fetchedAt: new Date().toISOString(),
    totalCount: hotels.length,
    evCount,
    hotels,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`💾  Written to ${OUTPUT_PATH}`);

  console.log('\n📊  Breakdown by brand:');
  const byBrand = hotels.reduce<Record<string, { total: number; ev: number }>>((acc, h) => {
    if (!acc[h.brand]) acc[h.brand] = { total: 0, ev: 0 };
    acc[h.brand].total++;
    if (h.hasEV) acc[h.brand].ev++;
    return acc;
  }, {});
  Object.entries(byBrand)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([brand, { total, ev }]) =>
      console.log(`    ${brand.padEnd(30)} ${total} hotels, ${ev} with EV`),
    );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
