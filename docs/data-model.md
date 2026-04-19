# Data Model

## FactShipment (primary fact table)

One row per shipment. Source fields pull from SAP + SCALE + UPS tracking.

| Field                  | Type        | Source    | Notes                                    |
|------------------------|-------------|-----------|------------------------------------------|
| ShipmentID             | VARCHAR(20) | SCALE     | PK, format: `SH-nnnnn`                   |
| OrderID                | VARCHAR(20) | SAP       | FK to SAP VBAK                           |
| CustomerID             | VARCHAR(10) | SAP       | FK to DimCustomer                        |
| CustomerName           | VARCHAR     | SAP       | Denormalized for display                 |
| Tier                   | VARCHAR(10) | Derived   | Key / Growth / Mid / Small               |
| Channel                | VARCHAR(30) | SAP/SCALE | One of 11 distribution channels          |
| DC_ID                  | VARCHAR(10) | SCALE     | e.g. `KDC-SAV`                           |
| CarrierID              | VARCHAR(10) | SCALE     | UPS-GND, UPS-2DA, etc.                   |
| ShipToState            | CHAR(2)     | SAP       | US state code                            |
| UPS_Zone               | TINYINT     | Lookup    | 2–8 based on ShipToState                 |
| Region                 | VARCHAR(20) | Lookup    | Southeast, Northeast, etc.               |
| SAP_OrderCreate        | DATETIME    | SAP       | VBAK-ERDAT + ERZET                       |
| SAP_OrderConfirm       | DATETIME    | SAP       | Order confirmation timestamp             |
| SAP_DeliveryPost       | DATETIME    | SAP       | LIKP posting date/time                   |
| SCALE_Received         | DATETIME    | SCALE     | When outbound delivery landed in SCALE   |
| SCALE_WaveRelease      | DATETIME    | SCALE     | Wave released for picking                |
| SCALE_PickComplete     | DATETIME    | SCALE     | All pick confirmations complete          |
| SCALE_PackComplete     | DATETIME    | SCALE     | Container closed                         |
| SCALE_ShipConfirm      | DATETIME    | SCALE     | Ship confirm / dock event                |
| UPS_CarrierScan        | DATETIME    | UPS API   | First carrier scan (pickup)              |
| UPS_Delivered          | DATETIME    | UPS API   | POD timestamp (NULL if in transit)       |
| Promise_ShipDate       | DATETIME    | SAP       | Customer-agreed ship date                |
| Promise_DeliveryDate   | DATETIME    | SAP       | Customer-agreed delivery date            |
| OrderValue             | DECIMAL     | SAP       | Total order $ value                      |
| Cartons                | INT         | SCALE     | Total container count                    |
| DelayRootCause         | VARCHAR(20) | Derived   | '' / UPS / DC / Missing / Damage / Other |
| DelayNotes             | VARCHAR     | Manual/CS | Free text                                |
| IsOpen                 | BOOLEAN     | Derived   | UPS_Delivered IS NULL                    |
| IsSplit                | BOOLEAN     | Derived   | Did order ship in multiple deliveries    |
| SplitCartons           | INT         | Derived   | How many separate shipments              |
| SplitGapDays           | INT         | Derived   | Days between first and last partial      |
| SplitReason            | VARCHAR     | Derived   | Short pick / Wave cutoff / etc.          |
| PrimarySku             | VARCHAR(20) | SCALE     | Most significant SKU on the order        |
| SkuFragile             | BOOLEAN     | Master    | Packaging flag                           |
| Chargeback             | DECIMAL     | Finance   | $ penalty for this shipment              |
| Shift                  | VARCHAR(20) | Derived   | Based on WaveRelease hour                |

## FactDelayEvent

One row per delay incident. Joins to FactShipment.

| Field           | Type        | Notes                        |
|-----------------|-------------|------------------------------|
| EventID         | VARCHAR(20) | PK                           |
| ShipmentID      | VARCHAR(20) | FK to FactShipment           |
| EventDate       | DATE        |                              |
| RootCause       | VARCHAR(20) |                              |
| StageImpacted   | VARCHAR     | Wave / Pick / Carrier / etc. |
| MinutesLate     | INT         |                              |
| EstCost         | DECIMAL     |                              |

## Dimension Tables

**DimCustomer** — CustomerID, CustomerName, Channel, Tier, ShipToState
**DimCarrier** — CarrierID, CarrierName, ServiceLevel, Mode
**DimDC** — DC_ID, DC_Name, City, State, Type
**DimSKU** — SKU, SKU_Name, Category, Brand, UnitCost, Fragile
**DimUPSZone** — State, UPS_Zone, Region
**DimDate** — Date, Year, Quarter, Month, Week, DayOfWeek, IsWeekend

## Distribution Channels

Exact enum values used in the prototype:

```
CS - Bulk
CS - DSDC
BS - IVY
BS - RED
VIVACE
AST
IIO
KIO
ECOM - AMAZON 1P
ECOM - AMAZON 3P
ECOM - DTC
```

## Relationships (star schema)

```
FactShipment ──►  DimCustomer     (CustomerID)
             ──►  DimCarrier      (CarrierID)
             ──►  DimDC           (DC_ID)
             ──►  DimUPSZone      (ShipToState → State)
             ──►  DimSKU          (PrimarySku → SKU)
             ──►  DimDate         (SAP_OrderCreate → Date)

FactDelayEvent ──► FactShipment   (ShipmentID)
               ──► DimDate        (EventDate → Date)
```

## SLA Targets (configurable, stored in Config DB)

| Stage | Name                    | System    | Default Target |
|-------|-------------------------|-----------|----------------|
| 1     | Order → Confirm         | SAP       | 30 min         |
| 2     | Confirm → Delivery Post | SAP       | 120 min        |
| 3     | SAP → SCALE Handoff     | Interface | 30 min         |
| 4     | Wave / Allocation       | SCALE     | 240 min        |
| 5     | Pick                    | SCALE     | 120 min        |
| 6     | Pack                    | SCALE     | 60 min         |
| 7     | Dock / Ship Confirm     | SCALE     | 120 min        |
| 8     | Carrier Pickup          | UPS/LTL   | 480 min        |

**Total end-to-end target:** 1,220 min = ~20.3 hours.

## CSV Upload Schema

Headers required (case-sensitive, matching prototype):

```
ShipmentID,OrderID,CustomerID,DC_ID,CarrierID,ShipToState,
SAP_OrderCreate,SAP_OrderConfirm,SAP_DeliveryPost,
SCALE_Received,SCALE_WaveRelease,SCALE_PickComplete,
SCALE_PackComplete,SCALE_ShipConfirm,
UPS_CarrierScan,UPS_Delivered,
Promise_ShipDate,Promise_DeliveryDate,
OrderValue,Cartons,DelayRootCause,DelayNotes
```

Dates in ISO 8601 (`2026-04-15T14:30:00`) or `YYYY-MM-DD HH:MM` format.

See `public/sample-data.csv` for an example.
