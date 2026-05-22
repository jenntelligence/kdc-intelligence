// Refactor baseline snapshot — Playwright-driven capture of Overview / Geo /
// AIRisk / Split pages into snapshots/<page>-<suffix>.json. Run with:
//   node scripts/snapshot-baseline.mjs before
//   node scripts/snapshot-baseline.mjs after-r1
// Headless: false so you can watch the run. Login uses admin/admin123 from
// MOCK_USERS (src/ShippingSLAApp.jsx:5205). Pages are clicked by sidebar
// label since the buttons have no data-page attribute.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SNAPSHOT_DIR = path.join(repoRoot, 'snapshots');

const APP_URL = 'http://localhost:5173';
const LOGIN_USER = 'admin';
const LOGIN_PASS = 'admin123';

// Sidebar label → snapshot filename slug. Labels match ALL_PAGES in
// src/ShippingSLAApp.jsx:5328 (Executive + Shipping categories).
const PAGES_TO_CAPTURE = [
  { label: 'Overview',        slug: 'overview' },
  { label: 'Geographic',      slug: 'geo' },
  { label: 'AI Risk & Alerts', slug: 'airisk' },
  { label: 'Split Shipments', slug: 'split' },
];

// Capture wrapper installed before any page script runs. Pushes any
// console.log starting with "[useSplitShipments]" into window.__hookCapture
// so the snapshot can include the hook's payload (rows / uniqueDOs /
// channelDistribution / splitStatusDistribution). In mock mode the hook
// doesn't log, so __hookCapture stays empty — snapshot falls back to
// DOM-only data.
const INIT_SCRIPT = `
  window.__hookCapture = [];
  const __origLog = console.log.bind(console);
  console.log = function (...args) {
    try {
      if (typeof args[0] === 'string' && args[0].includes('[useSplitShipments]') && args[1] && typeof args[1] === 'object') {
        window.__hookCapture.push({
          ts: new Date().toISOString(),
          url: location.href,
          payload: args[1],
        });
      }
    } catch (_) { /* never let capture wrapper break the app */ }
    return __origLog(...args);
  };
`;

// Snapshot code — same logic as the manual paste snippet, minus the
// clipboard write (Playwright context has no clipboard permission by
// default). Returns a plain object that page.evaluate() serializes back
// to the Node side.
const SNAPSHOT_CODE = `(() => {
  const text = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;

  // KPI cards — anchor on the unique value class signature
  const kpiAnchors = document.querySelectorAll(
    '.font-mono.text-xl.font-semibold.tracking-tight'
  );
  const kpis = Array.from(kpiAnchors).map((valueEl) => {
    const card = valueEl.closest('.rounded-md.p-3.h-full');
    if (!card) return null;
    const labelEl = card.querySelector(
      '.text-\\\\[10px\\\\].uppercase.tracking-\\\\[0\\\\.1em\\\\]'
    );
    const unitEl = valueEl.querySelector('span.text-xs');
    const valueClone = valueEl.cloneNode(true);
    valueClone.querySelectorAll('span').forEach((s) => s.remove());
    const deltaEl = card.querySelector(
      '.font-mono.text-\\\\[11px\\\\].mt-1 span.truncate'
    );
    const delta2El = card.querySelector(
      '.font-mono.text-\\\\[10px\\\\].mt-0\\\\.5 span.truncate'
    );
    return {
      label:  text(labelEl),
      value:  text(valueClone),
      unit:   text(unitEl),
      delta:  text(deltaEl),
      delta2: text(delta2El),
    };
  }).filter(Boolean);

  // SectionCards
  const sectionTitles = document.querySelectorAll(
    '.text-\\\\[12px\\\\].font-semibold.uppercase.tracking-\\\\[0\\\\.08em\\\\]'
  );
  const sections = Array.from(sectionTitles).map((titleEl) => {
    const card = titleEl.closest('.rounded-md.p-4');
    const headerWrap = titleEl.parentElement;
    const subEl = headerWrap?.querySelector('.text-\\\\[11px\\\\].font-mono');
    const tagEl = card?.querySelector(
      '.text-\\\\[10px\\\\].font-mono.text-\\\\[\\\\#1ABC9C\\\\]'
    );
    return {
      title:    text(titleEl),
      subtitle: text(subEl),
      tag:      text(tagEl),
    };
  });

  // Tables
  const tables = Array.from(document.querySelectorAll('table.w-full')).map((t, i) => {
    const headers = Array.from(t.querySelectorAll('thead th, thead td'))
      .map((th) => text(th));
    const bodyRows = Array.from(t.querySelectorAll('tbody tr'));
    const rowCells = (tr) => Array.from(tr.cells).map((c) => text(c));
    return {
      index: i,
      headers,
      rowCount: bodyRows.length,
      firstRow: bodyRows[0] ? rowCells(bodyRows[0]) : null,
      lastRow: bodyRows.length > 1 ? rowCells(bodyRows[bodyRows.length - 1]) : null,
    };
  });

  // Most recent hook capture for this URL (newest first), or null
  const captures = (window.__hookCapture || []).slice().reverse();
  const cap = captures.find((c) => c.url === location.href) || captures[0] || null;

  return {
    meta: {
      url: location.href,
      timestamp: new Date().toISOString(),
      pageTitle: document.title,
      capturesAvailable: (window.__hookCapture || []).length,
    },
    hookData: cap ? {
      capturedAt: cap.ts,
      url: cap.url,
      rows: cap.payload.rows,
      uniqueDOs: cap.payload.uniqueDOs,
      filter: cap.payload.filter,
      channelDistribution: cap.payload.channelDistribution,
      splitStatusDistribution: cap.payload.splitStatusDistribution,
    } : null,
    kpis,
    sections,
    tables,
    summary: {
      kpiCount: kpis.length,
      sectionCount: sections.length,
      tableCount: tables.length,
      hookCaptured: !!cap,
    },
  };
})()`;

