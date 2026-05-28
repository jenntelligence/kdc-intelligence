---
name: kdc-intelligence-project-job-skill
description: KDC Intelligence v1 (KDC Savannah, GA operations dashboard) — project memory + non-obvious conventions + hidden dependencies + common mistake patterns. Auto-invoke when working in C:/Users/hypark5/Desktop/kdc_intelligence/KDC_Intelligence_v1 or when keywords like KDC, Snowflake split shipment, BS-IVY/BS-RED/VIVACE, master query, useSplitShipments appear.
---

# KDC Intelligence v1 — Project Job Skill

> Auto-invoke when working directory matches `C:/Users/hypark5/Desktop/kdc_intelligence/KDC_Intelligence_v1` **or** when the user mentions: `KDC`, `KISS`, `Savannah`, `Snowflake split shipment`, `BS-IVY`, `BS-RED`, `VIVACE`, `master query`, `useSplitShipments`, `useExpectedDeliveryDate`, `serverRowsToShipments`.

---

## Project Overview

**KDC Intelligence v1** — KDC Savannah, GA 의 운영 모니터링 dashboard.

- **Repository**: `github.com/hypark94/kdc-intelligence` (private)
- **Working directory**: `C:/Users/hypark5/Desktop/kdc_intelligence/KDC_Intelligence_v1` (note: underscore, not hyphen)
- **Owner / decision-maker**: Hyeree Park (KDC Savannah, 운영자 + 결정자)
- **Executor**: VS Code Claude (코드 작업)

### Tech Stack
- **Frontend**: React 18 + Vite 5 + Tailwind CSS (no TypeScript, no CSS modules)
- **Backend**: Node.js + Express 5 + Snowflake SDK
- **Data Source**: Snowflake (databases: `SCI.L0`, `KDB.PBI_SF`, `SAP_BW.L0`)
  - Account: `shb67190.us-east-1`, Warehouse: `KDCGA1`
  - **Auth: RSA key-pair (`SNOWFLAKE_JWT`)**, NOT SSO. `SNOWFLAKE_PRIVATE_KEY_PATH` env var required.
- **Charts**: Recharts (no D3, no Chart.js)
- **Icons**: lucide-react
- **AI**: Google Gemini 2.5 Flash (`@google/genai`)

---

## 디렉토리 구조 (R1+R2+R3 refactor 후)

- `src/ShippingSLAApp.jsx` — main app, **7,752 줄** (R3 refactor 기준), **23 페이지 컴포넌트** (LoginPage 포함)
- `src/constants/` — channels, leadTimes, rootCauses, geo, presets, auth, pageMocks
- `src/data/mockShipments.js` — Mock 데이터 generator (`generateMockShipments`)
- `src/utils/` — Pure helpers: dates, format, channels, leadTime, risk, serverRows
- `src/components/common/` — KPI, SectionCard, SearchableDropdown, AccessDenied, AiChatPanel
- `src/hooks/useSplitShipments.js` — 유일한 custom hook (Overview / Geo / Split 3 페이지 의 single source)
- `server.js` — Express server (2,025 줄), Snowflake queries
- `scripts/snapshot-baseline.mjs` — Playwright 검증 도구
- `memory/` — Session memory + backlog (gitignored)

### 23 페이지 컴포넌트 위치
| Line | Component | Notes |
|---|---|---|
| 50 | OverviewPage | Wired to live (PR Overview-A/B) |
| 813 | GeoPage | Wired to live (PR Geo-3, Delivered-Mode) |
| 1446 | AIRiskPage | Wired to live + Gemini batch analysis |
| 2094 | SplitShipmentPage | Wired to live (PR4b2) |
| 3173 | CostsPage | Mock |
| 3308 | CustomerImpactPage | Mock |
| 3411 | SKUProblemPage | Mock |
| 3505 | ShiftHeatmapPage | Mock |
| 3681 | SnowflakeSettingsPage | Mock |
| 3861 | LoginPage | RBAC: admin/admin123, manager/manager123, viewer/viewer123 |
| 3954 | AdminPortalPage | Mock |
| 4446 | AdminSLAPage | Mock |
| 4804 | InboundPage | Mock |
| 4879 | StoragePage | Mock |
| 4922 | LaborPage | Mock |
| 4975 | WavesPage | Mock |
| 5039 | OptimizerPage | Mock |
| 5136 | ForecastPage | Mock |
| 5212 | FlightBoardPage | Mock |
| 5329 | EconomicsPage | Mock |
| 5639 | DataHubPage | Mock |
| 5936 | EventCalendarPage | Mock |

