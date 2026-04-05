import type { HotelsData } from '../types/station';
import { BRAND_TIERS, US_STATES } from '../utils/filters';

const CONNECTOR_OPTIONS = [
  { value: '', label: 'All connectors' },
  { value: 'J1772', label: 'J1772 (Level 2)' },
  { value: 'TESLA', label: 'NACS / Tesla' },
  { value: 'J1772COMBO', label: 'CCS (DC Fast)' },
  { value: 'CHADEMO', label: 'CHAdeMO' },
  { value: 'NEMA1450', label: 'NEMA 14-50' },
];

export interface Filters {
  brands: string[];
  states: string[];
  connectorType: string;
  search: string;
  evOnly: boolean;
}

interface SidebarProps {
  data: HotelsData;
  filters: Filters;
  visibleCount: number;
  onChange: (f: Filters) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function Sidebar({
  data,
  filters,
  visibleCount,
  onChange,
  isOpen,
  onToggle,
}: SidebarProps) {
  const brandCounts = data.hotels.reduce<Record<string, number>>((acc, h) => {
    acc[h.brand] = (acc[h.brand] ?? 0) + 1;
    return acc;
  }, {});

  function toggleBrand(brand: string) {
    const next = filters.brands.includes(brand)
      ? filters.brands.filter((b) => b !== brand)
      : [...filters.brands, brand];
    onChange({ ...filters, brands: next });
  }

  function toggleState(state: string) {
    const next = filters.states.includes(state)
      ? filters.states.filter((s) => s !== state)
      : [...filters.states, state];
    onChange({ ...filters, states: next });
  }

  function reset() {
    onChange({ brands: [], states: [], connectorType: '', search: '', evOnly: false });
  }

  const hasFilters =
    filters.brands.length > 0 ||
    filters.states.length > 0 ||
    filters.connectorType !== '' ||
    filters.search !== '' ||
    filters.evOnly;

  const fetchedDate = new Date(data.fetchedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <>
      {/* Mobile toggle button */}
      <button className="sidebar-toggle" onClick={onToggle} aria-label="Toggle filters">
        {isOpen ? '✕' : '⚙ Filters'}
      </button>

      <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span className="sidebar-logo-ev">EV</span>
            <span className="sidebar-logo-text">Choice Map</span>
          </div>
          <p className="sidebar-subtitle">
            Choice Hotels with EV charging across the US
          </p>
        </div>

        <div className="sidebar-stats">
          <div className="stat">
            <span className="stat-num">{visibleCount}</span>
            <span className="stat-label">shown</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-num">{data.evCount}</span>
            <span className="stat-label">with EV</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-num">{data.totalCount}</span>
            <span className="stat-label">total</span>
          </div>
        </div>

        <div className="sidebar-search">
          <input
            type="search"
            placeholder="Search by name, city, state…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
          />
        </div>

        <div className="sidebar-section">
          <label className="ev-toggle-row">
            <span className="ev-toggle-label">EV charging only</span>
            <button
              className={`ev-toggle-btn ${filters.evOnly ? 'ev-toggle-btn--on' : ''}`}
              onClick={() => onChange({ ...filters, evOnly: !filters.evOnly })}
              aria-pressed={filters.evOnly}
            >
              <span className="ev-toggle-knob" />
            </button>
          </label>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Connector Type</div>
          <select
            value={filters.connectorType}
            onChange={(e) => onChange({ ...filters, connectorType: e.target.value })}
          >
            {CONNECTOR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">
            Brand
            {filters.brands.length > 0 && (
              <button className="clear-btn" onClick={() => onChange({ ...filters, brands: [] })}>
                clear
              </button>
            )}
          </div>
          {BRAND_TIERS.map((tier) => {
            const activeBrands = tier.brands.filter((b) => filters.brands.includes(b));
            const allActive = activeBrands.length === tier.brands.length;
            const someActive = activeBrands.length > 0 && !allActive;
            function toggleTier() {
              const without = filters.brands.filter((b) => !tier.brands.includes(b));
              onChange({ ...filters, brands: allActive ? without : [...without, ...tier.brands] });
            }
            const tierTotal = tier.brands.reduce((sum, b) => sum + (brandCounts[b] ?? 0), 0);
            return (
              <div key={tier.label} className="brand-tier">
                <button
                  className={`tier-btn ${allActive ? 'tier-btn--active' : someActive ? 'tier-btn--partial' : ''}`}
                  onClick={toggleTier}
                >
                  {tier.label}
                  <span className="tier-btn-count">{tierTotal}</span>
                </button>
                <div className="chip-list">
                  {tier.brands.map((brand) => (
                    <button
                      key={brand}
                      className={`chip ${filters.brands.includes(brand) ? 'chip--active' : ''}`}
                      onClick={() => toggleBrand(brand)}
                    >
                      {brand}
                      {brandCounts[brand] != null && (
                        <span className="chip-count">{brandCounts[brand]}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">
            State
            {filters.states.length > 0 && (
              <button className="clear-btn" onClick={() => onChange({ ...filters, states: [] })}>
                clear
              </button>
            )}
          </div>
          <div className="state-grid">
            {US_STATES.map((st) => (
              <button
                key={st}
                className={`state-btn ${filters.states.includes(st) ? 'state-btn--active' : ''}`}
                onClick={() => toggleState(st)}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {hasFilters && (
          <div className="sidebar-footer">
            <button className="reset-btn" onClick={reset}>
              ↺ Reset all filters
            </button>
          </div>
        )}

        <div className="sidebar-attribution">
          Hotels: <a href="https://www.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a>
          {' · '}
          EV data: <a href="https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/all/" target="_blank" rel="noopener">NLR API</a>
          {' · '}
          {fetchedDate}
        </div>
      </aside>
    </>
  );
}
