# R7at — 10-Dimension Re-Audit + Critical Regression Fixes

**Scope:** Receptionist + Billing + Accounts & Finance + RBAC.
**Method:** 10 parallel agents re-audited the R7as commit (`f29aad6`) for: (A) verifying R7as fixes work end-to-end, (B) re-confirming deferred items and digging for net-new.
**Inputs:** Branch `claude/romantic-blackwell-6a8e35`.
**Saved 21 May 2026 (IST).**

## Headline

**Two of the 11 R7as fixes had latent regressions** that R7at caught:
- **R7as-FIX-10 (JWT fullName LRU)** — used non-existent `_fullNameCache.set()` API; lruCache only exposes `get(key, compute)` read-through. EVERY authenticated request silently failed → audit rows still lost cashier names. (D1, D2, D3, D7, D8 all independently flagged.)
- **R7as-FIX-6 (GST register on billGeneratedAt)** — switched the pipeline match to `billGeneratedAt` but no index existed on that field → collscan over 50k-200k bills on every register view.

Plus R7at caught a brand-new CRITICAL **pre-R7as** bug: PatientBill `pre("save")` burned a `BILL-Y-NNNNNN` on EVERY new bill including DRAFTs, then `generateFinalBill` overwrote with a fresh `generateBillNumber()` — **every finalised bill consumed TWO sequence positions**, breaking IT-Rule-46 gap-less invariant.

All R7as fixes other than FIX-10 verified working. The remaining ~85 deferred items confirmed open and prioritised below.

---

## R7at fixes landed (15 items)

| # | Code | Severity | Finding | Where |
|---|------|----------|---------|-------|
| 1 | **R7at-FIX-1** | HIGH | Boot-catchup lock name + missing release. Unified on `cron:daily-accrual` + try/finally. | `Backend/index.js` |
| 2 | **R7at-FIX-2** | HIGH | GST snapshot cron emitted no audit row. Added CRON_RECONCILED emit. | `Backend/index.js` |
| 3 | **R7at-FIX-3** | MED | EOD Day Book used UTC dayStr — drift past UTC midnight. Switched to IST formatter. | `Backend/index.js` |
| 4 | **R7at-FIX-4** | MED | shift-auto-close force-set variance=0 → masked real shortages. Now leaves null + closedByCron flag for filter. | `Backend/index.js` |
| 5 | **R7at-FIX-5** | LOW | shift-auto-close emitted audit even on save failure. Now skips emit when save fails. | `Backend/index.js` |
| 6 | **R7at-FIX-6** | MED | cron `setTimeout(tick)` re-armed after `cancel()` during shutdown. Added `cancelled` flag. | `Backend/utils/cronScheduler.js` |
| 7 | **R7at-FIX-7** | **CRITICAL** | **R7as-FIX-10 broken** — wrong lruCache API. Rewrote to use the actual `get(key, compute)` read-through pattern. JWT fullName now resolves. | `Backend/middleware/auth.js` |
| 8 | **R7at-FIX-8** | HIGH | `CreditNote.pre("save")` derived year from server-clock — broken with R7as-FIX-5 IST-override. Now derives from `creditNoteDate` via IST formatter. | `Backend/models/Billing/CreditNote.js` |
| 9 | **R7at-FIX-9** | MED | R7as-FIX-7 idempotent re-entry too permissive — CANCELLED bills slipped through. Tightened to `=== "GENERATED"`. | `Backend/services/Billing/billingService.js` |
| 10 | **R7at-FIX-10** | **CRITICAL** | `/auth/me`, PATCH `/auth/signature`, GET `/auth/signature` bypassed `authenticate` middleware → no revocation check. Revoked tokens worked. Now use `authenticate`. | `Backend/routes/Auth/authRoutes.js` |
| 11 | **R7at-FIX-11** | **CRITICAL** | `PatientBill.pre("save")` burned billNumber on every DRAFT — IT-Rule-46 gap-less broken. Now only assigns billNumber on non-DRAFT new bills. | `Backend/models/PatientBillModel/PatientBillModel.js` |
| 12 | **R7at-FIX-12** | **CRITICAL** | `admissionController.dischargePatient` reducer did Decimal128+Number string concat → tiny IPD bills silently stayed PARTIAL. Now uses `toNum()`. | `Backend/controllers/Patient/admissionController.js` |
| 13 | **R7at-FIX-13** | HIGH | Missing index on `billGeneratedAt` — R7as-FIX-6 introduced collscan on every GST register view. Added compound `{billGeneratedAt:-1, billStatus:1}`. | `PatientBillModel.js` |
| 14 | **R7at-FIX-14** | MED | BillingAudit.retainUntil declared but no TTL index → unbounded growth past 7y. Added TTL safety net. | `BillingAudit.js` |
| 15 | **R7at-FIX-15** | HIGH | RefundsTab Refunded-bills query ignored date window → 3 panels showed inconsistent windows. Now threads from/to. | `AccountsConsole.jsx` |