---

## 도메인 지식 (KDC 운영)

KDC = KISS Beauty Group 의 US distribution center, Savannah, GA (EST/EDT).

**Live channels (server-side scope = UPS 3 채널만)**:
- `BS-IVY` (company `1100`) — brand color `#0033A0`
- `BS-RED` (company `1400`) — brand color `#BF0D3E`
- `VIVACE` (company `1900`) — brand color `#E87149`

**Mock channels (other pages 11 개 전체)**: CS-Bulk, CS-DSDC, AST, IIO, KIO, ECOM-AMAZON 1P/3P, ECOM-DTC (+ live 3 개).

### 핵심 데이터
- **DO** (Delivery Order) = 출하 단위
- **SO** (Sales Order) = 판매 주문
- 한 SO 가 여러 DO 로 split 가능 (**Split Shipment** — 고객 hard requirement 위반)
- **Carrier**: UPS (대부분) or **TRUCK** (LTL, Less-Than-Truckload)

### 핵심 metrics
- Order→Dock Cycle (hours, container-level avg)
- On-Time Ship % (trailing_status >= 700 cohort)
- On-Time Delivery % (delivered-mode strict aggregation)
- **Split Shipment Rate (target: 0%, customer hard requirement — contract violation, not KPI)**
- Backorder ($ + Qty, per-SO from SAP `zsd_c13`)
- AI Risk Watchlist (Gemini-powered)

---

## 중요 Invariants + 함정

### Timezone (intentional 3-layer design)

| Layer | Approach | Reason |
|---|---|---|
| Snowflake storage | UTC | Source-of-truth |
| Backend SQL | `CONVERT_TIMEZONE('UTC', 'America/New_York', col)` | ET 변환 후 frontend 로 전달 |
| Frontend arithmetic | `setUTCDate` / `getUTCDay` / `getUTCFullYear` | Timezone-portable (browser TZ 와 무관) |
| UI display (SQL-derived) | `timeZone: 'UTC'` | 이미 EST 변환 됐으므로 추가 shift 방지 |
| UI display (JS `now()`) | `timeZone: 'America/New_York'` | Real UTC moment → ET 변환 필요 |

**함정**:
- `new Date('YYYY-MM-DD')` = **UTC midnight** (parser 자연)
- `setHours(0,0,0,0)` = **local** time zero → non-UTC TZ 에서 day-off bug
- `getFullYear/Month/Date` = local TZ (BUG source). **항상 `getUTC*` 사용.**

### Padding (Cross-system Mapping)
- `master.so_num` = **10-char zero-padded** (`"0002127625"`)
- SAP `kdb.pbi_sf.zsd_c13."Sales_document"` = **unpadded** (`"2127625"`)
- **Mapping rule**: `LTRIM(master.so_num, '0') = SAP.Sales_document`
- **`do_num` 도 동일**: `truck_data` join 시 `LTRIM(b.do_num, '0') = td.do_num` (PR Truck-1-Region-Fix)

**🚨 Critical trap — `TRIM` vs `LTRIM`**:
- Snowflake `TRIM(str, '0')` = strip from **BOTH** ends
- `do_num` 가 '0' 으로 끝나는 Truck DO ('0801950600') 가 '801950 6' 으로 변형 → silent join fail
- **항상 `LTRIM`** (left-trim only)

### CTE Pre-aggregation Pattern (master query)

Master query (`server.js:1095-1247`) = **7 CTE chain**:
```
only_closed_orders → base → ia_work_instruction → ups_data → truck_data
                  ↓
              backorder_agg (per Sales_document)
                  ↓
            final (joined per-container row)
                  ↓
       do_level (per-DO aggregates: tracking_cnt, container_cnt, …)
                  ↓
          classified (split_status added: SPLIT / NOT_SPLIT / PENDING / MISSING_TRACKING)
                  ↓
        split_root_cause (per-DO root cause for SPLIT only)
                  ↓
              final SELECT (joined back)
```

