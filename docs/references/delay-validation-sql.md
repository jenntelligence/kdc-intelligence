# Delay Validation SQL — TRUCK & UPS Reference

**Purpose:** SQL templates for validating delivery delay status against
the live Snowflake data. These queries are 1:1 mirrors of the frontend
`isDeliveredDelayed` logic in `src/ShippingSLAApp.jsx` (PR Geo-Delivered-
Mode, commit `54c0bd0`).

**Created:** 2026-05-20 (after TRUCK 3-DO trace validation)
**Maintainer:** Update when `TRUCK_DELIVERY_BD_BY_STATE` or
`UPS_DELIVERY_DAYS_BY_STATE` changes in frontend.

---

## 1. Context

KDC Intelligence dashboard reports a single "delayed" count per day
window (e.g. 540 for 2026-05-12 to 2026-05-19). This count is composed
of two carrier branches that follow different SLA logic:

- **UPS:** state-specific calendar-day mapping (e.g. CA=2 CD, NY=6 CD)
- **TRUCK:** sequential pickup + transit logic (so_created + 1 CD KDC
  processing + N business days truck transit, with weekend skip)

When dashboard numbers come into question (e.g. "where did 540 come
from?"), these SQL templates let operators trace each delayed DO back
to its raw `SCI.L0` evidence without touching the frontend.

---

## 2. TRUCK Delay Logic

### 2.1 Formula

````
expected_delivery_date = so_created_date 
                      + 1 calendar day  (KDC processing → truck pickup)
                      + N business days (state-specific transit time)

is_delayed = MAX(delivered_date)::date > expected_delivery_date
````

Business days skip Saturday and Sunday.

### 2.2 State → BD lookup

Source: `TRUCK_DELIVERY_BD_BY_STATE` in `src/ShippingSLAApp.jsx`.

Values are high-bound from the published carrier lead time table
(stored in the in-app reference panel: TRUCK / LTL tab).

⚠️ ★ Claude estimate — pending operations team verification. Missing
   routes (Plains, Mountain) cause those DOs to drop from the cohort.

| Route | BD | States |
|---|---|---|
| GA Local | 1 | GA |
| Southeast | 2 | FL, SC, NC, TN, AL |
| Mid-Atlantic | 3 | VA, MD, DC |
| Midwest | 3 | OH, IL, IN, MI |
| South Central | 3 | TX, LA, MS, AR |
| West Coast | 5 | CA, OR, WA |

### 2.3 Strict cohort

A DO enters the cohort only when:
- `carrier = 'TRUCK'`
- Every container row has a non-null `delivered_date`
- The DO's `cust_state` exists in the BD lookup

Partial deliveries (some containers delivered, some not) are excluded
to match the frontend's strict aggregation in `deliveredAggregated`.

---

## 3. Trace SQL — TRUCK

Run after the master query's `test` CTE (see
`/api/scale/split-shipments` endpoint in `server.js`):

