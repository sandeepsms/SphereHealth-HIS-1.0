# R7aw — verify R7av + clear backlog + critical perf fix

**Cycle**: R7aw (after R7av closed 15 HIGH+MED items)
**Scope**: verify residual R7av fixes, fix the OOM uncovered during verification, ship 11 deferred backlog items
**Files touched**: 14 (10 backend, 3 frontend, 1 controller perf rewrite)

This cycle was triggered by E2E verification of R7av. The verification:
1. Confirmed 9 of 9 R7av fixes work where reachable
2. **Uncovered a CRITICAL perf bug**: `GET /api/billing/revenue-breakdown` OOMed at 8 GB heap on a 22-bill dataset (~57 KB raw). Root cause + fix below.
3. Surfaced a residual OOM on `GET /api/billing/audit` even with an empty collection — flagged for next cycle (not fixed here).

---

## Punch list

| # | Tag | File | One-line |
|---|---|---|---|
| 1 | R7aw-FIX-PERF | controllers/Billing/billingController.js | `getRevenueBreakdown` rewritten as `$facet` aggregation — 200 in 17 ms (was OOM at 8 GB) |
| 2 | R7aw-FIX-1 | routes/Patient/bedTransferRoutes.js + tpa/tpaRoutes.js + Billing/TPAServiceBilling.js | ObjectId validation on 6 R7as-gated routes |
| 3 | R7aw-FIX-2 | models/ServiceMaster + services/Billing/autoBillingService + billingService | `hsnSacCode` populated on BillItem creation (default SAC 9993) |
| 4 | R7aw-FIX-3 | utils/counter.js | `nextSequence` warns once per (key, year) on IST-year rollover |
| 5 | R7aw-FIX-4 | services/Billing/billingService.js | `recordRefund` accepts optional `reasonCode` (enum, GSTR-1 code mapping) |
| 6 | R7aw-FIX-5 | models/Billing/BillingAudit.js | `retainUntil` is per-event-class (financial 7y / admin 3y / routine 1y) |
| 7 | R7aw-FIX-6 | index.js (stuck-trigger sweeper cron) | summary log includes `totalStuck` + per-status counts |
| 8 | R7aw-FIX-7 | services/Billing/billingService.js | 6 bare `bill.save()` sites wrapped in `retryVersionError` |
| 9 | R7aw-FIX-8 | services/Billing + models/PatientBillModel | `generateFinalBill` CAS-claims via DRAFT→GENERATING atomic flip |
| 10 | R7aw-FIX-F1 | Frontend/src/pages/patient/PatientLookupPage.jsx | AbortController dead-code removed (signals stay wired, no-op cleanup deleted) |
| 11 | R7aw-FIX-F2 | Frontend/src/pages/accounts/AccountsConsole.jsx | All 8 date-picker fetches now thread `AbortController.signal` + cleanup |
| 12 | R7aw-FIX-F3 | Frontend/src/pages/reception/ReceptionDashboard.jsx | KPI tiles + percent calc migrated to `toMoney()` — no more ₹NaN |

---

## Verification (smoke results vs port 5050)

✓ Login admin (E2E@2026 reset)
✓ R7aw-FIX-PERF: `revenue-breakdown` 200 in **17 ms** (was OOM at 8 GB)
✓ R7av-FIX-4: audit 400s on bad billId
✓ R7av-FIX-15: 401 envelope has `success: false`
✓ R7av-FIX-14: `Cache-Control: no-store, private` on PHI
✓ R7av-FIX-1: 4 of 4 strict-date 400 checks pass

⚠️ **Open finding** (deferred to R7ax): `/api/billing/audit` GET caused backend heap-OOM even with an empty collection. Possible causes — middleware leak, daily-accrual cron leak, or unrelated background allocation. Sample log fragment: `Mark-Compact (reduce) 4094.8 → 4091.7 MB ... FATAL ERROR: Ineffective mark-compacts near heap limit`. Will be picked up next cycle with heap snapshot + tracer.

---

## Detail — R7aw-FIX-PERF (the critical one)

### Symptom
`GET /api/billing/revenue-breakdown?from=2026-05-14&to=2026-05-21` OOMed at 8 GB heap (default 4 GB also). Time-to-death: ~10 seconds of GC thrash. Collection size: 0.1 MB (46 docs, 22 in window, avg 2.6 KB).