**Fan-out 함정**:
- Master query 가 per-container row, 한 SO 가 여러 DO/container
- 직접 SUM 하면 **inflated** → CTE pre-aggregation 필수
- Frontend liveMetrics 도 **SO-level dedupe 필수** (`OverviewPage` line 220-232: `seenBackorderSO` Set 패턴)

### Date Filter Pattern
- Master 기준 LEFT JOIN 외부 cohort (backorder 등)
- `from`/`to` bind variables = **YYYY-MM-DD** (Snowflake auto-DATE-cast format). `YYYYMMDD` 스트라이프 하면 silent 0 rows.

### Backorder Field Fan-out (특수)
- Server `backorder_agg` CTE 가 per-`Sales_document` pre-aggregate
- master 의 *모든 container row* 에 propagate (1:1 with SO)
- **Frontend KPI total 은 반드시 `so_num` dedupe** — 안 하면 N 배 inflate
- 패턴: `seenBackorderSO = new Set()` (OverviewPage line 220-232)

---

## Hidden Dependencies (수정 시 회귀 위험)

### `getExpectedDeliveryDate` (`src/utils/leadTime.js:34`) — 4+ 페이지 의존
| 호출 위치 | 용도 |
|---|---|
| `OverviewPage` line 353 | Detail Table `computeDaysLate` |
| `OverviewPage` line 607 | Expanded SO display |
| `GeoPage` line 996 | `delayedMode='delivered'` classifier |
| `AIRiskPage` line 1864, 2052 | `selectedOrder.promiseDeliver` 대체 |
| `isDeliveredDelayed` 내부 (leadTime.js:63) | 7+ call sites |

**수정 시**: 모든 delivered-mode 페이지 의 count + display 시프트. 회귀 검증 필수.

### `isDeliveredDelayed` — 7 call sites
- 모든 cohort filter 의 핵심 predicate. Semantic 변경 시 widespread impact.

### `useSplitShipments` hook (`src/hooks/useSplitShipments.js`) — 3 페이지 의존
- Overview / Geo / Split 모두 같은 hook 호출
- 서버 URL `http://localhost:3001` 하드코딩
- Mock fallback: live fetch 실패 시 `generateMockShipments()` (core-beliefs §6)

### `serverRowsToShipments` (`src/utils/serverRows.js:19`) — 유일한 server↔mock bridge
- Master query schema 추가 시 **여기 안 wire 하면 모든 페이지 silent null**
- per-SO / per-container dedup logic 집중

---

## 비명시적 Convention

### SQL Identifier ↔ JS 1:1 mapping
- `ROOT_CAUSE_LABELS` (rootCauses.js:14): SQL category name 의 Title Case 그대로
- **이유 (PR5c 사용자분 명시)**: 같은 identifier 를 SQL / adapter / UI / docs 4 layer 에서 grep 가능

### Live Page 표준 구조
모든 live page (Overview / Geo / Split) 가 동일:
```
useSplitShipments(dateRange, customRange)
  → pageData = hookData filtered by selectedChannels + sampleOrderFilter
  → aggregatedPageData = per-DO _is_fully_delivered + MAX(delivered_date)
  → liveMetrics = useMemo(KPI 카드 derivation)
  → render
```

### `onMetaChange` callback pattern
- Page → App: `{ source, count, filter }` 발행
- App-level header 가 LIVE badge + count + 서버-resolved date window 렌더

### Debug markers
- `_source: 'live'` field on every adapter row
- `useSplitShipments` 가 console.log 에 rows / uniqueDOs / channelDistribution / splitStatusDistribution 자동 출력 (line 79-85)

### Mock-only fields (live mode 에서 null)
`cause`, `shift`, `chargeback`, `tier`, `splitGapDays` (delivered 안 되면), `orderValue` (billing 없으면) → UI null-check `'—'` (PR4b2 N/A handling)

---

## 자주 일어나는 Mistake 패턴 (memory + git 기반)

### 1. Data-wiring trap (PR Geo-3, commit `6df33b1`)
- **증상**: endpoint smoke + `npm run build` 통과 → 페이지 "0" 표시
- **원인**: App-level `filtered` prop 에 binding, `useSplitShipments` 직접 호출 안 함
- **교훈**: hook-swap PR 의 필수 검증 = **brower-load visual smoke**
- Live 와 mock 양쪽 path 모두 smoke (kill server → refresh → mock 도 sensibly 렌더)

