# KDC Shipping SLA Command Center

Operational dashboard for KDC/KISS Savannah, GA — shipping status, delay root cause, split-shipment compliance, AI-driven risk prediction, and $-at-risk tracking. Pulls from SAP (ERP) + Manhattan Active SCALE (WMS) + UPS/carrier feeds.

---

## Quick Start for Claude Code

Open this folder in VS Code, then run Claude Code. Point it at this README and say:

> "Read README.md and CLAUDE.md, then set up the project per the instructions."

Claude Code will:
1. Install dependencies
2. Scaffold the Vite + React + Tailwind app
3. Drop in the existing `ShippingSLAApp.jsx` prototype component
4. Wire up the dev server

Then run `npm run dev` and you're live.

---

## Manual Setup (if not using Claude Code)

**Prerequisites:** Node.js 20+, npm 10+

```bash
npm create vite@latest . -- --template react
npm install
npm install recharts lucide-react
npm install -D tailwindcss@^3 postcss autoprefixer
npx tailwindcss init -p
```

Then copy the contents of `src/ShippingSLAApp.jsx` into your project and replace `src/App.jsx` with:

```jsx
import ShippingSLAApp from './ShippingSLAApp.jsx';
export default function App() { return <ShippingSLAApp />; }
```

Edit `src/index.css` to contain the three Tailwind directives (see `docs/setup.md`).

Run:

```bash
npm run dev
```

---

## What's in this repo

```
kdc-shipping-sla/
├── README.md                          ← You are here
├── CLAUDE.md                          ← Claude Code instructions (auto-loaded)
├── package.json                       ← Dependencies
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── src/
│   ├── main.jsx                       ← React entry
│   ├── App.jsx                        ← Mounts ShippingSLAApp
│   ├── ShippingSLAApp.jsx             ← ⭐ The full prototype (2,772 lines)
│   └── index.css                      ← Tailwind directives
├── public/
│   └── sample-data.csv                ← Sample CSV matching FactShipment schema
└── docs/
    ├── setup.md                       ← Manual setup steps
    ├── architecture.md                ← Production architecture plan
    ├── data-model.md                  ← FactShipment schema + relationships
    ├── rbac.md                        ← Role definitions (Admin/Manager/Viewer)
    └── roadmap.md                     ← Phased build plan to production
```

---

## Prototype Features (already built)

**Dashboards (10 tabs):**
1. Executive Summary — KPIs, AI watchlist banner, cause mix, trend
2. AI Risk & Alerts — predictive scoring for open orders, CS notification drafts
3. Split Shipments — tracks customer hard requirement (all cartons same day)
4. SLA Timeline — 8-stage waterfall with admin-configurable targets
5. Geographic — US tile heat map, issue-type selector, state drill
6. Root Cause — UPS / DC / Missing / Damage deep dive with fix plans
7. $ at Risk — chargebacks, annualized run-rate, channel cost mix
8. Customer Impact — health scorecard, OTD/delay/split/chargeback per customer
9. SKU Problems — composite issue score with fragile flag
10. Shift Heatmap — day × hour, plus Channel × Shift matrix

**Admin-only:**
- SLA Configuration — per-stage target editor with audit log

**Global controls:**
- Role-based auth (Admin / Manager / Viewer)
- Distribution channel multi-select (11 channels: CS, BS, VIVACE, AST, IIO, KIO, ECOM)
- Cause & region filters
- CSV upload for real data

**Demo credentials:**
- `admin` / `admin123` — full access, can edit SLAs
- `manager` / `manager123` — operational view, can contact customers
- `viewer` / `viewer123` — read-only, 4 tabs only

---

## Next Steps (see `docs/roadmap.md`)

- [ ] Phase 1 — Connect to Snowflake (SCALE) + SAP extract via API layer
- [ ] Phase 2 — Real auth (Okta SSO), persistence layer for SLA configs
- [ ] Phase 3 — Replace heuristic AI risk model with trained ML model
- [ ] Phase 4 — Email/SMS integration for CS notifications (SendGrid/Twilio)
- [ ] Phase 5 — Mobile responsive pass for DC floor supervisors

---

## License / Internal Use

Internal KDC/KISS use only. Do not distribute.
