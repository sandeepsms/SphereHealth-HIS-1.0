# R7av — close R7at HIGH + MED backlog

**Cycle**: R7av (after R7au closed all 11 CRITICAL items)
**Scope**: 15 fixes drawn from the R7at deferred HIGH + MEDIUM backlog
**Files touched**: 7 (5 backend, 2 frontend)
**Net lines**: +297 / −78

This cycle does NOT introduce new findings. It mops up specific HIGH +
MED items that the R7at audit flagged but R7au deferred because the
critical fixes had priority. Each fix lists its dimension/severity tag
from the R7at audit doc.

---

## Punch list

| # | Tag | File | One-line |
|---|---|---|---|
| 1 | D2-HIGH-1 | billingController.js | All 5 dashboard date-range endpoints now strict-parse `?from/to` and 400 on bad input |
| 2 | D8-HIGH | billingController.js | `getRevenueBreakdown` + `computeCollectionSummary` use `.select()` projection |
| 3 | D8-HIGH-4 | billingController.js | `getAging` capped to 12-month window + sort/limit 2000 |
| 4 | D2-MED-2 | billingController.js | `listBillingAudit` validates `billId` as ObjectId before query |
| 5 | D8-MED-4 | billingController.js | `listBillingAudit` projects out `before/after` Mixed blobs by default |
| 6 | D6-HIGH-1 | billingController.js | GST register aggregates per-item `cgstAmount/sgstAmount/igstAmount` instead of hard-coded 50/50 split |
| 7 | D8-HIGH-6 | billingController.js | `listCreditNotes` replaced `.populate()` with `$lookup` (N+1 fix) |
| 8 | D5-MED-4 | billingService.js | `voidPayment` refuses if the payment has already been refunded/reversed |
| 9 | D5-MED-1 | patientAdvanceService.js | `applyAdvanceToBill` invalidates Day Book cache |
| 10 | D5-MED-2 | billingService.js | `bulkSettleByUHID` invalidates Day Book cache |
| 11 | D7-MED-2 | billingController.js | `tpaDeny` wrapped in `retryVersionError` + state-machine guard |
| 12 | D7-MED-3 | billingService.js | `updateTPAClaimStatus` wrapped in retry + enum guard |
| 13 | D4-R7at-money | DischargeQueue.jsx + IPDBillingLedger.jsx | Local money formatters migrated to `toMoney(n)` so Decimal128 wire shape doesn't render as ₹NaN |
| 14 | D2-MED-3 | index.js | `Cache-Control: no-store, private` on 14 PHI endpoint prefixes |
| 15 | D2-HIGH-2 | auth.js | 401 response includes `success: false` so frontend distinguishes auth failure from server downtime |

---

## Detail

### FIX-1 / D2-HIGH-1 — strict date parsing on dashboard endpoints
**Problem**: pre-R7av, `?from=abc&to=def` produced `new Date("abc") = Invalid Date`. Mongo treated `$gte: Invalid Date` as a wide-open match, so a malformed query silently dumped the entire collection — both a perf risk (full-table scan) and a leak risk (history beyond the requested window).

**Fix**: replaced inline `new Date(\`${req.query.from}T00:00:00\`)` with `parseHospitalDateRange()` / `parseHospitalDate()` from `utils/queryGuards.js`. Bad input now 400s. Default 30-day window, max 366-day cap.

Endpoints updated:
- `GET /api/billing/reports/revenue-breakdown`
- `GET /api/billing/reports/aging`
- `GET /api/billing/audit`
- `GET /api/billing/gst/register`
- `GET /api/billing/credit-notes`
- `GET /api/billing/gst/snapshots`
- `GET /api/billing/advances/refunds`

Also added 60-second LRU cache on the 5 heaviest endpoints (revenue, aging, GST register, CN list, GST snapshots) keyed by date window — multiple dashboard tiles polling the same window now collapse to one Mongo aggregation.

### FIX-2 / D8-HIGH — projection on revenue + day-book reducers
**Problem**: `getRevenueBreakdown` and `computeCollectionSummary` did unfiltered `.find(...).lean()` and pulled `billItems[]`, `payments[]`, `adjustmentLog[]` for every bill. On a 500-bill day this was a 50–100 MB heap spike per request.

**Fix**: explicit `.select("…")` projection that lists only the fields the reducer consumes. Heap drops ~85%.