### 2. Windows TaskStop orphan
- **증상**: `npm run server` restart 후 `curl` 응답 의 OLD schema
- **원인**: TaskStop 이 npm wrapper 만 죽임. node 자식 process 가 port 잡고 살아있음. silent fail (npm exit 0, 옛 server 가 응답)
- **해결**:
  ```powershell
  Get-NetTCPConnection -LocalPort 3001 -State Listen | Select OwningProcess
  Stop-Process -Id <pid> -Force
  Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue  # empty 확인
  ```
- **검증**: `Get-Process -Id <new-pid> | Select StartTime` > `Get-Item server.js | Select LastWriteTime`

### 3. Snowflake cold-start (15-60s)
- **증상**: 페이지 가 "Loading shipment data…" 에 stuck
- **원인**: warehouse 가 15분 idle 후 auto-suspend. 첫 call 이 resume 대기
- **확인**: `curl 'http://localhost:3001/api/scale/split-shipments?from=...&to=...' -m 90`
  - First call >15s + 두번째 5-7s → cold-start 확정 (code 정상)
  - 둘 다 timeout → 코드 의심

### 4. `setHours(0,0,0,0)` 의 timezone shift
- **증상**: 445 false-positive delays (PR Geo-Delivered-Mode 사건)
- **원인**: `new Date('YYYY-MM-DD')` = UTC midnight + `setHours` = local zero → 전날 로 shift
- **해결**: `setUTCHours(0,0,0,0)` + `setUTCDate` + `getUTCDay`. 모든 day-grain calc 이 동일.

### 5. Master query 의 multi-row per DO
- **증상**: First-row dedup 의 데이터 손실 (cohort 가 small)
- **원인**: 137 partial DOs (May 12-19 window), first-row 우연 의 자연 (sort order fact)
- **해결**: row-level aggregation across `containers` (GeoPage local + useSplitShipments fact 보존)

### 6. `TRIM(str, '0')` (Snowflake) BOTH-ends strip
- **증상**: Truck DO ending in '0' (e.g. '0801950600') 의 silent join fail → delivered null cluster
- **해결**: 항상 `LTRIM` (PR Truck-1-Region-Fix, code-analyzer review)

---

## 기존 개발자만 아는 History

- **"tbd 는 일단 건들지 말기"** (`leadTimes.js:69`)
  - `TRUCK_DELIVERY_BD_BY_STATE` 의 "Other / TBD" state intentional omit
  - 사용자분 결정 (delivered-mode false-positive 사고 후)
  - 빠진 state 는 cohort 에서 제외돼야 정확

- **★ marker comment** (`leadTimes.js:42`)
  - Claude inference 의 state, 사용자분 image 에 없음
  - 재확인 필요 flag

- **`LIVE_SPLIT_CHANNELS = ['BS-IVY', 'BS-RED', 'VIVACE']`** (channels.js:22)
  - 서버-side scope = UPS via 3 channel 만 (002 plan §6b)
  - 다른 페이지 는 all 11

- **`pro_num` mapping 제거** (PR Truck-1-fix)
  - `coalesce(b.tracking_number, b.pro_num) as tracking_num` 안 만
  - `r.tracking_num` access 로 UPS / TRUCK 양쪽 fact 충분

- **Snowflake read-only 의 절대 rule** (core-beliefs §8)
  - `INSERT` / `UPDATE` / `DELETE` / `MERGE` / `CALL` / `COPY INTO` / `GRANT` 전부 금지
  - 상류 `KISS_EXP_*` stored procedure 가 write 담당
  - 이 codebase 에서 write 가 필요 하면 **STOP signal — 사용자분 explicit approval 의 별도 plan**

- **Mock generator 의 의도** (core-beliefs §6)
  - Demo (laptop, no network) + offline degraded mode 의 fallback
  - 지우면 둘 다 깨짐

- **3-layer SAP↔SCALE disagreement** (core-beliefs §7)
  - System mismatch / TPA gap / physical vs system
  - Dashboard 는 silent pick 금지 — **명시적으로 flag**

---

## 디버깅 팁

### 어디서 console.log 추가하면 도움?
- `useSplitShipments.js:79-85` 가 이미 rows / uniqueDOs / channelDistribution / splitStatusDistribution 출력
- 잘못된 cohort 디버깅 의 **first stop**

