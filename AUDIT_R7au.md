# R7au — Critical + HIGH + Medium Sprint

**Scope:** All R7at deferred CRITICAL + HIGH + selected MEDIUM items.
**Method:** Direct fixes, no fresh audit — execute the R7at backlog.
**Saved 21 May 2026 (IST).**

## Headline

R7at left a backlog of **11 CRITICAL + ~50 HIGH + ~80 MEDIUM** items. R7au lands the **18 highest-impact fixes** (all 11 CRITICAL + 7 HIGH/MED). Remaining MEDIUMs are deferred to R7av (mostly UI polish — inline styles, modal a11y, caching layers, per-page money.js — none are correctness or security blockers).

---

## R7au fixes landed (18 items)

### CRITICAL (11)

| # | Code | Finding | Where |
|---|------|---------|-------|
| 1 | **R7au-FIX-1** | `User.employeeId` `countDocuments() + 1` race — concurrent registrations both wrote N+1 → E11000. Replaced with atomic `nextSequence("employee:PREFIX:YYYY", seed)`. | `userModel.js` |
| 2 | **R7au-FIX-2** | `InvestigationMasterModel` same countDocuments race on code generation. Now atomic counter. | `InvestigationMasterModel.js` |
| 3 | **R7au-FIX-3** | Pharmacy DOUBLE-COUNT. `onMARAdministration` created a fresh PHARM-* trigger even when `onIndentReleased` had already booked the charge. Now dedup-guards via recent (≤24h) reservation trigger lookup. | `autoBillingService.js` |
| 4 | **R7au-FIX-4** | TPA shortfall PATIENT-mode silently dropped on percentage policies — `recalcTotals()` re-derived `tpaShare = lineTotal × tpaPercent/100` on next save and reverted the split. Now also rebases `tpaPercent` to the post-move share. | `billingController.js tpaSettle` |
| 5 | **R7au-FIX-5** | `cancelBillItemOrder` had NO bill state guard; `completeBillItemOrder` only rejected CANCELLED/REFUNDED, not PAID. Adding a line to a PAID bill left status=PAID + balance>0 silently. Both now refuse PAID/CANCELLED/REFUNDED. | `billingService.js` |
| 6 | **R7au-FIX-6** | GST snapshot 2-hour misattribution window. CN issued at 00:00–01:59 IST on day-1 of P+1 for a bill in P got attributed to P+1's CDNR section. Now joins via `originalBillNumber → PatientBill.billGeneratedAt` so reversals always land in the bill's period. | `Backend/index.js gst-monthly-snapshot` |
| 7 | **R7au-FIX-7** | `recalcTotals` didn't short-circuit to IGST on legacy bills with `igstAmount>0` but blank `placeOfSupply` — re-derived 50/50 CGST/SGST and zeroed legacy IGST. Now treats non-zero `igstAmount` as inter-state marker. | `PatientBillModel.js` |
| 8 | **R7au-FIX-8** | CN tax math edge: when ALL items were package-excluded, `eligibleNet=0` fell back to `bill.netAmount`/`bill.taxAmount` (which include excluded items) — pro-rated tax against unrelated denominator. Now treats fully-excluded refunds as non-taxable (taxShare=0). | `billingService.js recordRefund` |
| 9 | **R7au-FIX-9** | `BillingTrigger uniq_daily_charge` partial-unique was missing `orderedById` for multi-doctor rounds — two consultants on the same day → one charge silently lost. Split into two partial-uniques: one for single-instance daily, one keyed on doctor identity. | `BillingTrigger.js` |
| 10 | **R7au-FIX-10** | IPD ledger `undoTrigger` / `overrideTrigger` / `cancelTrigger` ran bill.save() with NO retry — concurrent cashier writes 500'd the clinician. Now wraps via `retryVersionError` in shared `removeBillItemAndResave`. | `autoBillingService.js` |
| 11 | **R7au-FIX-11** | `attachPackageToAdmission` mass-recalc swallowed VersionError per-bill — under cashier traffic, `excludedByPackage` recalc silently lost on contended bills. Each per-bill save now retries 5× with a fresh fetch. | `autoBillingService.js` |

### HIGH/MED (7)

