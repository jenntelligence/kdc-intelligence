# 001 — Snowflake Integration Master Plan

**Status:** Active
**Owner:** TBD (assignee not yet decided)
**Created:** 2026-04-29
**Last updated:** 2026-04-29
**Strategy:** Page-by-page sequential replacement of mock data with live
Snowflake data, on top of the existing `server.js` backend. Phase 1
covers three pages (Split Shipments, Geographic, Flight Board); other
pages are Phase 2 (out of scope for this plan).

**Related design docs:**
- `docs/design-docs/core-beliefs.md` (especially §1, §6, §7, §8)
- `ARCHITECTURE.md`
- `docs/references/snowflake-schema.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `AGENTS.md` § Database safety rule

**Sub-plans (created as work begins on each page):**
- `002-split-shipments-live.md` — Phase 1 page 1 (priority: business compliance)
- `003-geographic-live.md` — Phase 1 page 2
- `004-flight-board-live.md` — Phase 1 page 3

---

## 1. Goal

Replace mock data on three Phase 1 pages — **Split Shipments**,
**Geographic**, and **Flight Board** — with live data from Snowflake
(`SCI` database), by **extending** the existing `server.js` backend
(not replacing it) and adding a thin frontend conversion layer, while
preserving the mock data path as an explicit fallback per
`core-beliefs.md` §6.

---

## 2. Why now

- **Operations needs real signals, not mock demos.** Every screenshot
  today is fiction — `generateMockShipments()` (`src/ShippingSLAApp.jsx:90`)
  produces deterministic-looking but synthetic data. The dashboard's
  value to KDC Savannah is zero until it shows real shipments.
- **Split shipment compliance is a customer hard requirement**
  (core-beliefs.md §3). Customers like Ulta, Target, and Amazon enforce
  same-day-delivery as a contract term. The dashboard's first job is
  to surface real PGI-flag (`SD.UDF3`) violations before chargebacks
  land — and that requires live Snowflake data, not mock.
- **The colleague's prototype (`server.js`) has already done the
  Snowflake foundation work.** Connection layer, externalbrowser SSO,
  response envelope, reusable SQL idioms (`LIFECYCLE_STAGE_EXPR`,
  `COMPANY_NAME_EXPR`), and 13 working endpoints already query
  `SCI.PUBLIC` and `SCI.L0`. The remaining cost of going live for the
  three priority pages is small — most of it is filling the gap
  between server.js's UPPERCASE row shape and the frontend's lowercase
  `FactShipment` contract.
- **Phase 1 priority order — Split → Geographic → Flight Board — was
  set by user.** Reason: business value, not technical convenience.
  Split chargebacks > regional supply-chain visibility > stage-by-stage
  monitor (which has the most existing scaffolding to lean on).

---

## 3. Scope

### 3a. In scope (this plan)

- **Foundation work** needed to support all three Phase 1 pages
  (see §6a — column-name conversion, fetch pattern, toggle wiring,
  env var, read-only enforcement).
- **Three Phase 1 pages going live** with Snowflake data, in order:
  - Split Shipments (sub-plan `002`)
  - Geographic (sub-plan `003`)
  - Flight Board (sub-plan `004`)
- **Mock fallback preserved** for all three pages, with a UI banner
  signaling degraded mode (per core-beliefs §6).
- **CSV upload path preserved** unchanged. The existing
  `FactShipment` contract — established by `public/sample-data.csv`
  and `handleUpload` (`src/ShippingSLAApp.jsx:5256`) — remains the
  canonical wire format.
- **Frontend ↔ backend column-name conversion layer** (P1 tech debt,
  resolved in §6a F1).

### 3b. Out of scope (Phase 2 — future master plans)

The following Phase 2 pages follow the same pattern established here
once Phase 1 lands. Each gets its own master plan:

- Executive Summary (already has partial live KPI overlay — extend it)
- AI Risk & Alerts (`AIRiskPage`)
- SLA Timeline
- Root Cause
- $ at Risk (`CostsPage`)
- Customer Impact
- SKU Problems (`SKUProblemPage`)
- Shift Heatmap (`ShiftHeatmapPage`)

Other in-app pages (`InboundPage`, `StoragePage`, `LaborPage`,
`WavesPage`, `OptimizerPage`, `ForecastPage`, `EconomicsPage`,
`DataHubPage`, `EventCalendarPage`, `AdminSLAPage`,
`AdminPortalPage`, `SnowflakeSettingsPage`) are also Phase 2 or
later — most do not have a Snowflake live-data dependency yet.

### 3c. Out of scope but tracked (in `tech-debt-tracker.md`)

These items are acknowledged but deliberately not solved here.
Phase 1 works around them; the long-term fix is a separate plan:

- **`kdc_intelligence_foundation.sql` recovery (P1).** Phase 1
  bypasses the missing semantic views by querying `SCI.L0` directly
  for Split Shipments. Long-term recovery of the foundation SQL is
  a separate exec plan.
- **11 missing views (P1).** Phase 1 only depends on
  `VEXC_SHORT_PICKS` (Split), and we route around it via raw `SCI.L0`
  queries with the EX11 PGI flag (`SD.UDF3`). The other 10 missing
  views block other Phase 2 pages, not Phase 1.
- **`KISS_BI_CONFIG` table missing (P1).** Phase 1 reads
  thresholds from `server.js`'s mock defaults
  (`server.js:454-461`). Persisted SLA edits are a Phase 2 concern.
- **API authentication on `server.js` (P2).** Open CORS plus
  unauthenticated endpoints are fine for local dev, but block any
  remote deploy. Phase 1 stays local-dev-only.
- **Query timeout, request logging, parameterized binds (P2 each).**
  The existing endpoints work without these for prototype scale; we
  don't gold-plate Phase 1 endpoints either. Tracked for the
  hardening plan that precedes deploy.
- **Single-file 6,412-line `ShippingSLAApp.jsx` (P1).** Phase 1
  does **not** split this file. Per CLAUDE.md, the page-component
  split happens only when the user explicitly asks, and the trigger
  conditions in `tech-debt-tracker.md` (8,000 lines / parallel-PR
  collisions) have not yet fired.
- **README.md and CLAUDE.md two-source-model drift (P1).** Phase 1
  does not update these — that is a small standalone exec plan.

---

## 4. Current state (verified facts only)

Every claim below is anchored to a file path and line number.

### 4a. Backend — `server.js` (project root)

- **Size:** 830 lines, ES modules, Express 5, Node 20+, single file
  at the project root. Started with `node server.js` (default port
  3001). Documented in `tech-debt-tracker.md` P2 item ("server.js at
  project root is undocumented").
- **Connection layer** (`server.js:37-95`):
  - `buildConnection()` reads env vars, returns a Snowflake SDK
    connection with `authenticator: 'externalbrowser'`. No password
    transits.
  - `getConnection()` is the singleton — reuses `_connection` if
    `isUp()`, awaits `_connecting` if a connect is in flight.
  - `executeQuery(sqlText, binds)` is the universal query entry point.
- **Required environment variables** (`server.js:38-43`):
  | Var | Required? | Purpose |
  |-----|-----------|---------|
  | `SNOWFLAKE_ACCOUNT` | **required** | account locator |
  | `SNOWFLAKE_USERNAME` | **required** | Entra ID username |
  | `SNOWFLAKE_WAREHOUSE` | optional | warehouse to use |
  | `SNOWFLAKE_DATABASE` | optional | default DB (we use `SCI`) |
  | `SNOWFLAKE_SCHEMA` | optional | default schema (we use `PUBLIC`) |
  | `SNOWFLAKE_ROLE` | optional | role |
  | `API_PORT` | optional | defaults to `3001` |
  | `GOOGLE_GENERATIVE_AI_API_KEY` | optional | Gemini AI; falls back to mock |
- **Response envelope.** Every endpoint returns
  `{ success: boolean, data?: ..., error?: string, source?: string,
  table?: string, count?: number, requires?: string }`.
- **Always-applied filters** (verified across 7 endpoints):
  `WAREHOUSE = 'KDCGA1'` and `IN_DELETION = 'N'`. Phase 1 endpoints
  follow the same convention.
- **Reusable SQL idioms** (`server.js:158-172`):
  - `LIFECYCLE_STAGE_EXPR` — 9-stage `CASE` on `TRAILING_STS` →
    labels `1_Pool` … `9_Shipped` / `Z_Other`.
  - `COMPANY_NAME_EXPR` — `CASE USER_DEF1` → `Kiss` (1000) / `Ivy`
    (1100) / `Red` (1400) / `Vivace` (1900) / `Other`.
- **Snowflake-querying endpoints (13 total).** All read-only.

  *SCALE Raw — query `SCI.PUBLIC.SHIPMENT_HEADER` or
  `SCI.L0.LAUNCH_STATISTICS`:*
  | Endpoint | Line | Purpose |
  |----------|------|---------|
  | `GET /api/scale/overview-kpis` | 185 | 90d KPIs + YoY |
  | `GET /api/scale/lifecycle-heatmap` | 229 | stage × company |
  | `GET /api/scale/active-waves` | 250 | last 2d waves |
  | `GET /api/scale/otd` | 286 | on-time delivery 30d |
  | `GET /api/scale/daily-volume` | 311 | daily shipped 90d |
  | `GET /api/scale/stuck-shipments` | 337 | >24h idle |
  | `GET /api/scale/shipments` | 385 | paginated list |
  | `GET /api/scale/waves` | 429 | last 7d waves |

  *Verified queries (Cortex Analyst — Kathleen Li):*
  | Endpoint | Line | Tables |
  |----------|------|--------|
  | `GET /api/scale/workload-in-process` | 477 | `SCI.L0.SHIPMENT_HEADER` + `SHIPPING_CONTAINER` + `ITEM_UNIT_OF_MEASURE` |
  | `GET /api/scale/workload-pm` | 524 | `SCI.L0.TRANSACTION_HISTORY` |
  | `GET /api/scale/workload-ps` | 560 | `SCI.L0.PROCESS_HISTORY` + `SHIPPING_CONTAINER` |
  | `GET /api/scale/order-processing-time` | 600 | `SCI.L0.WORK_INSTRUCTION` + `SHIPMENT_HEADER` |
  | `GET /api/scale/pick-frequency` | 631 | `SCI.PUBLIC.VW_PICK_FREQUENCY` (view — existence in our env unverified) |

- **View-stub endpoints (11 total)** — all return
  `viewNotReady(viewName)` because their backing semantic views are
  defined in `kdc_intelligence_foundation.sql` (not in this repo).
  Phase 1 cares about **`VEXC_SHORT_PICKS`** (`server.js:368`) for
  Split Shipments — and routes around it. The other 10
  (`VOP_CONSOL_LOCATION_USAGE`, `VOP_OPEN_MANIFESTS`,
  `VPROD_QC_BY_STATION`, `VPROD_QC_BY_USER`, `VPROD_PICK_CYCLE`,
  `VPROD_AUTOSTORE_THROUGHPUT`, `VEXC_QC_FAILURES`,
  `VEXC_RL_MISSING_PRO`, `VEXC_IB_RECONCILIATION`,
  `VEXC_QC_FAIL_RATE_ALERT`) block Phase 2 pages, not Phase 1.
- **Mock-config endpoints** — `GET /api/scale/config`
  (`server.js:451`, returns hardcoded defaults) and
  `PUT /api/scale/config/:key` (`server.js:467`, no-op stub).
  Phase 1 reads from these, does not write.
- **Gemini AI endpoints (2)** — `POST /api/ai/chat`
  (`server.js:695`), `POST /api/ai/insight` (`server.js:723`). Out
  of scope for Phase 1.
- **Utility endpoints** — `GET /api/health` (line 100),
  `POST /api/snowflake/test` (line 105),
  `GET /api/snowflake/config` (line 139),
  `POST /api/kdc/query` (line 648 — admin SELECT-only Data Hub
  endpoint, line 653 enforces `/^\s*SELECT/i`).

### 4b. Frontend — Phase 1 page components

#### `SplitShipmentPage` (`src/ShippingSLAApp.jsx:1169`)

- **Props:** `{ filtered }` — the filtered FactShipment array
  (line 5127 derives `filtered` from `data = uploadedData || rawData`).
- **What it shows:**
  - Customer hard-requirement banner (target split rate 0.0%).
  - Container delivery mismatch banner (orders with
    `containers[].deliveredDifferentDay || isLate`).
  - 5 KPIs: Split Rate, Orders Split, Avg Gap, Chargebacks,
    Key-Account Impact.
  - 4 panels: Split Rate by Customer, Root Causes (split reasons),
    Split Rate by Distribution Channel, Container Tracking table
    (expandable per-order container tree).
- **Mock fields consumed:** `o.id, o.isSplit, o.customer, o.tier,
  o.channel, o.shift, o.splitReason, o.chargeback, o.splitGapDays,
  o.containers[]` (with per-container `containerId, trackingNumber,
  carrier, status, shipDate, expectedDelivery, actualDelivery, isLate,
  deliveredDifferentDay, weight, items, lastLocation, lastScan`).
- **Live-data scaffolding:** none. Currently 100% derived from
  `filtered`, which only sees mock or CSV data.
- **Live-mode date handling (target state):** Mock data uses a
  hardcoded date range. Live mode passes the full 2026 year to the
  frontend; the page's date-range picker filters in-memory. No
  date param on the backend endpoint. (See §7b F7.)

#### `GeoPage` (`src/ShippingSLAApp.jsx:566`)

- **Props:** `{ filtered }`.
- **What it shows:**
  - Issue-type selector (All / UPS / DC / Missing / Damage / Other).
  - Carrier lead-time table (UPS Parcel vs Truck/LTL — uses
    constants, not shipment data).
  - State-tile heat map colored by state's *share* of the selected
    issue's volume.
  - Ranked-states table sorted by share of issue.
- **Mock fields consumed:** `r.cause, r.state, r.channel`.
- **Per-state rollup fields computed in component:** `total,
  issueCount, allDelayed, causes{}, channels{}, issueRateInState,
  shareOfIssue, topCause, topChannel, topChannelCount`.
- **Live-data scaffolding:** none.

#### `FlightBoardPage` (`src/ShippingSLAApp.jsx:3660`)

- **Props:** `{ data: allData }` — raw (unfiltered) shipment array
  (note: this page intentionally takes `data`, not `filtered`).
- **What it shows:**
  - 6 KPIs: At WMS, On Floor, Ready Ship, In Transit, Breaching Now,
    At Risk.
  - Filter chips (All / Breaching / At Risk).
  - Live-board table with stage dots, age in stage, status badge,
    and ETA-confidence label per row (top 25 of `displayed`).
- **Mock fields consumed:** `o.isOpen` (filter), 9 stage timestamps
  (`o.confirm, o.deliveryPost, o.scaleReceived, o.waveRelease,
  o.pickComplete, o.packComplete, o.shipConfirm, o.carrierScan,
  o.delivered`), `o.orderCreate, o.cause, o.id, o.customer, o.state,
  o.channel, o.carrier, o.orderValue, o.promiseDeliver`.
- **Computed in component:** `currentStage` (1-9), `ageInStage`
  (hours), `breachRisk` (heuristic 0-100), `etaConfidence`
  (HIGH/MEDIUM/LOW), `flightStatus` (OK/AT_RISK/BREACH).
- **Live-data scaffolding:** none.

### 4c. Data-source toggle scaffolding (already exists)

In the main app component (`src/ShippingSLAApp.jsx`):

- `const [rawData, setRawData] = useState(generateMockShipments())` — line 5006.
- `const [dataSource, setDataSource] = useState('mock')` — line 5029,
  values `'mock' | 'live'`.
- `const [liveKpis, setLiveKpis] = useState(null)` — line 5032.
- `handleDataSourceToggle()` — line 5035: when toggling on, calls
  `/api/health`, sets `dataSource = 'live'` on success or shows a
  toast on failure.
- `useEffect` — line 5064: when `dataSource === 'live'`, fetches
  `/api/scale/overview-kpis` and sets `liveKpis`.
- `handleDataRefresh()` — line 5073: re-rolls mock via
  `setRawData(generateMockShipments())` and (if live) re-fetches
  overview-kpis.
- `data = uploadedData || rawData` — line 5122. The pages render
  off `filtered` derived from this.

**Gap:** `liveKpis` is overlaid only on the Executive Summary page
(`src/ShippingSLAApp.jsx:5793-5814`). `rawData` is **never replaced**
with live shipment rows — every other page (Split, Geo, Flight,
etc.) renders mock data even when `dataSource === 'live'`.

### 4d. Snowflake DB paths (cross-reference `snowflake-schema.md`)

**Verified:**
- `SCI` is the database name (33 occurrences in server.js, user-confirmed).
- `SCI.L0` exists. Confirmed tables: `SHIPMENT_HEADER` (user-verified
  in console), plus `SHIPMENT_DETAIL`, `SHIPPING_CONTAINER`,
  `LAUNCH_STATISTICS`, `TRANSACTION_HISTORY`, `PROCESS_HISTORY`,
  `WORK_INSTRUCTION`, `ITEM_UNIT_OF_MEASURE` (inferred from working
  endpoints).
- Auth: `externalbrowser` SSO via Entra ID.

**Unverified — block first end-to-end run of new endpoints:**
- Is `SCI.PUBLIC.SHIPMENT_HEADER` a base table, view, or synonym?
- Other schemas in `SCI` (L1, L2, RAW, STAGING, ...) — unknown.
- `kdc_intelligence_foundation.sql` location — not in repo.
- SAP-origin tables — schema and table inventory TBD (Phase 2).
- Network access (proxy or direct) — operational concern.
- Replication freshness — affects "live" vs "near-live" framing.

### 4e. FactShipment contract (the frontend's wire format)

This is the lowercase-keyed shape the React pages consume. It
originates from `generateMockShipments()` (`src/ShippingSLAApp.jsx:90`,
return at line 223-255) and is the target shape for both CSV upload
(`handleUpload`, line 5256) and any live-data fetch.

**Top-level keys used by Phase 1 pages:**

```
id, orderId, customer, tier, channel, carrier,
state, zone, region,
orderCreate, confirm, deliveryPost, scaleReceived,
waveRelease, pickComplete, packComplete,
shipConfirm, carrierScan, delivered,
promiseShip, promiseDeliver,
orderValue, cartons,
cause, onTimeShip, onTimeDelivery, isOpen,
isSplit, splitCartons, splitGapDays, splitReason,
primarySku, primarySkuName, skuCategory, skuFragile,
chargeback, shift, waveHour,
containers[]    // array
```

**`containers[]` per-element shape (Split Shipments depends on this):**

```
containerId, parentShipmentId, containerNum, totalContainers,
trackingNumber, carrier, status,
shipDate, expectedDelivery, actualDelivery,
isLate, deliveredDifferentDay,
weight, items, lastLocation, lastScan
```

**Note on the CSV header row** (`public/sample-data.csv`): the CSV
uses `CapitalCase` per-field names (`ShipmentID`, `OrderValue`,
`ShipToState`, ...). `handleUpload` maps this to the lowercase
FactShipment shape. The CSV is **not** the wire format — the
in-memory FactShipment object is. Live-data conversion targets the
in-memory shape, not the CSV column names.

---

## 5. Target state

After Phase 1 lands:

- The three Phase 1 pages render from live Snowflake data when the
  data-source toggle is set to `live` and the new env var
  (recommend `VITE_DATA_SOURCE=live`) is set; mock data otherwise.
- Each Phase 1 page has corresponding endpoint(s) in `server.js`,
  added alongside the existing 13:
  - Split: `/api/scale/split-shipments` (proposed name; finalized
    in sub-plan `002`).
  - Geographic: `/api/scale/geo-summary` (proposed; sub-plan `003`).
  - Flight Board: `/api/scale/flight-board` (proposed; sub-plan `004`).
  - Plus the foundation endpoint `/api/scale/shipments-fact`
    (proposed; see §6a F3) — a single FactShipment-shaped feed used
    by the toggle to swap `rawData`.
- The frontend ↔ backend column-name mismatch is solved consistently
  via a server-side `toFactShape()` helper invoked by Phase 1
  endpoints only (decision in §6a F1). Existing endpoints keep
  their UPPERCASE shape until their pages are migrated.
- Mock fallback works: if Snowflake errors or the API server is
  unreachable, the affected page shows mock data with a clear UI
  banner ("Live data unavailable — showing mock"). Per
  core-beliefs §6.
- The data-source toggle swaps `rawData` (not just `liveKpis`) when
  live mode activates — so Split / Geo / Flight all see live data,
  not just Executive Summary.
- The **single-file React structure is preserved**. No
  `src/pages/*` split in this plan.
- All new SQL is read-only per `core-beliefs.md` §8 and
  `AGENTS.md` § Database safety rule.
- `npm run build` passes; existing endpoints (`overview-kpis`,
  etc.) still work — no regressions on the Executive Summary
  live-KPI overlay.

---

## 6. Approach

### 6a. Foundation work (before any Phase 1 page goes live)

The foundation is **dramatically smaller than a from-zero plan** —
most of it already exists in `server.js`. Each item below is
explicit about what's done vs. what's needed.

**Already done (no work needed):**

- ✅ Snowflake connection layer (`getConnection`, externalbrowser SSO).
- ✅ Connection singleton with `_connection`/`_connecting` reuse.
- ✅ Response envelope, consistent across all 13 working endpoints.
- ✅ Reusable SQL idioms (`LIFECYCLE_STAGE_EXPR`, `COMPANY_NAME_EXPR`).
- ✅ Always-applied filters (`WAREHOUSE = 'KDCGA1'`,
  `IN_DELETION = 'N'`).
- ✅ Error handling pattern (try/catch + 500 on query errors).
- ✅ Basic SELECT-only gate on `/api/kdc/query` (`server.js:653`).
- ✅ Data-source toggle plumbing (state, handler, refresh, toast).

**New foundation (5 items):**

#### F1 — Frontend ↔ backend column-name conversion layer

The frontend expects lowercase FactShipment keys (`id`, `customer`,
`state`, ...); Snowflake returns UPPERCASE (`SHIPMENT_ID`,
`CUSTOMER_NAME`, `SHIP_TO_STATE`, ...). Two options:

| Option | Pros | Cons |
|--------|------|------|
| **A. Server-side rename** in a `toFactShape(row)` helper invoked at the end of each Phase 1 endpoint | Frontend untouched — single conversion point lives where data crosses the boundary; only Phase 1 endpoints affected | Adds a small post-projection step per endpoint |
| **B. Frontend adapter** per data hook | server.js untouched; each new endpoint stays UPPERCASE | Conversion logic spreads across multiple hooks, easy to drift; repeats for every consumer |

**Recommendation: Option A (server-side rename).** Reasons:
1. The FactShipment contract is the *frontend's* contract — honor it
   where data crosses the boundary, not at every consumer.
2. Only Phase 1 endpoints need it now. Existing endpoints
   (`overview-kpis`, etc.) are consumed only by the Executive
   Summary live-KPI overlay, which already handles their UPPERCASE
   shape — leave those as-is until their pages migrate in Phase 2.
3. One place to update if FactShipment evolves.
4. No new frontend dependency; no churn in `ShippingSLAApp.jsx`
   beyond wiring the toggle.

**Implementation note (for the sub-plans):** `toFactShape(row)` is
a shallow mapper, no recursion — just lowercase-rename and date
parsing for known timestamp columns. Defined once in `server.js`
near `LIFECYCLE_STAGE_EXPR`. Each Phase 1 endpoint calls it via
`rows.map(toFactShape)` before `res.json({ success: true, data: ...})`.

**Open question to flag (not closed here):** when a Phase 2 page
gets migrated, does its page consume FactShipment-shaped rows (use
the same conversion) or its own page-specific shape (write a new
mapper)? Defer to whichever Phase 2 sub-plan makes the call.

#### F2 — Data-fetching pattern

Currently the toggle uses raw `fetch()`. Phase 1 needs more endpoints;
the plan should pick one of:

| Option | Pros | Cons |
|--------|------|------|
| **A. Keep raw `fetch()`** | Zero new deps; matches existing `liveKpis` pattern | Manual loading/error/refetch state per hook |
| **B. SWR** | Caching, revalidation, small footprint | New dep, new pattern across the codebase |
| **C. TanStack Query (React Query)** | Industrial-strength, common in CPG/retail React | Heavier dep |

**Recommendation: Option A (raw fetch) for Phase 1.** Reasons:
1. Phase 1 adds at most 4 new fetches — overhead of a library is
   not yet justified.
2. The existing `liveKpis` useEffect (`src/ShippingSLAApp.jsx:5064`)
   shows raw fetch is sufficient for this scope.
3. Introducing SWR/React Query adds learning cost for any future
   contributor and hasn't been authorized in CLAUDE.md.
4. Reassess at Phase 2 if endpoint count grows past ~8 fetches.

#### F3 — Data-source toggle: `rawData` swap

The toggle today only overlays `liveKpis` for Executive Summary.
Phase 1 needs the toggle to swap `rawData` itself — the array all
Phase 1 pages derive from via `filtered`.

**Plan:**
- Add a single backend endpoint `/api/scale/shipments-fact`
  (proposed name) that returns FactShipment-shaped rows for a
  bounded recent window (default 30 days, configurable). This
  endpoint applies `toFactShape()` (F1) and exposes the lowercase
  contract.
- Extend the live-mode useEffect (`src/ShippingSLAApp.jsx:5064`) so
  that when `dataSource === 'live'`, it (a) fetches live KPIs as
  today, **and** (b) fetches `/api/scale/shipments-fact` and calls
  `setRawData(rows)`.
- On fetch error, fall back to mock and surface a banner per §5.

**Why a single fact endpoint, not per-page endpoints:** the three
Phase 1 pages all consume the same `filtered` array derived from
`rawData`. A per-page approach would require deduplicating shipment
rows across responses on the frontend — extra work for no gain.
Page-specific endpoints are still appropriate for **summaries**
(`geo-summary`, `flight-board` aggregations); the **fact feed**
itself is shared.

**Note on container data for Split Shipments:** `containers[]` is
nested inside each FactShipment row. The fact endpoint either
returns flat container rows alongside (frontend joins) or runs a
single SQL with `OBJECT_AGG`/`ARRAY_AGG` to nest containers
server-side. The choice is finalized in sub-plan `002`.

#### F4 — Environment variable for data source

Recommend introducing `VITE_DATA_SOURCE` with values `mock | live | csv`,
defaulting to `mock`. The toggle UI still works (user can flip at
runtime), but the env var sets the initial state on app boot.

Also: create `.env.example` (currently missing — closes a P2 tech
debt item from server.js documentation gap). It lists all 8
backend env vars from §4a and the new `VITE_DATA_SOURCE`. No
secrets — placeholders only.

#### F5 — Read-only enforcement on new endpoints

Per `AGENTS.md` § Database safety rule and `core-beliefs.md` §8,
all SQL from this codebase is read-only. The existing
`/api/kdc/query` SELECT-only gate (`server.js:653`) only applies to
that one admin endpoint, where SQL comes from user input. Phase 1
endpoints write SQL **we control** (no concatenated user input
beyond bounded params), so the regex gate is less critical there.

**Plan for Phase 1:**
- Document in this master plan and in each sub-plan that all new
  SQL is read-only per the rule.
- Code review for each sub-plan PR confirms zero
  `INSERT/UPDATE/DELETE/MERGE/CREATE/DROP/ALTER/TRUNCATE/CALL/COPY/GRANT/REVOKE`
  in any new SQL string.
- **Do not** build a shared `executeReadOnly()` wrapper in this
  phase — premature abstraction with 3 endpoints. Track as a P2
  candidate for the hardening plan.

### 6b. Phase 1 page work (priority order: Split → Geo → Flight)

#### Split Shipments — sub-plan `002-split-shipments-live.md`

- **Why this position (1st):** Business compliance. Customers like
  Ulta, Target, and Amazon enforce same-day-shipment as a contract
  term; a split is a chargeback event, not a metric. This is the
  highest-business-value page to put on live data.
- **What it shows:** 5 KPIs, container delivery mismatch banner, 4
  panels (customer / reason / channel / container tree). See §4b.
- **Backing data:** `SCI.L0.SHIPMENT_HEADER` (SH),
  `SCI.L0.SHIPMENT_DETAIL` (SD), `SCI.L0.SHIPPING_CONTAINER` (SC).
  Critical fields:
  - `SC.MANIFEST_FOR_DATE` — **the split-determination column.**
    Same-day compliance check is `MIN(SC.MANIFEST_FOR_DATE)::DATE
    != MAX(SC.MANIFEST_FOR_DATE)::DATE` across the order's
    containers.
  - `SD.UDF3` — PGI flag (`'Y'` complete / `'N'` not yet
    complete). Set automatically by `KISS_EXP_UploadShipmentBefore`
    during SCALE→SAP upload. **Available as supplementary signal
    only — NOT used for split determination in Phase 1** (see
    Split definition below). We **read** this column; we never
    call the procedure (read-only rule, `AGENTS.md`).
  - `SD.UDF8` — short-pick quantity (requested minus qty at status 999).
- **Split definition (confirmed):** A shipment is split if and
  only if its containers manifest across different calendar days.
  Same-day shipment with multiple cartons does NOT count as split.
  The judgment column is `IS_SPLIT` derived as
  `MIN(SC.MANIFEST_FOR_DATE)::DATE != MAX(SC.MANIFEST_FOR_DATE)::DATE`.

  Note on EX11 PGI flag (`SD.UDF3`): this is a separate concept —
  "shipment complete or incomplete" — set by
  `KISS_EXP_UploadShipmentBefore`. Phase 1 does NOT use the PGI
  flag for split determination. The PGI flag may be surfaced as
  supplemental information in Phase 2 if operations finds it
  useful, but it does not drive the split count or chargeback
  exposure metric.
- **New endpoint(s):** `/api/scale/split-shipments` — single
  call, returns the full 2026 calendar year. Filters limited to
  sales org (`USER_DEF1`) and customer; **no date-range parameter**
  (see Date range below).
- **Date range:** The endpoint returns the full 2026 calendar
  year (SQL: `WHERE SH.SHIP_DATE >= '2026-01-01'`). The frontend
  Split Shipments page adds a date-range picker that filters the
  in-memory dataset client-side. Mock data follows the same
  pattern, so the live and mock paths are visually identical.
- **SQL strategy:** Use `SCI.L0` directly because `VEXC_SHORT_PICKS`
  (the would-be view) is missing. JOIN structure starts from the
  reference SQL in `docs/references/snowflake-schema.md` §
  "Reference SQL — split shipments in the last 30 days" — but
  the date filter changes from `DATEADD(day, -30, CURRENT_DATE())`
  to `'2026-01-01'` (full-year fetch per F7). Apply
  `WAREHOUSE = 'KDCGA1'`, `IN_DELETION = 'N'`,
  `TRAILING_STATUS >= 800` (KISS-specific "shipped" threshold per
  `snowflake-schema.md`). Replace the reference SQL's `HAVING`
  clause with the same-day-only criterion: keep an order in the
  result set when
  `MIN(SC.MANIFEST_FOR_DATE)::DATE != MAX(SC.MANIFEST_FOR_DATE)::DATE`.
- **Risks specific to this page:**
  1. Real splits may have edge cases mock doesn't model (e.g.,
     multi-line shipments where some lines are split and others
     aren't; cancelled orders mid-split).
  2. ~~**Same-day timezone definition unresolved**~~
     **[RESOLVED 2026-04-29]** Same-day definition uses `::DATE`
     cast on two timestamps from the same source — timezone does
     not affect the comparison. See F6 in §7b and the closure
     note in §7c.
  3. **Customer-name column unverified** —
     `snowflake-schema.md` flags this. The reference SQL uses
     `SH.SHIP_TO_NAME AS CUSTOMER_ID` but it's not confirmed.
  4. Container nesting (per-shipment array) requires either
     `ARRAY_AGG` server-side or a second query and a frontend join.
  5. **Full-year fetch payload size** — measure response size
     during sub-plan `002` implementation. If too heavy, add
     month-based slicing as a follow-up (per F7 trade-off note).
- **Validation:** Pick 1-2 known recent split orders from operations
  and confirm the dashboard shows them with the correct gap days,
  chargeback amount, and reason classification. The user already
  flagged Ulta and Target as recent split-impact accounts — start
  there.

#### Geographic — sub-plan `003-geographic-live.md`

- **Why this position (2nd):** Highest visibility for state-level
  supply-chain patterns. Useful for both ops (where to focus
  carrier escalations) and account managers (per-region tier-1
  customer issues). Lower business-criticality than Split (no
  contract violation), but high information value.
- **What it shows:** Issue selector → state heat map →
  ranked-states table. See §4b.
- **Backing data:** `SCI.PUBLIC.SHIPMENT_HEADER` (or `SCI.L0` if
  PUBLIC turns out to lack the needed columns — decided in sub-plan
  `003`). Key fields: ship-to state column (likely
  `SHIP_TO_STATE` per `server.js:412`), and the cause classification
  (see Risks).
- **New endpoint:** `/api/scale/geo-summary` returning state-level
  aggregations (state, total, issueCount, allDelayed, topCause,
  topChannel). Frontend's per-state rollup logic moves into SQL.
- **SQL strategy:** `GROUP BY SHIP_TO_STATE`, plus
  `LIFECYCLE_STAGE_EXPR` for "delayed" derivation, plus a
  cause-bucket projection.
- **Risks specific to this page:**
  1. **Cause-bucket derivation is the hardest part.** The 5-bucket
     taxonomy (UPS / DC / Missing / Damage / Other) is the
     dashboard's own model — no single SCALE column maps to it.
     Likely path: derive from `TRAILING_STATUS`, `CARRIER_TYPE`,
     and (eventually) exception-view data. Until the rule is
     authoritative, default cause to `'Other'` for live data and
     flag this in the UI.
  2. **State-column name unverified** — confirm `SHIP_TO_STATE`
     vs alternatives (`SHIP_TO_STATE_PROVINCE`, etc.).
  3. Operations may push back if too many shipments default to
     `'Other'` — the page is less useful with a flat heat map.
- **Validation:** Pick a state with known recent issues (operations
  to nominate) and confirm the heat-map intensity matches their
  intuition.

#### Flight Board — sub-plan `004-flight-board-live.md`

- **Why this position (3rd):** Existing scaffolding — the Flight
  Board's per-stage logic mirrors `server.js`'s
  `LIFECYCLE_STAGE_EXPR` (`server.js:158`) and the
  `/api/scale/stuck-shipments` endpoint (`server.js:337`) is
  already shaped close to what Flight Board needs. Lowest
  technical lift of the three.
- **What it shows:** 6 KPIs, filter chips, live table with stage
  dots / age / status. See §4b.
- **Backing data:** `SCI.PUBLIC.SHIPMENT_HEADER` with
  `LIFECYCLE_STAGE_EXPR`, `TRAILING_STS`, and per-row time-since-
  last-event derivation.
- **New endpoint:** `/api/scale/flight-board` returning open
  orders with per-row `currentStage, ageInStage, breachRisk,
  flightStatus, etaConfidence` — the same fields the React
  component computes today, moved server-side.
- **SQL strategy:** Build on `/api/scale/stuck-shipments` —
  `WHERE TRAILING_STS BETWEEN 100 AND 899` (the "open" filter),
  add stage-dot derivation via `LIFECYCLE_STAGE_EXPR`, compute
  age via `DATEDIFF('HOUR', DATE_TIME_STAMP, CURRENT_TIMESTAMP())`.
- **Risks specific to this page:**
  1. **Breach-risk scoring formula** —
     `src/ShippingSLAApp.jsx:3674` uses a heuristic
     `Math.min(100, round(ageInStage / 24 * 100 + (cause ? 30 : 0)))`.
     Either replicate it faithfully in SQL or replace with a
     documented formula. Sub-plan `004` decides; default is
     "replicate exactly to start, document for future tuning."
  2. **"Open order" definition** — `o.isOpen` in mock means "not
     delivered." Confirm the SCALE-side equivalent; sketch:
     `TRAILING_STS BETWEEN 100 AND 899` (i.e., before "Closed"
     900) is closer to *not yet closed*, which differs from *not
     yet delivered*.
  3. Per-row computation in SQL may push response size up if a
     date filter isn't applied — bound the result set.
- **Validation:** For 3 consecutive days, compare the live Flight
  Board's "Breaching Now" count against the operations team's
  morning standup count.

---

## 7. Open questions

### 7a. Already answered — recap from inputs (closed)

- [x] Snowflake DB name → **`SCI`**.
- [x] At least one schema for SCALE tables → **`SCI.L0`** (raw).
- [x] Authentication method → **`externalbrowser` SSO via Entra ID**.
- [x] API layer location → **`server.js`** (project root) — extend it.
- [x] Foundation: connection, response envelope, SQL idioms,
      always-applied filters → **already in `server.js`**.
- [x] Phase 1 priority order → **Split → Geo → Flight Board** (user).
- [x] Read-only rule for all generated SQL → **enforced** by
      core-beliefs.md §8 + AGENTS.md § Database safety rule.

### 7b. User must decide (recommendations in plan; user confirms or overrides)

**Status:** All 8 decisions confirmed by user (2026-04-29).

- [x] **F1 — column conversion approach. [CONFIRMED]** Recommendation
      adopted: **Option A** (server-side `toFactShape()` rename,
      Phase 1 endpoints only).
- [x] **F2 — data-fetching library. [CONFIRMED]** Recommendation
      adopted: **Option A** (raw `fetch()` for Phase 1).
- [x] **F3 — fact-feed shape. [CONFIRMED]** Recommendation adopted:
      single `/api/scale/shipments-fact` endpoint serving all three
      pages. Page-specific summary endpoints (`split-shipments`,
      `geo-summary`, `flight-board`) coexist for aggregations only.
- [x] **F4 — env var name. [CONFIRMED]** Recommendation adopted:
      `VITE_DATA_SOURCE`, values `mock | live | csv`, default
      `mock`. Plus create `.env.example`.
- [x] **F5 — read-only wrapper. [CONFIRMED]** Recommendation adopted:
      **document the rule, do not build a shared
      `executeReadOnly()` wrapper this phase.** Track as P2 for
      hardening.
- [x] **F6 — Split definition (same-day rule). [CONFIRMED]** A
      shipment is split if its containers manifest across different
      calendar days. Same-day with multiple cartons = NOT split.
      Carton count alone is not the criterion.

      The comparison uses `MIN(SC.MANIFEST_FOR_DATE)::DATE` vs
      `MAX(SC.MANIFEST_FOR_DATE)::DATE` — date-only granularity.
      Timezone of the underlying timestamp does not affect this
      comparison since both endpoints share the same source.

      EX11 PGI flag (`SD.UDF3`) is a *different* compliance check
      ("PGI complete or not"). Phase 1 uses same-day definition
      only. PGI flag may be displayed informationally in Phase 2
      if useful.
- [x] **F7 — Date range / lookback. [CONFIRMED — CHANGED from 30-day default]**
      Backend fetches the full 2026 calendar year of shipment data
      in a single query. The frontend exposes a date-range picker
      so the user (operations team) selects the lookback window
      client-side; data filtering happens in the React layer
      without additional network round-trips.

      Rationale:
      - Matches the existing mock-data pattern (full dataset in
        memory, client-side filter).
      - Avoids per-request SQL with parameterized date bounds —
        enables caching of one large response.
      - Operations team can change the window instantly without
        backend involvement.

      Trade-off: first page load fetches the full year. If
      production data size makes this too heavy (measure during
      sub-plan `002` implementation), add backend pagination or
      month-based slicing as a follow-up — do not pre-optimize.
- [x] **F8 — Single-file vs per-page split. [CONFIRMED]**
      Recommendation adopted: **stay single-file** through Phase 1
      — confirms the existing tech-debt-tracker trigger conditions.

### 7c. External answer needed (someone outside this codebase)

For each item: **who** the question goes to, **what's blocked
without the answer**, and **rough cycle time**.

- [ ] **Customer-name column** on `SCI.L0.SHIPMENT_HEADER` —
      `SHIP_TO_NAME`? `SHIP_TO_CUSTOMER`? something else?
      Blocks: sub-plan `002` SQL; cosmetic for `003`/`004`.
      Who: data team or DBA. Time: ~5 min in Snowflake console.
- [ ] **`SCI.PUBLIC.SHIPMENT_HEADER` — table or view?** If view,
      capture DDL. Blocks: deciding whether `geo-summary` and
      `flight-board` query PUBLIC or L0. Who: data team. Time:
      ~5 min console query (`SELECT TABLE_TYPE FROM
      SCI.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'PUBLIC'
      AND TABLE_NAME = 'SHIPMENT_HEADER'`).
- [ ] **`kdc_intelligence_foundation.sql`** — obtain the file (or
      confirm unavailable). Does not block Phase 1 directly (we
      route around it for `VEXC_SHORT_PICKS`), but its absence
      blocks all of Phase 2's view-dependent pages. Who:
      prototype author (origin remote `grandmasterchris/KDC_Intelligence_v1`).
      Time: hours-to-days depending on availability.
- [ ] **Cause-bucket derivation rule** — how do operations
      classify a delay into UPS / DC / Missing / Damage / Other
      from the raw SCALE columns we have access to? Blocks:
      sub-plan `003` (Geographic) — without this, every state
      defaults to `'Other'`. Who: operations / data team. Time:
      ~30 min interview + write-up.
- [ ] **Breach-risk formula for Flight Board** — keep the
      heuristic at `src/ShippingSLAApp.jsx:3674` or replace with
      a documented model? Blocks: sub-plan `004`. Who: operations
      lead (the formula must match how they triage). Time:
      ~30 min discussion. Default if unanswered: replicate
      heuristic exactly, log a follow-up.
- [ ] **Replication freshness** — how recent is Snowflake data
      vs live SCALE? (minutes? hours? batch nightly?) Affects
      "live" vs "near-live" UI framing on all three Phase 1
      pages. Who: data team. Time: ~5 min email.
- [x] ~~**`SHIP_DATE` and `MANIFEST_FOR_DATE` time zone.**~~
      **[CLOSED 2026-04-29]** Original concern: timezone of
      `SHIP_DATE` / `MANIFEST_FOR_DATE`. With the same-day
      definition relying on `::DATE` cast of two timestamps from
      the same source (`SC.MANIFEST_FOR_DATE`), timezone does not
      affect the comparison.

      *Memo:* if a future requirement introduces hourly cutoff
      rules (e.g., "cartons after 6 PM count as next day"),
      revisit timezone then. Phase 1 does not need this.
- [ ] **Network access from dev environment to Snowflake** —
      direct or through a proxy/API gateway? Blocks: anyone
      bringing up server.js for the first time on a new
      developer machine. Who: IT / data platform team. Time:
      ~15 min email.

---

## 8. Success criteria

### 8a. Global (across Phase 1)

- All three Phase 1 pages render from live Snowflake data when
  `VITE_DATA_SOURCE=live` (or the runtime toggle is set to live).
- Mock fallback works when Snowflake is unreachable or returns an
  error — page shows a clearly labeled "live data unavailable"
  banner, content keeps its layout (per core-beliefs §6).
- `npm run build` passes.
- No write SQL anywhere in the Phase 1 codebase — verifiable by
  grep for `INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|CALL|COPY INTO|GRANT|REVOKE`
  across `server.js`.
- Page load (cached fetch) under 3 seconds for the slowest of the
  three pages.
- **Single-file React structure preserved** — no
  `src/pages/<Page>Page.jsx` split.
- **Existing endpoints still work** — no regression on the
  Executive Summary live-KPI overlay or the 13 working endpoints
  in §4a.
- Each sub-plan PR ships with a code-review confirmation that the
  read-only rule is satisfied.

### 8b. Per page

- **Split Shipments:** 1-2 known split orders nominated by
  operations validate end-to-end (correct gap days, chargeback,
  reason).
- **Geographic:** state heat map matches operations' intuition for
  1 known problem state.
- **Flight Board:** "Breaching Now" count agrees with operations'
  morning standup count for 3 consecutive days.

---

## 9. Rollback plan

Layered fallback — the lower the layer, the bigger the hammer:

- **Environment:** set `VITE_DATA_SOURCE=mock` (or click the
  toggle off) — frontend reverts to mock immediately, no code
  changes needed.
- **Backend:** Phase 1 endpoints (`/api/scale/shipments-fact`,
  `/api/scale/split-shipments`, `/api/scale/geo-summary`,
  `/api/scale/flight-board`) can be removed independently. The 13
  existing endpoints are untouched, so the Executive Summary live
  KPIs keep working.
- **Frontend:** the data-source toggle gracefully falls back to
  mock on fetch error — no UI code revert needed.
- **Code:** each sub-plan ships in a feature branch, merged via
  PR. If a sub-plan misbehaves in production, revert its commits
  (master plan stays active for the next attempt). Phase 1 does
  not couple sub-plans to each other — `003` and `004` can be
  reverted without touching `002` and vice versa.

---

## 10. Implementation notes (rules & guardrails)

For whoever picks up the work:

- **All Phase 1 endpoints follow the `server.js` response envelope**:
  `{ success, data?, error?, source?, table?, count? }`.
- **All Phase 1 SQL is read-only** per `core-beliefs.md` §8 and
  `AGENTS.md` § Database safety rule. No `INSERT/UPDATE/DELETE/MERGE/CREATE/DROP/ALTER/TRUNCATE/CALL/COPY/GRANT/REVOKE`
  anywhere in the new code, including indirect cases.
- **Apply `WAREHOUSE = 'KDCGA1'` and `IN_DELETION = 'N'` to every
  shipment query.** Cross-warehouse queries are out of scope for KDC.
- **Reuse `LIFECYCLE_STAGE_EXPR` and `COMPANY_NAME_EXPR` from
  `server.js`** — do not redefine them. If you need a new shared
  expression, add it next to the existing ones (`server.js:158-172`)
  rather than inlining.
- **Each sub-plan re-reads this master plan + relevant reference
  docs before coding.** If a sub-plan needs to change a master-plan
  decision, **update the master plan first as a separate change**;
  do not silently override.
- **New env vars get added to `.env.example`** — created as part
  of F4 (currently does not exist).
- **Tech debt found during implementation goes to
  `docs/exec-plans/tech-debt-tracker.md`**, not silently fixed.
- **When a sub-plan's work is complete and verified**, move
  `docs/exec-plans/active/00X-name.md` →
  `docs/exec-plans/completed/00X-name.md`. When all three Phase 1
  sub-plans are complete, this master plan moves the same way.
- **Per-page validation must include the operations team
  walkthrough** specified in §8b — not just unit-style checks.
  "It compiles" is not "it works."
- **The mock generator stays.** Per core-beliefs §6 and
  `tech-debt-tracker.md`. Phase 1 changes only its **role**, from
  "default" to "explicit fallback" — never deletes it.
- **Do not split `src/ShippingSLAApp.jsx`** in Phase 1. The
  trigger conditions in `tech-debt-tracker.md` (≥8,000 lines or
  parallel-PR collisions on different pages) have not yet fired.
  If they do during Phase 1 work, raise it as a separate exec
  plan rather than absorbing it here.