### 자주 사용하는 진단 endpoint
- `GET /api/scale/split-shipments?from=YYYY-MM-DD&to=YYYY-MM-DD` — master query 직접
- `GET /api/scale/explore-ia-wi` — `IA_WORK_INSTRUCTION` schema
- `GET /api/scale/explore-shipping-container` — `SHIPPING_CONTAINER` schema
- `GET /api/scale/explore-process-history` — `PROCESS_HISTORY` schema
- `GET /api/scale/explore-ups-tracking` — `UPS_TRACKING` schema (PR2.5)
- `GET /api/snowflake/config` — current connection config

### Server endpoint catalog
Server boot 시 stdout 에 전체 endpoint 출력. 카테고리:
- SCALE raw (`/api/scale/*`): lifecycle-heatmap, active-waves, otd, daily-volume, stuck-shipments, shipments, waves
- Verified (Kathleen Li): workload-in-process / pm / ps, order-processing-time, pick-frequency
- Phase 1 live: split-shipments (master query)
- AI (Gemini): `/api/ai/chat`, `/api/ai/insight`, `/api/ai/risk-analyze-batch`
- Smartsheet: `/api/smartsheet/issues` (1h cache; `?refresh=true` 로 force)

### Snapshot tool
- `node scripts/snapshot-baseline.mjs` — Playwright 기반 page section 추출
- **Known flake**: YTD hook race → `sections=0` 으로 capture. 재실행 fine.
- `window.__hookCapture` 가 hook state debug entry point

---

## 위험한 코드 영역

| 영역 | 영향 범위 | 주의사항 |
|---|---|---|
| `server.js` master query (line 1095-1247) | 3+ frontend 페이지 | Schema 변경 시 `serverRowsToShipments` 동기화 필수 |
| `utils/leadTime.js` 전체 | 4 delivered-mode 페이지 | Semantic 바뀌면 모든 count 시프트 |
| `utils/dates.js addBusinessDays` | All date arithmetic | UTC-safe. `setDate`/`setHours` 로 "simplify" 금지 |
| `utils/serverRows.js` | Server↔mock single bridge | per-SO / per-container dedup logic |
| `OverviewPage.liveMetrics` (line 135) | GeoPage 와 cohort 정의 invariant | 한쪽만 수정 하면 cohort gap 재발 (e.g. 689 vs 691) |

---

## 작업 워크플로우

### Decision-making
- 사용자분 명시 결정 우선, **추측 금지**
- 의도 / 숫자 확인 안 되면 사용자분 확인

### Commit 규칙
- **자동 commit 금지** — 사용자분 "go" 신호 후만 commit
- **Korean responses**, **평어체**
- PR naming: `<area>-<number>[<letter>]` (예: `PR4b2`, `PR Geo-3-fix`, `PR Overview-A`)
- 영역명: master query / Geo / Split / Overview / Truck / Sample-Order-Filter / AI-Phase1 / Backorder-prep
- Plan doc 의 `§7c` 번호 도 사용 가능

### 검증 패턴
1. 작업 후 **Playwright snapshot 도구로 회귀 검증** (`scripts/snapshot-baseline.mjs`)
2. **`npm run build` clean 필수**
3. **사용자분 브라우저 검증 후 commit** (특히 회귀 검증)
4. Backend 변경 시 사용자분 SQL 쿼리 로 직접 cross-check
5. Data-wiring PR (hook swap, prop pass-through, adapter routing) 은 **brower-load visual smoke 추가 필수**

---

## Memory 시스템

- `memory/MEMORY.md` — index (각 `.md` 파일 pointer, gitignored)
- `memory/feedback_*.md` — 실수 / 배움 기록
- `memory/project_*.md` — 진행 중인 작업 plan, backlog

### 현재 Memory entries
- `feedback_data-wiring-pr-validation.md` — PR Geo-3 incident
- `feedback_windows-taskstop-orphan.md` — Windows TaskStop trap
- `feedback_snowflake-cold-start.md` — 15-60s cold-start (not regression)
- `project_post-refactor-backlog.md` — R3 후 deferred items

---

## 현재 Backlog (`memory/project_post-refactor-backlog.md`)

