/**
 * Adapt server response from /api/scale/split-shipments (PR3+PR4a)
 * to the mock-shape used by SplitShipmentPage.
 *
 * Server response: flat per-container rows with do_num, container_id,
 *   tracking_num, is_split_shipment, split_status, channel, channel_code,
 *   delivered_date, manifest_id, etc.
 *
 * Mock shape: nested orders with containers[] array, plus mock-only
 *   fields (splitGapDays, chargeback, tier) which we synthesize as null
 *   for PR4b2 N/A handling.
 *
 * Group rows by do_num, build containers[], copy per-DO fields from
 * the first row of each group.
 *
 * @param {Array} rows - Server response data array (toFactShape rows)
 * @returns {Array} Mock-shaped shipments
 */
export function serverRowsToShipments(rows) {
  if (!Array.isArray(rows)) return [];

  const byDoNum = new Map();
  for (const row of rows) {
    if (!row.do_num) continue;
    if (!byDoNum.has(row.do_num)) {
      byDoNum.set(row.do_num, { do: row, containers: [] });
    }
    byDoNum.get(row.do_num).containers.push(row);
  }

  return Array.from(byDoNum.values()).map(({ do: doRow, containers }) => {
    // PR7a: SPLIT GAP — max(delivered_date) - min(delivered_date) across
    // distinct tracking_nums. delivered_date is per-tracking_num (LEFT JOIN
    // ups_data on tracking_num) so a tracking appearing multiple times due
    // to billing fan-out has a stable delivered value — pick once per
    // tracking_num. Returns null if any tracking is still PENDING delivery
    // or if there are no tracking_nums yet; the UI renders '—' for null.
    const trackingDelivered = new Map();
    for (const c of containers) {
      if (!c.tracking_num) continue; // null tracking = container not yet shipped
      if (!trackingDelivered.has(c.tracking_num)) {
        trackingDelivered.set(c.tracking_num, c.delivered_date || null);
      }
    }
    let splitGapDays = null;
    if (trackingDelivered.size > 0) {
      const dates = Array.from(trackingDelivered.values());
      if (dates.every(d => d != null)) {
        const times = dates
          .map(d => new Date(d).getTime())
          .filter(t => Number.isFinite(t));
        if (times.length === dates.length) {
          splitGapDays = Math.round((Math.max(...times) - Math.min(...times)) / 86400000);
        }
      }
    }

    // PR7a: VALUE — sum invoice_amount per distinct billing_date.
    // Billing joins SO-level (not container-level) so the same billing_date
    // carries the same NET($) across every container row that fans out
    // from it — take it once per billing_date and sum. Billing is LEFT
    // JOIN (PR5a), so DOs without any billing record produce no entries
    // and orderValue stays null (UI renders '—').
    const billingByDate = new Map();
    for (const c of containers) {
      if (c.billing_date && c.invoice_amount != null) {
        billingByDate.set(c.billing_date, Number(c.invoice_amount));
      }
    }
    let orderValue = null;
    if (billingByDate.size > 0) {
      orderValue = Array.from(billingByDate.values())
        .reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
    }

    // PR7b: mode of delivered-day across this DO's distinct tracking_nums.
    // Used to classify each container as OK (matches mode) / SPLIT_DAY
    // (differs from mode) / PENDING (no delivery scan yet). Tie-breaker
    // when multiple days share the highest count: earliest day wins,
    // i.e. the first delivered cohort is treated as the "expected" cohort
    // and later ones are flagged as the split.
    let modeDeliveredDay = null;
    if (trackingDelivered.size > 0) {
      const dayCounts = new Map();
      for (const date of trackingDelivered.values()) {
        if (!date) continue;
        const day = new Date(date).toDateString(); // local-day precision; timezone-stable
        if (Number.isNaN(new Date(date).getTime())) continue;
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
      }
      if (dayCounts.size > 0) {
        const sorted = Array.from(dayCounts.entries()).sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];               // count desc
          return new Date(a[0]).getTime() - new Date(b[0]).getTime(); // date asc (tie-breaker)
        });
        modeDeliveredDay = sorted[0][0];
      }
    }

    // PR7b: dedupe containers by container_id (billing fan-out duplicates
    // rows when an SO has multiple billing_dates — per-container fields
    // like tracking_num, container_status, and delivered_date are stable
    // across the fan-out, so we keep the first row and discard the rest).
    // Each surviving container also gets a deliveryStatus field derived
    // from modeDeliveredDay above.
    const distinctContainers = [];
    const seenContainerIds = new Set();
    for (const c of containers) {
      if (!c.container_id || seenContainerIds.has(c.container_id)) continue;
      seenContainerIds.add(c.container_id);

      let deliveryStatus = 'PENDING'; // delivered_date null = UPS scan not received
      if (c.delivered_date) {
        const day = new Date(c.delivered_date).toDateString();
        deliveryStatus = (modeDeliveredDay && day === modeDeliveredDay) ? 'OK' : 'SPLIT_DAY';
      }
      distinctContainers.push({ ...c, deliveryStatus });
    }

    return {
      // Identifiers
      id: doRow.do_num,
      do_num: doRow.do_num,
      so_num: doRow.so_num,
      wave_num: doRow.wave_num,
      internal_shipment_num: doRow.internal_shipment_num,

      // Channel (PR4a: server already maps code -> name)
      channel: doRow.channel,            // 'BS-IVY' / 'BS-RED' / 'VIVACE'
      channel_code: doRow.channel_code,  // '1100' / '1400' / '1900'

      // Customer (server toFactShape lowercases CUST_* into camel)
      customer: doRow.customer,
      customer_state: doRow.state,
      customer_city: doRow.city,
      customer_zipcode: doRow.zipcode,
      state: doRow.state, // alias for mock-page filter compatibility

      // Dates (already EST-converted in SQL)
      so_created_date: doRow.so_created_date,
      delivered_date: doRow.delivered_date,

      // Split classification (live, settled basis)
      split_status: doRow.split_status,
      isSplit: doRow.is_split_shipment,           // alias for mock-page compatibility
      is_split_shipment: doRow.is_split_shipment,
      has_null_tracking: doRow.has_null_tracking,
      has_null_delivered_date: doRow.has_null_delivered_date,

      // PR Geo-1: DO-level (shipment_header) trailing status. SCALE schema:
      // 700 = Ship Confirm Pending, 800 = Load Confirm Pending, 900 = Closed.
      // trailing_status_date carries the ET-converted timestamp when the
      // shipment row reached its current TRAILING_STS. GeoPage uses this to
      // classify delayed shipments (trailing_status_date <= so_created_date
      // + kdcTarget → on time; else delayed). LEADING_STS is per-container
      // and lives on each entry of `containers`, not on the DO row.
      trailing_status: doRow.trailing_sts,
      trailing_status_date: doRow.trailing_sts_date,

      // PR Overview-A cycle wire: SH.creation_date_time_stamp (ET-converted in
      // master query). Hoisted to DO-level since every container row in a DO
      // shares the same SH timestamp. Used as the start point for container-
      // level cycle hours (manifest_date_time - order_received_at).
      order_received_at: doRow.order_received_at,

      // PR Truck-1: carrier identity. 'UPS' or 'TRUCK' (raw SCALE
      // shipment_header.carrier). Used by splitData / containerMetrics /
      // ytdCustomerList to exclude TRUCK rows from Split metrics (Truck has
      // no split concept; user-stated invariant). Mock data uses values like
      // 'UPS Ground', 'FedEx Ground', so `carrier !== 'TRUCK'` keeps mock
      // behavior intact.
      //
      // PR Truck-1-fix: pro_num 의 mapping 제거 (final CTE 의 coalesce 의
      // inside 만 — r.tracking_num access 로 양쪽 carrier 의 fact 충분).
      carrier: doRow.carrier,

      // PR Sample-Order-Filter: Sales document type from billing. Drives
      // App-level sample-order filter (default 'exclude_samples', toggleable
      // to 'all' or 'samples_only'). Filter is applied at pageData level
      // upstream of every other useMemo (splitData, regionOptions, etc).
      sales_doc_type: doRow.sales_doc_type,

      // DO-level aggregations
      tracking_cnt: doRow.tracking_cnt,
      container_cnt: doRow.container_cnt,
      manifest_cnt: doRow.manifest_cnt,
      delivered_date_cnt: doRow.delivered_date_cnt,

      // Container array (mock-shape compatibility — nested per-DO).
      // PR7b: deduplicated by container_id + each entry carries
      // `deliveryStatus` ('OK' | 'SPLIT_DAY' | 'PENDING').
      containers: distinctContainers,

      // PR7a: SPLIT GAP + VALUE computed above from the containers
      // closure. UI null-check from PR4b2 handles render fallback to '—'.
      splitGapDays,
      orderValue,

      // Mock-only fields → null in live mode (PR4b2 renders as N/A)
      chargeback: null,
      tier: null,
      // PR5b: splitReason now sourced from PR5a backend split_root_cause.
      // Only populated when split_status = 'SPLIT'; null for SINGLE / PENDING /
      // NOT_SPLIT / UNKNOWN — preserved as null to keep existing null-checks valid.
      splitReason: doRow.split_root_cause,
      cause: null,
      shift: null,

      // Source marker (debug)
      _source: 'live',
    };
  });
}

/**
 * Count items in arr by key, returning a {value: count} object.
 * Used for console diagnostic on successful live load.
 */
export function countBy(arr, key) {
  const m = {};
  for (const item of arr) {
    const k = item[key] ?? '(null)';
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

// PR4b2: SCALE container status is numeric (700/800/900 …). The mock used
// UPS-style strings and the table colors keyed off those — map for parity
// so the existing badge styling renders.
export function mapScaleStatusToUps(scaleStatus) {
  if (scaleStatus == null) return 'LABEL_CREATED';
  const n = parseInt(String(scaleStatus), 10);
  if (!Number.isFinite(n)) return 'LABEL_CREATED';
  if (n >= 900) return 'DELIVERED';
  if (n >= 800) return 'OUT_FOR_DELIVERY';
  if (n >= 700) return 'IN_TRANSIT';
  if (n >= 400) return 'PICKED_UP';
  return 'LABEL_CREATED';
}
