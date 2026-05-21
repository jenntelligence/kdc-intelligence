/**
 * KDC Operations Intelligence — API Server
 *
 * Lightweight Express server that proxies Snowflake queries.
 * Uses Manhattan Active SCALE semantic views from kdc_intelligence_foundation.sql.
 *
 * Data source: SCI.PUBLIC — SCALE replicated to Snowflake
 * Views: V_SHIPMENT, V_SHIPMENT_DETAIL, V_SHIPPING_CONTAINER, V_WORK_INSTRUCTION,
 *        V_QC_EVENT, V_WAVE, V_CARRIER, V_CONSOL_LOCATION
 *        VOP_*, VPROD_*, VEXC_* (operational, productivity, exception layers)
 *
 * Auth: SNOWFLAKE_JWT (RSA key-pair). KDC environment requires an
 * RSA private key — externalbrowser SSO is not supported here.
 * Set SNOWFLAKE_PRIVATE_KEY_PATH (and optional
 * SNOWFLAKE_PRIVATE_KEY_PASSPHRASE) in .env. See
 * docs/references/snowflake-schema.md § Snowflake authentication.
 *
 * Usage:
 *   node server.js          # starts on API_PORT (default 3001)
 *   npm run server           # same, via package.json script
 */
import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import snowflake from 'snowflake-sdk';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.API_PORT || 3001;

// ── Snowflake SDK config ────────────────────────────────────────────────────
snowflake.configure({ logLevel: 'WARN' });

let _connection = null;
let _connecting = null;

function buildConnection(overrides = {}) {
  const account   = overrides.account   || process.env.SNOWFLAKE_ACCOUNT;
  const username  = overrides.username  || process.env.SNOWFLAKE_USERNAME;
  const warehouse = overrides.warehouse || process.env.SNOWFLAKE_WAREHOUSE;
  const database  = overrides.database  || process.env.SNOWFLAKE_DATABASE;
  const schema    = overrides.schema    || process.env.SNOWFLAKE_SCHEMA;
  const role      = overrides.role      || process.env.SNOWFLAKE_ROLE || undefined;

  // RSA key-pair authentication (SNOWFLAKE_JWT)
  // KDC environment requires RSA key — externalbrowser SSO is not
  // supported. The colleague's upstream prototype hardcoded SSO,
  // verified via grep on 2026-04-30 (no RSA code in upstream main).
  const keyPath = overrides.privateKeyPath
    || process.env.SNOWFLAKE_PRIVATE_KEY_PATH;
  const keyPassphrase = overrides.privateKeyPassphrase
    || process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE
    || undefined;

  if (!account || !username) {
    throw new Error('Missing SNOWFLAKE_ACCOUNT or SNOWFLAKE_USERNAME');
  }
  if (!keyPath) {
    throw new Error(
      'Missing SNOWFLAKE_PRIVATE_KEY_PATH — RSA key-pair required for KDC environment'
    );
  }

  // Read PEM file and normalize to PKCS#8 format (snowflake-sdk requirement)
  let privateKey;
  try {
    const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
    const privateKeyObject = crypto.createPrivateKey({
      key: privateKeyPem,
      format: 'pem',
      passphrase: keyPassphrase,
    });
    privateKey = privateKeyObject.export({
      format: 'pem',
      type: 'pkcs8',
    });
  } catch (err) {
    throw new Error(
      `Failed to load Snowflake private key from ${keyPath}: ${err.message}`
    );
  }

  return snowflake.createConnection({
    account,
    username,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey,
    warehouse,
    database,
    schema,
    role,
    application: 'kdc-operations-intelligence',
  });
}

function getConnection() {
  if (_connection?.isUp?.()) return Promise.resolve(_connection);
  if (_connecting) return _connecting;

  _connecting = new Promise((resolve, reject) => {
    const conn = buildConnection();
    conn.connect((err, connected) => {
      _connecting = null;
      if (err) {
        _connection = null;
        reject(new Error(`Snowflake connect failed: ${err.message}`));
      } else {
        _connection = connected;
        resolve(connected);
      }
    });
  });

  return _connecting;
}

function executeQuery(sqlText, binds) {
  return getConnection().then(conn =>
    new Promise((resolve, reject) => {
      conn.execute({
        sqlText,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) reject(new Error(`Query error: ${err.message}`));
          else resolve(rows || []);
        },
      });
    })
  );
}

// ── Common Routes ───────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test Snowflake connection — validation endpoint
app.post('/api/snowflake/test', async (req, res) => {
  const start = Date.now();
  const overrides = req.body || {};

  try {
    const conn = buildConnection(overrides);
    await new Promise((resolve, reject) => {
      conn.connect((err, connected) => {
        if (err) return reject(err);
        connected.execute({
          sqlText: 'SELECT CURRENT_TIMESTAMP() AS TS, CURRENT_WAREHOUSE() AS WH, CURRENT_DATABASE() AS DB, CURRENT_SCHEMA() AS SCH, CURRENT_ROLE() AS ROLE, CURRENT_USER() AS USR',
          complete: (qErr, _stmt, rows) => {
            connected.destroy(() => {});
            if (qErr) return reject(qErr);
            const latency = Date.now() - start;
            const row = rows?.[0] || {};
            res.json({
              success: true,
              latencyMs: latency,
              details: { timestamp: row.TS, warehouse: row.WH, database: row.DB, schema: row.SCH, role: row.ROLE, user: row.USR },
              message: `Connected successfully in ${latency}ms`,
            });
            resolve();
          },
        });
      });
    });
  } catch (err) {
    const latency = Date.now() - start;
    res.json({ success: false, latencyMs: latency, error: err.message, message: `Connection failed: ${err.message}` });
  }
});