1. **Null guard cleanup** — `orderValue.toFixed(0)` 의 unguarded instances:
   - `src/ShippingSLAApp.jsx:5308` (FlightBoardPage) ← mock-only field, currently safe
   - `src/ShippingSLAApp.jsx:7687` (RootCausePage-like table) ← mock-only field, currently safe
   - **Note**: 원래 backlog 의 line 5998 / 8498 은 R3 후 line 번호 shift. 5998 / 8498 은 캘린더 셀 (`new Date(year, month, d)`) 이지 orderValue 가 아님.
   - 적용 시 패턴 (commit `181bd8a`):
     ```jsx
     {o.orderValue != null ? '$' + fmtNum(Math.round(Number(o.orderValue))) : '—'}
     ```

2. **Overview vs Split cohort label UX**
   - Overview "Total Volume $" KPI → `1,318 DOs · all carriers, incl samples`
   - Split header hint → `UPS only · Sample 제외`
   - **원인**: Overview cohort (all carriers + samples, 1318) vs Split cohort (UPS only + sample-excluded, 1248) = 70 gap (33 TRUCK + 37 Sample, disjoint)

3. **ResponsiveContainer + fixed-pixel anti-pattern** (`src/ShippingSLAApp.jsx:778`)
   - Donut chart 의 `<ResponsiveContainer width={180} height={180}>` → `<PieChart width={180} height={180}>` 로 교체
   - **Console noise only**, no user-visible effect

4. **Snapshot tool timing flake** (`scripts/snapshot-baseline.mjs`)
   - YTD hook race → 가끔 `sections=0` capture
   - Fix: `window.__hookCapture` 의 state 대기 후 DOM extract

5. **TRUCK_DELIVERY_BD_BY_STATE coverage gap** (Promise Deliver null cluster)
   - "TBD" state 들 의 처리 결정 필요 (사용자분 명시: "건들지 말기")

6. **(WIP) Backorder SO-grouped expand layout** — split shipment pattern 재작업 필요

---

## 다음 세션 시작 시 확인 순서

1. `git status` — clean? stash 있나?
2. `git log --oneline -10` — 최근 commit 확인
3. `memory/MEMORY.md` — backlog 확인
4. 사용자분 의도 확인 후 작업 시작
5. (필요시) `npm run server` + `npm run dev` 양쪽 띄우기

---

## RBAC (mock auth)

3 roles in `src/constants/auth.js`:

| Role | Demo | Pages | Features |
|---|---|---|---|
| Admin | `admin/admin123` | 23 (all) | edit SLA, upload, reset, contact CS |
| Manager | `manager/manager123` | 20 (no admin/adminportal/snowflake) | upload, contact CS |
| Viewer | `viewer/viewer123` | 8 (read-only operational) | — |

---

## Color palettes (CLAUDE.md 와 별개)

**Dark theme tokens** (UI scaffolding) — CLAUDE.md 참조 (`#0f1419` bg, `#e8ecef` text 등).

**Hark brand palette** (chart fills, accents):
- Cerise `#E74C6F`, Turquoise `#1ABC9C`, Persian Blue `#2C3E9B`, Green `#2ECC71`, Sky Blue `#3498DB`, Purple `#8E44AD`, Navy `#1B2A4A`

**Cause colors** (legacy mock): UPS=red `#E74C6F`, DC=blue `#3498DB`, Missing=purple `#8E44AD`, Damage=turquoise `#1ABC9C`, Other=gray `#7F8C8D`

**Live brand colors** (3 channels): BS-IVY `#0033A0`, BS-RED `#BF0D3E`, VIVACE `#E87149`

---

## Reference docs (in-repo)

- `docs/architecture.md` — target production architecture
- `docs/data-model.md` — data shape
- `docs/roadmap.md` — phased plan
- `docs/setup.md` — local setup
- `docs/rbac.md` — role/permission detail
- `docs/design-docs/core-beliefs.md` — **8 principles (must read before any exec plan)**
- `docs/exec-plans/active/001-snowflake-integration.md`
- `docs/exec-plans/active/002-split-shipments-live.md` — split shipment live 의 PR 계열 의 원천
- `docs/references/snowflake-schema.md`
- `docs/references/delay-validation-sql.md` — TRUCK & UPS 의 delay 검증 SQL

---

> **Reminder**: 이 skill 은 사용자분 (Hyeree) 의 KDC project 에서만 사용. 작업 시작 전 항상 `git status` + `memory/MEMORY.md` 확인.
