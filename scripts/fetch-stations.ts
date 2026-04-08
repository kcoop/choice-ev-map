/**
 * fetch-stations.ts
 *
 * Approach:
 *  1. Fetch Choice Hotel locations from Overture Maps via DuckDB (S3 Parquet)
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
import { createRequire } from 'module';
import type { RawStation, Hotel, HotelsData } from '../src/types/station.ts';
import { detectBrand } from '../src/types/station.ts';

// duckdb is CommonJS — load via createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const duckdb = require('duckdb') as typeof import('duckdb');

const FETCH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH        = path.join(__dirname, '..', 'public', 'data', 'stations.json');
const GEOCODE_CACHE_PATH = path.join(__dirname, 'geocode-cache.json');
const OVERTURE_CACHE_PATH = path.join(__dirname, 'overture-cache.json');
const EV_CACHE_PATH      = path.join(__dirname, 'ev-cache.json');
const CACHE_MAX_AGE_MS   = 7 * 24 * 60 * 60 * 1000; // 7 days

// Overture releases monthly. The STAC catalog always points to the latest.
// See: https://docs.overturemaps.org/release-calendar/
async function getOvertureRelease(): Promise<string> {
  const res = await fetchWithTimeout('https://stac.overturemaps.org/catalog.json');
  if (!res.ok) throw new Error(`Failed to fetch Overture STAC catalog: ${res.status}`);
  const json = await res.json() as { latest?: string };
  if (!json.latest) throw new Error('No "latest" field in Overture STAC catalog');
  return json.latest;
}

const FORCE_REFRESH = process.argv.includes('--refresh');
if (FORCE_REFRESH) console.log('🔄  --refresh: ignoring all caches');

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Overture Maps via DuckDB ──────────────────────────────────────────────────
// Wikidata Q-IDs split by geographic scope, mirroring the name-match restrictions.
const WIKIDATA_GLOBAL: string[] = [
  'Q113152476', // Cambria Hotels
  'Q113152349', // Comfort Inn
  'Q55525150',  // Comfort Suites
  'Q113152195', // Quality Inn / Quality Suites
  'Q69588194',  // Sleep Inn
  'Q10454567',  // Clarion / Clarion Pointe
  'Q113152432', // MainStay Suites
  'Q30672853',  // WoodSpring Suites
  'Q113152401', // Suburban Studios / Suburban Extended Stay
  'Q5333330',   // Econo Lodge
  'Q7356709',   // Rodeway Inn
  'Q137167679', // Ascend Collection
];

const WIKIDATA_AMERICAS: string[] = [
  'Q1751979',   // Radisson Hotels
  'Q7281341',   // Radisson Blu
  'Q28233721',  // Radisson Red
  'Q60711675',  // Park Inn by Radisson
  'Q5177332',   // Country Inn & Suites
];

const WIKIDATA_NORDIC: string[] = [
  'Q10602024',  // Strawberry / Nordic Choice
];


interface OvertureRow {
  id: string;
  name: string | null;
  brand_wikidata: string | null;
  brand_name: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  website: string | null;
  lat: number;
  lng: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbRun(conn: any, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbAll(conn: any, sql: string): Promise<OvertureRow[]> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn.all(sql, (err: Error | null, rows: any) => {
      if (err) reject(err);
      else resolve(rows as OvertureRow[]);
    });
  });
}

async function fetchChoiceHotels(): Promise<OvertureRow[]> {
  const release = await getOvertureRelease();

  // Check cache — valid if same release and not stale
  try {
    const raw = JSON.parse(fs.readFileSync(OVERTURE_CACHE_PATH, 'utf8')) as {
      release: string; fetchedAt: string; rows: OvertureRow[];
    };
    const ageMs = Date.now() - new Date(raw.fetchedAt).getTime();
    if (!FORCE_REFRESH && raw.release === release && ageMs < CACHE_MAX_AGE_MS) {
      const ageDays = Math.floor(ageMs / 86_400_000);
      console.log(`📦  Using cached Overture data (release ${raw.release}, ${ageDays}d old)`);
      return raw.rows;
    }
  } catch { /* no cache yet */ }

  console.log(`🗺️  Querying Overture Maps release ${release} via DuckDB...`);

  // Use an explicit connection so extension loads persist across all statements
  const db = new duckdb.Database(':memory:');
  const conn = db.connect();

  // Install extensions once globally, then load on this connection
  await dbRun(conn, 'INSTALL httpfs');
  await dbRun(conn, 'LOAD httpfs');
  await dbRun(conn, 'INSTALL spatial');
  await dbRun(conn, 'LOAD spatial');
  await dbRun(conn, "SET s3_region='us-west-2'");

  const globalList  = WIKIDATA_GLOBAL.map((id) => `'${id}'`).join(', ');
  const americasList = WIKIDATA_AMERICAS.map((id) => `'${id}'`).join(', ');
  const nordicList  = WIKIDATA_NORDIC.map((id) => `'${id}'`).join(', ');

  const sql = `
    SELECT
      id,
      names.primary                   AS name,
      brand.wikidata                  AS brand_wikidata,
      brand.names.primary             AS brand_name,
      addresses[1].freeform           AS address,
      addresses[1].locality           AS city,
      addresses[1].region             AS region,
      addresses[1].postcode           AS postcode,
      addresses[1].country            AS country,
      websites[1]                     AS website,
      ST_Y(geometry)                  AS lat,
      ST_X(geometry)                  AS lng
    FROM read_parquet(
      's3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*',
      hive_partitioning = 1
    )
    WHERE (
      -- Wikidata: global Choice brands
      brand.wikidata IN (${globalList})

      -- Wikidata: Radisson brands (Americas only)
      OR (
        brand.wikidata IN (${americasList})
        AND addresses[1].country IN ('US', 'CA', 'MX', 'BR', 'AR', 'CO', 'PA', 'PR', 'VI')
      )

      -- Wikidata: Strawberry / Nordic Choice (Scandinavia & Baltics only)
      OR (
        brand.wikidata IN (${nordicList})
        AND addresses[1].country IN ('NO', 'SE', 'DK', 'FI', 'LT')
      )

      -- Name: global Choice brands
      OR lower(names.primary) LIKE 'cambria%'
      OR lower(names.primary) LIKE 'comfort inn%'
      OR lower(names.primary) LIKE 'comfort suites%'
      OR lower(names.primary) LIKE 'quality inn%'
      OR lower(names.primary) LIKE 'sleep inn%'
      OR lower(names.primary) LIKE 'clarion%'
      OR lower(names.primary) LIKE '%ascend collection%'
      OR lower(names.primary) LIKE '%ascend hotel%'
      OR lower(names.primary) LIKE 'econo lodge%'
      OR lower(names.primary) LIKE 'rodeway inn%'
      OR lower(names.primary) LIKE 'mainstay suites%'
      OR lower(names.primary) LIKE 'suburban studios%'
      OR lower(names.primary) LIKE 'woodspring suites%'
      OR lower(names.primary) LIKE 'everhome%'

      -- Name: Strawberry / Nordic Choice (Scandinavia & Baltics only)
      OR (
        (lower(names.primary) LIKE 'strawberry%' OR lower(names.primary) LIKE 'nordic choice%')
        AND addresses[1].country IN ('NO', 'SE', 'DK', 'FI', 'LT')
      )

      -- Name: Radisson brands (Americas only)
      OR (
        (
          lower(names.primary) LIKE 'radisson%'
          OR lower(names.primary) LIKE 'country inn & suites%'
          OR lower(names.primary) LIKE 'park inn%'
        )
        AND addresses[1].country IN ('US', 'CA', 'MX', 'BR', 'AR', 'CO', 'PA', 'PR', 'VI')
      )

      -- Website: definitive proof of participation
      OR websites[1] LIKE '%choicehotels.com%'
      OR websites[1] LIKE '%strawberryhotels.com%'
      OR websites[1] LIKE '%nordicchoicehotels.com%'
    )
    -- Category guard: exclude non-lodging results (false positives from name/website matching)
    AND categories.primary IN ('hotel', 'motel', 'inn', 'resort', 'extended_stay_hotel')
    -- Exclude international Radisson Hotel Group (non-Americas) properties
    AND (websites[1] IS NULL OR websites[1] NOT LIKE '%radissonhotels.com%')
    AND (websites[1] IS NULL OR websites[1] NOT LIKE '%radissonblu.com%')
  `;

  const rows = await dbAll(conn, sql);
  conn.close();
  db.close();

  console.log(`✅  Overture returned ${rows.length} candidate places`);

  fs.writeFileSync(OVERTURE_CACHE_PATH, JSON.stringify({
    release,
    fetchedAt: new Date().toISOString(),
    rows,
  }));
  console.log(`💾  Overture results cached to ${OVERTURE_CACHE_PATH}`);

  return rows;
}

