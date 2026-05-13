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

### PR3 — `/api/scale/split-shipments` endpoint (Phase A — split detection)

**Scope update (2026-05-08):** Original PR3 plan combined split
detection with 3-type root cause classification. Per user master query
review, root cause classification (zone-level / container-level /
manifest-level) requires further validation and is deferred to a
separate PR (**Phase B**).

- **PR3 (Phase A — this PR):** split shipment detection only.
  - Output: `is_split_shipment` (Y/N), `split_status`
    (SINGLE_SHIPMENT / SPLIT / NOT_SPLIT / PENDING / UNKNOWN).
  - Detection basis: `delivered_date` × `tracking_num`
    (customer-experience perspective — what the customer actually
    sees).
- **Phase B (deferred to a later PR):** root cause classification.
  - Outputs: `has_zone_divergence`, `is_zone_split_root_cause`,
    `is_container_split`, `is_manifest_split`, `split_root_cause`.
  - Detection basis: zone / container / manifest divergence
    (operational perspective — what KDC's process produced).
  - Trigger: after PR4 page wiring and PR5 ops validation confirm
    Phase A.

**Goal:** Live SQL endpoint that returns container-level rows with a
DO-level `is_split_shipment` flag, derived from the user-verified
master query. Cross-DB join (SCI ↔ KDB), EST timezone conversion built
into the SQL itself, container-row preservation for UI drill-down.

**Trust hierarchy (binding for this PR):**

1. User operational facts (highest)
2. User master query (this section)
3. Plan / sub-plan SQL drafts
4. Endpoint code

The SQL string in `server.js` MUST be a byte-exact paste of the query
in task 1 — never edit the SQL in code. If the SQL needs to change,
update this plan section first as a separate commit, then re-paste.

**Files modified:**
- `server.js` — add new endpoint (~150-200 lines incl SQL string).
- (possibly) `toFactShape` extended to project the new columns.

**Major changes from prior plan draft (recorded for traceability):**

| # | Old plan draft | User master query (now ground truth) | Why |
|---|----------------|---------------------------------------|-----|
| 1 | Window-function `pick_zone_count > 1` for split detection | `delivered_date_cnt > 1` / `has_null_delivered_date = 1` / `has_null_tracking = 1` | Detection basis switched from operational (zone divergence) to customer-experience (delivered-date divergence) |
| 2 | Two-table base: SH + SC + KDB.SAP_CUSTOMER_MASTER | Adds `KDB.PBI_SF.ZSDRORDR` join for `so_created_date` | Sales-order creation date needed for time-to-ship metrics |
| 3 | `cm` join on `shiptoparty_key` only | `cm` join on `shiptoparty_key AND salesorg_key` | Prevents multi-row fan-out across sales orgs |
| 4 | No carrier-tracking CTE | New `ups_data` CTE from `SCI.L0.UPS_TRACKING` | `delivered_date` is the split-detection signal |
| 5 | No container-type filter | `lower(sc.container_type) in ('as inner', 'as outer', 'car', 'ip', 'ivy inner', 'ivy outer')` | Excludes non-customer-bound containers |
| 6 | Hardcoded date `>= '2026-01-01'` | Dynamic `YEAR(salesdocdate) = year(current_date())` | Avoids annual maintenance |
| 7 | `instruction_type = 'header'` (lowercase) | `instruction_type = 'Header'` (Pascal Case) | Aligns with §7c #20 closure |
| 8 | `WHERE warehouse = 'KDCGA1'` filter | Filter omitted | Not present in user master query — user is ground truth |
| 9 | `IA_WORK_INSTRUCTION UNION ALL WORK_INSTRUCTION` for pick zone | Only `IA_WORK_INSTRUCTION`, with `work_group='Picking'` and `work_type='Parcel Loading'` selectors | User confirmed IA_WI carries both pick and parcel-loading events for the in-scope channels |
| 10 | 5 CTEs | 6 CTEs (`base` / `ia_work_instruction` / `ups_data` / `final` / `do_level` / `classified`) | Necessary structure for `split_status` classification |

**Specific tasks:**

1. Use the user master query verbatim as the endpoint SQL. The query
   is operational ground truth. Paste byte-for-byte into a JS
   template literal in `server.js` — no edits to the SQL string.

   The exact query:

```sql
with base as (
    select
        sh.user_def1 as company,
        sh.user_def4 as so_num,
        sh.launch_num as wave_num,
        sh.shipment_id as do_num,
        sh.internal_shipment_num,
        sh.launch_num,
        cm.shiptoparty_key,
        cm.name as cust_name,
        cm.region as cust_state,
        cm.city as cust_city,
        cm.postalcode as cust_zipcode,
        sc.container_id,
        sc.container_type,
        sc.container_class,
        sh.LEADING_STS,
        sc.status as container_status,
        sc.tracking_number,
        sc.manifest_id,
        cast(concat(left(SALESDOCDATE, 4) , '-' , SUBSTRING(SALESDOCDATE, 5, 2) ,'-' , right(SALESDOCDATE, 2)) as date) so_created_date,
        convert_timezone('UTC', 'America/New_York', sc.date_time_stamp) as container_status_time,
        convert_timezone('UTC', 'America/New_York', sc.manifest_close_date_time) as manifest_close_time,
        b."Calendar_day" as billing_date,
        sum(b."NET($)") as invoice_amount
    from sci.l0.shipping_container sc
    join sci.l0.shipment_header sh on sc.internal_shipment_num = sh.internal_shipment_num
    join kdb.pbi_sf.sap_customer_master cm on sh.ship_to = cm.shiptoparty_key and sh.route = cm.salesorg_key
    join kdb.pbi_sf.zsdrordr so on sh.user_def4 = so.salesdocnumber
    left join kdb.pbi_sf.zsd_c01_billing b on ltrim(sh.user_def4, '0') = b."Sales_document"
    where sc.company in ('Ivy', 'Red', 'Vivace')
    and lower(sc.container_type) in ('as inner', 'as outer', 'car', 'ip', 'ivy inner', 'ivy outer')
    and sh.carrier = 'UPS'
    AND TO_DATE(CASE WHEN salesdocdate = '00000000' then null else salesdocdate end, 'YYYYMMDD') >= ?
    AND TO_DATE(CASE WHEN salesdocdate = '00000000' then null else salesdocdate end, 'YYYYMMDD') <= ?
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22
)
, ia_work_instruction as (
    select
        erp_order as do,
        container_id,
        max(case when work_group = 'Picking' then work_type end) as work_type,
        max(case when work_group = 'Picking' then user_def1 end) as zone,
        max(case when work_group = 'Picking' then date_time_stamp end) as picking_date_time_utc,
        max(case when work_group = 'Picking' then convert_timezone('UTC', 'America/New_York', date_time_stamp) end) as picking_completion_time,
        max(case when work_type = 'Parcel Loading' then date_time_stamp end) as manifest_date_time_utc,
        max(case when work_type = 'Parcel Loading' then convert_timezone('UTC', 'America/New_York', date_time_stamp) end) as manifest_date_time
    from sci.l0.ia_work_instruction
    where company in ('Ivy', 'Red', 'Vivace')
    and (work_group = 'Picking' or (work_type = 'Parcel Loading' and instruction_type = 'Header'))
    group by 1, 2
)
, ups_data as (
    select
        tracking_num,
        max(case when status_type = 'Origin' then datetime end) as origin_date,
        max(case when status_type = 'Generic' then datetime end) as processing_date,
        max(case when status_type = 'Delivery' then datetime end) as delivered_date,
        max(case when status_type = 'Delivery' then delivery_political_div1 end) as delivered_state
    from sci.l0.ups_tracking
    group by 1
)
, final as (
    select
        b.company,
        b.so_num,
        b.so_created_date,
        b.do_num,
        ls.date_time_stamp as wave_launch_date,
        ls.launch_flow,
        ia.work_type,
        ia.zone,
        ia.picking_completion_time,
        ia.manifest_date_time,
        b.leading_sts,
        b.container_id,
        b.container_status,
        b.container_type,
        b.container_status_time,
        b.tracking_number as tracking_num,
        b.manifest_id,
        b.manifest_close_time,
        ud.origin_date,
        ud.processing_date,
        ud.delivered_date,
        ud.delivered_state,
        b.billing_date,
        b.invoice_amount,
        b.cust_state,
        b.shiptoparty_key,
        b.cust_name,
        b.cust_city,
        b.cust_zipcode,
        b.wave_num,
        ls.internal_launch_num,
        b.internal_shipment_num
    from base b
    left join ia_work_instruction ia on b.do_num = ia.do and b.container_id = ia.container_id
    left join ups_data ud on b.tracking_number = ud.tracking_num
    left join sci.l0.launch_statistics ls on b.launch_num = ls.internal_launch_num
)
, do_level as (
    select
        do_num,
        count(distinct tracking_num) as tracking_cnt,
        count(distinct container_id) as container_cnt,
        count(distinct manifest_id) as manifest_cnt,
        count(distinct date_trunc('day', try_to_timestamp(delivered_date))) as delivered_date_cnt,
        max(case when tracking_num is null then 1 else 0 end) as has_null_tracking,
        max(case when tracking_num is not null and delivered_date is null then 1 else 0 end) as has_null_delivered_date
    from final
    group by do_num
)
, classified as (
    select
        b.*,
        d.tracking_cnt,
        d.container_cnt,
        d.manifest_cnt,
        d.delivered_date_cnt,
        d.has_null_tracking,
        d.has_null_delivered_date,
        case when d.has_null_tracking = 1 then 'MISSING_TRACKING'
             when d.delivered_date_cnt = 0 then 'PENDING'
             when d.delivered_date_cnt > 1 or d.has_null_delivered_date = 1 then 'SPLIT'
        else 'NOT_SPLIT'
        end as split_status
    from final b
    left join do_level d on b.do_num = d.do_num
)
, split_root_cause as (
    select
        do_num,
        count(distinct internal_launch_num) as wave_cnt,
        count(distinct date_trunc('day', wave_launch_date)) as wave_launch_time_cnt,
        count(distinct manifest_id) as manifest_cnt,
        count(distinct date_trunc('day', manifest_close_time)) as manifest_close_date_cnt,
        count(distinct zone) as zone_cnt,
        count(distinct date_trunc('day', picking_completion_time)) as picking_completion_date_cnt,
        count(distinct tracking_num) as tracking_cnt,
        case
            when count(distinct wave_num) > 1
              or count(distinct date_trunc('minute', wave_launch_date)) > 1
                then 'WAVE_LEVEL_SPLIT'
            when count(distinct manifest_id) > 1
             and count(distinct date_trunc('day', manifest_close_time)) > 1
                then 'MANIFEST_LEVEL_SPLIT'
            when count(distinct zone) > 1
             and count(distinct date_trunc('day', picking_completion_time)) > 1
                then 'ZONE_LEVEL_SPLIT'
            when count(distinct tracking_num) > 1
             and count(distinct date_trunc('day', manifest_close_time)) = 1
                then 'UPS_TRAILER_SPLIT'
            else 'UNCLASSIFIED_SPLIT'
        end as split_root_cause
    from classified
    where split_status = 'SPLIT'
    group by do_num
)
select
    c.*,
    case when c.split_status = 'SPLIT' then 'Y' else 'N' end as is_split_shipment,
    r.split_root_cause
from classified c
left join split_root_cause r on c.do_num = r.do_num
order by c.do_num, c.container_status_time;
```

**Updated 2026-05-11 (PR5a):** SQL extended from 6 CTE → 7 CTE; new
`split_root_cause` CTE adds 5-category root-cause classification on top
of Phase A's split detection. New joins: `kdb.pbi_sf.zsd_c01_billing`
(in `base` CTE — adds `billing_date` + `invoice_amount`) and
`sci.l0.launch_statistics` (in `final` CTE — adds `wave_launch_date`,
`launch_flow`, `internal_launch_num`). See **Phase B section below**
for the 5-category definitions and CASE WHEN priority.

2. Endpoint code (mirrors existing `server.js` patterns):

   ```javascript
   // ── Split Shipments (Phase 1 — page 1, Phase A: detection) ─
   // Per docs/exec-plans/active/001-snowflake-integration.md §6b
   // and docs/exec-plans/active/002-split-shipments-live.md PR3.
   // SQL is the user-verified master query — DO NOT edit in code.
   // Channel scope: BS-IVY/BS-RED/VIVACE via UPS only.
   const SPLIT_SHIPMENTS_SQL = `... (verbatim user master query from PR3 task 1) ...`;

   app.get('/api/scale/split-shipments', async (_req, res) => {
     try {
       const rows = await executeQuery(SPLIT_SHIPMENTS_SQL);
       const data = rows.map(toFactShape);
       res.json({
         success: true,
         data,
         count: data.length,
         source: 'snowflake',
         table: 'SCI.L0.SHIPMENT_HEADER + SHIPPING_CONTAINER + IA_WORK_INSTRUCTION + UPS_TRACKING + KDB.PBI_SF.SAP_CUSTOMER_MASTER + ZSDRORDR',
       });
     } catch (err) {
       console.error('split-shipments query failed:', err);
       res.status(500).json({ success: false, error: err.message });
     }
   });
   ```

3. Update the boot log block at `server.js:787-829` to include the
   new endpoint.

4. Update `toFactShape` to project the new columns: `so_num`,
   `so_created_date`, `wave_num`, `work_type`, `zone`,
   `picking_completion_time`, `manifest_date_time`, `leading_sts`,
   `container_type`, `tracking_num`, `origin_date`, `processing_date`,
   `delivered_date`, `delivered_state`, `tracking_cnt`,
   `container_cnt`, `manifest_cnt`, `delivered_date_cnt`,
   `has_null_tracking`, `has_null_delivered_date`, `split_status`,
   `is_split_shipment` — on top of the existing PR1 minimal shape.

5. EST timezone conversion is **already inside** the user master
   query (`convert_timezone('UTC', 'America/New_York', ...)` for
   `container_status_time`, `manifest_close_time`,
   `picking_completion_time`, `manifest_date_time`). No additional
   conversion in endpoint code — do not double-convert.

6. Manual smoke validation:
   - `curl http://localhost:3001/api/scale/split-shipments | jq '.data | length'` — sane count (>0, <10000).
   - First call latency < 30s (cold connection); subsequent < 5s.
   - Sample row: all 3 channels (Ivy/Red/Vivace) appear; 4 of the 5
     `split_status` values exercised in real data (SINGLE_SHIPMENT /
     SPLIT / NOT_SPLIT / PENDING — UNKNOWN may be legitimately absent
     in clean data); customer names populated for >80% of rows.

**Validation:**
- **Cross-validate against user master query in Snowflake console:**
  for the same date filter, `data.length` and `split_status`
  distribution from the endpoint match the user's direct query
  output. Any divergence is a bug — fix or escalate before PR4.
- Container rows preserved (multiple rows per `do_num` confirmed
  via grouping check in jq or DevTools).
- All 4-5 `split_status` values appear (or absence is empirically
  explained — e.g., UNKNOWN may not appear in clean data).
- `npm run build` passes.

**Depends on:** PR1 (column info from explore endpoints, including
`/api/scale/explore-ups-tracking` from PR2.5), PR2 (FactShape understood)
**Blocks:** PR4

**§7c #17 closure:** Once PR3's smoke test passes (all 3 channels
appear; IA_WI rows feed pick zone correctly), update master plan §7c
#17 from `[~]` partially-closed to `[x]` closed in a separate
`docs(plan): close §7c #17 with PR3 results` commit. Do not modify
master plan §7c #17 in this prep commit.

