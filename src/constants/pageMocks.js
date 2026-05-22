// Page-specific mock data + supporting lookups. Extracted from
// src/ShippingSLAApp.jsx during PR R1. MOCK_RECEIVING_QUEUE depends on
// SKUS from data/mockShipments.js; MOCK_OPTIMIZER uses lucide-react icons.

import { Waves, Warehouse, HardHat, Truck } from 'lucide-react';
import { SKUS } from '../data/mockShipments.js';

export const MOCK_DOCKS = Array.from({ length: 12 }, (_, i) => ({
  doorId: `DOOR-${String(i + 1).padStart(2, '0')}`,
  status: ['AVAILABLE','UNLOADING','LOADING','SCHEDULED','MAINTENANCE'][Math.floor(Math.random()*5)],
  carrier: ['UPS','FedEx','R&L LTL','XPO','Conway'][Math.floor(Math.random()*5)],
  trailer: `TRL-${1000+Math.floor(Math.random()*9000)}`,
  arrival: Math.random() > 0.4 ? new Date(Date.now() - Math.random()*3600000*4) : null,
}));

export const MOCK_RECEIVING_QUEUE = Array.from({ length: 9 }, (_, i) => ({
  receiptId: `RCV-${4000+i}`,
  shipmentId: `SH-${10000+Math.floor(Math.random()*320)}`,
  sku: SKUS[Math.floor(Math.random()*SKUS.length)].sku,
  dock: `DOOR-${String(Math.floor(Math.random()*12)+1).padStart(2, '0')}`,
  expectedQty: 50 + Math.floor(Math.random()*200),
  receivedQty: 0,
  discrepancy: [null, null, null, null, 'OVERAGE', 'SHORTAGE', 'DAMAGE'][Math.floor(Math.random()*7)],
}));
MOCK_RECEIVING_QUEUE.forEach(r => {
  r.receivedQty = r.discrepancy === 'OVERAGE' ? r.expectedQty + Math.floor(Math.random()*20)+1
    : r.discrepancy === 'SHORTAGE' ? r.expectedQty - Math.floor(Math.random()*30)-1
    : r.discrepancy === 'DAMAGE' ? r.expectedQty - Math.floor(Math.random()*10)-1
    : r.expectedQty;
});

export const MOCK_ZONES = [
  { zone: 'AMBIENT-A', totalLocations: 1200, occupiedLocations: 780, utilization: 65.0, alertLevel: 'OK' },
  { zone: 'AMBIENT-B', totalLocations: 1100, occupiedLocations: 935, utilization: 85.0, alertLevel: 'WARNING' },
  { zone: 'CLIMATE-C', totalLocations: 600, occupiedLocations: 552, utilization: 92.0, alertLevel: 'CRITICAL' },
  { zone: 'HAZMAT-D', totalLocations: 200, occupiedLocations: 110, utilization: 55.0, alertLevel: 'OK' },
  { zone: 'HIGH-BAY-E', totalLocations: 800, occupiedLocations: 616, utilization: 77.0, alertLevel: 'OK' },
  { zone: 'MEZZANINE-F', totalLocations: 500, occupiedLocations: 440, utilization: 88.0, alertLevel: 'WARNING' },
];

export const MOCK_LABOR = [
  { zone: 'AMBIENT-A', headcount: 18, planned: 20, avgProductivity: 142, targetProductivity: 150, utilization: 82 },
  { zone: 'AMBIENT-B', headcount: 22, planned: 22, avgProductivity: 158, targetProductivity: 150, utilization: 91 },
  { zone: 'CLIMATE-C', headcount: 8, planned: 10, avgProductivity: 110, targetProductivity: 130, utilization: 74 },
  { zone: 'HAZMAT-D', headcount: 4, planned: 4, avgProductivity: 95, targetProductivity: 100, utilization: 68 },
  { zone: 'HIGH-BAY-E', headcount: 14, planned: 16, avgProductivity: 130, targetProductivity: 140, utilization: 85 },
  { zone: 'MEZZANINE-F', headcount: 10, planned: 12, avgProductivity: 120, targetProductivity: 135, utilization: 78 },
];