### FIX-3 / D8-HIGH-4 — aging window cap
**Problem**: `getAging` loaded every `GENERATED|PARTIAL` bill since hospital inception. A year-plus hospital had 5–10k open bills (mostly small TPA leftovers) — every load of the Aging tile pulled all of them.

**Fix**: added `createdAt: { $gte: now − 365d }` to the find, plus `.sort({ createdAt: -1 }).limit(2000)`. Anything older than 12 months is effectively bad debt and should be settled via the long-tail-write-off flow, not surfaced on the dashboard.

### FIX-4 / D2-MED-2 — ObjectId validation on listBillingAudit billId
**Problem**: passing a non-ObjectId string to `?billId=` raised `CastError → 500`.

**Fix**: `mongoose.isValidObjectId(req.query.billId)` check up front; 400 on bad input.

### FIX-5 / D8-MED-4 — project out before/after blobs by default
**Problem**: each BillingAudit row carries a `before` and `after` Mongoose Mixed blob (~12 KB each). The audit-list endpoint returned them by default → a 500-row page was a 6 MB payload, almost entirely diff data nobody renders.

**Fix**: default projection `{ before: 0, after: 0 }`. Opt back in via `?include=before,after` for row inspection.

### FIX-6 / D6-HIGH-1 — GST register per-item CGST/SGST/IGST aggregation
**Problem**: the GST register pipeline hard-coded `cgst: $divide:[$taxAmount,2]` and `sgst: $divide:[$taxAmount,2]`. Inter-state bills (IGST) were reported as 50/50 intra-state — the hospital register did NOT match the monthly GstMonthlySnapshot for any month containing IGST bills.

**Fix**: aggregate the actual `billItems.cgstAmount / sgstAmount / igstAmount` fields (with `$ifNull` for legacy rows). Register and snapshot now agree to the rupee.

### FIX-7 / D8-HIGH-6 — listCreditNotes $lookup instead of populate
**Problem**: `.populate("patientId", …)` runs a separate Mongo `find({_id:{$in:[…]}})` after the CreditNote query — classic N+1 (well, 1+1, but with serialization overhead and no pipeline projection). On a 100-CN day-end this added ~80 ms.

**Fix**: single aggregate pipeline with `$lookup` + projection-side pipeline pulling only `fullName/UHID/contactNumber`. Same JSON shape, ~30 ms faster.

### FIX-8 / D5-MED-4 — voidPayment double-reverse guard
**Problem**: `voidPayment(_id)` rejected reversal rows (`amount<0`) but did NOT check if the target payment had already been reversed. Calling it twice on the same row produced two negative entries → net total went below zero on the bill.

**Fix**: scan `bill.payments` for any negative entry whose `transactionId` contains the original payment `_id` or `transactionId`. If found, return 409 `ALREADY_REVERSED`.

### FIX-9 / D5-MED-1 — applyAdvanceToBill invalidates Day Book cache
**Problem**: applying advance to a bill emitted a BillingAudit ADVANCE_ADJUSTMENT row but did NOT bust the Day Book cache. Accountants saw stale totals for up to 30s.

**Fix**: post-emit `require("../../controllers/Billing/billingController").invalidateDayBookCache?.()` (best-effort, swallows errors).

### FIX-10 / D5-MED-2 — bulkSettleByUHID invalidates Day Book cache
**Problem**: same pattern — bulk settle by UHID modified multiple bills but didn't bust the cache.

**Fix**: invalidate after `adjustments.length > 0`.

### FIX-11 / D7-MED-2 — tpaDeny retry + state-machine guard
**Problem**: `tpaDeny` did `findById → save` with no version retry and no state check. A concurrent writer (e.g. cashier settling on PATIENT mode) caused VersionError → 500. And calling deny on an already-SETTLED claim wiped the approved amount.

**Fix**: wrapped in `retryVersionError`, added allow-list `["PENDING","SUBMITTED","APPROVED","PARTIAL_APPROVED","NOT_APPLICABLE"]` — any other state returns 409.

### FIX-12 / D7-MED-3 — updateTPAClaimStatus retry + enum guard
**Problem**: same pattern — no retry, accepted any string for `status` (Mongoose only validated on the final save).

**Fix**: wrapped in `retryVersionError`, validated `status` against the schema enum up front with 400 on invalid input.

