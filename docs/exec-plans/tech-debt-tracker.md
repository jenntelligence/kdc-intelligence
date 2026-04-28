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
