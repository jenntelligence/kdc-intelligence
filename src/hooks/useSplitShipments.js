import { useState, useEffect } from 'react';
import { generateMockShipments } from '../data/mockShipments.js';
import { presetToDateRange } from '../utils/dates.js';
import { countBy, serverRowsToShipments } from '../utils/serverRows.js';

/**
 * useSplitShipments — fetch split-shipment data with mock fallback.
 *
 * PR4b1 upgrade:
 *  - Accepts dateRange + customRange args (was: no args)
 *  - Calls /api/scale/split-shipments?from=&to= (was: no params)
 *  - Adapts server response via serverRowsToShipments (was: assumed shape match)
 *  - Re-fetches when dateRange or customRange changes
 *
 * Output shape matches generateMockShipments() — array of orders with
 * containers[]. Per core-beliefs.md §6, this is the contract: caller
 * components don't need to know if data is mock or live.
 *
 * NOT YET WIRED to SplitShipmentPage — PR4b2 wires it.
 *
 * @param {string} dateRange - '7d' / '30d' / '90d' / 'custom'
 * @param {{from?: string, to?: string}} customRange - YYYY-MM-DD pair
 * @returns {{
 *   data: Array | null,
 *   error: Error | null,
 *   loading: boolean,
 *   source: 'mock' | 'live' | 'mock-fallback' | null,
 *   filter: {from: string, to: string} | null
 * }}
 */
export function useSplitShipments(dateRange = '7d', customRange = {}) {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: true,
    source: null,
    filter: null,
  });

  // Stable JSON of customRange so useEffect dep array reacts only to value changes
  const customKey = JSON.stringify(customRange);

  useEffect(() => {
    const sourceMode = import.meta.env.VITE_DATA_SOURCE || 'mock';

    if (sourceMode === 'mock' || sourceMode === 'csv') {
      if (sourceMode === 'csv') {
        console.warn('[useSplitShipments] csv mode not implemented; falling back to mock');
      }
      setState({
        data: generateMockShipments(),
        error: null,
        loading: false,
        source: 'mock',
        filter: null,
      });
      return;
    }

    // sourceMode === 'live' — fetch with date params
    const { from, to } = presetToDateRange(dateRange, JSON.parse(customKey));
    const url = `http://localhost:3001/api/scale/split-shipments?from=${from}&to=${to}`;

    setState((s) => ({ ...s, loading: true }));

    let cancelled = false;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || 'Server reported failure');

        const shipments = serverRowsToShipments(json.data);
        // eslint-disable-next-line no-console
        console.log('[useSplitShipments] Live data loaded:', {
          rows: json.count,
          uniqueDOs: shipments.length,
          filter: json.filter,
          channelDistribution: countBy(shipments, 'channel'),
          splitStatusDistribution: countBy(shipments, 'split_status'),
        });

        setState({
          data: shipments,
          error: null,
          loading: false,
          source: 'live',
          filter: json.filter,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // Per core-beliefs §6: mock fallback, never blank the page
        console.warn('[useSplitShipments] Live fetch failed, falling back to mock:', err);
        setState({
          data: generateMockShipments(),
          error: err,
          loading: false,
          source: 'mock-fallback',
          filter: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange, customKey]);

  return state;
}