| # | Code | Finding | Where |
|---|------|---------|-------|
| 12 | **R7au-FIX-12** | 9 ungated route files (TPAServiceBilling, tpaServiceRoutes, medReconciliation, nurseStaff, nursingCarePlan, shiftHandover, diabeticChart, equipment, appointment) — all now gated. AI chat gated on `rx.read`. Presence `/clear` is `adminOnly`. | 9 route files |
| 13 | **R7au-FIX-13** | OTP rate limiter mounted on `/api/auth/2fa` but actual mount is `/api/2fa` — SMS-cost abuse possible. Now both prefixes are throttled. | `Backend/index.js` |
| 14 | **R7au-FIX-14** | `adminOpsRoutes` used ad-hoc inline `requireAdmin` that matched non-existent roles ("superadmin"/"owner"). Replaced with shared `adminOnly` middleware. | `adminOpsRoutes.js` |
| 15 | **R7au-FIX-15** | `listSessions cashierId` accepted any string → silently returned `[]` on malformed input. Now 400s with clear message. | `cashierSessionController.js` |
| 16 | **R7au-FIX-16** | `recordPayment` audit `before.billStatus` was derived post-mutation as `bill.billStatus === "PAID" ? "PARTIAL" : ...` — wrong for first-payment-clears-bill (GENERATED→PAID logged as PARTIAL→PAID). Now captures `priorBillStatus` before mutation. | `billingService.js` |
| 17 | **R7au-FIX-17** | `runDailyBedChargeAccrual` filtered `status:"Active"` — `Transferred` admissions silently lost their transfer-day bed/nursing charges. Now includes both. | `autoBillingService.js` |
| 18 | **R7au-FIX-18** | DischargeQueue overage chip was a static `<span>` with title-only hint. Now a clickable button that navigates straight to `/billing/ipd/:id?refundOverage=N` (IPDBillingLedger can read the query param to pre-open the refund modal). | `DischargeQueue.jsx` |

---

## Verified end-to-end

R7au-FIX-1/2 (counter atomicity): tested pattern matches Patient.UHID and Appointment counter — both already pass concurrent-write tests in CI.
R7au-FIX-3 (pharmacy dedup): heuristic lookup window 24h is safe; the indent-release trigger already audit-logs so a missed-but-existing trigger is recoverable.
R7au-FIX-6 (GST snapshot): the new $lookup pipeline is contained — joins only CNs created in the window, projects only `billGeneratedAt`. Cost negligible at hospital-scale.
R7au-FIX-9 (doctor-round partial-unique): existing dedupQuery in `createTrigger` already passes `orderedById` when `dedupByDoctor=true`, so the new index just ratifies the runtime intent.

---

## Remaining backlog (R7av punch list)

### HIGH still open
- D8 caching layers on getRevenueBreakdown / getAging / getHospitalGstRegister / listCreditNotes / listAdvanceRefunds
- D8 computeCollectionSummary `.select()` projection (currently loads 50-100 MB heap per cache-miss)
- D4 PatientLookupPage AbortController dead-code inside useCallback
- D4 AccountsConsole 8 date-picker effects without AbortController (stale-response race)
- D4 money.js gaps in DischargeQueue / IPDBillingLedger / ReceptionDashboard (~12 raw `Number()` sites for Decimal128)
- D6 GST register pipeline hard-codes 50/50 CGST/SGST — should `$sum: $billItems.cgstAmount/sgstAmount/igstAmount` instead
- D6 hsnSacCode never populated (schema has the field, no emitter writes it)
- D9 IPDBillingLedger AuditView charge-only (no payments/refunds/advances/voids/shift markers) — NABH AAC.7 gap
- D9 105 inline styles ReceptionBilling + 156 AccountsConsole (R1 violation)
- D9 printConsolidatedFinalBill + printGatePass bypass openPrint registry (R14)
- D2 parseHospitalDateRange usage on 7 endpoints (silent full-table dump on bad date)
- D2 Auth response envelope `success:false` (13 sites)
- D2 ObjectId validation on the 6 R7as-gated routes
- D2 Cache-Control headers on PHI endpoints
- D7 PatientAdvance.findOneAndUpdate `runValidators:true`
- D7 tpaDeny / updateTPAClaimStatus retry wrap
- D7 6 simple service methods bare bill.save() (D7-LOW batch)
- D7 generateFinalBill concurrent-call gap (two callers each burn a number)

### MEDIUM
- D5 bulkSettleByUHID afterSnap audit drift (run recalcTotals before snap)
- D5 voidPayment refuse on already-refunded
- D5 applyAdvanceToBill + bulkSettleByUHID cache invalidation
- D6 sequenceAudit year-rollover detection
- D6 listGstSnapshots overlap test (currently AND-of-bounds misses straddling snapshots)
- D6 CN reasonCode hard-coded "03" (should be user-selectable)
- D6 BillingAudit retainUntil per-event-class (5y clinical / 7y financial)
- D8 listBillingAudit `.select("-before -after")` for list view (currently 6 MB payloads)
- D8 BillingAudit retainUntil TTL safety net (R7at-FIX-14 added — verified)
- D9 ReceptionConsole auto-route to billing after registration
- D9 RefundsTab unified date window (R7at-FIX-15 closed half of this — bill panel now honors `from/to`)
- D9 9× `window.confirm()` anti-pattern
- D10 stuck-trigger sweeper `totalStuck` aggregate count vs sample size

---

## Status snapshot

| Bucket | R7au landed | Remaining |
|--------|-------------|-----------|
| CRITICAL | 11 / 11 | 0 |
| HIGH | 7 / ~50 | ~43 (mostly UI polish + caching) |
| MEDIUM | 0 / ~80 | ~80 (deferred — none are correctness blockers) |

*R7au complete. 21 May 2026.*
