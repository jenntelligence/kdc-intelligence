# Snowflake Schema Reference

**Status:** in progress (filled by exec plan `001-snowflake-integration`).
The Split Shipment workflow is fully documented below from the
`manhattan-scale-config` skill. Other domains are still placeholders and 
will be filled when their exec plans begin.

---

## Context

Snowflake hosts data from two upstream systems, in **different schemas**:

- **SCALE-origin tables** — replicated from the SQL Server SCALE WMS instance.
  Table and column names match the SCALE source verbatim. Snowflake column
  names are typically UPPERCASE.
- **SAP-origin tables** — landed by the data team's pipeline.

Cross-schema joins are required for any KPI that mixes SAP-origin and
SCALE-origin data (e.g., chargebacks against shipments).

The full data flow is in `ARCHITECTURE.md`. The frontend never connects to
SCALE or SAP directly — only Snowflake.

The `manhattan-scale-config` skill is the starting source for SCALE knowledge,
but **this document supersedes it where they disagree** — KDC's operational
configuration moves faster than the skill is updated (example: the Red
sales org, documented below but absent from the skill). Always trust this
file over the skill when entries differ.

---

## DB / schema paths — verified vs unverified

### Verified facts (confirmed via code or directly with the user)

- **`SCI`** is the Snowflake database name. (33 occurrences in `server.js`,
  user-confirmed.)
- **`SCI.L0`** exists and contains the raw landing layer. Confirmed tables
  in this schema:
  - `SHIPMENT_HEADER` — user-verified directly in the Snowflake console.
  - `SHIPMENT_DETAIL`, `SHIPPING_CONTAINER`, `LAUNCH_STATISTICS`,
    `TRANSACTION_HISTORY`, `PROCESS_HISTORY`, `WORK_INSTRUCTION`,
    `ITEM_UNIT_OF_MEASURE` — referenced by working endpoints in
    `server.js`, so they exist (not independently verified, but the
    endpoints are observably operational against this schema).
- **Authentication: externalbrowser SSO via Entra ID.**
  Confirmed via `server.js`: `authenticator: 'externalbrowser'`, no password
  ever transits the API, the Snowflake SDK opens a browser tab on first
  query, and the resulting session token is cached for subsequent queries.

### Unverified — TODO: confirm in Snowflake console

- **Is `SCI.PUBLIC.SHIPMENT_HEADER` a table or a view?**
  `server.js` uses this path in 6 working endpoints, so something must
  exist there. Possibilities:
  - A base table (independent copy of header data).
  - A view over `SCI.L0.SHIPMENT_HEADER` (with derived columns).
  - An alias/synonym to L0.

  The probable answer is "view defined in
  `kdc_intelligence_foundation.sql`," but that file is not in this repo.
  Until the DDL is inspected, treat `SCI.PUBLIC.SHIPMENT_HEADER` as a
  best-effort path that *might* differ from `SCI.L0.SHIPMENT_HEADER` in
  derived columns or row filtering.
- **Other schemas in `SCI`** — `L1`, `L2`, `RAW`, `STAGING`, etc. are
  unknown. `server.js` only references `PUBLIC` and `L0`.
- **`kdc_intelligence_foundation.sql`** — referenced in the `server.js`
  header comment but absent from the repo. Required to understand the
  semantic-view layer (`V_*`, `VOP_*`, `VPROD_*`, `VEXC_*`) that 11 of
  `server.js`'s endpoints stub out via `viewNotReady()`. Action: ask the
  prototype author for this file. Logged in `tech-debt-tracker.md`.
- **SAP-origin tables** — schema location and table list TBD.
- **Network access** — whether the dev environment reaches Snowflake
  directly or through a proxy / API gateway.
- **Replication freshness** — how recent is data in Snowflake relative to
  the live SCALE WMS? Drives the "live" vs "near-live" framing in the UI.

### Working guidelines (until verified)

When writing SQL for new exec plans:

- **Prefer `SCI.L0.*` for raw-data needs.** Split Shipment uses the EX11
  PGI flag at `SD.UDF3` — that is raw, definitely landed in L0.
- **Reference `SCI.PUBLIC.*` only when extending existing `server.js`
  endpoints** that already use PUBLIC successfully:
  `overview-kpis`, `lifecycle-heatmap`, `otd`, `daily-volume`,
  `stuck-shipments`, `shipments`. Reusing the same path keeps the new
  endpoint consistent with the existing ones — and if PUBLIC turns out
  to be a view, all six endpoints (and any new sibling) inherit the same
  derivation.