---

## R7as fixes verification (10 agents independently confirmed)

| R7as fix | Status | Verified by |
|----------|--------|-------------|
| FIX-1 — TDZ ReceptionBilling | ✓ WORKS | D4, D9 |
| FIX-2 — stuck-trigger sweeper audit-only | ✓ WORKS | D5, D10 |
| FIX-3 — ServiceMaster/InvestigationMaster/VitalSheet gates | ✓ WORKS | D2, D3 |
| FIX-4 — discharge-day flush bypass | ✓ WORKS | D1, D5 |
| FIX-5 — GST period lock auto-shifts CN date | ✓ WORKS | D6 |
| FIX-6 — GST register on billGeneratedAt | ✓ WORKS but missing index (fixed in R7at-FIX-13) | D6, D8 |
| FIX-7 — generateFinalBill retry + reservation | ✓ WORKS (idempotent re-entry tightened in R7at-FIX-9) | D5, D7 |
| FIX-8 — CashierSession openSession 11000 → 409 | ✓ WORKS | D2, D7 |
| FIX-9 — MRD in Frontend ROLES | ✓ WORKS | D3 |
| **FIX-10 — JWT fullName LRU** | ✗ **BROKEN** | D1, D2, D3, D7, D8 (fixed in R7at-FIX-7) |
| FIX-11 — MLC/NursingAssessments/Safety gates | ✓ WORKS | D2, D3 |

---

## Remaining critical findings (P0 for R7au)

| # | Code | Source | Where | What |
|---|------|--------|-------|------|
| C1 | D1-CRIT | D1 | `userModel.js:275-307` | `employeeId` countDocuments race — concurrent registrations both write N+1 → E11000 |
| C2 | D1-CRIT | D1 | `InvestigationMasterModel.js:111-119` | InvestigationCode generation race |
| C3 | D5-HIGH | D5 | `autoBillingService.js:709-779` | onMARAdministration creates fresh trigger instead of consuming reservation — pharmacy DOUBLE-COUNT (still open) |
| C4 | D5-HIGH | D5 | `billingController.js:1207-1220` | TPA shortfall PATIENT-mode doesn't zero `tpaPercent` — percentage policies lose shortfall on next save |
| C5 | D5-HIGH | D5 | `billingService.js:348-414` | cancelBillItemOrder / completeBillItemOrder no terminal-state guard |
| C6 | D6-CRIT | D6 | GST snapshot 02:00 IST | 2-hour CN misattribution window on day-1 (still open — needs boundary fix) |
| C7 | D6-HIGH | D6 | `recalcTotals` | doesn't short-circuit to IGST on legacy bills with `igstAmount>0` but blank `placeOfSupply` |
| C8 | D6-HIGH | D6 | CN tax math | falls back to `bill.netAmount` when `eligibleNet=0` — pro-rates excluded items |
| C9 | D7-HIGH | D7 | `BillingTrigger.js` partial-unique | missing `orderedById` → concurrent two-doctor rounds lose one charge |
| C10 | D7-HIGH | D7 | autoBilling undoTrigger/overrideTrigger/cancelTrigger | bare `bill.save()` no retry |
| C11 | D7-HIGH | D7 | attachPackageToAdmission mass-recalc | swallows VersionError per-bill |

---

## HIGH-severity backlog by dimension (R7au punch list)

