# Core Beliefs

The principles this project will not violate without an explicit, documented
exception. Read this before writing any exec plan, and verify the plan does
not conflict with what's here. If it does, either revise the plan or amend
this doc as a separate change first.

These are extracted from the operational reality at KDC/KISS Savannah —
not invented. The source signals are in `README.md` (the "Prototype Features"
list and the roadmap) and `CLAUDE.md` (the "Key pain points" section).

---

## Why this project exists

KDC/KISS Savannah runs Manhattan Active SCALE (WMS) integrated with SAP (ERP)
to ship CPG cosmetics for the KISS Beauty Group brands (Kiss, Red, Ivy,
Vivace) plus partner channels. Operations, customer service, and the
executive team each see only part of the truth: SCALE shows what's on the
floor, SAP shows what was promised to the customer, and chargebacks land
weeks later. The dashboard's job is to make one operational picture out of
those parts so delays get caught before they become customer-visible
failures.

---

## Principles

### 1. Snowflake is the primary source of truth for the frontend.

SCALE and SAP data are pre-consolidated in Snowflake by an upstream pipeline
the data team owns. The frontend talks only to Snowflake (via an API layer).
Direct SAP integration and direct SCALE database access are out of scope.
Joins between SAP-origin and SCALE-origin tables happen in Snowflake SQL,
not in the frontend or in API business logic.

The API layer uses an adapter pattern, so additional sources (e.g., MSSQL
for SCALE raw or EXTACTA) can be added later without restructuring consumers.
Until such a need is documented in an exec plan, no other adapters are implemented.

**Why:** dual auth paths, dual outage modes, and frontend-side joins
multiply complexity and surface area. They also push schema knowledge into
the wrong layer. See `ARCHITECTURE.md` for the full reasoning.

### 2. Operations should get SLA risk signals without leaving SCALE's mental model.

The dashboard's stages mirror the operational reality: order create →
confirm → wave release → pick → pack → ship confirm → carrier scan →
delivery. The shift heatmap and root-cause categorization (UPS / DC /
Missing / Damage / Other) match how the floor already talks about delays.

**Why:** if the dashboard forces ops to learn a new vocabulary, they
will not use it. Adoption is a feature.

### 3. Split shipment is a customer hard requirement — it is compliance, not a KPI.

Customers like Ulta, Target, and Amazon require all cartons of an order
ship the same day. A split is a contract violation, not a metric to
trend. The Split Shipment page (`SplitShipmentPage`,
`src/ShippingSLAApp.jsx:1169`) treats it accordingly.

**Why:** treating splits as "just another KPI" hides chargeback exposure
and misframes the conversation with merchants.

### 4. AI risk scores must be explainable — operations will not trust opaque models.

Operations acts on these signals in real time. Whether the model is today's
heuristic or a future trained model (roadmap Phase 3), the page
(`AIRiskPage`, `src/ShippingSLAApp.jsx:982`) must surface *why* a shipment
is flagged — which stage is late, which cause category, which customer impact —
alongside the score. The explanation is what makes the score actionable, and
it is also what makes a Customer Service notification draft credible.

**Why:** a black-box score with no rationale gets ignored regardless of
accuracy. CS reps cannot send a customer notification that says 'AI flagged
this' — they need the underlying reason to communicate.

**Note:** this principle covers both the AI Risk page and the CS notification
draft feature. Proactive customer communication is a downstream consequence
of explainability, not a separate principle.

### 5. Dollars-at-risk is the executive priority signal.

KPIs in cartons or shipments don't compete for executive attention. The
`$ at Risk` view (`CostsPage`, `src/ShippingSLAApp.jsx:1469`)
re-denominates operational risk into chargeback exposure and annualized
run-rate so the right thing gets escalated.

**Why:** what gets measured in dollars gets resourced.

### 6. The mock data generator stays.

`generateMockShipments()` at `src/ShippingSLAApp.jsx:90` is the fallback when
no CSV is loaded and (in target state) when Snowflake is unreachable. It
also makes the prototype demoable on a laptop with no network. Removing it
breaks both the demo path and the offline degraded mode.

**Why:** a dashboard that goes blank on a Snowflake outage is worse than
one that shows clearly-labeled mock data and keeps the layout legible.

### 7. When SAP and SCALE disagree, the dashboard names the disagreement — it does not pick a winner silently.

SAP and SCALE drift apart in three layers: system-level state mismatch,
TPA (Third Party Application) confirmation gaps, and physical-vs-system
discrepancies. A shipment can be 'shipped' in SAP and 'in pick' in SCALE
at the same time. The dashboard does not silently pick one side as truth
to compute its KPIs — when the two disagree at a level material to the
KPI being shown, the row is flagged so ops can investigate.

This applies especially to:
- SLA timeline (which timestamp counts as 'shipped'?)
- $ at Risk (do we count chargebacks for shipments SAP says are out the door?)
- Inventory-related views (item_balance vs SAP stock)

**Why:** silently choosing one side hides the data quality problem and
produces KPIs that look clean but mislead. Naming the disagreement turns
a hidden problem into a visible one — which is the whole point of an
operations dashboard.

### 8. Snowflake is read-only from this codebase — writes go through SCALE/SAP, never us.

The dashboard is a Snowflake consumer. All SQL this codebase generates
must be read-only: `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN`,
`INFORMATION_SCHEMA`. Writes (`INSERT`/`UPDATE`/`DELETE`/`MERGE`), DDL
(`CREATE`/`DROP`/`ALTER`/`TRUNCATE`), and stored procedure invocations
(`CALL`) are forbidden, including indirect cases — no `COPY INTO`, no
`GRANT`/`REVOKE`.

This is enforced because production shipping data lives upstream in
SCALE WMS and SAP ERP. Their stored procedures (`KISS_EXP_*`) and
interfaces already write to Snowflake on a schedule we do not control.
Any write from this codebase creates a race condition with the
upstream systems and risks corrupting the data the operations team
relies on.

If a future need genuinely requires a Snowflake write — creating a
view, seeding `KISS_BI_CONFIG`, etc. — that is a separate, explicitly
user-approved exec plan, never an incidental change inside another task.

**Why:** the cost of a bad write to production shipping data is far
larger than any value an AI agent can deliver inside a single task.
The asymmetry of risk and reward is the entire reason for the rule.

**Operational corollary:** if an exec plan or task seems to require a
write, that is a STOP signal — surface it to the user, do not
"prepare" or "draft" the write SQL.
