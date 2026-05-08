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
- **Mock UI's 5-reason root cause labels** (Trailer capacity, Wave
  cutoff missed, Short pick - partial inventory, SAP-SCALE variance,
  Pick exception) — these are fictional placeholder labels. Real
  KDC root causes are 3-type (Zone/Container/Manifest level).
  Sub-plan `002` replaces the mock labels.
- **Page-level channel scope:** Split Shipments + Geographic pages
  apply a 3-channel filter (`customer_group='TR'` + 3 sales_orgs).
  Other pages are NOT affected — they continue to serve all 11
  channels via their respective endpoints. The app's header channel
  selector remains unchanged.
- Skill content gaps as a category — manhattan-scale-config skill
  is comprehensive but not 100% complete. Discovery on 2026-04-29:
  UDF mapping table missing `1400=Red`, `ia_work_instruction` table
  not documented, drill-down column names not captured. Treat skill
  as "starting point, supplement with operational facts" per the
  Trust hierarchy in `snowflake-schema.md`.
- Upstream prototype assumptions as a category — colleague's
  prototype was developed in a different environment than the
  user's. Discovery on 2026-04-30: SSO authentication hardcoded
  in upstream is not viable in user environment (RSA required).
  Combined with earlier discoveries (channel filter, split
  detection logic, drill-down columns), this confirms the plan's
  §6a F0 policy of treating prototype as "starting point, validate
  before reuse" rather than ground truth.
- Diagnostic-signal interpretation discipline — the schema=null
  finding in `/api/snowflake/test` (2026-04-29) was a yellow flag
  for role-permission gap that we initially dismissed as benign.
  Treat schema/warehouse/role being null in connection-test
  responses as a signal to verify role access, not a default
  state to be ignored. Master plan §6a F0 validation gate now
  implicitly covers this; explicit guidance lives in
  `snowflake-schema.md` § Snowflake role permissions.

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
- **UI structure (from screenshot review 2026-04-29):**
  - App header: channel selector (11 channels — UNCHANGED in live
    mode, shared across all pages)
  - 5 KPI tiles: Split Shipment Rate, Orders Split, Avg Gap,
    Chargebacks, Key Acct Impact
  - Two-column body: Split Rate by Customer (left) + Root Causes of
    Splits (right, currently 5 reasons mock; live mode shows 3 types
    within this page only)
  - Split Rate by Distribution Channel: 11 channel cards (mock);
    live mode shows 3 cards (page-level scope)
  - Container Tracking table with drill-down to container details
    (tracking number, status, location, items, weight, dates,
    OK/SPLIT DAY indicator)
- **Mock vs live changes (within this page only):**
  - Channel cards: 11 → 3 (page-level scope filter)
  - Root cause labels: "Trailer capacity", "Wave cutoff missed",
    "Short pick - partial inventory", "SAP-SCALE variance",
    "Pick exception" (5, fictional) → "Zone-level split",
    "Container-level split", "Manifest-level split" (3, real)
  - Other Phase 2 pages: NOT affected by these changes

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

#### Available from server.js (validate before reuse)

`server.js` is a prototype. It runs and returns data, but its SQL
correctness — domain assumptions, column choices, edge cases — has
not been independently verified. **Do not treat it as ground truth.**

The following are *available as starting points*, each requiring
validation before Phase 1 reuses them:

| Asset | Validation owner | Risk if wrong |
|-------|------------------|---------------|
| Connection pattern (singleton, externalbrowser SSO) | Lower risk; widely-used Snowflake SDK pattern | Connection bugs surface in dev quickly |
| Response envelope `{ success, data, source, table? }` | Architectural choice, not a fact claim | None — keep for consistency |
| `LIFECYCLE_STAGE_EXPR` (9-stage CASE on TRAILING_STS) | Operations supervisor walkthrough | Flight Board stages mislabeled |
| `COMPANY_NAME_EXPR` (sales-org → name, incl. Red 1400) | Cross-check vs `snowflake-schema.md` | Mislabel shipments |
| `WAREHOUSE = 'KDCGA1'` always-applied | Operations manager | Miss other warehouses (current/future) |
| `IN_DELETION = 'N'` always-applied | Operations supervisor | Wrong inclusion/exclusion policy |
| Existing 12 working endpoints (queries) | Per endpoint, when its page is migrated | Inherited bugs propagate |