**PR4a update (2026-05-08, this commit):**

- **Date filter parameterized.** The `base` CTE's date predicate now
  uses two bind variables (`?`) for `from` / `to` instead of the
  full-year `YEAR(...) = year(current_date())` form. The user
  verified the new predicate in Snowflake with hardcoded dates
  (2026-05-01 ~ 2026-05-08 = 1,553 DOs).
- **Endpoint default window:** trailing 7 days (today-7d ~ today).
  Override via `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Format validation
  + `from <= to` constraint enforced server-side. SAP's
  `SALESDOCDATE` is stored as `YYYYMMDD` (VARCHAR), but the SQL
  handles the conversion via `TO_DATE(col, 'YYYYMMDD')` on the LHS.
  The bind RHS must be `YYYY-MM-DD` (Snowflake auto-DATE-cast
  format) — see schema doc § Verified facts — Date handling.
  **PR4a hotfix:** original 4f105f0 stripped dashes before binding,
  which silently returned 0 rows. Fixed by binding `YYYY-MM-DD`
  directly.
- **Channel mapping.** `toFactShape` now translates the sales-org
  code via `COMPANY_NAME_MAP` (1100→BS-IVY, 1400→BS-RED, 1900→VIVACE)
  on the `channel` field. Raw code preserved as new `channel_code`
  field for ops debugging. Closes the PR4 caveat noted in the §7c
  #17 closure (master plan).
- **Smoke (user, 2026-05-01 ~ 2026-05-08, 1,553 DOs):** distribution
  shifts in short windows — SINGLE_SHIPMENT 32.8%, PENDING 32.1%,
  SPLIT 22.7%, NOT_SPLIT 12.3%. PENDING is high (32%) because
  short-window orders are still in flight. PR4b (frontend) will
  apply rate calc that excludes PENDING from the denominator
  ("settled split rate").

---

### PR4 — SplitShipmentPage live wiring

**PR4 split into 2 sub-PRs (2026-05-08 discovery):**

After pre-flight discovery, `src/ShippingSLAApp.jsx` confirmed at 6,486
lines (not 2,772 as README/tech-debt-tracker stated). PR4 scope is
~215 lines across hook + adapter + page + UI. Split for safer review
and revert:

- **PR4b1 (this commit):** `useSplitShipments` hook upgrade +
  `serverRowsToShipments` adapter + `.env` `VITE_DATA_SOURCE=live`.
  No UI changes — `SplitShipmentPage` still consumes mock-shape data,
  but in `live` mode that shape now comes from the adapter.
  Validation: `console.log` of hook output for live + mock modes.

- **PR4b2 (next commit):** `SplitShipmentPage` live wiring; KPI N/A
  handling for the 3 mock-only fields (`splitGapDays`, `chargeback`,
  `tier`); custom date picker; channel-scope inline hint;
  mock-fallback banner. Visual validation in browser.

**PR4b2 completion (2026-05-11, this commit):**

`SplitShipmentPage` now consumes `useSplitShipments` directly. Live data
flows master query → endpoint → adapter → page. Mock fallback path
preserved. UI changes:

- **Header date selector:** 7d / 30d / 90d / Custom buttons replace the
  prior 5-option `<select>`. Custom shows two `<input type="date">`
  inputs (theme-aware via `colorScheme`).
- **Default range:** `7d` (was `90d`) — keeps initial Snowflake payload
  small (~6 MB for 1 week) and matches the hook's `presetToDateRange`
  default.
- **`customRange` state** added next to `dateRange`; the hook re-fetches
  whenever either changes (custom uses `JSON.stringify` dep-stability).
- **KPI cards (6 instead of 5):**
  - "Split Rate" = SPLIT / (SPLIT + NOT_SPLIT + SINGLE_SHIPMENT)
    — PENDING / UNKNOWN excluded per user decision (settled basis,
    stable over short windows).
  - "Orders Split" same denominator (settled count, was total count).
  - **NEW:** "In Transit" surfaces PENDING% with absolute count, so
    short-window noise is visible without polluting the settled rate.
  - "Avg Gap" / "Chargebacks" / "Key Acct Impact" render `N/A` with
    "Not available in live data" subtitle when `source === 'live'`
    (the three fields the PR3 SQL doesn't compute).
- **Header badge:** new `LIVE` / `MOCK` / `MOCK-FALLBACK` chip reflects
  the hook's `source`. Visible only when `activePage === 'split'` since
  the hook only runs on that page. The existing `dataSource` toggle
  button (left intact) is independent — it reflects user choice, not
  the actual hook source.
- **Mock-fallback banner:** prominent red banner when server unreachable;
  surfaces error message and points users to `node server.js`.
- **Channel chips:** all 11 chips kept. Inline hint below the chips
  ("Live mode: page is server-scoped to BS-IVY / BS-RED / VIVACE only")
  appears only on the Split page in live mode.
- **BS-RED 0-count handling:** in live mode the page synthesizes empty
  cards for BS-IVY/BS-RED/VIVACE so BS-RED appears even when the
  short-window query returns zero rows. Empty cards render at 40%
  opacity with `─` + "0 orders" text instead of "0.0%".
- **Channel-card grid:** `lg:grid-cols-3` in live mode (3 channels)
  vs `lg:grid-cols-11` in mock (11 channels) — tighter layout per
  source.
- **Mock generator format alignment:** all `'BS - IVY'` / `'BS - RED'`
  references renamed to `'BS-IVY'` / `'BS-RED'` (matches server's
  `COMPANY_NAME_MAP`). `CHANNELS` array, `channelWeights` in the
  generator, event mocks, admin role channels, DataHub mock tables,
  and the dead `ch.replace('BS - ', 'BS-')` display call all updated.
  `grep "BS - " src/ShippingSLAApp.jsx` returns 0.
- **Container row null-safety:** the page normalizes live container
  rows (`container_id` → `containerId`, `container_status` → mapped
  UPS-style status via new `mapScaleStatusToUps`, `container_status_time`
  → `shipDate` as Date, etc.) so the existing drill-down JSX renders
  without per-cell null checks. `expectedDelivery` / `weight` / `items`
  / `lastLocation` stay null (sourced in PR6) and render as `—`.
- **Hook source lifted via callback:** `SplitShipmentPage` calls
  `onSourceChange(source)` on every source change so the parent's
  header badge + channel-chip hint can react. State cleared on unmount.

Trust hierarchy enforced: live data flows master query → endpoint →
adapter → page. Mock-only fields are explicitly N/A in live mode (no
synthetic values). Cross-validation against direct Snowflake query
pending in browser smoke (next step).

**Outstanding for PR5 / Phase B:**
- `splitReason` shows "TBD (Phase B)" in live mode (root-cause
  classification deferred per PR3 scope update).
- `splitGapDays`, `chargeback`, `tier`, `shift`, `orderValue` — null
  in live mode. Long-term plan tracked in §7 open question D.

PR4 complete. Phase 1 page 1 (split shipments) renders live data when
`VITE_DATA_SOURCE=live` and falls back to mock on server unreachable.

**PR4b3 UX refinement (2026-05-11, this commit):**

Post-PR4b2 user review on the running dashboard surfaced two issues:

1. The right-side filter-bar text still read `320 / 320 shipments · Apr
   1–17, 2026` on the Split page — mock-data residue that the new live
   wiring did not touch. Users expected to see the *actual* number of
   DOs and the *actual* date window the page was rendering.
2. The 7d/30d/90d/Custom buttons in the red header bar were the primary
   action surface in PR4b2 but felt visually heavy. Users wanted the
   date range edited at the summary text itself, with the buttons
   demoted to a secondary "current range" indicator.

Changes (UI-only, no data-flow changes):

- **Header summary dropdown (Split page only):** the gray filter-bar
  text is replaced with a clickable button that reads, e.g.,
  `📅 Last 7 days · 1,501 DOs · May 4 – May 11`. Click opens a
  dropdown with 4 preset rows (7d / 30d / 90d / Custom) plus inline
  From/To inputs + Apply button when Custom is active. Click-outside
  closes; the dropdown also auto-closes when leaving the Split page.
- **Red-bar preset buttons demoted:** kept as a compact at-a-glance
  indicator at `opacity-50` (full opacity on hover). They are still
  clickable as a keyboard-/mouse-friendly shortcut, but the primary
  click target is now the summary button. Inline Custom date inputs
  removed from the red bar — they live only in the dropdown now to
  avoid two competing input surfaces.
- **`splitMeta` state replaces `splitSource`:** lifted state now
  carries `{ source, count, filter }` so both the badge AND the new
  summary button can read from one source-of-truth snapshot reported
  by `SplitShipmentPage`'s `onMetaChange` callback. Cleared on
  unmount and on page change.
- **`formatShortDate` helper:** parses `YYYY-MM-DD` string manually
  (regex + `MONTH_ABBR` table) to avoid `new Date('2026-05-04')`
  reading the string as UTC midnight and rolling back a day in
  negative-offset timezones.
- **`PRESET_LABELS` table:** single source of truth for the
  human-readable preset names, shared between the summary button and
  the dropdown rows.
- **Other pages unchanged on purpose:** the existing
  `320 / 320 shipments · Apr 1–17, 2026` text remains on non-Split
  pages until those pages get their own live wiring.

No changes to `useSplitShipments`, `serverRowsToShipments`, the server
endpoint, the mock generator, or the channel-chip filter logic — PR4b3
is a pure UI re-arrangement.

**PR4b4 reorder + channel card redesign (2026-05-11, this commit):**

User compared with reference dashboard
(https://kdc-operations-intelligence.vercel.app/) and requested two
visual changes on the Split page:

1. **Section order:** Distribution Channel + Container Tracking now
   appear *before* the Customer + Root Cause grid. New order is
   `Channel → Container Tracking → Customer + Root Cause`.
   Rationale: channel is the first triage layer ("which channel is
   hurting"), then container drill-down ("which orders"), then the
   deeper attribution (customer + cause).

2. **Distribution Channel card redesign** (light-mode-first to match
   the reference):
   - Background: `var(--bg-panel)` → white (`#ffffff`) in light mode,
     dark panel in dark mode (theme-aware via CSS vars set on `:root`,
     so SplitShipmentPage doesn't need a `theme` prop).
   - Border: channel color by `splitRate` threshold —
     `#E74C6F` (pink, >20%), `#f5a623` (amber, 10-20%), `#2ECC71`
     (green, <10%). Empty cards use `var(--border)`.
   - Big headline %: same channel color as the border.
   - Subtitle ("split/total" or "0 orders"): `var(--text-muted)`.
   - Progress bar: channel-color fill on a `var(--border)` track.
     Slight `box-shadow` lift on populated cards; none when empty.
   - Empty state (BS-RED 0 orders in a short window): `opacity-40`
     + `─` glyph + neutral border, so the card reads as "no data
     this window" instead of "0% violation".
   - Padding bumped from `p-2` → `p-3`, corners from `rounded` →
     `rounded-lg`, headline from `text-sm` → `text-lg` for the
     reference's airier feel.

No data-flow changes — same `splitData.channelList` calculation, same
`isLive` switch, same `lg:grid-cols-3` (live) vs `lg:grid-cols-11`
(mock) layout, same channel-chip filter. PR4b4 is layout + style only.

**PR4b5 channel chips conditional + hint removal (2026-05-11, this commit):**

Post-PR4b4 user review surfaced a UX papercut: 8 of the 11 global chips
(CS-Bulk, CS-DSDC, AST, IIO, KIO, ECOM-AMAZON 1P, ECOM-AMAZON 3P,
ECOM-DTC) produce no rows on the Split page in live mode because the
server-side scope is fixed to BS-IVY / BS-RED / VIVACE via UPS (002
plan §6b). Clicking them on the Split page is a dead end.

User explicitly raised the right concern: the chips bar is global, so
trimming it unconditionally would break Geo / FlightBoard / other pages
that still expect all 11 channels to render against mock data.

**Resolution — option E (page + source conditional):**

```javascript
const LIVE_SPLIT_CHANNELS = ['BS-IVY', 'BS-RED', 'VIVACE'];

// In the global filter-bar chip loop:
(activePage === 'split' && splitSource === 'live'
  ? LIVE_SPLIT_CHANNELS
  : CHANNELS
).map(ch => …)
```

Behavior table:

| Scenario                              | Chips shown |
|---------------------------------------|-------------|
| Split page + live source              | 3           |
| Split page + mock                     | 11          |
| Split page + mock-fallback            | 11          |
| Geo / FlightBoard / any other page    | 11          |

Multi-layer safety so the 3-chip mode can never get stuck:

- **`activePage` check** — leaving Split immediately restores 11 chips.
- **`splitSource` check** — mock or mock-fallback never trigger the
  3-chip subset, so a server outage doesn't hide chips.
- **PR4b2 unmount cleanup** — `onMetaChange(null)` on
  `SplitShipmentPage` unmount nullifies `splitMeta`, which makes
  `splitSource === 'live'` false on stale renders. Three independent
  conditions all have to hold to show 3 chips; only one has to fail
  to restore 11.

The PR4b2 inline hint
("ⓘ Live mode: Split Shipments page is server-scoped to
BS-IVY / BS-RED / VIVACE only.") is removed — the chip set itself now
communicates the scope, so the hint became redundant.

`selectedChannels` state is untouched. A user's BS-IVY pick on the
Split page survives a navigation to Geo (which shows 11 chips again),
and the picked filter applies to the Geo data — that's the existing
global-filter semantic, preserved on purpose.

No changes to `useSplitShipments`, the adapter, server.js, the mock
generator, or any other page. The only other `CHANNELS.map(…)` call
sites (Admin SLA page, AI Risk page, etc.) remain unaffected.

**PR4b6 header buttons removal (2026-05-11, this commit):**

PR4b3 demoted the header's `[7D][30D][90D][Custom]` buttons to 50%
opacity secondary indicators with the rationale "keep the Custom date
picker available." But PR4b3's gray-bar dropdown *already* includes the
Custom range option plus inline From/To inputs — the header strip was
genuinely redundant. User reviewing the running dashboard caught it.

**Resolution — option 1 (complete removal):**

- Deleted the `<div className="hidden md:flex … opacity-50 …">` block
  (~25 lines) that wrapped the four preset buttons.
- All other header items untouched: LIVE/MOCK badge, data-source toggle,
  refresh timestamp, theme toggle, Upload CSV, user badge, sign-out.

**State preserved:**

- `dateRange` (`useState('7d')`) and `customRange` (`useState({})`) live
  on — the gray-bar dropdown still consumes them.
- `setDateRange` / `setCustomRange` calls inside the dropdown rows and
  Custom From/To inputs continue working unchanged.

**Safe for other pages:** Geo / FlightBoard / Costs / etc. still use
mock data and never read `dateRange`, so removing the header buttons
changes nothing for them visually or functionally. Future live-wiring
PRs for those pages can mount their own dropdowns following PR4b3's
pattern.

Pure visual cleanup — no data flow, no hook, no adapter changes.

**Field-shape gap (resolved by PR4b1 adapter):** server returns flat
per-container rows (`do_num`, `container_id`, `tracking_num`,
`is_split_shipment`, `split_status`, `channel`, `channel_code`, …),
mock-shape expects orders with `containers[]` nested. The adapter
groups by `do_num` and synthesizes mock-only fields as `null`.



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

## Phase B — Root Cause Classification

**Status:** In progress (PR5a + PR5b)

User added `split_root_cause` CTE to the master query (2026-05-11)
classifying each SPLIT DO into one of 5 categories:

| Category               | Condition                                                                  |
|------------------------|----------------------------------------------------------------------------|
| WAVE_LEVEL_SPLIT       | `count(distinct wave_num) > 1` OR multiple wave_launch minutes             |
| MANIFEST_LEVEL_SPLIT   | `manifest_cnt > 1` AND multiple manifest_close days                        |
| ZONE_LEVEL_SPLIT       | `zone_cnt > 1` AND multiple picking_completion days                        |
| UPS_TRAILER_SPLIT      | `tracking_cnt > 1` AND single manifest_close day                           |
| UNCLASSIFIED_SPLIT     | (else) — none of the above match                                           |

**CASE WHEN priority (top to bottom):** wave > manifest > zone > UPS
trailer > unclassified. A single SPLIT can satisfy multiple conditions;
only the first match wins.

**Operational meaning:**

- **WAVE_LEVEL_SPLIT:** split started at wave planning — the SO's
  containers were launched on different waves entirely.
- **MANIFEST_LEVEL_SPLIT:** split at outbound — genuinely different
  trucks on different manifest-close days.
- **ZONE_LEVEL_SPLIT:** split in picking — different warehouse zones
  picked on different days.
- **UPS_TRAILER_SPLIT:** split during UPS transit — KDC sent everything
  together on a single manifest-close day, but UPS separated it.
  **NOT KDC's fault** — UPS routing artifact.
- **UNCLASSIFIED_SPLIT:** data ambiguity or edge case requiring
  individual investigation.

**Why this matters:** operations needs to know *why* a split happened,
not just *that* it happened. Each category points to a different
process owner.

### Master query (updated 2026-05-11) — byte-exact

The complete 7-CTE master query is in PR3 task 1 above (which has been
updated in-place as part of PR5a). Trust hierarchy preserved:

1. User operational fact: the 5 root-cause categories + CASE WHEN priority
2. User master query → PR3 plan SQL block (byte-exact paste)
3. Plan SQL → `server.js` `SPLIT_SHIPMENTS_SQL` (byte-exact paste)
4. Endpoint response → `split_root_cause` column flowing through `toFactShape`

Hardcoded test dates (`'2026-05-01'` / `'2026-05-13'`) from user's
master-query draft were restored to `?` bind in both plan and
`server.js` — consistent with PR3 / PR4a date-range semantics.

### PR5a — Backend wiring (split_root_cause CTE + endpoint surface)

**Goal:** Wire Phase B's root-cause classification through the existing
`/api/scale/split-shipments` endpoint without touching UI / adapter /
mock / hook layers (those land in PR5b).

**Files modified:**
- `docs/exec-plans/active/002-split-shipments-live.md` — Phase B
  section + PR3 master query updated in place
- `server.js` — `SPLIT_SHIPMENTS_SQL` byte-exact paste; `toFactShape`
  extended with 6 new columns

**Specific tasks:**

1. Replace the master query SQL block in PR3 task 1 with the new
   7-CTE version. `?` bind retained for date range (no hardcoded dates).
2. Byte-exact paste the new SQL into `server.js`
   `SPLIT_SHIPMENTS_SQL` template literal.
3. Extend `toFactShape` to project the 6 new columns:
   - `wave_launch_date`, `launch_flow`, `internal_launch_num`
     (from `launch_statistics` join)
   - `billing_date`, `invoice_amount` (from `zsd_c01_billing` join)
   - `split_root_cause` (from `split_root_cause` CTE — only populated
     when `split_status = 'SPLIT'`)
4. Restart `node server.js` (background task). Smoke-test the endpoint
   with the same window that produced Phase A's ~313 SPLIT DOs.
5. Verify the 5 root-cause categories all appear in the response and
   the SPLIT DO total is unchanged (Phase B does not change the SPLIT
   detection logic; only adds classification).

**Validation:**

- `curl http://localhost:3001/api/scale/split-shipments?from=2026-05-04&to=2026-05-11`
  returns successfully (< 30s cold, < 5s warm).
- `Object.keys(rows[0])` includes `split_root_cause`, `wave_launch_date`,
  `launch_flow`, `internal_launch_num`, `billing_date`, `invoice_amount`.
- Total SPLIT DOs ≈ 313 (Phase A baseline). A drift here would mean the
  new joins (billing / launch_statistics) altered base CTE row counts —
  requires user review of the `group by 1..22` change.
- All 5 categories represented in the distribution (`WAVE_LEVEL_SPLIT`,
  `MANIFEST_LEVEL_SPLIT`, `ZONE_LEVEL_SPLIT`, `UPS_TRAILER_SPLIT`,
  `UNCLASSIFIED_SPLIT`).

**Out of scope for PR5a (lands in PR5b):**
- `serverRowsToShipments` adapter changes
- `useSplitShipments` hook changes
- Mock generator updates
- `SplitShipmentPage` UI — "Root Causes of Splits" section will be
  rewired to display the 5 Phase B categories instead of mock's 5 reasons
- Channel-card / table label changes

**Depends on:** PR3, PR4 (Phase A wiring stable on the live page)
**Blocks:** PR5b

### Phase B smoke test findings (2026-05-12)

3-window comparison confirms classifier behavior and reveals operational
insights for PR5b UI design.

**Window comparison:**

| Window      | DOs   | SPLIT | PENDING% | Settled SPLIT% | Top cause            |
|-------------|-------|-------|----------|----------------|----------------------|
| 8d recent   | 1,927 |   382 |   36.2%  |     31.1%      | MANIFEST_LEVEL (77%) |
| 13d range   | 2,300 |   535 |   31.3%  |     33.8%      | MANIFEST_LEVEL (62%) |
| 30d mature  | 6,662 | 2,713 |    0.4%  |     40.9%      | UPS_TRAILER (65%)    |

**Data maturation pattern:**

- `PENDING%` collapses as the window ages (36% → 0.4% at 30 days).
- Settled-basis `SPLIT%` climbs as `PENDING` resolves (31% → 41%).
- Recent windows under-count splits — many `PENDING` rows resolve to
  `SPLIT` later, as UPS delivery scans arrive.
- The PR4 baseline (~313 `SPLIT` DOs for 5/4-5/11) was captured days
  earlier when more DOs were `PENDING`; today's 382 for the same window
  is normal maturation, not a SQL bug.

**Operational findings from the 30-day mature window:**

| Category             | Count | %      | KDC operations stage          |
|----------------------|-------|--------|-------------------------------|
| UPS_TRAILER_SPLIT    | 1,768 | 65.2%  | Outbound (trailer loading)    |
| MANIFEST_LEVEL_SPLIT |   819 | 30.2%  | Outbound (manifest building)  |
| ZONE_LEVEL_SPLIT     |   123 |  4.5%  | Warehouse (picking)           |
| WAVE_LEVEL_SPLIT     |     3 |  0.1%  | Upstream (wave planning)      |
| UNCLASSIFIED_SPLIT   |     0 |  0.0%  | —                             |

**All 5 categories are KDC-owned.** `UPS_TRAILER_SPLIT` is named after
the *condition* (same manifest-close day, different `tracking_num`) but
represents **KDC's outbound trailer-loading decision** — cartons that
should have been loaded onto the same trailer for the same SO were split
into different packages. UPS sees them as separate parcels, but the
decision was KDC's. The "UPS_TRAILER" name describes the symptom (UPS
later delivers on different days), not the owner. All splits are
something KDC can investigate, fix, or prevent.

**Key takeaways for PR5b UI:**

- **Outbound stage dominates** at steady state (~95% of splits at 30-day
  maturity): manifest building + trailer loading decisions. Both are
  KDC outbound process. Warehouse picking (zone) is a small contributor.
- **Recent vs. mature pattern shift:** at 8 days `MANIFEST_LEVEL` appears
  dominant (77%); at 30 days `UPS_TRAILER` overtakes (65%).
  `UPS_TRAILER` splits emerge later because their classification depends
  on multiple delivery scans landing on different days from the same
  manifest. Worth a "data still maturing" hint on short windows so
  operations doesn't conclude "manifest is the main problem" from
  short-window data alone.
- **`WAVE_LEVEL` is rare** (0.1% at 30 days): wave planning rarely
  produces same-DO splits. Either operationally clean, or the detection
  condition is too strict — worth a future review with operations.
- **`UNCLASSIFIED` = 0 across all windows:** the 5-category framework
  covers every real split. No "other" bucket needed.

**Future PR5b UI direction:** group by KDC operations stage (outbound /
warehouse / upstream) rather than the raw SQL category names alone, so
the "who fixes this" mapping is immediate for operations users.

### PR5b — Frontend wiring (completed 2026-05-12)

PR5b ships in this commit. Surfaces `split_root_cause` through the
adapter into the "Root Causes of Splits" section UI. Container Tracking
table's ROOT CAUSE column is deferred to PR5c (immediately after this
PR — same `splitReason` field, different render site).

