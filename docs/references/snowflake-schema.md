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

## Trust hierarchy

When facts conflict between sources, the order of trust is:

1. **User-confirmed operational fact (highest)** — user has run a
   query against actual Snowflake or has direct domain knowledge.
   Examples: 2026-04-29 split shipment SQL, IN_DELETION 'N'-only
   verification.
2. **`snowflake-schema.md` Verified facts** — captured here only
   after user or external confirmation.
3. **manhattan-scale-config skill content** — extensive but has gaps.
   On 2026-04-29 grep found the UDF mapping table missing
   `1400=Red` (which is confirmed elsewhere). Use as starting
   point but not ground truth.
4. **`server.js` prototype patterns** — colleague's prototype, never
   independently validated. F0 in master plan §6a treats it as
   "starting point, validate before reuse."
5. **Plan SQL sketches (lowest)** — by definition speculative until
   tested against actual Snowflake.

When generating new SQL: anchor to (1) and (2). Cross-check (3) and
(4) only as supplementary signals. Always update (1) and (2) with
new facts as they are discovered.

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
- **Authentication: RSA key-pair (`SNOWFLAKE_JWT`).** SUPERSEDES the
  prior externalbrowser-SSO assumption — KDC environment does not
  support SSO. See § Snowflake authentication below for the discovery
  context, implementation pattern, and required env vars.
- **`SCI.PUBLIC.SHIPMENT_HEADER` is a Snowflake Dynamic Table**
  (user-confirmed). It is a managed materialized view over upstream
  data — Snowflake auto-refreshes it on a defined cadence. The exact
  DDL (which columns derive from L0 vs raw) has not yet been captured
  into this doc; capture it when first sub-plan needs to query
  `SCI.PUBLIC` fields beyond what L0 provides.
- **Replication freshness: ~10 minutes** (user-confirmed). MSSQL SCALE
  data lands in `SCI.L0` on a 10-minute cycle. Dashboard UI should
  frame data as "near-live" (last refresh ~Xm ago) rather than "live."
  Cache TTL on the frontend should not exceed 10 minutes — beyond
  that the cache becomes the bottleneck rather than replication.
- **Warehouse scope: KDCGA1 only** (user-confirmed via operations
  manager). No other warehouses are planned for 2026. The
  `WAREHOUSE = 'KDCGA1'` filter in `server.js` stays applied to every
  shipment query.
- **`IN_DELETION` column status: only `'N'` values present in
  Snowflake** (user-confirmed via direct Snowflake query). Upstream
  ETL appears to filter `'Y'` rows out before loading.

  Phase 1 implication: new endpoints **omit the `IN_DELETION = 'N'`
  filter**. Cost is zero (no rows to filter), and behavior is
  unchanged. Existing `server.js` endpoints retain the filter —
  inconsistency is tolerated since results are identical. A cleanup
  to remove the filter from existing endpoints is tracked as P2 in
  `tech-debt-tracker.md`.
- **Phase 1 page-level channel scope: Split Shipments + Geographic
  pages only** (user-confirmed via UI screenshot review). Both pages
  apply the same filter at their respective endpoint SQL:

  - `customer_group = 'TR'`
  - `sales_org IN ('1100', '1400', '1900')`

  Resulting channels:

  | Sales Org | Display Label (in selector) | Company Name |
  |-----------|------------------------------|--------------|
  | 1100      | BS - IVY                     | Ivy          |
  | 1400      | BS - RED                     | Red          |
  | 1900      | VIVACE                       | Vivace       |

  The "BS" prefix is a UI grouping label in the channel selector
  (likely "Beauty Supply" or "B2B Sales"); the actual company names
  are Ivy/Red/Vivace. Sales org 1000 (Kiss) belongs to a different
  customer_group and is excluded from the Split Shipment + Geographic
  compliance scope.

  **Important — this is a PAGE-level filter, not an app-level filter:**
  - The app's global channel selector (in the header) continues to
    show 11 channels — it is NOT modified by Phase 1.
  - The 3-channel filter is applied only within the
    `/api/scale/split-shipments` and `/api/scale/geo-summary`
    endpoints (or whatever the Geographic endpoint is named).
  - Other pages (Executive Summary, Flight Board, AI Risk, etc.)
    continue to use the full 11-channel scope from their own
    endpoints.
  - This reflects business policy: split-shipment compliance and
    Geographic analysis are tracked only for BS-IVY/BS-RED/VIVACE
    customers; other pages serve broader operational use cases.
