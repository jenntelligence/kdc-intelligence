import {
  UPS_DELIVERY_DAYS_BY_STATE,
  TRUCK_DELIVERY_BD_BY_STATE,
  UPS_ZONE_LEAD_TIMES,
  TRUCK_ROUTE_LEAD_TIMES,
} from '../constants/leadTimes.js';
import { addBusinessDays } from './dates.js';

// PR Geo-Delivered-Mode: per-state delivery lead-time lookup. Returns the
// number of days/BD to add (semantics depend on carrier — see comments at the
// maps above) or null if the state isn't defined (→ row falls out of the
// delivered-mode cohort).
export function getDeliveryLeadDays(state, carrier) {
  if (carrier === 'UPS')   return UPS_DELIVERY_DAYS_BY_STATE[state] ?? null;
  if (carrier === 'TRUCK') return TRUCK_DELIVERY_BD_BY_STATE[state] ?? null;
  return null;
}

// PR Overview-A backorder-prep: expected delivery date for a row, derived
// from carrier rules. Centralizes the math that was previously inlined in
// isDeliveredDelayed (below) and the Overview Detail Table's computeDaysLate
// (line ~1219). All three call sites (delayed-mode delivered classification,
// days-late display, and future backorder cohort) need the same UTC-midnight-
// aligned expected date:
//
//   UPS (calendar days):
//     delivered_expected = so_created + leadTime CD
//   TRUCK (sequential, mixed CD/BD):
//     ship_estimated     = so_created + 1 CD  (KDC outbound)
//     delivered_expected = addBusinessDays(ship_estimated, leadTime BD)
//
// Returns null when the row can't be classified — missing so_created_date,
// missing carrier, state without a defined lead time, or invalid carrier.
export function getExpectedDeliveryDate(row) {
  if (!row) return null;
  const orderRaw = row.so_created_date || row.orderCreate;
  if (!orderRaw) return null;
  const leadTime = getDeliveryLeadDays(row.state, row.carrier);
  if (leadTime === null) return null;
  const soCreated = new Date(orderRaw);
  soCreated.setUTCHours(0, 0, 0, 0);
  if (Number.isNaN(soCreated.getTime())) return null;
  if (row.carrier === 'UPS') {
    const expected = new Date(soCreated);
    expected.setUTCDate(expected.getUTCDate() + leadTime);
    return expected;
  }
  if (row.carrier === 'TRUCK') {
    const shipEstimated = new Date(soCreated);
    shipEstimated.setUTCDate(shipEstimated.getUTCDate() + 1);  // KDC 1 CD
    return addBusinessDays(shipEstimated, leadTime);
  }
  return null;
}

// PR Geo-Delivered-Mode: per-row "did this delivery beat its lead time?"
// Returns true when delivered_date is strictly past delivered_expected
// (day-grain, both sides UTC-midnight-aligned). Expected-date math lives in
// getExpectedDeliveryDate (above, PR Overview-A backorder-prep refactor).
//
// Returns false (i.e. "not delayed / not in scope") for rows missing the
// needed fields or for states without a defined lead time.
export function isDeliveredDelayed(row) {
  if (!row || !row.delivered_date) return false;
  const deliveredExpected = getExpectedDeliveryDate(row);
  if (!deliveredExpected) return false;
  const delivered = new Date(row.delivered_date);
  delivered.setUTCHours(0, 0, 0, 0);
  if (Number.isNaN(delivered.getTime())) return false;
  return delivered > deliveredExpected;
}

// Helper: find lead time for a state
export const getLeadTimeForState = (state, carrierType) => {
  if (carrierType === 'UPS') {
    const zone = UPS_ZONE_LEAD_TIMES.find(z => z.states.includes(state));
    return zone ? { zone: zone.zone, kdcTarget: zone.kdcTarget, carrierLT: zone.carrierLT, totalLT: zone.totalLT } : { zone: 'Unknown', kdcTarget: 1, carrierLT: '?', totalLT: '?' };
  }
  const route = TRUCK_ROUTE_LEAD_TIMES.find(r => r.states.includes(state));
  return route ? { zone: route.route, kdcTarget: route.kdcTargetBD, carrierLT: route.truckLTBD, totalLT: route.truckLTCD } : { zone: 'Other / TBD', kdcTarget: 1, carrierLT: 'TBD', totalLT: 'TBD' };
};