```sql
WITH 
truck_bd AS (
  SELECT * FROM (VALUES
    ('GA', 1),
    ('FL', 2), ('SC', 2), ('NC', 2), ('TN', 2), ('AL', 2),
    ('VA', 3), ('MD', 3), ('DC', 3),
    ('OH', 3), ('IL', 3), ('IN', 3), ('MI', 3),
    ('TX', 3), ('LA', 3), ('MS', 3), ('AR', 3),
    ('CA', 5), ('OR', 5), ('WA', 5)
  ) AS t(state, truck_bd)
),
do_aggregated AS (
  SELECT 
    do_num,
    cust_state,
    so_created_date,
    MAX(delivered_date) AS max_delivered_ts,
    MAX(delivered_date)::date AS max_delivered_date,
    COUNT(*) AS rows_total,
    COUNT(delivered_date) AS rows_delivered
  FROM test
  WHERE carrier = 'TRUCK'
  GROUP BY do_num, cust_state, so_created_date
  HAVING COUNT(*) = COUNT(delivered_date)
),
pickup_calc AS (
  SELECT 
    d.*,
    bd.truck_bd,
    DATEADD(day, 1, d.so_created_date) AS truck_pickup_date,
    DAYOFWEEKISO(DATEADD(day, 1, d.so_created_date)) AS pickup_dow
  FROM do_aggregated d
  LEFT JOIN truck_bd bd ON d.cust_state = bd.state
),
expected_calc AS (
  SELECT 
    *,
    DATEADD(day,
      CASE 
        WHEN pickup_dow = 6 THEN 2 + FLOOR((truck_bd - 1) / 5) * 2
        WHEN pickup_dow = 7 THEN 1 + FLOOR((truck_bd - 1) / 5) * 2
        WHEN pickup_dow + truck_bd > 5
          THEN truck_bd + FLOOR((pickup_dow - 1 + truck_bd) / 5) * 2
        ELSE truck_bd
      END,
      truck_pickup_date
    ) AS expected_delivery_date
  FROM pickup_calc
),
classified_trace AS (
  SELECT 
    do_num, cust_state, so_created_date,
    TO_CHAR(so_created_date, 'DY') AS so_created_dow,
    truck_pickup_date,
    TO_CHAR(truck_pickup_date, 'DY') AS pickup_dow_label,
    truck_bd, expected_delivery_date,
    TO_CHAR(expected_delivery_date, 'DY') AS expected_dow,
    max_delivered_ts, max_delivered_date,
    TO_CHAR(max_delivered_date, 'DY') AS delivered_dow,
    DATEDIFF(day, so_created_date, max_delivered_date) AS actual_total_cd,
    DATEDIFF(day, expected_delivery_date, max_delivered_date) AS days_over_sla,
    CASE 
      WHEN max_delivered_date > expected_delivery_date THEN 'DELAYED'
      ELSE 'ON-TIME'
    END AS delay_status,
    rows_total AS container_count
  FROM expected_calc
)
SELECT *
FROM classified_trace
WHERE delay_status = 'DELAYED'
ORDER BY days_over_sla DESC, cust_state;
```

---

## 4. Verification — 2026-05-12 to 2026-05-19 window

Validated on 2026-05-20 against three sources:

| Source | Result |
|---|---|
| Trace SQL (above) | 3 DOs delayed |
| Browser console fetch + JS mirror | 3 DOs delayed (identical do_num) |
| Dashboard visual (Geographic page) | TRUCK component of 540 total |

Cross-reference complete: SQL = Console = Frontend = Dashboard.

### 4.1 Result table

| DO | State | so_created | pickup | truck_bd | expected | actual | over |
|---|---|---|---|---|---|---|---|
| 0801955190 | TN | 2026-05-12 (Tue) | 2026-05-13 (Wed) | 2 | 2026-05-15 (Fri) | 2026-05-19 (Tue) | 4 |
| 0801955469 | FL | 2026-05-12 (Tue) | 2026-05-13 (Wed) | 2 | 2026-05-15 (Fri) | 2026-05-18 (Mon) | 3 |
| 0801956241 | MD | 2026-05-12 (Tue) | 2026-05-13 (Wed) | 3 | 2026-05-18 (Mon) | 2026-05-19 (Tue) | 1 |

### 4.2 Cohort drop reason

````
TRUCK rows total:         1092 (container-level)
TRUCK DOs (unique):         41
TRUCK strict cohort:         3 (fully delivered + state in BD lookup)
TRUCK delayed:               3
````

38 DOs dropped from the cohort. Reasons:
- Some containers still in transit (PENDING)
- Partial deliveries excluded by strict aggregation
- States outside the BD lookup (Plains, Mountain — pending operations
  team verification)

---

## 5. UPS Delay Logic (companion reference)

UPS uses a flat state → calendar-day mapping, not the sequential
pickup + BD logic.

Source: `UPS_DELIVERY_DAYS_BY_STATE` in `src/ShippingSLAApp.jsx`.

⚠️ ★ Claude estimate — 29 states pending operations team verification.

### 5.1 Trace SQL — UPS

