// Mock shipment data generator + supporting domain tables. Extracted from
// src/ShippingSLAApp.jsx during PR R1 (constants extraction). Behavior is
// byte-identical to the original inline declarations. generateMockShipments
// fabricates ~320 orders with realistic stage timings, channel weights,
// split-shipment patterns, and SCALE trailing_status distribution — used
// as the mock fallback by useSplitShipments when VITE_DATA_SOURCE is not
// 'live' (or when the live fetch fails).

export const SKUS = [
  { sku: 'SK-1001', name: 'Matte Lipstick - Rose', category: 'Color Cosmetics', fragile: false },
  { sku: 'SK-1002', name: 'Press-On Nails - Glam', category: 'Color Cosmetics', fragile: false },
  { sku: 'SK-1003', name: '5D Mink Lashes', category: 'Color Cosmetics', fragile: true },
  { sku: 'SK-1004', name: 'Hair Gloss Serum', category: 'Haircare', fragile: true },
  { sku: 'SK-1005', name: 'Nail Strengthener', category: 'Nail Care', fragile: false },
  { sku: 'SK-1006', name: 'Lip Plumper Set', category: 'Color Cosmetics', fragile: true },
  { sku: 'SK-1007', name: 'Brow Pencil Duo', category: 'Color Cosmetics', fragile: false },
  { sku: 'SK-1008', name: 'Acetone-Free Remover', category: 'Nail Care', fragile: true },
];

export const CUSTOMER_TIERS = {
  'Ulta Beauty': 'Platinum', 'Target Corp': 'Platinum', 'Amazon FBA': 'Platinum',
  'Walmart US': 'Gold', 'CVS Health': 'Gold', 'Costco Wholesale': 'Gold', 'Sally Beauty': 'Gold',
  'AST Distribution': 'Silver', 'Walgreens': 'Silver', 'Dollar General': 'Silver',
  'HEB Pharmacy': 'Silver', 'Kiss DTC': 'Direct',
};