export const MOCK_WAVES = [
  { waveId: 'W-001', waveNumber: 1, orderCount: 48, unitCount: 1240, pickMethod: 'BATCH', status: 'COMPLETED', pickProgress: 100, packProgress: 100, carrierCutoff: new Date(Date.now() - 3600000*2), minutesToCutoff: -120 },
  { waveId: 'W-002', waveNumber: 2, orderCount: 62, unitCount: 1680, pickMethod: 'CLUSTER', status: 'IN_PROGRESS', pickProgress: 78, packProgress: 45, carrierCutoff: new Date(Date.now() + 3600000*1.5), minutesToCutoff: 90 },
  { waveId: 'W-003', waveNumber: 3, orderCount: 35, unitCount: 920, pickMethod: 'DISCRETE', status: 'IN_PROGRESS', pickProgress: 42, packProgress: 12, carrierCutoff: new Date(Date.now() + 3600000*0.5), minutesToCutoff: 30 },
  { waveId: 'W-004', waveNumber: 4, orderCount: 55, unitCount: 1450, pickMethod: 'BATCH', status: 'RELEASED', pickProgress: 5, packProgress: 0, carrierCutoff: new Date(Date.now() + 3600000*3), minutesToCutoff: 180 },
  { waveId: 'W-005', waveNumber: 5, orderCount: 40, unitCount: 1100, pickMethod: 'CLUSTER', status: 'PLANNED', pickProgress: 0, packProgress: 0, carrierCutoff: new Date(Date.now() + 3600000*5), minutesToCutoff: 300 },
  { waveId: 'W-006', waveNumber: 6, orderCount: 28, unitCount: 760, pickMethod: 'DISCRETE', status: 'COMPLETED', pickProgress: 100, packProgress: 100, carrierCutoff: new Date(Date.now() - 3600000*5), minutesToCutoff: -300 },
];

export const MOCK_OPTIMIZER = [
  { id: 'WAVE_PLAN', label: 'Wave Optimization', description: 'Rebalance wave assignments to minimize pick travel', icon: Waves,
    results: { improvement: 14.2, summary: 'Consolidating orders by zone reduces average pick travel by 14.2%.',
      metrics: [
        { metric: 'Avg Pick Travel (ft)', current: 2840, optimized: 2437, improvement: '14.2%' },
        { metric: 'Wave Cycle Time (min)', current: 45, optimized: 38, improvement: '15.6%' },
        { metric: 'Picks Per Hour', current: 142, optimized: 163, improvement: '14.8%' },
      ],
      recommendations: [
        { action: 'Zone-cluster Wave 3 orders', detail: 'Move 12 orders from Wave 3 to Wave 2 for zone alignment', impact: 'HIGH', savings: '$2,400/wk' },
        { action: 'Resequence pick paths', detail: 'Serpentine routing in AMBIENT-A saves 380ft per wave', impact: 'MED', savings: '$800/wk' },
      ],
    },
  },
  { id: 'SLOT_OPTIMIZE', label: 'Slot Optimization', description: 'Optimize forward pick locations based on velocity', icon: Warehouse,
    results: { improvement: 11.8, summary: 'Re-slotting top 50 velocity SKUs reduces replenishment cycles by 11.8%.',
      metrics: [
        { metric: 'Replen Cycles/Day', current: 84, optimized: 74, improvement: '11.9%' },
        { metric: 'Avg Pick Distance (ft)', current: 1650, optimized: 1420, improvement: '13.9%' },
        { metric: 'Forward Pick Hits %', current: 72, optimized: 89, improvement: '23.6%' },
      ],
      recommendations: [
        { action: 'Move SK-1001 to A-01-01', detail: 'Highest velocity SKU currently in high-bay; move to golden zone', impact: 'HIGH', savings: '$3,100/wk' },
        { action: 'Consolidate nail care SKUs', detail: 'Place SK-1005, SK-1008 adjacent for multi-line pick efficiency', impact: 'MED', savings: '$600/wk' },
      ],
    },
  },
  { id: 'LABOR_ALLOCATE', label: 'Labor Allocation', description: 'Optimize headcount distribution across zones', icon: HardHat,
    results: { improvement: 9.5, summary: 'Shifting 4 associates from HAZMAT-D to CLIMATE-C improves throughput by 9.5%.',
      metrics: [
        { metric: 'Units/Labor Hour', current: 128, optimized: 140, improvement: '9.4%' },
        { metric: 'Idle Time %', current: 18, optimized: 11, improvement: '38.9%' },
        { metric: 'Zone Balance Score', current: 62, optimized: 81, improvement: '30.6%' },
      ],
      recommendations: [
        { action: 'Reallocate 2 pickers to CLIMATE-C', detail: 'CLIMATE-C is bottleneck at 92% util; HAZMAT-D has surplus', impact: 'HIGH', savings: '$1,800/wk' },
        { action: 'Cross-train MEZZANINE-F crew', detail: 'Enable flex deployment during peak waves', impact: 'MED', savings: '$950/wk' },
      ],
    },
  },
  { id: 'CARRIER_SELECT', label: 'Carrier Selection', description: 'Optimize carrier mix for cost and transit time', icon: Truck,
    results: { improvement: 7.3, summary: 'Shifting 15% of Zone 7-8 volume to regional carrier saves 7.3% on freight.',
      metrics: [
        { metric: 'Avg Freight/Order', current: 18.40, optimized: 17.06, improvement: '7.3%' },
        { metric: 'Avg Transit Days', current: 4.2, optimized: 3.8, improvement: '9.5%' },
        { metric: 'Damage Rate %', current: 4.8, optimized: 3.1, improvement: '35.4%' },
      ],
      recommendations: [
        { action: 'Add regional carrier for West Coast', detail: 'OnTrac or LSO for CA/WA/OR reduces transit 1.2 days', impact: 'HIGH', savings: '$4,200/wk' },
        { action: 'Consolidate LTL shipments Thu-Fri', detail: 'Reduce partial trailer tenders by batching end-of-week', impact: 'LOW', savings: '$320/wk' },
      ],
    },
  },
];

