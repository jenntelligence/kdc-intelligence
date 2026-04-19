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
 * Auth: externalbrowser SSO — on first query the Snowflake SDK opens
 * a browser tab for Entra ID login. Session is reused after that.
 *
 * Usage:
 *   node server.js          # starts on API_PORT (default 3001)
 *   npm run server           # same, via package.json script
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import snowflake from 'snowflake-sdk';

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

  if (!account || !username) {
    throw new Error('Missing SNOWFLAKE_ACCOUNT or SNOWFLAKE_USERNAME');
  }

  return snowflake.createConnection({
    account,
    username,
    authenticator: 'externalbrowser',
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


// ── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  KDC Operations Intelligence — API Server`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Snowflake: ${process.env.SNOWFLAKE_ACCOUNT || 'not configured'}`);
  console.log(`  Database:  ${process.env.SNOWFLAKE_DATABASE || 'SCI'}.${process.env.SNOWFLAKE_SCHEMA || 'PUBLIC'}`);
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
  console.log(`\n  ── Utility ──`);
  console.log(`  GET  /api/health                     Health check`);
  console.log(`  POST /api/snowflake/test             Test connection`);
  console.log(`  GET  /api/snowflake/config           Current config`);
  console.log(`  POST /api/kdc/query                  Custom SELECT`);
  console.log('');
});
