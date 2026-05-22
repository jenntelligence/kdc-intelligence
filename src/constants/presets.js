// Date / preset constants. Extracted from src/ShippingSLAApp.jsx during PR R1.

// PR4b3: 'YYYY-MM-DD' → 'May 4'. Avoids new Date(yyyymmdd) timezone shifts (it would parse as UTC).
export const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const PRESET_LABELS = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  'custom': 'Custom range',
};
