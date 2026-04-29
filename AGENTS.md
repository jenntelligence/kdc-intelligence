# AGENTS.md — Rules for AI Agents Working on This Project

This file complements `CLAUDE.md`. It does **not** replace it. Read both before
making changes.

`CLAUDE.md` covers code standards, color tokens, RBAC structure, and "what not
to do." This file adds the **Harness Engineering workflow rules** — the
process you must follow around any non-trivial change.

---

## Harness Workflow Rules

### 1. Plan before you code (non-trivial changes only)

Before writing or modifying code for anything beyond a trivial fix
(typo, single-line bug, copy tweak), write an exec plan:

- Location: `docs/exec-plans/active/NNN-<slug>.md`
- Use the next sequential number (`001-`, `002-`, ...).
- The plan must state: goal, scope, out-of-scope, files touched, verification
  steps, rollback.

A "trivial fix" means: changing a label, fixing a typo, adjusting a color
constant, swapping a hardcoded value already in scope. Anything that adds a
component, changes a data flow, introduces a dependency, or touches more
than one logical area is **not trivial** and needs a plan.

### 2. Read core beliefs before writing the plan

Before drafting any exec plan, read `docs/design-docs/core-beliefs.md`
in full. Verify the plan does not conflict with the principles. If it does,
either revise the plan or — if the principle itself is wrong — propose an
amendment to core-beliefs.md as a separate change *before* proceeding.

### 3. Move plans to `completed/` when done

When the work in an exec plan is finished and verified, move the file:

```
docs/exec-plans/active/NNN-<slug>.md  →  docs/exec-plans/completed/NNN-<slug>.md
```

Do **not** delete completed plans. They are the project's decision log.

### 4. Track new tech debt as you find it

If you discover technical debt while working — code smells, missing tests,
hardcoded secrets, broken assumptions, schema drift — add an entry to
`docs/exec-plans/tech-debt-tracker.md` with priority (P0/P1/P2). Do not
silently fix it inside an unrelated plan; that scope creep makes the change
harder to review.

### 5. Snowflake is the primary backend data source. The API layer uses an adapter pattern so additional sources can be added when an exec plan requires them — see core-beliefs.md §1.

Both SCALE (WMS) and SAP (ERP) data live in Snowflake — pre-consolidated by
the upstream data team. The frontend must never connect to SAP or SCALE
directly. All SAP↔SCALE joins happen in Snowflake SQL, not in the frontend.
See `ARCHITECTURE.md` for the full reasoning.

If you find code that bypasses Snowflake (direct SAP API call, direct SCALE
DB connection), flag it as P0 tech debt — do not extend that pattern.

---

## Code Standards (carried over from CLAUDE.md — keep enforcing)

- **No TypeScript** — JSX only until explicitly asked to migrate.
- **Tailwind only** — no CSS modules, styled-components, or other CSS
  frameworks.
- **Functional components + hooks** — no class components.
- **Recharts** for all charts. No D3. No Chart.js.
- **lucide-react** for all icons.
- **IBM Plex Sans + IBM Plex Mono** typography (already imported in the
  component via Google Fonts).
- React state is fine for this scope — no Redux/Zustand/Jotai.
- Color tokens are defined in CLAUDE.md — use those exact values.

---

## Database safety rule — Snowflake is read-only from this codebase

This rule is non-negotiable and applies to every AI agent and human
working in this repo, regardless of intent or context.

### Always allowed (read-only operations)
- `SELECT` (including `WITH ... SELECT`)
- `SHOW`, `DESCRIBE`, `EXPLAIN`
- `INFORMATION_SCHEMA` queries

### Never allowed from this codebase
- `INSERT`, `UPDATE`, `DELETE`, `MERGE`
- `CREATE`, `DROP`, `ALTER`, `TRUNCATE`
- `CALL` (stored procedures — including any `KISS_EXP_*`)
- `COPY INTO`, `GRANT`, `REVOKE`
- Any DDL or DML against production tables

### Why
The Snowflake `SCI` database holds production shipping data for KDC/KISS
Savannah, replicating live SCALE WMS and SAP ERP state. SCALE's stored
procedures (e.g., `KISS_EXP_UploadShipmentBefore`) and SAP's interfaces
already manage this data — any write from this codebase risks data
corruption or out-of-sync state with the upstream systems.

This codebase is a *consumer* of Snowflake, not a writer. If a future
exec plan genuinely requires creating a view, table, or running a
procedure, that requires a separate, explicitly user-approved exec plan
in `docs/exec-plans/active/` — never inline in another task.

### Enforcement
- `server.js` already enforces SELECT-only on `/api/kdc/query`
  (line 653: `/^\s*SELECT/i`).
- All new endpoints and direct `executeQuery()` calls follow the same rule.
- If an AI agent encounters a task that seems to require a write,
  STOP and ask the user. Do not generate the write SQL "for review."

---

## What NOT to Do (carried over from CLAUDE.md)

- Don't replace Tailwind with another CSS framework.
- Don't add Redux/Zustand/Jotai — React state is fine for this scope.
- Don't add a backend in the prototype unless the user has explicitly
  decided to (see the relevant exec plan).
- Don't remove the mock data generator — it's the fallback when no
  CSV is loaded and when Snowflake is unreachable.
- Don't change the RBAC role structure (Admin / Manager / Viewer) without
  the user's approval.
- Don't "clean up" the admin SLA config page — it is intentionally
  feature-complete.
- Don't refactor `src/ShippingSLAApp.jsx` unprompted. The user will tell
  you what to change.

---

## Verification

After any change:

```bash
npm run build
```

If it builds clean, you're good. If not, fix the errors before reporting
the work as done. Do not ship a red build.

---

**This file does not replace CLAUDE.md — it complements it. Read both.**