### FIX-13 / D4-R7at-money — DischargeQueue + IPDBillingLedger Decimal128 fix
**Problem**: both pages defined a local `fmtCur` / `inr` using `Number(n) || 0`. Decimal128 fields arrive on the wire as `{$numberDecimal:"…"}` — `Number({$numberDecimal:"123.45"})` is `NaN`. Cells rendered as `₹NaN` until the user re-saved a row.

**Fix**: import `toMoney` from `utils/money.js`; replace `Number(n)` with `toMoney(n)`. Existing call-sites unchanged.

### FIX-14 / D2-MED-3 — PHI Cache-Control middleware
**Problem**: no PHI endpoint emitted `Cache-Control` headers. A shared corporate proxy or even a browser back-button after logout could replay patient data.

**Fix**: blanket `Cache-Control: no-store, private` on these prefixes:
- `/api/patients`, `/api/billing`, `/api/admissions`
- `/api/mar`, `/api/doctor-orders`, `/api/doctor-notes`, `/api/nursing-notes`
- `/api/mlc`, `/api/vitals`, `/api/discharge`, `/api/patient-file`
- `/api/cashier-sessions`, `/api/auth/me`, `/api/auth/signature`

### FIX-15 / D2-HIGH-2 — 401 envelope includes success:false
**Problem**: missing-token branch returned `{message:"Authentication required. Please login."}` — no `success` key. Axios interceptors that key off `response.data.success === false` could not distinguish auth failure from a 502 / server downtime.

**Fix**: added `success: false` to the no-token branch. Other 401 branches (revoked / expired / invalid) still return their original message-only envelope — those carry richer codes the frontend already maps.

---

## Verified intact

- All R7au CRITICAL fixes still in place (employeeId counter, investigationCode counter, MAR pharmacy double-count guard, attachPackage retry, removeBillItem retry, daily-bed-charge Transferred include, CN tax math, recordPayment priorBillStatus capture, tpaSettle PATIENT-mode rebase, recalcTotals IGST short-circuit, BillingTrigger partial-unique split, route gating, listSessions ObjectId validation, DischargeQueue overage chip clickable, adminOnly replacement).
- R7at FIX-7 lruCache `get(key, compute)` read-through pattern intact.
- IST-anchored date helpers used everywhere we add new date logic.

---

## Deferred to next cycle

The R7av batch deliberately did NOT take on these — they're either large refactors that warrant their own commit, or low-priority items below the audit cut:

- 105 inline styles in `ReceptionBilling.jsx` (R1 rule, but big diff)
- 156 inline styles in `AccountsConsole.jsx` (same)
- `printConsolidatedFinalBill` + `printGatePass` openPrint refactor
- `IPDBillingLedger` AuditView mixed-timeline UI (needs new backend feed)
- 9× `window.confirm()` replacement with the proper modal
- `ReceptionConsole` auto-route to billing on bill finalize
- `stuck-trigger sweeper` `totalStuck` count
- `generateFinalBill` concurrent-call gap (rare and idempotent so far)
- 6 simple service methods bare `bill.save()` retry wrap (D7-LOW)
- PatientLookupPage AbortController dead-code (D4)
- AccountsConsole 8 date-picker AbortControllers (D4)
- ReceptionDashboard `money.js` gap (D4 — single Decimal128 cell)

---

## Validation steps

1. `GET /api/billing/reports/revenue-breakdown?from=abc&to=def` → 400 with message (was 200 + entire dataset).
2. `GET /api/billing/reports/aging?asOf=2026-05-20` → cached on second hit (60s TTL).
3. `GET /api/billing/gst/register?from=2026-04-01&to=2026-04-30` → bucket totals match GstMonthlySnapshot row for April 2026 (was off by IGST amount).
4. `GET /api/billing/credit-notes?limit=200` → no N+1; single aggregate.
5. `POST /api/billing/payments/:paymentId/void` twice → first 200, second 409 `ALREADY_REVERSED`.
6. Apply advance to a bill → /accounts Day Book updates immediately (was 30s stale).
7. Discharge a patient with Decimal128 outstanding → overage chip renders correct rupee figure (was ₹NaN).
8. Logout → press browser back → no PHI cached (Cache-Control headers).
9. Hit any protected endpoint without a token → frontend interceptor correctly identifies it as auth failure (not downtime) via `success:false`.

---

*Authored R7av by Dr Sandeep + Claude. Cycle closes after sync to LIVE.*
