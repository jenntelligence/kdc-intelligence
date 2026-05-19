---
name: feedback-data-wiring-pr-validation
description: For PRs that change which data source a page reads (hook swap, prop pass-through, adapter routing) — endpoint smoke + build alone are insufficient. Always add a browser-load visual smoke step to the PR's validation list before claiming complete.
metadata:
  type: feedback
---

For PRs that change which data source a page consumes (new hook, prop
pass-through, adapter routing change), curl+build validation is not
enough. Always add a browser-load visual smoke step.

**Why:** PR Geo-3 (commit 6df33b1) on the KDC dashboard passed both
the endpoint smoke (curl returned the new SH-level `trailing_status`
fields fine) and `npm run build`, but the Geographic page rendered
"All Delayed Shipments: 0" because the page was bound to the
App-level `filtered` prop instead of calling `useSplitShipments`
directly. The App-level data state is never wired to Snowflake on
this project — only per-page hooks are. The assumption that "the
live endpoint works ⇒ the page consumes live data" was structurally
wrong, and only a browser visit would have caught it.

**How to apply:**

- Any PR where the verb is "wire," "swap data source," "hook
  reuse," "adapter pass-through," or where the diff touches a
  component's prop signature: include "load the page in browser,
  confirm visible counts match endpoint counts" as an explicit
  validation step before commit.
- For pages that route through both live and mock paths, smoke
  *both* — kill the server, refresh, confirm the mock path also
  renders sensibly (this caught the second bug in PR Geo-3-fix:
  mock rows lack `so_created_date`, so the classifier had to
  accept `orderCreate` as a fallback).
- The lesson lives in [[002-split-shipments-live.md]] under PR
  Geo-3-fix — "Why this slipped past PR Geo-3 verification."

---

## PR Geo-Delivered-Mode (PR 39) — 사용자분 의 critical thinking 의 진짜 가치

### Lessons

1. **사용자분 의 small visual question 의 진짜 큰 발견**:
   - "164, 109 는 어디서 나온 숫자지" → 445 false-positive 의 발견
   - SQL 의 truth source 의 진짜 가치 (`datediff < -1` 의 fact)
   - Calendar day vs Timestamp 의 정밀 의 진짜 root cause

2. **JavaScript Date arithmetic 의 timezone 의 진짜 의문**:
   - `new Date('YYYY-MM-DD')` = UTC midnight (parser 의 자연)
   - `getFullYear/Month/Date` = local timezone (BUG source)
   - `getUTCFullYear/getUTCMonth/getUTCDate` = UTC components (정확)
   - Day-grain calculation 의 진짜 자연: string slice + `'T00:00:00Z'` reconstruction

3. **Master query 의 multi-row per DO 의 진짜 자연**:
   - 137 partial DOs (May 12-19 window)
   - First-row dedup 의 우연 의 자연 (sort order 의 fact)
   - 진짜 fix: `r.containers` 의 row-level aggregation (GeoPage local, useSplitShipments hook 의 fact 보존)

4. **사용자분 의 design 의 의도 의 layer-by-layer 의 명확화**:
   - 초기: Loose (any-row delivered, 732, SQL 의 일관)
   - 진짜: Strict (all-rows delivered, 608, "모든 shipment delivered")
   - ANY-delayed = MAX(delivered_date) > expected (logically equivalent)

5. **Browser Date parsing 의 자연**:
   - `"YYYY-MM-DD"` = UTC midnight
   - `"YYYY-MM-DD HH:MM:SS.000"` = local time (browser dependent)
   - 즉 parse 의 자연 의 다름 (timezone 의 fact)
   - 진짜 의의: day-grain 의 normalize 의 필요 (slice + `'T00:00:00Z'` reconstruction)

The lesson lives in [[002-split-shipments-live.md]] under PR Geo-Delivered-Mode — Background / Scope / Validation sections.
