# Technical Debt Tracker

Known technical debt, with priority and impact. Add new items here as they
are discovered — do not silently fix them inside an unrelated exec plan.

**Priorities:**
- **P0** — blocks production rollout or creates real customer/security risk.
- **P1** — meaningful pain, schedule into a near-term exec plan.
- **P2** — known smell, fix opportunistically.

---

## P0

### Hardcoded credentials

- **Current state:** Three demo accounts (`admin / admin123`,
  `manager / manager123`, `viewer / viewer123`) are baked into
  `src/ShippingSLAApp.jsx`. Auth is gated client-side only.
- **Impact:** Cannot ship to production. Anyone with the JS bundle can
  promote themselves to admin.
- **Fix path:** Real Okta SSO + server-side RBAC. Roadmap Phase 2.

### Mock data generator dependency

- **Current state:** `generateMockShipments()` at
  `src/ShippingSLAApp.jsx:90` is initialized into `useState` at line 5006
  and re-rolled by the refresh handler at line 5076. The "live" Snowflake
  fetch (line 5042 onward) is partially wired but not the default.
- **Impact:** The dashboard does not show real KDC Savannah data by default.
  Until Snowflake is the primary source, every screenshot is fiction.
- **Fix path:** Exec plan `001-snowflake-integration` — wire Snowflake as
  the default data source, demote mock to fallback only.
