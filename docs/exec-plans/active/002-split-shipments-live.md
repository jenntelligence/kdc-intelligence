# 002 — Split Shipments Live Data

**Status:** Active
**Owner:** TBD
**Created:** 2026-04-29
**Last updated:** 2026-04-29
**Parent plan:** [001-snowflake-integration.md](./001-snowflake-integration.md)

**Strategy:** Replace mock data on the SplitShipmentPage with live data
from Snowflake (`SCI` + `KDB`), implementing the 3-type split detection
(Zone/Container/Manifest level) per master plan §6b confirmed taxonomy
and the user-confirmed reference SQL in `snowflake-schema.md` § "Split
Shipment SQL — operational reference."

**Channel scope:** Page-level filter via `sc.company IN ('Ivy', 'Red',
'Vivace')` AND `sh.carrier = 'UPS'`. Other pages unaffected — the app's
header channel selector (`selectedChannels` state at
`src/ShippingSLAApp.jsx:5023`) remains a separate, broader filter.

**Estimated PR count:** 6 (PR6 conditional)
**Estimated effort:** 1-2 working days, assuming Snowflake access works on
first call. Add 0.5-1 day if cross-DB permissions need provisioning.

---

## 1. Goal

Make the SplitShipmentPage render live Snowflake data using the
user-confirmed reference SQL — limited to BS-IVY/BS-RED/VIVACE channels
via UPS — with split shipments classified into Zone-level (Type 1),
Container-level (Type 2), and Manifest-level (Type 3), preserving
container-row granularity for UI drill-down support and the mock
fallback when Snowflake is unreachable.

---

## 2. Prerequisites

```markdown
- [ ] Snowflake credentials configured (env vars per `server.js:38-43`)
- [ ] First-time externalbrowser SSO completed (token cached)
- [ ] Cross-DB SELECT access verified for `SCI` and `KDB` (PR1 task)
- [ ] §7c #17 resolved (`ia_work_instruction` semantics — PR1 task)
- [ ] §7c #18 resolved (drill-down column names — PR1 task)
- [ ] Master plan §6b decisions read and understood
- [ ] User reference SQL read (in schema doc § Split Shipment SQL —
      operational reference)
- [ ] `npm install` clean; `npm run dev` and `node server.js` both run
```

---

## 3. Approach overview

| PR | Title | What | Time |
|----|-------|------|------|
| **PR1** | Snowflake exploration + scaffolding | DESCRIBE TABLE for `IA_WORK_INSTRUCTION` + `SHIPPING_CONTAINER` drill-down columns + `PROCESS_HISTORY` last-scan pattern. Add `toFactShape` helper, create `.env.example`. Resolve §7c #17, #18. | 1-2 hours |
| **PR2** | `useSplitShipments` hook + data fetching layer | Frontend data-fetching hook with mock-fallback pattern. `VITE_DATA_SOURCE` handling. Hook NOT yet wired to page. | 1 hour |
| **PR3** | `/api/scale/split-shipments` endpoint | The big one. User reference SQL → `server.js` endpoint with 5-CTE pattern, cross-DB join, 3-type detection, page-level scope filter. EST timezone conversion applied. | 3-4 hours |
| **PR4** | SplitShipmentPage live wiring | Replace mock data binding via hook. Frontend `groupBy(shipment_id)` for drill-down. Channel cards 11→3, reason labels 5→3, container status mapping (numeric → UPS-string). | 2-3 hours |
| **PR5** | Validation with operations | 1 known case per type (3 total). Operations signoff. Fix bugs. Capture validation log in §12. | 2-3 hours |
| **PR6 (conditional)** | Drill-down columns + performance tuning | If §7c #18 columns confirmed in PR1, add to SQL/UI. Profile full-year payload; add pagination if needed. | 1-2 hours |

**Critical-path order:** PR1 → PR2 → PR3 → PR4 → PR5. PR6 is optional
and orthogonal — can ship as a follow-up.

PR1 and PR2 may be drafted in parallel by the same author (PR1 unlocks
fact decisions for PR3; PR2 only depends on the existing
`liveKpis` fetch pattern at `src/ShippingSLAApp.jsx:5064`, not on PR1
findings).

---

## 4. PR-by-PR detailed specification

### PR1 — Snowflake exploration + scaffolding

**Goal:** First Snowflake connection from this codebase against new
tables. Resolve §7c #17, #18 via `DESCRIBE TABLE`. Establish
`toFactShape` helper for F1.

**Files modified:**
- `server.js` — add `toFactShape` helper + 3 exploration endpoints
- `.env.example` — create (currently absent — closes one P2 from
  tech-debt-tracker)

**Specific tasks:**