export const MOCK_FORECASTS = [
  { metric: 'Inbound Units', mape: 6.2, data: Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - 7*86400000 + i*86400000);
    const base = 2800 + Math.sin(i/3)*400;
    return { date: d.toISOString().slice(5,10), predicted: Math.round(base), confidenceLow: Math.round(base*0.88), confidenceHigh: Math.round(base*1.12), actual: i < 7 ? Math.round(base + (Math.random()-0.5)*300) : null };
  })},
  { metric: 'Order Volume', mape: 4.8, data: Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - 7*86400000 + i*86400000);
    const base = 320 + Math.sin(i/2.5)*60;
    return { date: d.toISOString().slice(5,10), predicted: Math.round(base), confidenceLow: Math.round(base*0.9), confidenceHigh: Math.round(base*1.1), actual: i < 7 ? Math.round(base + (Math.random()-0.5)*40) : null };
  })},
  { metric: 'Labor Demand', mape: 8.1, data: Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - 7*86400000 + i*86400000);
    const base = 76 + Math.sin(i/4)*12;
    return { date: d.toISOString().slice(5,10), predicted: Math.round(base), confidenceLow: Math.round(base*0.85), confidenceHigh: Math.round(base*1.15), actual: i < 7 ? Math.round(base + (Math.random()-0.5)*10) : null };
  })},
  { metric: 'Throughput', mape: 5.5, data: Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - 7*86400000 + i*86400000);
    const base = 4200 + Math.sin(i/3.5)*600;
    return { date: d.toISOString().slice(5,10), predicted: Math.round(base), confidenceLow: Math.round(base*0.87), confidenceHigh: Math.round(base*1.13), actual: i < 7 ? Math.round(base + (Math.random()-0.5)*500) : null };
  })},
];

export const MOCK_ANOMALIES = [
  { id: 'AN-001', metric: 'Pick Rate', area: 'CLIMATE-C', expected: 130, actual: 88, deviation: 32.3, severity: 'CRITICAL', explanation: 'Replenishment backlog caused empty pick faces in CLIMATE-C zone, dropping picker productivity.' },
  { id: 'AN-002', metric: 'Dock Turnaround', area: 'DOOR-07', expected: 45, actual: 112, deviation: 148.9, severity: 'HIGH', explanation: 'FedEx trailer held 2+ hours past unload due to missing BOL documentation.' },
  { id: 'AN-003', metric: 'Order Cycle Time', area: 'CS - Bulk', expected: 18, actual: 26.4, deviation: 46.7, severity: 'HIGH', explanation: 'Wave release delayed 4 hours due to SAP credit hold on 3 large Costco POs.' },
  { id: 'AN-004', metric: 'Pack Throughput', area: 'MEZZANINE-F', expected: 120, actual: 94, deviation: 21.7, severity: 'MEDIUM', explanation: 'Short-staffed on 2nd shift; 2 of 12 planned packers called out.' },
  { id: 'AN-005', metric: 'Damage Rate', area: 'Zone 8 Lanes', expected: 1.5, actual: 4.8, deviation: 220.0, severity: 'CRITICAL', explanation: 'Spike in crush damage for liquid cosmetics shipped via UPS Ground to CA.' },
  { id: 'AN-006', metric: 'Split Rate', area: 'ECOM - DTC', expected: 2.0, actual: 8.1, deviation: 305.0, severity: 'HIGH', explanation: 'Inventory variance on SK-1003 (5D Mink Lashes) caused short picks across 14 DTC orders.' },
];

