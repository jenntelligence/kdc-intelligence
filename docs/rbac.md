# RBAC — Role-Based Access Control

## Roles

### Admin (red badge)
Full system access. Typically: Supply Chain Director, Operations VP, IT Admin.

- View all 11 dashboards
- Edit SLA targets per stage
- Edit KPI targets (OTD%, Split%, etc.)
- View and export audit log
- Upload CSV data (and reset to mock in prototype)
- Contact customers via pre-drafted notifications
- Factory reset configuration

### Manager (amber badge)
Operational execution role. Typically: DC Manager, CS Supervisor, Shift Lead.

- View all 10 operational dashboards (no admin panel)
- SLA targets visible but **read-only**
- Upload CSV data
- Contact customers via pre-drafted notifications
- Cannot reset mock data

### Viewer (blue badge)
Read-only observability. Typically: Finance, Executives (non-ops), Analysts.

- View 4 dashboards only: Executive, SLA Timeline, Geographic, Root Cause
- No CSV upload
- No customer contact actions
- No SLA edits

## Page Permission Matrix

| Page                | Admin | Manager | Viewer |
|---------------------|-------|---------|--------|
| Executive           | ✓     | ✓       | ✓      |
| AI Risk & Alerts    | ✓     | ✓       | ✗      |
| Split Shipments     | ✓     | ✓       | ✗      |
| SLA Timeline        | ✓     | ✓       | ✓      |
| Geographic          | ✓     | ✓       | ✓      |
| Root Cause          | ✓     | ✓       | ✓      |
| $ at Risk           | ✓     | ✓       | ✗      |
| Customer Impact     | ✓     | ✓       | ✗      |
| SKU Problems        | ✓     | ✓       | ✗      |
| Shift Heatmap       | ✓     | ✓       | ✗      |
| Admin · SLA Config  | ✓     | ✗       | ✗      |

## Capability Flags

| Capability          | Admin | Manager | Viewer |
|---------------------|-------|---------|--------|
| canEditSLA          | ✓     | ✗       | ✗      |
| canUploadData       | ✓     | ✓       | ✗      |
| canResetData        | ✓     | ✗       | ✗      |
| canContactCustomer  | ✓     | ✓       | ✗      |

## Prototype Implementation

In `src/ShippingSLAApp.jsx`, roles are defined in the `ROLES` constant:

```js
const ROLES = {
  admin:   { pages: [...all 11...], canEditSLA: true, canUploadData: true, ... },
  manager: { pages: [...10...],     canEditSLA: false, ... },
  viewer:  { pages: [...4...],      canEditSLA: false, canUploadData: false, ... },
};
```

Demo accounts are in `MOCK_USERS`. Replace both with Okta group mapping for production (see architecture.md).

## Production Auth Plan

1. **Okta groups → roles mapping:**
   - `kdc-sla-admin` → Admin
   - `kdc-sla-manager` → Manager
   - `kdc-sla-viewer` → Viewer (default for everyone in `kdc-employees`)

2. **JWT claims to trust:**
   - `sub` — Okta user ID
   - `groups` — array of group memberships
   - `email` — for audit logging

3. **Server-side enforcement:**
   - Every API route decorated with `@require_role('admin')` or similar
   - Don't rely on client-side gating alone — the UI hides pages, but the API must also refuse them

4. **Audit logging (for SOX / compliance):**
   - Log every SLA change: `user_id`, `field`, `old_value`, `new_value`, `timestamp`, `reason`
   - Log every customer notification sent: `user_id`, `shipment_id`, `channel` (email/sms), `timestamp`
   - Retain 7 years

## Edge Cases

- **User logs in but has no matching group:** Default to Viewer role with a warning banner.
- **Group membership changes mid-session:** Token refresh (every 15 min) picks up the change on next refresh.
- **Admin removes their own admin role:** Blocked — must be done by another admin.
- **No admins exist:** Break-glass process — IT Ops can restore via direct DB update with ticket approval.