// ── NLR API ───────────────────────────────────────────────────────────────────
async function fetchAllEVStations(): Promise<RawStation[]> {
  try {
    const raw = JSON.parse(fs.readFileSync(EV_CACHE_PATH, 'utf8')) as {
      fetchedAt: string; stations: RawStation[];
    };
    const ageMs = Date.now() - new Date(raw.fetchedAt).getTime();
    if (!FORCE_REFRESH && ageMs < CACHE_MAX_AGE_MS) {
      const ageDays = Math.floor(ageMs / 86_400_000);
      console.log(`📦  Using cached EV station data (${ageDays}d old — refresh after 7d)`);
      return raw.stations;
    }
    console.log('📦  EV station cache is stale, re-fetching...');
  } catch { /* no cache yet */ }

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
  const res = await fetchWithTimeout(`https://developer.nlr.gov/api/alt-fuel-stations/v1.json?${params}`);
  if (!res.ok) throw new Error(`NLR API error: ${res.status} ${res.statusText}`);
  const json = await res.json() as { fuel_stations: RawStation[]; total_results: number };
  console.log(`✅  NLR returned ${json.total_results} active EV stations`);

  fs.writeFileSync(EV_CACHE_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), stations: json.fuel_stations }));
  console.log(`💾  EV stations cached to ${EV_CACHE_PATH}`);

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