export const MOCK_ECONOMICS_WATERFALL = [
  { label: 'Order Value', value: 2840000 },
  { label: 'Freight Cost', value: -184000 },
  { label: 'Accessorials', value: -42000 },
  { label: 'Labor Cost', value: -312000 },
  { label: 'Overhead', value: -156000 },
  { label: 'Chargebacks', value: -89000 },
  { label: 'Contribution', value: 2057000 },
];

export const MOCK_EO_AGING = [
  { bucket: '0-30d', value: 420000, units: 18400 },
  { bucket: '31-60d', value: 185000, units: 7200 },
  { bucket: '61-90d', value: 72000, units: 2800 },
  { bucket: '90+d', value: 34000, units: 1100 },
];

export const MOCK_AI_RESPONSES = {
  pick: 'Current pick rate across all zones is **142 units/hr** (target: 150). CLIMATE-C is the bottleneck at 88 units/hr — a 32% deviation driven by replenishment backlogs. Recommend prioritizing replen cycles for SK-1003 and SK-1006.',
  dock: 'DOOR-07 has the longest dwell time today at 112 min (expected: 45 min). 5 of 12 doors are currently active. DOOR-03 and DOOR-11 are AVAILABLE. Suggest routing next inbound to DOOR-03 for fastest unload.',
  carrier: 'UPS Ground OTD this week: 82.4% (target: 92%). FedEx Ground: 91.1%. R&L LTL: 88.7%. UPS is underperforming on Zone 7-8 lanes — recommend engaging account team on CA/WA service levels.',
  wave: 'Wave 3 is at risk — 30 minutes to carrier cutoff with only 42% pick progress. 35 orders / 920 units remaining. Recommend reallocating 4 pickers from Wave 4 (which has 180 min buffer) to Wave 3 immediately.',
  split: 'Split rate today: 18.2% (target: 0%). Top driver: short picks on SK-1003 (5D Mink Lashes) causing 40% of splits. SAP shows 200 units available but SCALE only has 142 confirmed. Cycle count recommended.',
  default: 'I can help you analyze pick rates, dock status, carrier performance, wave progress, split shipments, and more. Try asking about a specific metric or area of the warehouse.',
};