1. Add `toFactShape(row)` helper near existing `LIFECYCLE_STAGE_EXPR`
   block (`server.js:158-172`). Initial minimal version — extended in
   PR3 as actual columns are confirmed:

   ```javascript
   // F1 (master plan §6a): single conversion point at the boundary.
   // Snowflake returns UPPERCASE; FactShipment uses lowercase.
   // Phase 1 endpoints call this; Phase 2 pages migrate when their
   // page goes live.
   function toFactShape(row) {
     return {
       id:              row.SHIPMENT_ID,
       customer:        row.CUST_NAME ?? row.NAME,
       channel:         row.COMPANY ?? row.CHANNEL,
       carrier:         row.CARRIER,
       state:           row.CUST_STATE ?? row.REGION,
       city:            row.CUST_CITY ?? row.CITY,
       zipcode:         row.CUST_ZIPCODE ?? row.POSTALCODE,
       // container-level (one row per container in PR3 output)
       containerId:     row.CONTAINER_ID,
       containerStatus: row.CONTAINER_STATUS,
       trackingNumber:  row.TRACKING_NUMBER,
       manifestId:      row.MANIFEST_ID,
       pickZone:        row.PICK_ZONE,
       // window aggregations
       containerCount:  row.CONTAINER_COUNT,
       pickZoneCount:   row.PICK_ZONE_COUNT,
       manifestCount:   row.MANIFEST_COUNT,
       // 3-type flags + primary type
       zoneSplit:       row.ZONE_LEVEL_SPLIT_FLAG === 1,
       containerSplit:  row.CONTAINER_LEVEL_SPLIT_FLAG === 1,
       manifestSplit:   row.MANIFEST_LEVEL_SPLIT_FLAG === 1,
       primarySplitType: row.PRIMARY_SPLIT_TYPE,
       // the page reads `isSplit` boolean
       isSplit: (row.ZONE_LEVEL_SPLIT_FLAG === 1) ||
                (row.CONTAINER_LEVEL_SPLIT_FLAG === 1) ||
                (row.MANIFEST_LEVEL_SPLIT_FLAG === 1),
     };
   }
   ```

   Notes:
   - Aliases follow the user's reference SQL column names where
     possible (cust_name, cust_state, etc.).
   - Status mapping (numeric SCALE → UPS-style string) deferred to
     PR4 frontend layer; the boundary helper keeps raw values.
   - Mock-shape fields like `tier`, `chargeback`, `splitGapDays` are
     intentionally NOT computed here — defer to PR4 frontend or
     mark "live mode shows blank" in PR4 spec.

2. Add exploration endpoint `/api/scale/explore-ia-wi`:

   ```javascript
   app.get('/api/scale/explore-ia-wi', async (_req, res) => {
     try {
       const cols = await executeQuery(`
         SELECT COLUMN_NAME, DATA_TYPE, COMMENT
         FROM SCI.INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'L0'
           AND TABLE_NAME = 'IA_WORK_INSTRUCTION'
         ORDER BY ORDINAL_POSITION
       `);
       const sample = await executeQuery(`
         SELECT *
         FROM SCI.L0.IA_WORK_INSTRUCTION
         WHERE company IN ('Ivy', 'Red', 'Vivace')
           AND instruction_type = 'header'
         LIMIT 5
       `);
       res.json({
         success: true, columns: cols, sample,
         source: 'snowflake', table: 'SCI.L0.IA_WORK_INSTRUCTION',
       });
     } catch (err) {
       res.status(500).json({ success: false, error: err.message });
     }
   });
   ```

3. Add `/api/scale/explore-shipping-container-cols` — query
   `INFORMATION_SCHEMA.COLUMNS` for `SHIPPING_CONTAINER` plus a
   single `SELECT * ... LIMIT 1` row to discover real column names
   for `weight`, expected/actual delivery dates, and any UDFs that
   carry drill-down values. (§7c #18.)

4. Add `/api/scale/explore-process-history` — sample
   `PROCESS_HISTORY` events for a known container_id, filtered by
   process codes likely tied to "last scan location" (TBD which
   process codes; the endpoint is exploratory).

5. Manually run the 3 exploration endpoints in browser. Capture
   findings into:
   - `docs/references/snowflake-schema.md` — Verified facts (extend
     the "Split Shipment SQL — operational reference" section, or
     add a new sub-section for `IA_WORK_INSTRUCTION` columns).
   - `docs/exec-plans/active/001-snowflake-integration.md` — close
     §7c #17 and #18 once facts confirmed.
   - This sub-plan §7 — note any new questions discovered.

   These doc updates ship as a **separate commit** from the PR1
   code commit, per AGENTS.md "track tech debt as you find it" and
   the master plan's "update plan first as a separate change" rule.

6. Create `.env.example` at project root (currently missing):

   ```
   # ─── Snowflake (server.js) ───────────────────────────────────
   # Required — get from data team or Snowflake admin
   SNOWFLAKE_ACCOUNT=
   SNOWFLAKE_USERNAME=
   # Optional — defaults are reasonable
   SNOWFLAKE_WAREHOUSE=KDCGA1_WH
   SNOWFLAKE_DATABASE=SCI
   SNOWFLAKE_SCHEMA=PUBLIC
   SNOWFLAKE_ROLE=
   API_PORT=3001

   # ─── Frontend data source (Vite) ────────────────────────────
   # mock | live | csv  (default: mock)
   VITE_DATA_SOURCE=mock

   # ─── Optional: Gemini AI ────────────────────────────────────
   GOOGLE_GENERATIVE_AI_API_KEY=
   ```

   **Do not** commit a real `.env` (already in `.gitignore`).

**Validation:**
- `node server.js` starts without crashing.
- `curl http://localhost:3001/api/scale/explore-ia-wi | jq .columns | length` returns > 0.
- Browser shows JSON response from each exploration endpoint.
- externalbrowser SSO works on first call (token caches; second
  call latency ~ms not seconds).
- §7c #17 resolved (`ia_work_instruction` column list captured in
  schema doc).
- §7c #18 resolved (SC drill-down columns identified; `weight` /
  `gross_weight` actual name confirmed).
- `npm run build` passes (no frontend changes — should be unaffected).