- **Do not assume `PUBLIC` mirrors every `L0` table.** If unsure, check
  in the Snowflake console first or fall back to `L0`.

_Note: this section's stale-example warning ("the `SCALE_DB.WMS.`
placeholders are stale") is now resolved as of the `SCI.L0` update below._

### Verification queries (when the team has Snowflake access)

```sql
-- List all tables and views in SCI
SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
FROM SCI.INFORMATION_SCHEMA.TABLES
ORDER BY TABLE_SCHEMA, TABLE_NAME;

-- For SCI.PUBLIC.SHIPMENT_HEADER specifically — if it's a view, get the DDL
SELECT GET_DDL('VIEW', 'SCI.PUBLIC.SHIPMENT_HEADER');

-- See all schemas in SCI
SHOW SCHEMAS IN DATABASE SCI;
```

Update the **Verified facts** and **Unverified** subsections above once
the results are in.

_The example SQL further down has been updated to use SCI.L0 paths
(verified in commit d6df257). This warning is preserved as a marker
in case the schema doc and SQL examples drift again in the future._

---

## Open environment questions

Items still blocking the first end-to-end SQL execution against Snowflake
from a new endpoint:

- [ ] **Is `SCI.PUBLIC.SHIPMENT_HEADER` a table or a view?** If view,
      capture the DDL.
- [ ] **Other schemas in `SCI`** — list and purpose.
- [ ] **`kdc_intelligence_foundation.sql`** — obtain from prototype author;
      tracked in `docs/exec-plans/tech-debt-tracker.md`.
- [ ] **SAP-origin tables** — schema location and table inventory.
- [ ] **Network access** — direct from dev environment, or via proxy?
- [ ] **Replication freshness** — Snowflake vs live SCALE lag.

Resolved items (moved to **Verified facts** above):

- [x] Snowflake database name → **`SCI`**.
- [x] At least one schema for SCALE tables → **`L0`** (raw replicas).
- [x] Authentication method → **externalbrowser SSO via Entra ID**.

---

## SCALE-origin tables

Source: `manhattan-scale-config` skill, plus KDC-specific corrections noted
inline. Table and column names below are verified against KDC's actual
SCALE configuration. UDF mappings are KISS-specific and **not** transferable
to other Manhattan SCALE tenants.

### Core tables and aliases

| Table | Alias | Description |
|-------|-------|-------------|
| `SHIPMENT_HEADER` | SH | Outbound shipment header — customer, carrier, dates, status |
| `SHIPMENT_DETAIL` | SD | Shipment line items — item, qty, allocation rule |
| `SHIPPING_CONTAINER` | SC | Containers/pallets/totes for a shipment |
| `WORK_INSTRUCTION` | WI | Pick/putaway work tasks generated by wave |
| `WORK_TYPE` | WT | Work type configuration |
| `WAVE_MASTER` | WM | Wave header |
| `PROCESS_HISTORY` | PH | Process history / audit log |
| `ITEM_BALANCE` | IB | Inventory balance by item/company/location |
| `LOCATION_INVENTORY` | LI | Inventory at specific locations |
| `DOCK_LOCATION` | DL | Dock door and consolidation location config |
| `CARRIER` | C | Carrier master |
| `ITEM_MASTER` | IM | Item configuration |

### KISS custom UDF mappings

UDFs are renamed via business meaning. Always alias them when querying
(`SH.USER_DEF1 AS SALES_ORG`) so SQL stays readable.

#### `SHIPMENT_HEADER` (SH)
| Field | KISS meaning | Set by |
|-------|-------------|--------|
| `USER_DEF1` | Sales Organization (1000=Kiss, 1100=Ivy, 1400=Red, 1900=Vivace) | SAP interface |
| `USER_DEF12` | R&L carrier API payload string (delimited by `*`) | SAP interface |
| `PRO_NUM_ALPHA` | R&L Pro Number | EX27 API response |
| `CONSOLIDATION_DOCK_LOC_AREA` | Shipment consolidation area code (e.g., 'P') | EX22 |
| `CONSOLIDATION_DOCK_LOC_POS` | Shipment consolidation position (e.g., '01') | EX22 |
| `ROUTE` | Populated with Sales Org for load splitting | AI002 wave step |

