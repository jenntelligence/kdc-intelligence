import { useState, useEffect } from 'react';

/**
 * useInboundOps — fetch live Inbound Ops (ASN) data for the Inbound Ops page.
 *
 * Mirrors the useSplitShipments fetch pattern (live API, graceful failure) but
 * has NO mock fallback — the ASN dashboard is live-only (Smartsheet shipment
 * master + SAP receiving in Snowflake). On failure the page renders an explicit
 * "data unavailable" state rather than silently showing stale/mock numbers.
 *
 * Endpoints (server.js § Inbound Ops):
 *   /api/inbound/shipments         In-Transit shipment master (+kdcEtaAdjusted)
 *   /api/inbound/receiving-summary ASN-grain receiving + ETA + urgency
 *   /api/inbound/receiving-detail  SKU-grain receiving + ETA + ActCov
 *
 * Section ② (In-Transit) and ③ (Calendar) will extend this with
 * /api/inbound/vessel-portcalls and /api/inbound/calendar-feed.
 *
 * @returns {{ shipments: Array, receiving: Array, detail: Array,
 *             loading: boolean, error: Error | null }}
 */
const API_BASE = 'http://localhost:3001';

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || `Request failed: ${path}`);
  return json.data;
}

export function useInboundOps() {
  const [state, setState] = useState({
    shipments: [],
    receiving: [],
    detail: [],
    vessels: [],
    calendar: { asnList: [], dayTotals: {} },
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    Promise.all([
      getJSON('/api/inbound/shipments'),
      getJSON('/api/inbound/receiving-summary'),
      getJSON('/api/inbound/receiving-detail'),
      getJSON('/api/inbound/vessel-portcalls'),
      getJSON('/api/inbound/calendar-feed'),
    ])
      .then(([shipments, receiving, detail, vessels, calendar]) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.log('[useInboundOps] live data loaded:', {
          shipments: shipments.length,
          receiving: receiving.length,
          detail: detail.length,
          vessels: vessels.length,
          calendarAsns: calendar?.asnList?.length ?? 0,
        });
        setState({
          shipments, receiving, detail, vessels,
          calendar: calendar || { asnList: [], dayTotals: {} },
          loading: false, error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useInboundOps] fetch failed:', err);
        setState({ shipments: [], receiving: [], detail: [], vessels: [], calendar: { asnList: [], dayTotals: {} }, loading: false, error: err });
      });

    return () => { cancelled = true; };
  }, []);

  return state;
}

// Urgency tier ordering + colors, shared by the Inbound Ops page.
// Severity ramp: red (most urgent) → green (least). Mirrors PBIP urgency sort.
export const URGENCY_ORDER = {
  'Super Urgent': 1, 'Urgent': 2, 'Expedite': 3, 'High': 4, 'Medium': 5, 'Low': 6,
};
export const URGENCY_COLOR = {
  'Super Urgent': '#E74C6F', 'Urgent': '#f5a623', 'Expedite': '#E66C37',
  'High': '#D9B300', 'Medium': '#3498DB', 'Low': '#2ECC71',
};
export const URGENCY_TIERS = ['Super Urgent', 'Urgent', 'Expedite', 'High', 'Medium', 'Low'];

// Local YYYY-MM-DD for a Date (matches the kdcEtaAdjusted string format the
// API returns). Uses local-time getters (NOT setHours on a parsed YMD) per the
// repo timezone rule.
export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