// ============================================================
// MOCK DATA — EVENT CALENDAR
// ============================================================
export const MOCK_EVENTS = [
  { id: 1, name: 'Spring Beauty BOGO Promotion', type: 'Promotion', startDate: new Date(2026, 3, 1), endDate: new Date(2026, 3, 7), impact: 'High', channels: ['CS - Bulk', 'CS - DSDC', 'ECOM - DTC'], volumeImpact: '+45%', notes: 'Major BOGO across all beauty SKUs. Expect heavy CS and ECOM volume.', contributor: 'GMC', contributedAt: new Date(2026, 2, 25), sourceDoc: 'spring-bogo-brief.pdf' },
  { id: 2, name: 'Ulta Q2 Prepack Build', type: 'Prepack', startDate: new Date(2026, 3, 5), endDate: new Date(2026, 3, 12), impact: 'High', channels: ['CS - Bulk'], volumeImpact: '+60%', notes: 'Ulta Beauty prepacks for Q2 floor reset. 2,400 prepack units.', contributor: 'Mike Ops', contributedAt: new Date(2026, 2, 28), sourceDoc: 'ulta-q2-prepack-spec.xlsx' },
  { id: 3, name: 'Amazon Prime Day Prep', type: 'Pre-sale', startDate: new Date(2026, 3, 10), endDate: new Date(2026, 3, 14), impact: 'High', channels: ['ECOM - AMAZON 1P', 'ECOM - AMAZON 3P'], volumeImpact: '+80%', notes: 'Prime Day prep shipments. Must clear by 4/14.', contributor: 'GMC', contributedAt: new Date(2026, 3, 1), sourceDoc: 'prime-day-forecast.pdf' },
  { id: 4, name: 'Cosmoprof North America', type: 'Show/Expo', startDate: new Date(2026, 3, 15), endDate: new Date(2026, 3, 17), impact: 'Medium', channels: ['BS-IVY', 'BS-RED', 'VIVACE'], volumeImpact: '+20%', notes: 'Trade show samples and booth inventory. Ship by 4/12.', contributor: 'Mike Ops', contributedAt: new Date(2026, 3, 2), sourceDoc: null },
  { id: 5, name: 'Easter Holiday', type: 'Holiday/Closure', startDate: new Date(2026, 3, 5), endDate: new Date(2026, 3, 6), impact: 'Medium', channels: [], volumeImpact: '-100%', notes: 'DC closed Easter Sunday. Saturday skeleton crew.', contributor: 'GMC', contributedAt: new Date(2026, 2, 15), sourceDoc: null },
  { id: 6, name: 'Kiss Lash Launch — Summer Collection', type: 'Product Launch', startDate: new Date(2026, 3, 20), endDate: new Date(2026, 3, 25), impact: 'High', channels: ['CS - Bulk', 'CS - DSDC', 'ECOM - DTC', 'ECOM - AMAZON 1P'], volumeImpact: '+55%', notes: 'New 5D lash collection. Marketing push starts 4/18. Pre-orders shipping 4/20.', contributor: 'GMC', contributedAt: new Date(2026, 3, 5), sourceDoc: 'summer-lash-launch-plan.pdf' },
  { id: 7, name: 'Target Seasonal Endcap', type: 'Seasonal Push', startDate: new Date(2026, 3, 22), endDate: new Date(2026, 4, 5), impact: 'Medium', channels: ['CS - Bulk'], volumeImpact: '+30%', notes: 'Target seasonal endcap refresh. Nail care + lip category.', contributor: 'Mike Ops', contributedAt: new Date(2026, 3, 8), sourceDoc: 'target-endcap-q2.xlsx' },
  { id: 8, name: 'CVS Planogram Reset', type: 'Prepack', startDate: new Date(2026, 3, 28), endDate: new Date(2026, 4, 3), impact: 'Medium', channels: ['CS - DSDC'], volumeImpact: '+25%', notes: 'CVS planogram reset wave 2. Prepack assembly required.', contributor: 'Mike Ops', contributedAt: new Date(2026, 3, 10), sourceDoc: 'cvs-plano-wave2.pdf' },
  { id: 9, name: 'Memorial Day Sale Prep', type: 'Pre-sale', startDate: new Date(2026, 4, 18), endDate: new Date(2026, 4, 22), impact: 'High', channels: ['ECOM - DTC', 'ECOM - AMAZON 1P', 'ECOM - AMAZON 3P'], volumeImpact: '+70%', notes: 'Memorial Day weekend sale. Ship all pre-sale orders by 5/22.', contributor: 'GMC', contributedAt: new Date(2026, 3, 15), sourceDoc: null },
  { id: 10, name: 'Walmart Summer Beauty Reset', type: 'Prepack', startDate: new Date(2026, 4, 1), endDate: new Date(2026, 4, 8), impact: 'High', channels: ['CS - Bulk'], volumeImpact: '+50%', notes: 'Full beauty aisle reset for Walmart. 3,600 prepack units.', contributor: 'Mike Ops', contributedAt: new Date(2026, 3, 18), sourceDoc: 'walmart-summer-reset.xlsx' },
  { id: 11, name: 'Sally Beauty Promo Week', type: 'Promotion', startDate: new Date(2026, 3, 14), endDate: new Date(2026, 3, 20), impact: 'Medium', channels: ['BS-IVY', 'BS-RED'], volumeImpact: '+25%', notes: 'Bi-annual promo. BS channels see uplift.', contributor: 'GMC', contributedAt: new Date(2026, 3, 3), sourceDoc: 'sally-promo-brief.pdf' },
  { id: 12, name: 'IIO Warehouse Maintenance', type: 'Holiday/Closure', startDate: new Date(2026, 3, 19), endDate: new Date(2026, 3, 19), impact: 'Low', channels: ['IIO'], volumeImpact: '-50%', notes: 'Half-day maintenance window. IIO orders delayed.', contributor: 'Mike Ops', contributedAt: new Date(2026, 3, 12), sourceDoc: null },
  { id: 13, name: 'DTC Flash Sale', type: 'Promotion', startDate: new Date(2026, 3, 25), endDate: new Date(2026, 3, 26), impact: 'Medium', channels: ['ECOM - DTC'], volumeImpact: '+40%', notes: '48-hour flash sale on kissusa.com', contributor: 'GMC', contributedAt: new Date(2026, 3, 14), sourceDoc: null },
  { id: 14, name: 'AST Quarterly Review Ship', type: 'Seasonal Push', startDate: new Date(2026, 3, 8), endDate: new Date(2026, 3, 10), impact: 'Low', channels: ['AST'], volumeImpact: '+15%', notes: 'Quarterly review samples for AST accounts.', contributor: 'Mike Ops', contributedAt: new Date(2026, 3, 6), sourceDoc: null },
];