export const generateMockShipments = () => {
  const states = ['GA','FL','NY','TX','CA','IL','PA','OH','NC','AZ','WA','CO','TN','SC','MA','NJ'];
  const zoneMap = {GA:2,FL:3,NY:4,TX:6,CA:8,IL:5,PA:4,OH:4,NC:3,AZ:7,WA:8,CO:7,TN:3,SC:2,MA:5,NJ:4};
  const regionMap = {GA:'Southeast',FL:'Southeast',NY:'Northeast',TX:'South Central',CA:'West',IL:'Midwest',PA:'Northeast',OH:'Midwest',NC:'Southeast',AZ:'Mountain',WA:'West',CO:'Mountain',TN:'Southeast',SC:'Southeast',MA:'Northeast',NJ:'Northeast'};
  const customers = ['Ulta Beauty','Target Corp','Amazon FBA','Walmart US','CVS Health','Costco Wholesale','Sally Beauty','AST Distribution','Walgreens','Dollar General','HEB Pharmacy','Kiss DTC'];
  const carriers = ['UPS Ground','UPS 2-Day','UPS Next Day','R&L LTL','FedEx Ground'];
  const causes = ['','','','','','','UPS','DC','Missing','Damage','Other'];
  const shifts = ['1st (6a-2p)', '2nd (2p-10p)', '3rd (10p-6a)'];

  // Channel distribution weights — realistic CPG mix
  const channelWeights = [
    { ch: 'CS - Bulk',         w: 15 },
    { ch: 'CS - DSDC',         w: 10 },
    { ch: 'BS-IVY',          w: 8 },
    { ch: 'BS-RED',          w: 8 },
    { ch: 'VIVACE',            w: 6 },
    { ch: 'AST',               w: 7 },
    { ch: 'IIO',               w: 5 },
    { ch: 'KIO',               w: 5 },
    { ch: 'ECOM - AMAZON 1P',  w: 14 },
    { ch: 'ECOM - AMAZON 3P',  w: 10 },
    { ch: 'ECOM - DTC',        w: 12 },
  ];
  const totalW = channelWeights.reduce((s,x) => s+x.w, 0);
  const pickChannel = () => {
    let r = Math.random() * totalW;
    for (const c of channelWeights) {
      r -= c.w;
      if (r <= 0) return c.ch;
    }
    return channelWeights[0].ch;
  };

  const rows = [];
  for (let i = 0; i < 320; i++) {
    const state = states[Math.floor(Math.random()*states.length)];
    const cause = causes[Math.floor(Math.random()*causes.length)];
    const baseDay = Math.floor(Math.random()*17) + 1;
    const hour = 6+Math.floor(Math.random()*12);
    const orderCreate = new Date(2026, 3, baseDay, hour, Math.floor(Math.random()*60));

    let stage1 = 10 + Math.random()*35;
    let stage2 = 30 + Math.random()*150;
    let stage3 = 5 + Math.random()*40;
    let stage4 = cause === 'DC' ? 180+Math.random()*420 : 30+Math.random()*270;
    let stage5 = cause === 'Missing' ? 60+Math.random()*240 : cause === 'DC' ? 90+Math.random()*210 : 30+Math.random()*120;
    let stage6 = 20 + Math.random()*70;
    let stage7 = 30 + Math.random()*150;
    let stage8 = cause === 'UPS' ? 300+Math.random()*600 : 60+Math.random()*440;

    const t1 = new Date(orderCreate.getTime() + stage1*60000);
    const t2 = new Date(t1.getTime() + stage2*60000);
    const t3 = new Date(t2.getTime() + stage3*60000);
    const t4 = new Date(t3.getTime() + stage4*60000);
    const t5 = new Date(t4.getTime() + stage5*60000);
    const t6 = new Date(t5.getTime() + stage6*60000);
    const t7 = new Date(t6.getTime() + stage7*60000);
    const t8 = new Date(t7.getTime() + stage8*60000);

    // 80% of orders have a delivery recorded, rest are still in transit (open)
    const isDelivered = Math.random() > 0.20;
    const delivered = isDelivered ? new Date(t8.getTime() + (1+Math.random()*5)*86400000) : null;

    const promiseShip = new Date(orderCreate.getTime() + 24*3600000);
    const promiseDeliver = new Date(orderCreate.getTime() + (3+Math.floor(Math.random()*5))*86400000);

    // Split shipment: ~18% of orders ship split (customer hard requirement = should be 0%)
    // Higher split rate when cause is Missing (makes sense — short pick triggers split)
    const baseSplitRate = cause === 'Missing' ? 0.55 : cause === 'DC' ? 0.25 : 0.10;
    const isSplit = Math.random() < baseSplitRate;
    const splitCartons = isSplit ? Math.floor(1 + Math.random() * 3) : 1; // number of separate shipments
    const splitGapDays = isSplit ? 1 + Math.floor(Math.random() * 4) : 0;
    // PR5b: 5 Phase B SQL categories with weighted distribution loosely
    // mirroring the live 8-day window (MANIFEST ~77%, UPS_TRAILER ~16%,
    // ZONE ~6%, WAVE rare). Source: plan §Phase B smoke-test findings.
    const splitReasonWeighted = [
      ...Array(77).fill('MANIFEST_LEVEL_SPLIT'),
      ...Array(16).fill('UPS_TRAILER_SPLIT'),
      ...Array( 6).fill('ZONE_LEVEL_SPLIT'),
      ...Array( 1).fill('WAVE_LEVEL_SPLIT'),
    ];
    const splitReason = isSplit ? splitReasonWeighted[Math.floor(Math.random()*splitReasonWeighted.length)] : '';

    // Primary SKU on the order
    const primarySku = SKUS[Math.floor(Math.random()*SKUS.length)];
    const orderValue = Math.round((500+Math.random()*8000)*100)/100;
    const cartons = 1+Math.floor(Math.random()*12);

    const customer = customers[Math.floor(Math.random()*customers.length)];
    const carrier = carriers[Math.floor(Math.random()*carriers.length)];

    // Generate containers for this shipment
    const containers = [];
    const totalContainers = isSplit ? splitCartons + Math.floor(Math.random() * 2) + 1 : cartons;
    for (let c = 0; c < totalContainers; c++) {
      const trackingNum = `1Z${['C5K','1F1','X2R','W8P'][Math.floor(Math.random()*4)]}${String(Math.floor(Math.random()*9999999)).padStart(7,'0')}`;
      const containerShipDate = isSplit && c >= splitCartons
        ? new Date(t8.getTime() + splitGapDays * 86400000)
        : new Date(t8.getTime());
      const expectedDelivery = new Date(promiseDeliver);
      const actualDelivery = isDelivered
        ? new Date(containerShipDate.getTime() + (1 + Math.random() * 3) * 86400000)
        : null;
      const isLateContainer = actualDelivery && actualDelivery > expectedDelivery;
      const deliveredDifferentDay = isSplit && c >= splitCartons; // later containers arrive on a different day

      const statuses = ['LABEL_CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
      const containerStatus = !isDelivered
        ? statuses[Math.min(Math.floor(Math.random() * 4), 3)]
        : 'DELIVERED';

      containers.push({
        containerId: `CTN-${10000 + i}-${String(c+1).padStart(2,'0')}`,
        parentShipmentId: `SH-${10000+i}`,
        containerNum: c + 1,
        totalContainers,
        trackingNumber: trackingNum,
        carrier: carrier,
        status: containerStatus,
        shipDate: containerShipDate,
        expectedDelivery,
        actualDelivery,
        isLate: isLateContainer,
        deliveredDifferentDay,
        weight: (2 + Math.random() * 15).toFixed(1),
        items: Math.floor(1 + Math.random() * 8),
        lastLocation: ['Savannah GA Hub', 'Atlanta GA Sort', 'Memphis TN Hub', 'Louisville KY Hub', 'Local Delivery Facility', 'Out for Delivery'][Math.floor(Math.random()*6)],
        lastScan: new Date(Date.now() - Math.random() * 86400000 * 2),
      });
    }

    // Chargeback $ for delay + split + damage
    let chargeback = 0;
    if (cause === 'UPS' || cause === 'DC') chargeback += Math.round(orderValue * 0.03);
    if (cause === 'Damage') chargeback += Math.round(orderValue * 0.08 + 150);
    if (isSplit) chargeback += 250 + Math.round(Math.random() * 500); // per split penalty

    // Which shift processed it (based on wave release hour)
    const waveHour = t4.getHours();
    const shift = waveHour >= 6 && waveHour < 14 ? shifts[0] : waveHour >= 14 && waveHour < 22 ? shifts[1] : shifts[2];

    // PR Geo-2: trailing_status / trailing_status_date — mock equivalents of
    // the SH-level columns plumbed by PR Geo-1 (sh.TRAILING_STS /
    // sh.TRAILING_STS_DATE). Goal is parity for PR Geo-3's delayed-view
    // classifier, not operational realism — the mock draws cohort
    // membership independently so both branches (in-cohort + below-cohort)
    // exercise the dashboard logic.
    //
    // Distribution:
    //   80% reach trailing >= 700 ("ship-confirm cohort" GeoPage will
    //     operate on in PR Geo-3). Within that cohort:
    //       25% delayed → trailing_status_date = order + 1.5–3 days
    //       75% on time → trailing_status_date = order + 0.3–1 day
    //     SCALE bucket inside the cohort follows mock delivery state:
    //       delivered (!isOpen) → 900 (Closed)
    //       open (isOpen)       → 700 or 800 (Ship/Load Confirm Pending)
    //   20% still < 700 (random pick/pack/stage status, date = null).
    const reachedShipConfirm = Math.random() < 0.80;
    let trailing_status;
    let trailing_status_date;
    if (reachedShipConfirm) {
      trailing_status = !isDelivered
        ? (Math.random() < 0.5 ? 700 : 800)
        : 900;
      const isDelayedTrailing = Math.random() < 0.25;
      const daysOffset = isDelayedTrailing
        ? 1.5 + Math.random() * 1.5
        : 0.3 + Math.random() * 0.7;
      trailing_status_date = new Date(orderCreate.getTime() + daysOffset * 86400000);
    } else {
      const subStatusOptions = [100, 200, 201, 300, 301, 400, 401, 600, 650];
      trailing_status = subStatusOptions[Math.floor(Math.random() * subStatusOptions.length)];
      trailing_status_date = null;
    }

    rows.push({
      id: `SH-${10000+i}`,
      orderId: `SO-${50000+i}`,
      customer,
      tier: CUSTOMER_TIERS[customer] || 'Small',
      channel: pickChannel(),
      carrier,
      state,
      zone: zoneMap[state],
      region: regionMap[state],
      orderCreate,
      confirm: t1, deliveryPost: t2, scaleReceived: t3,
      waveRelease: t4, pickComplete: t5, packComplete: t6,
      shipConfirm: t7, carrierScan: t8, delivered,
      promiseShip, promiseDeliver,
      orderValue,
      cartons,
      cause, onTimeShip: t7 <= promiseShip,
      onTimeDelivery: delivered ? delivered <= promiseDeliver : null,
      isOpen: !isDelivered,
      // PR Geo-2: SH-level trailing status (mock parity with PR Geo-1 live).
      trailing_status,
      trailing_status_date,
      isSplit,
      splitCartons,
      splitGapDays,
      splitReason,
      primarySku: primarySku.sku,
      primarySkuName: primarySku.name,
      skuCategory: primarySku.category,
      skuFragile: primarySku.fragile,
      chargeback,
      shift,
      waveHour,
      containers,
    });
  }
  return rows;
};
