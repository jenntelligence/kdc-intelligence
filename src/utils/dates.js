import { MONTH_ABBR } from '../constants/presets.js';

// PR Geo-Delivered-Mode: UTC-safe business-day addition. CRITICAL: all date
// arithmetic in delivered-mode MUST use the UTC methods because:
//   1. `new Date('YYYY-MM-DD')` (the live so_created_date / delivered_date
//      format) parses as UTC midnight, not local midnight.
//   2. `setHours(0,0,0,0)` zeroes the *local* time — in a non-UTC timezone
//      this shifts the underlying timestamp into the previous day, causing
//      a one-day-off mismatch in getDay()/setDate() comparisons.
// User identified this during code review on the first draft. Always use
// setUTCHours / setUTCDate / getUTCDay here, even when it feels redundant.
export function addBusinessDays(startDate, businessDays) {
  const result = new Date(startDate);
  let added = 0;
  while (added < businessDays) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) added++;  // Sat=6, Sun=0
  }
  return result;
}

export const diffMin = (a, b) => Math.round((b - a) / 60000);

// PR4b2: tolerate Snowflake's mixed string/null timestamp output; Date(null) is epoch which is misleading.
export function toDateOrNull(v) {
  if (v == null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// PR4b3: 'YYYY-MM-DD' → 'May 4'. Avoids new Date(yyyymmdd) timezone shifts (it would parse as UTC).
export function formatShortDate(yyyymmdd) {
  if (!yyyymmdd || typeof yyyymmdd !== 'string') return '';
  const m = yyyymmdd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return yyyymmdd;
  const mon = MONTH_ABBR[parseInt(m[2], 10) - 1] || '?';
  return `${mon} ${parseInt(m[3], 10)}`;
}

/**
 * Format Date as YYYY-MM-DD using LOCAL timezone.
 * toISOString() uses UTC, which can shift the date for users in
 * non-UTC timezones (KDC = US-East). Local format is what users
 * expect when they think of "today".
 */
function formatDateLocal(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convert header preset value to {from, to} YYYY-MM-DD strings.
 * Server endpoint /api/scale/split-shipments expects YYYY-MM-DD
 * (per snowflake-schema.md § Verified facts — Date handling).
 *
 * @param {string} preset - One of '7d', '30d', '90d', 'ytd', 'custom'
 * @param {{from?: string, to?: string}} customRange - Used only when preset === 'custom'
 * @returns {{from: string, to: string}}
 */
export function presetToDateRange(preset, customRange = {}) {
  if (preset === 'custom') {
    return {
      from: customRange.from || formatDateLocal(new Date(Date.now() - 7 * 86400000)),
      to: customRange.to || formatDateLocal(new Date()),
    };
  }

  // PR6: 'ytd' preset — Customer ranking section uses Jan 1 of the current
  // year through today, independent of the page's main dateRange. Gives
  // sufficient sample size for a meaningful top-10 customer list (short
  // windows show statistical noise like "100% (1/1)").
  if (preset === 'ytd') {
    const today = new Date();
    return {
      from: formatDateLocal(new Date(today.getFullYear(), 0, 1)),
      to: formatDateLocal(today),
    };
  }

  const today = new Date();
  const dayOffsetMap = { '7d': 7, '30d': 30, '90d': 90 };
  const days = dayOffsetMap[preset] ?? 7; // default 7d for unknown presets

  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - days);

  return {
    from: formatDateLocal(fromDate),
    to: formatDateLocal(today),
  };
}
