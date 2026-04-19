# Roadmap to Production

## Phase 0 — Prototype (✓ Complete)

- [x] 10 dashboards with mock data
- [x] CSV upload for real data
- [x] Role-based auth (prototype)
- [x] Admin SLA config with audit log
- [x] AI risk scoring (heuristic)
- [x] Split shipment tracking
- [x] Channel filtering

## Phase 1 — Data Plumbing (Weeks 1–3)

Goal: wire to real SCALE + SAP data, remove mock dependency.

- [ ] Stand up FastAPI backend scaffold
- [ ] Snowflake connector for SCALE data
- [ ] SAP OData extract for order/delivery timestamps
- [ ] UPS tracking API poller (every 15 min cron)
- [ ] `/api/shipments` endpoint with date/channel/cause filters
- [ ] `/api/kpis` endpoint for top-strip metrics
- [ ] Swap React mock data for API calls, keep CSV upload as fallback

**Deliverable:** Dashboards show real KDC Savannah data, refreshed every 5 min.

## Phase 2 — Auth & Persistence (Weeks 4–5)

Goal: real auth, real config storage.

- [ ] Okta SSO integration (OIDC)
- [ ] Postgres schema for `sla_targets`, `kpi_targets`, `audit_log`
- [ ] Replace demo `MOCK_USERS` with Okta group mapping
- [ ] Persist SLA edits via API, remove client-state dependency
- [ ] Audit log API endpoint + view in admin panel

**Deliverable:** Real users log in with SSO, SLA edits persist across sessions.

## Phase 3 — AI Risk Model (Weeks 6–7)

Goal: replace heuristic scoring with trained ML.

- [ ] Historical shipment data pull (12 months)
- [ ] Feature engineering: carrier, zone, SKU, wave timing, current stage, weather
- [ ] Train XGBoost classifier (target: Late vs On-Time)
- [ ] Deploy as FastAPI service with `/score` endpoint
- [ ] Batch scoring: run every 10 min for all open orders
- [ ] Shadow mode first — log predictions, don't act on them, compare to actuals
- [ ] After 2 weeks shadow, flip to production

**Deliverable:** AI risk scores with measurable accuracy (target: >80% precision on High-risk flag).

## Phase 4 — CS Automation (Weeks 8–9)

Goal: close the loop on proactive customer notifications.

- [ ] SendGrid integration for email
- [ ] Twilio integration for SMS
- [ ] Notification template library (editable by admin)
- [ ] Auto-send vs manual-review toggle per customer
- [ ] Notification history view in Customer Impact page
- [ ] Escalation rules (e.g. Key Account → also email account manager)

**Deliverable:** CS team approves/sends notifications in one click.

## Phase 5 — Mobile & Polish (Weeks 10–11)

Goal: DC floor usability.

- [ ] Responsive breakpoints for tablet (DC supervisor walking the floor)
- [ ] Mobile-first Exec view (KPI cards stack vertically)
- [ ] Dark/light theme toggle
- [ ] Export-to-PDF for weekly exec report
- [ ] Keyboard shortcuts for power users

**Deliverable:** Supervisor can check status from a tablet on the floor.

## Phase 6 — Production Cutover (Week 12)

- [ ] Load test at 10x current volume
- [ ] Security review (SOC 2 controls)
- [ ] Disaster recovery test (DB restore from snapshot)
- [ ] Staged rollout: Admin cohort → Manager cohort → Viewer cohort
- [ ] Deprecate prototype URL, redirect to production
- [ ] Runbook handoff to IT Ops

**Deliverable:** Live production system, monitored, on-call rotation established.

## Post-Launch Backlog (Prioritize with users)

- Simulation workbench: "what-if" SLA scenarios
- Carrier scorecard dashboard
- Peer benchmarking (DEA across DC network)
- Slotting recommendation engine (velocity-driven)
- Chargeback reconciliation with Finance system
- Returns & reverse logistics module
- Labor planning integration (Kronos / UKG)
- Warehouse floor 3D visualization (tie to `velocity-storage-stowage` skill)

## Success Metrics (to track post-launch)

- **On-Time Delivery %** — baseline vs 6-month post-launch
- **Split-shipment rate** — trending toward 0%
- **Mean-time-to-notify customer** when a delay is predicted
- **$ chargebacks avoided** via proactive CS contact
- **Dashboard adoption** — weekly active users by role
