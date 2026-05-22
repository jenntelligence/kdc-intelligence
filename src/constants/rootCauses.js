// Root-cause + legacy cause constants. Extracted from src/ShippingSLAApp.jsx
// during PR R1. ROOT_CAUSE_* are the new SQL-driven split categories
// (Phase B); CAUSE_* are the legacy classification used by mock-data and
// donut/bar charts (UPS / DC / Missing / Damage / Other).

// PR5b/PR5c: Phase B root-cause categories — SQL category → friendly label.
// Convention (PR5c user decision): SQL name Title Case, 1:1 mapping with
// SQL category names. Lets a developer grep the same identifier across
// SQL / adapter / UI / docs without any name-translation gap.
// All 5 categories are KDC-owned; UPS_TRAILER_SPLIT is named after the
// symptom (different tracking_nums same manifest-close day) but represents
// KDC's outbound trailer-loading decision. See plan §Phase B for the
// CASE WHEN priority and 3-window smoke-test findings.
export const ROOT_CAUSE_LABELS = {
  'MANIFEST_LEVEL_SPLIT': 'Manifest Level Split',
  'UPS_TRAILER_SPLIT':    'UPS Trailer Split',
  'ZONE_LEVEL_SPLIT':     'Zone Level Split',
  'WAVE_LEVEL_SPLIT':     'Wave Level Split',
  'UNCLASSIFIED_SPLIT':   'Unclassified Split',
};

// Stable display order — keeps empty-state rendering consistent across
// short and long windows (sorted by count desc at render time).
export const ROOT_CAUSE_ORDER = [
  'MANIFEST_LEVEL_SPLIT',
  'UPS_TRAILER_SPLIT',
  'ZONE_LEVEL_SPLIT',
  'WAVE_LEVEL_SPLIT',
  'UNCLASSIFIED_SPLIT',
];

export const CAUSE_COLORS = {
  'UPS': '#E74C6F',      // Hark Cerise
  'DC': '#3498DB',       // Hark Turquoise +10 (sky blue)
  'Missing': '#8E44AD',  // Hark Persian Blue +15 (purple)
  'Damage': '#1ABC9C',   // Hark Turquoise
  'Other': '#7F8C8D',    // Hark Blue -15 (muted gray)
};

export const CAUSE_GRADIENTS = {
  'UPS': 'url(#gradCerise)',
  'DC': 'url(#gradSkyBlue)',
  'Missing': 'url(#gradPurple)',
  'Damage': 'url(#gradTurquoise)',
  'Other': 'url(#gradGray)',
};

export const CAUSE_LABELS = {
  'UPS': 'UPS Carrier',
  'DC': 'DC Processing',
  'Missing': 'Missing Product',
  'Damage': 'Damage/Problematic',
  'Other': 'Other',
};
