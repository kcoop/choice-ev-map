import { useState, useEffect } from 'react';
import type { HotelsData } from '../types/station';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: HotelsData };

export function useStationsData(): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const base = import.meta.env.BASE_URL ?? '/';
    const url = `${base}data/stations.json`.replace('//', '/');
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<HotelsData>;
      })
      .then((data) => setState({ status: 'ok', data }))
      .catch((err: Error) =>
        setState({
          status: 'error',
          message: `Could not load data: ${err.message}. Run "npm run fetch-stations" first.`,
        })
      );
  }, []);

  return state;
}