export const MOCK_DOCUMENTS = [
  { id: 1, name: 'spring-bogo-brief.pdf', type: 'pdf', uploadedBy: 'GMC', uploadedAt: new Date(2026, 2, 25), linkedEvent: 'Spring Beauty BOGO Promotion', status: 'Confirmed' },
  { id: 2, name: 'ulta-q2-prepack-spec.xlsx', type: 'xlsx', uploadedBy: 'Mike Ops', uploadedAt: new Date(2026, 2, 28), linkedEvent: 'Ulta Q2 Prepack Build', status: 'Confirmed' },
  { id: 3, name: 'prime-day-forecast.pdf', type: 'pdf', uploadedBy: 'GMC', uploadedAt: new Date(2026, 3, 1), linkedEvent: 'Amazon Prime Day Prep', status: 'Confirmed' },
  { id: 4, name: 'summer-lash-launch-plan.pdf', type: 'pdf', uploadedBy: 'GMC', uploadedAt: new Date(2026, 3, 5), linkedEvent: 'Kiss Lash Launch — Summer Collection', status: 'Confirmed' },
  { id: 5, name: 'target-endcap-q2.xlsx', type: 'xlsx', uploadedBy: 'Mike Ops', uploadedAt: new Date(2026, 3, 8), linkedEvent: 'Target Seasonal Endcap', status: 'Confirmed' },
  { id: 6, name: 'cvs-plano-wave2.pdf', type: 'pdf', uploadedBy: 'Mike Ops', uploadedAt: new Date(2026, 3, 10), linkedEvent: 'CVS Planogram Reset', status: 'Confirmed' },
  { id: 7, name: 'sally-promo-brief.pdf', type: 'pdf', uploadedBy: 'GMC', uploadedAt: new Date(2026, 3, 3), linkedEvent: 'Sally Beauty Promo Week', status: 'Confirmed' },
  { id: 8, name: 'walmart-summer-reset.xlsx', type: 'xlsx', uploadedBy: 'Mike Ops', uploadedAt: new Date(2026, 3, 18), linkedEvent: 'Walmart Summer Beauty Reset', status: 'Confirmed' },
];

export const EVENT_TYPE_COLORS = {
  'Promotion': '#3b82f6',
  'Prepack': '#8b5cf6',
  'Pre-sale': '#f59e0b',
  'Show/Expo': '#10b981',
  'Holiday/Closure': '#E74C6F',
  'Product Launch': '#ec4899',
  'Seasonal Push': '#06b6d4',
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_COLORS);

export const SF_DEFAULTS = {
  account: 'UKDVSEA-NPB82638',
  username: 'CHRIS.LEE@KISSUSA.COM',
  warehouse: 'CORTEX_ANALYST_WH',
  database: 'SCI',
  schema: 'PUBLIC',
  role: '',
};

export const SF_TABLES = [
  { table: 'SCI.PUBLIC.SHIPMENT_HEADER', desc: 'Outbound shipment records', columns: 'ORDER_ID, CUSTOMER, CARRIER, SHIP_DATE, PROMISED_DELIVERY_DATE, TRAILING_STS, ACTUAL_SHIP_DATE_TIME' },
  { table: 'SCI.PUBLIC.SHIPMENT_DETAIL', desc: 'Line item details', columns: 'ORDER_ID, SKU, QTY_ORDERED, QTY_SHIPPED, REQUESTED_DELIVERY_DATE, UNIT_PRICE, SPLIT_FLAG' },
];

export const MOCK_AUDIT_LOG = [
  { message: "Changed Viewer page access: added 'storage'", user: 'GMC', ago: '2 days ago' },
  { message: "Changed Manager permissions: removed 'canResetData'", user: 'GMC', ago: '5 days ago' },
  { message: "Created user 'analyst' with Viewer role", user: 'GMC', ago: '1 week ago' },
];
