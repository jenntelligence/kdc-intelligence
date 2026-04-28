# ARCHITECTURE.md — KDC Shipping SLA Command Center

High-level architecture: where we are, where we're going, and what's
deliberately out of scope.

For detailed reasoning behind individual decisions, see
`docs/design-docs/core-beliefs.md` and the relevant entries in
`docs/exec-plans/`.

---

## Current State

- Single-file React + Vite + Tailwind prototype.
  - Main component: `src/ShippingSLAApp.jsx` (6,412 lines as of this writing —
    note that `README.md` says 2,772, which is stale; treat the README number
    as outdated).
  - Mounted via `src/App.jsx` → `src/main.jsx`.
- **Mock data generator** at `src/ShippingSLAApp.jsx:90` —
  `generateMockShipments()`. Initialized in `useState` at line 5006 and
  re-rolled by the refresh handler at line 5076.
- **CSV upload fallback** — `handleUpload` at `src/ShippingSLAApp.jsx:5256`,
  triggered by `<input type="file" accept=".csv">` at line 5643. Parses the
  `FactShipment` shape (see `public/sample-data.csv`).
- **Hardcoded role-based auth** — three roles (admin / manager / viewer) gated
  client-side; demo credentials in CLAUDE.md / README.md.
- **Live mode toggle (partial)** — there is already a `dataSource` state
  (`'mock'` | `'live'`) and a fetch to `http://localhost:3001/api/...` for
  Snowflake KPIs (line 5042, 5066, 5081). `server.js` at the project root is
  the in-progress API layer. This is the seed of the target state below — not
  finished.

---

## Target State

- **Snowflake is the primary source of truth for the frontend.**
- Snowflake hosts both SCALE (WMS)–origin tables and SAP (ERP)–origin tables.
  They are loaded into Snowflake by an upstream pipeline owned by the data
  team (see "Out of Scope" below).
- The frontend never talks to SAP or SCALE directly. It only talks to an API
  layer, and the API layer only queries Snowflake.
- SAP ↔ SCALE joins happen in **Snowflake SQL**, not in the frontend, and not
  in the API layer's business logic.
- Real SSO authentication via Okta (later phase).

---

## Data Flow

**Today:**

```
[generateMockShipments()] ──> React state (rawData) ──> filtered ──> UI
                                       ▲
                                       │
                              [CSV upload (handleUpload)]
                                       │
                              public/sample-data.csv shape
                              (FactShipment columns)
```

**Target:**

```
[SCALE WMS] ──┐
              ├──> [Snowflake] ──> [API layer (TBD)] ──> [React Query/SWR] ──> [UI]
[SAP ERP]  ───┘
(upstream pipeline,
 out of scope for this app)
```

The frontend stays a Snowflake **consumer**. It does not own the upstream
ingest, it does not own SAP↔SCALE reconciliation, and it does not own
identity resolution between the two source systems.

---

## Key Decisions

- **Snowflake is the primary source of truth.** Chosen because SCALE and SAP
  are already consolidated upstream by the data team. This avoids dual auth,
  dual API paths, and frontend-side joins. It also means there is no
  "Phase 1 SCALE / Phase 2 SAP" split — both arrive together from Snowflake
  from day one. The API layer uses an adapter pattern so additional sources
  (e.g., MSSQL for SCALE raw or EXTACTA) can be added later without
  restructuring consumers; until such a need is documented in an exec plan,
  no other adapters are implemented. See `docs/design-docs/core-beliefs.md` §1.
- **Keep the single-file structure — split only when necessary.** Per
  CLAUDE.md, the prototype lives in one file on purpose. Page-level splits
  (`src/pages/<Page>Page.jsx`) are only done when the user asks. See
  `tech-debt-tracker.md` for the trigger conditions.
- **No TypeScript.** Per CLAUDE.md.
- **Recharts is fixed** as the charting library. Do not introduce D3 or
  Chart.js. Per CLAUDE.md.
- **`public/sample-data.csv` is the contract.** Its `FactShipment` schema
  represents the shape of a SCALE+SAP join result *inside Snowflake*. The
  frontend treats this column set as the canonical wire format. The upstream
  pipeline's job is to materialize this shape (or the API layer's job is to
  project to it).

---

## Out of Scope

The following are explicitly **not** owned by this app:

- The upstream ETL/ELT that lands SCALE and SAP data into Snowflake.
- Direct SAP API integration (RFC, OData, BAPI, etc.).
- Direct SCALE database integration.
- Identity resolution between SAP customer master and SCALE customer master
  (handled in Snowflake by the data team — see
  `docs/references/snowflake-schema.md` for the join keys we depend on).
- The carrier tracking poller (UPS / FedEx). If this exists at all, it lands
  in Snowflake upstream. The frontend reads it as a column on the shipment
  fact.

If a feature request would force this app to take ownership of any of the
above, push back and route it to the data team first.