- **Note:** The mock generator itself stays (see core-beliefs.md
  principle #6). Only its role changes — from "default" to "explicit
  fallback."

---

## P1

### Single-file 6,412-line component

- **Current state:** `src/ShippingSLAApp.jsx` is 6,412 lines. (README.md
  still says 2,772 — the README is stale.) Page components are already
  organized inside the file (`AIRiskPage`, `SplitShipmentPage`,
  `GeoPage`, `CostsPage`, `CustomerImpactPage`, `SKUProblemPage`,
  `ShiftHeatmapPage`, `AdminSLAPage`, `LoginPage`, `AdminPortalPage`,
  `SnowflakeSettingsPage`, `InboundPage`, `StoragePage`, `LaborPage`,
  `WavesPage`, `OptimizerPage`, `ForecastPage`, `FlightBoardPage`,
  `EconomicsPage`, `DataHubPage`, `EventCalendarPage`).
- **Impact:** Hot reload and IDE responsiveness degrade. Code review
  diffs are unwieldy. Multiple agents working in parallel collide.
- **Fix path:** Split by page component into `src/pages/<Page>Page.jsx`.
  CLAUDE.md explicitly authorizes this split — do it when the user asks,
  not before. Trigger conditions: file passes 8,000 lines, or two
  near-simultaneous PRs touch different pages and conflict.

### No persistence layer

- **Current state:** SLA config edits, KPI targets, favorites, and session
  user live in component state and `localStorage`. Refresh on a different
  browser loses everything except favorites/session.
- **Impact:** Admin SLA edits do not persist across users or devices. The
  audit log is per-browser-session.
- **Fix path:** Postgres config DB + `/api/sla-targets`, `/api/audit-log`
  endpoints. Roadmap Phase 2.

### README.md and CLAUDE.md describe an outdated two-source model

- **Current state:** Both files describe the architecture as "SAP + SCALE
  via API layer," which is the old mental model. The correct model
  (Snowflake-as-single-source) is captured in `ARCHITECTURE.md` and
  `docs/design-docs/core-beliefs.md`.
- **Impact:** New contributors reading the README first will form the
  wrong model and may write code that bypasses Snowflake.
- **Fix path:** Update README.md and CLAUDE.md to point to ARCHITECTURE.md
  as authoritative. Small standalone exec plan.

### Hidden dependency — `kdc_intelligence_foundation.sql`

- **Current state:** `server.js` line 5 (header comment) references
  `kdc_intelligence_foundation.sql` as the source of all semantic views
  (`V_*`, `VOP_*`, `VPROD_*`, `VEXC_*`) and the `KISS_BI_CONFIG` table.
  The file is **not in the repo**.
- **Impact:** Source of all 11 missing-view stubs and the missing config
  table. Without it we cannot reproduce the colleague's intended view
  layer in our own Snowflake account; we have to either obtain it or
  recreate from scratch.
- **Fix path:** Ask the prototype author (origin remote
  `grandmasterchris/KDC_Intelligence_v1`) for the file. If unavailable,
  recreate from `manhattan-scale-config` skill references and the
  `viewNotReady()` view names in `server.js`.

### Missing Snowflake views (11 stubs)

- **Current state:** Eleven `server.js` endpoints return
  `viewNotReady(viewName)` because their backing views do not exist in
  Snowflake yet:
  - `VOP_CONSOL_LOCATION_USAGE`, `VOP_OPEN_MANIFESTS`
  - `VPROD_QC_BY_STATION`, `VPROD_QC_BY_USER`, `VPROD_PICK_CYCLE`,
    `VPROD_AUTOSTORE_THROUGHPUT`
  - `VEXC_SHORT_PICKS`, `VEXC_QC_FAILURES`, `VEXC_RL_MISSING_PRO`,
    `VEXC_IB_RECONCILIATION`, `VEXC_QC_FAIL_RATE_ALERT`
- **Impact:** The Split Shipments page is the highest-priority blocker —
  it depends on `VEXC_SHORT_PICKS` (currently stubbed at
  `server.js:368`).
- **Fix path:** Either deploy `kdc_intelligence_foundation.sql` (see
  above), or **bypass the view** for Split Shipments by querying
  `SCI.L0` raw tables using the EX11 PGI flag (`SD.UDF3`). The reference
  SQL for the bypass is in
  `docs/references/snowflake-schema.md` → "Reference SQL — split
  shipments in the last 30 days."

### `KISS_BI_CONFIG` table missing

- **Current state:** `GET /api/scale/config` (`server.js:451`) returns
  hardcoded mock thresholds; `PUT /api/scale/config/:key`
  (`server.js:467`) is a no-op stub that responds
  `requires: 'KISS_BI_CONFIG'`.
- **Impact:** Configurable operational thresholds (stuck-shipment hours,
  pick SLA minutes, OTD target, etc.) cannot be edited end-to-end. The
  admin SLA editor in the UI is purely client-side until this is wired.
- **Fix path:** Create `KISS_BI_CONFIG` (likely DDL is in
  `kdc_intelligence_foundation.sql`); seed with the defaults currently
  hardcoded in `server.js:454-461`; replace the stub PUT with a real
  `UPDATE`.

### `SCI.PUBLIC` schema layer unverified

- **Current state:** `server.js` calls 6 endpoints against
  `SCI.PUBLIC.SHIPMENT_HEADER`. We have not independently verified
  whether `SCI.PUBLIC.SHIPMENT_HEADER` is a base table, a view over
  `SCI.L0.SHIPMENT_HEADER` (with derived columns), or a synonym.
  `SCI.L0.SHIPMENT_HEADER` itself is user-verified.
- **Impact:** Without confirming `PUBLIC`, exec plans cannot reliably
  decide whether to query `PUBLIC` or `L0` for headers, and how column
  projections may differ between the two.
- **Fix path:** Run `SELECT TABLE_TYPE FROM SCI.INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'PUBLIC' AND TABLE_NAME = 'SHIPMENT_HEADER';` —
  if `VIEW`, capture DDL via `GET_DDL('VIEW',
  'SCI.PUBLIC.SHIPMENT_HEADER')` and paste into
  `docs/references/snowflake-schema.md`. Effort: ~5 minutes once
  Snowflake access is in hand.

### Frontend / backend column-name mismatch

- **Current state:** `server.js` returns UPPERCASE Snowflake columns
  (`SHIPMENT_ID`, `CUSTOMER_NAME`, `SHIP_TO_STATE`, ...). The frontend's
  `FactShipment` shape — established by `public/sample-data.csv` and
  `handleUpload` at `src/ShippingSLAApp.jsx:5256` — uses lowercase keys
  (`id`, `customer`, `state`, `cause`, `isSplit`, ...). No conversion
  layer exists today.
- **Impact:** The live data path currently overlays only top-strip KPIs
  (`liveKpis` at `src/ShippingSLAApp.jsx:5032`) onto the executive page;
  it does not feed Split / Geo / Flight Board because the row shape
  doesn't match the consumers' expectations.
- **Fix path:** Decide between (a) server-side rename in `executeQuery()`
  / per-handler, or (b) frontend adapter on the fetch site. To be
  resolved in the master plan for `001-snowflake-integration`.

---

## P2

### AI risk model is heuristic

- **Current state:** `AIRiskPage` (`src/ShippingSLAApp.jsx:982`) computes
  risk via hand-tuned thresholds.
- **Impact:** Acceptable for prototype; will undershoot or overshoot once
  used at scale.
- **Fix path:** Trained ML model with explainable feature attributions.
  Roadmap Phase 3. Must preserve the explanation surface (core-beliefs.md
  principle #4).

### Mobile responsiveness incomplete

- **Current state:** Several controls in the top bar and filter bar are
  hidden behind `hidden md:flex` / `hidden md:block`, and not all pages
  have been audited at narrow widths.
- **Impact:** DC floor supervisors on phones get a degraded experience.
- **Fix path:** Roadmap Phase 5 — full responsive audit page-by-page.

### CSV upload uses naive `split(',')`

- **Current state:** `handleUpload` at `src/ShippingSLAApp.jsx:5256`
  splits on `,` directly. Quoted fields containing commas (e.g. address
  strings, delay notes) will misparse.
- **Impact:** Real-world CSVs from SAP exports often contain quoted
  commas. Currently masked because the canonical path is Snowflake, not
  CSV. Promote priority if CSV becomes a primary ingest path again.
- **Fix path:** Swap the manual parser for PapaParse or equivalent.

### `server.js` at project root is undocumented

- **Current state:** A 43 KB `server.js` file sits at the project root and
  the frontend already calls `http://localhost:3001/api/...` from the
  live-mode toggle (line 5042 onward). It is not described in README.md,
  CLAUDE.md, or `docs/architecture.md`.
- **Impact:** Anyone setting up the project from README alone will miss
  that there's a backend to start, and will see "API server unreachable"
  toasts without knowing why.
- **Fix path:** Document `server.js` as part of the
  `001-snowflake-integration` exec plan, or extract it into its own
  documented module under `server/`.

### `IN_DELETION = 'N'` filter is redundant in existing server.js endpoints

- **Current state:** 12 working endpoints in `server.js` apply
  `WHERE IN_DELETION = 'N'` to every shipment query. F0 validation
  on 2026-04-29 confirmed Snowflake data contains only `'N'` values
  for this column — upstream ETL filters `'Y'` rows out before
  loading.
- **Impact:** None at runtime — the filter excludes zero rows. The
  cost is consistency: new Phase 1 endpoints omit the filter (per
  master plan §6a F0), so reading `server.js` shows two patterns
  side-by-side and creates minor cognitive overhead for future
  contributors.
- **Fix path:** Remove `WHERE IN_DELETION = 'N'` (and the matching
  `AND IN_DELETION = 'N'` clause where it appears alongside
  `WHERE WAREHOUSE = 'KDCGA1'`) from the 12 existing endpoints in a
  dedicated cleanup PR after Phase 1 ships. No behavior change
  expected; verify by spot-checking row counts before and after.
  Not blocking — pure consistency work.