// Get current Snowflake config (safe — no passwords)
app.get('/api/snowflake/config', (_req, res) => {
  res.json({
    account: process.env.SNOWFLAKE_ACCOUNT || '',
    username: process.env.SNOWFLAKE_USERNAME || '',
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || '',
    database: process.env.SNOWFLAKE_DATABASE || '',
    schema: process.env.SNOWFLAKE_SCHEMA || '',
    role: process.env.SNOWFLAKE_ROLE || '',
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SCALE RAW TABLE ENDPOINTS
// Queries against SCI.PUBLIC.SHIPMENT_HEADER, SCI.L0.LAUNCH_STATISTICS, etc.
// Semantic views (V_*, VOP_*, VPROD_*, VEXC_*) not yet created in Snowflake.
// ════════════════════════════════════════════════════════════════════════════

// Shared CASE expression for lifecycle stage
const LIFECYCLE_STAGE_EXPR = `CASE
  WHEN TRAILING_STS < 200 THEN '1_Pool'
  WHEN TRAILING_STS < 300 THEN '2_Waved'
  WHEN TRAILING_STS < 400 THEN '3_Allocated'
  WHEN TRAILING_STS < 500 THEN '4_Picking'
  WHEN TRAILING_STS < 600 THEN '5_Packing'
  WHEN TRAILING_STS < 650 THEN '6_Staging'
  WHEN TRAILING_STS < 700 THEN '7_Loading'
  WHEN TRAILING_STS < 800 THEN '8_ShipConfirmPending'
  WHEN TRAILING_STS < 900 THEN '9_Shipped'
  ELSE 'Z_Other'
END`;

// Shared CASE expression for company name
const COMPANY_NAME_EXPR = `CASE USER_DEF1 WHEN '1000' THEN 'Kiss' WHEN '1100' THEN 'Ivy' WHEN '1400' THEN 'Red' WHEN '1900' THEN 'Vivace' ELSE 'Other' END`;

// Helper: stub response for endpoints that need views not yet deployed
function viewNotReady(res, viewName) {
  return res.json({
    success: false,
    error: 'View not available — run kdc_intelligence_foundation.sql to create semantic views',
    requires: viewName,
  });
}

// Sales-org code → channel name mapping.
// Per docs/exec-plans/active/001-snowflake-integration.md §7c #17 closure
// (commit 22e77f4): user master query selects sh.user_def1 as company,
// which is the SAP sales-org code (numeric string), not the channel name.
// PR4a (this commit) maps it to the human-readable channel name at the
// boundary; the raw code is preserved in `channel_code` for ops debugging.
const COMPANY_NAME_MAP = {
  '1100': 'BS-IVY',
  '1400': 'BS-RED',
  '1900': 'VIVACE',
};

/**
 * Convert a Snowflake row (UPPERCASE keys) to FactShipment shape
 * (lowercase keys) used by the React frontend.
 *
 * Initial PR1 version — minimal mapping. PR3 extends this for
 * the full /api/scale/split-shipments response with container-row
 * preservation and 3-type split flags. PR4a adds COMPANY_NAME_MAP
 * channel translation (sales-org code → BS-IVY/BS-RED/VIVACE).
 *
 * @param {Object} row - Raw Snowflake result row (keys are UPPERCASE)
 * @returns {Object|null} FactShipment-shaped object (lowercase keys)
 */
function toFactShape(row) {
  if (!row) return null;
  return {
    // Core identifiers
    id: row.SHIPMENT_ID,
    container_id: row.CONTAINER_ID,

    // Customer info (from KDB.PBI_SF.SAP_CUSTOMER_MASTER cross-DB join)
    customer: row.CUST_NAME,
    state: row.CUST_STATE,
    city: row.CUST_CITY,
    zipcode: row.CUST_ZIPCODE,

    // Channel (PR4a: name via COMPANY_NAME_MAP, raw code preserved)
    channel: COMPANY_NAME_MAP[row.COMPANY] || row.COMPANY,
    channel_code: row.COMPANY,
    sales_org: row.SALES_ORG,

    // Container fields (preserved per PR1 design — preserved across
    // sibling rows via window functions in PR3)
    tracking_number: row.TRACKING_NUMBER,
    container_status: row.CONTAINER_STATUS,
    manifest_id: row.MANIFEST_ID,
    pick_zone: row.PICK_ZONE,

    // Timestamps (already EST-converted in SQL via CONVERT_TIMEZONE)
    container_status_time: row.CONTAINER_STATUS_TIME,
    manifest_close_time: row.MANIFEST_CLOSE_TIME,

    // Order-level aggregations (window functions, populated in PR3)
    container_count: row.CONTAINER_COUNT,
    pick_zone_count: row.PICK_ZONE_COUNT,
    manifest_count: row.MANIFEST_COUNT,

    // 3-type split flags (populated in PR3)
    zone_level_split: row.ZONE_LEVEL_SPLIT_FLAG === 1,
    container_level_split: row.CONTAINER_LEVEL_SPLIT_FLAG === 1,
    manifest_level_split: row.MANIFEST_LEVEL_SPLIT_FLAG === 1,
    primary_split_type: row.PRIMARY_SPLIT_TYPE,

    // ── PR3 (Phase A) — split detection columns ──────────────────
    // Per docs/exec-plans/active/002-split-shipments-live.md PR3.
    // Populated by /api/scale/split-shipments (user master query).

    // SAP order identifiers
    so_num: row.SO_NUM,
    so_created_date: row.SO_CREATED_DATE,
    do_num: row.DO_NUM,
    wave_num: row.WAVE_NUM,

    // SCALE work-instruction-derived (IA_WORK_INSTRUCTION CTE)
    work_type: row.WORK_TYPE,
    zone: row.ZONE,
    picking_completion_time: row.PICKING_COMPLETION_TIME,
    manifest_date_time: row.MANIFEST_DATE_TIME,

    // Container metadata (extends PR1 container fields)
    container_type: row.CONTAINER_TYPE,
    tracking_num: row.TRACKING_NUM,

    // PR Geo-1: shipment-header (DO-level) trailing status — least-advanced
    // container status in this shipment. SCALE schema (server.js line 651):
    //   700 = 'Ship Confirm Pending', 800 = 'Load Confirm Pending',
    //   900 = 'Closed'.
    // trailing_sts_date carries the timestamp when the shipment row reached
    // its current TRAILING_STS (ET-converted in SQL). Used by GeoPage for
    // delayed-shipment detection: trailing_sts_date <= so_created_date +
    // kdcTarget (1 day) → on time.
    // PR Truck-1: leading_sts removed (not in new master query).
    trailing_sts: row.TRAILING_STS,
    trailing_sts_date: row.TRAILING_STS_DATE,

    // PR Overview-A cycle wire: SH.creation_date_time_stamp ET-converted in
    // master query. Marks when the SO entered SCALE / KDC operations — used
    // as the start point for container-level cycle hours
    // (manifest_date_time - order_received_at).
    order_received_at: row.ORDER_RECEIVED_AT,

    // PR Truck-1: carrier identity. 'UPS' or 'TRUCK' (raw SCALE
    // shipment_header.carrier). Used by frontend to filter Split metrics
    // to UPS only (Truck has no split concept).
    //
    // PR Truck-1-fix: pro_num 의 mapping 제거 (final CTE 가 coalesce 의
    // inside 만 사용 — r.tracking_num 의 access 로 양쪽 carrier 의 fact).
    carrier: row.CARRIER,

    // PR Sample-Order-Filter: Sales document type from zsd_c01_billing
    // ("Sample Order" / "Sales Order" / "Rush Order" / etc). User's
    // Snowflake fact: Sample Order = 135,695 of ~10M rows. Drives the
    // App-level sample-order filter (default 'exclude_samples') — sample
    // orders are not part of standard operational fact analysis but can
    // be toggled in for sample-specific tracking.
    sales_doc_type: row.SALES_DOC_TYPE,

    // UPS / Truck tracking (ups_data + truck_data CTEs; coalesced in final)
    // PR Truck-1: delivered_state removed (not in new ups_data CTE).
    origin_date: row.ORIGIN_DATE,
    processing_date: row.PROCESSING_DATE,
    delivered_date: row.DELIVERED_DATE,

    // DO-level aggregations (do_level CTE)
    tracking_cnt: row.TRACKING_CNT,
    container_cnt: row.CONTAINER_CNT,
    manifest_cnt: row.MANIFEST_CNT,
    delivered_date_cnt: row.DELIVERED_DATE_CNT,
    has_null_tracking: row.HAS_NULL_TRACKING === 1,
    has_null_delivered_date: row.HAS_NULL_DELIVERED_DATE === 1,

    // Split classification (classified CTE + outer SELECT)
    split_status: row.SPLIT_STATUS,
    is_split_shipment: row.IS_SPLIT_SHIPMENT === 'Y',

    // ── PR5a (Phase B) — root cause classification columns ──────
    // Per docs/exec-plans/active/002-split-shipments-live.md Phase B.
    // Populated by /api/scale/split-shipments after master query was
    // extended to 7 CTEs (split_root_cause CTE + launch_statistics
    // and zsd_c01_billing joins).

    // Wave-launch context (LEFT JOIN sci.l0.launch_statistics)
    wave_launch_date: row.WAVE_LAUNCH_DATE,
    launch_flow: row.LAUNCH_FLOW,
    internal_launch_num: row.INTERNAL_LAUNCH_NUM,

    // Billing aggregation (JOIN kdb.pbi_sf.zsd_c01_billing in base CTE)
    billing_date: row.BILLING_DATE,
    invoice_amount: row.INVOICE_AMOUNT,

    // Root cause (split_root_cause CTE; only non-null where split_status = 'SPLIT').
    // One of: WAVE_LEVEL_SPLIT, MANIFEST_LEVEL_SPLIT, ZONE_LEVEL_SPLIT,
    // UPS_TRAILER_SPLIT, UNCLASSIFIED_SPLIT.
    split_root_cause: row.SPLIT_ROOT_CAUSE,
  };
}

// ── Operational State ───────────────────────────────────────────────────────

// Lifecycle heatmap — shipment count by stage × company
app.get('/api/scale/lifecycle-heatmap', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT
        ${COMPANY_NAME_EXPR} AS COMPANY_NAME,
        USER_DEF1 AS SALES_ORG,
        ${LIFECYCLE_STAGE_EXPR} AS LIFECYCLE_STAGE,
        COUNT(DISTINCT SHIPMENT_ID) AS SHIPMENT_COUNT,
        SUM(CASE WHEN DATEDIFF('HOUR', DATE_TIME_STAMP, CURRENT_TIMESTAMP()) > 24 THEN 1 ELSE 0 END) AS STUCK_COUNT
      FROM SCI.PUBLIC.SHIPMENT_HEADER
      WHERE WAREHOUSE = 'KDCGA1' AND IN_DELETION = 'N' AND TRAILING_STS < 900
      GROUP BY COMPANY_NAME, SALES_ORG, LIFECYCLE_STAGE
      ORDER BY COMPANY_NAME, LIFECYCLE_STAGE
    `);
    res.json({ success: true, data: rows, source: 'snowflake', table: 'SCI.PUBLIC.SHIPMENT_HEADER' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Active waves with progress (last 2 days)
app.get('/api/scale/active-waves', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT INTERNAL_LAUNCH_NUM AS WAVE_NUM, LAUNCH_NAME, LAUNCH_FLOW,
        LAUNCH_DATE_TIME_STARTED AS WAVE_CREATED, TOTAL_SHIPMENTS, TOTAL_QTY, TOTAL_LINES,
        CLOSED, RELEASED
      FROM SCI.L0.LAUNCH_STATISTICS
      WHERE WAREHOUSE = 'KDCGA1'
        AND LAUNCH_DATE_TIME_STARTED >= DATEADD('DAY', -2, CURRENT_DATE())
      ORDER BY LAUNCH_DATE_TIME_STARTED DESC
      LIMIT 50
    `);
    res.json({ success: true, data: rows, source: 'snowflake', table: 'SCI.L0.LAUNCH_STATISTICS' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Consolidation dock occupancy — requires semantic view
app.get('/api/scale/consol-usage', (_req, res) => viewNotReady(res, 'VOP_CONSOL_LOCATION_USAGE'));

// Open carrier manifests — requires semantic view
app.get('/api/scale/open-manifests', (_req, res) => viewNotReady(res, 'VOP_OPEN_MANIFESTS'));

// ── Productivity ────────────────────────────────────────────────────────────

// QC / pack station productivity — requires semantic view
app.get('/api/scale/qc-by-station', (_req, res) => viewNotReady(res, 'VPROD_QC_BY_STATION'));

// Per-user QC throughput — requires semantic view
app.get('/api/scale/qc-by-user', (_req, res) => viewNotReady(res, 'VPROD_QC_BY_USER'));

// Pick cycle time by work type — requires semantic view
app.get('/api/scale/pick-cycle', (_req, res) => viewNotReady(res, 'VPROD_PICK_CYCLE'));

// On-Time Delivery by carrier × sales org
app.get('/api/scale/otd', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT
        ACTUAL_SHIP_DATE_TIME::DATE AS SHIP_DATE,
        CARRIER, CARRIER_TYPE,
        ${COMPANY_NAME_EXPR} AS COMPANY_NAME,
        USER_DEF1 AS SALES_ORG,
        COUNT(DISTINCT SHIPMENT_ID) AS SHIPMENTS,
        SUM(CASE WHEN ACTUAL_SHIP_DATE_TIME::DATE <= REQUESTED_DELIVERY_DATE::DATE THEN 1 ELSE 0 END) AS ON_TIME,
        ROUND(100.0 * SUM(CASE WHEN ACTUAL_SHIP_DATE_TIME::DATE <= REQUESTED_DELIVERY_DATE::DATE THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT SHIPMENT_ID), 0), 1) AS OTD_PCT
      FROM SCI.PUBLIC.SHIPMENT_HEADER
      WHERE WAREHOUSE = 'KDCGA1' AND IN_DELETION = 'N' AND TRAILING_STS >= 800
        AND ACTUAL_SHIP_DATE_TIME IS NOT NULL AND REQUESTED_DELIVERY_DATE IS NOT NULL
        AND ACTUAL_SHIP_DATE_TIME::DATE >= DATEADD('DAY', -30, CURRENT_DATE())
      GROUP BY SHIP_DATE, CARRIER, CARRIER_TYPE, COMPANY_NAME, SALES_ORG
      ORDER BY SHIP_DATE DESC
    `);
    res.json({ success: true, data: rows, source: 'snowflake', table: 'SCI.PUBLIC.SHIPMENT_HEADER' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Daily shipped volume by company
app.get('/api/scale/daily-volume', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT
        ACTUAL_SHIP_DATE_TIME::DATE AS SHIP_DATE,
        ${COMPANY_NAME_EXPR} AS COMPANY_NAME,
        USER_DEF1 AS SALES_ORG,
        COUNT(DISTINCT SHIPMENT_ID) AS SHIPMENTS
      FROM SCI.PUBLIC.SHIPMENT_HEADER
      WHERE WAREHOUSE = 'KDCGA1' AND IN_DELETION = 'N' AND TRAILING_STS >= 800
        AND ACTUAL_SHIP_DATE_TIME::DATE >= DATEADD('DAY', -90, CURRENT_DATE())
      GROUP BY SHIP_DATE, COMPANY_NAME, SALES_ORG
      ORDER BY SHIP_DATE DESC
    `);
    res.json({ success: true, data: rows, source: 'snowflake', table: 'SCI.PUBLIC.SHIPMENT_HEADER' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Autostore throughput — requires semantic view
app.get('/api/scale/autostore', (_req, res) => viewNotReady(res, 'VPROD_AUTOSTORE_THROUGHPUT'));

// ── Exceptions / Alerts ─────────────────────────────────────────────────────

// Stuck shipments (not advancing past SLA)
app.get('/api/scale/stuck-shipments', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT
        SHIPMENT_ID,
        ${COMPANY_NAME_EXPR} AS COMPANY_NAME,
        USER_DEF1 AS SALES_ORG,
        CARRIER,
        ${LIFECYCLE_STAGE_EXPR} AS LIFECYCLE_STAGE,
        TRAILING_STS,
        DATEDIFF('HOUR', DATE_TIME_STAMP, CURRENT_TIMESTAMP()) AS HOURS_SINCE_LAST_CHANGE,
        SCHEDULED_SHIP_DATE,
        CASE
          WHEN SCHEDULED_SHIP_DATE < CURRENT_DATE() THEN 'SLA_BREACHED'
          WHEN SCHEDULED_SHIP_DATE = CURRENT_DATE() THEN 'SLA_AT_RISK'
          ELSE 'SLOW'
        END AS SEVERITY
      FROM SCI.PUBLIC.SHIPMENT_HEADER
      WHERE WAREHOUSE = 'KDCGA1' AND IN_DELETION = 'N'
        AND TRAILING_STS BETWEEN 100 AND 899
        AND DATEDIFF('HOUR', DATE_TIME_STAMP, CURRENT_TIMESTAMP()) > 24
      ORDER BY HOURS_SINCE_LAST_CHANGE DESC
      LIMIT 200
    `);
    res.json({ success: true, data: rows, source: 'snowflake', table: 'SCI.PUBLIC.SHIPMENT_HEADER' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Short picks / split shipments — requires semantic view
app.get('/api/scale/short-picks', (_req, res) => viewNotReady(res, 'VEXC_SHORT_PICKS'));

// QC failures — requires PROCESS_HISTORY semantic view
app.get('/api/scale/qc-failures', (_req, res) => viewNotReady(res, 'VEXC_QC_FAILURES'));

// R&L missing PRO numbers — requires semantic view
app.get('/api/scale/rl-missing-pro', (_req, res) => viewNotReady(res, 'VEXC_RL_MISSING_PRO'));

// IB reconciliation — requires semantic view
app.get('/api/scale/ib-reconciliation', (_req, res) => viewNotReady(res, 'VEXC_IB_RECONCILIATION'));

// QC fail rate alerts — requires semantic view
app.get('/api/scale/qc-fail-alerts', (_req, res) => viewNotReady(res, 'VEXC_QC_FAIL_RATE_ALERT'));

// ── Direct Queries ──────────────────────────────────────────────────────────

// Shipment list with lifecycle stage (paginated)
app.get('/api/scale/shipments', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const stage = req.query.stage;   // optional filter: '4_Picking', '5_Packing', etc.
  const company = req.query.company; // optional: 'Kiss', 'Ivy', 'Vivace'

  // Build WHERE clause — base filters
  const conditions = [`WAREHOUSE = 'KDCGA1'`, `IN_DELETION = 'N'`];

  // Stage and company filters are applied via HAVING on computed cols; use subquery
  let havingClauses = [];
  if (stage)   havingClauses.push(`LIFECYCLE_STAGE = '${stage.replace(/'/g, "''")}'`);
  if (company) havingClauses.push(`COMPANY_NAME = '${company.replace(/'/g, "''")}'`);

  const havingSql = havingClauses.length ? `HAVING ${havingClauses.join(' AND ')}` : '';

  try {
    const rows = await executeQuery(`
      SELECT * FROM (
        SELECT
          SHIPMENT_ID,
          USER_DEF1 AS SALES_ORG,
          ${COMPANY_NAME_EXPR} AS COMPANY_NAME,
          CARRIER, CARRIER_TYPE,
          TRAILING_STS,
          ${LIFECYCLE_STAGE_EXPR} AS LIFECYCLE_STAGE,
          SCHEDULED_SHIP_DATE,
          ACTUAL_SHIP_DATE_TIME AS SHIP_DATE,
          CUSTOMER_NAME, SHIP_TO_STATE, SHIP_TO_CITY,
          DATEDIFF('HOUR', DATE_TIME_STAMP, CURRENT_TIMESTAMP()) AS HOURS_SINCE_LAST_CHANGE,
          CREATION_DATE_TIME_STAMP AS CREATE_DATE_TIME
        FROM SCI.PUBLIC.SHIPMENT_HEADER
        WHERE ${conditions.join(' AND ')}
      ) sub
      ${havingSql}
      ORDER BY CREATE_DATE_TIME DESC
      LIMIT ${limit}
    `);
    res.json({ success: true, data: rows, count: rows.length, source: 'snowflake', table: 'SCI.PUBLIC.SHIPMENT_HEADER' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Wave list (last 7 days via LAUNCH_STATISTICS)
app.get('/api/scale/waves', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT
        INTERNAL_LAUNCH_NUM AS WAVE_NUM,
        LAUNCH_NAME,
        LAUNCH_FLOW,
        LAUNCH_DATE_TIME_STARTED AS WAVE_CREATED,
        TOTAL_SHIPMENTS, TOTAL_QTY, TOTAL_LINES,
        CLOSED, RELEASED
      FROM SCI.L0.LAUNCH_STATISTICS
      WHERE WAREHOUSE = 'KDCGA1'
        AND LAUNCH_DATE_TIME_STARTED >= DATEADD('DAY', -7, CURRENT_DATE())
      ORDER BY LAUNCH_DATE_TIME_STARTED DESC
    `);
    res.json({ success: true, data: rows, source: 'snowflake', table: 'SCI.L0.LAUNCH_STATISTICS' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// KISS BI Config (thresholds) — table not yet created, return mock defaults
app.get('/api/scale/config', (_req, res) => {
  res.json({
    success: true,
    data: [
      { CONFIG_KEY: 'STUCK_SHIPMENT_HOURS',  CONFIG_VALUE: '24',  DATA_TYPE: 'INT',    DESCRIPTION: 'Hours after which a shipment not advancing is flagged stuck' },
      { CONFIG_KEY: 'PICK_SLA_MINUTES',       CONFIG_VALUE: '60',  DATA_TYPE: 'INT',    DESCRIPTION: 'Work instruction SLA from create to confirm (minutes)' },
      { CONFIG_KEY: 'OTD_TARGET_PCT',          CONFIG_VALUE: '95',  DATA_TYPE: 'FLOAT',  DESCRIPTION: 'On-time delivery target percentage' },
      { CONFIG_KEY: 'BACKORDER_ALERT_DAYS',   CONFIG_VALUE: '1',   DATA_TYPE: 'INT',    DESCRIPTION: 'Days past requested delivery before flagging as backorder alert' },
      { CONFIG_KEY: 'WAVE_LOOKBACK_DAYS',     CONFIG_VALUE: '7',   DATA_TYPE: 'INT',    DESCRIPTION: 'Default lookback window for wave history display' },
      { CONFIG_KEY: 'DAILY_VOLUME_LOOKBACK',  CONFIG_VALUE: '90',  DATA_TYPE: 'INT',    DESCRIPTION: 'Days of shipped volume history to display' },
    ],
    source: 'config-defaults',
  });
});

// Update KISS BI Config threshold — no-op until table is created
app.put('/api/scale/config/:key', (_req, res) => {
  res.json({ success: false, error: 'KISS_BI_CONFIG table not yet created — run kdc_intelligence_foundation.sql first', requires: 'KISS_BI_CONFIG' });
});

// ════════════════════════════════════════════════════════════════════════════
// VERIFIED QUERIES (from Cortex Analyst — verified by Kathleen Li)
// These use raw SCI.L0 tables directly for specific analytics
// ════════════════════════════════════════════════════════════════════════════

// In-process workload by area (PP/PM/PS) and customer
app.get('/api/scale/workload-in-process', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      WITH status_map (status_code, status_description) AS (
        SELECT column1, column2 FROM VALUES
          (100, 'In Pool'), (200, 'Wave Pending'), (201, 'In Wave'),
          (300, 'Picking Pending'), (301, 'In Picking'),
          (400, 'Packing Pending'), (401, 'In Packing'),
          (600, 'Staging Pending'), (650, 'Loading Pending'),
          (700, 'Ship Confirm Pending'), (800, 'Load Confirm Pending'), (900, 'Closed')
      ),
      t1 AS (
        SELECT
          sh.customer, sh.customer_name, sc.item,
          CONVERT_TIMEZONE('UTC', 'America/New_York', sc.date_time_stamp) AS time_est,
          sh.user_def1 AS company_key, sh.user_def6 AS dsdc_type,
          sc.quantity AS qty, sc.quantity_um, sc.original_pick_loc,
          CASE
            WHEN LEFT(sc.original_pick_loc,2) = 'AS' THEN 'PP'
            WHEN LEFT(sc.original_pick_loc,2) IN ('PL','PR','PS') THEN 'PM'
            WHEN sc.status IN ('400','401') THEN 'PS'
            ELSE 'Not in process'
          END AS AREA,
          um.conversion_qty,
          sc.quantity / NULLIF(um.conversion_qty, 0) AS quantity_ip,
          sc.status
        FROM SCI.L0.SHIPMENT_HEADER sh
        LEFT JOIN SCI.L0.SHIPPING_CONTAINER sc ON sh.internal_shipment_num = sc.internal_shipment_num
        LEFT JOIN SCI.L0.ITEM_UNIT_OF_MEASURE um ON sc.item = um.item AND sc.company = um.company AND um.quantity_um = 'IP'
        WHERE sh.warehouse = 'KDCGA1'
          AND YEAR(TO_DATE(CONVERT_TIMEZONE('UTC','America/New_York', sc.date_time_stamp))) = YEAR(CURRENT_DATE())
          AND sc.status NOT IN ('100','200','201','600','650','700','800','900')
      )
      SELECT t1.status, status_map.status_description, t1.customer_name, t1.customer, t1.AREA,
        SUM(t1.qty) AS qty_ea, SUM(t1.quantity_ip) AS qty_ip
      FROM t1
      LEFT JOIN status_map ON t1.status = status_map.status_code
      GROUP BY t1.status, t1.customer, t1.customer_name, status_map.status_description, t1.area
      ORDER BY t1.customer_name, t1.status
    `);
    res.json({ success: true, data: rows, count: rows.length, source: 'snowflake', query: 'workload-in-process' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Past workload — Pick Module (PM) — last 30 days by shift
app.get('/api/scale/workload-pm', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT
        th.warehouse, th.COMPANY, th.work_type,
        CASE
          WHEN EXTRACT(HOUR FROM CONVERT_TIMEZONE('UTC','America/New_York', th.ACTIVITY_DATE_TIME)) >= 5
          THEN TO_DATE(CONVERT_TIMEZONE('UTC','America/New_York', th.ACTIVITY_DATE_TIME))
          ELSE TO_DATE(DATEADD(DAY, -1, CONVERT_TIMEZONE('UTC','America/New_York', th.ACTIVITY_DATE_TIME)))
        END AS ACTIVITY_DATE,
        CASE
          WHEN HOUR(CONVERT_TIMEZONE('UTC','America/New_York',th.ACTIVITY_DATE_TIME)) BETWEEN 5 AND 15 THEN 'Shift 1'
          WHEN HOUR(CONVERT_TIMEZONE('UTC','America/New_York',th.ACTIVITY_DATE_TIME)) BETWEEN 16 AND 23
            OR HOUR(CONVERT_TIMEZONE('UTC','America/New_York',th.ACTIVITY_DATE_TIME)) < 3 THEN 'Shift 2'
          ELSE 'Other'
        END AS shift,
        th.ITEM, th.quantity AS QTY_EA,
        FLOOR(th.quantity / NULLIF(im.conversion_qty, 0)) AS ip_qty,
        th.location
      FROM SCI.L0.TRANSACTION_HISTORY th
      JOIN SCI.L0.ITEM_UNIT_OF_MEASURE im
        ON th.ITEM = im.ITEM AND th.COMPANY = im.COMPANY AND im.QUANTITY_UM = 'IP'
      WHERE th.TRANSACTION_TYPE IN ('120','130')
        AND (th.WORK_TYPE = 'Pick Mod Pick' OR (th.WORK_TYPE = 'AS & PM Pick' AND (th.location LIKE 'PL%' OR th.location LIKE 'PR%' OR th.location LIKE 'PS%')))
        AND CONVERT_TIMEZONE('UTC','America/New_York', th.ACTIVITY_DATE_TIME) BETWEEN
          DATEADD(HOUR, 6, DATE_TRUNC('DAY', DATEADD('DAY', -30, CURRENT_DATE())))
          AND DATEADD(HOUR, 2, DATE_TRUNC('DAY', CURRENT_DATE()))
        AND th.direction = 'From'
    `);
    res.json({ success: true, data: rows, count: rows.length, source: 'snowflake', query: 'workload-pm' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Past workload — Pack Station (PS) — last 30 days by shift
app.get('/api/scale/workload-ps', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT
        sc2.warehouse, sc2.company,
        SUBSTRING(ph.identifier1, 16, 20) AS container_id,
        sc2.parent_container_id, sc2.item, im.conversion_qty,
        FLOOR(SUM(sc2.quantity) / NULLIF(im.conversion_qty, 0)) AS ip_qty,
        CONVERT_TIMEZONE('UTC','America/New_York', ph.activity_date_time) AS converted_time,
        CASE
          WHEN EXTRACT(HOUR FROM CONVERT_TIMEZONE('UTC','America/New_York', ph.activity_date_time)) >= 5
          THEN TO_DATE(CONVERT_TIMEZONE('UTC','America/New_York', ph.activity_date_time))
          ELSE TO_DATE(DATEADD(DAY, -1, CONVERT_TIMEZONE('UTC','America/New_York', ph.activity_date_time)))
        END AS activity_date,
        CASE
          WHEN HOUR(CONVERT_TIMEZONE('UTC','America/New_York',ph.activity_date_time)) BETWEEN 5 AND 15 THEN 'Shift 1'
          WHEN HOUR(CONVERT_TIMEZONE('UTC','America/New_York',ph.activity_date_time)) BETWEEN 16 AND 23
            OR HOUR(CONVERT_TIMEZONE('UTC','America/New_York',ph.activity_date_time)) < 3 THEN 'Shift 2'
          ELSE 'Other'
        END AS shift
      FROM SCI.L0.PROCESS_HISTORY ph
      JOIN SCI.L0.SHIPPING_CONTAINER sc1 ON sc1.container_id = SUBSTRING(ph.identifier1, 16, 20)
      JOIN SCI.L0.SHIPPING_CONTAINER sc2 ON sc1.container_id = sc2.parent_container_id
      LEFT JOIN SCI.L0.ITEM_UNIT_OF_MEASURE im ON sc2.item = im.item AND sc2.company = im.company AND im.quantity_um = 'IP'
      WHERE ph.process = '810'
        AND CONVERT_TIMEZONE('UTC','America/New_York', ph.activity_date_time) BETWEEN
          DATEADD(HOUR, 6, DATE_TRUNC('DAY', DATEADD('DAY', -30, CURRENT_DATE())))
          AND DATEADD(HOUR, 2, DATE_TRUNC('DAY', CURRENT_DATE()))
        AND sc2.status_flow_name IN ('LTL','Parcel')
        AND (SUBSTR(ph.identifier1, 43, 20) LIKE 'LG%' OR SUBSTR(ph.identifier1, 43, 20) LIKE 'SM%')
      GROUP BY ph.activity_date_time, sc2.warehouse, sc2.company, ph.identifier1,
        sc2.parent_container_id, sc2.item, im.conversion_qty, sc2.quantity
    `);
    res.json({ success: true, data: rows, count: rows.length, source: 'snowflake', query: 'workload-ps' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Order processing time (closed orders only)
app.get('/api/scale/order-processing-time', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      WITH only_closed_orders AS (
        SELECT erp_order FROM SCI.L0.WORK_INSTRUCTION
        GROUP BY ERP_ORDER HAVING COUNT_IF(CONDITION != 'Closed') = 0
      ),
      processing_time AS (
        SELECT ERP_ORDER,
          MIN(START_DATE_TIME) AS min_start_time,
          MAX(END_DATE_TIME) AS max_end_time
        FROM SCI.L0.WORK_INSTRUCTION
        WHERE ERP_ORDER IN (SELECT ERP_ORDER FROM only_closed_orders)
          AND instruction_type = 'Detail'
        GROUP BY ERP_ORDER
      )
      SELECT pt.ERP_ORDER, sh.user_def4, sh.shipment_id,
        pt.min_start_time, pt.max_end_time,
        TIMEDIFF('MINUTE', pt.min_start_time, pt.max_end_time) AS total_minutes
      FROM processing_time pt
      LEFT JOIN SCI.L0.SHIPMENT_HEADER sh ON pt.ERP_ORDER = sh.erp_order
      ORDER BY pt.max_end_time DESC
      LIMIT 200
    `);
    res.json({ success: true, data: rows, count: rows.length, source: 'snowflake', query: 'order-processing-time' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pick frequency / slotting analysis
app.get('/api/scale/pick-frequency', async (_req, res) => {
  try {
    const rows = await executeQuery(`
      SELECT COMPANY, ITEM, LOCATION, WORK_ZONE, PICK_FREQ, ORDER_VOLUME,
        PICK_COUNT, QTY_EA, QTY_IP, LAST_PICK_DATE
      FROM SCI.PUBLIC.VW_PICK_FREQUENCY
      ORDER BY PICK_COUNT DESC
      LIMIT 500
    `);
    res.json({ success: true, data: rows, count: rows.length, source: 'snowflake', query: 'pick-frequency' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Exploration endpoints (sub-plan 002 PR1) ────────────────────────────────
// Read-only DESCRIBE-style endpoints to discover column structure of tables
// referenced by the upcoming /api/scale/split-shipments endpoint (PR3).
// Resolves §7c #17 (IA_WORK_INSTRUCTION semantics) and §7c #18 (drill-down
// column names). Per AGENTS.md DB-safety rule: SELECT only.

/**
 * Exploration endpoint — discover IA_WORK_INSTRUCTION column structure.
 * Resolves §7c #17 (ia_work_instruction semantics).
 * Read-only.
 */
app.get('/api/scale/explore-ia-wi', async (_req, res) => {
  try {
    const columns = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE, COMMENT
      FROM SCI.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'L0'
        AND TABLE_NAME = 'IA_WORK_INSTRUCTION'
      ORDER BY ORDINAL_POSITION
    `);

    const sampleRows = await executeQuery(`
      SELECT *
      FROM SCI.L0.IA_WORK_INSTRUCTION
      WHERE company IN ('Ivy', 'Red', 'Vivace')
        AND instruction_type = 'header'
      LIMIT 5
    `);

    res.json({
      success: true,
      columns,
      sampleRows,
      source: 'snowflake',
      table: 'SCI.L0.IA_WORK_INSTRUCTION',
    });
  } catch (err) {
    console.error('explore-ia-wi failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Exploration endpoint — discover SHIPPING_CONTAINER column structure
 * for drill-down columns (weight, dates, etc.).
 * Resolves §7c #18 (drill-down columns).
 * Read-only.
 */
app.get('/api/scale/explore-shipping-container', async (_req, res) => {
  try {
    const columns = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE, COMMENT
      FROM SCI.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'L0'
        AND TABLE_NAME = 'SHIPPING_CONTAINER'
      ORDER BY ORDINAL_POSITION
    `);

    // Sample row with all columns visible to discover values
    const sampleRows = await executeQuery(`
      SELECT *
      FROM SCI.L0.SHIPPING_CONTAINER
      WHERE company IN ('Ivy', 'Red', 'Vivace')
      LIMIT 3
    `);

    res.json({
      success: true,
      columns,
      sampleRows,
      source: 'snowflake',
      table: 'SCI.L0.SHIPPING_CONTAINER',
    });
  } catch (err) {
    console.error('explore-shipping-container failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Exploration endpoint — investigate PROCESS_HISTORY for
 * last-scan-location derivation (drill-down panel).
 * Resolves §7c #18 (location strings).
 * Read-only.
 */
app.get('/api/scale/explore-process-history', async (_req, res) => {
  try {
    const columns = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE, COMMENT
      FROM SCI.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'L0'
        AND TABLE_NAME = 'PROCESS_HISTORY'
      ORDER BY ORDINAL_POSITION
    `);

    // Sample recent events to see what location strings look like
    const sampleRows = await executeQuery(`
      SELECT *
      FROM SCI.L0.PROCESS_HISTORY
      WHERE warehouse = 'KDCGA1'
      ORDER BY date_time_stamp DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      columns,
      sampleRows,
      source: 'snowflake',
      table: 'SCI.L0.PROCESS_HISTORY',
    });
  } catch (err) {
    console.error('explore-process-history failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Exploration endpoint — discover UPS_TRACKING column structure.
 * User's master query uses sci.l0.ups_tracking for delivery dates,
 * status events, and origin/processing/delivery scan info.
 *
 * Investigates whether last-scan-location ('Local Delivery Facility',
 * etc.) and other drill-down fields exist on this table — directly
 * resolves the §7c #18 "last-scan-location source" remaining
 * uncertainty captured in the 2026-04-30 plan correction commit
 * (cbfe07b).
 *
 * Read-only.
 */
app.get('/api/scale/explore-ups-tracking', async (_req, res) => {
  try {
    const columns = await executeQuery(`
      SELECT COLUMN_NAME, DATA_TYPE, COMMENT
      FROM SCI.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'L0'
        AND TABLE_NAME = 'UPS_TRACKING'
      ORDER BY ORDINAL_POSITION
    `);

    // Sample recent events to see status_type values + location fields
    const sampleRows = await executeQuery(`
      SELECT *
      FROM SCI.L0.UPS_TRACKING
      ORDER BY datetime DESC
      LIMIT 10
    `);

    // Distinct status_type values — small enum set expected
    const statusTypes = await executeQuery(`
      SELECT status_type, COUNT(*) AS cnt
      FROM SCI.L0.UPS_TRACKING
      GROUP BY status_type
      ORDER BY cnt DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      columns,
      sampleRows,
      statusTypes,
      source: 'snowflake',
      table: 'SCI.L0.UPS_TRACKING',
    });
  } catch (err) {
    console.error('explore-ups-tracking failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Phase 1 Live Endpoints (sub-plan 002 → 004) ─────────────────────────────
// Per docs/exec-plans/active/001-snowflake-integration.md §6b.
// Each endpoint replaces mock data on a Phase 1 dashboard page.

// ── Split Shipments (Phase 1 — page 1, Phase A: detection) ──
// Per docs/exec-plans/active/001-snowflake-integration.md §6b
// and docs/exec-plans/active/002-split-shipments-live.md PR3.
// SQL is the user-verified master query — DO NOT edit in code.
// If SQL needs to change, update the plan first as a separate
// commit, then re-paste here. (Trust hierarchy: user fact >
// user master query > plan draft > endpoint code.)
// Channel scope: BS-IVY/BS-RED/VIVACE via UPS only.
const SPLIT_SHIPMENTS_SQL = `
with base as (
    select
        sh.user_def1 as company,
        sh.user_def4 as so_num,
        sh.launch_num as wave_num,
        sh.shipment_id as do_num,
        li."Means of Transport ID" as pro_num,
        sh.internal_shipment_num,
        sh.launch_num,
        cm.shiptoparty_key,
        cm.name as cust_name,
        cm.region as cust_state,
        cm.city as cust_city,
        cm.postalcode as cust_zipcode,
        sc.container_id,
        sc.container_type,
        sc.container_class,
        sh.trailing_sts,
        convert_timezone('UTC', 'America/New_York', sh.trailing_sts_date) as trailing_sts_date,
        sc.status as container_status,
        sc.tracking_number,
        sc.manifest_id,
        cast(concat(left(SALESDOCDATE, 4) , '-' , SUBSTRING(SALESDOCDATE, 5, 2) ,'-' , right(SALESDOCDATE, 2)) as date) so_created_date,
        convert_timezone('UTC', 'America/New_York', sc.date_time_stamp) as container_status_time,
        convert_timezone('UTC', 'America/New_York', sc.manifest_close_date_time) as manifest_close_time,
        b."Calendar_day" as billing_date,
        b."Sales_doc._type" as sales_doc_type,
        sh.carrier,
        convert_timezone('UTC', 'America/New_York', sh.creation_date_time_stamp) as order_received_at,
        sum(b."GROSS($)") as invoice_amount
    from sci.l0.shipping_container sc
    join sci.l0.shipment_header sh on sc.internal_shipment_num = sh.internal_shipment_num
    join kdb.pbi_sf.sap_customer_master cm on sh.ship_to = cm.shiptoparty_key and sh.route = cm.salesorg_key
    join kdb.pbi_sf.zsdrordr so on sh.user_def4 = so.salesdocnumber
    left join kdb.pbi_sf.zsd_c01_billing b on ltrim(sh.user_def4, '0') = b."Sales_document"
    left join sap_bw.l1.likp li on sh.shipment_id = li."Delivery"
    where sc.company in ('Ivy', 'Red', 'Vivace')
    -- PR Container-Type-Fix (2026-05-15): whitelist commented out.
    -- Whitelist was excluding active container types representing real
    -- shipping work — notably the VIVACE channel's VV BOX series:
    --   VV BOX 28   | 382 containers, 162 DOs
    --   VV BOX 40   | 200 containers, 121 DOs
    --   VV BOX 30   | 183 containers, 144 DOs
    --   VV BOX 22.5 |  10 containers,  10 DOs
    --   MANNEQUIN19 |  34 containers,  33 DOs
    --   MANNEQUIN24 |   4 containers,   4 DOs
    --   BOX IK2     |   6 containers,   6 DOs
    -- Verified by user via direct Snowflake query (2026-05-11 to 2026-05-18):
    --   Dashboard endpoint: 1,485 distinct DOs
    --   Raw SQL (no whitelist): 1,720 distinct DOs (diff = 235 DOs)
    -- User decision: drop whitelist, keep container_id IS NOT NULL for
    -- data integrity. Trade-off accepted — non-shipping container types
    -- (sample/return/test if any) may be included; operations validation
    -- (PR5) will refine if needed.
    -- and lower(sc.container_type) in ('as inner', 'as outer', 'car', 'ip', 'ivy inner', 'ivy outer')
    and sc.container_id is not null
    -- PR Truck-1 (2026-05-15): Truck carrier 추가. UPS 와 Truck 양쪽 의 fact.
    -- 사용자분 명시: "이 작업이 끝나면 carrier UPS 뿐만 아니고 TRUCK 도 추가해야돼"
    -- Truck 의 routing: pro_num (likp Means of Transport ID), truck_data CTE
    -- via sap_bw.l0.stage_ztshstus, status mapping (AF/CD/XB → origin,
    -- P1/X4/etc → processing, D1 → delivered). Truck 의 split logic:
    -- 사용자분 명시 "split shipment 에는 TRUCK 이 포함이 되면 안된다" —
    -- classified CTE 에서 carrier='TRUCK' → NOT_SPLIT 자동 분류.
    and (sh.carrier = 'UPS' or sh.carrier = 'TRUCK')
    AND TO_DATE(CASE WHEN salesdocdate = '00000000' then null else salesdocdate end, 'YYYYMMDD') >= ?
    AND TO_DATE(CASE WHEN salesdocdate = '00000000' then null else salesdocdate end, 'YYYYMMDD') <= ?
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27
)
, ia_work_instruction as (
    select
        erp_order as do,
        container_id,
        max(case when work_group = 'Picking' then work_type end) as work_type,
        max(case when work_group = 'Picking' then user_def1 end) as zone,
        max(case when work_group = 'Picking' then date_time_stamp end) as picking_date_time_utc,
        max(case when work_group = 'Picking' then convert_timezone('UTC', 'America/New_York', date_time_stamp) end) as picking_completion_time,
        max(case when work_type = 'Parcel Loading' then date_time_stamp end) as manifest_date_time_utc,
        max(case when work_type = 'Parcel Loading' then convert_timezone('UTC', 'America/New_York', date_time_stamp) end) as manifest_date_time
    from sci.l0.ia_work_instruction
    where company in ('Ivy', 'Red', 'Vivace')
    and (work_group = 'Picking' or (work_type = 'Parcel Loading' and instruction_type = 'Header'))
    group by 1, 2
)
, ups_data as (
    select
        tracking_num,
        max(case when status_type = 'Origin' then datetime end) as origin_date,
        max(case when status_type = 'Generic' then datetime end) as processing_date,
        max(case when status_type = 'Delivery' then try_to_timestamp(datetime) end) as delivered_date
    from sci.l0.ups_tracking
    group by 1
)
, truck_data as (
    select
        pronum,
        blnum as do_num,
        max(case when stat1 in ('AF', 'CD', 'XB') then convert_timezone('UTC','America/New_York', to_timestamp(concat(stusdat, '_', lpad(coalesce(nullif(trim(stustim), ''), '000000'), 6 , '0')), 'YYYY-MM-DD_HH24MISS')) end) as origin_date,
        max(case when stat1 in ('P1', 'X4', 'X6', 'L1', 'S1', 'J1', 'AG', 'AMAI', 'AV', 'SD', 'X1', 'X3', 'A7') then convert_timezone('UTC','America/New_York', to_timestamp(concat(stusdat, '_', lpad(coalesce(nullif(trim(stustim), ''), '000000'), 6 , '0')), 'YYYY-MM-DD_HH24MISS')) end) as processing_date,
        max(case when stat1 = 'D1' then convert_timezone('UTC','America/New_York', to_timestamp(concat(stusdat, '_', lpad(coalesce(nullif(trim(stustim), ''), '000000'), 6 , '0')), 'YYYY-MM-DD_HH24MISS')) end) as delivered_date
    from sap_bw.l0.stage_ztshstus
    group by 1, 2
)
, final as (
    select
        b.company,
        b.so_num,
        b.so_created_date,
        b.do_num,
        ls.date_time_stamp as wave_launch_date,
        ls.launch_flow,
        ia.work_type,
        ia.zone,
        ia.picking_completion_time,
        ia.manifest_date_time,
        b.trailing_sts,
        b.trailing_sts_date,
        b.order_received_at,
        b.container_id,
        b.container_status,
        b.container_type,
        b.container_status_time,
        coalesce(b.tracking_number, b.pro_num) as tracking_num,
        b.manifest_id,
        b.manifest_close_time,
        coalesce(ud.origin_date, td.origin_date) as origin_date,
        coalesce(ud.processing_date, td.processing_date) as processing_date,
        coalesce(ud.delivered_date, td.delivered_date) as delivered_date,
        b.billing_date,
        b.invoice_amount,
        b.carrier,
        b.sales_doc_type,
        b.cust_state,
        b.shiptoparty_key,
        b.cust_name,
        b.cust_city,
        b.cust_zipcode,
        b.wave_num,
        ls.internal_launch_num,
        b.internal_shipment_num
    from base b
    left join ia_work_instruction ia on b.do_num = ia.do and b.container_id = ia.container_id
    left join ups_data ud on b.tracking_number = ud.tracking_num and b.carrier = 'UPS'
    -- PR Truck-1-Region-Fix: trim → ltrim. Snowflake TRIM(str, '0') strips
    -- zeros from BOTH ends, so a Truck DO ending in '0' (e.g., '0801950600')
    -- becomes '801950 6' and silently misses the join to truck_data.blnum
    -- → origin_date / processing_date / delivered_date land null. The
    -- sibling clause on line 1051 deliberately uses LTRIM ('Sales_document'
    -- join) — same intent here. Verified via code-analyzer review.
    left join truck_data td on ltrim(b.do_num, '0') = td.do_num and b.pro_num = td.pronum and b.carrier = 'TRUCK'
    left join sci.l0.launch_statistics ls on b.launch_num = ls.internal_launch_num
)
, do_level as (
    select
        do_num,
        count(distinct tracking_num) as tracking_cnt,
        count(distinct container_id) as container_cnt,
        count(distinct manifest_id) as manifest_cnt,
        count(distinct date_trunc('day', delivered_date)) as delivered_date_cnt,
        max(case when tracking_num is null then 1 else 0 end) as has_null_tracking,
        max(case when tracking_num is not null and delivered_date is null then 1 else 0 end) as has_null_delivered_date
    from final
    group by do_num
)
, classified as (
    select
        b.*,
        d.tracking_cnt,
        d.container_cnt,
        d.manifest_cnt,
        d.delivered_date_cnt,
        d.has_null_tracking,
        d.has_null_delivered_date,
        -- PR Truck-1: Truck 자동 NOT_SPLIT (사용자분 명시 "split shipment 에는
        -- TRUCK 이 포함이 되면 안된다"). Truck = LTL single trailer / single
        -- pro_num — split 개념 없음. UPS 만 의 split 분석.
        case when b.carrier = 'TRUCK' then 'NOT_SPLIT'
             when d.has_null_tracking = 1 then 'MISSING_TRACKING'
             when d.delivered_date_cnt = 0 then 'PENDING'
             when d.delivered_date_cnt > 1 or d.has_null_delivered_date = 1 then 'SPLIT'
        else 'NOT_SPLIT'
        end as split_status
    from final b
    left join do_level d on b.do_num = d.do_num
)
, split_root_cause as (
    select
        do_num,
        count(distinct internal_launch_num) as wave_cnt,
        count(distinct date_trunc('day', wave_launch_date)) as wave_launch_time_cnt,
        count(distinct manifest_id) as manifest_cnt,
        count(distinct date_trunc('day', manifest_close_time)) as manifest_close_date_cnt,
        count(distinct zone) as zone_cnt,
        count(distinct date_trunc('day', picking_completion_time)) as picking_completion_date_cnt,
        count(distinct tracking_num) as tracking_cnt,
        case
            when count(distinct wave_num) > 1
              or count(distinct date_trunc('minute', wave_launch_date)) > 1
                then 'WAVE_LEVEL_SPLIT'
            when count(distinct manifest_id) > 1
             and count(distinct date_trunc('day', manifest_close_time)) > 1
                then 'MANIFEST_LEVEL_SPLIT'
            when count(distinct zone) > 1
             and count(distinct date_trunc('day', picking_completion_time)) > 1
                then 'ZONE_LEVEL_SPLIT'
            when count(distinct tracking_num) > 1
             and count(distinct date_trunc('day', manifest_close_time)) = 1
                then 'UPS_TRAILER_SPLIT'
            else 'UNCLASSIFIED_SPLIT'
        end as split_root_cause
    from classified
    where split_status = 'SPLIT'
    group by do_num
)
select
    c.*,
    case when c.split_status = 'SPLIT' then 'Y' else 'N' end as is_split_shipment,
    r.split_root_cause
from classified c
left join split_root_cause r on c.do_num = r.do_num
order by c.do_num, c.container_status_time;
`;

app.get('/api/scale/split-shipments', async (req, res) => {
  try {
    // PR4a: date range parameters with default = trailing 7 days.
    // SQL uses two `?` bind variables — order: [from, to].
    // Format: SAP's SALESDOCDATE column is stored as YYYYMMDD VARCHAR;
    // the SQL handles that on the LHS via TO_DATE(col, 'YYYYMMDD').
    // The bind RHS must be YYYY-MM-DD (Snowflake's auto-DATE-cast format)
    // — see docs/references/snowflake-schema.md § Verified facts —
    // "Date handling" (PR4a hotfix). Stripping dashes silently returns
    // 0 rows.
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const formatDate = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD

    const from = req.query.from || formatDate(weekAgo);
    const to = req.query.to || formatDate(today);

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD.',
      });
    }
    if (from > to) {
      return res.status(400).json({
        success: false,
        error: 'from date must be <= to date.',
      });
    }

    // Bind YYYY-MM-DD directly — Snowflake auto-casts to DATE.
    const rows = await executeQuery(SPLIT_SHIPMENTS_SQL, [from, to]);
    const data = rows.map(toFactShape);
    res.json({
      success: true,
      data,
      count: data.length,
      source: 'snowflake',
      table: 'SCI.L0.SHIPMENT_HEADER + SHIPPING_CONTAINER + IA_WORK_INSTRUCTION + UPS_TRACKING + KDB.PBI_SF.SAP_CUSTOMER_MASTER + ZSDRORDR',
      filter: { from, to },
    });
  } catch (err) {
    console.error('split-shipments query failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Custom query (admin only — for Data Hub) ────────────────────────────────

app.post('/api/kdc/query', async (req, res) => {
  const { sql } = req.body;
  if (!sql) return res.status(400).json({ success: false, error: 'Missing SQL' });

  // Safety: only allow SELECT
  if (!/^\s*SELECT/i.test(sql.trim())) {
    return res.status(403).json({ success: false, error: 'Only SELECT queries are allowed' });
  }

  try {
    const rows = await executeQuery(sql);
    res.json({ success: true, data: rows, count: rows.length, source: 'snowflake' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ════════════════════════════════════════════════════════════════════════════
// GEMINI AI ENDPOINTS
// Uses Google Gemini 2.5 Flash for warehouse operations intelligence
// Falls back to mock responses when API key is not configured
// ════════════════════════════════════════════════════════════════════════════

// PR AI-Phase1: accept either env var name. GOOGLE_GENERATIVE_AI_API_KEY
// is the @google/genai SDK convention (used by /api/ai/chat + /api/ai/insight
// historically), GEMINI_API_KEY is the shorter form. Either works; no .env
// migration needed.
const GEMINI_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
const genai = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

const DC_SYSTEM_PROMPT = `You are KDC Intelligence AI, an operations analyst for Kiss Distribution Center (KDCGA1) in Savannah, GA.
You analyze warehouse KPI data and provide actionable insights for DC operations managers.

Context:
- Companies: Kiss (1000), Ivy (1100), Red (1400), Vivace (1900)
- WMS: Manhattan Active SCALE
- ERP: SAP
- Carriers: UPS (parcel), R&L (LTL), FedEx, various truck carriers
- Key processes: Wave planning, picking (Autostore + Pick Module), packing (QC via EX03/EX28), staging, loading, ship confirm
- KDC target: D+1 processing for all orders
- Distribution channels: CS-Bulk, CS-DSDC, BS-IVY, BS-RED, VIVACE, AST, IIO, KIO, ECOM-AMAZON 1P/3P, ECOM-DTC

Your responses should be:
- Concise and actionable (no fluff)
- Focused on operational impact
- Include specific numbers when data is provided
- Prioritize issues by urgency
- Reference KDC-specific terminology (waves, SCALE status codes, consolidation locations, etc.)`;

// AI Chat endpoint — conversational
app.post('/api/ai/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ success: false, error: 'Missing message' });

  if (!genai) {
    // Mock response when no API key
    return res.json({
      success: true,
      response: getMockAIResponse(message),
      source: 'mock',
      message: 'AI responses are mocked — add GOOGLE_GENERATIVE_AI_API_KEY to .env for real AI',
    });
  }

  try {
    const contextStr = context ? `\n\nCurrent data context:\n${JSON.stringify(context)}` : '';
    const response = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${DC_SYSTEM_PROMPT}${contextStr}\n\nUser question: ${message}`,
    });
    const text = response.text || 'I was unable to generate a response. Please try again.';
    res.json({ success: true, response: text, source: 'gemini' });
  } catch (err) {
    res.json({ success: true, response: getMockAIResponse(message), source: 'mock-fallback', error: err.message });
  }
});

// AI Insight endpoint — structured shift analysis
app.post('/api/ai/insight', async (req, res) => {
  const { kpis } = req.body;

  if (!genai) {
    return res.json({ success: true, data: getMockInsight(), source: 'mock' });
  }

  try {
    const kpiStr = kpis ? kpis.map(k => `${k.label}: ${k.value} (${k.delta})`).join('\n') : 'No KPI data provided';
    const response = await genai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${DC_SYSTEM_PROMPT}\n\nAnalyze today's KPI data and provide a structured insight:\n\n${kpiStr}\n\nRespond in JSON format:\n{"summary": "...", "highlights": [{"metric": "...", "observation": "...", "impact": "positive|negative|neutral"}], "recommendations": ["..."], "riskAlerts": ["..."]}`,
    });

    const text = response.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      res.json({ success: true, data: JSON.parse(jsonMatch[0]), source: 'gemini' });
    } else {
      res.json({ success: true, data: getMockInsight(), source: 'mock-fallback' });
    }
  } catch (err) {
    res.json({ success: true, data: getMockInsight(), source: 'mock-fallback', error: err.message });
  }
});

// AI Risk Analyze (batch) — PR AI-Phase1
//
// Phase 1 test integration. Accepts a batch of normalized at-risk orders +
// page-level context, asks Gemini 2.5 Flash to score and explain each one,
// and returns structured analyses (one per do_num). Caller (AIRiskPage)
// keeps a Map keyed by do_num and renders an "AI" column / Detail modal
// section on top of the existing rule-based risk view.
//
// Configuration:
//   GOOGLE_GENERATIVE_AI_API_KEY must be set in .env. The same key drives
//   /api/ai/chat and /api/ai/insight; this endpoint reuses the genai client
//   instantiated at line 1283.
//
// Response shape (per user spec):
//   Success: { success: true, analyses: [...], latency_ms: N, model: '...' }
//   Failure: { success: false, error: '...', fallback_available: true }
//   No key:  HTTP 503 + same failure shape.
//
// Payload hygiene:
//   invoice_amount / orderValue / chargeback are stripped defensively
//   before sending to Gemini. The caller already excludes them, but a second
//   pass here prevents accidental dollar-bias if a future caller forgets.
app.post('/api/ai/risk-analyze-batch', async (req, res) => {
  const startTime = Date.now();

  if (!genai) {
    return res.status(503).json({
      success: false,
      error: 'Set GOOGLE_GENERATIVE_AI_API_KEY or GEMINI_API_KEY in .env',
      fallback_available: true,
    });
  }

  const { orders, context } = req.body || {};
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or empty `orders` array',
      fallback_available: false,
    });
  }
  if (orders.length > 50) {
    return res.status(400).json({
      success: false,
      error: 'Batch limited to 50 orders per request',
      fallback_available: false,
    });
  }

  // Defensive dollar-field strip — see header comment.
  const sanitizedOrders = orders.map(o => {
    const { invoice_amount, orderValue, chargeback, ...rest } = o;
    return rest;
  });

  const prompt = `You are a warehouse operations risk analyst at KDC Savannah, GA.
Analyze the following batch of ${sanitizedOrders.length} at-risk open orders and produce one structured assessment per order.

Context:
- Window: ${context?.window || 'recent'}
- Total open orders in scope: ${context?.total_orders ?? 'unknown'}
- KDC target: D+1 ship confirm.
- SCALE trailing_status codes: 700 = Ship Confirm Pending, 800 = Load Confirm Pending, 900 = Closed.
- Carriers: UPS (parcel, calendar-day lead time by zone), TRUCK (LTL, business-day lead time).
- Each order carries a rule-based score (rule_based_score / rule_based_level / rule_based_reasons) you can corroborate or contradict — explain disagreements explicitly.
- Dollar amounts are intentionally absent to prevent dollar-bias; assess on operational fundamentals only.

For each order produce:
- risk_score (0-100, your own assessment)
- risk_level: Low (0-30), Medium (31-65), High (66-100)
- predicted_delay_hours: integer hours past SLA (0 if on-track)
- confidence_pct: 0-100, your confidence
- key_factors: 2-4 concrete reasons citing the order's actual data (state, carrier, cycle hours, manifest count, etc.)
- recommended_action: one concrete operational step Ops can take in the next shift

Orders (JSON):
${JSON.stringify(sanitizedOrders, null, 2)}

Return a JSON array, one object per do_num, in the same order as input.`;

  // 30s timeout via Promise.race — @google/genai SDK doesn't expose
  // a per-call timeout, so wrap the call and reject on the deadline.
  const callGemini = genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            do_num: { type: 'string' },
            risk_score: { type: 'integer', minimum: 0, maximum: 100 },
            risk_level: { type: 'string', enum: ['Low', 'Medium', 'High'] },
            predicted_delay_hours: { type: 'integer' },
            confidence_pct: { type: 'integer', minimum: 0, maximum: 100 },
            key_factors: { type: 'array', items: { type: 'string' } },
            recommended_action: { type: 'string' },
          },
          required: ['do_num', 'risk_score', 'risk_level', 'confidence_pct', 'key_factors', 'recommended_action'],
        },
      },
    },
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini API timeout after 30s')), 30000)
  );

  try {
    const response = await Promise.race([callGemini, timeout]);
    const latency_ms = Date.now() - startTime;
    const text = response.text || '';

    let analyses;
    try {
      analyses = JSON.parse(text);
    } catch (parseErr) {
      return res.json({
        success: false,
        error: `Gemini response was not valid JSON: ${parseErr.message}`,
        fallback_available: true,
        latency_ms,
        raw_response_excerpt: text.slice(0, 500),
      });
    }

    if (!Array.isArray(analyses)) {
      return res.json({
        success: false,
        error: 'Gemini response was not a JSON array',
        fallback_available: true,
        latency_ms,
      });
    }

    res.json({
      success: true,
      analyses,
      latency_ms,
      model: 'gemini-2.5-flash',
    });
  } catch (err) {
    const latency_ms = Date.now() - startTime;
    console.error('risk-analyze-batch failed:', err.message);
    res.json({
      success: false,
      error: err.message || 'Gemini API call failed',
      fallback_available: true,
      latency_ms,
    });
  }
});

// Mock AI responses for when no API key is available
function getMockAIResponse(message) {
  const m = message.toLowerCase();
  if (m.includes('pick') || m.includes('productivity'))
    return 'Current pick productivity is trending at ~120 units/hr across Pick Module stations. Autostore throughput is higher at ~180 units/hr. Shift 1 consistently outperforms Shift 2 by 15-20%. Recommendation: Review labor allocation for Shift 2 pick zones, particularly in the Ivy Reserve area where we\'re seeing longer cycle times.';
  if (m.includes('dock') || m.includes('inbound'))
    return 'Dock utilization is at 75% with 9 of 12 doors active. DOOR-03 and DOOR-07 have been in UNLOADING status for >2 hours — check for trailer detention. R&L LTL loads are backed up at consolidation area T. Recommend clearing T05-T08 staging positions to improve flow.';
  if (m.includes('carrier') || m.includes('ups') || m.includes('shipping'))
    return 'UPS parcel performance: 19.4% on-time rate (90d), significantly below target. Zone 5+ destinations (IL, TX, CA) showing worst performance. R&L LTL has 3 shipments missing PRO numbers at status 650+. Recommend escalating with UPS regional rep and auditing EX27 R&L API integration.';
  if (m.includes('delay') || m.includes('late') || m.includes('backorder'))
    return '42,443 in-stock backorders currently open (orders past RDD but not shipped). 18,984 delayed shipments in the last 90 days. Top delay causes: DC processing (wave/allocation holds), UPS transit delays, and missing product (short picks). Critical: 2,165 Ivy orders stuck in Pool status >24hrs.';
  if (m.includes('wave') || m.includes('allocation'))
    return 'Last 2 days: 47 waves processed. Kiss waves averaging 38 shipments/wave, Ivy waves at 17. Wave completion rate is 96.8%. 159 Ivy shipments stuck at Waved status — likely allocation failures due to inventory variance. Check FIFO allocation rule for Ivy Reserve zones.';
  if (m.includes('split') || m.includes('carton'))
    return 'Split shipment rate is 15.9% against a 0% target — this is a critical compliance issue. Top split reasons: short picks (55% of splits), wave cutoff misses (25%), and SAP-SCALE inventory variance. Ulta Beauty and Target Corp are most affected. Estimated chargeback exposure: $32,903.';
  return 'I can help you analyze KDC warehouse operations data. Try asking about:\n\n• Pick productivity and throughput\n• Dock status and inbound operations\n• Carrier performance (UPS, R&L)\n• Delay root causes and backorders\n• Wave planning and allocation\n• Split shipment compliance\n• Shift performance comparison\n• Customer-specific SLA analysis';
}

function getMockInsight() {
  return {
    summary: 'Operations show elevated backorder levels with 42K+ orders past due. On-time ship rate at 19.4% is significantly below target. Pick Module productivity stable but wave processing showing allocation bottlenecks in Ivy Reserve zones.',
    highlights: [
      { metric: 'On-Time Ship Rate', observation: '19.4% against 95% target — 80% of shipped orders are late', impact: 'negative' },
      { metric: 'Backorder Volume', observation: '42,443 open backorders — primarily Ivy and Kiss companies', impact: 'negative' },
      { metric: 'Avg Cycle Time', observation: '87 hours order-to-dock vs 18 hour target', impact: 'negative' },
    ],
    recommendations: [
      'Prioritize clearing 2,165 Ivy orders stuck in Pool status — investigate SAP interface lag',
      'Escalate UPS on-time performance with regional account manager',
      'Review wave planning rules — 159 orders stuck at Waved status suggest allocation failures',
    ],
    riskAlerts: [
      'Critical: 19% OTD rate will trigger customer chargebacks if not addressed within 48 hours',
      'Split shipment rate 15.9% — Ulta Beauty and Target Corp compliance risk',
    ],
  };
}

// ── Smartsheet Issue Types (PR Geo-5) ───────────────────────────────────────
// Smartsheet integration to overlay issue types (raid types) onto delivered
// shipments on the Geographic page. Data flow:
//   1. Fetch raw issues from Smartsheet API (sheet 6603206110275460)
//   2. Extract Order# + Raid Type, normalize both
//   3. Join with kdb.pbi_sf.zsdrordr (SO doctypes ZOR/ZNEW/ZSO/ZREN/ZFD)
//      to map SO → DO. Snowflake read-only, no view-creation permission, so
//      mapping is done via inline SELECT.
//   4. Return DO-keyed issue records to frontend.
//
// Smartsheet contains ALL issues (historical + current), but only the recent
// ones map to ZSDRORDR. Typical match rate ~8.5% — that's expected, NOT a bug:
// most Smartsheet rows are old issues outside ZSDRORDR retention. Frontend
// uses the matched subset only.
//
// Cache TTL: 1 hour. Smartsheet API rate limit is 300 req/min; with 1h cache
// the per-user load is negligible.

const SMARTSHEET_API_TOKEN = process.env.SMARTSHEET_API_TOKEN;
const SMARTSHEET_SHEET_ID  = process.env.SMARTSHEET_SHEET_ID || '6603206110275460';
const SMARTSHEET_CACHE_TTL_MS = 60 * 60 * 1000;  // 1 hour

let _smartsheetCache = null;       // { fetchedAt, data }
let _smartsheetFetching = null;    // dedupe concurrent fetches

// Parse a raid type string into { code, label, canonical }.
// Smartsheet has inconsistent casing — "1.1 Lost Shipment" / "1.1 LOST SHIPMENT"
// both occur. We extract the numeric code (1.1, 2.1, ...) and uppercase the
// label so all variants collapse to one canonical form.
//
// Example: "  2.1  Lost Shipment  "  →
//   { code: '2.1', label: 'LOST SHIPMENT', canonical: '2.1 LOST SHIPMENT' }
function parseRaidType(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ').toUpperCase();
  const m = cleaned.match(/^(\d+\.\d+)\s+(.+)$/);
  if (!m) return null;
  return { code: m[1], label: m[2], canonical: `${m[1]} ${m[2]}` };
}

// Normalize order numbers. Smartsheet stores raw integers ("2115371"), but
// ZSDRORDR uses zero-padded VARCHAR(10) ("0001647548"). Stripping leading
// zeros on both sides gives a consistent join key.
//
// Excludes obviously invalid values: "None", empty, non-numeric.
function normalizeOrderNum(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === 'None' || !/^\d+$/.test(s)) return null;
  return s.replace(/^0+/, '') || '0';  // "0" if all zeros
}

// Fetch + parse Smartsheet rows. Returns { orders, raidTypes, fetchedAt }
// where `orders` is a Map<normalized_so, [raidType, ...]> and `raidTypes`
// is the deduplicated list of all canonical raid types seen.
async function fetchSmartsheetIssues() {
  if (!SMARTSHEET_API_TOKEN) {
    throw new Error('Missing SMARTSHEET_API_TOKEN — set in .env');
  }

  // Paginate: fetch page=1, 2, ... until we have all rows.
  // Smartsheet pageSize cap is 10000 but we use 5000 to stay conservative.
  // Sheet metadata (columns) is returned with every page.
  const PAGE_SIZE = 5000;
  let sheet = null;
  const allRows = [];
  let pageNum = 1;

  while (true) {
    const url = `https://api.smartsheet.com/2.0/sheets/${SMARTSHEET_SHEET_ID}`
      + `?include=columnType&pageSize=${PAGE_SIZE}&page=${pageNum}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${SMARTSHEET_API_TOKEN}` },
    });
    if (!resp.ok) {
      throw new Error(`Smartsheet API ${resp.status}: ${await resp.text()}`);
    }
    const pageData = await resp.json();

    // Keep columns from the first page (Smartsheet returns them on every page,
    // but values are identical). Subsequent pages only contribute rows.
    if (pageNum === 1) sheet = pageData;
    const pageRows = pageData.rows || [];
    for (const row of pageRows) allRows.push(row);

    // Smartsheet doesn't return totalPages with this query shape — only
    // totalRowCount. Stop once we've collected everything, or when a page
    // comes back short (defensive guard for the rare case where totalRowCount
    // is missing).
    const totalRowCount = pageData.totalRowCount;
    const done = (typeof totalRowCount === 'number' && allRows.length >= totalRowCount)
      || pageRows.length < PAGE_SIZE;
    if (done) break;
    pageNum += 1;

    // Safety net: cap at 20 pages (= 100k rows) to prevent runaway loops
    // if Smartsheet API changes behavior unexpectedly.
    if (pageNum > 20) {
      throw new Error(`Smartsheet pagination exceeded 20 pages — investigate`);
    }
  }

  // Replace sheet.rows with the full aggregated list before downstream parse
  sheet.rows = allRows;

  // Build columnId → title map so we can look up cells by column title.
  // Smartsheet returns columnId in each cell, not the title.
  const colTitleById = new Map();
  for (const c of sheet.columns || []) {
    colTitleById.set(c.id, (c.title || '').trim());
  }

  const ordersMap = new Map();   // normalizedSO → [parsedRaid, parsedRaid, ...]
  const raidTypesSet = new Map(); // canonical → { code, label, canonical, count }

  for (const row of sheet.rows || []) {
    let orderRaw = null;
    let raidRaw  = null;
    for (const cell of row.cells || []) {
      const title = colTitleById.get(cell.columnId);
      if (!title) continue;
      // Column titles per user: 'Order#' and 'Raid Type'. Smartsheet sometimes
      // returns values in .value (typed) or .displayValue (string repr).
      const val = cell.value ?? cell.displayValue;
      if (title.toLowerCase() === 'order#') orderRaw = val;
      else if (title.toLowerCase() === 'raid type') raidRaw = val;
    }
    const so = normalizeOrderNum(orderRaw);
    const raid = parseRaidType(raidRaw);
    if (!so || !raid) continue;

    if (!ordersMap.has(so)) ordersMap.set(so, []);
    ordersMap.get(so).push(raid);

    if (!raidTypesSet.has(raid.canonical)) {
      raidTypesSet.set(raid.canonical, { ...raid, count: 0 });
    }
    raidTypesSet.get(raid.canonical).count += 1;
  }

  return {
    orders: ordersMap,
    raidTypes: Array.from(raidTypesSet.values()),
    fetchedAt: Date.now(),
    totalRows: (sheet.rows || []).length,
  };
}

// Join Smartsheet orders with ZSDRORDR to get DO numbers. Returns a list of
// { do_num, so_num, raid_code, raid_label } records — one row per (DO, raid).
// Inline mapping query because Snowflake is read-only (no view creation).
async function enrichWithDoMapping(ordersMap) {
  const soList = Array.from(ordersMap.keys());
  if (soList.length === 0) return [];

  // ZSDRORDR salesdocnumber is zero-padded VARCHAR(10). Strip zeros on the
  // Snowflake side so the comparison matches our normalized Smartsheet keys.
  // Snowflake's bind array limit is ~16k for VARCHAR; 4,500 SOs is well within.
  const placeholders = soList.map(() => '?').join(',');
  const rows = await executeQuery(
    `
    SELECT DISTINCT
      LTRIM(salesdocnumber, '0') AS so_num,
      deliverynumber              AS do_num
    FROM kdb.pbi_sf.zsdrordr
    WHERE salesdoctype IN ('ZOR', 'ZNEW', 'ZSO', 'ZREN', 'ZFD')
      AND deliverynumber IS NOT NULL
      AND LTRIM(salesdocnumber, '0') IN (${placeholders})
    `,
    soList
  );

  // Each (SO, DO) row → emit one record per raid type associated with the SO.
  const results = [];
  for (const r of rows) {
    const soNum = r.SO_NUM || r.so_num;
    const doNum = r.DO_NUM || r.do_num;
    if (!soNum || !doNum) continue;
    const raids = ordersMap.get(soNum) || [];
    for (const raid of raids) {
      results.push({
        do_num: doNum,
        so_num: soNum,
        raid_code: raid.code,
        raid_label: raid.label,
      });
    }
  }
  return results;
}

// GET /api/smartsheet/issues — returns issue overlay for the Geographic page.
// Response shape:
//   {
//     success: true,
//     data: {
//       issues: [{ do_num, so_num, raid_code, raid_label }, ...],
//       raidTypes: [{ code, label, canonical, count }, ...],
//     },
//     cached: boolean,
//     fetchedAt: ISO string,
//     source: 'smartsheet+snowflake',
//     stats: { smartsheetRows, matchedDOs, raidTypeCount }
//   }
//
// Query string: ?refresh=true bypasses cache (manual force-refresh).
app.get('/api/smartsheet/issues', async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === 'true';
    const cacheValid = _smartsheetCache
      && !forceRefresh
      && (now - _smartsheetCache.fetchedAt) < SMARTSHEET_CACHE_TTL_MS;

    if (cacheValid) {
      return res.json({
        success: true,
        data: _smartsheetCache.data,
        cached: true,
        fetchedAt: new Date(_smartsheetCache.fetchedAt).toISOString(),
        source: 'smartsheet+snowflake',
        stats: _smartsheetCache.stats,
      });
    }

    // Dedupe concurrent first-fetches so we don't hammer Smartsheet on
    // server startup when multiple users hit the page simultaneously.
    if (!_smartsheetFetching) {
      _smartsheetFetching = (async () => {
        const ss = await fetchSmartsheetIssues();
        const issues = await enrichWithDoMapping(ss.orders);
        const data = { issues, raidTypes: ss.raidTypes };
        const stats = {
          smartsheetRows: ss.totalRows,
          smartsheetOrders: ss.orders.size,
          matchedDOs: new Set(issues.map(i => i.do_num)).size,
          totalIssueRows: issues.length,
          raidTypeCount: ss.raidTypes.length,
        };
        _smartsheetCache = { fetchedAt: ss.fetchedAt, data, stats };
        return _smartsheetCache;
      })().finally(() => { _smartsheetFetching = null; });
    }
    const fresh = await _smartsheetFetching;

    res.json({
      success: true,
      data: fresh.data,
      cached: false,
      fetchedAt: new Date(fresh.fetchedAt).toISOString(),
      source: 'smartsheet+snowflake',
      stats: fresh.stats,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  KDC Operations Intelligence — API Server`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Snowflake: ${process.env.SNOWFLAKE_ACCOUNT || 'not configured'}`);
  console.log(`  Database:  ${process.env.SNOWFLAKE_DATABASE || 'SCI'}.${process.env.SNOWFLAKE_SCHEMA || 'PUBLIC'}`);
  console.log(`  Auth:      SNOWFLAKE_JWT (RSA key-pair)`);
  console.log(`  Warehouse: KDCGA1 (KISS Savannah, GA)`);
  console.log(`\n  ── SCALE Raw Table Endpoints ──`);
  console.log(`  GET  /api/scale/lifecycle-heatmap    SHIPMENT_HEADER (active stages)`);
  console.log(`  GET  /api/scale/active-waves         LAUNCH_STATISTICS (last 2d)`);
  console.log(`  GET  /api/scale/otd                  SHIPMENT_HEADER (last 30d)`);
  console.log(`  GET  /api/scale/daily-volume         SHIPMENT_HEADER (last 90d)`);
  console.log(`  GET  /api/scale/stuck-shipments      SHIPMENT_HEADER (>24h idle)`);
  console.log(`  GET  /api/scale/shipments            SHIPMENT_HEADER (filtered)`);
  console.log(`  GET  /api/scale/waves                LAUNCH_STATISTICS (last 7d)`);
  console.log(`  GET  /api/scale/config               mock defaults (KISS_BI_CONFIG pending)`);
  console.log(`  PUT  /api/scale/config/:key          no-op until KISS_BI_CONFIG created`);
  console.log(`\n  ── Pending (need kdc_intelligence_foundation.sql) ──`);
  console.log(`  GET  /api/scale/consol-usage         VOP_CONSOL_LOCATION_USAGE`);
  console.log(`  GET  /api/scale/open-manifests       VOP_OPEN_MANIFESTS`);
  console.log(`  GET  /api/scale/qc-by-station        VPROD_QC_BY_STATION`);
  console.log(`  GET  /api/scale/qc-by-user           VPROD_QC_BY_USER`);
  console.log(`  GET  /api/scale/pick-cycle           VPROD_PICK_CYCLE`);
  console.log(`  GET  /api/scale/autostore            VPROD_AUTOSTORE_THROUGHPUT`);
  console.log(`  GET  /api/scale/short-picks          VEXC_SHORT_PICKS`);
  console.log(`  GET  /api/scale/qc-failures          VEXC_QC_FAILURES`);
  console.log(`  GET  /api/scale/rl-missing-pro       VEXC_RL_MISSING_PRO`);
  console.log(`  GET  /api/scale/ib-reconciliation    VEXC_IB_RECONCILIATION`);
  console.log(`  GET  /api/scale/qc-fail-alerts       VEXC_QC_FAIL_RATE_ALERT`);
  console.log(`\n  ── Verified Queries (Kathleen Li) ──`);
  console.log(`  GET  /api/scale/workload-in-process  In-process by area/customer`);
  console.log(`  GET  /api/scale/workload-pm          PM pick history (30d)`);
  console.log(`  GET  /api/scale/workload-ps          PS pack history (30d)`);
  console.log(`  GET  /api/scale/order-processing-time  Order cycle time`);
  console.log(`  GET  /api/scale/pick-frequency       Slotting/pick freq analysis`);
  console.log(`\n  ── Exploration (sub-plan 002 PR1) ──`);
  console.log(`  GET  /api/scale/explore-ia-wi               IA_WORK_INSTRUCTION schema (§7c #17)`);
  console.log(`  GET  /api/scale/explore-shipping-container  SHIPPING_CONTAINER schema (§7c #18)`);
  console.log(`  GET  /api/scale/explore-process-history     PROCESS_HISTORY schema (§7c #18)`);
  console.log(`  GET  /api/scale/explore-ups-tracking        UPS_TRACKING schema (PR2.5, §7c #18 last-scan)`);
  console.log(`\n  ── Phase 1 Live Endpoints (sub-plan 002 → 004) ──`);
  console.log(`  GET  /api/scale/split-shipments             Phase A: detection (BS-IVY/RED/VIVACE via UPS)`);
  console.log('');
  console.log('  ── AI (Gemini 2.5 Flash) ──');
  console.log('  POST /api/ai/chat                    Conversational ops Q&A');
  console.log('  POST /api/ai/insight                 Structured KPI insight');
  console.log('  POST /api/ai/risk-analyze-batch      Batch risk analysis (top-N at-risk orders)');
  console.log(`\n  ── Smartsheet Integration (PR Geo-5) ──`);
  console.log(`  GET  /api/smartsheet/issues          Issue types overlay (1h cache; ?refresh=true to force)`);
  console.log(`\n  ── Utility ──`);
  console.log(`  GET  /api/health                     Health check`);
  console.log(`  POST /api/snowflake/test             Test connection`);
  console.log(`  GET  /api/snowflake/config           Current config`);
  console.log(`  POST /api/kdc/query                  Custom SELECT`);
  console.log('');
});