#### `SHIPMENT_DETAIL` (SD)
| Field | KISS meaning | Set by |
|-------|-------------|--------|
| `UDF3` | **PGI Flag** — `'Y'` = complete, `'N'` = split (not complete) | EX11 exit point |
| `UDF8` | Short pick qty adjustment (requested - qty at status 999) | EX11 exit point |

#### `SHIPPING_CONTAINER` (SC)
| Field | KISS meaning | Set by |
|-------|-------------|--------|
| `USER_DEF1` | Tote ID | EX12 nesting |
| `USER_DEF2` | Pallet consolidation location (free-form, max 25 chars) | EX12 nesting |
| `UDF3` | Multi-purpose: `'Nested'` (EX12 child), `'Consol'` (EX22), `'Invoice'` (EX23) | EX12/EX22/EX23 |
| `QC_STATUS` | QC evaluation status (0/1/2/3 — see below) | EX03/EX28 |
| `MANIFEST_FOR_DATE` | Manifest date for carrier | Base SCALE |
| `MANIFEST_CLOSE_DATE_TIME` | Manifest close timestamp (NULL = open) | Base SCALE |
| `TRACKING_NUMBER` | Carrier tracking number | Connectship/Rate |

#### `DOCK_LOCATION`
| Field | KISS meaning |
|-------|-------------|
| `UDF1` | Sales Org filter for consolidation locations |
| `DOCK_LOCATION_AREA` | Consolidation area code |
| `DOCK_LOCATION_POSITION` | Consolidation position |

#### `WORK_TYPE` (WT)
| Field | KISS meaning |
|-------|-------------|
| `UDF2` | `'Y'` = use EX22 shipment consolidation flow |

#### `PROCESS_HISTORY` (PH)
| Field | Description |
|-------|-------------|
| `PROCESS` | Process code (e.g., '840' for QC) |
| `ACTION` | Action code (`'280'`=QC Start, `'290'`=QC Pass via EX03, `'300'`=QC Pass via EX28 RFID) |
| `IDENTIFIER1` | Container ID |
| `IDENTIFIER2` | QC Status |
| `IDENTIFIER3` | Pack Time |
| `IDENTIFIER4` | Hold Time |
| `MESSAGE` | Pack Station name |
| `PROGRAM` | `'EX03_QC_Capture'` or `'EX28_QC_Capture'` |
| `USERNAME` | User who performed action |
| `WAREHOUSE` | Warehouse code |

### Sales Org values (`SH.USER_DEF1`)
| Value | Company |
|-------|---------|
| 1000 | Kiss |
| 1100 | Ivy |
| 1400 | Red |
| 1900 | Vivace |

> **Note on Red (1400):** Red is a more recent addition to KISS's sales
> org list and is not yet reflected in the `manhattan-scale-config` skill
> (which still shows only Kiss / Ivy / Vivace). This document is the
> corrected source. If the skill and this file disagree on sales orgs,
> trust this file.

### Trailing status codes (`SH.TRAILING_STATUS`)
| Status | Description |
|--------|-------------|
| 100 | In Pool — shipment downloaded, awaiting wave |
| 200 | Waved |
| 300 | Allocated |
| 400 | Picking Pending |
| 401 | In Packing |
| 500 | Packing Complete |
| 600 | Staging Pending |
| 650 | Loading Pending — LTL interface trigger (EX27 R&L API fires here) |
| 700 | Ship Confirm Pending — parcel interface trigger |
| 800 | **Shipped** — upload to host |
| 900 | Closed |
| 999 | Deleted/Rejected (short pick) |

KISS-specific thresholds:
- "Shipped" for KPI purposes: `TRAILING_STATUS >= 800`
- EX25 IB Upload exclusion: parcel `>= 700`, LTL `>= 650`
- EX22 consol location occupied: `<= 600`
- EX11 PGI split-incomplete check: `< 900`

### QC status codes (`SC.QC_STATUS`)
| Code | Status |
|------|--------|
| 0 | Not Required |
| 1 | Pending |
| 2 | Failed |
| 3 | Completed/Passed |

### Always-applied filters

For KDC Savannah, every SCALE query should include:

```sql
WHERE SH.WAREHOUSE = 'KDCGA1'
```

Cross-warehouse queries are out of scope today.

---