**User UI decisions (recorded for traceability):**

1. **Display:** simple list sorted by count desc; no KDC-operations-stage
   grouping (despite the Phase B findings note suggesting it could be
   useful — kept the simpler list for first cut, can re-evaluate after
   ops feedback).
2. **Container Tracking ROOT CAUSE column:** deferred to PR5c (immediately
   after this PR).
3. **Mock generator:** updated to the 5 SQL categories so mock-fallback
   path renders the same UI as live.
4. **Label style:** "X split" pattern — `Manifest split` /
   `Trailer load split` / `Zone split` / `Wave split` / `Other split`.

**Files modified:**
- `src/ShippingSLAApp.jsx`
- This sub-plan file (this section)

**Changes:**

- **`ROOT_CAUSE_LABELS` + `ROOT_CAUSE_ORDER` constants** added near
  `CHANNELS` (line ~40). `LABELS` is the SQL-category → friendly-label
  map; `ORDER` is the stable iteration order for empty-state consistency
  (the renderer still sorts by count desc, but ORDER makes the empty
  rows stable across windows).
- **Mock generator (line ~168):** the 5 mock reasons
  (`'Short pick - partial inventory'`, `'Wave cutoff missed'`,
  `'Trailer capacity'`, `'Pick exception'`, `'SAP-SCALE variance'`) replaced
  with a weighted array of the 5 SQL categories. Distribution loosely
  mirrors the live 8-day window (MANIFEST 77%, UPS_TRAILER 16%, ZONE 6%,
  WAVE 1%; UNCLASSIFIED intentionally absent in mock since live shows 0%).
