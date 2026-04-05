import { useState, useMemo } from 'react';
import Map from './components/Map';
import Sidebar, { type Filters } from './components/Sidebar';
import { useStationsData } from './utils/useStationsData';
import { filterHotels } from './utils/filters';
import './app.css';

export default function App() {
  const loadState = useStationsData();
  const [filters, setFilters] = useState<Filters>({
    brands: [],
    states: [],
    connectorType: '',
    search: '',
    evOnly: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleHotels = useMemo(() => {
    if (loadState.status !== 'ok') return [];
    return filterHotels(loadState.data.hotels, filters);
  }, [loadState, filters]);

  if (loadState.status === 'loading') {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading hotel data…</p>
      </div>
    );
  }

  if (loadState.status === 'error') {
    return (
      <div className="error-screen">
        <div className="error-icon">⚡</div>
        <h2>Data not available</h2>
        <p>{loadState.message}</p>
        <code>npm run fetch-stations</code>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        data={loadState.data}
        filters={filters}
        visibleCount={visibleHotels.length}
        onChange={setFilters}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
      />
      <main className="map-container">
        <Map hotels={visibleHotels} />
      </main>
    </div>
  );
}
