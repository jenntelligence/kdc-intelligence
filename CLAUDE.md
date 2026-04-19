# Instructions for Claude Code

You are helping build the KDC Shipping SLA Command Center — a React dashboard for warehouse/shipping operations at KDC/KISS Savannah, GA.

## Your First Task

When the user opens this project and asks you to "set it up" or "get it running," do the following in order:

### 1. Verify Node version
```bash
node --version
```
Need Node 20+. If older, stop and tell the user to upgrade.

### 2. Install all dependencies
```bash
npm install
```

### 3. Confirm the prototype renders
```bash
npm run dev
```

The app should start on `http://localhost:5173`. Tell the user to open it and sign in with `admin / admin123`.

### 4. Do not modify `src/ShippingSLAApp.jsx` unless explicitly asked
It's a 2,772-line production-quality prototype. The user will tell you what they want changed. Don't refactor or "improve" it unprompted.

---

## Project Context

**Business domain:** CPG cosmetics/beauty supply chain. KDC is a 3PL running Manhattan Active SCALE (WMS) integrated with SAP (ERP).

**Company brands on the floor:** Kiss, Red, Ivy, Vivace (all KISS Beauty Group).

**Key pain points the dashboard addresses:**
- Shipping delays (UPS-caused / DC-caused / Missing product / Damage / Other)
- Split shipments (customer hard requirement: all cartons same day — frequently violated)
- SAP ↔ SCALE inventory discrepancies (three-layer problem: system mismatch, TPA confirmation gaps, physical vs system)
- Customer service needs proactive notifications when orders will be late
- Executive team wants $-at-risk visibility

**Architecture today:** Single-file React prototype with mock data + CSV upload.
**Architecture target:** See `docs/architecture.md`.

---

## Code Standards

- **No TypeScript** in the prototype. Keep it JSX until explicitly asked to migrate.
- **Tailwind only** for styling. No CSS modules, no styled-components.
- **Functional components + hooks.** No class components.
- **Recharts** for all charts. Don't introduce D3 or Chart.js.
- **Lucide-react** for all icons.
- **IBM Plex Sans + IBM Plex Mono** typography (imported via Google Fonts inside the component).

## Color Tokens (dark theme)

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

Cause colors: UPS=red, DC=amber, Missing=purple, Damage=blue, Other=gray.
Channel groups: CS=blue, BS=purple, ECOM=red, VIVACE=amber, AST=green, IIO=orange, KIO=cyan.

---

## When the User Asks for Changes

**Dashboard tweaks:** Work directly in `src/ShippingSLAApp.jsx`. Components are organized by page (AIRiskPage, SplitShipmentPage, etc.) — find the right one.

**New features:** Follow the existing pattern — add a page component above `MAIN APP`, wire it into the role-gated page render block, add a tab in the tab list.

**Real data connection:** See `docs/architecture.md` for the planned API layer. Don't start that without the user explicitly asking.

**Breaking things up:** If the user asks to split the monolithic file into modules, split by page component — each `*Page` becomes its own file under `src/pages/`.

---

## What NOT to Do

- Don't replace Tailwind with another CSS framework
- Don't add Redux/Zustand/Jotai — React state is fine for this scope
- Don't add a backend in the prototype (the user will explicitly decide when)
- Don't remove the mock data generator — it's the fallback when no CSV is loaded
- Don't change the RBAC role structure without the user's approval
- Don't "clean up" the admin SLA config page — it's intentionally feature-complete

---

## Verifying Your Work

After any change, run:
```bash
npm run build
```

If it builds clean, you're good. If not, fix the errors before telling the user it's done.