- **Split Shipment root causes — 3 types** (user-confirmed). The
  mock UI labels (Trailer capacity, Wave cutoff missed, Short pick,
  SAP-SCALE variance, Pick exception) are fictional placeholders.
  The real operational root causes are:

  1. **Zone-level split:** an order's lines sit across multiple
     inventory zones (autostore, active, reserve). Each zone produces
     its own pick work — siblings finish at different times and can
     manifest separately.

  2. **Container-level split:** same order, multiple containers,
     different ship-confirm times. UPS picks up sibling boxes on
     different trucks — tracked as separate shipments.

  3. **Manifest-level split** ("the silent killer"): status 700
     (Ship Confirm Pending) fires before all sibling containers
     close. SCALE manifests what's ready; siblings end up on separate
     PDL files.

  Each type requires different data signals to detect:
  - Zone-level: `WORK_INSTRUCTION` zone distribution per shipment
  - Container-level: `SHIPPING_CONTAINER` ship-confirm timestamp variance
  - Manifest-level: `PROCESS_HISTORY` status 700 transition timing
    relative to sibling container close events

  Detection SQL details deferred to sub-plan `002`.
- **Zone-area derivation pattern (#13 grep finding 2026-04-29)** —
  `server.js` derives floor-area zones from
  `LEFT(SC.original_pick_loc, 2)` prefix codes (`server.js:495-498`):
  - `'AS'` → Pre-Pick / Autostore
  - `'PL'`, `'PR'`, `'PS'` → Pick Module (sub-areas)
  - `status` 400/401 → Pack Station

  The same prefix convention appears on `TH.location`
  (`server.js:547`). No `WORK_INSTRUCTION.ZONE` column is referenced
  anywhere in `server.js`. Whether `WI` itself has a zone-equivalent
  column TBD via direct Snowflake `DESCRIBE TABLE` during sub-plan
  `002`. Recommended path: use `LEFT(SC.original_pick_loc, 2)` for
  Type 1 detection; supersedes the master plan §6b sketch's
  `WI.ZONE` reference.
- **Container per-shipment ship event signal (#14 grep finding 2026-04-29)** —
  `SC.SHIP_CONFIRM_DATE_TIME` does NOT appear in `server.js` or
  schema doc. The documented per-container timestamp is
  `SC.MANIFEST_CLOSE_DATE_TIME` (already in the SC UDF table:
  "Manifest close timestamp; NULL = open"). For Container-level
  split detection (master plan §6b Type 2),
  `MANIFEST_CLOSE_DATE_TIME` variance across siblings is the most
  likely correct signal. `SHIPMENT_HEADER.TRAILING_STATUS = 700`
  ("Ship Confirm Pending") is per-order, not per-container — so it
  cannot replace this for Type 2 detection. Sub-plan `002` verifies
  in the Snowflake console and supersedes the master-plan sketch.
- **Date handling — SAP YYYYMMDD storage + Snowflake YYYY-MM-DD bind**
  (CONFIRMED 2026-05-08 via PR4a hotfix smoke). Two related but
  distinct facts; both must be respected together when writing
  parameterized date queries:

  1. **SAP-origin date columns are stored as `YYYYMMDD` strings
     (VARCHAR), not `DATE`.** Confirmed on
     `KDB.PBI_SF.ZSDRORDR.salesdocdate`; other SAP-origin tables
     likely follow the same convention (verify per use). NULL is
     encoded as the sentinel `'00000000'`, which must be filtered
     explicitly:

     ```sql
     CASE WHEN col = '00000000' THEN NULL ELSE col END
     ```

     Conversion to DATE for SQL operations:

     ```sql
     TO_DATE(CASE WHEN col = '00000000' THEN NULL ELSE col END, 'YYYYMMDD')
     ```

  2. **Snowflake bind variables for DATE comparison require
     `YYYY-MM-DD` format (with dashes).** When the SQL uses
     `TO_DATE(col, 'YYYYMMDD') >= ?`, the bind RHS goes through an
     implicit DATE cast, which only accepts auto-DATE format
     (`YYYY-MM-DD`, with separators). `YYYYMMDD` without separators
     **silently returns 0 rows — no error.**

     Empirical verification (PR4a hotfix smoke, same query shape):

     | Bind RHS                | Rows returned |
     |-------------------------|--------------:|
     | (no date filter)        | 2,853,321 |
     | `'2026-05-01'` ~ `'2026-05-08'` | 203,549 ✅ |
     | `'20260501'` ~ `'20260508'`     | 0 ❌ silent |

     Implication: ANY endpoint that uses date binds MUST pass
     `YYYY-MM-DD` strings. Don't strip dashes assuming Snowflake
     will infer the format. Applies to all date binds, not specific
     to any one table.

     Discovered: PR4a (4f105f0) silently returned 0 rows because
     the endpoint stripped dashes before binding. PR4a hotfix
     restored YYYY-MM-DD bind format.

### Snowflake authentication (CONFIRMED 2026-04-30)

KDC Snowflake account requires RSA key-pair authentication
(`SNOWFLAKE_JWT`), NOT externalbrowser SSO.

**Discovery context:** The colleague's prototype (forked
2026-04-29) hardcoded `authenticator: 'externalbrowser'` in
`buildConnection`. Upstream main (verified via
`git show upstream/main:server.js | grep` on 2026-04-30) does
NOT contain any RSA / JWT / PKCS8 code — the colleague developed
the prototype in an SSO-enabled environment, but the user's
production environment requires RSA.

**Implementation pattern (snowflake-sdk standard):**

```javascript
import fs from 'node:fs';
import crypto from 'node:crypto';

const privateKeyPem = fs.readFileSync(
  process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
  'utf8'
);
const privateKeyObject = crypto.createPrivateKey({
  key: privateKeyPem,
  format: 'pem',
  passphrase: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE,
});
const privateKey = privateKeyObject.export({
  format: 'pem',
  type: 'pkcs8',
});

snowflake.createConnection({
  account, username,
  authenticator: 'SNOWFLAKE_JWT',
  privateKey,
  // ... other options
});
```

**Required env vars:**
- `SNOWFLAKE_PRIVATE_KEY_PATH` — absolute path to .p8 file
- `SNOWFLAKE_PRIVATE_KEY_PASSPHRASE` — optional (Python
  reference uses `password=None`; KDC standard appears to be
  unencrypted keys for service accounts)

**Trust hierarchy reinforcement:** This is the third instance
where colleague-prototype assumptions failed in user environment
(after channel filter and split detection logic). Confirms
master plan §6a F0 validation policy: "starting point, validate
before reuse."

### Snowflake string case-sensitivity (CONFIRMED 2026-04-30)

Snowflake string equality is case-sensitive by default. SCALE table
data uses Pascal Case for type/status enum-like columns:

| Column | Value (verified) |
|--------|------------------|
| `WORK_INSTRUCTION.instruction_type` | `'Header'` |
| `IA_WORK_INSTRUCTION.instruction_type` | `'Header'` |
| `SHIPPING_CONTAINER.company` | `'Ivy'`, `'Red'`, `'Vivace'` |

**Discovery context:** PR1 explore endpoint initially used `'header'`
(lowercase) and returned 0 rows. User verified via Snowflake console
that `'Header'` (Pascal Case) matches actual data. The earlier
"sampleRows: 0" result from `/api/scale/explore-ia-wi` was caused
by this case mismatch, not by missing data or wrong COMPANY domain.

**Implementation guidance:** When writing SQL against SCALE tables,
match observed case exactly OR use `lower()` / `upper()` for explicit
case-insensitive comparison. The schema doc's reference SQL example
should use `'Header'` (matching observed data) rather than wrapping
in `lower()` since Pascal Case is the ground truth.

**Trust hierarchy reinforcement:** This is the fourth confirmed
instance of an assumption failing in the user environment (after
channel filter, split detection logic, authentication method, and
now string case). The §6a F0 "validate before reuse" policy is
the right defense against silent data-format assumptions in
prototype SQL.

### Snowflake role permissions for SCI.L0 (CONFIRMED 2026-04-30)

`INTELLOPS` role has SELECT permission on `SCI.L0.*` tables.
`CDM_TEAM` role does NOT — only PUBLIC schema visible to that role.

**Discovery context:** Initial Snowflake account used `CDM_TEAM`
role; PR1 explore endpoints all returned "Schema 'SCI.L0' does not
exist or not authorized" or "Object 'SCI.L0.X' does not exist or
not authorized". User obtained new account with `INTELLOPS` role
(2026-04-30), and the same endpoints returned full column lists
+ sample rows.

**`/api/snowflake/test` schema field as diagnostic signal:**

| Role | `current_schema()` | L0 access |
|------|---------------------|-----------|
| `CDM_TEAM` | `null` | NO |
| `INTELLOPS` | `'L0'` | YES |

The schema field returning `null` is a meaningful signal — it means
the role's default schema is not set, which often correlates with
schema-level permission gaps. Future debugging: treat `schema: null`
in `/api/snowflake/test` response as a yellow flag, not a benign
default.

**Implementation:** `.env` should set `SNOWFLAKE_ROLE=INTELLOPS`
for any work against `SCI.L0` tables. Existing 13 server.js
endpoints querying `SCI.PUBLIC.*` are role-agnostic (PUBLIC schema
generally accessible).

### PR1 exploration findings (CONFIRMED 2026-04-30)

Three `/api/scale/explore-*` endpoints (commit `e9ffa79`) confirmed
column structures for tables referenced by sub-plan 002. Findings:

#### `SCI.L0.SHIPPING_CONTAINER` — drill-down columns

97 columns total. UI drill-down panel needs:

| UI display | Column | Type | Sample value |
|-----------|--------|------|--------------|
| Weight | `WEIGHT` | FLOAT | `2.64` |
| Weight unit | `WEIGHT_UM` | TEXT | `'LB'` |
| Dimensions | `WIDTH` / `HEIGHT` / `LENGTH` | FLOAT | `8.7` / `5.7` / `13.0` |
| Dimension unit | `DIMENSION_UM` | TEXT | `'IN'` |
| Volume | `VOLUME` / `VOLUME_UM` | FLOAT / TEXT | (varies) |
| Expected delivery | `PLANNED_DELIVERY_DATE_TIME` | TIMESTAMP_NTZ | (null in pre-manifest stage) |
| Manifest close | `MANIFEST_CLOSE_DATE_TIME` | TIMESTAMP_NTZ | (per existing fact) |
| Tracking number | `TRACKING_NUMBER` | TEXT | (null until manifest stage) |

**NOT** `gross_weight` — column is just `WEIGHT`. NOT `dimensions`
single column — three separate `WIDTH`/`HEIGHT`/`LENGTH` fields.

**KISS UDF mappings (SHIPPING_CONTAINER):**

| Column | Type | KISS usage (verified via PR1 sample) |
|--------|------|--------------------------------------|
| `USER_DEF1` | TEXT | Order type label (e.g., `'Intercompany PO'`) |
| `USER_DEF2` | TEXT | Container number (matches `PARENT_CONTAINER_ID`) |
| `USER_DEF4` | TEXT | Sales org code (`'1100'`=Ivy, `'1400'`=Red, `'1900'`=Vivace) |
| `USER_DEF5` | TEXT | Weight value (redundant copy of `WEIGHT`) |

(Note: `USER_DEF4` confirmed sales org code; superesedes earlier
guess that the column might be elsewhere. The 1400=Red mapping
that the manhattan-scale-config skill omits is now verified here.)

**All `SHIPPING_CONTAINER` timestamps are TIMESTAMP_NTZ** (no
timezone info stored). UTC assumption + `CONVERT_TIMEZONE('UTC',
'America/New_York', ...)` required for any local-time display
or comparison.

#### `SCI.L0.IA_WORK_INSTRUCTION` — partial findings

106 columns total. Schema acquired via PR1 explore endpoint;
sample rows obtained after fixing case-sensitivity (see § Snowflake
string case-sensitivity above) — `instruction_type = 'Header'`.

**Partial close — uncertainty remaining:**
- Multiple zone-related columns exist: `TO_WORK_ZONE`,
  `FROM_WORK_ZONE`, `LOCATING_ZONE`, `ALLOCATION_ZONE`. Schema
  doc's prior "Pick zone is `WI.user_def1`" fact applies to
  `WORK_INSTRUCTION` — for `IA_WORK_INSTRUCTION` we observe both
  `USER_DEF1` AND named zone columns. Sub-plan 002 PR3 must
  determine which column is the live zone source via SQL test
  against actual rows.
- `IA_WORK_INSTRUCTION.COMPANY` domain values: assumed `'Ivy'` /
  `'Red'` / `'Vivace'` matching `SHIPPING_CONTAINER.company`,
  but not directly verified (sample rows from `lower()` query
  exist; the case-sensitive plus correct-domain query is the
  same one user verified — so the assumption appears to hold).

PR3 SQL writing must validate UNION ALL semantics: that the same
`COMPANY` and `instruction_type='Header'` filter produces meaningful
rows in both `WORK_INSTRUCTION` AND `IA_WORK_INSTRUCTION`.

#### `SCI.L0.PROCESS_HISTORY` — last-scan-location investigation

25 columns total. Sample 10 rows showed only replenishment events
(PROCESS=`'250'`, ACTION=`'190'` style codes); no shipping/scan
events captured. Implication:

- "Last scan location" for the UI drill-down may NOT be sourced
  from PROCESS_HISTORY — PH appears to be internal SCALE process
  log, not carrier-side tracking event log.
- UPS / carrier scan events (e.g., `'Local Delivery Facility'`,
  `'Atlanta GA Sort'`) are likely from a separate data source
  (carrier API / EDI / outside SCI database).

PR3 will not pull last-scan-location until source is confirmed.
Drill-down panel may need to omit that field for live mode, or
fall back to a SCALE-internal alternative (e.g., latest container
status_time + container.location). Logged as remaining open item;
see master plan §7c #18 update.

**Related observation — PROCESS_HISTORY identifier columns:**
`IDENTIFIER1`-`IDENTIFIER4` are `key:value` formatted strings
(e.g., `'Wave Number:240030'`, `'Location:AS'`). For ship-confirm
events (PROCESS code TBD), the key:value pattern likely encodes
container_id and shipment_id. Free-text parsing required for joins.
This is a larger discovery effort tracked separately.

### Split Shipment SQL — operational reference (user-confirmed 2026-04-29)

User wrote a working split shipment SQL against actual Snowflake data.
The patterns below are confirmed operational facts:

#### Channel filter

```sql
WHERE sc.company IN ('Ivy', 'Red', 'Vivace')
  AND sh.carrier = 'UPS'
```

`sc.company` is the canonical channel column on `SHIPPING_CONTAINER`
(NOT `customer_group` on shipment header, which the plan incorrectly
guessed earlier). The carrier filter narrows to UPS — the only carrier
in scope for Phase 1 split shipment compliance.

#### Cross-DB join — KDB.PBI_SF.SAP_CUSTOMER_MASTER columns

Beyond the previously-confirmed `SHIPTOPARTY_KEY` (join key) and `NAME`
(customer name), the customer master table provides geographic data:

| Column | Purpose |
|--------|---------|
| `SHIPTOPARTY_KEY` | Join key — matches `SCI.L0.SHIPMENT_HEADER.SHIP_TO` |
| `NAME` | Customer display name |
| `REGION` | State (US 2-letter code) — used for Geographic page heat map |
| `city` | City name |
| `postalcode` | ZIP code |

This means **Geographic page (sub-plan 003) ALSO depends on the
SCI ↔ KDB cross-DB join**, not just Split Shipments. Both pages share
the same join pattern.

#### Timezone handling

All Snowflake timestamps are stored in UTC. KISS operates in
Savannah, GA (Eastern Time). Convert at the SQL level for any
display, comparison, or grouping that depends on local-day
boundaries:

```sql
CONVERT_TIMEZONE('UTC', 'America/New_York', sc.date_time_stamp)
```

This supersedes the earlier "timezone irrelevant under ::DATE cast"
note. The cast worked for purely date-equality checks, but
operational queries comparing hour-level timing (Type 2/3 split
detection) must convert to local time first.

#### WORK_INSTRUCTION zone source

Pick zone is stored in `WORK_INSTRUCTION.user_def1` (KISS-specific
UDF customization), NOT a `ZONE` column. The base SCALE column
`from_work_zone` (per Manhattan skill EX20 reference) carries values
like `'W-AS'` (Autostore), but KISS uses `user_def1` as the live zone
source for the operational query.

`instruction_type = 'Header'` filter is required — without it the
query duplicates rows for sub-instructions.

**Note:** See § Snowflake string case-sensitivity for the rule
governing this Pascal Case requirement.

#### NEW TABLE: SCI.L0.IA_WORK_INSTRUCTION

User SQL UNIONs `WORK_INSTRUCTION` with a previously undocumented
table:

```sql
SELECT container_id, work_unit, user_def1 AS pick_zone, ...
FROM sci.l0.work_instruction
WHERE company IN ('Ivy', 'Red', 'Vivace') AND instruction_type = 'Header'
UNION ALL
SELECT container_id, work_unit, user_def1 AS pick_zone, ...
FROM sci.l0.ia_work_instruction
WHERE company IN ('Ivy', 'Red', 'Vivace') AND instruction_type = 'Header'
```

`ia_work_instruction` likely stands for "Inventory Allocation"
work instruction (KISS-specific extension), or possibly a separate
flow split. Skill search on 2026-04-29 found no documentation for
this table. Sub-plan 002 must `DESCRIBE TABLE` to confirm column
list and verify the UNION semantics with operations.

#### Type 1 — Zone-level split detection (corrected)

Replaces the earlier `LEFT(SC.original_pick_loc, 2)` sketch:

```sql
COUNT(DISTINCT pick_zone) > 1
-- where pick_zone comes from the WI/IA_WI UNION above
-- 1 → not split by zone; 2+ → zone-level split
```

#### Type 2 — Container-level split detection (corrected)

Replaces the earlier 4-hour threshold sketch:

```sql
container_count > 1
AND first_status_700_time IS NOT NULL
AND last_status_700_time IS NOT NULL
AND first_status_700_time <> last_status_700_time
```

**Critical correction:** there is NO hour threshold. ANY difference
in `container_status >= '700'` timestamp between sibling containers
counts as Container-level split. The earlier "4 hour" placeholder in
the plan was wrong — operations defines split as event-time
difference, not buffered tolerance.

This also closes §7c #15 (threshold tuning) — the question itself
was based on a wrong assumption.

#### Type 3 — Manifest-level split detection (corrected)

Replaces the earlier simple `MANIFEST_FOR_DATE` distinct count:

```sql
container_count > 1
AND (
       manifest_count > 1
    OR first_manifest_close_time <> last_manifest_close_time
    OR (
           status_700_container_count > 0
       AND status_700_container_count < container_count   -- ← silent killer
       )
    )
```

The third OR branch is the **true "silent killer" signal** — when
status 700 fires for some sibling containers but not all. The plan's
earlier `MANIFEST_FOR_DATE::DATE` count missed this.

#### Output shape — flat container rows (UI requires this)

User SQL grouped to shipment level (lost container detail). The
correct shape for the dashboard preserves container rows so the
UI's drill-down (clicking an order to see its containers) has
data without a second API call:

```sql
-- Replace shipment_summary GROUP BY with window functions
SELECT
    -- container-level fields (one row per container)
    container_id,
    container_type,
    container_status,
    tracking_number,
    manifest_id,
    pick_zone,
    container_status_time,
    manifest_close_time,
    
    -- order-level fields (same value across sibling rows; window aggregations)
    shipment_id,
    cust_name,
    company AS channel,
    cust_state,
    cust_city,
    cust_zipcode,
    
    COUNT(DISTINCT container_id) OVER (PARTITION BY shipment_id) AS container_count,
    COUNT(DISTINCT pick_zone)    OVER (PARTITION BY shipment_id) AS pick_zone_count,
    COUNT(DISTINCT manifest_id)  OVER (PARTITION BY shipment_id) AS manifest_count,
    -- ... etc

    -- 3-type flags computed from window aggregations
    CASE WHEN pick_zone_count > 1 THEN 1 ELSE 0 END AS zone_level_split_flag,
    -- ... etc

    -- Primary type with priority order
    CASE
        WHEN manifest_level_split_flag = 1 THEN '03 Manifest-level split'
        WHEN container_level_split_flag = 1 THEN '02 Container-level split'
        WHEN zone_level_split_flag = 1 THEN '01 Zone-level split'
        ELSE 'No split'
    END AS primary_split_type
FROM ...
WHERE zone_level_split_flag = 1
   OR container_level_split_flag = 1
   OR manifest_level_split_flag = 1
ORDER BY shipment_id, container_id
```

Frontend groups by `shipment_id` for the table main rows; each
row's `containers` array (from sibling rows) populates the
drill-down. ~62 split orders × ~3 containers ≈ ~186 rows ≈ 100KB
response — well within reasonable bounds.

#### Drill-down columns — UI requirement, source to verify

The UI's container drill-down displays:
- Last scan location ("Local Delivery Facility", "Atlanta GA Sort")
- Item count + weight ("1 items · 14.8 lb", "4 items · 6.5 lb")
- Expected vs actual delivery dates ("Exp: Apr 23 → Apr 21")
- Tracking number ✅ (already in user SQL)
- Container status ✅ (already in user SQL)

The user SQL does not yet pull these; they exist in SCALE. Likely
column / source candidates:

| UI display | Likely SCALE source |
|-----------|---------------------|
| Tracking number | `SC.tracking_number` (confirmed) |
| Status (DELIVERED) | `SC.status` (confirmed; UI 'DELIVERED' likely maps to status >= some threshold) |
| Last scan location | `PROCESS_HISTORY` last `location` event for container_id, OR a SC field |
| Item count | `SHIPMENT_DETAIL` line count joined to container, OR `SC` UDF |
| Weight | `SHIPPING_CONTAINER` weight column (name TBD — `weight`? `gross_weight`?) |
| Expected delivery | `SC` or `SH` UDF — TBD |
| Actual delivery | `SC.status_time` filtered to delivery status |

Sub-plan 002 resolves exact column names via `DESCRIBE TABLE
SCI.L0.SHIPPING_CONTAINER` and inspects PROCESS_HISTORY in PR1
(exploration). Logged as new §7c items #17, #18 below.

### Unverified — TODO: confirm in Snowflake console

- **Other schemas in `SCI`** — `L1`, `L2`, `RAW`, `STAGING`, etc. are
  unknown. `server.js` only references `PUBLIC` and `L0`. The
  `PUBLIC` Dynamic Tables likely sit over `L0`; intermediate schemas
  (if any) are not yet inventoried.
- **`kdc_intelligence_foundation.sql`** — referenced in the `server.js`
  header comment but absent from the repo. Required to understand the
  semantic-view layer (`V_*`, `VOP_*`, `VPROD_*`, `VEXC_*`) that 11 of
  `server.js`'s endpoints stub out via `viewNotReady()`. Action: ask the
  prototype author for this file. Logged in `tech-debt-tracker.md`.
- **Other SAP-origin tables in `KDB`** — only
  `KDB.PBI_SF.SAP_CUSTOMER_MASTER` is mapped (see SAP-origin section
  below). Sales orders, materials, pricing, chargebacks — TBD per
  sub-plan need.
- **Network access** — whether the dev environment reaches Snowflake
  directly or through a proxy / API gateway.

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
- **For customer names: cross-database join SCI + KDB.** See the
  KDB section below for the `SCI.L0.SHIPMENT_HEADER` ↔
  `KDB.PBI_SF.SAP_CUSTOMER_MASTER` join pattern.

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

## Read-only rule (this codebase)

All SQL generated from this codebase against `SCI.*` is read-only.
See `AGENTS.md` § Database safety rule and `core-beliefs.md` § 8 for
the authoritative statement and rationale.

Quick reference:
- ✅ `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `INFORMATION_SCHEMA`
- ❌ `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CREATE`, `DROP`, `ALTER`,
   `TRUNCATE`, `CALL`, `COPY INTO`, `GRANT`, `REVOKE`

Special note for Split Shipment work: `KISS_EXP_UploadShipmentBefore` is
a stored procedure that sets `SD.UDF3` (PGI flag). It is invoked
automatically by SCALE during the shipment upload pipeline — this
codebase reads its result via `SD.UDF3 = 'N'` queries, but **never
calls the procedure**.

---

## Open environment questions

Items still blocking the first end-to-end SQL execution against Snowflake
from a new endpoint:

- [x] ~~**Is `SCI.PUBLIC.SHIPMENT_HEADER` a table or a view?**~~
      **[CLOSED 2026-04-29]** It is a Snowflake **Dynamic Table** —
      managed materialized view, auto-refreshed. See Verified facts
      above. DDL capture deferred to first sub-plan that needs
      `SCI.PUBLIC` columns beyond what `L0` provides.
- [ ] **Other schemas in `SCI`** — list and purpose.
- [ ] **`kdc_intelligence_foundation.sql`** — obtain from prototype author;
      tracked in `docs/exec-plans/tech-debt-tracker.md`.
- [x] ~~**SAP-origin tables** — schema location and table inventory.~~
      **[PARTIALLY CLOSED 2026-04-29]** `KDB.PBI_SF` database
      confirmed; `SAP_CUSTOMER_MASTER` mapped (see SAP-origin
      section below). Sales orders, materials, pricing, chargebacks —
      TBD per sub-plan need.
- [ ] **Network access** — direct from dev environment, or via proxy?
- [x] ~~**Replication freshness** — Snowflake vs live SCALE lag.~~
      **[CLOSED 2026-04-29]** ~10 minutes (MSSQL → Snowflake on
      10-min cycle). See Verified facts above.
- [x] ~~**WORK_INSTRUCTION zone codes**~~
      **[CLOSED 2026-04-29]** No `WI.ZONE` column in
      server.js. Floor-area zones derived from
      `LEFT(SC.original_pick_loc, 2)` prefix (`AS`/`PL`/`PR`/`PS`).
      See Verified facts above for full pattern. Whether WI has its
      own zone column TBD via `DESCRIBE TABLE` during sub-plan
      `002`.

      **Update 2026-04-29:** User SQL confirms zone source is
      `WI.user_def1` (KISS UDF customization), with UNION over
      `ia_work_instruction`. See Verified facts above. WI item closed
      as "user-confirmed pattern"; ia_work_instruction tracked as new
      discovery item below.
- [x] ~~**SHIPPING_CONTAINER ship-confirm column**~~
      **[CLOSED 2026-04-29]** No `SHIP_CONFIRM_DATE_TIME`
      column. `SC.MANIFEST_CLOSE_DATE_TIME` is the documented
      per-container ship-event signal — see Verified facts above.
      Sub-plan `002` verifies in Snowflake console.

      **Update 2026-04-29:** User SQL uses
      `SC.date_time_stamp WHERE container_status >= '700'` for Container-level
      split detection (NOT MANIFEST_CLOSE_DATE_TIME as earlier suggested).
      The operational signal is the timestamp of the status-700 transition
      on the container row, available directly via SC.date_time_stamp +
      status filter. CLOSED.
- [ ] **PROCESS_HISTORY status 700 transition pattern** — exact
      column for status (likely `TRAILING_STATUS` or similar) and
      timestamp granularity. Needed for Manifest-level split
      detection.
- [x] ~~**`customer_group` column location**~~
      **[CLOSED 2026-04-29]** Channel filter does not use a
      customer_group column. User SQL filters via
      `sc.company IN ('Ivy', 'Red', 'Vivace')` — the canonical
      channel column on `SHIPPING_CONTAINER`. Plan's earlier
      customer_group/sales_org guess was incorrect. See Verified
      facts above (Split Shipment SQL — operational reference).
- [ ] **`SCI.L0.IA_WORK_INSTRUCTION` semantics** — confirmed table
      exists (used in user's split SQL), but its role and difference
      from `WORK_INSTRUCTION` undocumented. Likely "Inventory
      Allocation" work flow (KISS-specific extension). Resolve via
      `DESCRIBE TABLE` + operations conversation during sub-plan 002.
- [ ] **Drill-down column names — items / weight / last location /
      expected delivery date.** UI requires these for the container
      drill-down panel. User SQL does not yet retrieve them. Most
      likely: `SC.weight` (or similar), `SHIPMENT_DETAIL` join for
      item count, `PROCESS_HISTORY` for last scan location. Resolve
      via `DESCRIBE TABLE SCI.L0.SHIPPING_CONTAINER` +
      `PROCESS_HISTORY` event inspection during sub-plan 002 PR1.

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

## SAP-origin tables — KDB database

**Database:** `KDB` (separate from `SCI`).

**Confirmed schema:** `KDB.PBI_SF` (likely "Power BI / Salesforce"
or similar consolidation layer for SAP-origin data).

### KDB.PBI_SF.SAP_CUSTOMER_MASTER

Customer master replicated from SAP. Confirmed columns:

| Column | Purpose |
|--------|---------|
| `SHIPTOPARTY_KEY` | Join key — matches `SCI.L0.SHIPMENT_HEADER.SHIP_TO` |
| `NAME` | Customer display name (used for "customer" field in FactShipment contract) |

Other columns: TODO — capture during sub-plan `002` work.

### Cross-database join pattern (Phase 1 critical)

To resolve customer names on shipment data, join across SCI and KDB:

```sql
SELECT
    SH.SHIPMENT_ID,
    SH.SHIP_TO,
    CM.NAME AS CUSTOMER_NAME
    -- ... other shipment fields
FROM SCI.L0.SHIPMENT_HEADER SH
LEFT JOIN KDB.PBI_SF.SAP_CUSTOMER_MASTER CM
    ON SH.SHIP_TO = CM.SHIPTOPARTY_KEY
WHERE SH.WAREHOUSE = 'KDCGA1'
  -- IN_DELETION filter intentionally omitted; only 'N' values exist in data
;
```

This is a **cross-database join** — the Snowflake user/role running
the query needs SELECT access to both `SCI` and `KDB`. Verify
access during sub-plan `002` implementation.

### Other SAP-origin tables — TBD

Likely tables (not yet confirmed):
- Sales order header / line items
- Material master
- Pricing / chargeback tables

These will be filled in as sub-plans 003+ require them.

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