## Split Shipment domain (covered in detail because this is the first exec plan)

### How split is determined — **the dashboard does not compute this**

EX11 (KISS custom extension) registers a **Before Shipment Upload** exit
point that runs the stored procedure `KISS_EXP_UploadShipmentBefore` every
time SCALE is about to send a shipment to SAP. That procedure writes the
**PGI Flag** to `SD.UDF3`:

- `SD.UDF3 = 'Y'` → shipment is complete (no split)
- `SD.UDF3 = 'N'` → shipment is split (one or more lines incomplete, 
  trailing status `< 900`)

**Implication for the dashboard:** the frontend reads the PGI flag — it
does not recompute split logic. This is principle #1 of `core-beliefs.md`
in practice: business logic stays in the source system, the dashboard
surfaces it.

`SD.UDF8` carries the short-pick quantity (`requested_qty` minus quantity
at status 999), which lets us show *how much* was short, not just *that*
something was short.

### Two related but distinct concepts

| Concept | Field | Question it answers |
|---------|-------|---------------------|
| **PGI Flag (split)** | `SD.UDF3` | Was the order completed in one shipment? |
| **Same-day compliance** | `SC.MANIFEST_FOR_DATE` across containers | Did all cartons leave on the same calendar day? |

Customers like Ulta / Target / Amazon enforce same-day compliance as a
contract term, which is stricter than just "not split." A single-line
shipment with `UDF3 = 'Y'` could still violate same-day if its containers
manifest across two days. **Both checks are needed.** TODO: confirm with
ops which customer SLAs use which definition.

### Reference SQL — split shipments in the last 30 days

This query is the basis for the `SplitShipmentPage` data hook. It is
written for Snowflake against the `SCI.L0` raw layer (per the working
guidelines above — Split Shipment depends on UDF fields that may not be
preserved in `SCI.PUBLIC` views).

```sql
-- Uses SCI.L0 (raw layer) because UDF fields like SD.UDF3 are KISS-specific
-- raw columns. SCI.PUBLIC views may not preserve all UDFs — verify before
-- switching.
SELECT 
    SH.SHIPMENT_ID,
    SH.USER_DEF1                                      AS SALES_ORG,
    SH.SHIP_DATE,
    SH.TRAILING_STATUS,
    SH.CARRIER_CODE,
    SH.SHIP_TO_NAME                                AS CUSTOMER_ID,
    COUNT(DISTINCT SD.SHIPMENT_LINE_NUMBER)           AS LINE_COUNT,
    -- Split: at least one detail line has PGI = 'N'
    MAX(CASE WHEN SD.UDF3 = 'N' THEN 1 ELSE 0 END)    AS IS_SPLIT,
    SUM(IFNULL(SD.UDF8, 0))                           AS SHORT_PICK_QTY,
    COUNT(DISTINCT SC.INTERNAL_CONTAINER_NUM)         AS CARTON_COUNT,
    MIN(SC.MANIFEST_FOR_DATE)                         AS FIRST_MANIFEST_DATE,
    MAX(SC.MANIFEST_FOR_DATE)                         AS LAST_MANIFEST_DATE,
    -- Same-day compliance: first/last manifest day differ
    CASE WHEN MIN(SC.MANIFEST_FOR_DATE)::DATE 
            != MAX(SC.MANIFEST_FOR_DATE)::DATE
         THEN 1 ELSE 0 END                            AS SAME_DAY_VIOLATION
FROM SCI.L0.SHIPMENT_HEADER     SH
INNER JOIN SCI.L0.SHIPMENT_DETAIL    SD
    ON SD.INTERNAL_SHIPMENT_NUM = SH.INTERNAL_SHIPMENT_NUM
LEFT JOIN  SCI.L0.SHIPPING_CONTAINER SC
    ON SC.INTERNAL_SHIPMENT_NUM = SH.INTERNAL_SHIPMENT_NUM
WHERE SH.WAREHOUSE      = 'KDCGA1'
  AND SH.TRAILING_STATUS >= 800            -- shipped or beyond
  AND SH.SHIP_DATE      >= DATEADD(day, -30, CURRENT_DATE())
GROUP BY 
    SH.SHIPMENT_ID, SH.USER_DEF1, SH.SHIP_DATE, 
    SH.TRAILING_STATUS, SH.CARRIER_CODE
HAVING MAX(CASE WHEN SD.UDF3 = 'N' THEN 1 ELSE 0 END) = 1   -- splits only
    OR (MIN(SC.MANIFEST_FOR_DATE)::DATE 
        != MAX(SC.MANIFEST_FOR_DATE)::DATE)                  -- or same-day violation
ORDER BY SH.SHIP_DATE DESC;
```