- **Adapter (`serverRowsToShipments`, line ~1292):** `splitReason: null`
  → `splitReason: doRow.split_root_cause`. For non-SPLIT rows the value
  remains null (the CTE only populates `split_root_cause` when
  `split_status = 'SPLIT'`), preserving existing null-check semantics.
- **"Root Causes of Splits" section (line ~1870):** rewritten from the
  mock `reasonList` iteration (which carried hardcoded explanatory text
  per mock-reason name) to a simple 5-row list. Each row: friendly label
  + progress bar + `count · pct`. Rows sorted by count desc. Empty
  categories (e.g. `Wave split` with 0 splits in short windows) render
  at 40% opacity instead of disappearing. Bar color is a soft
  green/amber/red ramp keyed off the percentage.

**Validation:**

- `npm run build` passes.
- Browser smoke against live (`VITE_DATA_SOURCE=live`) on the 8-day
  window: 5 rows render with friendly labels; `Manifest split` at the
  top (~77%); `Wave split` and `Other split` render at 40% opacity (0%).
- Mock fallback path (`VITE_DATA_SOURCE=mock` or server stopped): same 5
  rows from the weighted mock generator. UI is symmetric across modes.

**Not in scope (PR5c — next):**

- Container Tracking table's ROOT CAUSE column (`src/ShippingSLAApp.jsx`
  line ~1756) still renders `o.splitReason || (isLive ? 'TBD (Phase B)' : '—')`.
  In live mode that now shows the SQL category names (because
  `o.splitReason` is no longer null), but the friendly-label transform is
  not yet applied — PR5c wires `ROOT_CAUSE_LABELS[o.splitReason]` at that
  render site.

**Trust hierarchy preserved:**
- Server: `split_root_cause` (PR5a)
- Adapter: `splitReason` ← `doRow.split_root_cause`
- UI: `ROOT_CAUSE_LABELS` lookup
- Mock fallback: same 5 SQL categories via the weighted mock generator

**No changes to:** `useSplitShipments` hook, other pages, `server.js`,
master plan 001.

**Depends on:** PR5a
**Blocks:** PR5 (operations validation now covers Phase B categories too)

### PR5c — Friendly label consistency + Container Tracking column (completed 2026-05-12)

PR5b shipped with the "X split" label pattern (`Manifest split` /
`Trailer load split` / `Zone split` / `Wave split` / `Other split`). User
reviewed the running dashboard and requested two refinements:

1. **Label naming consistency** — switch to Title Case mirroring the SQL
   category names: `MANIFEST_LEVEL_SPLIT` → `Manifest Level Split`,
   etc. Reasoning: 1:1 mapping with SQL names, easier debugging, no
   name-translation gap between SQL / adapter / UI / docs. A developer
   can grep any of the four representations and find the same concept.

2. **Container Tracking column** — same friendly labels at that render
   site. After PR5b, the adapter had begun populating `splitReason`, so
   the column was rendering the raw SQL category name (e.g.
   `MANIFEST_LEVEL_SPLIT`) instead of the previous `TBD (Phase B)`
   fallback. PR5c routes that render through `ROOT_CAUSE_LABELS` and
   removes the obsolete `TBD (Phase B)` fallback.

**Changes:**

- `ROOT_CAUSE_LABELS` values updated (5 entries) and comment notes the
  Title Case convention.
  - `MANIFEST_LEVEL_SPLIT`: `Manifest split` → `Manifest Level Split`
  - `UPS_TRAILER_SPLIT`: `Trailer load split` → `UPS Trailer Split`
  - `ZONE_LEVEL_SPLIT`: `Zone split` → `Zone Level Split`
  - `WAVE_LEVEL_SPLIT`: `Wave split` → `Wave Level Split`
  - `UNCLASSIFIED_SPLIT`: `Other split` → `Unclassified Split`
- Container Tracking ROOT CAUSE column render (one line in
  `src/ShippingSLAApp.jsx`):
  - Before: `{o.splitReason || (isLive ? 'TBD (Phase B)' : '—')}`
  - After:  `{o.splitReason ? (ROOT_CAUSE_LABELS[o.splitReason] || o.splitReason) : '—'}`
  - `TBD (Phase B)` fallback removed (Phase B complete).

**Trust hierarchy now end-to-end consistent:**

| Layer          | Representation                              |
|----------------|----------------------------------------------|
| SQL category   | `MANIFEST_LEVEL_SPLIT`                       |
| Adapter field  | `splitReason: 'MANIFEST_LEVEL_SPLIT'`        |
| UI label       | `Manifest Level Split`                       |
| Docs           | Same naming throughout                       |

**Phase B end-to-end (PR5a + PR5b + PR5c) complete:**

- Server: `split_root_cause` CTE in master query (PR5a)
- Adapter: `splitReason ← doRow.split_root_cause` (PR5b)
- UI surface 1: "Root Causes of Splits" section (PR5b)
- UI surface 2: Container Tracking ROOT CAUSE column (PR5c)

No further Phase B work — operations team can now see both per-DO root
cause (Container Tracking table, one row per shipment) and aggregate
distribution (Root Causes section, summary by category).

**No data flow changes** in PR5c — pure label/render refinement.

**Depends on:** PR5b
**Blocks:** Nothing further; Phase B end-to-end now sits on top of the
Phase A foundation and feeds into the existing PR5 operations validation.

---

### PR6 — Customer ranking YTD top 10 (completed 2026-05-12)

User reviewed the PR5c running dashboard and identified that the
"Split Rate by Customer" section was showing all customers at 100%
split rate (1/1) in the 7-day window — statistical noise, not signal.
The section needed a stable, sample-large window so operations could
identify "who is most affected by splits this year" as an actionable
list.

**Why:**

| Window           | Per-customer sample | Signal |
|------------------|---------------------|--------|
| 7d (main window) | ~1 order            | 100% (1/1) — noise |
| YTD              | ~hundreds of orders | top-10 absolute split count — actionable |

**Architecture:**

The Customer ranking section uses a **separate `useSplitShipments` hook
call** with the new `'ytd'` preset, independent from the page's main
`dateRange`. All other sections (KPI, Channel, Container Tracking,
Root Causes) continue using the main `dateRange`.

```javascript
const mainSplitData = useSplitShipments(dateRange, customRange);  // 7d / 30d / 90d / custom
const ytdSplitData  = useSplitShipments('ytd');                   // Jan 1 of current year → today
```

The two calls fire in **parallel** on mount (each instance of the hook
manages its own `useState` / `useEffect` / cancellation). The page's
existing global loading gate (`if (hookLoading) return ...`) waits only
on the main call, so:

1. Page mounts → both fetches start
2. Main fetch returns (~1-2s, 7d payload ~8k rows) → page renders all
   sections with main data; Customer section shows "Loading YTD data…"
3. YTD fetch returns (~4-5s, ~24k DOs / ~30 MB) → Customer section
   populates with the top 10

No hook-internal changes — PR4b1's `(dateRange, customRange)` signature
handles this design natively.

**Changes:**

- `presetToDateRange` helper: new `'ytd'` branch returning
  `{ from: 'YYYY-01-01', to: today }` (uses `formatDateLocal` to avoid
  the UTC timezone shift PR4b1 already documented).
- `SplitShipmentPage` body: second `useSplitShipments('ytd')` call
  added; existing main hook call untouched.
- New `ytdCustomerList` `useMemo` computed off `ytdHookData`:
  groups by customer, sums splits and totals, filters to customers
  with `splits > 0`, sorts by split count desc, slices top 10,
  attaches `splitRate` as supplementary info.
- "Split Rate by Customer" section JSX (single section, ~22 lines):
  - Subtitle: `Sorted highest violation` → `Year to date · Top 10 by split count` (with `· Loading…` suffix while YTD fetch is in flight).
  - Tag: `VIOLATION LIST` → `YTD`.
  - Data source: `splitData.customerList` → `ytdCustomerList`.
  - Bar scale: was rate-relative (`splitRate × 4`, capped at 100%); now count-relative to the top entry (`splits / maxSplits × 100`) so the #1 customer fills the bar and the rest scale proportionally. Color thresholds unchanged (red >25%, amber >10%, green otherwise — still rate-based, used to flag customers whose share of orders that split is high even if absolute count isn't #1).
  - Right-aligned numeric: `{split}/{total}` → `{splits} · {pct}` (count primary, rate secondary).
  - Loading state: explicit `"Loading YTD data…"` while `ytdLoading`.
  - Empty state: `"No split data in YTD window."` if zero customers have any splits in YTD.

**Preserved on the page** (no change):

- `splitData.customerList` still computed off `pageData` (main dateRange)
  — used by the "Key Acct Impact" KPI at the top of the page.
- All other section data sources unchanged.

**Trade-offs and backlog:**

- YTD response is ~30 MB / 4-5s. Acceptable as a one-time page-load cost
  but worth caching at hook level if a user navigates away and back.
  Backlog item: hook-level cache keyed by `(dateRange, customKey)` —
  trivial extension, deferred to keep this PR focused.
- Browser memory: keeping both 7d (~8k rows) and YTD (~24k DOs ≈ 6 MB
  in adapted shape) in memory simultaneously is well within budget.
- Mock mode: each `useSplitShipments` call generates its own
  `generateMockShipments()` dataset, so the main section and YTD section
  see slightly different random mock data. Acceptable in mock mode;
  invisible in live mode (which is the real use case).

**Validation:**