Validation outcomes:
- ✅ Confirmed → reuse the pattern as-is
- ⚠️ Partially correct → fix `server.js` (read-only SQL edits — we may
  modify SELECT statements; the read-only rule prohibits writes
  *to the database*, not edits to query text)
- ❌ Wrong → discard and rewrite, document why in the relevant sub-plan

Validation is part of Phase 1 work, not a separate prerequisite.
Each Phase 1 sub-plan validates the assumptions its SQL depends on.

**New foundation (6 items, including F0 validation step):**

#### F0 — Validate inherited domain assumptions

Before any Phase 1 endpoint reuses a `server.js` SQL idiom or filter,
the assumption is validated against operations or our schema doc
(see table above). Validation work is distributed across sub-plans:

- **Sub-plan 002 (Split):** validates `WAREHOUSE`, `IN_DELETION`,
  `COMPANY_NAME_EXPR`. Does NOT depend on `LIFECYCLE_STAGE_EXPR`.
- **Sub-plan 003 (Geo):** validates `WAREHOUSE`, `IN_DELETION`,
  `COMPANY_NAME_EXPR`. Cause-bucket derivation is its own validation
  (separate question, see §7c).
- **Sub-plan 004 (Flight Board):** validates `LIFECYCLE_STAGE_EXPR`
  most critically — Flight Board reuses 9-stage classification
  directly. This is the highest-risk inheritance.

If a validation fails, the sub-plan halts pending a `server.js` SQL
fix or a rewrite decision. Do not ship a Phase 1 page with an
unvalidated server.js dependency in its critical path.

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

#### Phase 1 ordering — server.js dependency analysis

The three pages have different levels of inherited risk from `server.js`:

| Page | server.js dependency | Why |
|------|---------------------|-----|
| Split Shipments | LOW | New SQL written from scratch against `SCI.L0` raw tables. Reuses only `WAREHOUSE` / `IN_DELETION` filters. No `LIFECYCLE_STAGE_EXPR` involved. |
| Geographic | LOW | New SQL with state-level aggregation. Reuses `WAREHOUSE` / `IN_DELETION` / `COMPANY_NAME_EXPR`. Cause-bucket logic is novel (not from server.js). |
| Flight Board | **HIGH** | Extends `lifecycle-heatmap` and `stuck-shipments` patterns. Directly inherits `LIFECYCLE_STAGE_EXPR`. If the 9-stage CASE is wrong, every Flight Board metric is wrong. |

This reinforces the user-chosen priority order (Split → Geo → Flight):
the riskiest inheritance is also the last in line, so we accumulate
validation evidence before touching it.

#### Split Shipments — sub-plan `002-split-shipments-live.md`

- **Why this position (1st):** Business compliance. Customers like
  Ulta, Target, Walmart treat split shipments as chargeback events.
  This is the highest-business-value first page.

- **Page-level scope filter (CONFIRMED 2026-04-29):** This page
  filters to a 3-channel subset of all KDC shipments at the
  endpoint SQL layer:

  - `customer_group = 'TR'`
  - `sales_org IN ('1100', '1400', '1900')`

  Resulting channels: BS-IVY, BS-RED, VIVACE. Sales org 1000 (Kiss)
  is NOT in scope (different customer_group).

  **Page-level filter, not app-level:** the app's global channel
  selector in the header remains unchanged (11 channels). The
  3-channel filter is intrinsic to the `/api/scale/split-shipments`
  endpoint — other endpoints serving other pages do NOT apply this
  filter. The Split Shipments page's own UI elements (channel
  cards, channel breakdown chart) display only the 3 in-scope
  channels.

