# Choice Hotels EV Map ⚡

An offline-capable React/TypeScript map of US Choice Hotels with Level 2 EV charging, hosted on GitHub Pages. Station data is fetched nightly from the **NLR Alternative Fuel Stations API** (a free US government API) and committed as a static JSON file.

![Screenshot](docs/screenshot.png)

## Features

- 🗺️ **Leaflet map** with marker clustering — no Google Maps API key needed
- ⚡ **Level 2 charger focus** — suitable for overnight charging
- 🏨 **All Choice Hotels brands** — Comfort, Quality, Cambria, Radisson, Econo Lodge, and more
- 🔍 **Filter by brand, state, connector type, and free-text search**
- 📦 **100% static** — no backend, works offline once loaded
- 🔄 **Nightly GitHub Actions** refresh with automatic redeploy

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

### 3. Fetch station data

```bash
NLR_API_KEY=your_key_here npm run fetch-stations
```

This writes `public/data/stations.json`.

### 4. Run locally

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

### 3. Enable GitHub Pages

Go to **Settings → Pages**:
- Source: **GitHub Actions**

### 4. Push to main

The workflow in `.github/workflows/update-and-deploy.yml` will:
1. Fetch fresh station data from the NLR API
2. Commit any changes to `public/data/stations.json`
3. Build the React app
4. Deploy to GitHub Pages

Your app will be live at: `https://YOUR_USERNAME.github.io/choice-ev-map/`

---

## How It Works

### Data pipeline

```
NLR API (free, government)
  └── fuel_type=ELEC, facility_type=HOTEL,INN, ev_charging_level=2, country=US
        └── filter by Choice Hotels brand name keywords
              └── public/data/stations.json   ← committed to repo
                    └── served as static file by GitHub Pages
```

### Filtering logic

The `scripts/fetch-stations.ts` script matches station names against ~20 Choice Hotels brand keywords. Because the NLR API's `station_name` field is free-text entered by the station owner, some stations may be missed (e.g. unusual capitalisation) and a small number of non-Choice stations may be included (e.g. a "Quality Inn Suites" that's not actually a Choice property). The match rate is generally good.

### Updating the brand list

Edit `src/types/station.ts` → `CHOICE_BRANDS` to add or remove keywords.

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
| Add/remove Choice brands | `src/types/station.ts` → `CHOICE_BRANDS` |
| Change map tile style | `src/components/Map.tsx` → `L.tileLayer(...)` |
| Adjust fetch schedule | `.github/workflows/update-and-deploy.yml` → `cron` |
| Change repo/base path | `vite.config.ts` → `base` and workflow `VITE_BASE_PATH` |
| Add DC Fast chargers | `scripts/fetch-stations.ts` → remove `ev_charging_level=2` |

---

## Data Source

Station data comes from the **[NLR Alternative Fuel Stations API](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/all/)**, which powers the [US Department of Energy's AFDC Station Locator](https://afdc.energy.gov/stations/). It is a free, public API with no usage cost and a limit of 1,000 requests/hour. This app makes a single request per nightly run.

Data accuracy depends on hotel operators keeping their listings updated. Always call ahead to confirm charger availability before a long trip.
