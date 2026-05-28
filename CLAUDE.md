# Instructions for Claude Code

You are helping build the KDC Operations Intelligence dashboard — a React + Express
application for warehouse/shipping operations at KDC/KISS Savannah, GA.

## Your First Task

When the user opens this project and asks you to "set it up" or "get it running":

### 1. Verify Node version
```bash
node --version
```
Need Node 20+. If older, stop and tell the user to upgrade.

### 2. Install dependencies
```bash
npm install
```

### 3. Start both servers
```bash
npm run server  # Express + Snowflake on :3001
npm run dev     # Vite frontend on :5173
```

The app starts at `http://localhost:5173`. Sign in with `admin / admin123`.

### 4. Do not modify `src/ShippingSLAApp.jsx` unless explicitly asked
It's a 7,752-line component containing 23 page components. After R1-R3 refactors,
constants/data/utils/components/hooks are extracted to dedicated folders, but the
page components themselves remain in this file. Don't refactor or "improve"
unprompted.

---

## Project Context

**Business domain:** CPG cosmetics/beauty supply chain. KDC is a 3PL running
Manhattan Active SCALE (WMS) integrated with SAP (ERP).

**Company brands on the floor:** Kiss, Red, Ivy, Vivace (all KISS Beauty Group).

**Key pain points the dashboard addresses:**
- Shipping delays (UPS-caused / DC-caused / Missing product / Damage / Other)
- Split shipments (customer hard requirement: all cartons same day)
- SAP ↔ SCALE inventory discrepancies (3-layer: system / TPA / physical-vs-system)
- Backorder visibility ($-at-risk + SKU drill-down)
- Customer service needs proactive notifications when orders will be late
- Executive team wants $-at-risk visibility

**Current architecture:** React SPA + Express API + Snowflake live data.
**Production target:** See `docs/architecture.md`.

---

## Codebase Layout (post R1-R3 refactor)

```
src/
├── ShippingSLAApp.jsx        # 7,752 lines, 23 page components
├── constants/                 # channels, leadTimes, rootCauses, geo, presets, auth, pageMocks
├── data/mockShipments.js      # Mock data generator (fallback when Snowflake unreachable)
├── utils/                     # dates, format, channels, leadTime, risk, serverRows
├── components/common/         # KPI, SectionCard, SearchableDropdown, AccessDenied, AiChatPanel
└── hooks/useSplitShipments.js # Live data fetch + mock fallback

server.js                      # Express + Snowflake SDK (2,025 lines)
docs/                          # architecture, data-model, roadmap, design-docs, exec-plans, references
docs/PROJECT_KNOWLEDGE.md      # Deep onboarding reference (read this first)
memory/                        # Session memory + backlog (gitignored)
scripts/snapshot-baseline.mjs  # Playwright regression tool
```

---

## Data Layer

- **Frontend ↔ Backend**: 3 live pages (Overview, Geographic, Split) share
  `useSplitShipments(dateRange, customRange)` hook. Hook fetches `/api/scale/split-shipments`,
  adapts via `serverRowsToShipments`, falls back to mock generator on failure.
- **Backend ↔ Snowflake**: `server.js` connects via RSA key-pair (`SNOWFLAKE_JWT`).
  Externalbrowser SSO is NOT supported at KDC. Requires `SNOWFLAKE_PRIVATE_KEY_PATH`
  env var pointing to a PKCS#8 `.p8` file.
- **Snowflake is read-only.** No INSERT/UPDATE/DELETE/MERGE/CALL/DDL. Production data
  is written by upstream `KISS_EXP_*` stored procedures. See `docs/design-docs/core-beliefs.md` §8.

For domain invariants (timezone, padding, CTE fan-out), hidden dependencies, and
common mistake patterns, **read `docs/PROJECT_KNOWLEDGE.md`** before any non-trivial change.

---

## Code Standards

- **No TypeScript.** Keep JSX until explicitly asked to migrate.
- **Tailwind only** for styling. No CSS modules, no styled-components.
- **Functional components + hooks.** No class components.
- **Recharts** for charts. No D3, no Chart.js.
- **lucide-react** for icons.
- **IBM Plex Sans + IBM Plex Mono** typography (imported via Google Fonts).
- **Extract patterns**: when files grow, split by *layer* (constants/data/utils/
  components/hooks) — NOT by page. The page components themselves stay in
  `ShippingSLAApp.jsx` for now.

## Color System

Two coexisting palettes — both heavily used (verified via grep).

