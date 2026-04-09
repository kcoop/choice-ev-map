# Choice Hotels EV Map ⚡

An offline-capable React/TypeScript map of Choice Hotels worldwide with EV charging, hosted on GitHub Pages. Hotel locations are sourced from **Overture Maps** (open map data) and matched to EV stations from the **NLR Alternative Fuel Stations API** (a free US government API). Data is refreshed nightly and committed as a static JSON file.

![Screenshot](docs/screenshot.png)

## Features

- 🗺️ **Leaflet map** with marker clustering — no Google Maps API key needed
- ⚡ **Level 2 charger focus** — suitable for overnight charging
- 🏨 **All Choice Hotels brands** — Comfort, Quality, Cambria, Radisson, Econo Lodge, and more
- 🔍 **Filter by brand, state, connector type, and free-text search**
- 📦 **100% static** — no backend, works offline once loaded
- 🔄 **Nightly GitHub Actions** refresh with automatic redeploy
- 🌍 **Global hotel coverage** via Overture Maps; EV data covers US stations

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/choice-ev-map.git
cd choice-ev-map
npm install
```

### 2. Get a free NLR API key

Sign up at **https://developer.nlr.gov/signup/** — it's free and instant.

### 3. Install DuckDB

The fetch script uses [DuckDB](https://duckdb.org/) to query Overture Maps data directly from S3 Parquet files. It's already listed as a dev dependency and installed with `npm install`.

### 4. Fetch station data

```bash
NLR_API_KEY=your_key_here npm run fetch-stations
```

This writes `public/data/stations.json`. The first run downloads Overture Maps data via DuckDB (may take a few minutes); subsequent runs use a local cache.

### 5. Run locally

```bash
npm run dev
```

Open http://localhost:5173

---

## Deploy to GitHub Pages

### 1. Create a GitHub repository

Push this project to a new repo named `choice-ev-map` (or update `VITE_BASE_PATH` in `vite.config.ts` and the workflow to match your repo name).

### 2. Add your API key as a GitHub Secret

Go to **Settings → Secrets and variables → Actions → New repository secret**:

- Name: `NLR_API_KEY`
- Value: your key from developer.nlr.gov

No Overture Maps key is needed — the data is publicly accessible via S3.

### 3. Enable GitHub Pages

Go to **Settings → Pages**:
- Source: **GitHub Actions**

### 4. Push to main

The workflow in `.github/workflows/update-and-deploy.yml` will:
1. Query Overture Maps via DuckDB to get all Choice Hotels worldwide
2. Fetch all active US EV stations from the NLR API
3. Match hotels to nearby EV stations by GPS proximity (≤ 100 m)
4. Commit any changes to `public/data/stations.json`
5. Build the React app
6. Deploy to GitHub Pages

Your app will be live at: `https://YOUR_USERNAME.github.io/choice-ev-map/`

---

## How It Works

### Data pipeline

```
Overture Maps (open map data, S3 Parquet)
  └── DuckDB query: Choice Hotels by Wikidata brand ID + name patterns
        └── ~N,000 hotel locations worldwide
              │
              ▼
NLR API (free, US government)
  └── all active US EV stations (fuel_type=ELEC, status=E, country=US)
        │
        ▼
Proximity match (Haversine ≤ 100 m, spatial grid index)
  └── public/data/stations.json   ← committed to repo
        └── served as static file by GitHub Pages
```

### Hotel matching

Hotels are identified via Overture Maps using two complementary strategies:
- **Wikidata brand IDs** — precise matches for major brands (Comfort Inn, Quality Inn, Radisson, etc.)
- **Name patterns** — `LIKE 'comfort inn%'` etc. as a fallback for properties not yet linked in Wikidata

Some brands (Radisson) are scoped geographically to avoid matching the separate international Radisson Hotel Group entity. The category filter (`hotel`, `motel`, `inn`, etc.) removes false positives from name matching.

### EV station matching

EV stations are fetched without a facility-type filter — all active US stations are downloaded and matched to hotels by GPS proximity (≤ 100 m Haversine). This is more reliable than NLR's free-text `station_name` field.

### Updating the brand list

Edit `src/types/station.ts` → `CHOICE_BRANDS` to add or remove brands for the app's filter UI. To add new hotel queries, update the Wikidata IDs and name patterns in `scripts/fetch-stations.ts`.

---

## Project Structure

```
choice-ev-map/
├── .github/
│   └── workflows/
│       └── update-and-deploy.yml   ← nightly cron + deploy
├── scripts/
│   └── fetch-stations.ts           ← NLR API fetcher
├── public/
│   └── data/
│       └── stations.json           ← generated, committed
├── src/
│   ├── components/
│   │   ├── Map.tsx                 ← Leaflet map + markers
│   │   └── Sidebar.tsx             ← filter panel
│   ├── types/
│   │   └── station.ts              ← shared types + brand list
│   ├── utils/
│   │   ├── filters.ts              ← filter helpers
│   │   └── useStationsData.ts      ← data loading hook
│   ├── App.tsx
│   ├── app.css
│   └── main.tsx
├── index.html
├── vite.config.ts
└── tsconfig.json
```

---

## Customisation

| What | Where |
|---|---|
| Add/remove brands in UI filter | `src/types/station.ts` → `CHOICE_BRANDS` |
| Add hotel brands to pipeline | `scripts/fetch-stations.ts` → Wikidata IDs + name patterns |
| Change map tile style | `src/components/Map.tsx` → `L.tileLayer(...)` |
| Adjust fetch schedule | `.github/workflows/update-and-deploy.yml` → `cron` |
| Change repo/base path | `vite.config.ts` → `base` and workflow `VITE_BASE_PATH` |
| Expand EV match radius | `scripts/fetch-stations.ts` → `nearbyStations(..., 100)` |

---

## Data Sources

**Hotel locations** come from **[Overture Maps](https://overturemaps.org/)**, an open map dataset produced by a Linux Foundation consortium (Amazon, Microsoft, Meta, TomTom, and others). The `places` theme is updated monthly and includes Wikidata brand linkage. The script queries it directly from S3 Parquet via DuckDB — no account or API key required.

**EV station data** comes from the **[NLR Alternative Fuel Stations API](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/all/)**, which powers the [US Department of Energy's AFDC Station Locator](https://afdc.energy.gov/stations/). It is a free, public API with no usage cost and a limit of 1,000 requests/hour. This app makes a single request per nightly run, covering US stations only.

**Coverage is not complete.** Some Choice Hotels properties may be missing or incorrectly attributed due to:
- Hotels not yet in Overture Maps, or lacking a Wikidata brand link and an unrecognised name
- Independently branded or recently rebranded properties that don't match known patterns
- EV stations more than 100 m from the hotel's mapped coordinates

Conversely, a small number of non-Choice properties may appear if their name matches a brand pattern (e.g. an unaffiliated "Quality Inn"). Always verify with the hotel directly before relying on this data for trip planning.
