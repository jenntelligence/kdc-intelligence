// Lead-time lookup tables (UPS parcel zones, truck routes, per-state
// delivery days). Extracted from src/ShippingSLAApp.jsx during PR R1.

// UPS Parcel Zone Lead Times (from GA origin)
export const UPS_ZONE_LEAD_TIMES = [
  { zone: 'Zone 2', states: ['GA'], kdcTarget: 1, carrierLT: 1, totalLT: 2 },
  { zone: 'Zone 3', states: ['FL','SC','NC','TN'], kdcTarget: 1, carrierLT: 2, totalLT: 3 },
  { zone: 'Zone 4', states: ['NY','NJ','PA','OH'], kdcTarget: 1, carrierLT: 3, totalLT: 4 },
  { zone: 'Zone 5', states: ['IL','TX','MO'], kdcTarget: 1, carrierLT: 4, totalLT: 5 },
  { zone: 'Zone 6', states: ['CA','CO','AZ'], kdcTarget: 1, carrierLT: 5, totalLT: 6 },
  { zone: 'Zone 7-8', states: ['WA','OR','HI','AK'], kdcTarget: 1, carrierLT: 7, totalLT: 8 },
];

// Truck Route Lead Times (from GA origin) — BD = business days
export const TRUCK_ROUTE_LEAD_TIMES = [
  { route: 'GA Local / Metro', states: ['GA'], kdcTargetBD: 1, truckLTBD: 1, kdcTargetCD: 2, truckLTCD: 2 },
  { route: 'Southeast', states: ['FL','SC','NC','TN','AL'], kdcTargetBD: 1, truckLTBD: '1-2', kdcTargetCD: 2, truckLTCD: '2-3' },
  { route: 'Mid-Atlantic', states: ['VA','MD','DC'], kdcTargetBD: 1, truckLTBD: '2-3', kdcTargetCD: 2, truckLTCD: '3-4' },
  { route: 'Midwest', states: ['OH','IL','IN','MI'], kdcTargetBD: 1, truckLTBD: '2-3', kdcTargetCD: 2, truckLTCD: '3-5' },
  { route: 'South Central', states: ['TX','LA','MS','AR'], kdcTargetBD: 1, truckLTBD: '2-3', kdcTargetCD: 2, truckLTCD: '3-5' },
  { route: 'West Coast', states: ['CA','OR','WA'], kdcTargetBD: 1, truckLTBD: '4-5', kdcTargetCD: 2, truckLTCD: '6-7' },
  { route: 'Other / TBD', states: [], kdcTargetBD: 1, truckLTBD: 'TBD', kdcTargetCD: 2, truckLTCD: 'TBD' },
];

// PR Geo-Delivered-Mode: state-level delivery-lead-time lookup maps.
// Separate from UPS_ZONE_LEAD_TIMES / TRUCK_ROUTE_LEAD_TIMES (which describe
// zone *groups* for the Carrier Lead Time Standards display table) — these
// give one number per state for the delivered-date SLA calculation.
//
// UPS values = "total calendar days from so_created until expected delivery"
// (matches the existing `totalLT` field for known states). Includes Claude's
// regional inferences for states missing from the user-provided image —
// marked with `// ★` so operations can re-confirm.
export const UPS_DELIVERY_DAYS_BY_STATE = {
  // Zone 2 (2 days) — Local
  'GA': 2,

  // Zone 3 (3 days) — Southeast
  'FL': 3, 'SC': 3, 'NC': 3, 'TN': 3,
  'AL': 3,  // ★ Claude inference

  // Zone 4 (4 days) — Mid-Atlantic / Northeast / Great Lakes
  'NY': 4, 'NJ': 4, 'PA': 4, 'OH': 4,
  'MD': 4, 'VA': 4, 'DC': 4, 'DE': 4, 'WV': 4,  // ★ Mid-Atlantic
  'KY': 4,  // ★ Southeast border
  'IN': 4, 'MI': 4,  // ★ Great Lakes
  'CT': 4, 'MA': 4, 'RI': 4, 'NH': 4, 'VT': 4, 'ME': 4,  // ★ Northeast

  // Zone 5 (5 days) — South Central / Midwest / Plains
  'IL': 5, 'TX': 5, 'MO': 5,
  'LA': 5, 'MS': 5, 'AR': 5,  // ★ South Central
  'WI': 5, 'MN': 5, 'IA': 5,  // ★ Midwest
  'NE': 5, 'KS': 5, 'OK': 5,  // ★ Plains

  // Zone 6 (6 days) — Mountain / West
  'CA': 6, 'CO': 6, 'AZ': 6,
  'NM': 6, 'UT': 6, 'NV': 6,  // ★ Mountain West

  // Zone 7-8 (8 days) — Far West
  'WA': 8, 'OR': 8, 'HI': 8, 'AK': 8,
  'ID': 8, 'MT': 8, 'WY': 8, 'ND': 8, 'SD': 8,  // ★ Mountain/Plains far
};

// TRUCK values = "business days the carrier takes from ship_estimated to
// delivered" — i.e. the truck portion only. KDC's 1 CD ship side is handled
// separately in the formula. Uses the high bound of the truckLTBD ranges
// (e.g. '1-2' → 2) per user decision: cautious SLA target.
// Missing states (e.g. 'Other / TBD' in the standards table) intentionally
// excluded so they fall out of the cohort — user-stated "tbd 는 일단 건들지 말기".
export const TRUCK_DELIVERY_BD_BY_STATE = {
  // GA Local: 1 BD
  'GA': 1,
  // Southeast: 1-2 BD (high bound)
  'FL': 2, 'SC': 2, 'NC': 2, 'TN': 2, 'AL': 2,
  // Mid-Atlantic: 2-3 BD (high bound)
  'VA': 3, 'MD': 3, 'DC': 3,
  // Midwest: 2-3 BD (high bound)
  'OH': 3, 'IL': 3, 'IN': 3, 'MI': 3,
  // South Central: 2-3 BD (high bound)
  'TX': 3, 'LA': 3, 'MS': 3, 'AR': 3,
  // West Coast: 4-5 BD (high bound)
  'CA': 5, 'OR': 5, 'WA': 5,
};