### Snowflake syntax notes (vs SQL Server)
| SQL Server | Snowflake |
|-----------|-----------|
| `GETDATE()` | `CURRENT_TIMESTAMP()` / `CURRENT_DATE()` |
| `DATEDIFF(SECOND, a, b)` | `DATEDIFF('SECOND', a, b)` |
| `FORMAT(date, 'pat')` | `TO_CHAR(date, 'pat')` |
| `ISNULL(a, b)` | `IFNULL(a, b)` or `COALESCE(a, b)` |
| `TOP N` | `LIMIT N` |
| `CONVERT(type, val)` | `val::type` or `CAST(val AS type)` |
| `+` (string concat) | `||` |

### Stored procedures relevant to split logic
| Procedure | Purpose |
|-----------|---------|
| `KISS_EXP_UploadShipmentBefore` | Sets `SD.UDF3` (PGI) and `SD.UDF8` (short pick) before SAP upload. Called automatically — frontend does not invoke it. |

### Open questions for the Split Shipment exec plan

- [ ] What is the customer name / customer ID column on `SHIPMENT_HEADER`?
      (`SHIP_TO_NAME`? `SHIP_TO_CUSTOMER`? confirm against actual schema)
- [ ] Which customer SLAs use *split* (PGI flag) vs *same-day*
      (manifest date) as the contractual definition?
- [ ] Do any customers allow split shipments by exception (e.g., orders
      above a carton threshold)? If yes, where is that rule encoded?
- [ ] What time zone is `SHIP_DATE` and `MANIFEST_FOR_DATE` stored in?
      (Savannah local? UTC?) This affects same-day computation.
- [ ] What is the maximum lookback window the page should support?
      (30 days? 90 days? user-selectable?)

---

## SAP-origin tables

**Status:** placeholder. Will be filled when an exec plan first needs SAP
data (e.g., chargeback reporting, customer master enrichment for the
Customer Impact page).

Likely tables (TODO: confirm names in Snowflake):
- Customer master
- Material master
- Sales order header / line items
- Pricing / chargeback tables
- Sales org master

Likely cross-schema join keys (TODO: confirm column names):
- Order number — SAP sales doc ↔ `SH.ORDER_ID` or similar SCALE field
- Customer ID — SAP customer ↔ SCALE ship-to
- Material/SKU — SAP material ↔ SCALE `ITEM_MASTER.ITEM`

---

## Other SCALE domains (placeholders — fill when needed)

These tables and UDFs above are sufficient for the Split Shipment page.
The other dashboard pages will need additional context from
`manhattan-scale-config` skill references — not reproduced here to keep
this document focused. The relevant skill references are:

| Dashboard page | Skill reference to consult |
|----------------|----------------------------|
| AI Risk & Alerts | (cross-cutting; uses the same tables as Split Shipment) |
| SLA Timeline | `references/general/eCom_Solution_Design_Document.md` (stage definitions) |
| Root Cause | EX11, EX23, EX29 (cause categories: UPS / DC / Missing / Damage) |
| Geographic | base SCALE customer/ship-to fields |
| $ at Risk | SAP chargeback tables + EX11 split data |
| Customer Impact | SAP customer master + SCALE shipment history |
| SKU Problems | EX29 QC + base item master |
| Shift Heatmap | `PROCESS_HISTORY` (PH) + EX03B QC metrics (`references/pick-pack-ship/EX03B_QC_Metrics.md`) |

When starting a new page exec plan, pull the relevant SCALE reference
into this document before writing SQL — keep the schema doc as the
single place SCALE knowledge lands for this project.

---

## Maintenance

- This document is updated **before** each page exec plan begins, as part
  of the plan's "current state" research.
- Do not add domain knowledge that no exec plan currently consumes.
- Do not invent column names. If unverified, mark `TODO: confirm`.
- The authoritative source for SCALE knowledge is the
  `manhattan-scale-config` skill — this file is a project-local
  extraction with KDC-specific corrections (see the Red sales org note
  above for an example of why this file can supersede the skill).