**D2 API contract**
- All 7 `?from=&to=` endpoints don't use the existing `parseHospitalDateRange` → silent full-table dump on invalid dates
- Auth routes return bare `{message}` (no `success:false`) — 13 sites
- Pagination shape drift across 4 patterns
- 6 R7as-gated routes lack `validateObjectIdParam` on `:id` routes
- `listSessions` cashierId silent-string match
- `lockGstSnapshot` period regex check happens after findOne
- Cache-Control headers missing on PHI

**D3 RBAC remaining 14 ungated routes** (priority order):
1. `Billing/TPAServiceBilling.js` → `billing.write`
2. `tpa/tpaServiceRoutes.js` → `departments.write` / `tpa.claim`
3. `Clinical/medReconciliationRoutes.js` → `rx.write`
4. `Nurse/nurseStaffRoutes.js` → `users.write`
5. `Nurse/nursingCarePlanRoutes.js` → `mar.write`
6. `Nurse/shiftHandoverRoutes.js` → `mar.write`
7. `Clinical/diabeticChartRoutes.js` → `mar.write`
8. `Equipment/equipmentRoutes.js` → `ward.equipment`
9. `Appointment/appointmentRoutes.js` → `reception.register`
10. `Admin/adminOpsRoutes.js` → migrate to `adminOnly`
11. `nursing/nursingChargesRoutes.js` → `billing.manual-charge`
12. `Clinical/twoFactorRoutes.js` → OTP limiter mount path fix
13. `Presence/presenceRoutes.js` → `users.read`/`presence.write`
14. `ai/aiRoutes.js` → new `ai.use` (all clinical)

**Plus**: phantom permissions cleanup (`billing.discount`, `reports.financial`, `reports.clinical`); OTP limiter path mismatch (`/api/auth/2fa` vs `/api/2fa`).

**D4 React** — top-20 inline-style extractions, AbortController on 8 AccountsConsole tabs + 8 polling effects, modal a11y (12 ReceptionBilling modals), money.js gaps in DischargeQueue/IPDBillingLedger.

**D5 billing** — pharmacy double-count (HIGH), TPA % shortfall lost (HIGH), state-machine gaps on cancel/completeBillItemOrder (HIGH), `recordPayment.before.billStatus` hard-coded, `voidPayment` doesn't refuse on already-refunded, daily cron excludes "Transferred" admissions.

**D6 GST/compliance** — snapshot 2h window misattribution, register CGST/SGST split ignores per-item IGST, recalcTotals IGST fallback, CN tax math when eligibleNet=0, sequenceAudit year-rollover blindness, listGstSnapshots overlap test, hsnSacCode never populated, BillingAudit retainUntil should be per-event-class.

**D7 concurrency** — `runValidators:true` on PatientAdvance findOneAndUpdate, undoTrigger/overrideTrigger/cancelTrigger no retry, recordRefund 2nd-leg compensation gap, generateFinalBill concurrent-call gap (two callers each burn a number).

**D8 perf** — caches on revenue/aging/gst-register (no caching today), payload bloat (computeCollectionSummary loads 50-100 MB per miss), N+1 populate on listCreditNotes/listAdvanceRefunds, lruCache pm2-cluster inconsistency.

**D9 UX** — IPDBillingLedger AuditView charge-only (NABH AAC.7 gap), 105 inline styles ReceptionBilling + 156 AccountsConsole, `printConsolidatedFinalBill` + `printGatePass` bypass openPrint, DischargeQueue overage chip non-interactive, 9× `window.confirm()` anti-pattern.

**D10 cron** — stuck-trigger sweeper `stuckCount` only reports sample size (50) not true backlog; observability metrics missing.

---

## Status snapshot

| Bucket | Count |
|--------|-------|
| R7as fixes verified working | 10/11 |
| R7as fix needing R7at follow-up | 1 (FIX-10) — closed in R7at-FIX-7 |
| New CRITICAL findings (caught by R7at) | 3 (FIX-7, FIX-10, FIX-11, FIX-12) |
| R7at fixes landed this commit | 15 |
| Remaining CRITICAL items (R7au) | 11 |
| Remaining HIGH items (R7au) | ~50 |
| Remaining MEDIUM items (R7au) | ~80 |

*R7at complete. 21 May 2026.*