**Dark theme scaffolding** (backgrounds, text, borders — body style + scrollbar in `src/index.css`):
```
bg-primary     #0f1419
bg-panel       #1a2129
bg-panel-alt   #232c37
border         #2d3744
text-primary   #e8ecef
text-secondary #8a95a3
text-muted     #5d6b7a
accent-blue    #4a9eff
green          #3ecf8e
amber          #f5a623
red            #ef4444
purple         #a78bfa
```

**Hark brand palette** (charts, KPI accents, channel pills):
```
Cerise        #E74C6F   (UPS cause, alerts)
Turquoise     #1ABC9C   (CS group, Damage, success)
Persian Blue  #2C3E9B   (BS group fallback)
Green         #2ECC71   (AST group)
Sky Blue      #3498DB   (DC cause, IIO group)
Purple        #8E44AD   (Missing cause, ECOM group)
Navy          #1B2A4A   (KIO group)
```

**Live channel brand overrides** (3 wired channels):
```
BS-IVY  #0033A0   (Pantone 286 C — Trust Blue)
BS-RED  #BF0D3E   (Pantone 193 C)
VIVACE  #E87149   (Pantone 4011 C)
```

Cause colors: UPS=cerise, DC=sky-blue, Missing=purple, Damage=turquoise, Other=gray.

CSS variables (`var(--bg-primary)` etc.) are used inside extracted components
for theme awareness — already wired, don't refactor.

---

## When the User Asks for Changes

**Dashboard tweaks**: work inside the relevant `*Page` component in
`src/ShippingSLAApp.jsx`. Use grep to locate (e.g. `const OverviewPage` at line 50,
`const SplitShipmentPage` at line 2094).

**Live wiring**: 3 pages already consume Snowflake via `useSplitShipments`
(Overview, Geographic, Split). When wiring a new page to live data, mirror the
existing pattern — page-local `liveMetrics` useMemo, `onMetaChange` callback for
the App header, mock-only fields rendered as `'—'`. See
`docs/PROJECT_KNOWLEDGE.md` § "Live Page 표준 구조".

**SQL changes**: When adding columns to the master query (`server.js:1095-1247`),
you MUST also update `src/utils/serverRows.js` (the only server↔mock bridge).
Skipping the adapter = silent null in 3+ pages.

**New backend endpoints**: Add to `server.js`. Echo the new route in the
boot stdout list near line 30 so future developers can discover it without
grepping.

**Breaking things up**: Layer-based extraction (constants/data/utils/components/
hooks). Don't split by page yet — the App.jsx orchestration relies on inline
co-location.

---

## What NOT to Do

- Don't replace Tailwind with another CSS framework
- Don't add Redux/Zustand/Jotai — React state is fine for this scope
- Don't remove the mock data generator — fallback when Snowflake is unreachable
- Don't change the RBAC role structure without the user's approval
- Don't "clean up" the admin SLA config page — it's intentionally feature-complete
- Don't issue Snowflake writes — read-only is enforced (`docs/design-docs/core-beliefs.md` §8)
- Don't bypass `LTRIM` for so_num/do_num joins — `TRIM` strips both ends in Snowflake
  and silently breaks the join (PR Truck-1-Region-Fix incident)
- Don't use `setHours(0,0,0,0)` on dates parsed from `'YYYY-MM-DD'` — they parse as UTC midnight,
  and `setHours` shifts to the previous day in non-UTC zones. Use `setUTCHours` /
  `setUTCDate` / `getUTCDay`.
- Don't auto-commit. Wait for the user's explicit "go" signal.

---

## Verifying Your Work

After any change:
```bash
npm run build      # must build clean
```

For UI work that touches a live page, also browser-load and confirm the visible
counts match endpoint counts (data-wiring PRs slip through endpoint smoke +
build alone — see `docs/PROJECT_KNOWLEDGE.md` § Mistake pattern #1).

For regression testing:
```bash
node scripts/snapshot-baseline.mjs
```

---

## Onboarding Reference

`docs/PROJECT_KNOWLEDGE.md` (349 lines) — generated from the user-level Claude skill.
Contains:
- 23-page component map with line numbers
- Domain invariants (UTC timezone, LTRIM padding, CTE fan-out)
- Hidden dependencies (`getExpectedDeliveryDate` 4+ pages, `useSplitShipments` 3 pages)
- 6 common mistake patterns with reproduction context
- Historical decisions (tbd states, ★ markers, LIVE_SPLIT scope)
- Debugging tips + dangerous code zones
- Current backlog

**Read it before any non-trivial change.**