// Helper — wait for the page's loading guard to release. Three signals:
//   1. "Loading shipment data…" placeholder gone from DOM
//   2. AND at least one of: KPI value rendered / section card present /
//      data table present (i.e., real content)
// Falls back to a generous timeout for slow pages like Split which fires
// two useSplitShipments calls in parallel (~10s combined).
async function waitForPageReady(page, _baselineCaptureCount, timeoutMs = 30000) {
  await page.waitForFunction(
    () => {
      // Loading guard must be gone
      const bodyText = document.body.textContent || '';
      // Cover all three placeholder variants used by the page loading
      // guards: Overview/Geo "Loading shipment data…", Split
      // "Loading split-shipment data…", AIRisk "Loading live shipment
      // data for AI analysis…". All page returns include the word
      // "Loading" + "shipment" so a single substring check catches them.
      if (/Loading[^.]*shipment/i.test(bodyText)) {
        return false;
      }
      // And at least one signal of real content
      const kpiAnchors  = document.querySelectorAll('.font-mono.text-xl.font-semibold.tracking-tight');
      const sectionCards = document.querySelectorAll('.rounded-md.p-4');
      const tables      = document.querySelectorAll('table.w-full');
      return kpiAnchors.length > 0 || sectionCards.length > 0 || tables.length > 0;
    },
    null,
    { timeout: timeoutMs }
  ).catch(() => null);
  // Settling delay for chart redraws + any post-load useMemos
  await page.waitForTimeout(2000);
}