// ── Nominatim reverse geocoding ───────────────────────────────────────────────
const STATE_CODES: Record<string, string> = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
  'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
  'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO',
  'Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ',
  'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH',
  'Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  'District of Columbia':'DC',
};

type GeocodeResult = { address: string; city: string; state: string; zip: string; country: string };
type GeocodeCache = Record<string, GeocodeResult | null>;

function loadGeocodeCache(): GeocodeCache {
  try {
    return JSON.parse(fs.readFileSync(GEOCODE_CACHE_PATH, 'utf8')) as GeocodeCache;
  } catch {
    return {};
  }
}

function saveGeocodeCache(cache: GeocodeCache): void {
  fs.writeFileSync(GEOCODE_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function reverseGeocode(
  lat: number,
  lng: number,
  cache: GeocodeCache,
): Promise<GeocodeResult | null> {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  if (key in cache) {
    const entry = cache[key];
    if (entry !== null && entry.country === undefined) entry.country = 'US';
    return entry;
  }

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'choice-ev-map/1.0 (github.com/choice-ev-map)' },
    });
    if (!res.ok) { cache[key] = null; return null; }
    const json = await res.json() as { address?: Record<string, string> };
    const a = json.address ?? {};
    const houseNum = a['house_number'] ?? '';
    const road = a['road'] ?? a['pedestrian'] ?? a['footway'] ?? '';
    const countryCode = (a['country_code'] ?? '').toUpperCase();
    const rawState = a['state'] ?? '';
    const result: GeocodeResult = {
      address: [houseNum, road].filter(Boolean).join(' '),
      city: a['city'] ?? a['town'] ?? a['village'] ?? a['municipality'] ?? '',
      state: countryCode === 'US' ? (STATE_CODES[rawState] ?? '') : rawState,
      zip: a['postcode'] ?? '',
      country: countryCode,
    };
    cache[key] = result;
    return result;
  } catch {
    cache[key] = null;
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const [overtureRows, rawEVStations] = await Promise.all([
    fetchChoiceHotels(),
    fetchAllEVStations(),
  ]);

  const evIndex = buildSpatialIndex(rawEVStations);

  // Deduplicate by brand + approximate position (0.01° ≈ 1 km) in case
  // Overture returns duplicate entries for the same property.
  const seen = new Set<string>();
  const hotels: Hotel[] = [];

  for (const row of overtureRows) {
    const { lat, lng } = row;
    if (lat == null || lng == null) continue;

    const rawName = row.name ?? row.brand_name ?? '';
    if (!rawName) continue;

    const brand = detectBrand(row.brand_name ?? rawName);
    if (!brand) continue;

    // Overture region may be "US-TX" or "TX" — normalise to abbreviation only
    const rawRegion = row.region ?? '';
    const state = rawRegion.includes('-') ? rawRegion.split('-').pop()! : rawRegion;
    const country = (row.country ?? '').toUpperCase();

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
      nearby.map((s) => s.date_last_confirmed).filter(Boolean).sort().at(-1) ?? null;
    const evUpdatedAt =
      nearby.map((s) => s.updated_at).filter(Boolean).sort().at(-1) ?? null;

    hotels.push({
      osmId: row.id,
      name: rawName,
      brand,
      address: row.address ?? '',
      city: row.city ?? '',
      state,
      zip: row.postcode ?? '',
      country,
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
      website: row.website ?? null,
    });
  }

  // Geocode hotels where OSM didn't supply address data, using Nominatim
  // reverse geocoding (free, no key). Rate-limited to 1 req/sec per their ToS.
  const needsGeocode = hotels.filter((h) => !h.city || !h.state || !h.country);
  if (needsGeocode.length > 0) {
    const cache = loadGeocodeCache();
    const uncached = needsGeocode.filter((h) => {
      const key = `${h.lat.toFixed(6)},${h.lng.toFixed(6)}`;
      return !(key in cache);
    });
    console.log(`\n🌍  Geocoding ${needsGeocode.length} hotels missing city/state` +
      (uncached.length < needsGeocode.length
        ? ` (${needsGeocode.length - uncached.length} cached, ${uncached.length} new)`
        : ` (1 req/sec)...`));
    let done = 0;
    for (const hotel of needsGeocode) {
      const key = `${hotel.lat.toFixed(6)},${hotel.lng.toFixed(6)}`;
      const wasCached = key in cache;
      const result = await reverseGeocode(hotel.lat, hotel.lng, cache);
      if (result) {
        if (!hotel.address) hotel.address = result.address;
        if (!hotel.city)    hotel.city    = result.city;
        if (!hotel.state)   hotel.state   = result.state;
        if (!hotel.zip)     hotel.zip     = result.zip;
        if (!hotel.country) hotel.country = result.country;
      }
      done++;
      process.stdout.write(`\r    ${done}/${needsGeocode.length}`);
      if (!wasCached) await sleep(1100);
    }
    saveGeocodeCache(cache);
    console.log('\n✅  Geocoding complete');
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