- `npm run build` passes.
- Browser smoke (`VITE_DATA_SOURCE=live`):
  - Page renders KPI / Channel / Root Causes / Container Tracking
    immediately from the main fetch.
  - Customer ranking section shows "Loading YTD data…" for ~4-5s.
  - Then top 10 customers populate, sorted by split count desc (large
    absolute numbers, e.g. hundreds of splits per top-tier customer).
- Browser smoke (mock fallback): same UI, mock-generated YTD customers.

**No changes to:** `server.js`, `useSplitShipments` hook internals,
mock generator, adapter, other pages, master plan 001.

**Depends on:** PR4b1 (hook with `(dateRange, customRange)` signature)
**Blocks:** Nothing further. Note: there is also an existing
`### PR6 (conditional) — Drill-down columns + performance tuning`
later in this file; that section is conditional and not yet shipped,
so the numbering collision is acknowledged but not auto-renamed in
this PR. Renumber to `PR7 (conditional)` in a follow-up doc-cleanup
commit if/when it becomes relevant.

---

### PR7a — SPLIT GAP + VALUE columns on DO row (completed 2026-05-12)

User reviewed the PR6 dashboard and identified that the Container
Tracking — Split Orders table was still rendering `—` for both
`SPLIT GAP` and `VALUE` columns even though the underlying data
(`delivered_date` and `invoice_amount`) has been flowing since PR5a.

This is the first of three PR7 commits — PR7a wires the **DO-row**
SPLIT GAP and VALUE; PR7b will handle per-container drill-down (delivered
date + `OK / SPLIT DAY` indicator inside the expand row); PR7c adds the
bottom Split Delivery Alert banner.

**Definitions (from user sample):**

- **`SPLIT GAP`** = `max(delivered_date) − min(delivered_date)` across
  the DO's distinct tracking_nums, in whole days. Any tracking still
  PENDING delivery → `null` (UI renders `—`).
- **`VALUE`** = `sum(invoice_amount)` over distinct billing dates per DO.
  Billing is LEFT JOIN (PR5a), so DOs without any billing row → `null`
  (UI renders `—`).

**Where it lives:**

`serverRowsToShipments` is already the DO-level aggregator — it groups
rows by `do_num` and exposes the `containers` array. PR7a converts the
existing arrow-returns-object map into a block body and computes both
values from that `containers` closure, in the same pass.

```javascript
// SPLIT GAP — per distinct tracking_num
const trackingDelivered = new Map();
for (const c of containers) {
  if (!c.tracking_num) continue;
  if (!trackingDelivered.has(c.tracking_num)) {
    trackingDelivered.set(c.tracking_num, c.delivered_date || null);
  }
}
// If any tracking is null → splitGapDays = null; else max-min in days

// VALUE — per distinct billing_date (de-dupe across container fan-out)
const billingByDate = new Map();
for (const c of containers) {
  if (c.billing_date && c.invoice_amount != null) {
    billingByDate.set(c.billing_date, Number(c.invoice_amount));
  }
}
// Sum the deduped invoice_amounts
```

**Why the dedupe matters for VALUE:**

PR5a's master query GROUPs `base` by `1..22` which includes
`billing_date`, so the server response has one row per
`(container_id × billing_date)` pair. The billing join is at SO level
(`sh.user_def4 = b."Sales_document"`), so the same `billing_date`
carries the **same** `NET($)` value across every container row in
the DO that fans out from it. Naively summing every row's
`invoice_amount` would multiply the true total by the container count.
The dedupe-by-billing-date Map collapses each unique billing
date to a single contribution.

**SPLIT GAP edge cases:**

| DO state                                  | trackingDelivered | result          |
|-------------------------------------------|--------------------|-----------------|
| All tracking_nums delivered, single date  | size N, all set    | `0` (renders `0d`) |
| All tracking_nums delivered, multiple     | size N, all set    | `max − min` in days |
| Some tracking_num pending                 | size N, some null  | `null` (renders `—`) |
| No tracking_nums (PENDING DO)             | size 0             | `null` (renders `—`) |

The `0d` rendering for NOT_SPLIT and SINGLE_SHIPMENT DOs is intentional —
zero is a meaningful answer ("delivered same day"). If user prefers `—`
for those, that's a one-line `splitGapDays || null` tweak in a future PR.

**Changes:**

- `serverRowsToShipments` (line ~1295): arrow-returns-object map →
  block body. Computes `splitGapDays` and `orderValue` from the
  `containers` closure; previous `splitGapDays: null` and
  `orderValue: null` lines removed.
- Container Tracking table SPLIT GAP / VALUE columns (lines 1836,
  1838): **no change required** — the existing `o.splitGapDays != null`
  and `o.orderValue != null` null-checks from PR4b2 automatically pick
  up the computed values.

**Trust hierarchy preserved:**

- Server: `delivered_date` + `invoice_amount` (PR5a)
- Adapter: pass-through per-container fields **plus** new DO-level
  `splitGapDays` + `orderValue` aggregations
- UI: existing null-check render

**Mock fallback unchanged.** Mock generator (line ~193, ~207) already
populates `splitGapDays` (per-DO) and `orderValue` (per-DO) with
synthetic values. Mock mode keeps using those; live mode now also
gets real values via the new adapter pass.

**Validation:**

- `npm run build` passes.
- Browser smoke (`VITE_DATA_SOURCE=live`):
  - Container Tracking — Split Orders table SPLIT GAP column shows
    e.g. `3d` for delivered SPLIT DOs; `—` for PENDING.
  - VALUE column shows e.g. `$5,297.82` for DOs with billing records;
    `—` for DOs without (LEFT JOIN nulls).
- Mock fallback: unchanged numbers.

**Not in scope (PR7b / PR7c):**

- Per-container `delivered_date` display inside the expand row
- `OK / SPLIT DAY` indicator per container based on whether it matches
  the DO's modal delivered date
- Bottom Split Delivery Alert banner aggregating across DOs

**Depends on:** PR5a (delivered_date + invoice_amount on the wire),
PR5a LEFT JOIN billing change.
**Blocks:** PR7b (per-container drill-down detail).

### PR7b — Container expand correct fields + OK/SPLIT DAY indicator (completed 2026-05-12)

User reviewed the PR7a dashboard and verified via direct Snowflake query
that the Container expand rows were surfacing misleading information:

1. **"DELIVERED" badge** driven by `c.status === 'DELIVERED'`, which in
   live mode is `mapScaleStatusToUps(c.container_status)`. KDC SCALE
   `container_status = 900` means "manifested out from KDC", not "UPS
   delivered to customer". Pre-PR7b, packages still in UPS transit were
   rendering as DELIVERED.
2. **Date column** showing `c.shipDate` = `toDateOrNull(c.container_status_time)`,
   i.e. KDC outbound time, not UPS-delivered time. This is the same field
   in disguise — both columns 3 and 5 of the expand row leaned on the
   wrong source.

**User Snowflake verification cases:**

- **0801932418 (GOLDEN BEAUTY)** — Row 2: `DELIVERED_DATE = NULL`,
  `CONTAINER_STATUS = 900`, `CONTAINER_STATUS_TIME = 2026-05-09`. UI
  was showing "DELIVERED · May 9". The package is still in transit per
  UPS.
- **0801932599 (SEVEN BEAUTY)** — All 3 trackings show
  `CONTAINER_STATUS_TIME = 2026-05-08`, but actual `DELIVERED_DATE` is
  May 8 for 2 trackings and May 11 for 1. PR7a's `SPLIT GAP = 3d` is
  correct; the expand UI was hiding the variance by uniformly showing
  May 8 for all three.

PR7a's DO-row logic is 100% correct. PR7b corrects the Container
expand UI to surface the same `delivered_date` PR7a aggregates from.

**Changes:**

- **Adapter (`serverRowsToShipments`):** new `modeDeliveredDay` computed
  per DO. Local-day precision (`new Date(d).toDateString()`) so timezone
  conversion doesn't shift the bucket. Tie-breaker: earliest day wins
  (so the first cohort delivered is treated as the "expected" batch and
  any later cohorts are flagged as the split).
- **Adapter — dedupe pass:** `containers` array is now built from a
  `distinctContainers` set keyed on `container_id`. Billing fan-out
  produces duplicate rows (per `(container_id × billing_date)`) but
  per-container fields are stable across the fan-out, so we keep the
  first row and discard the rest. Pre-PR7b, the expand showed inflated
  container counts and duplicate rows for DOs with multiple billing
  dates; post-PR7b, one row per actual container.
- **Adapter — deliveryStatus per container:** each entry in the
  `distinctContainers` array carries `deliveryStatus`:

  | State        | Condition                                       | UI display |
  |--------------|-------------------------------------------------|-----------|
  | `OK`         | Delivered day matches DO's modeDeliveredDay     | "OK" green |
  | `SPLIT_DAY`  | Delivered day differs from mode                 | "SPLIT DAY" red |
  | `PENDING`    | `delivered_date` is null (UPS scan not received) | "—" muted |

- **Container expand row JSX:**
  - **Column 3 (Status badge):** binary `DELIVERED` (green) / `IN TRANSIT`
    (amber), gated on `c.actualDelivery` (= `delivered_date` in live).
    Pre-PR7b granular states like `LABEL_CREATED` / `PICKED_UP` /
    `OUT_FOR_DELIVERY` no longer rendered — the binary "is it actually
    delivered to the customer" signal is what operations needs; SCALE's
    granular status was misleading in live mode.
  - **Column 5 (Date):** now shows `c.actualDelivery` (UPS-delivered
    time), not `c.shipDate` (KDC outbound time). Null → "—".
  - **Column 6 (Exp):** stripped the inline `→ delivered date` artifact —
    column 5 now carries the delivered date directly, so the inline
    arrow in column 6 was redundant. Column 6 keeps the "Exp: —"
    placeholder pending future SLA-table integration.
  - **Column 7 (Alert text):** `OK` / `SPLIT DAY` / `—` driven by
    `deliveryStatus`. Pre-PR7b's `LATE` label removed (mock-only
    concept, no live counterpart without SLA data).
  - **Column 8 (Icon):** `AlertTriangle` shows iff `deliveryStatus === 'SPLIT_DAY'`.
  - Removed `statusColors` map and `sc` local — unused after the badge
    rewrite.

**Mock fallback handling:**

The `deliveryStatus` field is set by the live adapter. Mock containers
don't carry it, so the JSX falls back to mock-specific fields:

```javascript
const deliveryStatus = c.deliveryStatus
  || (c.deliveredDifferentDay ? 'SPLIT_DAY'
    : c.actualDelivery ? 'OK'
    : 'PENDING');
```

Mock generator is unchanged. The fallback keeps the UI consistent
across both modes without leaking mock-specific concepts into the live
path.

**Trust hierarchy clarified (documented for the backlog):**

Two related but semantically different fields in source data — pre-PR7b
the UI conflated them:

| Field                              | Source                          | Meaning |
|------------------------------------|---------------------------------|---------|
| `container_status` / `container_status_time` | `SHIPPING_CONTAINER` | KDC SCALE-internal outbound status. `900` = "manifested out". |
| `delivered_date`                   | `UPS_TRACKING.datetime` where `status_type = 'Delivery'` | Real UPS delivered-to-customer timestamp. |

Post-PR7b, the customer-facing "DELIVERED" semantic is driven by
`delivered_date`. The SCALE status is no longer surfaced in the
expand row.

**Same-timestamp curiosity (SEVEN BEAUTY backlog note):**

Snowflake query shows `tracking_num = 1Z1F1E240303599204` and
`1Z1F1E240303601843` (different packages, same DO 0801932599) have
identical `DELIVERED_DATE` of `2026-05-08 10:08:14` (also identical
`PROCESSING_DATE`). This is **not** a SQL bug — it represents UPS
delivering both packages on the same truck at the same stop. Verified
by spot-checking `PICKING_COMPLETION_TIME` and `MANIFEST_DATE_TIME`
which differ appropriately. Documented here for future reference if
anyone investigates the `ups_data` CTE.

**Validation:**

- `npm run build` passes.
- Browser smoke (`VITE_DATA_SOURCE=live`, 5/5–5/12 window):
  - **0801932418** expand: 1 row "DELIVERED · May 8 · OK", 1 row "IN
    TRANSIT · — · —" (the previously-misleading "DELIVERED · May 9"
    row is now correctly labeled in transit).
  - **0801932599** expand: 2 rows "DELIVERED · May 8 · OK", 1 row
    "DELIVERED · May 11 · SPLIT DAY · ⚠".
  - DO-row SPLIT GAP unchanged from PR7a (`—` for 0801932418, `3d` for
    0801932599).

**Not in scope (PR7c — next):**

- Bottom "Split Delivery Alert" banner inside the expand block at
  line ~2007 — currently still keys off `c.isLate` (mock-only) and
  needs the same `deliveryStatus`-driven rewrite. PR7c.