async function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function main() {
  const suffix = process.argv[2] || 'before';
  if (!/^[\w.-]+$/.test(suffix)) {
    console.error(`Invalid suffix "${suffix}". Use letters, digits, hyphen, underscore, dot only.`);
    process.exit(1);
  }

  await ensureDir(SNAPSHOT_DIR);

  // Use the system-installed Google Chrome via Playwright's "channel"
  // option — avoids the bundled Chromium download which fails on networks
  // with SSL inspection (UNABLE_TO_VERIFY_LEAF_SIGNATURE). Channel
  // 'chrome' uses C:\Program Files\Google\Chrome\Application\chrome.exe.
  console.log(`Launching system Chrome (headless: false)…`);
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Install hook capture before any page script runs
  await context.addInitScript(INIT_SCRIPT);

  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('  [page error]', err.message));
  page.on('console', (msg) => {
    const t = msg.type();
    // DIAGNOSE: capture all console output, including info/log
    if (t === 'error' || t === 'warning' || t === 'log') {
      const text = msg.text();
      // Skip noisy ResponsiveContainer warning
      if (text.includes('ResponsiveContainer')) return;
      console.error(`  [console ${t}]`, text.slice(0, 200));
    }
  });
  // Track every request to localhost:3001 so we can see if the hook fetch
  // reaches the API and what happens to it.
  page.on('request', (req) => {
    if (req.url().includes('localhost:3001')) {
      console.log(`  [→ API] ${req.method()} ${req.url()}`);
    }
  });
  page.on('response', (resp) => {
    if (resp.url().includes('localhost:3001')) {
      console.log(`  [← API] ${resp.status()} ${resp.url()}`);
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('localhost:3001')) {
      console.error(`  [✗ API] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    }
  });

  console.log(`Navigating to ${APP_URL}…`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

  // Login flow — fill admin/admin123 and submit. If session was persisted
  // we'd skip login, but a fresh Playwright context has empty localStorage
  // so the login screen always shows.
  console.log('Logging in as admin/admin123…');
  await page.getByRole('textbox').first().fill(LOGIN_USER);
  await page.locator('input[type="password"]').first().fill(LOGIN_PASS);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();

  // Post-login: app lands on Overview by default. Wait for the topbar
  // menu (hamburger) button — its lucide-menu SVG is the most reliable
  // signal that the main UI shell has rendered.
  const menuButton = page.locator('button:has(svg.lucide-menu)').first();
  await menuButton.waitFor({ state: 'visible', timeout: 10000 });
  console.log('Logged in.');

  // First post-login wait: Overview's useSplitShipments has likely already
  // fired, but give it a moment for any in-flight fetches to settle.
  await page.waitForTimeout(2000);

  const results = [];
  for (const { label, slug } of PAGES_TO_CAPTURE) {
    console.log(`\nCapturing "${label}" → ${slug}-${suffix}.json`);
    const baselineCount = await page.evaluate(() => (window.__hookCapture || []).length);

    // The sidebar is a transform-hidden drawer (-translate-x-full when
    // closed), so its buttons are in the DOM but outside the viewport.
    // Open the drawer via the topbar menu button, then click the page
    // label. The page click handler auto-closes the drawer (line 8577).
    await menuButton.click();
    // Wait for the drawer to slide in — the favorites/Executive group
    // header becomes visible once the sidebar is open.
    await page.waitForSelector('text="Executive"', { state: 'visible', timeout: 5000 });

    // Sidebar may render two buttons with the same label (favorites pin
    // + main group); .first() picks whichever is at the top of the DOM.
    // Either click sets activePage identically.
    await page.getByRole('button', { name: label, exact: true }).first().click();

    await waitForPageReady(page, baselineCount);

    // Diagnostic: capture screenshot + DOM probe so we can see why an
    // empty snapshot happens.
    await page.screenshot({
      path: path.join(SNAPSHOT_DIR, `_debug-${slug}-${suffix}.png`),
      fullPage: true,
    });
    const probe = await page.evaluate(() => {
      const all = (sel) => document.querySelectorAll(sel).length;
      return {
        bodyTextLength: document.body.textContent.length,
        anyKpiAnchor: all('.font-mono.text-xl.font-semibold.tracking-tight'),
        anyRoundedP3: all('.rounded-md.p-3'),
        anyRoundedP4: all('.rounded-md.p-4'),
        anyTable: all('table'),
        anySectionTitleTracking08: all('.tracking-\\[0\\.08em\\]'),
        anyKpiLabelTracking1: all('.tracking-\\[0\\.1em\\]'),
        h1Texts: Array.from(document.querySelectorAll('h1, h2, h3'))
          .slice(0, 5)
          .map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
        firstButtonTexts: Array.from(document.querySelectorAll('button'))
          .slice(0, 5)
          .map((b) => b.textContent.replace(/\s+/g, ' ').trim().slice(0, 50)),
      };
    });
    console.log('  [debug probe]', JSON.stringify(probe));

    const snapshot = await page.evaluate(SNAPSHOT_CODE);
    const outFile = path.join(SNAPSHOT_DIR, `${slug}-${suffix}.json`);
    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
    const bytes = fs.statSync(outFile).size;
    console.log(
      `  → kpis=${snapshot.summary.kpiCount} ` +
      `sections=${snapshot.summary.sectionCount} ` +
      `tables=${snapshot.summary.tableCount} ` +
      `hook=${snapshot.summary.hookCaptured ? 'yes' : 'NO'} ` +
      `bytes=${bytes}`
    );
    results.push({ slug, file: outFile, ...snapshot.summary });
  }

  await browser.close();
  console.log('\nAll captures complete.');
  console.table(results);
}

main().catch((err) => {
  console.error('Snapshot run failed:', err);
  process.exit(1);
});
