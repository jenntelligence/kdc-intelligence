# Inbound Ops (ASN Dashboard_Revamp) — PBIP Analysis

> Faithful, implementation-ready inventory of the Power BI PBIP export, intended as the single source of truth for rebuilding the dashboard as a React page.
> Source: `docs/design-docs/inbound-ops-pbip/pbip/ASN Dashboard_Revamp.{Report,SemanticModel}`
> Report name: **ASN Dashboard**. Theme: `CY24SU10` (Power BI built-in). Brand accent observed in titles: `#A01B2D` (KISS red).

## Table of Contents
1. [Overview](#1-overview)
2. [Page 1 — In-Transit](#2-page-1--in-transit)
3. [Page 2 — Calendar](#3-page-2--calendar)
4. [Page 3 — Today](#4-page-3--today)
5. [Page 4 — Tomorrow](#5-page-4--tomorrow)
6. [Measures (DAX)](#6-measures-dax)
7. [Data Model — Tables & Power Query Sources](#7-data-model--tables--power-query-sources)
8. [Relationships](#8-relationships)
9. [Shared Expressions / Parameters](#9-shared-expressions--parameters)
10. [Synthesis](#10-synthesis)

---

## 1. Overview

Pages in `pageOrder` (active page = In-Transit):

| # | Page ID | Display Name | Canvas (w × h) |
|---|---------|--------------|----------------|
| 1 | `bc13293c4a26c88917b5` | **In-Transit** | 2400 × 1250 |
| 2 | `64fcd5c3806876c3a877` | **Calendar** | 2500 × 1250 |
| 3 | `859cbf8c7ef2205ed85f` | **Today** | 2400 × 1250 |
| 4 | `2426f65b24d8fae86e1c` | **Tomorrow** | 2400 × 1250 |

All pages use `displayOption: FitToPage`. Positions below are in report units (top-left origin). `z` = z-order, higher is on top.

Custom visuals registered in the report:
- `htmlContent443BE3AD55E043BF878BED274D3A6855` — **HTML Content** (renders a DAX-produced HTML string). Used on Calendar page.
- `calendarVisual…`, `CounterCalendar…`, `InforiverFilter…` — registered but **not currently placed** on any page (legacy/unused).

Theme `dataColors` palette (first colors): `#118DFF, #12239E, #E66C37, #6B007B, #E044A7, #744EC2, #D9B300, #D64550, #197278, #1AAB40, …`. Foreground `#252423`, background `#FFFFFF`, tableAccent `#118DFF`.

Common header band (repeated on every page, grouped): KISS round logo image (`kiss_logo_round_…png`), "ASN Dashboard" title textbox (20pt bold white), and a "Latest Refresh" **card** bound to `Min('Data Refreshed'[DATA_REFRESHED])`. A footer textbox on every page links to the DCOE Request smartsheet form (`https://app.smartsheet.com/b/form/2a50667caab3415999972b153dce4b5d`).

---

## 2. Page 1 — In-Transit
Canvas 2400 × 1250. Page ID `bc13293c4a26c88917b5`. This is the operational "ships currently in transit" page: a left filter rail, a large inbound schedule pivot, a map of vessel locations, and an ETA combo chart.

| Visual | Type | Title / Text | Pos (x,y,z,w,h) | Fields used | Notes |
|---|---|---|---|---|---|
| `289e9202…` | image | KISS logo | 7,1,9000,101,107 | — | `kiss_logo_round_27243305496471568.png`; in header Group 2 |
| `0678768e…` | textbox | "ASN Dashboard" | 126,18,10000,243,55 | — | 20pt bold, white |
| `7f8ecb9b…` | shape | (header bar) | 0,0,7000,2400,74 | — | header background, in group |
| `b37fc1a3…` | **card** | "Latest Refresh" | 2180,12,13000,220,50 | `Min('Data Refreshed'[DATA_REFRESHED])` | header |
| `a8a50bc0…` | **card** | "# of Containers" | 20,108,0,268,105 | `Min('Inbound Shipment Detail v3'[CONTAINER#])` (count/distinct of containers) | visual filter: `Status = "In Transit"` |
| `1b05eda7…` | **pivotTable** | "Inbound Schedule" | 306,108,8000,2076,655 | **Rows:** `Inbound Shipment Detail v3[KDC ETA]`, `[CONTAINER#]`. **Values:** `Sum([Pallet])` ("# of Pallets"), `Min([Container Size])`, `Min([Trucking Company])` ("Trucker"), `Min([CNEE])` ("Company"), `Min([VESSEL])`, `Min(VF_VesselPortcalls[EVENT])` ("Departure / Arrival"), `Min(VF_VesselPortcalls[PORT])` ("Current Location"), `Min([DESTINATION])`, `Min([PGR])` ("Purchasing Grp"), `Min([HBL])`, `Min([INVOICE#])` | Visual filters: `Status = "In Transit"`, `KDC ETA` is not null. Title bg `#A01B2D`, border radius 10, drop shadow. Row/col font 16-17pt, no subtotals. |
| `2c487fb8…` | shape | "Filter" (rail container) | 22,228,1000,266,952 | — | rounded rectangle, title bg `#A01B2D` |
| `58496f75…` | **slicer** | (Company) | 20,276,4000,263,93 | `CompanyList[Company]` | dropdown, search enabled |
| `4958dd0b…` | **slicer** | (Container) | 20,401,9000,263,95 | `Inbound Shipment Detail v3[CONTAINER#]` | dropdown, search enabled |
| `74171b7e…` | **slicer** | (Destination) | 20,528,6000,263,96 | `Inbound Shipment Detail v3[DESTINATION]` | dropdown |
| `4bedb1b3…` | **slicer** | (Shipment Type) | 20,656,7000,263,95 | `Inbound Shipment Detail v3[Mode]` | dropdown (FCL/LCL) |
| `52faae90…` | **slicer** | (Trucker) | 20,783,13000,263,93 | `Inbound Shipment Detail v3[Trucking Company]` | dropdown. Visual filter: `Trucking Company <> "KOREX"` (inverted) |
| `5043e2ba…` | **slicer** | (Vessel) | 20,908,10000,264,95 | `Inbound Shipment Detail v3[VESSEL]` | dropdown |
| `ef74ec48…` | **slicer** | (KDC ETA) | 20,1014,12000,266,96 | `Inbound Shipment Detail v3[KDC ETA]` | dropdown |
| `c138f104…` | **actionButton** | "Clear all slicers" | 23,1110,11000,264,70 | — | `shapeType: clearAllSlicers`; rounded, shadow |
| `ba5301d7…` | **azureMap** | (vessel locations) | 306,778,3000,972,402 | **Category:** `VF_VesselPortcalls[PORT]`. **Tooltips:** `Min(VF_VesselPortcalls[LOCODE])`, `Min([VESSEL])`, `Min(VF_VesselPortcalls[TIMESTAMP_DATE])` | Map of current port for each vessel |
| `cb466869…` | **lineStackedColumnComboChart** | (ETA combo) | 1296,778,2000,1085,402 | **Category:** `Inbound Shipment Detail v3[KDC ETA]`. **Y (column):** `Min([CONTAINER#])` ("# of Containers"). **Y2 (line):** `Sum([Pallet])` ("# of Pallets") | Visual filter: `KDC ETA` not null |
| `1dfc407a…` | textbox | DCOE request footer + "Click Here" link | 0,1202,15000,1125,48 | — | links to smartsheet form |
| `a1c6e52b…`, `3e5ed078…` | visualGroup | "Group 2" / "Group 1" | header | — | header groupings |

**Page-level filters:** none on `page.json`. Key data filter is per-visual: `Status = "In Transit"` (also enforced at the M layer — see §7).

**Visual count: 21** (incl. 2 visual groups; 19 leaf visuals).

---

## 3. Page 2 — Calendar
Canvas 2500 × 1250. Page ID `64fcd5c3806876c3a877`. Two summary KPI clusters (Today vs Tomorrow) over two HTML-rendered panels: an ASN list and a month calendar.

| Visual | Type | Title / Text | Pos (x,y,z,w,h) | Fields used | Notes |
|---|---|---|---|---|---|
| `6864cf7e…` | image | KISS logo | 8,1,9000,105,108 | — | header |
| `53c3e33e…` | textbox | "ASN Dashboard" | 132,19,10000,253,56 | — | header |
| `39c5a5b2…` | shape | header bar | 0,0,7000,2500,74 | — | |
| `e3568332…` | card | "Latest Refresh" | 2271,12,13000,229,49 | `Min('Data Refreshed'[DATA_REFRESHED])` | header |
| `e45ebe88…` | shape | "Today's Receiving Summary" | 0,0,0,1217,189 | — | container for left KPI cluster (Group `a8217e51…`) |
| `83efcb96…` | shape | "Tomorrow's Receiving Summary" | 0,0,0,1217,189 | — | container for right KPI cluster (Group `409049d2…`) |
| **Today KPI cluster** (group `a8217e51…`, x≈23,y≈104) | | | | | |
| `bd517544…` | card | "Total ASNs" | 0,61,…,228,124 | `[*scheduled_asn_today]` | |
| `71d467c1…` | card | "Total Trailers" | 236,60,…,227,81 | `[*scheduled_containers_today]` | |
| `1cebc43d…` | textbox | "FCL: ⟨value⟩" | 235,138,…,114,45 | bound value (FCL containers today) | inline value-bound text |
| `2e3e7a99…` | textbox | "LCL: ⟨value⟩" | 350,138,…,114,45 | bound value (LCL containers today) | inline value-bound text |
| `8be90660…` | card | "Total Pallets" | 469,61,…,227,124 | `[*scheduled_pallets_today]` | |
| `a91235a8…` | card | "Total SKUs" | 703,61,…,227,124 | `[*scheduled_lineitems_today]` | |
| `a586f12e…` | card | "Total Qty" | 937,60,…,274,124 | `[*scheduled_qty_today]` | |
| **Tomorrow KPI cluster** (group `409049d2…`, x≈1259,y≈104) | | | | | |
| `261f870d…` | card | "Total ASNs" | 0,61,…,228,124 | `[*scheduled_asn_tom]` | |
| `47b1db05…` | card | "Total Trailers" | 236,63,…,227,81 | `[*scheduled_containers_tom]` | |
| `0622a7ce…` | textbox | "FCL: ⟨value⟩" | 236,139,…,114,45 | bound value (FCL containers tom) | inline value-bound text |
| `9d2dec12…` | textbox | "LCL: ⟨value⟩" | 350,139,…,114,45 | bound value (LCL containers tom) | inline value-bound text |
| `fa6f59f5…` | card | "Total Pallets" | 469,61,…,227,124 | `[*scheduled_pallets_tom]` | |
| `c3677868…` | card | "Total SKUs" | 703,61,…,227,124 | `[*scheduled_lineitems_tom]` | |
| `04d00b59…` | card | "Total Qty" | 937,60,…,274,124 | `[*scheduled_qty_tom]` | |
| `33825e68…` | **htmlContent** | (ASN list panel) | 23,313,5000,1217,889 | `[*html_asn_list]` measure (HTML string) | renders day-by-day ASN list for current month, ETA ≥ today |
| `c0f454a2…` | **htmlContent** | (month calendar panel) | 1258,313,4000,1217,889 | `[*html_calendar]` measure (HTML string) | renders month grid with Pallets/FCL/LCL tags per day |
| `417a11d2…` | textbox | DCOE footer + link | 0,1202,1000,1125,48 | — | |

**Visual count: 27** (incl. groups). The two `htmlContent` panels are the heart of this page — both are pure HTML generated by DAX measures (`*html_asn_list`, `*html_calendar`). For a React rebuild, these should be reimplemented as React components driven by the underlying `Inbound Shipment Display` and `Receiving Line Item_grouped` data rather than porting the HTML-string DAX.

---

## 4. Page 3 — Today
Canvas 2400 × 1250. Page ID `859cbf8c7ef2205ed85f`. A KPI strip ("Today's Receiving Summary") plus a main receiving-summary table and a slide-over detail table (drill / detail view).

| Visual | Type | Title | Pos (x,y,z,w,h) | Fields used | Notes |
|---|---|---|---|---|---|
| header group `8f7229b4…` | logo/title/Latest Refresh card | — | y=0 | `Min('Data Refreshed'[DATA_REFRESHED])` | same header pattern |
| `38158cc0…` | shape | "Today's Receiving Summary" | 24,104,1000,2357,149 | — | KPI strip background |
| `b04e31ff…` | card | "Total ASNs" | 24,154,…,261,95 | `[*scheduled_asn_today]` | |
| `adbd716a…` | card | "Total Trailers" | 285,154,…,261,95 | `[*scheduled_containers_today]` | |
| `90586d1b…` | card | "FCL" | 546,154,…,261,95 | `[*scheduled_fcl_containers_today]` | |
| `fcd375b9…` | card | "LCL" | 807,154,…,261,95 | `[*scheduled_lcl_containers_today]` *(NOTE: visual binding shows `*scheduled_containers_today` displayName but title is LCL; verify — likely intended `*scheduled_lcl_containers_today`)* | |
| `a6da156d…` | card | "Total Pallets" | 1068,154,…,261,95 | `[*scheduled_pallets_today]` | |
| `7c458f89…` | card | "Total SKUs" | 1329,154,…,261,95 | `[*scheduled_lineitems_today]` | |
| `fcb7f4c0…` | card | "Total Qty" | 1590,154,…,261,95 | `[*scheduled_qty_today]` | |
| `22881761…` | card | "Total Urgent SKUs" | 1851,154,…,261,95 | `Sum([*today_urgent_sku])` (column) | |
| `250a06b9…` | card | "Total Urgent Qty" | 2116,154,…,261,95 | `[*today_urgent_group]` | |
| `d0e9beaf…` | **tableEx** | "Receiving Summary" | 23,279,5000,1309,922 | `[*urgency]` ("Urgency" dot), `Receiving Line Item[KDC ETA Adjusted]` ("KDC ETA"), `[Plant]`, `[Delivery]` ("ASN"), `[Container Number]` ("TR ID"), `Sum('Inbound Shipment Detail v3'[Pallet])` ("Total Pallets"), `Sum(Receiving Line Item[Total SKUs])`, `Sum(Receiving Line Item[Total Qty])` ("Total Receiving Qty") | Visual filter: `'Inbound Shipment Detail v3'[Is Today] = 1` plus value-not-blank filters |
| `99a005e0…` | textbox | Urgency legend / definition | 384,46,1000,641,280 | — | "Actual Coverage (Days) = Total Stock / Avg Daily Required Qty; Super Urgent <1; Urgent 1–2; Expedite 2–3; High 3–5; …" (inside detail group) |
| `86a4a16e…` | textbox | urgency color legend | 1358,324,12000,299,216 | bound counts | "⬤ Super Urgent: ⟨n⟩ / ⬤ Urgent: ⟨n⟩ / …" value-bound |
| `bdb6f32a…` | **tableEx** | "Receiving Summary Detail Veiw" | 18,282,6000,999,642 | `Receiving Line Item Details[Plant]`, `[Delivery]` ("ASN"), `[Container Number]` ("TR ID"), `First([Material key])`, `Sum([Actual quantity delivered (in sales units)])` ("Receiving Qty"), `Max([Total Stock])`, `[ActCov_modified]` ("Actual Coverage"), `Urgency Order[Urgency]` | In slide-over group `17d886cb…`; filtered to `Is Today = 1` |
| `09ef346c…` / `065934dc…` | shape | detail-view panel bg / divider | — | — | |
| `040dcff7…` | textbox | DCOE footer + link | 20,1202,2000,1125,48 | — | |

**Visual count: 22** (incl. groups). The "Receiving Summary" tableEx is the primary grid; the detail-view tableEx (`bdb6f32a…`) is a slide-over showing per-material (SKU) breakdown with Total Stock and ActCov.

---

## 5. Page 4 — Tomorrow
Canvas 2400 × 1250. Page ID `2426f65b24d8fae86e1c`. Mirror of the Today page but bound to the `_tom` measures and `Is Tomorrow` filter.

| Visual | Type | Title | Pos (x,y,z,w,h) | Fields used | Notes |
|---|---|---|---|---|---|
| header group `1578483b…` | logo/title/Latest Refresh | — | y=0 | `Min('Data Refreshed'[DATA_REFRESHED])` | |
| `3123c52e…` | shape | "Tomorrow's Receiving Summary" | 23,110,1000,2358,146 | — | KPI strip bg |
| `c9b7b626…` | card | "Total ASNs" | 23,155,…,235,95 | `[*scheduled_asn_tom]` | |
| `d5e05b76…` | card | "Total Trailers" | 258,156,…,235,95 | `[*scheduled_containers_tom]` | |
| `c8ec9199…` | card | "FCL" | 492,156,…,235,95 | `[*scheduled_fcl_containers_tom]` | |
| `8a7da2b2…` | card | "Total Trailers" | 727,156,…,235,95 | binding shows `*scheduled_lcl_containers_today`/`*scheduled_containers_today` — *likely mis-bound; title duplicates "Total Trailers"; verify intended LCL-tomorrow* | |
| `832dc475…` | card | "LCL" | 961,156,…,235,95 | `[*scheduled_lcl_containers_tom]` | |
| `93aba8f4…` | card | "Total Pallets" | 1200,156,…,235,95 | `[*scheduled_pallets_tom]` | |
| `013d7297…` | card | "Total SKUs" | 1435,156,…,235,95 | `[*scheduled_lineitems_tom]` | |
| `93fb6c70…` | card | "Total Qty" | 1669,156,…,235,95 | `[*scheduled_qty_tom]` | |
| `0a215347…` | card | "Total Urgent SKUs" | 1904,156,…,235,95 | `[*tom_urgent_sku]` | |
| `0fcfadb4…` | card | "Total Urgent Qty" | 2138,156,…,235,95 | `[*tom_urgent_group]` | |
| `84ba3889…` | **tableEx** | "Receiving Summary" | 23,280,4000,1310,922 | `[*urgency]`, `Receiving Line Item[KDC ETA Adjusted]`, `[Plant]`, `[Delivery]` ("ASN"), `[Container Number]` ("TR ID"), `Sum('Inbound Shipment Detail v3'[Pallet])`, `Sum(Receiving Line Item[Total SKUs])`, `Sum(Receiving Line Item[Total Qty])`, `[*urgency_sort]` (hidden sort) | Visual filter: `Is Tomorrow = 1` |
| `76c649b9…` | **tableEx** | "Receiving Summary Detail Veiw" | 6,279,6000,1018,642 | same set as Today detail table (Receiving Line Item Details + Urgency Order) | slide-over group `7e8cb7d2…`; filter `Is Tomorrow = 1` |
| `d2dc82c3…` | textbox | Urgency definition legend | 383,42,1000,642,281 | — | |
| `c7dff714…` | textbox | urgency color legend | 1358,324,14000,299,216 | bound counts | |
| `a148a0bd…`/`141e0c50…` | shape | detail panel bg / divider | — | — | |
| `a386a6c7…` | textbox | DCOE footer + link | 20,1202,2000,1125,48 | — | |

**Visual count: 22** (incl. groups).

> **Data-binding anomalies to verify when rebuilding** (the export contains a couple of likely copy-paste mistakes): Today page LCL card (`fcd375b9…`) and Tomorrow page second "Total Trailers" card (`8a7da2b2…`) appear bound to `*scheduled_containers_today`/`*scheduled_lcl_containers_today` instead of their titled metric. Treat the **title** + the `_today`/`_tom` family as the intended semantics.

---

## 6. Measures (DAX)
All measures live on the `#Measure` table unless noted. DAX is verbatim. (`TODAY()` = report-run date; tomorrow = `TODAY()+1`.)

### KPI scalar measures

```dax
-- *scheduled_lcl_containers_today  (formatString: 0)
VAR scheduled = CALCULATE(
    DISTINCTCOUNT('Inbound Shipment Detail v3'[CONTAINER#]),
    FILTER('Inbound Shipment Detail v3', NOT(ISBLANK('Inbound Shipment Detail v3'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() && 'Inbound Shipment Detail v3'[Status] = "In Transit" && 'Inbound Shipment Detail v3'[Mode] = "LCL"
 )
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_pallets_today  (formatString: 0)
VAR scheduled = CALCULATE(
    SUM('Inbound Shipment Detail v3'[Pallet]),
    FILTER('Inbound Shipment Detail v3', NOT(ISBLANK('Inbound Shipment Detail v3'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() && 'Inbound Shipment Detail v3'[Status] = "In Transit"
)
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_lineitems_today  (formatString: 0)
VAR scheduled = CALCULATE(
    SUM('Receiving Line Item'[Total SKUs]),
    FILTER('Receiving Line Item', NOT(ISBLANK('Receiving Line Item'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY()
)
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_qty_today  (formatString: #,0)
VAR scheduled = CALCULATE(
    SUM('Receiving Line Item'[Total Qty]),
    FILTER('Receiving Line Item', NOT(ISBLANK('Receiving Line Item'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY()
)
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_lcl_containers_tom  (formatString: 0)
VAR scheduled = CALCULATE(
    DISTINCTCOUNT('Inbound Shipment Detail v3'[CONTAINER#]),
    FILTER('Inbound Shipment Detail v3', NOT(ISBLANK('Inbound Shipment Detail v3'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() + 1 && 'Inbound Shipment Detail v3'[Status] = "In Transit" && 'Inbound Shipment Detail v3'[Mode] = "LCL"
 )
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_pallets_tom  (formatString: 0)
VAR scheduled = CALCULATE(
    SUM('Inbound Shipment Detail v3'[Pallet]),
    FILTER('Inbound Shipment Detail v3', NOT(ISBLANK('Inbound Shipment Detail v3'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() + 1 && 'Inbound Shipment Detail v3'[Status] = "In Transit"
)
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_lineitems_tom  (formatString: 0)
VAR scheduled = CALCULATE(
    SUM('Receiving Line Item'[Total SKUs]),
    FILTER('Receiving Line Item', NOT(ISBLANK('Receiving Line Item'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() + 1
)
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_qty_tom  (formatString: #,0)
VAR scheduled = CALCULATE(
    SUM('Receiving Line Item'[Total Qty]),
    FILTER('Receiving Line Item', NOT(ISBLANK('Receiving Line Item'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() + 1
)
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_asn_today  (formatString: 0)
VAR scheduled = CALCULATE(
    DISTINCTCOUNT('Receiving Line Item'[Delivery]),
    FILTER('Receiving Line Item', NOT(ISBLANK('Receiving Line Item'[KDC ETA Adjusted]))),
    'Receiving Line Item'[KDC ETA Adjusted] = TODAY()
 )
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_asn_tom  (formatString: 0)
VAR scheduled = CALCULATE(
    DISTINCTCOUNT('Receiving Line Item'[Delivery]),
    FILTER('Receiving Line Item', NOT(ISBLANK('Receiving Line Item'[KDC ETA Adjusted]))),
    'Receiving Line Item'[KDC ETA Adjusted] = TODAY() + 1
 )
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_fcl_containers_tom  (formatString: 0)
VAR scheduled = CALCULATE(
    DISTINCTCOUNT('Inbound Shipment Detail v3'[CONTAINER#]),
    FILTER('Inbound Shipment Detail v3', NOT(ISBLANK('Inbound Shipment Detail v3'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() + 1 && 'Inbound Shipment Detail v3'[Status] = "In Transit" && 'Inbound Shipment Detail v3'[Mode] = "FCL"
 )
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_fcl_containers_today  (formatString: 0)
VAR scheduled = CALCULATE(
    DISTINCTCOUNT('Inbound Shipment Detail v3'[CONTAINER#]),
    FILTER('Inbound Shipment Detail v3', NOT(ISBLANK('Inbound Shipment Detail v3'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() && 'Inbound Shipment Detail v3'[Status] = "In Transit" && 'Inbound Shipment Detail v3'[Mode] = "FCL"
 )
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_containers_today  (formatString: 0)
VAR scheduled = CALCULATE(
    DISTINCTCOUNT('Inbound Shipment Detail v3'[CONTAINER#]),
    FILTER('Inbound Shipment Detail v3', NOT(ISBLANK('Inbound Shipment Detail v3'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() && 'Inbound Shipment Detail v3'[Status] = "In Transit"
 )
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```
```dax
-- *scheduled_containers_tom  (formatString: 0)
VAR scheduled = CALCULATE(
    DISTINCTCOUNT('Inbound Shipment Detail v3'[CONTAINER#]),
    FILTER('Inbound Shipment Detail v3', NOT(ISBLANK('Inbound Shipment Detail v3'[KDC ETA Adjusted]))),
    'Inbound Shipment Detail v3'[KDC ETA Adjusted] = TODAY() + 1 && 'Inbound Shipment Detail v3'[Status] = "In Transit"
 )
RETURN IF(ISBLANK(scheduled), 0, scheduled)
```

### Urgency count measures (Receiving Line Item, by Urgency tier)
All follow the same template; `_tom` variants use `= TODAY() + 1`, `today_` variants use `= TODAY()`.

```dax
-- *tom_super_urgent  (formatString: 0)  [also: tom_urgent, tom_expedite, tom_high, tom_medium, tom_low]
VAR su = CALCULATE (
    COUNTROWS ('Receiving Line Item'),
    'Receiving Line Item'[Urgency] = "Super Urgent",      -- "Urgent" | "Expedite" | "High" | "Medium" | "Low"
    NOT ( ISBLANK ('Receiving Line Item'[KDC ETA Adjusted])),
    'Receiving Line Item'[KDC ETA Adjusted] = TODAY () + 1
)
RETURN COALESCE (su, 0)
```
```dax
-- *today_super_urgent  (formatString: 0)  [also: today_urgent, today_expedite, today_high, today_medium, today_low]
VAR su = CALCULATE (
    COUNTROWS ('Receiving Line Item'),
    'Receiving Line Item'[Urgency] = "Super Urgent",      -- one per tier
    NOT ( ISBLANK ('Receiving Line Item'[KDC ETA Adjusted])),
    'Receiving Line Item'[KDC ETA Adjusted] = TODAY ()
)
RETURN COALESCE (su, 0)
```
Tier values used across all of the above: `"Super Urgent" | "Urgent" | "Expedite" | "High" | "Medium" | "Low"`.

```dax
-- *today_urgent_group  (formatString: 0)
[*today_super_urgent] + [*today_urgent]
```
```dax
-- *tom_urgent_group  (formatString: 0)
[*tom_super_urgent] + [*tom_urgent]
```
```dax
-- *tom_urgent_sku  (formatString: 0)   (uses the SKU-level Details table)
VAR u = CALCULATE (
    COUNTROWS ('Receiving Line Item Details'),
    'Receiving Line Item Details'[Urgency] in { "Urgent", "Super Urgent" },
    NOT ( ISBLANK ('Receiving Line Item'[KDC ETA Adjusted])),
    'Receiving Line Item'[KDC ETA Adjusted] = TODAY () + 1
)
RETURN COALESCE (u, 0)
```

### Urgency display / sort
```dax
-- *urgency   (no format string; returns a filled circle glyph)
IF( NOT ISBLANK(SELECTEDVALUE('Receiving Line Item'[Urgency])), UNICHAR(11044) )
```
```dax
-- *urgency_sort   (formatString: 0, isHidden)
VAR _urgency = SELECTEDVALUE('Receiving Line Item'[Urgency])
RETURN SWITCH(_urgency, "Super Urgent", 1, "Urgent", 2, "Expedite", 3, "High", 4, "Medium", 5, "Low", 6)
```
```dax
-- *act_cov   (formatString: 0)
VAR today = TODAY()
VAR act = CALCULATE(
        MAX('Receiving Line Item Details'[ActCov]),
        FILTER( ALL('Receiving Line Item'[KDC ETA Adjusted]), 'Receiving Line Item'[KDC ETA Adjusted] >= today )
    )
RETURN IF(ISBLANK(act), "–", FORMAT(act, "#,##0.0"))
```

### `#Measure`-table calculated column
```dax
-- column *today_urgent_sku  (formatString: 0)   [NOTE: this is a COLUMN, not a measure]
VAR u = CALCULATE (
    COUNTROWS ('Receiving Line Item Details'),
    'Receiving Line Item Details'[Urgency] in { "Urgent", "Super Urgent" },
    NOT ( ISBLANK ('Receiving Line Item'[KDC ETA Adjusted])),
    'Receiving Line Item'[KDC ETA Adjusted] = TODAY ()
)
RETURN COALESCE (u, 0)
```

### HTML-generating measures (Calendar page)
These produce complete HTML strings; reimplement as React components, not as ported DAX.

- **`*CalendarHTML`** — builds a 6×7 month grid `<table>` from `'Inbound Shipment Display'` (shipment dots) and `'Receiving Line Item_grouped'` (ASN dots) for the current month. CSS: header `#0078d4`, ship `.cal-ship #0078d4`, recv `.cal-recv #d83b01`, today highlight circle. (Appears to be an earlier version of the calendar.)
- **`*html_calendar`** (formatString `""`) — the **live** month calendar used by visual `c0f454a2…`. Renders per-day tags parsed from `'Inbound Shipment Display'[concat]`: Pallets tag (`#E3F2FD/#1565C0`), FCL tag (`#E8F5E9/#2E7D32`), LCL tag (`#FFF3E0/#E65100`); weekday header Sun(`#D32F2F`)..Sat(`#1565C0`); today cell `#FFF8E1`. Week starts Sunday (`WEEKDAY(...,1)`).
- **`*html_asn_list`** (formatString `""`) — the ASN list used by visual `33825e68…`. For current month, ETA ≥ today: one `<div class='date-hdr'>` per date, then per-ASN rows from `'Receiving Line Item_grouped'` showing `ASN (Delivery)`, `TR ID (Container Number)`, `Total SKUs (Line Items)`, `Total Qty`, `Vendor (Vendor name)`. Color-cycles a 10-color palette: `#1565C0, #D32F2F, #E65100, #6A1B9A, #2E7D32, #F9A825, #00838F, #C62828, #4E342E, #283593`.

**Measure count: 33** (`#Measure` table) + 1 calculated column on `#Measure`. Plus calculated **columns** on data tables (see §7): `ETA Category`, `ETA Category Sort`, `Is From Today`, `Is Today`, `Is Tomorrow` (Inbound Shipment Detail v3), `Index` (Inbound Shipment Display), `Is From Today` (Receiving Line Item_grouped).

---

## 7. Data Model — Tables & Power Query Sources

Two underlying source systems:
- **Snowflake** — server `SHB67190.us-east-1.snowflakecomputing.com`, warehouse `COMPUTE_WH`, databases `EMP` (most tables) and `SCI` (Data Refreshed). Schema mostly `kdb.pbi_sf.*`; vessel data from `EMP.INVENTORY."VF_VesselPortcalls"`.
- **Smartsheet** — `SmartsheetGlobal.Contents("US", [])`, sheets referenced by Key (the shipment master, vessel list, buyers list).

Auto-generated `LocalDateTable_*` and `DateTableTemplate_*` exist (time-intelligence date hierarchies) — **skipped**, not needed for the rebuild.

### `Inbound Shipment Detail v3` (Smartsheet — shipment master)
The shipment/container master. **Source = Smartsheet** sheet Key `5494527893655428` (`SmartsheetGlobal.Contents("US")`). Many string columns; key ones below.

Key columns (dataType): `Status` (str), `CNEE` (str, → CompanyList), `CONTAINER#` (str, trimmed), `Mode` (str: FCL/LCL), `Pallet` (int64), `VESSEL` (str, → Vessel List), `DESTINATION` (str), `Trucking Company` (str, null→"Not Assigned"), `Container Size`, `PGR`, `HBL`, `INVOICE#`, `CARRIER`, `Freight Forwarder`, `ORIGIN`, `COUNTRY`, `TERMINAL`, `KDC ETA` (date), `KDC ETA (DASH)` (date), `Confirmed KDC ETA` (date), and many more text fields.

`KDC ETA Adjusted` is a **Power Query custom column**: if `KDC ETA (DASH)` falls on a 2026 US holiday (New Year, Memorial, Independence(obs), Labor, Thanksgiving, Christmas) then `+1 day`, else unchanged. **This adjusted date drives nearly all the dashboard's date logic.**

Calculated columns (DAX):
- `ETA Category` → "Yesterday"/"Today"/"Tomorrow" based on `KDC ETA` vs `TODAY()`, where "tomorrow" skips weekends (Sat→+2, the SWITCH uses WEEKDAY mode 2: w=6→today+3, w=7→today+2).
- `ETA Category Sort` → 1/2/3/99 (sorts ETA Category).
- `Is From Today` = `IF([KDC ETA Adjusted] >= TODAY(),1,0)`
- `Is Today` = `IF([KDC ETA Adjusted] = TODAY(),1,0)`
- `Is Tomorrow` = `IF([KDC ETA Adjusted] = TODAY()+1,1,0)`

M source (verbatim partition):
```m
let
    Source = SmartsheetGlobal.Contents("US", []),
    #"966404796114820" = Source{[Key="5494527893655428"]}[Data],
    #"Replaced Value" = Table.TransformColumns(#"966404796114820",{"Trucking Company", each if _ = null or _ = "" then "Not Assigned" else _}),
    #"Trimmed Text" = Table.TransformColumns(#"Replaced Value",{{"CONTAINER#", Text.Trim, type text}}),
    #"Changed Type" = Table.TransformColumnTypes(#"Trimmed Text",{{"Pallet", Int64.Type}, {"KDC ETA", type date}, {"KDC ETA (DASH)", type date}, {"Confirmed KDC ETA", type date}}),
    #"Added Custom" = Table.AddColumn(#"Changed Type", "KDC ETA Adjusted", each if List.Contains(
    { #date(2026,1,1), #date(2026,5,25), #date(2026,7,3), #date(2026,9,7), #date(2026,11,26), #date(2026,12,25) }, [#"KDC ETA (DASH)"])
    then Date.AddDays([#"KDC ETA (DASH)"], 1) else [#"KDC ETA (DASH)"]),
    #"Changed Type1" = Table.TransformColumnTypes(#"Added Custom",{{"KDC ETA Adjusted", type date}})
in
    #"Changed Type1"
```

### `Inbound Shipment Display` (Snowflake + Smartsheet — calendar feed)
Aggregated per-day display rows feeding the Calendar HTML. Columns: `Attribute` (str), `Value` (double), `concat` (str), `KDC ETA Adjusted` (date), `Index` (calc col: TR=1/FCL=2/LCL=4/Pallets=5).

The Snowflake native query (verbatim, the `#(lf)` are newline escapes) joins SAP vendor-confirmation, delivery, MRP-list and inventory tables:
```sql
with base as (
select "Client", plant_key, a."Purchasing Document Number",
    "Sequential Number of Vendor Confirmation", "Confirmation Category",
    "Reference Document Number (for Dependencies see Long Text)", a."Delivery",
    "Means of Transport ID" as "Container Number", "Vendor name", material_key,
    "Delivery Date of Vendor Confirmation",
    sum("Quantity as Per Vendor Confirmation") as "Quantity as Per Vendor Confirmation",
    sum("Quantity Reduced (MRP)") as "Quantity Reduced (MRP)"
from kdb.pbi_sf.ekes a
left join (select distinct "Delivery", "Means of Transport ID" from kdb.pbi_sf.likp) b
    on a."Delivery" = b."Delivery"
left join (select plant_key, material_key, "Vendor name",
        left(mrpelementdata,10) as "Purchasing Document Number",
        right(mrpelementdata,5) as "Item Number of Purchasing Document",
        QUANTITYRECEIVED_QUANTITYREQUIRED
    from kdb.pbi_sf.sap_mrplist where ABBREVMRPELEMENT = 'ShpgNt') c
    on a."Purchasing Document Number" = c."Purchasing Document Number"
   and a."Material Number Corresponding to Manufacturer Part Number" = c.material_key
   and a."Quantity as Per Vendor Confirmation" = c.QUANTITYRECEIVED_QUANTITYREQUIRED
where "Creation Date of Confirmation" >= '2025-01-01'
  and ("Quantity as Per Vendor Confirmation" - "Quantity Reduced (MRP)") != 0
  and material_key is not null
group by 1,2,3,4,5,6,7,8,9,10,11
order by a."Delivery")
select "Client", b.plant_key, "Purchasing Document Number",
    "Sequential Number of Vendor Confirmation", "Confirmation Category",
    "Reference Document Number (for Dependencies see Long Text)", "Delivery",
    "Container Number", "Vendor name", b.material_key,
    "Delivery Date of Vendor Confirmation",
    "Quantity as Per Vendor Confirmation", "Quantity Reduced (MRP)"
from base b
left join (select client_key, material_key, plant_key,
        sum(unrestricted_qty + transfer_qty + qualityinspection_qty + blocked_qty + blockreturn_qty + consignment_qty) as total_stock
    from kdb.pbi_sf.sap_inventory_im group by 1,2,3) i
on b."Client" = i.client_key and b.plant_key = i.plant_key and b.material_key = i.material_key
```
Subsequent M steps merge with `#"Inbound Shipment"` (Smartsheet, to bring `KDC ETA Adjusted, Pallet, CNEE`), group by `KDC ETA Adjusted` summing pallets, unpivot, build `concat = Attribute & " " & Value`, then append the `FCL/LCL` shared query.

### `Receiving Line Item` (Snowflake — receiving summary, grouped to ASN level)
The primary grid + KPI source. Columns: `Delivery` (str, "ASN"), `Container Number` (str, "TR ID"), `Total Qty` (double), `Plant` (str), `Client` (str), `Total SKUs` (double), `Total Stock` (double), `Average daily requirements` (double), `Urgency` (str), `KDC ETA Adjusted` (date, merged from Inbound Shipment).

Snowflake native query (verbatim, abbreviated whitespace): builds `base` from `kdb.pbi_sf.lips` (delivery line items) joined to `kdb.pbi_sf.ekes` (vendor confirmation) and `kdb.pbi_sf.likp` (delivery header, for `Means of Transport ID` = container), filtered `"Delivery" like '018%'`; `total_stock` CTE from `kdb.pbi_sf.sap_inventory_im`; `daily_req` CTE from `kdb.pbi_sf.ztpp_mrplist`; computes `ActCov = floor(total_stock / nullif(avg_daily_req,0),1)` and an **Urgency** tier:
```sql
case when total_stock/nullif(adr,0) < 1 then 'Super Urgent'
     when total_stock/nullif(adr,0) >= 1 and (total_stock-adr)/nullif(adr,0) < 2 then 'Urgent'
     when total_stock/nullif(adr,0) >= 2 and (total_stock-adr)/nullif(adr,0) < 3 then 'Expedite'
     when total_stock/nullif(adr,0) >= 3 and (total_stock-adr)/nullif(adr,0) < 5 then 'High'
     when total_stock/nullif(adr,0) > 5  and (total_stock-adr)/nullif(adr,0) < 10 then 'Medium'
     else 'Low' end as "Urgency"
```
Final SELECT groups by Client/Plant/Delivery/Container Number: `count(distinct material_key) as "Total SKUs"`, `sum(qty) as "Total Qty"`, `max(total_stock)`, `max(avg_daily_req)`, and the **minimum** (most urgent) Urgency tier. M then buffers, left-joins `#"Inbound Shipment"` on `Container Number = CONTAINER#` to attach `KDC ETA Adjusted`, drops null-ETA rows, dedups.

Source tables: `kdb.pbi_sf.lips`, `kdb.pbi_sf.ekes`, `kdb.pbi_sf.likp`, `kdb.pbi_sf.sap_inventory_im`, `kdb.pbi_sf.ztpp_mrplist`.

### `Receiving Line Item Details` (Snowflake — receiving at SKU/material grain)
Detail (drill) table. Columns: `Delivery`, `Container Number`, `Client`, `Material key`, `Plant`, `Storage Location`, `Actual quantity delivered (in sales units)` (double), `Document number of the reference document`, `Delivery Item`, `Total Stock` (double), `Average daily requirements` (double), `ActCov` (double), `Urgency` (str), `ActCov_modified` (str — "–" if blank).

Same Snowflake CTE structure as `Receiving Line Item` but **not aggregated to ASN** — returns `base.*` plus `Total Stock`, `Average daily requirements`, `ActCov`, `Urgency` at the line/material level. Sources: `kdb.pbi_sf.lips`, `kdb.pbi_sf.ekes`, `kdb.pbi_sf.likp`, `kdb.pbi_sf.sap_inventory_im`, `kdb.pbi_sf.ztpp_mrplist`. M adds `ActCov_modified`.

### `Receiving Line Item_grouped` (Snowflake — ASN list feed for Calendar)
Feeds `*html_asn_list` / `*html_calendar`. Columns: `Delivery`, `Container Number`, `KDC ETA Adjusted` (date), `Vendor name`, `Total Qty` (double), `Line Items` (int64), `Custom` (str), `Is From Today` (calc col `>= TODAY()`).
Same `base` Snowflake query as `Inbound Shipment Display` (the `ekes/likp/sap_mrplist/sap_inventory_im` join). M merges with Smartsheet `#"Inbound Shipment"` for `KDC ETA Adjusted`, groups by `Delivery, Container Number, KDC ETA Adjusted, Vendor name` → `Total Qty = sum(qty)`, `Line Items = distinct count`, and builds `Custom = "ASN: … | TR ID: … | Total SKUs: … | Total Qty: … | Vendor: …"`.

### `VF_VesselPortcalls` (Snowflake — vessel positions)
Feeds the In-Transit map + pivot "Current Location"/"Departure/Arrival". Columns: `IMO` (str), `LOCODE`, `TIMESTAMP_DATE` (date), `TIMESTAMP_TIME`, `PORT`, `COUNTRY`, `EVENT`.
```sql
SELECT TO_VARCHAR(IMO) AS IMO, "PORTCALL.LOCODE" AS LOCODE, "PORTCALL.EVENT" AS EVENT,
    TO_DATE(SPLIT_PART("PORTCALL.TIMESTAMP",' ',1)) AS TIMESTAMP_DATE,
    SPLIT_PART("PORTCALL.TIMESTAMP",' ',-2) AS TIMESTAMP_TIME,
    "PORTCALL.PORT" AS PORT, "PORTCALL.COUNTRY" AS COUNTRY
FROM EMP.INVENTORY."VF_VesselPortcalls"
QUALIFY ROW_NUMBER() OVER (PARTITION BY IMO ORDER BY DATA_UPDATE_DATE DESC, "PORTCALL.TIMESTAMP" DESC) = 1
ORDER BY IMO DESC
```

### `Data Refreshed` (Snowflake — refresh timestamp)
One column `DATA_REFRESHED` (datetime). DB `SCI`:
```sql
SELECT GETDATE() AS Data_Refreshed
```

### `Vessel List` (Smartsheet)
Columns: `RowNumber` (int64), `Duplicate` (bool), `VESSEL` (str), `IMO` (int64), `MMSI` (int64). Source: Smartsheet sheet Key `3716376994047876`.

### `Buyers List` (Smartsheet)
Columns: `VENDOR CODE` (str), `Purchasing Grp` (int64), `Contact` (str). Source: Smartsheet sheet Key `2837039422590852`; splits "HQ BUYER" column. (Not currently bound to any visible visual but available.)

### `CompanyList` (calculated DATATABLE)
Drives the Company slicer. `Company` (str, sorted by `Sort`), `Sort` (int):
`KISS=1, IVY=2, RED=3, VIVACE=4, AST=5, CHILLHOUSE=6, DIVA=7, ORANGE=8`.

### `Urgency Order` (calculated DATATABLE)
`Urgency` (str, sorted by SortOrder), `SortOrder` (int): `Super Urgent=1, Urgent=2, Expedite=3, High=4, Medium=5, Low=6`.

---

## 8. Relationships

| From | To | Cardinality / Direction | Active | Notes |
|---|---|---|---|---|
| `Inbound Shipment Detail v3[VESSEL]` | `Vessel List[VESSEL]` | both directions | yes | auto-detected |
| `Vessel List[IMO]` | `VF_VesselPortcalls[IMO]` | both directions | yes | |
| `Inbound Shipment Detail v3[CNEE]` | `CompanyList[Company]` | single | yes | company slicer → shipments |
| `Receiving Line Item Details[Delivery]` | `Receiving Line Item[Delivery]` | single | yes | detail → summary |
| `Receiving Line Item[Container Number]` | `Inbound Shipment Detail v3[CONTAINER#]` | →many, both directions | yes | links receiving to shipment ETA |
| `Receiving Line Item Details[Urgency]` | `Urgency Order[Urgency]` | single | yes | urgency sort |
| `Receiving Line Item[Urgency]` | `Urgency Order[Urgency]` | single | **no (inactive)** | |
| `Receiving Line Item_grouped[Delivery]` | `Receiving Line Item[Delivery]` | single | **no (inactive)** | auto-detected |
| Date relationships to `LocalDateTable_*` | — | datePartOnly | yes | time-intelligence on `KDC ETA`, `KDC ETA (DASH)`, `KDC ETA Adjusted`, `Confirmed KDC ETA`, `DATA_REFRESHED`, `TIMESTAMP_DATE` (auto date hierarchies) |

---

## 9. Shared Expressions / Parameters

Two shared Power Query expressions (queryGroup "Inbound Shipment"), both reading the **same Smartsheet sheet** (`Key="5494527893655428"`) as `Inbound Shipment Detail v3`:

- **`Inbound Shipment`** — Smartsheet shipment master, filtered `Status = "In Transit"`, with the same `KDC ETA Adjusted` 2026-holiday adjustment, reduced to columns `CNEE, CONTAINER#, KDC ETA Adjusted, Pallet`. Used as the join source to attach ETA to the Snowflake receiving/display tables.
- **`FCL/LCL`** — same Smartsheet source filtered `Status = "In Transit"`; groups by `KDC ETA Adjusted, Mode` counting distinct containers, builds `concat = "# of " & Mode & ": " & Value`; renamed `Mode → Attribute`. Appended into `Inbound Shipment Display`.

No standalone connection-parameter expressions (server/warehouse are hard-coded inline in each native query). Model culture en-US, `__PBI_TimeIntelligenceEnabled = 1`.

---

## 10. Synthesis

### 10.1 Data Source Map (→ map these to Snowflake)
Snowflake server `SHB67190.us-east-1.snowflakecomputing.com`, warehouse `COMPUTE_WH`.

| Model table | Source system | Verbatim source identifiers |
|---|---|---|
| Inbound Shipment Detail v3 | Smartsheet | sheet Key `5494527893655428` |
| Inbound Shipment (shared) | Smartsheet | sheet Key `5494527893655428` |
| FCL/LCL (shared) | Smartsheet | sheet Key `5494527893655428` |
| Vessel List | Smartsheet | sheet Key `3716376994047876` |
| Buyers List | Smartsheet | sheet Key `2837039422590852` |
| Inbound Shipment Display | Snowflake EMP | `kdb.pbi_sf.ekes`, `kdb.pbi_sf.likp`, `kdb.pbi_sf.sap_mrplist`, `kdb.pbi_sf.sap_inventory_im` (+ Smartsheet merge) |
| Receiving Line Item | Snowflake EMP | `kdb.pbi_sf.lips`, `kdb.pbi_sf.ekes`, `kdb.pbi_sf.likp`, `kdb.pbi_sf.sap_inventory_im`, `kdb.pbi_sf.ztpp_mrplist` (+ Smartsheet merge) |
| Receiving Line Item Details | Snowflake EMP | `kdb.pbi_sf.lips`, `kdb.pbi_sf.ekes`, `kdb.pbi_sf.likp`, `kdb.pbi_sf.sap_inventory_im`, `kdb.pbi_sf.ztpp_mrplist` |
| Receiving Line Item_grouped | Snowflake EMP | `kdb.pbi_sf.ekes`, `kdb.pbi_sf.likp`, `kdb.pbi_sf.sap_mrplist`, `kdb.pbi_sf.sap_inventory_im` (+ Smartsheet merge) |
| VF_VesselPortcalls | Snowflake EMP | `EMP.INVENTORY."VF_VesselPortcalls"` |
| Data Refreshed | Snowflake SCI | `SELECT GETDATE()` |
| CompanyList, Urgency Order | calculated (DATATABLE) | constants — recreate in code |

Distinct underlying SAP/Snowflake tables to source: **`kdb.pbi_sf.ekes`** (vendor confirmations), **`kdb.pbi_sf.lips`** (delivery line items), **`kdb.pbi_sf.likp`** (delivery headers → container/Means of Transport ID), **`kdb.pbi_sf.sap_inventory_im`** (inventory → total stock), **`kdb.pbi_sf.ztpp_mrplist`** (avg daily requirements), **`kdb.pbi_sf.sap_mrplist`** (MRP shipping-notice element), **`EMP.INVENTORY."VF_VesselPortcalls"`** (vessel port calls). Plus 3 Smartsheet sheets and `SCI`'s `GETDATE()`.

### 10.2 Visual → Measure → Source trace (key KPIs)

- **Today/Tomorrow "Total ASNs"** → `*scheduled_asn_today`/`_tom` → `DISTINCTCOUNT(Receiving Line Item[Delivery])` where `KDC ETA Adjusted = today/tom` → Snowflake `lips/ekes/likp` joined for delivery, ETA from Smartsheet master.
- **"Total Trailers"** → `*scheduled_containers_today`/`_tom` → `DISTINCTCOUNT(Inbound Shipment Detail v3[CONTAINER#])`, `Status="In Transit"`, ETA filter → Smartsheet master.
- **"FCL" / "LCL"** → `*scheduled_fcl_containers_*` / `*scheduled_lcl_containers_*` → same as Trailers + `Mode = "FCL"/"LCL"`.
- **"Total Pallets"** → `*scheduled_pallets_*` → `SUM(Inbound Shipment Detail v3[Pallet])` → Smartsheet master.
- **"Total SKUs"** → `*scheduled_lineitems_*` → `SUM(Receiving Line Item[Total SKUs])` (= `count(distinct material_key)` in Snowflake) → Snowflake receiving.
- **"Total Qty"** → `*scheduled_qty_*` → `SUM(Receiving Line Item[Total Qty])` (= sum delivered qty) → Snowflake receiving.
- **"Total Urgent SKUs"** → `*today_urgent_sku` (col) / `*tom_urgent_sku` → count of `Receiving Line Item Details` rows with Urgency ∈ {Urgent, Super Urgent} → Snowflake detail.
- **"Total Urgent Qty"** → `*today_urgent_group` / `*tom_urgent_group` → super urgent + urgent ASN counts.
- **In-Transit "# of Containers" card / combo chart** → `Min/Distinct(CONTAINER#)` & `Sum(Pallet)` by `KDC ETA` → Smartsheet master.
- **In-Transit map & "Current Location" pivot column** → `VF_VesselPortcalls[PORT/EVENT/LOCODE/TIMESTAMP_DATE]` joined via Vessel List IMO → Snowflake `VF_VesselPortcalls`.
- **Receiving Summary table (Today/Tomorrow)** → `Receiving Line Item` columns + `*urgency` glyph, filtered by `Inbound Shipment Detail v3[Is Today]/[Is Tomorrow]`.
- **Receiving Summary Detail (slide-over)** → `Receiving Line Item Details` (material grain) + `Total Stock`, `ActCov_modified`, `Urgency Order[Urgency]`.
- **Calendar page panels** → `*html_asn_list` from `Receiving Line Item_grouped`; `*html_calendar` from `Inbound Shipment Display`.

### 10.3 Distinct visual types used (→ React/component mapping)
| PBI visualType | Count of placements | Suggested React equivalent |
|---|---|---|
| `card` | many (KPIs) | KPI stat card component |
| `pivotTable` | 1 (In-Transit "Inbound Schedule") | expandable/grouped data grid (e.g. TanStack Table with row grouping) |
| `tableEx` | 4 (Receiving Summary + Detail × 2 pages) | data grid / table |
| `slicer` | 7 (In-Transit filter rail) | dropdown/multiselect filter controls |
| `lineStackedColumnComboChart` | 1 | combo bar+line chart (Recharts `ComposedChart`) |
| `azureMap` | 1 | map component (Mapbox/Leaflet) with port markers |
| `htmlContent` (custom) | 2 | bespoke React calendar grid + ASN list components |
| `actionButton` | 1 ("Clear all slicers") | reset-filters button |
| `textbox` | many (titles, legends, value-bound inline text, footer link) | text/label components |
| `image` | 3 (logo) | `<img>` |
| `shape` | several (panels, dividers, filter rail bg) | styled container `<div>` |
| `visualGroup` | grouping containers | layout wrappers |

### 10.4 Color palette / theme
- Base theme **CY24SU10** (Power BI default). dataColors begin `#118DFF, #12239E, #E66C37, #6B007B, #E044A7, …`; foreground `#252423`, background `#FFFFFF`, tableAccent `#118DFF`.
- **Brand accent (custom):** `#A01B2D` (KISS dark red) used for visual title bars (Inbound Schedule, Filter rail, section headers).
- **Calendar HTML palette:** shipment/blue `#0078d4` / `#1565C0`, receiving/orange-red `#d83b01` / `#E65100`; tag chips Pallets `#E3F2FD/#1565C0`, FCL `#E8F5E9/#2E7D32`, LCL `#FFF3E0/#E65100`; today highlight `#FFF8E1`; weekday Sun `#D32F2F` / Sat `#1565C0`.
- **ASN list 10-color cycle:** `#1565C0, #D32F2F, #E65100, #6A1B9A, #2E7D32, #F9A825, #00838F, #C62828, #4E342E, #283593`.
- Fonts: Segoe UI throughout; KPI/title sizes ~15–20pt.

### 10.5 Key business logic to preserve
1. **`KDC ETA Adjusted`** = `KDC ETA (DASH)` shifted +1 day when it lands on a 2026 US holiday. This is the canonical scheduling date everywhere.
2. **Urgency tiers** are derived in Snowflake from `ActCov = floor(total_stock / avg_daily_requirements)`: `<1 Super Urgent, 1–2 Urgent, 2–3 Expedite, 3–5 High, 5–10 Medium, else Low`. ASN-level urgency = the most severe (min sort) across its materials.
3. Only `Status = "In Transit"` shipments are in scope (enforced in M and in visual filters).
4. Receiving deliveries are limited to `"Delivery" like '018%'`.
5. Container link key = Smartsheet `CONTAINER#` ↔ SAP `likp."Means of Transport ID"`.