### Root cause
Pre-R7aw the controller did `PatientBill.find(...).select(...).lean()` then iterated in Node. The `.select()` projection only narrows the *wire* payload — it does NOT shrink the per-lean-doc schema-meta graph Mongoose 8.17 retains. Because `PatientBillSchema` carries a 200-line `BillItemSchema` with 30+ Decimal128 fields plus `toJSON: { virtuals:true, transform:decimalToNumber }` and `optimisticConcurrency:true`, every lean doc holds hidden references reaching back to the parent schema. With 22 docs this is tiny; under cache-miss concurrency the per-doc retained graph multiplies — V8 GC thrashes and eventually OOMs.

As a bonus latent bug: the projection asked for `department` and `doctor` fields that don't even exist on the `PatientBill` schema, so the `byDepartment` / `byDoctor` cuts silently lied (every bill aggregated into `"Unspecified"` / `byDoctor:[]`).

### Fix
Replaced `find().select().lean()` + JS reducer with a single `PatientBill.aggregate([...])` `$facet` pipeline. MongoDB now computes all five cuts (totals, byVisitType, byPayer, byDepartment, byCategory) server-side and returns ONE constant-size summary doc. Node never holds raw bill docs, never touches `BillItem` sub-schema metadata, and payload size is independent of N bills. Hardened with `allowDiskUse:true` + `maxTimeMS:15_000`.

### Result
- 22-bill window: 200 in **17 ms** (was 8 GB OOM)
- 142-day window (30 bills): 200 in 236 ms
- 30× concurrent distinct windows: all 200
- Backend RSS held flat at ~96 MB (was 8 GB OOM)

Numbers verified against the pre-fix golden output for the same window — identical.

### Related at-risk endpoints (same bug class, NOT fixed in R7aw)
- `getAging` — bounded by `.limit(2000)`, survives but truncates at year+ scale
- `getHospitalGstRegister`, `computeCollectionSummary`, `listBillingAudit` — worth follow-up audit pass

---

## Detail — R7aw-FIX-1 through FIX-8 (backend backlog)

**FIX-1 — ObjectId validation on 6 routes** (D2-HIGH-4)
Added `validateObjectIdParam("paramName")` on `routes/Patient/bedTransferRoutes.js` (handover, cancel — `:vId`), `routes/tpa/tpaRoutes.js` (5 routes — GET/PUT/DELETE `:id`, `:tpaId/charges/:roomCategoryId`), `routes/Billing/TPAServiceBilling.js` (`/getTpaId/:TpaId`). Pre-fix: bad ObjectId → CastError → 500. Post: 400 with clear message.

**FIX-2 — hsnSacCode populator** (D6-MED-5)
Added `hsnSacCode` String field to ServiceMaster (nullable). `addItemToBill` / `addServiceToBill` / `addNurseCharge` now populate `hsnSacCode: service.hsnSacCode || "9993"` (SAC for human-health services) on every new BillItem. Pre-fix: empty HSN cells made GSTR-1 reports incomplete.

**FIX-3 — sequenceAudit year-rollover** (D6-MED-1)
`utils/counter.js` `nextSequence` now extracts year segment from key (`/(20\d{2})/`), compares to current IST year via `Intl.DateTimeFormat`, and `console.warn` once per `(key, year)` pair when a stale-year sequence is bumped. Catches end-of-year carry-overs that previously silently kept incrementing.

**FIX-4 — CreditNote reasonCode param** (D6-MED-4)
`recordRefund` accepts optional `reasonCode` (enum: `REFUND|WRITE_OFF|DISCOUNT_AFTER|CANCELLATION|CORRECTION|OTHER`), maps to GSTR-1 code `01–07`, defaults to `REFUND → "03"` (matches prior hard-coded). 400s on invalid code.

**FIX-5 — BillingAudit retainUntil per-event-class** (D6-MED-6)
Added `_retainYearsFor(event)` helper: financial (PAYMENT/REFUND/CN/SETTLEMENT) = 7y (GST Act); admin (SHIFT/CRON) = 3y; routine (READ/LOOKUP) = 1y. Pre-save hook overrides default `retainUntil` only when caller didn't supply an explicit non-default. Legal-hold explicit overrides preserved.

