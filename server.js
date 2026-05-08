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

/**
 * Convert a Snowflake row (UPPERCASE keys) to FactShipment shape
 * (lowercase keys) used by the React frontend.
 *
 * Initial PR1 version — minimal mapping. PR3 extends this for
 * the full /api/scale/split-shipments response with container-row
 * preservation and 3-type split flags.
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

    // Channel
    channel: row.COMPANY,
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
    leading_sts: row.LEADING_STS,
    container_type: row.CONTAINER_TYPE,
    tracking_num: row.TRACKING_NUM,

    // UPS tracking (ups_data CTE)
    origin_date: row.ORIGIN_DATE,
    processing_date: row.PROCESSING_DATE,
    delivered_date: row.DELIVERED_DATE,
    delivered_state: row.DELIVERED_STATE,

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
  };
}

// ── Overview KPIs (Executive Overview page) ─────────────────────────────────

app.get('/api/scale/overview-kpis', async (_req, res) => {
  try {
    // Current period (last 90 days) and same period last year for YoY
    const rows = await executeQuery(`
      WITH current_period AS (
        SELECT
          COUNT(DISTINCT sh.SHIPMENT_ID) AS TOTAL_ORDERS,
          COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL AND sh.ACTUAL_SHIP_DATE_TIME::DATE <= sh.REQUESTED_DELIVERY_DATE::DATE THEN sh.SHIPMENT_ID END) AS ON_TIME_SHIP,
          COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL THEN sh.SHIPMENT_ID END) AS SHIPPED,
          COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL AND sh.ACTUAL_SHIP_DATE_TIME::DATE > sh.REQUESTED_DELIVERY_DATE::DATE THEN sh.SHIPMENT_ID END) AS DELAYED,
          COUNT(DISTINCT CASE WHEN sh.TRAILING_STS BETWEEN 100 AND 899 AND sh.ACTUAL_SHIP_DATE_TIME IS NULL AND sh.REQUESTED_DELIVERY_DATE::DATE < CURRENT_DATE() THEN sh.SHIPMENT_ID END) AS BACKORDERS,
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL AND sh.ACTUAL_SHIP_DATE_TIME::DATE <= sh.REQUESTED_DELIVERY_DATE::DATE THEN sh.SHIPMENT_ID END) / NULLIF(COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL THEN sh.SHIPMENT_ID END), 0), 1) AS ON_TIME_SHIP_PCT,
          ROUND(AVG(CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL THEN DATEDIFF('HOUR', sh.CREATION_DATE_TIME_STAMP, sh.ACTUAL_SHIP_DATE_TIME) END), 1) AS AVG_CYCLE_HRS
        FROM SCI.PUBLIC.SHIPMENT_HEADER sh
        WHERE sh.WAREHOUSE = 'KDCGA1' AND sh.IN_DELETION = 'N'
          AND sh.REQUESTED_DELIVERY_DATE IS NOT NULL
          AND sh.CREATION_DATE_TIME_STAMP >= DATEADD('day', -90, CURRENT_DATE())
      ),
      prior_year AS (
        SELECT
          COUNT(DISTINCT sh.SHIPMENT_ID) AS PY_TOTAL_ORDERS,
          COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL AND sh.ACTUAL_SHIP_DATE_TIME::DATE <= sh.REQUESTED_DELIVERY_DATE::DATE THEN sh.SHIPMENT_ID END) AS PY_ON_TIME_SHIP,
          COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL THEN sh.SHIPMENT_ID END) AS PY_SHIPPED,
          COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL AND sh.ACTUAL_SHIP_DATE_TIME::DATE > sh.REQUESTED_DELIVERY_DATE::DATE THEN sh.SHIPMENT_ID END) AS PY_DELAYED,
          ROUND(100.0 * COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL AND sh.ACTUAL_SHIP_DATE_TIME::DATE <= sh.REQUESTED_DELIVERY_DATE::DATE THEN sh.SHIPMENT_ID END) / NULLIF(COUNT(DISTINCT CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL THEN sh.SHIPMENT_ID END), 0), 1) AS PY_ON_TIME_SHIP_PCT,
          ROUND(AVG(CASE WHEN sh.ACTUAL_SHIP_DATE_TIME IS NOT NULL THEN DATEDIFF('HOUR', sh.CREATION_DATE_TIME_STAMP, sh.ACTUAL_SHIP_DATE_TIME) END), 1) AS PY_AVG_CYCLE_HRS
        FROM SCI.PUBLIC.SHIPMENT_HEADER sh
        WHERE sh.WAREHOUSE = 'KDCGA1' AND sh.IN_DELETION = 'N'
          AND sh.REQUESTED_DELIVERY_DATE IS NOT NULL
          AND sh.CREATION_DATE_TIME_STAMP >= DATEADD('day', -90, DATEADD('year', -1, CURRENT_DATE()))
          AND sh.CREATION_DATE_TIME_STAMP < DATEADD('year', -1, CURRENT_DATE())
      )
      SELECT c.*, p.*
      FROM current_period c, prior_year p
    `);
    res.json({ success: true, data: rows[0] || {}, source: 'snowflake', table: 'SCI.PUBLIC.SHIPMENT_HEADER' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
        sh.internal_shipment_num,
        cm.shiptoparty_key,
        cm.name as cust_name,
        cm.region as cust_state,
        cm.city as cust_city,
        cm.postalcode as cust_zipcode,
        sc.container_id,
        sc.container_type,
        sc.container_class,
        sh.LEADING_STS,
        sc.status as container_status,
        sc.tracking_number,
        sc.manifest_id,
        cast(concat(left(SALESDOCDATE, 4) , '-' , SUBSTRING(SALESDOCDATE, 5, 2) ,'-' , right(SALESDOCDATE, 2)) as date) so_created_date,
        convert_timezone('UTC', 'America/New_York', sc.date_time_stamp) as container_status_time,
        convert_timezone('UTC', 'America/New_York', sc.manifest_close_date_time) as manifest_close_time
    from sci.l0.shipping_container sc
    join sci.l0.shipment_header sh on sc.internal_shipment_num = sh.internal_shipment_num
    join kdb.pbi_sf.sap_customer_master cm on sh.ship_to = cm.shiptoparty_key and sh.route = cm.salesorg_key
    join kdb.pbi_sf.zsdrordr so on sh.user_def4 = so.salesdocnumber
    where sc.company in ('Ivy', 'Red', 'Vivace')
    and lower(sc.container_type) in ('as inner', 'as outer', 'car', 'ip', 'ivy inner', 'ivy outer')
    and sh.carrier = 'UPS'
    AND YEAR(TO_DATE(CASE WHEN salesdocdate = '00000000' then null else salesdocdate end, 'YYYYMMDD')) = year(current_date())
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
        max(case when status_type = 'Delivery' then datetime end) as delivered_date,
        max(case when status_type = 'Delivery' then delivery_political_div1 end) as delivered_state
    from sci.l0.ups_tracking
    group by 1
)
, final as (
    select 
        b.company,
        b.so_num,
        b.so_created_date,
        b.do_num,
        ia.work_type,
        ia.zone,
        ia.picking_completion_time,
        ia.manifest_date_time,
        b.leading_sts,
        b.container_id,
        b.container_status,
        b.container_type,
        b.container_status_time,
        b.tracking_number as tracking_num,
        b.manifest_id,
        b.manifest_close_time,
        ud.origin_date,
        ud.processing_date,
        ud.delivered_date,
        ud.delivered_state,
        b.cust_state,
        b.shiptoparty_key,
        b.cust_name,
        b.cust_city,
        b.cust_zipcode,
        b.wave_num,
        b.internal_shipment_num
    from base b
    left join ia_work_instruction ia on b.do_num = ia.do and b.container_id = ia.container_id
    left join ups_data ud on b.tracking_number = ud.tracking_num
)
, do_level as (
    select
        do_num,
        count(distinct tracking_num) as tracking_cnt,
        count(distinct container_id) as container_cnt,
        count(distinct manifest_id) as manifest_cnt,
        count(distinct date_trunc('day', try_to_timestamp(delivered_date))) as delivered_date_cnt,
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
        case when d.tracking_cnt <= 1 then 'SINGLE_SHIPMENT'
             when d.tracking_cnt > 1 and d.delivered_date_cnt >= 1 and (d.delivered_date_cnt > 1 or d.has_null_delivered_date = 1 or d.has_null_tracking = 1) then 'SPLIT'
             when d.tracking_cnt > 1 and d.has_null_delivered_date = 0 and d.delivered_date_cnt = 1 then 'NOT_SPLIT'
             when d.tracking_cnt > 1 and d.delivered_date_cnt = 0 then 'PENDING'
        else 'UNKNOWN'
        end as split_status
    from final b
    left join do_level d on b.do_num = d.do_num
)
select
    c.*,
    case when c.split_status = 'SPLIT' then 'Y' else 'N'
         end as is_split_shipment
from classified c
order by c.do_num, c.container_status_time;
`;

app.get('/api/scale/split-shipments', async (_req, res) => {
  try {
    const rows = await executeQuery(SPLIT_SHIPMENTS_SQL);
    const data = rows.map(toFactShape);
    res.json({
      success: true,
      data,
      count: data.length,
      source: 'snowflake',
      table: 'SCI.L0.SHIPMENT_HEADER + SHIPPING_CONTAINER + IA_WORK_INSTRUCTION + UPS_TRACKING + KDB.PBI_SF.SAP_CUSTOMER_MASTER + ZSDRORDR',
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

const GEMINI_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
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
  console.log(`  GET  /api/scale/overview-kpis        SHIPMENT_HEADER (90d KPIs)`);
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
  console.log(`\n  ── Utility ──`);
  console.log(`  GET  /api/health                     Health check`);
  console.log(`  POST /api/snowflake/test             Test connection`);
  console.log(`  GET  /api/snowflake/config           Current config`);
  console.log(`  POST /api/kdc/query                  Custom SELECT`);
  console.log('');
});
