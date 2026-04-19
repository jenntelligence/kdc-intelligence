# Production Architecture

The current prototype is a single-page React app with mock data. This doc describes how to evolve it into a production system.

## Current State (v0.1 Prototype)

```
Browser
  └── React SPA (single file, 2,772 lines)
       ├── Mock data generator (runs on every reload)
       └── CSV upload (in-memory parsing)
```

No backend, no persistence, no auth beyond client-side role gate.

## Target State (v1.0 Production)

```
┌────────────────────┐     ┌──────────────────────┐
│  React SPA (SPA)   │◄────┤  Auth: Okta SSO      │
│  - 11 dashboards   │     │  - SAML 2.0 / OIDC   │
│  - Role-gated UI   │     └──────────────────────┘
└─────────┬──────────┘
          │ HTTPS + JWT
          ▼
┌────────────────────┐     ┌──────────────────────┐
│  API Gateway       │     │  Config DB (Postgres)│
│  (FastAPI / Node)  │◄────┤  - SLA targets       │
│  - REST endpoints  │     │  - KPI thresholds    │
│  - RBAC middleware │     │  - Audit log         │
└─────────┬──────────┘     │  - User preferences  │
          │                └──────────────────────┘
          ├────────────────────┐
          ▼                    ▼
┌────────────────────┐   ┌──────────────────────┐
│  Data Service      │   │  AI Risk Service     │
│  - Snowflake reads │   │  - Scoring endpoint  │
│  - SAP extract API │   │  - Model artifact    │
│  - UPS tracking    │   │    (pickle / ONNX)   │
│  - Cache (Redis)   │   │  - Feature store     │
└─────────┬──────────┘   └──────────────────────┘
          │
          ├──► Snowflake (SCALE WMS data)
          ├──► SAP RFC / OData (SAP)
          └──► UPS / FedEx tracking APIs
```

## Component Responsibilities

### React SPA
- Render all 10 dashboards (unchanged from prototype)
- Call API instead of generating mock data
- Send JWT on every request
- Let user configure view preferences (persisted via API)

### API Gateway (FastAPI recommended)
- OIDC validation against Okta
- RBAC decorator on every route
- Rate limiting (100 req/min per user)
- Request logging for audit
- Response caching (Redis, 5-min TTL on dashboard queries)

### Data Service
- **Snowflake** (primary data source for shipment history from SCALE)
  - Tables needed: `shipment_header`, `shipment_detail`, `process_history`, `work_instruction`, `wave_master`, `item_balance`
  - Ref: `kdc-shipping-ops` skill for schema
- **SAP** (order/delivery data)
  - Pull `VBAK` (sales orders), `LIKP` (deliveries), `VBFA` (document flow)
  - Use SAP OData services or RFC via pyRFC
- **UPS/FedEx tracking**
  - Poll every 15 min for ship-confirmed orders
  - Store in `tracking_events` table with shipment FK

### AI Risk Service
- Initial: keep the heuristic scoring from the prototype, move server-side
- V2: train an XGBoost model on historical shipment outcomes
- Features: carrier, zone, SKU, time-of-day, current stage elapsed, weather (optional)
- Deploy as a separate FastAPI service to allow independent scaling

### Config DB (Postgres)
- `sla_targets` — per-stage target minutes with versioning
- `kpi_targets` — OTD%, split-rate%, etc.
- `audit_log` — every admin change
- `users` (optional — can lean entirely on Okta)
- `notification_templates` — CS email/SMS templates per cause type
- `notifications_sent` — log of every customer notification

## Deployment

### Dev / Staging / Prod
- **Dev:** Docker Compose locally (SPA + API + Postgres + Redis)
- **Staging:** AWS ECS Fargate, ALB, RDS Postgres, ElastiCache Redis
- **Prod:** Same as staging, but multi-AZ + WAF + CloudFront CDN for SPA

### Secrets
- AWS Secrets Manager for DB credentials, API keys, SAP RFC creds
- Okta client secret rotated quarterly

### CI/CD
- GitHub Actions
- Frontend: build → S3 sync → CloudFront invalidation
- Backend: build container → push to ECR → ECS deploy with blue/green

## Data Refresh Cadence

| Source             | Cadence      | Method              |
|--------------------|--------------|---------------------|
| SCALE shipments    | Every 5 min  | Snowflake query     |
| SAP orders         | Every 15 min | OData pull          |
| UPS tracking       | Every 15 min | Carrier API poll    |
| Historical (daily) | 2 AM nightly | Snowflake batch     |

## Scaling Notes

- Dashboard queries will fan out across 10 tabs. Pre-aggregate common metrics in Snowflake and cache in Redis.
- AI risk scoring: batch-score all open orders every 10 min; serve from cache.
- For 320 shipments/day (current KDC volume), a single ECS task handles everything. At 3,000+/day, split data service from AI service.

## Security

- JWT with 1-hour expiry, refresh tokens stored HttpOnly
- CORS locked to `https://shipping-sla.kdc.internal`
- All DB connections over TLS
- No customer PII in logs (mask email/phone)
- Audit log retention: 7 years (compliance)

## Observability

- **Metrics:** CloudWatch (API latency, error rate, DB connection pool)
- **Logs:** CloudWatch Logs with structured JSON
- **Traces:** OpenTelemetry → AWS X-Ray
- **Alerts:** PagerDuty for API 5xx spikes, DB connection exhaustion, data freshness > 30 min stale

## Migration Path from Prototype

1. **Week 1–2:** Stand up API skeleton, wire to Snowflake read-only
2. **Week 3:** Replace mock data generator with API calls
3. **Week 4:** Okta SSO integration, replace demo auth
4. **Week 5:** Persist SLA/KPI config to Postgres
5. **Week 6:** SAP extract pipeline
6. **Week 7–8:** AI risk service deployment + model training
7. **Week 9:** Notification integration (SendGrid for email, Twilio for SMS)
8. **Week 10:** Load test + security review
9. **Week 11:** Staged rollout (admins first, then managers, then viewers)
10. **Week 12:** Production cutover, deprecate prototype