```sql
WITH 
ups_cd AS (
  -- Copy current values from UPS_DELIVERY_DAYS_BY_STATE
  -- Update this CTE when the frontend table changes
  SELECT * FROM (VALUES
    ('CA', 2), ('NY', 6), ('WA', 8)
    -- ... (add all 50 states as defined in frontend)
  ) AS t(state, ups_cd)
),
do_aggregated AS (
  SELECT 
    do_num,
    cust_state,
    so_created_date,
    MAX(delivered_date) AS max_delivered_ts,
    MAX(delivered_date)::date AS max_delivered_date,
    COUNT(*) AS rows_total,
    COUNT(delivered_date) AS rows_delivered
  FROM test
  WHERE carrier = 'UPS'
  GROUP BY do_num, cust_state, so_created_date
  HAVING COUNT(*) = COUNT(delivered_date)
),
classified_trace AS (
  SELECT 
    d.do_num, d.cust_state, d.so_created_date,
    u.ups_cd,
    DATEADD(day, u.ups_cd, d.so_created_date) AS expected_delivery_date,
    d.max_delivered_ts, d.max_delivered_date,
    DATEDIFF(day, d.so_created_date, d.max_delivered_date) AS actual_total_cd,
    DATEDIFF(day, DATEADD(day, u.ups_cd, d.so_created_date), d.max_delivered_date) AS days_over_sla,
    CASE 
      WHEN d.max_delivered_date > DATEADD(day, u.ups_cd, d.so_created_date) THEN 'DELAYED'
      ELSE 'ON-TIME'
    END AS delay_status
  FROM do_aggregated d
  LEFT JOIN ups_cd u ON d.cust_state = u.state
)
SELECT *
FROM classified_trace
WHERE delay_status = 'DELAYED'
ORDER BY days_over_sla DESC, cust_state;
```

⚠️ Before running: copy the latest `UPS_DELIVERY_DAYS_BY_STATE` values
from frontend into the `ups_cd` CTE above.

---

## 6. Limitations & known gaps

1. **★ Claude estimate markers** — both `TRUCK_DELIVERY_BD_BY_STATE`
   and `UPS_DELIVERY_DAYS_BY_STATE` are pending operations team
   verification. Trace results may shift when those tables are
   corrected.

2. **Missing routes** — TRUCK lookup currently covers 17 states.
   Plains, Mountain, and Pacific Northwest (outside CA/OR/WA) cause
   silent cohort drops. The drop is not flagged in the dashboard UI.

3. **Snapshot vs live** — `test` CTE refreshes with each query. A
   DO classified as PENDING in one run may flip to DELIVERED in the
   next as new UPS or truck status events land. For point-in-time
   reproduction, persist the result of the master query first.

4. **Holiday calendar** — `addBusinessDays` skips weekends only, not
   US federal holidays. TRUCK SLAs spanning a holiday may
   under-report delays.

5. **Same-day delivery edge** — `MAX(delivered_date)::date > expected`
   uses calendar-day boundaries. A DO delivered on the expected day
   (any time, even 23:59) is counted on-time. Switching to timestamp
   comparison would shift the count (see KDC Intelligence 2 session
   notes for the 596 vs 537 UPS discrepancy).

---

## 7. Cross-references

- Frontend logic: `src/ShippingSLAApp.jsx` — `isDeliveredDelayed`,
  `deliveredAggregated`, `getDeliveryLeadDays`, `addBusinessDays`
- Master query: `server.js` `/api/scale/split-shipments` endpoint
- Carrier lead time table (in-app UI): Geographic page → Carrier
  Lead Time Standards panel
- Original validation session: PR Geo-Delivered-Mode (commit
  `54c0bd0`, 2026-05-20)

---

## 8. Update protocol

When `TRUCK_DELIVERY_BD_BY_STATE` or `UPS_DELIVERY_DAYS_BY_STATE`
changes in frontend:

1. Update the corresponding CTE values in this doc
2. Re-run trace SQL against the latest snapshot
3. Compare counts to dashboard visual
4. If mismatch, investigate before committing the lookup change