- **Backing data:**
  - `SCI.L0.SHIPMENT_HEADER` (SH) — order-level data. Channel
    determination via `sh.carrier = 'UPS'` filter (not via UDF).
  - `SCI.L0.SHIPPING_CONTAINER` (SC) — carton-level data. **Channel
    column is `sc.company` IN ('Ivy', 'Red', 'Vivace')** — this is
    the canonical filter for Phase 1 split-shipment scope.
    Key columns:
    - `container_id` — drill-down identifier
    - `tracking_number` — for UI display
    - `status` — DELIVERED / IN_TRANSIT etc.
    - `manifest_id` — for Type 3 detection
    - `manifest_close_date_time` — for Type 3 detection
    - `date_time_stamp` — current status timestamp; used for Type 2
      via `container_status >= '700'` filter
    - `weight` — UI display (column name TBD per §7c #18)
  - `SCI.L0.WORK_INSTRUCTION` (WI) — pick work. **Pick zone source
    is `user_def1` (KISS UDF customization), with `instruction_type
    = 'Header'` filter required (Pascal Case — see §7c #20).**
  - `SCI.L0.IA_WORK_INSTRUCTION` (IA_WI) — second work source,
    UNION'd with WI for full pick zone coverage. Likely "Inventory
    Allocation" work flow (KISS-specific). Logged §7c #17.
  - `SCI.L0.PROCESS_HISTORY` (PH) — for drill-down "last scan
    location" derivation (sub-plan 002 verifies).
  - `SCI.L0.SHIPMENT_DETAIL` (SD) — for drill-down item count
    (sub-plan 002 verifies join pattern).
  - `KDB.PBI_SF.SAP_CUSTOMER_MASTER` (CM) — customer master.
    Confirmed columns:
    - `SHIPTOPARTY_KEY` — join key (= SH.SHIP_TO)
    - `NAME` — customer name
    - `REGION` — state (US 2-letter)
    - `city`
    - `postalcode`
    Geographic page (sub-plan 003) shares this join.

- **Split definition (CONFIRMED 2026-04-29):** A shipment is split
  if any of three conditions apply. The earlier "same-day rule"
  (manifest dates differ) was incomplete — it only catches part of
  Type 2 and Type 3 below.

  **Type 1 — Zone-level split:**
```sql
-- Window function over WI/IA_WI UNION result joined to SC
COUNT(DISTINCT pick_zone) OVER (PARTITION BY shipment_id) > 1
-- pick_zone = WI.user_def1 (KISS UDF), filtered to instruction_type='Header'
```

  **Type 2 — Container-level split:**
```sql
container_count > 1
AND first_status_700_time IS NOT NULL
AND last_status_700_time IS NOT NULL
AND first_status_700_time <> last_status_700_time
-- where first/last_status_700_time use SC.date_time_stamp where
-- container_status >= '700'
```

  **No hour threshold** — any difference between sibling containers'
  status-700 transition timestamps counts as split. Closes §7c #15.

  **Type 3 — Manifest-level split (the silent killer):**
```sql
container_count > 1
AND (
       manifest_count > 1
    OR first_manifest_close_time <> last_manifest_close_time
    OR (
           status_700_container_count > 0
       AND status_700_container_count < container_count
       )
    )
-- Third OR branch is the true silent-killer signal.
```

  An order is flagged as split if ANY type triggers. The UI's
  "Root Cause" column on the container tracking table shows which
  type(s) applied — defaulting to the most severe if multiple.

- **Root cause taxonomy (replaces mock's 5-reason labels):** the
  mock UI's 5 labels (Trailer capacity, Wave cutoff missed, Short
  pick - partial inventory, SAP-SCALE variance, Pick exception) are
  fictional. Live mode replaces them with the 3 real types above.
  The `ROOT CAUSES OF SPLITS` chart shrinks from 5 to 3 entries
  (within this page only — other pages are unaffected).

- **New endpoint(s):**
  - `/api/scale/split-shipments` — single call, returns the full
    2026 calendar year for the 3 in-scope channels. Filter criteria
    intrinsic to the endpoint; not configurable by the app's header
    channel selector.

- **Date range:** The endpoint returns the full 2026 calendar year
  (SQL: `WHERE SH.SHIP_DATE >= '2026-01-01'`). The frontend Split
  Shipments page adds a date-range picker that filters the in-memory
  dataset client-side.

- **SQL strategy:** Multi-CTE structure with window functions
  (NOT GROUP BY) to preserve container-row granularity for UI
  drill-down support.

  Pattern:

  1. `base` CTE: Join SH ↔ SC ↔ KDB.SAP_CUSTOMER_MASTER. Apply
     filters: `sc.company IN ('Ivy', 'Red', 'Vivace')`,
     `sh.carrier = 'UPS'`, `sc.date_time_stamp >= '2026-01-01'`.
     **Omit** `IN_DELETION` filter per F0 validation.
  2. `work` CTE: UNION ALL of `work_instruction` and
     `ia_work_instruction` with `instruction_type='Header'` filter
     (Pascal Case — see §7c #20).
  3. `container_with_zone` CTE: LEFT JOIN base ↔ work on container_id
     OR work_unit (user SQL pattern).
  4. `flagged_containers` CTE: Window aggregations
     `OVER (PARTITION BY shipment_id)` for order-level metrics
     while preserving container rows.
  5. Final SELECT: 3 split flags + primary_split_type CASE,
     filtered to rows where any flag = 1.

  Apply EST timezone conversion:
  `CONVERT_TIMEZONE('UTC', 'America/New_York', timestamp_col)` for
  any timestamp used in display, comparison, or grouping.

  See `snowflake-schema.md` § Split Shipment SQL — operational
  reference for the full pattern.

- **Cross-database access required:** the Snowflake user/role
  running this query needs SELECT access to both `SCI` and `KDB`.
  Verify access during sub-plan `002` implementation, before writing
  the endpoint.

- **Risks specific to this page:**
  1. **`ia_work_instruction` semantics undocumented** — UNION
     assumption may double-count or miss rows. Sub-plan 002 PR1
     verifies via DESCRIBE TABLE + sample inspection.
  2. **Drill-down column names unknown** — items/weight/location/
     dates have likely sources but exact column names TBD. Sub-plan
     002 PR1 resolves.
  3. **Real splits may have edge cases user SQL doesn't model** —
     multi-line shipments where some lines split and others don't,
     cancelled orders mid-split, etc.
  4. **Cross-DB query performance** — SCI ↔ KDB joins (now used
     for both customer name and state/city/zip) may be slower than
     single-DB. Profile during sub-plan 002.
     **Measured 2026-05-08 via PR3 smoke (commit `54940b4`):**
     - Cold connection latency: 10.4s (under 30s threshold ✅).
     - Warm latency: <1s (Snowflake result cache).
     - Payload size: 77 MB (76,883 container rows × ~36 columns).
     - **Risk #4 status: ACCEPTABLE for current scope, but PR4
       frontend wiring needs pagination or month-window slicing
       (sub-plan 002 PR6 risk #4 / #5 already flag this).**
  5. **Window function payload** — preserving container rows
     produces ~3-5x more rows than aggregated approach. Estimate:
     ~186 rows for 62 split orders ≈ 100KB. Acceptable; revisit if
     production load shows otherwise.

- **Validation:** Pick 1-2 known recent split orders **per type**
  (3 total: 1 zone-split, 1 container-split, 1 manifest-split) from
  operations. Confirm the dashboard correctly classifies each. The
  user already mentioned several specific examples are available
  for cross-checking — capture these in sub-plan `002`.

  **Cross-validation against user SQL:** sub-plan 002's first
  endpoint result must match the user's reference SQL output for
  the same date range. Any divergence is a bug to resolve before
  Phase 1 ships.

- **UI changes from mock (within this page only):**
  - Channel cards section ("Split Rate by Distribution Channel"):
    11 cards → 3 cards (BS-IVY, BS-RED, VIVACE only)
  - Root Causes chart: 5 reason labels → 3 type labels
  - Container Tracking table: ROOT CAUSE column values change
    (Wave cutoff missed → Manifest-level split, etc.)
  - All other elements (KPI tiles, customer breakdown, drill-down
    structure, app header channel selector) stay the same; only
    data mapping changes within this page's scope.
  - **Drill-down panel data:** sourced from sibling container rows
    in the same response (frontend grouping), NOT a separate API
    call. Each split order's `containers: [...]` array populates
    the drill-down when the user clicks the row.

#### Geographic — sub-plan `003-geographic-live.md`

- **Why this position (2nd):** Highest visibility for state-level
  supply-chain patterns. Useful for both ops (where to focus
  carrier escalations) and account managers (per-region tier-1
  customer issues). Lower business-criticality than Split (no
  contract violation), but high information value.
- **Page-level scope filter (CONFIRMED 2026-04-29):** Geographic
  page applies the same 3-channel scope as Split Shipments —
  `customer_group = 'TR'` AND `sales_org IN ('1100', '1400', '1900')`.
  Resulting channels: BS-IVY, BS-RED, VIVACE. The geographic heat
  map and state aggregations cover only orders matching this
  scope. The app's header channel selector is unaffected (11
  channels remain). This filter is intrinsic to the
  `/api/scale/geo-summary` endpoint (or whatever the Geographic
  endpoint is finalized as in sub-plan `003`).
- **What it shows:** Issue selector → state heat map →
  ranked-states table. See §4b.
- **Backing data:** `SCI.PUBLIC.SHIPMENT_HEADER` (or `SCI.L0` if
  PUBLIC turns out to lack the needed columns — decided in sub-plan
  `003`). Key fields: ship-to state column (likely
  `SHIP_TO_STATE` per `server.js:412`), and the cause classification
  (see Risks).
- **Geographic data source (CONFIRMED 2026-04-29):** state heat
  map and per-state aggregations come from
  `KDB.PBI_SF.SAP_CUSTOMER_MASTER.REGION` (US 2-letter code),
  joined via `SCI.L0.SHIPMENT_HEADER.SHIP_TO = CM.SHIPTOPARTY_KEY`.
  This is the same cross-DB join Split Shipments uses — both
  pages share the join pattern. City/zip also available on the
  same KDB table if needed.
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
  1. **CRITICAL — `LIFECYCLE_STAGE_EXPR` correctness:** the 9-stage CASE
     inherited from server.js is the foundation of every Flight Board
     metric (currentStage, ageInStage, breachRisk, flightStatus). Sub-plan
     004 must walk through these 9 stages with an operations supervisor
     before SQL is written. If even one stage threshold is wrong, the
     whole page misleads.
  2. **Breach-risk scoring formula** —
     `src/ShippingSLAApp.jsx:3674` uses a heuristic
     `Math.min(100, round(ageInStage / 24 * 100 + (cause ? 30 : 0)))`.
     Either replicate it faithfully in SQL or replace with a
     documented formula. Sub-plan `004` decides; default is
     "replicate exactly to start, document for future tuning."
  3. **"Open order" definition** — `o.isOpen` in mock means "not
     delivered." Confirm the SCALE-side equivalent; sketch:
     `TRAILING_STS BETWEEN 100 AND 899` (i.e., before "Closed"
     900) is closer to *not yet closed*, which differs from *not
     yet delivered*.
  4. Per-row computation in SQL may push response size up if a
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
- [x] ~~**Replication freshness** — how recent is Snowflake data
      vs live SCALE? (minutes? hours? batch nightly?) Affects
      "live" vs "near-live" UI framing on all three Phase 1
      pages. Who: data team. Time: ~5 min email.~~
      **[CLOSED 2026-04-29]** ~10 minutes (MSSQL → Snowflake on
      10-minute cycle, user-confirmed). UI framing: "near-live"
      not "live." Frontend cache TTL ≤ 10 minutes. See
      `snowflake-schema.md` Verified facts.
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
- [ ] 9. **Validate `LIFECYCLE_STAGE_EXPR`** — does the 9-stage CASE
       on TRAILING_STS match KDC's actual floor reality?
       Stages to validate: '1_Pool', '2_Allocated', '3_Picking',
       '4_InPacking', '5_PackingComplete', '6_Staging',
       '7_Loading', '8_ShipConfirmPending', '9_Shipped'.
       Who: operations supervisor. Time: ~30min walkthrough.
       Blocks: sub-plan `004` (Flight Board) — **CRITICAL DEPENDENCY**.
- [x] ~~10. **Validate `WAREHOUSE = 'KDCGA1'` always-filter.**~~
        **[CLOSED 2026-04-29]** Confirmed: KDCGA1 is the only
        warehouse this dashboard covers. No other warehouses planned
        for 2026 (user-confirmed via operations manager). Filter
        stays applied. See `snowflake-schema.md` Verified facts.
- [x] ~~11. **Validate `IN_DELETION = 'N'` always-filter.**~~
        **[CLOSED 2026-04-29]** User direct verification: only `'N'`
        values exist in Snowflake — upstream ETL filters `'Y'` rows
        out. **Decision: omit the `IN_DELETION = 'N'` filter from
        new Phase 1 endpoints** (no rows to filter, no behavior
        change). Existing `server.js` endpoints retain the filter;
        cleanup tracked as P2 in `tech-debt-tracker.md` (commit
        `dbc15b7`). See `snowflake-schema.md` Verified facts.
- [x] ~~12. **Cross-check `COMPANY_NAME_EXPR` in server.js against
        `snowflake-schema.md` sales org table.**~~
        **[CLOSED 2026-04-29]** Verified: `server.js:172` already
        includes Red (1400) in `COMPANY_NAME_EXPR` alongside
        Kiss (1000) / Ivy (1100) / Vivace (1900). Matches
        `snowflake-schema.md` sales-org table. No correction needed.
- [x] ~~13. **WORK_INSTRUCTION zone codes**~~
        **[PARTIALLY CLOSED 2026-04-29]** server.js grep: no
        `WI.ZONE` column referenced anywhere. Zone-area derivation
        in server.js uses `LEFT(SC.original_pick_loc, 2)` prefix
        codes on `SHIPPING_CONTAINER` (`server.js:495-498`):
        `'AS'` → Pre-Pick / Autostore; `'PL'` / `'PR'` / `'PS'` →
        Pick Module (sub-areas). Same prefix convention appears on
        `TH.location` (`server.js:547`). The "autostore / active /
        reserve" terminology likely maps to floor-area prefixes,
        not a separate `ZONE` column.

        Still unverified: whether `WORK_INSTRUCTION` itself has a
        zone-equivalent column in Snowflake. Sub-plan `002` should
        use `LEFT(SC.original_pick_loc, 2)` for Type 1 detection
        (recommended given the consistent SC + TH pattern), OR run
        `DESCRIBE TABLE SCI.L0.WORK_INSTRUCTION` to confirm a
        separate zone column exists. Master plan §6b Type 1
        detection sketch currently references `WI.ZONE` — sub-plan
        `002` supersedes with the corrected column.
- [x] ~~14. **SHIPPING_CONTAINER ship-confirm column**~~
        **[PARTIALLY CLOSED 2026-04-29]** server.js + docs/ grep
        finds no `SHIP_CONFIRM_DATE_TIME` column anywhere. The
        documented SC-level timestamp closest to a ship-confirm
        event is `SC.MANIFEST_CLOSE_DATE_TIME` (per
        `snowflake-schema.md` SC UDF table: "Manifest close
        timestamp; NULL = open"). This is the most likely correct
        signal for Container-level split detection (Type 2).

        Master plan §6b Type 2 detection sketch references
        `SC.SHIP_CONFIRM_DATE_TIME` — sub-plan `002` should
        substitute `MANIFEST_CLOSE_DATE_TIME` and verify in the
        Snowflake console that this is the right per-container
        ship-event timestamp. (Status `700` "Ship Confirm Pending"
        on `SHIPMENT_HEADER` is per-order, not per-container — so
        not directly usable for Type 2.)
- [x] ~~15. **Container-level threshold tuning**~~
        **[CLOSED 2026-04-29]** User SQL confirms there is no hour
        threshold. Any difference in sibling containers' status-700
        transition timestamps counts as Container-level split. The
        original question was based on a wrong assumption from the
        master plan's Type 2 sketch. See `snowflake-schema.md`
        Verified facts.
- [x] ~~16. **`customer_group` column location**~~
        **[CLOSED 2026-04-29]** Channel filter does not use a
        customer_group column. User SQL filters via
        `sc.company IN ('Ivy', 'Red', 'Vivace')` — the canonical
        channel column on `SHIPPING_CONTAINER`. Plan's earlier
        customer_group/sales_org guess was incorrect. See
        `snowflake-schema.md` Verified facts.
- [x] ~~17. **`SCI.L0.IA_WORK_INSTRUCTION` semantics.**~~
        **[CLOSED 2026-05-08 via PR3 commit `54940b4`]** PR1 explore
        endpoint (commit `e9ffa79`) confirmed table exists with 106
        columns; structure consistent with SCALE work-instruction
        schema. Sample rows verified via case-sensitivity fix
        (`instruction_type = 'Header'` Pascal Case, see
        `snowflake-schema.md` § Snowflake string case-sensitivity).
        **Fully closed via PR3 (commit `54940b4`) on 2026-05-08:**
        - `IA_WORK_INSTRUCTION.user_def1` confirmed as live pick
          zone column (verified by working SQL output — the `zone`
          field on `/api/scale/split-shipments` populates from
          this column).
        - `IA_WORK_INSTRUCTION.company` domain matches
          `SHIPPING_CONTAINER.company` exactly ('Ivy'/'Red'/
          'Vivace') — the WHERE filter `company IN ('Ivy','Red',
          'Vivace')` returns rows for all 3 names.
        - 3 channels (Ivy/Red/Vivace) all present in PR3 endpoint
          output (exposed by sales-org code via `sh.user_def1`:
          1100=Ivy 91.9%, 1900=Vivace 4.4%, 1400=Red 3.8% —
          PR4 frontend will need code→name mapping via
          `COMPANY_NAME_EXPR`).
        - Verified by Snowflake direct query cross-validation:
          21,223 DOs, 37.7% SPLIT rate, byte-exact match
          (4/4 `split_status` counts: SPLIT / NOT_SPLIT /
          SINGLE_SHIPMENT / PENDING; UNKNOWN legitimately absent).
        - Endpoint: `GET /api/scale/split-shipments`.
        - Smoke results documented in PR3 closure (this commit).
- [~] ~~18. **Drill-down column names.**~~
        **[MOSTLY CLOSED 2026-04-30]** PR1 explore endpoint
        (commit `e9ffa79`) confirmed:
        - Weight: `SC.WEIGHT` (FLOAT) + `SC.WEIGHT_UM` (TEXT, 'LB')
        - Dimensions: `SC.WIDTH/HEIGHT/LENGTH` (FLOAT each) +
          `SC.DIMENSION_UM`
        - Expected delivery: `SC.PLANNED_DELIVERY_DATE_TIME`
          (TIMESTAMP_NTZ)
        - Tracking: `SC.TRACKING_NUMBER` (already known)
        - Manifest close: `SC.MANIFEST_CLOSE_DATE_TIME` (already
          known)
        See `snowflake-schema.md` § PR1 exploration findings for
        full column inventory.
        **Remaining open:** `last-scan-location` ("Local Delivery
        Facility" style strings) — PROCESS_HISTORY samples showed
        only internal SCALE process events, not carrier scan
        events. Likely sourced from carrier API outside SCI;
        defer to PR4 UI work. UI may need to omit this field for
        live mode initially.
- [x] ~~19. **Snowflake authentication method.**~~
        **[CLOSED 2026-04-30]** KDC environment requires RSA
        key-pair (`SNOWFLAKE_JWT`), NOT externalbrowser SSO.
        Upstream prototype hardcoded SSO; user environment fails
        SSO with "user differs from IDP user" error. server.js
        `buildConnection` updated to RSA pattern in PR0. See
        `snowflake-schema.md` Verified facts § Snowflake
        authentication.
- [x] ~~20. **Snowflake string case-sensitivity rule.**~~
        **[CLOSED 2026-04-30]** Snowflake string equality is
        case-sensitive by default. SCALE table enum-like columns
        use Pascal Case ('Header', 'Ivy', 'Box'). User reference
        SQL's `instruction_type = 'header'` (lowercase) returned
        0 rows; fix is `'Header'`. New verified fact in
        `snowflake-schema.md`. Schema doc § Split Shipment SQL —
        operational reference updated with corrected SQL. Trust
        hierarchy: 4th confirmed prototype-assumption failure
        in user environment.
- [x] ~~21. **Snowflake role permission for SCI.L0.**~~
        **[CLOSED 2026-04-30]** `CDM_TEAM` role lacks L0 access;
        `INTELLOPS` role has it. New `.env` uses `INTELLOPS`.
        `current_schema()` returning null in
        `/api/snowflake/test` was the diagnostic signal we
        initially dismissed (master plan note 2026-04-29). New
        verified fact in `snowflake-schema.md` § Snowflake role
        permissions captures the diagnostic pattern for future.

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
- **Validate inherited assumptions before reusing.** `server.js` is a
  prototype with unverified domain logic. Each sub-plan checks the
  assumptions its SQL depends on (see §6a F0). Do not write Phase 1
  endpoints that silently inherit `server.js` patterns without
  validation evidence in the sub-plan.
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