- Expected delivery date data — no source field; pending SLA-table
  integration. Future PR.
- Chargeback amount — no source field. Future PR.

**No changes to:** `server.js`, `useSplitShipments` hook, mock
generator, `pageData` container-shape transform.

**Depends on:** PR7a (adapter block body + containers exposure).
**Blocks:** PR7c (bottom Split Delivery Alert banner).

### PR8 — AVG GAP KPI card activation (completed 2026-05-12)

User reviewed the PR7a/PR7b dashboard and identified one easy win:

> "Avg Gap KPI card 도 넣을 수 있겠어 그치?"

PR7a's `splitGapDays` per DO (max − min `delivered_date` across distinct
tracking_nums) is exactly the field this KPI needs. Pre-PR8 the
`AVG GAP` card in the live branch was hardcoded `"N/A"` while the mock
branch already rendered the same value — purely a JSX gate, no missing
data. PR8 lifts the gate and adds an outlier-aware subtitle.

**Source filter:**

- DO is in `splitData.split` (i.e. `split_status = 'SPLIT'` on the
  settled basis — `o.isSplit === true`)
- `o.splitGapDays != null` (excludes PENDING SPLITs where one or more
  trackings haven't been delivered yet — the gap is unknown for those)

**Display (user-chosen format):**

- Value: `'X.Xd'` — one decimal, suffixed `d` (e.g. `'2.3d'`).
- Subtitle: `'Worst: Xd'` — the max splitGapDays in the same set.
  Reason: average alone hides outliers; pairing avg with worst makes
  "AVG vs Worst" framing immediate. If avg is `1.7d` but one customer
  waited `20d`, the average looks fine while a single customer had a
  three-week split. The Worst value surfaces that.
- Empty state: value `—`, subtitle `'No settled splits in window'`.

**Why these two values together:**

Operations interprets the pair quickly:
- `Avg 0.5d · Worst 1d` — clean operations, splits resolve in one day.
- `Avg 1.7d · Worst 20d` — average is fine, one customer is hurting.
- `Avg 5d · Worst 5d` — uniformly slow, systemic issue.

**Computation lives in the existing `splitData` `useMemo`:**

```javascript
const gapItems = split.filter(o => o.splitGapDays != null);
const gapItemsCount = gapItems.length;
const avgGap   = gapItemsCount ? gapItems.reduce((s,o) => s + o.splitGapDays, 0) / gapItemsCount : 0;
const worstGap = gapItemsCount ? gapItems.reduce((m,o) => o.splitGapDays > m ? o.splitGapDays : m, 0) : 0;
```

`avgGap` already existed (mock-only consumption in the prior branch);
PR8 adds `worstGap` and `gapItemsCount` alongside and surfaces them in
the KPI card branch.

**JSX change:**

Pre-PR8:
```jsx
{isLive ? (
  <>
    <KPI label="Avg Gap" value="N/A" delta="Not available in live data" .../>
    <KPI label="Chargebacks" value="N/A" .../>
    <KPI label="Key Acct Impact" value="N/A" .../>
  </>
) : ( /* mock branch — avgGap rendered live */ )}
```

Post-PR8:
```jsx
{splitData.gapItemsCount > 0 ? (
  <KPI label="Avg Gap" value={`${splitData.avgGap.toFixed(1)}d`}
       delta={`Worst: ${splitData.worstGap}d`} deltaType="bad" .../>
) : (
  <KPI label="Avg Gap" value="—" delta="No settled splits in window" .../>
)}
{isLive ? ( /* Chargebacks + Key Acct still N/A */ )
       : ( /* mock-only computed values */ )}
```

`Avg Gap` is now mode-agnostic (mock and live render the same way).
`Chargebacks` and `Key Acct Impact` remain inside the `isLive` ? N/A
branch — explicitly deferred:

| KPI            | Why still N/A in live                                          | Future PR |
|----------------|----------------------------------------------------------------|-----------|
| Chargebacks    | No SLA-penalty data source on the wire — billing $ from PR5a is invoice total, not chargeback | Phase 2 / SLA integration |
| Key Acct Impact| `tier` field is mock-only; SAP customer master doesn't expose a `Key/Growth/Mid/Small` classification today | Customer-tier source PR |

**Validation:**

- `npm run build` passes.
- Browser smoke (`VITE_DATA_SOURCE=live`, 5/5–5/12 window):
  - `Avg Gap` card: `'N/A · Not available in live data'` → `'2.Xd · Worst: Yd'`.
  - Other 5 cards (Split Rate / Orders Split / In Transit / Chargebacks /
    Key Acct Impact) unchanged.
- Mock fallback: unchanged numbers (mock generator already populates
  `splitGapDays`).
- 0-splits edge case (e.g. an isolated short window where every SPLIT
  is still PENDING): card renders `—` + `'No settled splits in window'`
  rather than crashing on `(undefined).toFixed(1)`.

**Trust hierarchy:**

- Server: `delivered_date` (PR5a)
- Adapter: `splitGapDays` per DO (PR7a)
- `splitData.useMemo`: `avgGap`, `worstGap`, `gapItemsCount` (PR8)
- UI: KPI card (PR8)

**No changes to:** `server.js`, `useSplitShipments` hook, mock
generator, PR7a/PR7b adapter logic, other sections (Container Tracking,
Root Causes, Customer ranking, Channel cards).

**Depends on:** PR7a (`splitGapDays` source).
**Blocks:** Nothing further. Other N/A KPIs (Chargebacks, Key Acct
Impact) need their own data-source PRs.

---

### PR8 follow-up — Container metrics + KPI card cleanup (completed 2026-05-13)

After PR8 shipped the AVG GAP activation, the user reviewed the dashboard
again and identified two more changes for the same KPI card block:

> "Chargeback이랑 key acct impact 카드 지우고 container 레벨 metrics 보여줘"
>
> "Order Split 옆에 container split, In transit 옆에 container level in
> transit 카드 추가"

User reasoning: "KDC 입장에서는 컨테이너 레벨로도 보고싶을 수 있잖아." DO is
the business unit; container is the operations unit. Both deserve KPI
cards. The two mock-only `CHARGEBACKS` / `KEY ACCT IMPACT` cards had no
data source on the wire (table in the AVG-GAP follow-up above) and
displayed `N/A` in live mode — replaced with container-level counterparts
that the warehouse cares about.

**Final 6-card layout (DO unit ↔ container unit pairing):**

| Position | Card | Unit | Source |
|----------|------|------|--------|
| 1 | SPLIT RATE | DO % | `splitData.splitRate` |
| 2 | ORDERS SPLIT | DO count | `splitData.split.length` |
| 3 | **CONTAINERS SPLIT** (new) | container count | `containerMetrics.splitContainers` |
| 4 | IN TRANSIT | DO % | `splitData.pendingRate` |
| 5 | **CONTAINERS IN TRANSIT** (new) | container % | `containerMetrics.inTransitRate` |
| 6 | AVG GAP | days | `splitData.avgGap` (PR8) |

**Removed cards (no data source):**

- CHARGEBACKS — no SLA-penalty data on the wire (see PR8 deferral table).
- KEY ACCT IMPACT — `tier` field is mock-only; SAP customer master has
  no `Key/Growth/Mid/Small` classification today.

Both can be reinstated via the same mock-only N/A pattern if a data
source lands (see PR8 deferral table above for the future-PR mapping).

**New cards:**

**CONTAINERS SPLIT** — containers in SPLIT DOs.

- Value: absolute count (e.g., `2,157`)
- Subtitle: `of X containers` where X = total unique containers in window
- Icon: `Box` (lucide-react) to distinguish from `Package` on ORDERS SPLIT
- Why: warehouse load is driven by containers, not orders. A single
  4-container split DO doubles the load of a single 2-container split DO
  even though both count as one "Orders Split". This card surfaces that.

**CONTAINERS IN TRANSIT** — containers with `actualDelivery == null`.

- Value: rate (e.g., `70.0%`)
- Subtitle: `X of Y containers`
- Icon: `Clock` (same as DO-level IN TRANSIT — same metric, different unit)
- Why: DO-level "in transit" only counts whole DOs with no delivery
  scans. Even DOs that are settled / partially-delivered can have some
  containers still without a UPS scan. Container-level rate is the true
  "what's pending UPS scan" picture.

**Computation (new `useMemo`):**

```javascript
const containerMetrics = useMemo(() => {
  let totalContainers = 0;
  let splitContainers = 0;
  let inTransitContainers = 0;
  for (const o of pageData) {
    const containers = o.containers || [];
    totalContainers += containers.length;
    // Mirror splitData.split's settled-basis SPLIT definition for parity.
    // Mock rows have no split_status so the gate falls through to isSplit
    // alone (matching mock behaviour); live rows enforce both.
    const isSettled = o.split_status !== 'PENDING' && o.split_status !== 'UNKNOWN';
    if (isSettled && o.isSplit) splitContainers += containers.length;
    for (const c of containers) {
      if (c.actualDelivery == null) inTransitContainers += 1;
    }
  }
  return {
    totalContainers,
    splitContainers,
    inTransitContainers,
    inTransitRate: totalContainers > 0 ? inTransitContainers / totalContainers : 0,
  };
}, [pageData]);
```

**Container-count source (verified by user via Console, 5/5–5/12 window):**

Sum of `containers.length` across pageData DOs ≈ total unique
container_ids in window. PR5a's billing fan-out via `group by 1..22`
fans rows out per billing date; PR7b's `serverRowsToShipments` deduplicates
container rows back by `container_id` inside each DO's `containers[]`
before they reach pageData. So summing `.length` across all DOs gives a
clean per-window unique container count. User verified: 8,153 (= total
distinct container_ids by direct COUNT). If a future dataset shows
duplication at this level, deduplicate by `container_id` in the count.

**Validation:**

- `npm run build` passes.
- Browser smoke (5/5–5/12, live source):
  - 6 KPI cards render in the order above.
  - CHARGEBACKS / KEY ACCT IMPACT cards: gone (no live or mock branch).
  - CONTAINERS SPLIT: e.g. `2,157` · `of 8,153 containers`.
  - CONTAINERS IN TRANSIT: e.g. `70.0%` · `5,704 of 8,153 containers`.
  - AVG GAP: unchanged from PR8 (e.g. `2.3d` · `Worst: 7d`).
- Mock fallback: same 6 cards with mock-derived container counts; no
  break since `containerMetrics` reads `o.isSplit` (present in both
  modes) and `c.actualDelivery` (present in both modes).
- 0-orders edge case: all four `containerMetrics` fields return `0`;
  `inTransitRate` short-circuits via `totalContainers > 0` guard.

**Trust hierarchy:**

- Server: `container_id`, `delivered_date`, `split_status` (PR5a + PR4)
- Adapter: `containers[]` per DO, deduped by `container_id` (PR7b)
- `containerMetrics` `useMemo`: per-window aggregations (PR8 follow-up)
- UI: KPI cards (existing pattern, no `KPI` component changes)

**No changes to:** `server.js`, `useSplitShipments` hook, mock generator,
PR7a / PR7b adapter logic, other sections (Channel, Container Tracking,
Customer, Root Causes), or master plan 001.

**Depends on:** PR7a (`containers[]` array surface) + PR7b (container
dedup by container_id).
**Blocks:** Nothing further. PR7c (Bottom Split Delivery Alert banner)
remains an independent candidate.

---

### PR9 — Master query 4-category `split_status` + MISSING_TRACKING (completed 2026-05-13)

User reviewed the PR8 dashboard and verified via direct Snowflake
Console queries that the `settled 743` figure was misleading. The
master query's prior `SINGLE_SHIPMENT` branch only checked
`tracking_cnt <= 1` — it did **not** validate that the tracking had
actually been scanned by UPS — so DOs with one tracking and no
delivery scan were being classified as settled (`SINGLE_SHIPMENT`)
instead of in-transit (`PENDING`).

> 운영적 의미: "1 tracking 있고 아직 UPS scan 안 됨" 도 settled 로 분류
> → 진짜 운영 fact 와 mismatch

User decisions:

1. **Drop `SINGLE_SHIPMENT`.** The "1 tracking + delivered" case and
   the "multi-tracking + all delivered same day" case are operationally
   identical (an order that shipped and delivered cleanly), so collapse
   both into `NOT_SPLIT`. The 5-category model becomes a 4-category
   model.

2. **Add `MISSING_TRACKING`.** A DO with `has_null_tracking = 1` (one
   or more containers without a `tracking_num`) is neither a split nor
   a clean shipment — it's a data-integrity or UPS-handoff gap that
   operations needs to **investigate separately**. Classifying it as
   SPLIT (current behavior) inflated the split rate with non-split
   facts.

**New `classified` CTE logic:**

```sql
case when d.has_null_tracking = 1 then 'MISSING_TRACKING'
     when d.delivered_date_cnt = 0 then 'PENDING'
     when d.delivered_date_cnt > 1 or d.has_null_delivered_date = 1 then 'SPLIT'
else 'NOT_SPLIT'
end as split_status
```

Order matters: `MISSING_TRACKING` is checked **first** because a DO
with `has_null_tracking = 1` is operationally a separate concern even
if it also happens to have `delivered_date_cnt = 0` (it would
otherwise read as `PENDING`).

**Case table (operational meaning):**

| `tracking_cnt` | `delivered_date_cnt` | `has_null_tracking` | `has_null_delivered_date` | `split_status` |
|----------------|----------------------|---------------------|----------------------------|----------------|
| Any            | Any                  | 1                   | Any                        | `MISSING_TRACKING` |
| Any            | 0                    | 0                   | —                          | `PENDING` |
| 2+             | 2+ days              | 0                   | Any                        | `SPLIT` |
| 2+             | 1 day                | 0                   | 1 (some still pending)     | `SPLIT` |
| 2+             | 1 day                | 0                   | 0 (all same day)           | `NOT_SPLIT` |
| 1              | 1 day                | 0                   | 0                          | `NOT_SPLIT` |

**Verified distribution (Snowflake Console, 5/6–5/14 window):**

| Status            | Count | %       |
|-------------------|-------|---------|
| PENDING           | 906   | 57.9%   |
| MISSING_TRACKING  | 318   | 20.3%   |
| SPLIT             | 185   | 11.8%   |
| NOT_SPLIT         | 155   | 9.9%    |
| **Total**         | **1,564** | 100% |

**Dashboard impact (massive — addressed by PR10):**

| Metric                       | Before (PR8)      | After (PR9)            |
|------------------------------|-------------------|-------------------------|
| Settled DO count             | 743               | 340 (SPLIT + NOT_SPLIT) |
| SPLIT RATE (settled basis)   | 21.7% (161/743)   | ~54.4% (185/340)       |
| IN TRANSIT rate              | 51% (775/1,518)   | ~57.9% (906/1,564)     |
| (NEW) MISSING_TRACKING       | —                 | 318 (20.3%)             |

The split rate roughly **doubles** under the corrected definition because
the old "settled" denominator was inflated by `SINGLE_SHIPMENT` rows
that hadn't actually delivered. PR10 will refresh the KPI cards' settled
basis to `SPLIT + NOT_SPLIT` and add a MISSING_TRACKING banner so the
new category surfaces in the UI.

**`MISSING_TRACKING` operational interpretation (samples):**

| DO          | `tracking_cnt` | `container_cnt` | `has_null_tracking` | Reading |
|-------------|----------------|-----------------|---------------------|---------|
| 0801956909  | 0              | 8               | 1                   | 8 containers, 0 trackings — new SO or UPS handoff never started |
| 0801955530  | 3              | 7               | 1                   | 7 containers, only 3 got trackings — partial UPS processing |
| 0801955170  | 1              | 6               | 1                   | 6 containers, only 1 got a tracking — severe partial case |

20% is too large a slice to silently bucket as SPLIT — some entries are
just fresh SOs that haven't been handed off yet (will resolve with time),
others are genuine data-integrity issues that operations needs to chase.
Surfacing the category as its own banner (PR10) lets the right people
look at the right cases.

**Master-query parts unchanged:**

- `base` CTE — date scope, channel filter (PR4a)
- `ia_work_instruction` CTE — container_id + tracking_num projection
- `ups_data` CTE — tracking → delivered_date (PR4b1)
- `billing` CTE — invoice fan-out (PR5a)
- `final` CTE — joins
- `do_level` CTE — count aggregations
- `split_root_cause` CTE — automatically picks up the new SPLIT
  definition since it filters `where split_status = 'SPLIT'`. The
  `MISSING_TRACKING` DOs are excluded from root-cause analysis, which
  matches their operational meaning (investigate separately, not a
  split-cause case).

`toFactShape` and the endpoint surface are unchanged: `split_status`
flows through as a string, the frontend receives the new value
verbatim. Frontend handling (re-classifying KPI cards by the new
`split_status` set, adding the MISSING_TRACKING banner) is **deferred
to PR10**.

**Files modified:**

- `server.js` — `SPLIT_SHIPMENTS_SQL` `classified` CTE replaced
  (byte-exact with the user's SQL)
- `docs/exec-plans/active/002-split-shipments-live.md` — same
  replacement in the plan's master query block, plus this PR9 section

**Smoke test (PR9 self-verification):**

```bash
# After server restart
curl -s "http://localhost:3001/api/scale/split-shipments?from=2026-05-06&to=2026-05-14" \
  -o /tmp/pr9_smoke.json

node -e "
const j = require('/tmp/pr9_smoke.json');
const rows = j.data || j.shipments || j;
const doStatus = new Map();
for (const r of rows) if (!doStatus.has(r.do_num)) doStatus.set(r.do_num, r.split_status);
const counts = {};
for (const s of doStatus.values()) counts[s] = (counts[s] || 0) + 1;
console.log('Distribution:', counts);
console.log('Total DOs:', doStatus.size);
"
```

Expected (data freshness may shift values ±5):

```
Distribution: {
  PENDING: ~906,
  MISSING_TRACKING: ~318,
  SPLIT: ~185,
  NOT_SPLIT: ~155
}
Total DOs: ~1,564
```

If the output contains `SINGLE_SHIPMENT` or `UNKNOWN`, the server has
not been restarted with the new SQL.

**Trust hierarchy preserved:**

- User master query (operational fact, written directly by user)
- Plan SQL block (byte-exact paste, LF-normalized)
- `server.js` `SPLIT_SHIPMENTS_SQL` (byte-exact paste of same block)
- `?` parameter binding maintained (PR5a pattern)

**Depends on:** PR5a (master query 7-CTE structure).
**Blocks:**
- PR10 — KPI cards settled basis + MISSING_TRACKING banner (frontend)
- PR11 — Container metrics denominator correction (frontend)

---

### PR10 — Frontend: KPI settled basis + MISSING_TRACKING banner (completed 2026-05-13)

PR9 shipped the 4-category SQL but `splitData.useMemo` was still using
the pre-PR9 filter `o.split_status !== 'PENDING' && o.split_status !== 'UNKNOWN'`
as its "settled" gate. After PR9 that gate accidentally folds
`MISSING_TRACKING` into the settled denominator (since `'UNKNOWN'` no
longer appears and `'MISSING_TRACKING'` passes both `!== 'PENDING'` and
`!== 'UNKNOWN'`), deflating split rate by roughly 40%.

**Pre-PR10 numbers (post-PR9 SQL, freshness-shifted 5/6–5/14):**

| Quantity | Value |
|----------|-------|
| settled  | SPLIT + NOT_SPLIT + MISSING_TRACKING = 246 + 253 + 313 = **812** |
| split    | 246 |
| splitRate | 246 / 812 = **30.3%** ← inflated denominator |

**Post-PR10 numbers (same window):**

| Quantity | Value |
|----------|-------|
| settled  | SPLIT + NOT_SPLIT = 246 + 253 = **499** |
| split    | 246 |
| splitRate | 246 / 499 = **49.3%** ← operational truth |

The operations team should never see the 30% reading; PR10 ships
together with PR9 so the dashboard stays consistent end-to-end.

**Changes:**

1. **`splitData.useMemo` settled filter (explicit allow-list):**

   ```javascript
   // PR10: explicit — only DOs whose split outcome is operationally decided.
   const settled = pageData.filter(o =>
     o.split_status === 'SPLIT' || o.split_status === 'NOT_SPLIT'
   );
   ```

   Allow-list (not deny-list) so the next time the SQL adds a category
   the frontend errs on the safe side — a new category lands outside
   `settled` by default rather than inside.

2. **New `missing` / `missingCount` / `missingRate` fields:**

   ```javascript
   const missing = pageData.filter(o => o.split_status === 'MISSING_TRACKING');
   const missingRate = pageData.length ? missing.length / pageData.length : 0;
   ```

   Surfaced via the `splitData` return alongside `pending` / `pendingCount`
   / `pendingRate` for consistency.

3. **MISSING_TRACKING banner (new):**

   Position: directly below the existing red `Customer Hard Requirement`
   banner, above the KPI grid. Visual pattern mirrors the existing
   banner exactly (gradient + left border + uppercase tracking-wider
   title + body) but swaps the critical red `#E74C6F` for warning amber
   `#f5a623` from the CLAUDE.md design tokens.

   Conditional render: `splitData.missingCount > 0` — hidden in clean
   windows so it doesn't add noise when the data integrity is fine.

   Copy: `"X DOs (X%) have container(s) without a UPS tracking number.
   Excluded from split-rate and in-transit metrics. Likely fresh SOs
   awaiting UPS handoff or genuine data anomalies needing investigation."`

**Pending KPI card behavior:**

`pendingRate` denominator stays `pageData.length` (all categories).
This is intentional: "X% of orders are in transit" is the natural
phrasing, and including MISSING_TRACKING in the denominator means the
in-transit rate reads as a proportion of *all DOs in this window*.
Alternative (PENDING / (SPLIT + NOT_SPLIT + PENDING)) would over-count
because MISSING_TRACKING is real volume too. The banner's count makes
the MISSING_TRACKING slice visible without distorting the in-transit
proportion.

**`containerMetrics` deliberately left alone:**

Line 1778's `isSettled = o.split_status !== 'PENDING' && o.split_status !== 'UNKNOWN'`
gate is **still** the pre-PR9 form. In practice this is currently
harmless because `is_split_shipment` is set server-side as
`split_status = 'SPLIT' then 'Y' else 'N'`, so MISSING_TRACKING DOs
have `isSplit = false` and the `isSettled && isSplit` gate excludes them
regardless of how `isSettled` is defined. PR11 will tidy this up for
consistency along with the broader `totalContainers` denominator
question (MISSING_TRACKING containers in the denominator inflates the
container in-transit %).

**Mock fallback behavior:**

Mock generator (`generateMockData`) still emits the pre-PR9 fields
(`isSplit`, `splitGapDays`, no `split_status`). The new `settled` filter
checks `split_status === 'SPLIT'` which is `undefined === 'SPLIT'` →
`false` for every mock row, collapsing `settled.length` to 0 and
`splitRate` to 0% in mock-fallback mode. This is a regression we accept
for now — the dashboard's mock path is a degraded-mode placeholder
(per the PR4b2 banner) and live data is the source of truth.

Backlog: update mock generator to emit `split_status` field consistent
with the 4-category SQL so mock-fallback numbers remain meaningful. Out
of scope for PR10 since the user's mandate was to fix live, and a mock
update can land independently.

**Files modified:**

- `src/ShippingSLAApp.jsx`:
  - `splitData.useMemo`: settled filter + missing fields
  - JSX: MISSING_TRACKING banner below Customer Hard Requirement
- `docs/exec-plans/active/002-split-shipments-live.md`: this PR10 section

**Validation:**

- `npm run build` passes.
- Browser smoke (live, 5/6–5/14):
  - SPLIT RATE card: ~49% (was ~30% on broken denominator).
  - IN TRANSIT card: ~48% (unchanged, PENDING-only numerator already
    correct pre-PR10).
  - MISSING_TRACKING banner: amber, "313 DOs (20.0%)".
- Browser smoke (mock fallback): banner hidden (mock has no
  MISSING_TRACKING rows); SPLIT RATE shows 0% on mock until the mock
  generator is updated (known regression, documented above).

**Trust hierarchy:**

- Server: 4-category `split_status` (PR9)
- Adapter: `split_status` pass-through (PR4b1)
- Page useMemo: explicit `SPLIT + NOT_SPLIT` settled + missing fields (NEW)
- UI: KPI cards (corrected denominator) + amber banner (NEW)

**No changes to:** `server.js`, `useSplitShipments` hook,
`serverRowsToShipments` adapter, mock generator, KPI component, other
sections (Channel / Container Tracking / Customer / Root Causes),
master plan 001.

**Depends on:** PR9 (4-category split_status reaching the page).
**Blocks:**
- PR11 — Container metrics denominator (MISSING_TRACKING containers
  inflate `totalContainers` denominator on `Containers In Transit`).
- Mock-generator update (backlog) — bring mock parity with 4-category
  SQL so mock-fallback split rate isn't 0%.

---

### PR11 — Frontend: Container metrics denominator correction (completed 2026-05-13)

After PR10 shipped the splitData allow-list, the user reviewed the
post-PR10 dashboard and identified the matching issue on the
container-level cards:

> "DO 와 같이 일관성 있게 delivered date 이 있는 경우로만 보여줘야지"
>
> "CONTAINERS SPLIT 도 do 처럼 전체 container 갯수를 보여주는게 맞고"

PR8 follow-up's `containerMetrics.useMemo` still carried the pre-PR9
`isSettled` form:

```javascript
const isSettled = o.split_status !== 'PENDING' && o.split_status !== 'UNKNOWN';
if (isSettled && o.isSplit) splitContainers += containers.length;
```

Two problems with this:

1. **Same deny-list trap as PR10.** Post-PR9, `'UNKNOWN'` no longer
   exists and `'MISSING_TRACKING'` passes both `!==` clauses, so
   MISSING_TRACKING DOs were folded into the implicit "settled" cohort.
   Currently *harmless on the SPLIT numerator* because
   `is_split_shipment` is server-side set to `'Y'` only when
   `split_status = 'SPLIT'`, so `o.isSplit` is `false` for every
   MISSING_TRACKING row and the `&& o.isSplit` gate filters them out
   regardless of how `isSettled` is computed. But the moment any
   other consumer of this useMemo wanted to count "settled containers"
   independently of `isSplit`, the deny-list would inflate the count.

2. **CONTAINERS SPLIT denominator was `totalContainers` (all containers
   in the window, including PENDING and MISSING_TRACKING).** User asked
   for parity with the DO-level ORDERS SPLIT card, whose denominator is
   `splitData.settledCount` (SPLIT + NOT_SPLIT only).

**PR11 changes:**

1. **Allow-list `isSettled` in `containerMetrics`** (PR10 pattern):

   ```javascript
   const isSettled = o.split_status === 'SPLIT' || o.split_status === 'NOT_SPLIT';
   if (isSettled) {
     settledContainers += containers.length;
     if (o.isSplit) splitContainers += containers.length;
   }
   ```

2. **New `settledContainers` field** — total container count across DOs
   whose split outcome is operationally decided. Mirrors
   `splitData.settledCount` at the container level.

3. **New `splitRate` field on `containerMetrics`** — `splitContainers /
   settledContainers`. Not currently rendered as a percent (the UI
   shows the absolute count + the new "of X settled containers"
   subtitle), but exposed for future use and for symmetry with
   `inTransitRate`.

4. **CONTAINERS SPLIT card subtitle:**
   - Before: `"of X containers"` where X = `totalContainers`.
   - After: `"of X settled containers"` where X = `settledContainers`.

5. **CONTAINERS IN TRANSIT card unchanged.** User explicitly chose to
   keep `totalContainers` as the denominator there — DO-level IN TRANSIT
   uses an all-DOs denominator (`pendingCount / totalCount`) and the
   container card mirrors that. MISSING_TRACKING containers belong in
   both the numerator and the denominator: a container without a UPS
   `tracking_num` is by definition unscanned, so it counts as in-transit
   for this rate.

**Denominator alignment table (post-PR11):**

| Card                    | Numerator                | Denominator              | Basis     |
|-------------------------|--------------------------|--------------------------|-----------|
| SPLIT RATE              | `split.length`           | `settledCount`           | settled   |
| ORDERS SPLIT            | `split.length`           | `settledCount`           | settled   |
| **CONTAINERS SPLIT**    | `splitContainers`        | `settledContainers`      | settled   |
| IN TRANSIT              | `pendingCount`           | `totalCount`             | all       |
| **CONTAINERS IN TRANSIT** | `inTransitContainers`  | `totalContainers`        | all       |
| AVG GAP                 | (mean over split DOs)    | n/a                      | split set |

The two split cards (DO + container) now both use settled basis; the
two in-transit cards (DO + container) both use all basis. Mental model
is consistent.

**Numbers preview (live, 5/6–5/14 window approximation):**

```
splitContainers      = sum of containers in SPLIT DOs (e.g. ~1,650)
settledContainers    = sum of containers in SPLIT + NOT_SPLIT DOs (e.g. ~3,400)
totalContainers      = sum across all DOs (e.g. ~6,860)
inTransitContainers  = containers with actualDelivery == null (e.g. ~4,780)

CONTAINERS SPLIT subtitle: "of 3,400 settled containers" (was "of 6,860 containers")
CONTAINERS IN TRANSIT: 69.6% — unchanged
```

The CONTAINERS SPLIT value is unchanged (still `splitContainers`); only
the subtitle denominator shifts to settled. The implied rate ≈ 48.5%
matches the DO-level SPLIT RATE (~49.3%) closely, which is the
operational sanity check users do mentally when both cards are visible.

**Mock fallback regression:**

Inherited from PR10. Mock rows have no `split_status` field, so the
new allow-list collapses `settledContainers` to 0, which makes the
CONTAINERS SPLIT subtitle read `"of 0 settled containers"`. This is
ugly but matches the broader mock regression documented in PR10:
mock-fallback is a degraded-mode placeholder, and a unified fix
belongs in a mock-generator update PR.

**Trust hierarchy:**

- Server: 4-category `split_status` (PR9)
- Adapter: `containers[]` per DO, deduped by `container_id` (PR7a/PR7b)
- Page useMemo: explicit settled allow-list + `settledContainers` (PR11)
- UI: CONTAINERS SPLIT subtitle (denominator corrected)

**Pattern consistency:**

| useMemo            | `isSettled` form (post-PR11)                                       |
|--------------------|--------------------------------------------------------------------|
| `splitData` (PR10) | `o.split_status === 'SPLIT' \|\| o.split_status === 'NOT_SPLIT'`   |
| `containerMetrics` | `o.split_status === 'SPLIT' \|\| o.split_status === 'NOT_SPLIT'`   |

Two definitions, same logic, both explicit. Future SQL categories land
outside `settled` by default — safer than the pre-PR9 deny-list, which
silently absorbed new values.

**Files modified:**

- `src/ShippingSLAApp.jsx`:
  - `containerMetrics.useMemo`: new `settledContainers`, allow-list
    `isSettled`, new `splitRate` field
  - CONTAINERS SPLIT KPI card subtitle: `"of X settled containers"`
- `docs/exec-plans/active/002-split-shipments-live.md`: this PR11 section

**Validation:**

- `npm run build` passes.
- Browser smoke (live, 5/6–5/14):
  - CONTAINERS SPLIT: value unchanged (`splitContainers`), subtitle
    now reads `"of X settled containers"` with X ≈ `settledContainers`.
  - CONTAINERS IN TRANSIT: unchanged (`totalContainers` denominator).
  - Other KPI cards (SPLIT RATE, ORDERS SPLIT, IN TRANSIT, AVG GAP):
    unchanged.
  - MISSING_TRACKING banner: unchanged from PR10.
- Mock fallback: subtitle reads `"of 0 settled containers"` (inherited
  mock regression).

**No changes to:** `server.js`, `useSplitShipments` hook, adapter, mock
generator, `splitData.useMemo` (PR10), other KPI cards, other sections
(Channel / Container Tracking / Customer / Root Causes), banners,
master plan 001.

**Depends on:** PR9 + PR10.
**Blocks:** Nothing further. With PR11, the operational measurement
cycle from PR4 → PR11 closes — the operations team can read every
KPI card on the Split Shipments page as a faithful operational fact
on the live data path.

---

### PR12 — Container expand: Missing tracking 표시 (Alert + Badge) (completed 2026-05-13)

User reviewed the PR11 dashboard's container expand view and
identified a misleading badge state:

> "tracking number 가 missing 이라면 in transit 말고 missing tracking
>  이라고 확실하게 명시해줬으면 좋겠어"

User separately verified that PR7b's "across N different days" alert
text was already dynamic (not hardcoded). PR12 scope is strictly the
missing-tracking surfacing — both as a per-container badge and as an
extra fragment on the existing Split Delivery Alert.

**Why this PR is needed:**

PR7b's badge was 2-state: `c.actualDelivery` truthy → `DELIVERED`,
otherwise → `IN TRANSIT`. After PR9 the page started showing
MISSING_TRACKING DOs, and on expand each container with
`tracking_num = null` rendered as `IN TRANSIT` — operationally wrong.
"In transit" implies UPS is processing the package; "missing tracking"
means UPS never started (data integrity / fresh SO / handoff gap).
The two states need distinct visual treatment so warehouse staff don't
chase the UPS for a package UPS has never seen.

**Two changes:**

1. **Container row badge — 3-state:**

   | State            | Trigger                          | Color               |
   |------------------|----------------------------------|---------------------|
   | MISSING TRACKING | `c.trackingNumber === '—'`       | amber `#f5a623`     |
   | DELIVERED        | `c.actualDelivery` truthy        | green `#2ECC71` (existing) |
   | IN TRANSIT       | otherwise                        | orange `#F39C12` (existing) |

   Order matters: MISSING TRACKING is checked **first**, so a container
   with no tracking and no delivery scan is correctly labeled "missing"
   rather than "in transit" by virtue of the actualDelivery check
   happening to be null.

2. **Split Delivery Alert — missing tracking fragment:**

   Existing trigger (PR7b): late containers OR multi-day delivery.
   PR12 adds a third trigger: any container with `trackingNumber === '—'`.

   Existing message fragments (when triggered):
   - `"Containers delivered across N different days."`
   - `"M container(s) delivered late or on a different day than the first carton."`

   PR12 adds (amber-colored to mirror the badge):
   - `"K container(s) missing UPS tracking number."`

   All three fragments are independent and concatenate naturally. The
   "Customer requirement: all cartons same day." trailer is unchanged.

**Why `c.trackingNumber === '—'` is the unified detector:**

| Source | Field shape                                   |
|--------|------------------------------------------------|
| Live (pageData normalization, line 1655) | `trackingNumber: c.tracking_num \|\| '—'`  |
| Mock (generator, line 238)               | `trackingNumber: trackingNum` (always real) |

`'—'` only appears when `tracking_num` was null on the wire (live).
Mock never produces it because the mock generator always synthesizes
a `1Z...` string. So the check is mode-agnostic without needing a
mode flag, and resilient to the raw `tracking_num` field's
JSON null/undefined ambiguity.

**Visual chain (amber):**

The amber color is shared deliberately across three layers, so the
operations team's eye can trace the alert vertically:

- Page top — `DATA INTEGRITY ALERT` banner (PR10) — "X DOs missing tracking"
- DO row — `Split Delivery Alert` extension (PR12) — "K container(s) missing UPS tracking number"
- Container cell — `MISSING TRACKING` badge (PR12) — single container

Critical red (`#E74C6F`) remains reserved for split-day issues (the
customer-facing compliance violation) and chargeback figures. Amber is
"investigate" / "internal data gap" — semantically distinct from "we
just broke the customer contract."

**Edge cases:**

- 1 day delivered + 0 missing → no alert (unchanged from PR7b).
- 2+ days delivered + 0 missing → existing message only (unchanged).
- 1 day delivered + 1+ missing → alert shows missing fragment alone.
- 2+ days delivered + 1+ missing → all fragments concatenated.
- MISSING_TRACKING DO with no delivered containers at all → alert
  triggers on missing alone; status column shows `MISSING TRACKING`
  badges instead of `IN TRANSIT`.

**Files modified:**

- `src/ShippingSLAApp.jsx`:
  - Container status `<td>` — 3-state badge (MISSING TRACKING first)
  - Expanded-row alert IIFE — `missingTrackingCount` + amber fragment +
    extended trigger condition
- `docs/exec-plans/active/002-split-shipments-live.md` — this PR12 section

**Validation:**

- `npm run build` passes.
- Browser smoke (live, recent window):
  - MISSING_TRACKING DO expanded: containers show amber `MISSING TRACKING`
    badge, alert reads `"K container(s) missing UPS tracking number."`.
  - SPLIT DO with all tracking present: badges unchanged
    (DELIVERED / IN TRANSIT), alert unchanged.
  - SPLIT DO with both split-days AND a missing tracking: alert shows
    both fragments back-to-back.
- Mock fallback: mock containers always have tracking numbers, so the
  MISSING TRACKING badge never appears in mock mode (correct — mock
  doesn't simulate this failure mode).

**Trust hierarchy:**

- Server: `tracking_num` per container (PR5a)
- Adapter: `containers[]` per DO with `tracking_num` preserved (PR7a/PR7b)
- Page normalization: `trackingNumber: tracking_num || '—'` (existing)
- UI: 3-state badge + alert fragment (NEW)

**No changes to:** `server.js`, `useSplitShipments` hook, adapter, mock
generator, `containerMetrics.useMemo`, `splitData.useMemo`, KPI cards,
DATA INTEGRITY banner, Customer Hard Requirement banner, other sections.

**Depends on:** PR7b (container expand pattern) + PR10 (amber
DATA INTEGRITY banner — shared color convention).
**Blocks:** Nothing further. PR7c (Bottom Split Delivery Alert banner)
remains an independent candidate; PR12's `missingTrackingCount`
computation pattern is reusable there.

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