**Depends on:** Prerequisites (Snowflake access provisioned)
**Blocks:** PR3 (PR3's SQL needs the column names PR1 discovers)

---

### PR2 — `useSplitShipments` hook + data fetching layer

**Goal:** Frontend data-fetching layer with mock-fallback pattern.
`VITE_DATA_SOURCE` handling. Hook callable but NOT YET wired to the
page (PR4 wires).

**Files modified:**
- `src/ShippingSLAApp.jsx` — add hook near top, alongside other custom
  hooks. NOT yet replacing `rawData` source on `SplitShipmentPage`.

**Specific tasks:**

1. Add `useSplitShipments` hook near top of file (suggested location:
   right above `SplitShipmentPage` at line 1169, OR grouped with the
   data-source toggle area near line 5035):

   ```javascript
   /**
    * Fetches live split-shipment data from Snowflake. Falls back to
    * mock on any failure (network, HTTP, or `success: false`).
    * Per master plan §6b — page-level filter intrinsic to backend.
    *
    * @returns { data, error, loading, source }
    *   source: 'live' | 'mock' | 'mock-fallback'
    */
   function useSplitShipments() {
     const [data, setData] = useState(null);
     const [error, setError] = useState(null);
     const [loading, setLoading] = useState(true);
     const [source, setSource] = useState('mock');

     useEffect(() => {
       const sourceMode = import.meta.env.VITE_DATA_SOURCE || 'mock';
       if (sourceMode !== 'live') {
         setData(generateMockShipments());
         setSource('mock');
         setLoading(false);
         return;
       }

       fetch('http://localhost:3001/api/scale/split-shipments')
         .then(r => {
           if (!r.ok) throw new Error(`HTTP ${r.status}`);
           return r.json();
         })
         .then(json => {
           if (!json.success) throw new Error(json.error || 'Unknown');
           setData(json.data);
           setSource('live');
           setLoading(false);
         })
         .catch(err => {
           // Per core-beliefs §6: mock fallback, do not blank the page
           console.warn('Live split-shipment data unavailable:', err);
           setData(generateMockShipments());
           setError(err.message);
           setSource('mock-fallback');
           setLoading(false);
         });
     }, []);

     return { data, error, loading, source };
   }
   ```

2. Hook is **callable but unused** in PR2. PR4 wires it into
   `SplitShipmentPage`.

3. The hook intentionally hardcodes `http://localhost:3001/...`
   matching the pattern at `src/ShippingSLAApp.jsx:5042`. Don't
   refactor that into a config in this PR — that's its own debt
   item (see §7).

**Validation:**
- `npm run build` passes.
- Hook callable from React DevTools but not yet rendered in UI.
- `.env.example` documents `VITE_DATA_SOURCE` (created in PR1).

**Depends on:** PR1 (server.js endpoint patterns confirmed; toFactShape exists)
**Blocks:** PR4

---

### PR3 — `/api/scale/split-shipments` endpoint

**Goal:** Live SQL endpoint. Direct adaptation of user reference SQL
into `server.js` style. Cross-DB join, 3-type detection, container-row
preservation, EST timezone conversion.

**Files modified:**
- `server.js` — add new endpoint (~150-200 lines incl SQL string)
- (possibly) `toFactShape` extended if PR1's initial mapping needs
  adjustments based on actual SELECT projections

**Specific tasks:**

1. Adapt the user reference SQL from `snowflake-schema.md` § Split
   Shipment SQL — operational reference. Structure (5-CTE per master
   plan §6b SQL strategy):

   ```sql
   WITH base AS (
     SELECT
       sh.shipment_id,
       sh.carrier,
       sh.ship_to,
       sh.internal_shipment_num,
       sc.container_id,
       sc.tracking_number,
       sc.manifest_id,
       sc.status                          AS container_status,
       sc.date_time_stamp                 AS container_status_time,
       sc.manifest_close_date_time        AS manifest_close_time,
       sc.company,
       cm.name                            AS cust_name,
       cm.region                          AS cust_state,
       cm.city                            AS cust_city,
       cm.postalcode                      AS cust_zipcode
     FROM SCI.L0.SHIPMENT_HEADER sh
     JOIN SCI.L0.SHIPPING_CONTAINER sc
       ON sc.internal_shipment_num = sh.internal_shipment_num
     LEFT JOIN KDB.PBI_SF.SAP_CUSTOMER_MASTER cm
       ON sh.ship_to = cm.shiptoparty_key
     WHERE sc.company IN ('Ivy', 'Red', 'Vivace')
       AND sh.carrier = 'UPS'
       AND sc.date_time_stamp >= '2026-01-01'
       AND sh.warehouse = 'KDCGA1'
       -- IN_DELETION filter omitted per F0 validation 2026-04-29
   ),
   work AS (
     SELECT container_id, work_unit, user_def1 AS pick_zone
     FROM SCI.L0.WORK_INSTRUCTION
     WHERE company IN ('Ivy', 'Red', 'Vivace')
       AND instruction_type = 'header'
     UNION ALL
     SELECT container_id, work_unit, user_def1 AS pick_zone
     FROM SCI.L0.IA_WORK_INSTRUCTION
     WHERE company IN ('Ivy', 'Red', 'Vivace')
       AND instruction_type = 'header'
   ),
   container_with_zone AS (
     SELECT b.*, w.pick_zone
     FROM base b
     LEFT JOIN work w ON w.container_id = b.container_id
   ),
   flagged_containers AS (
     SELECT
       cwz.*,
       COUNT(DISTINCT container_id) OVER (PARTITION BY shipment_id) AS container_count,
       COUNT(DISTINCT pick_zone)    OVER (PARTITION BY shipment_id) AS pick_zone_count,
       COUNT(DISTINCT manifest_id)  OVER (PARTITION BY shipment_id) AS manifest_count,
       MIN(CASE WHEN container_status >= '700' THEN container_status_time END)
         OVER (PARTITION BY shipment_id) AS first_status_700_time,
       MAX(CASE WHEN container_status >= '700' THEN container_status_time END)
         OVER (PARTITION BY shipment_id) AS last_status_700_time,
       COUNT(CASE WHEN container_status >= '700' THEN 1 END)
         OVER (PARTITION BY shipment_id) AS status_700_container_count,
       MIN(manifest_close_time) OVER (PARTITION BY shipment_id) AS first_manifest_close_time,
       MAX(manifest_close_time) OVER (PARTITION BY shipment_id) AS last_manifest_close_time
     FROM container_with_zone cwz
   ),
   with_flags AS (
     SELECT
       fc.*,
       CASE WHEN pick_zone_count > 1 THEN 1 ELSE 0 END AS zone_level_split_flag,
       CASE
         WHEN container_count > 1
          AND first_status_700_time IS NOT NULL
          AND last_status_700_time IS NOT NULL
          AND first_status_700_time <> last_status_700_time
         THEN 1 ELSE 0
       END AS container_level_split_flag,
       CASE
         WHEN container_count > 1
          AND (
                manifest_count > 1
             OR first_manifest_close_time <> last_manifest_close_time
             OR (status_700_container_count > 0
                 AND status_700_container_count < container_count)
              )
         THEN 1 ELSE 0
       END AS manifest_level_split_flag
     FROM flagged_containers fc
   )
   SELECT
     shipment_id,
     container_id,
     container_status,
     tracking_number,
     manifest_id,
     pick_zone,
     CONVERT_TIMEZONE('UTC', 'America/New_York', container_status_time) AS container_status_time,
     CONVERT_TIMEZONE('UTC', 'America/New_York', manifest_close_time)   AS manifest_close_time,
     company AS channel,
     cust_name,
     cust_state,
     cust_city,
     cust_zipcode,
     container_count,
     pick_zone_count,
     manifest_count,
     zone_level_split_flag,
     container_level_split_flag,
     manifest_level_split_flag,
     CASE
       WHEN manifest_level_split_flag  = 1 THEN '03 Manifest-level split'
       WHEN container_level_split_flag = 1 THEN '02 Container-level split'
       WHEN zone_level_split_flag      = 1 THEN '01 Zone-level split'
       ELSE 'No split'
     END AS primary_split_type
   FROM with_flags
   WHERE zone_level_split_flag      = 1
      OR container_level_split_flag = 1
      OR manifest_level_split_flag  = 1
   ORDER BY shipment_id, container_id
   ```

   Above SQL is the **draft from this plan**, not the verbatim user
   SQL. Treat this as the starting structure; cross-validate against
   the user's reference (per master plan §6b Validation: "sub-plan
   002's first endpoint result must match the user's reference SQL
   output for the same date range").

2. Endpoint code (mirrors existing `server.js` patterns):

   ```javascript
   // ── Split Shipments (Phase 1 — page 1) ─────────────────────
   // Per docs/exec-plans/active/001-snowflake-integration.md §6b
   // and snowflake-schema.md § "Split Shipment SQL — operational
   // reference". Channel scope: BS-IVY/BS-RED/VIVACE via UPS only.
   const SPLIT_SHIPMENTS_SQL = `... ${MULTILINE_SQL_FROM_TASK_1} ...`;

   app.get('/api/scale/split-shipments', async (_req, res) => {
     try {
       const rows = await executeQuery(SPLIT_SHIPMENTS_SQL);
       const data = rows.map(toFactShape);
       res.json({
         success: true,
         data,
         count: data.length,
         source: 'snowflake',
         table: 'SCI.L0.SHIPMENT_HEADER + SHIPPING_CONTAINER + WORK_INSTRUCTION + IA_WORK_INSTRUCTION + KDB.PBI_SF.SAP_CUSTOMER_MASTER',
       });
     } catch (err) {
       console.error('split-shipments query failed:', err);
       res.status(500).json({ success: false, error: err.message });
     }
   });
   ```

3. Update the boot log block at `server.js:787-829` to include the
   new endpoint.

4. Update `toFactShape` to handle every column the SELECT projects
   (extend from the PR1 minimal shape).

5. EST timezone conversion (`CONVERT_TIMEZONE('UTC',
   'America/New_York', ...)`) applied to **all displayed
   timestamps**. Pattern matches existing `workload-pm` /
   `workload-ps` queries (`server.js:530-577`).

6. Manual smoke validation:
   - `curl http://localhost:3001/api/scale/split-shipments | jq '.data | length'` — sane count (>0, <10000).
   - First call latency < 30s (cold connection); subsequent < 5s.
   - Sample row: all 3 channels (Ivy/Red/Vivace) appear; all 3
     `primary_split_type` values appear; customer names populated
     for >80% of rows.

**Validation:**
- **Cross-validate against user reference SQL:** for the same date
  range, `data.length` and 3-type counts should match. Any divergence
  is a bug — fix or escalate before PR4.
- Container rows preserved (multiple rows per `shipment_id` confirmed
  via grouping check in jq or DevTools).
- All 3 split flag combinations (zone+container, container only,
  manifest only) appear in real data — empirically verifies no
  single CTE is broken.
- `npm run build` passes.

**Depends on:** PR1 (column info from explore endpoints), PR2
  (FactShape understood)
**Blocks:** PR4

---

### PR4 — SplitShipmentPage live wiring

**Goal:** Wire live data into the page. UI changes per master plan §6b.
Mock fallback path preserved.

**Files modified:**
- `src/ShippingSLAApp.jsx` — `SplitShipmentPage` component (line 1169);
  the parent app component is NOT modified (no toggle changes; the
  hook owns its own data lifecycle).

**Specific tasks:**

1. Replace `filtered` prop usage in `SplitShipmentPage` with hook
   output. The page currently consumes `filtered` from the parent's
   `data = uploadedData || rawData` chain (`src/ShippingSLAApp.jsx:5122`,
   `5127`). For live mode the page bypasses that chain and uses the
   hook directly:

   ```javascript
   const SplitShipmentPage = ({ filtered: filteredFromProps }) => {
     const { data: liveData, source, error } = useSplitShipments();

     // Live data already pre-filtered to scope (Ivy/Red/Vivace via
     // UPS); mock data shows all 11 channels per existing behavior.
     const filtered = source === 'mock'
       ? filteredFromProps                  // existing mock path
       : groupedByOrder(liveData);          // live path (see task 2)

     // ... rest of the existing component body
   };
   ```

   Trade-off note: this means the app's global `selectedChannels`
   header filter does NOT apply to live mode on this page. That's
   correct per master plan §6b ("page-level filter, not
   app-level"). For mock mode, `filteredFromProps` already had the
   header filter applied — preserve that behavior.

2. Add `groupedByOrder` helper inside the component (or at module
   scope if reused later). Live data arrives as flat container rows
   per PR3 SQL; the existing `SplitShipmentPage` table renders one
   row per shipment with `o.containers[]` for drill-down:

   ```javascript
   function groupedByOrder(rows) {
     if (!rows) return [];
     const map = new Map();
     for (const r of rows) {
       const key = r.id; // shipment_id mapped to id by toFactShape
       if (!map.has(key)) {
         map.set(key, {
           id: r.id,
           customer: r.customer,
           channel: r.channel,
           state: r.state,
           cause: r.primarySplitType?.includes('Zone') ? 'DC'
                 : r.primarySplitType?.includes('Manifest') ? 'DC'
                 : r.primarySplitType?.includes('Container') ? 'UPS'
                 : '',
           tier: 'Mid',                       // live data lacks this — placeholder
           shift: '',                         // live data lacks this — placeholder
           orderValue: 0,                     // live data lacks this — placeholder
           chargeback: 0,                     // live data lacks this — placeholder
           isOpen: r.containerStatus !== 'DELIVERED' && r.containerStatus < '900',
           isSplit: r.isSplit,
           splitCartons: r.containerCount,
           splitGapDays: 0,                   // could derive from window timestamps in PR6
           splitReason: r.primarySplitType,   // mock had 5 reasons — replace with 3 type labels
           containers: [],
         });
       }
       const o = map.get(key);
       o.containers.push({
         containerId:    r.containerId,
         trackingNumber: r.trackingNumber,
         status:         mapContainerStatus(r.containerStatus),
         pickZone:       r.pickZone,
         manifestId:     r.manifestId,
         shipDate:       r.containerStatusTime,
         expectedDelivery: null,              // §7c #18 column (PR6)
         actualDelivery:   null,              // §7c #18 column (PR6)
         isLate: false,                       // derive in PR6
         deliveredDifferentDay: r.manifestSplit, // approximation
         weight: null,                        // §7c #18
         items:  null,                        // §7c #18
         lastLocation: null,                  // §7c #18
         lastScan: null,                      // §7c #18
       });
     }
     return Array.from(map.values());
   }

   function mapContainerStatus(scaleStatus) {
     // Mock used UPS-style strings (LABEL_CREATED, IN_TRANSIT, ...).
     // Live SCALE container_status is numeric/string '700'/'800'/'900'.
     // Map for UI badge color compatibility:
     if (!scaleStatus) return 'LABEL_CREATED';
     const n = parseInt(scaleStatus, 10);
     if (n >= 900) return 'DELIVERED';
     if (n >= 800) return 'OUT_FOR_DELIVERY';
     if (n >= 700) return 'IN_TRANSIT';
     if (n >= 400) return 'PICKED_UP';
     return 'LABEL_CREATED';
   }
   ```

3. UI changes within the page (per master plan §6b "UI changes from
   mock"):
   - **Channel cards (line 1310):** in live mode, only Ivy/Red/Vivace
     channels appear in `splitData.channelList` — the existing
     `.map()` produces 3 cards naturally. No structural change to
     the JSX. The `lg:grid-cols-11` class can stay (it gracefully
     degrades to 3 wide cards). Optionally update to `lg:grid-cols-3`
     conditionally on `source === 'live'` for tighter layout.
   - **Root Causes chart (line 1288 `SectionCard`):** existing
     `splitData.reasonList` derived from `o.splitReason`. With live
     data, `splitReason` becomes one of the 3 type labels, so the
     chart naturally shrinks to 3 entries. Update the in-line
     "explanation" text inside the SectionCard (lines 1297-1301) to
     describe the 3 types instead of mock's 5 reasons.
   - **Container Tracking table (line 1341):** Root Cause column
     (line 1351, `<th>`) header stays; cell value comes from
     `o.splitReason` which now equals `primary_split_type`. No JSX
     change required, but the labels displayed are now "01 Zone-level
     split" / "02 Container-level split" / "03 Manifest-level split".

4. Add a banner at the top of the page when `source === 'mock-fallback'`:

   ```jsx
   {source === 'mock-fallback' && (
     <div className="bg-amber-100 border-l-2 border-amber-500 p-2 mb-4 text-[12px]">
       <AlertTriangle size={12} className="inline mr-1" />
       Live data unavailable — showing mock. {error}
     </div>
   )}
   ```

   Per core-beliefs.md §6 — never blank the page; show clearly-labeled
   degraded mode.

5. Drill-down panel uses sibling rows from `containers` array (PR3
   already nests them via `groupedByOrder`). NO separate API call.
   Existing JSX at lines 1382-1432 already iterates `o.containers` —
   needs no structural change.

   Fields the existing JSX expects but live mode doesn't populate:
   - `c.weight` (line 1409) — null until PR6
   - `c.items` (line 1409) — null until PR6
   - `c.lastLocation` (line 1401) — null until PR6
   - `c.expectedDelivery.toLocaleDateString` (line 1415) — null
     until PR6; **guard against null** to avoid TypeError

   Add null-safe rendering for these so PR4 doesn't crash on live
   data with the column gaps.

**Validation:**
- Browser, `VITE_DATA_SOURCE=live`: real data renders. 3 channel
  cards visible. 3 type labels in Root Causes. Drill-down on a real
  shipment shows container details (no JS errors).
- Browser, `VITE_DATA_SOURCE=mock`: page identical to current
  behavior (mock 5-reason labels, 11-channel cards).
- Stop `node server.js` mid-session — toggle to live → page shows
  fallback banner, mock data renders. Per core-beliefs §6.
- `npm run build` passes.
- No regression on Executive Summary live KPIs (`liveKpis` overlay
  unaffected).
- Existing 13 server.js endpoints still respond.

**Depends on:** PR1, PR2, PR3
**Blocks:** PR5

---

### PR5 — Validation with operations

**Goal:** Real-world correctness check. Operations confirms the 3-type
classifications match their judgment for known cases. Capture the log.

**Files modified:**
- This sub-plan file — fill §12 Validation log
- (Possibly) `server.js` — fix bugs found during validation
- (Possibly) `tech-debt-tracker.md` — log new debt items

**Specific tasks:**

1. With operations supervisor, pick:
   - **1 known Zone-level split** — recent, identifiable shipment_id
     where the order's lines were spread across multiple pick zones.
   - **1 known Container-level split** — sibling containers had
     status-700 transition timestamps that differ.
   - **1 known Manifest-level split (silent killer)** — operations
     may need to dig for this since the dashboard didn't catch them
     before. Best candidates: orders where chargebacks landed but
     SCALE-side status looked clean.

2. For each known case:
   - Live page classifies the shipment correctly
     (`primary_split_type` matches operations' verdict).
   - Customer name populated and matches operations' record.
   - Channel matches (Ivy/Red/Vivace).
   - `container_count` matches the actual carton count.
   - Drill-down shows expected `container_id`s.
   - For Type 2/3: timestamps in the drill-down (when shown) align
     with operations' SCALE console.

3. Document results in §12 of this file. Each row: date, tester,
   type validated, shipment_id, result (PASS/FAIL), notes.

4. If discrepancy found:
   - Identify root cause: SQL bug? UI bug? data quirk? operations
     misremembered?
   - Fix in PR5 itself (small fix) or open a follow-up PR (large fix).
   - If a confirmed plan/schema fact changes, update master plan +
     schema doc as a separate commit.

**Validation:**
- All 3 known cases classify correctly (or discrepancy is
  understood and either fixed or accepted with documentation).
- Operations team signoff captured in §12.
- No regressions in existing 13 endpoints (re-test the
  Executive Summary live-KPI overlay still works).

**Depends on:** PR4
**Blocks:** Sub-plan 002 completion

---

### PR6 (conditional) — Drill-down columns + performance tuning

**Goal:** Add the §7c #18 columns (items / weight / last-scan /
expected & actual delivery dates) if PR1 found their sources.
Performance tuning if needed.

**Skip conditions:**
- §7c #18 columns not located in PR1 (track in tech-debt-tracker as
  a follow-up exploration).
- Live page first-load < 3s, response payload < 500KB — no tuning
  needed.

**If executing:**

1. Extend the SQL CTE to JOIN whichever table(s) PR1 confirmed for
   each field:
   - Item count → likely `SHIPMENT_DETAIL` line count joined to
     container, OR a `SHIPPING_CONTAINER` UDF.
   - Weight → likely `SC.weight` or `SC.gross_weight`.
   - Last scan location → `PROCESS_HISTORY` last event for
     container_id (events with location/identifier4 carrying the hub
     name).
   - Expected delivery → likely `SH` or `SC` UDF.
   - Actual delivery → `SC.date_time_stamp WHERE container_status >= '900'`.

2. Update `toFactShape` and the `groupedByOrder` helper to populate
   these fields.

3. Update the drill-down JSX null-guards (added in PR4) so real
   values render correctly.

4. Performance: profile full-2026-year payload with all columns.
   - Measure response size and TTFB.
   - If > 1MB or > 5s, propose pagination or month-window slicing
     in a separate exec plan (do not pre-optimize).

**Validation:**
- Drill-down panel shows real items/weight/location/dates.
- Page load latency unchanged or within +500ms.
- `npm run build` passes.

**Depends on:** PR5 (validation passed; we trust the page)
**Blocks:** Nothing critical — this is enrichment.

---

## 5. Risk register

| PR | Risk | Mitigation |
|----|------|-----------|
| PR1 | externalbrowser SSO fails on first call (proxy/cert/MFA issues) | User runs first call manually with browser open; if it fails, surface to data team; do not bypass SSO |
| PR1 | DESCRIBE shows `IA_WORK_INSTRUCTION` has different column structure than `WORK_INSTRUCTION` | Operations conversation; may need to reshape the UNION ALL or replace with separate queries; if blocking, escalate to plan-level revision |
| PR1 | Cross-DB SELECT permission missing on `KDB.PBI_SF.SAP_CUSTOMER_MASTER` | Customer name LEFT JOIN returns NULLs gracefully; PR3 still runs but with blank customers; flag as P1 in tech-debt and request grants |
| PR3 | Cross-DB query slow (> 30s) on cold cache | Add `LIMIT 100` for early testing; profile the JOIN order; consider materializing a CTE; if structurally slow, propose nightly cache as separate exec plan |
| PR3 | User reference SQL has a hidden assumption that fails on the full year | Cross-validate small subset first (e.g., last 7 days); expand to full year incrementally; if divergence found, surface to user and update plan |
| PR3 | Sales Org / company filter excludes orders that operations expects to see | Validation with operations during PR5 catches this; before PR5, run a sanity count against `SC.company` distribution |
| PR4 | FactShape mismatch breaks existing `splitData.useMemo` derivations | Mock data path unchanged; only `source === 'live'` uses new shape; null-guards on missing fields prevent crashes |
| PR4 | Channel selector header behavior surprises users in live mode | Document in UI: live page filters to 3 channels regardless of header selector; consider a small inline hint |
| PR4 | Status mapping (numeric SCALE → UPS-string) wrong; drill-down badges incorrect | Hard-coded mapping in `mapContainerStatus`; verify against operations during PR5 |
| PR5 | Operations finds 3-type classification fundamentally wrong | Iterate on SQL with user reference; if wrong, escalate to master plan revision before further PRs |
| PR6 | Adding more columns inflates response > 1MB | Profile before merging; add LIMIT or pagination if hit; do not pre-optimize |

---

## 6. Validation criteria (sub-plan complete when)

```markdown
- [ ] All 6 PRs merged (or PR6 explicitly skipped with reason)
- [ ] §7c #17 (`ia_work_instruction` semantics) and #18 (drill-down
      column names) closed in master plan
- [ ] §6b Risks 1-5 mitigated, accepted, or escalated with doc
- [ ] Operations team signoff on 3 known cases (1 per type) — §12 filled
- [ ] `npm run build` passes throughout the PR sequence
- [ ] Mock fallback works when Snowflake unreachable (test by stopping
      `server.js`)
- [ ] Live page renders in < 3s (cached fetch)
- [ ] No regression in existing 13 `server.js` endpoints — re-curl
      them after each PR
- [ ] Cross-validation: live endpoint result matches user reference
      SQL output for the same date range (master plan §6b
      Validation requirement)
- [ ] This sub-plan moved from `active/` to `completed/` per AGENTS.md
      §3
```

---

## 7. Open questions discovered during sub-plan writing

These are new — not covered by master plan §7c. Candidates for §7c
inclusion if they grow beyond a single PR scope.

- [ ] **A. SCALE container_status numeric range vs UPS-style string**
      — Mock uses `LABEL_CREATED`/`IN_TRANSIT`/`DELIVERED`. Live SCALE
      `SC.status` is numeric (e.g., '700', '800', '900'). PR4
      proposes a mapping in `mapContainerStatus` but the boundaries
      aren't formally documented. Resolve by walking the boundaries
      with operations during PR5. Default: the proposed mapping
      based on `TRAILING_STATUS` codes from schema doc.

- [ ] **B. `SC.original_pick_loc` (server.js floor area) vs
      `WI.user_def1` (user SQL pick zone) — same concept or different?**
      `server.js:495-498` uses `LEFT(sc.original_pick_loc, 2)` to
      derive 'PP'/'PM'/'PS' floor areas. The user reference SQL
      uses `WI.user_def1` for pick zone in Type 1 detection. These
      are likely different concepts (physical floor area vs logical
      pick zone), but worth confirming with operations during PR1
      exploration. If different, both should be exposed; if same,
      consolidate.

- [ ] **C. Hardcoded API URL `http://localhost:3001`**
      `src/ShippingSLAApp.jsx:5042`, `5066`, `5081` and the new
      `useSplitShipments` hook all hardcode the localhost URL.
      Phase 1 stays local-dev-only per master plan §3c so this is
      acceptable; track for the API hardening exec plan referenced
      there.

- [ ] **D. Frontend mock-shape fields without live equivalents**
      Mock generator produces `tier`, `chargeback`, `splitGapDays`,
      `shift`, `orderValue` per shipment. Live PR3 SQL doesn't
      retrieve these. PR4 uses placeholders/zeros. Long-term these
      should either come from SAP (chargeback, orderValue), be
      derived from PROCESS_HISTORY (shift), or be acknowledged as
      mock-only (tier — hardcoded `CUSTOMER_TIERS` map at
      `src/ShippingSLAApp.jsx`). Track if user-visible in PR5.

- [ ] **E. Channel selector vs page-level filter UX clarity**
      The app's header `selectedChannels` is unrelated to
      SplitShipmentPage's intrinsic 3-channel filter in live mode.
      A user toggling the header filter in live mode will see the
      Split page unchanged — possibly confusing. Inline hint
      ("Live mode: page filtered to BS-IVY/BS-RED/VIVACE")
      proposed for PR4. Validate phrasing with operations.

---

## 8. Rollback plan

Layered (smallest hammer first):

- **Environment:** unset `VITE_DATA_SOURCE` or set to `mock` — page
  reverts to mock. No code changes.
- **Endpoint:** comment out the new `/api/scale/split-shipments`
  route in `server.js`. The hook then catches HTTP 404, falls back
  to mock, page renders mock + banner. Existing 13 endpoints
  untouched.
- **Hook:** remove the `useSplitShipments` import from
  `SplitShipmentPage` and revert to the `filtered` prop chain. JSX
  unchanged in mock mode; this restores Phase-0 behavior.
- **Per-PR:** each PR is independently revertable. Reverting PR4
  takes the page back to mock-only without removing the endpoint
  or hook. Reverting PR3 leaves the hook with no working endpoint
  (auto-falls-back to mock). PR1's exploration endpoints are
  harmless and can be left in place or removed.

---

## 9. Implementation notes (guardrails)

- **All SQL is read-only** per `core-beliefs.md` §8 and `AGENTS.md`
  Database safety rule. No `INSERT/UPDATE/DELETE/MERGE/CREATE/DROP/
  ALTER/TRUNCATE/CALL/COPY INTO/GRANT/REVOKE` anywhere — including
  the exploration endpoints in PR1.
- **Master plan §6b decisions are binding.** If a sub-plan PR seems
  to require deviating from a plan decision (e.g., changing the
  channel filter, adding a hour threshold to Type 2), STOP — update
  the master plan first as a separate commit, then continue.
- **Preserve user reference SQL intent.** The SQL is operationally
  correct per the user. Style adjustments are fine; semantic
  changes are a plan-level concern. If a correction is needed,
  separate commit + master plan + schema doc update.
- **Findings go to schema doc, not silently into code.** When PR1
  exploration discovers a new column or table, update
  `snowflake-schema.md` Verified facts in a separate commit before
  the code commit that depends on it.
- **External-answer items get logged in master plan §7c.** Don't
  hold a sub-plan PR pending an external answer — surface and
  proceed with mock fallback while waiting.
- **Single-file React structure preserved** — all changes inside
  `src/ShippingSLAApp.jsx`. Trigger conditions for splitting (per
  `tech-debt-tracker.md` P1) have not yet fired.
- **`toFactShape` is a server-side helper** — not exported, not
  exposed to the frontend. The frontend consumes the lowercase
  shape transparently.
- **Verify `npm run build` after each PR.** Per AGENTS.md
  Verification — do not ship a red build.

---

## 10. Completion

When all PRs are merged and §6 criteria pass:

- Move this file: `docs/exec-plans/active/002-split-shipments-live.md`
  → `docs/exec-plans/completed/002-split-shipments-live.md` (per
  AGENTS.md §3).
- Update master plan §6b Split Shipments status: mark
  "Sub-plan 002 — completed YYYY-MM-DD".
- Confirm master plan §7c #17 and #18 closed.
- Confirm new schema-doc Verified facts (PR1 discoveries) are
  captured.
- Update `README.md` and/or `ARCHITECTURE.md` if user explicitly
  authorizes — note: per `tech-debt-tracker.md` P1, README/CLAUDE.md
  drift is its own exec plan, not absorbed here. Mention as a
  small follow-up.

---

## 11. Sub-plan 002 outcome — what changes for the project

- ✅ Phase 1 page 1 (Split Shipments) renders live data when
  `VITE_DATA_SOURCE=live`.
- ✅ Snowflake connection layer validated against new tables —
  cross-DB join (`SCI` ↔ `KDB`) confirmed working.
- ✅ `toFactShape` pattern established as the single Phase 1
  conversion point — sub-plans 003 (Geographic) and 004 (Flight
  Board) reuse it with minimal extension.
- ✅ Mock-fallback pattern established (`useSplitShipments` hook
  shape) — sub-plans 003 and 004 follow the same structure
  (`useGeoSummary`, `useFlightBoard`).
- ✅ Operations team has done a 1st live-data validation —
  trust foundation built; subsequent sub-plans face less
  scepticism.
- ✅ Sub-plan 003 entry barrier lowered — `KDB` cross-DB join +
  scope filter pattern already implemented and exercised.
- ⚠️ Sub-plan 003 will need a different scope filter UI semantic
  (Geographic also uses Ivy/Red/Vivace + UPS, but the cause-bucket
  derivation is its own open question — see master plan §7c #11
  area).

---

## 12. Validation log (PR5 fills this)

| Date | Tester | Type validated | Shipment ID | Result | Notes |
|------|--------|----------------|-------------|--------|-------|
| TBD  | TBD    | Zone-level     | TBD         | TBD    | TBD   |
| TBD  | TBD    | Container-level| TBD         | TBD    | TBD   |
| TBD  | TBD    | Manifest-level | TBD         | TBD    | TBD   |

**Operations signoff:** TBD (name, date)
