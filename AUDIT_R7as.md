# R7as — 10-Dimension Deep Audit + Critical Fixes

**Scope:** Receptionist + Billing + Accounts & Finance + RBAC (user-flagged dimension).
**Method:** 10 parallel agents, orthogonal dimensions (D1–D10).
**Inputs:** Branch `claude/romantic-blackwell-6a8e35` at commit `97f5830` (post-R7ar).
**Saved 21 May 2026 (IST).**

## Headline

The 10-dimension sweep surfaced **~120 distinct findings** including **6 truly CRITICAL** (silent revenue leakage, security holes, blank-page crash). R7as commit lands the worst 11 fixes. ~100 items remain for R7at/R7au — punch list below.

The R7ar commit introduced 2 regressions caught here:
1. **TDZ ReferenceError in ReceptionBilling** — user-reported "blank screen on /accounts → Open" — load() referenced loadTodaySummary before it was declared. Every /reception-billing render crashed. **Fixed in this batch.**
2. **Discharge-day charges silently LOST** — P1-21 moved flush AFTER admission.save({status:Discharged}); createTrigger then rejected every charge as "billing closed". Revenue leakage on every IPD discharge since R7ar shipped. **Fixed in this batch.**

---

## Fixes landed in R7as (11 items)

| # | Code | Severity | Finding | Where |
|---|------|----------|---------|-------|
| 1 | **R7as-FIX-1** | CRITICAL | ReceptionBilling TDZ ReferenceError (load → loadTodaySummary) — blank /accounts open | `ReceptionBilling.jsx` |
| 2 | **R7as-FIX-2** | CRITICAL | Stuck-trigger sweeper silently flipped pending-review→completed without re-running billing (revenue leakage). Now audit-emit only. | `Backend/index.js` |
| 3 | **R7as-FIX-3** | CRITICAL | ServiceMaster, InvestigationMaster, VitalSheet CRUD ungated — any role could rewrite tariffs or vitals | 3 route files |
| 4 | **R7as-FIX-4** | CRITICAL | Discharge-day bed/nursing/package charges LOST after P1-21 — `_dischargingFlush:true` bypass | `autoBillingService.js`, `admissionService.js` |
| 5 | **R7as-FIX-5** | CRITICAL | GST period lock was COSMETIC — CN posted in locked period. Now CN auto-dates to current month + amendment note. | `billingService.js` |
| 6 | **R7as-FIX-6** | HIGH | `getHospitalGstRegister` used editable `billDate` vs cron's immutable `billGeneratedAt` — period attribution drift | `billingController.js` |
| 7 | **R7as-FIX-7** | HIGH | `generateFinalBill` burned invoice numbers on VersionError (IT Rule 46 gap risk). Now retries + reuses reserved number. | `billingService.js` |
| 8 | **R7as-FIX-8** | HIGH | CashierSession openSession 11000 → 500 instead of 409 | `cashierSessionController.js` |
| 9 | **R7as-FIX-9** | HIGH | MRD role missing from Frontend ROLES catalogue (admin create-user UI couldn't pick it) | `permissions.js` |
| 10 | **R7as-FIX-10** | HIGH | JWT lacked `fullName` → audit-trail rows lost cashier names. Now resolved via short-TTL LRU. | `auth.js` |
| 11 | **R7as-FIX-11** | HIGH | MLC + NursingAssessments + Safety break-glass ungated (PHI / medico-legal). Now gated. | 3 route files |

---

## Critical findings deferred (P0 for R7at)

| # | Code | Source | Where | What |
|---|------|--------|-------|------|
| C1 | D1-CRIT-1 | D1 | `userModel.js:275-307` | `employeeId` countDocuments race — concurrent registrations both write N+1 → E11000 |
| C2 | D1-CRIT-2 | D1 | `admissionController.js:691-693` | `Number + Decimal128 = "0100.00"` string concat — billStatus flip broken on tiny IPD bills |
| C3 | D1-CRIT-3 | D1 | `InvestigationMasterModel.js:111-119` | investigationCode generation countDocuments race |
| C4 | D6-CRIT-3 | D6 | `index.js:215-272` | GST snapshot 02:00 IST cron leaves a 2-hour misattribution window for CNs |
| C5 | D5-HIGH-1 | D5 | `autoBillingService.js:709-779` | onMARAdministration creates fresh trigger instead of consuming the reservation — pharmacy DOUBLE-COUNT |
| C6 | D5-HIGH-2 | D5 | `billingController.js:1207-1220` | TPA shortfall PATIENT-mode doesn't zero `tpaPercent` — percentage policies lose shortfall |
| C7 | D5-HIGH-5 | D5 | `billingService.js:348-414` | cancelBillItemOrder ignores terminal bill states; completeBillItemOrder doesn't auto-flip PAID→PARTIAL |
| C8 | D2-HIGH-1 | D2 | All `?from=&to=` endpoints | Silent full-table dumps on invalid date (parseHospitalDateRange exists but unused) |
| C9 | D7-CRIT-1 | D7 | `autoBillingService.js:1409-1433` | attachPackageToAdmission mass-recalc swallows VersionError per-bill |

---

## HIGH-severity findings — RBAC remaining route gates (R7at)

These 14 routes still accept writes from any authenticated user:

| # | Route | Suggested gate |
|---|-------|----------------|
| 1 | `Backend/routes/Billing/TPAServiceBilling.js:11` | `billing.write` or `tpa.pre-auth` |
| 2 | `Backend/routes/tpa/tpaServiceRoutes.js` (POST/PUT/DELETE) | `tpa.claim` |
| 3 | `Backend/routes/Appointment/appointmentRoutes.js:5-9` | `reception.register` |
| 4 | `Backend/routes/Equipment/equipmentRoutes.js:9-14` | `ward.equipment` |
| 5 | `Backend/routes/Nurse/nurseStaffRoutes.js:6-12` | `users.write` |
| 6 | `Backend/routes/Nurse/nursingCarePlanRoutes.js:8-13` | `mar.write` |
| 7 | `Backend/routes/Nurse/shiftHandoverRoutes.js:9-24` | `mar.write` |
| 8 | `Backend/routes/Clinical/diabeticChartRoutes.js:11-19` | `mar.write` |
| 9 | `Backend/routes/Clinical/medReconciliationRoutes.js:6-10` | `rx.write` |
| 10 | `Backend/routes/Clinical/twoFactorRoutes.js:5-6` | match underlying flow gate |
| 11 | `Backend/routes/Presence/presenceRoutes.js:5-7` | `users.read` or new `presence.write` |
| 12 | `Backend/routes/ai/aiRoutes.js:7` | new `ai.chat` (all clinical roles) |
| 13 | `Backend/routes/Admin/adminOpsRoutes.js:12-16` | migrate ad-hoc `requireAdmin` → `adminOnly` |
| 14 | `Backend/routes/nursing/nursingChargesRoutes.js:8-14` | migrate legacy `authorize()` → `requireAction("billing.manual-charge")` |

Also: `Auth/me + signature` bypass the global authenticate → revocation list not checked (D3-MEDIUM).

---

## HIGH severity by dimension (deferred to R7at)

**D4 React frontend**
- ReceptionBilling — **105 inline styles** (R1 violation)
- AccountsConsole — 117+ inline styles
- `PatientLookupPage` AbortController dead code inside `useCallback`
- `DischargeQueue`, `IPDBillingLedger`, `ReceptionDashboard` still use raw `Number()` for Decimal128 — R7ar-P1-14 gaps
- AccountsConsole date-picker effects: no AbortController → stale-response race
- Modals (IPDBillingLedger Add Charge, ReasonModal) lack Escape close + focus trap + `role=dialog`
- `printConsolidatedFinalBill` + `receiptHTML` + `printGatePass` bypass `openPrint` registry (R14 violation)

**D5 billing engine**
- `bulkSettleByUHID` afterSnap audit doesn't run `recalcTotals()` first → audit drift on PARTIAL bills with prior extraDiscount
- `applyAdvanceToBill` + `bulkSettleByUHID` don't invalidate Day Book cache
- `recordPayment.before.billStatus` hard-coded "PARTIAL" — wrong for first-payment-clears-bill
- `voidPayment` doesn't refuse when a refund row already references the original payment
- `runDailyBedChargeAccrual` excludes status=Transferred admissions (lost transfer-day charges)

**D6 Accounts/GST/Compliance**
- GST register pipeline hard-codes 50/50 CGST/SGST — ignores per-item igstAmount → inter-state mis-reported
- `SHIFT_AUTO_CLOSED` audit emits even when `s.save()` fails (misleading audit row)
- `recalcTotals` doesn't short-circuit to IGST on legacy bills with `igstAmount>0` but blank `placeOfSupply`
- CN tax math falls back to `bill.netAmount` when `eligibleNet=0` → can pro-rate excluded items
- `sequenceAudit` blind to year-rollover CN gaps
- `listGstSnapshots` from-to is `$lte/$gte` AND — should be overlap test
- `CreditNote.pre("save")` uses server-clock year — IST/UTC rollover edge
- All hospital CNs hard-code `reasonCode:"03"`
- `hsnSacCode` schema field never populated by any emitter
- `BillingAudit.retainUntil` uniformly 7y for clinical+financial

**D7 concurrency**
- IPD Live Ledger undoTrigger / overrideTrigger / cancelTrigger paths run `bill.save() + trigger.save()` with no retry
- 5 simpler service methods skip retry (addService, completeBillItemOrder, cancelBillItemOrder, removeItemFromBill, updateItemQuantity, addNurseCharge)
- `tpaDeny` / `updateTPAClaimStatus` no retry, no state-machine guard
- `recordRefund` second-leg PatientAdvance.create runs outside retry → compensation gap
- 30-min lock TTL may expire during slow accrual

**D8 performance**
- Day Book cache doesn't invalidate on backdated payments
- `computeCollectionSummary` no `.select()` — loads full bill docs (50-100 MB per miss)
- `getRevenueBreakdown`, `getAging`, `getHospitalGstRegister`, `listCreditNotes`, `listAdvanceRefunds` — no cache, no pagination, full populate
- `BillingAudit.retainUntil` declared but no TTL index
- `listBillingAudit` returns 12 KB blobs × 500 rows = 6 MB payload
- `lruCache` is in-process — pm2 cluster causes inconsistency

**D9 UX/NABH**
- IPDBillingLedger AuditView is charge-only — misses payments, refunds, advances, voids, shift open/close, CN
- DischargeQueue overage chip is non-interactive
- ReceptionConsole doesn't auto-route to billing after registration
- RefundsTab has 3 independent windows — no end-of-day single picture
- DischargeQueue printGatePass bypasses unified print system
- Many `window.confirm()` usages in Reception (anti-pattern)
- Icon-only buttons have no aria-label

**D10 cron**
- Boot-catchup uses `cron:daily-accrual:boot` lock vs daily's `cron:daily-accrual` — still divergent post-P1-19
- Boot-catchup lock not released on success (leaks for 10 min)
- GST snapshot cron emits no audit row
- EOD Day Book uses UTC `dayStr` (drift past UTC midnight)
- Shift-auto-close forces variance=0 — P1-22 didn't actually implement variance
- No cron observability (last-run-at)

---

## Status snapshot

- **TDZ user bug**: ✓ FIXED + already synced to LIVE — refresh browser to verify `/accounts → Open` works
- **Discharge-day revenue leakage**: ✓ FIXED in this commit (P1-21 regression closed)
- **GST period lock**: ✓ FIXED — CN now auto-dates to current month + amendment note when target period is locked
- **GenerateFinalBill burn**: ✓ FIXED — retry reuses the reserved bill number
- **Top 6 RBAC route gates**: ✓ FIXED (ServiceMaster, InvestigationMaster, VitalSheet, MLC, NursingAssessments, Safety)
- **14 RBAC routes remaining**: deferred to R7at
- **Total findings**: 120+ across 10 dimensions

*R7as complete (this commit). 21 May 2026.*