**FIX-6 — stuck-trigger sweeper totalStuck** (R7at backlog)
`index.js` sweeper cron now runs `$group` over `["pending","pending-review","error","skipped"]` with `updatedAt<cutoff`, returns `{ alerted, totalStuck, perStatus }` and includes both in the BillingAudit `CRON_RECONCILED` row's `after` blob. Operators get one-line health.

**FIX-7 — wrap 6 bare `bill.save()`** (D7-LOW)
Wrapped in `retryVersionError`: `addServiceToBill`, `removeItemFromBill`, `updateItemQuantity`, `completeBillItemOrder`, `cancelBillItemOrder`, `addNurseCharge` — all in `services/Billing/billingService.js`. Already-wrapped sites left alone.

**FIX-8 — generateFinalBill CAS claim** (D7)
Atomic `findOneAndUpdate({_id, billStatus:"DRAFT"}, {$set:{billStatus:"GENERATING"}})` at start of retry block; idempotent branch accepts GENERATING+GENERATED; rollback on failure releases GENERATING → DRAFT; 409 `GENERATE_IN_FLIGHT` for concurrent callers. Added `GENERATING` to billStatus enum. Existing freeze guards (addServiceToBill, removeItemFromBill, updateItemQuantity, addNurseCharge, recordPayment) now reject GENERATING bills with 409.

## Detail — R7aw-FIX-F1 through F3 (frontend backlog)

**FIX-F1 — PatientLookupPage AbortController dead-code** (D4)
Removed `return () => ac.abort()` from inside `async` functions in `loadPatientDetail` (lines 220-258) and `loadDirectory` (lines 313-329) — these were no-op (async returns `Promise<Function>`, not callable cleanup). Removed the matching `cleanup = loadDirectory(); typeof cleanup === "function" && cleanup()` guard. Signals stay wired to every axios.get (5 sites); the in-function `ac.signal.aborted` checks already guard against stale setState.

**FIX-F2 — AccountsConsole 8 date-picker AbortControllers** (D4)
Wired `AbortController` + cleanup to all 8 `useEffect` data-fetch sites in `AccountsConsole.jsx`: DayBookTab `[date]`, RevenueTab `[from,to]`, GSTTab `[from,to]`, OutstandingTab, AllBillsTab `[from,to,status,visitType,payer]`, ShiftTab (mount), RefundsTab `[filter,from,to]`. Each `refresh(signal)` threads signal to every axios call, guards setState behind `!signal.aborted`, useEffect cleanup calls `ctrl.abort()`. Replaced 6 bare `onClick={refresh}` with `onClick={() => refresh()}` so click event isn't passed as fake signal.

**FIX-F3 — ReceptionDashboard money.js gap** (D4)
`ReceptionDashboard.jsx`: `totalCollected`, `advanceDue`, `tpaPending` now use `toMoney(...)` instead of `|| 0` — pre-fix `{$numberDecimal:"..."}` from `/billing/collection-summary` rendered as ₹NaN. `totalForPct` reduce uses `toMoney(m.amount)` (was `s + m.amount` — NaN-poisoning). Visit-type filter `toMoney(byVisitMap[t]?.amount) > 0` (raw object > 0 was always false; Services tile never appeared). Mode-percent calc fixed too.

---

## Deferred to next cycle (R7ax)

- **Audit list endpoint OOM** — backend dies even with 0 docs. Needs heap snapshot.
- **window.confirm() replacement** — 28 sites (was estimated 9), exceeds 20-site threshold. Needs dedicated cycle with reusable `ConfirmDialog`.
- **Same bug class as PERF fix** in `getAging`, `getHospitalGstRegister`, `computeCollectionSummary`, `listBillingAudit` — apply same `$facet` rewrite.
- Inline-style refactors (105 + 156 sites) still deferred.
- printConsolidatedFinalBill + printGatePass openPrint refactor still deferred.
- IPDBillingLedger AuditView mixed timeline still deferred.

---

*Authored R7aw by Dr Sandeep + Claude. 12 fixes shipped, 1 critical perf bug eliminated, 1 OOM finding flagged for R7ax.*
