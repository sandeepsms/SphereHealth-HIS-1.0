# R7aq — Deep Re-Audit Post R7ap (Billing + Reception + Accounts)

**Method:** 10-dimension parallel deep audit (same protocol as R7ap), broader scope.
**Trigger:** Re-audit after R7ap commit `313b864` to verify fixes held + look for regressions.
**Result:** **140 NEW findings** discovered. Several R7ap fixes don't actually work end-to-end.

---

## R7ap fix verification — corrected status

R7ap claimed 37 fixes complete. Re-audit reveals:

| F | Title | Actual status | Evidence |
|---|---|---|---|
| F1 | Decimal128 unwrap (6 endpoints) | ✅ WORKING | D1 verified |
| F2 | ADVANCE_ADJUSTMENT exclusion | ✅ WORKING | Day Book recon clean |
| F3 | todayRevenue $unwind | ✅ WORKING | D2 confirmed |
| F4 | Rewire dead Open buttons | ✅ WORKING | D9 verified |
| F5 | Auth gates on READ endpoints | ⚠️ PARTIAL | 9 WRITE routes still ungated (D3-aq-02/03) |
| F6 | IPD ledger advance balance | ✅ WORKING | D2 verified |
| F7 | Atomic refundAdvance CAS | ⚠️ PARTIAL | Invariant skipped on findOneAndUpdate (D1-aq-05) |
| F8 | optimisticConcurrency PatientAdvance | ✅ WORKING | But invariant only fires on save() |
| F9 | Atomic bill-number generator | ✅ WORKING | D2 verified |
| F10 | BillingTrigger partial-UNIQUE | ⚠️ PARTIAL | Dedup query doesn't include `pending-review` status (D1-aq-06) |
| F11 | Advance refund endpoint | ✅ WORKING | But populate is N+1 (D8-aq-03) |
| F12 | Day Book Cash In/Out tiles | ⚠️ PARTIAL | Backend has them; **frontend never renders** the 4 new tiles (D5-aq-15) |
| F13 | Hospital GST aggregator | ❌ **BROKEN** | Reads non-existent `billItems.taxableAmount` → returns ₹0 (D1-aq-02) |
| F14 | 5 compound indexes | ✅ WORKING | |
| F15 | BillingAudit + 8 emits | ⚠️ PARTIAL | 7 events still don't emit (D5-aq-04/06/13, D10-aq-03) |
| F16 | money.js shared util | ⚠️ PARTIAL | Adopted on only 1 of 8 pages (D9-aq-01) |
| F17 | UHID summary endpoint | ⚠️ PARTIAL | **Zero frontend consumers** (D9-aq-06) |
| F18 | HSN/SAC/GSTIN schema | ⚠️ PARTIAL | No UI to populate (D6-aq-01) |
| F19 | CreditNote flow | ❌ **BROKEN** | No listing endpoint; not in GSTR register; pro-rata tax math wrong (D1-aq-08, D2-aq-07, D5-aq-05) |
| F20 | CashierSession backend | ❌ **BROKEN** | (a) JWT id≠_id (D3-aq-01) (b) Frontend still localStorage (D5-aq-11) (c) Window query unscoped per cashier (D1-aq-07) |
| F21 | IST cron + lock | ⚠️ PARTIAL | 2-step lock race; boot vs daily different lock names (D7-aq-04, D10-aq-01) |
| F22 | ErrorBoundary | ✅ WORKING | Retry doesn't remount but cosmetic (D4-aq-10) |
| F23 | Response shape | ⚠️ PARTIAL | Only tpa-cases + advance fixed; 4 other endpoints still inconsistent (D3-aq-11) |
| F24 | LRU cache | ⚠️ PARTIAL | No invalidation hooks on any mutation (D2-aq-02) |
| F25 | ObjectId validation | ✅ WORKING | |
| F26 | VersionError retry | ⚠️ PARTIAL | Only applied to tpaApprove. 5 writes still raw (D7-aq-01) |
| F27 | payments.paidAt attribution | ✅ WORKING | |
| F28 | TDS fields | ⚠️ PARTIAL | Schema added but not subtracted from netCashFlow + no UI (D5-aq-03) |
| F29 | gst-monthly-snapshot cron | ❌ **STUB** | Counts only, no frozen snapshot table (D10-aq-11) |
| F30 | eod-day-book cron | ❌ **STUB** | Logs only, no PDF/email |
| F31 | advance-pool-recon cron | ⚠️ PARTIAL | Logs only, no audit emit (D10-aq-04) |
| F32 | shift-auto-close cron | ❌ **DEFECTIVE** | Forces variance=0, masking real shortages (D10-aq-02) |
| F33 | BillingAudit retainUntil | ⚠️ PARTIAL | Field added but no archiver cron (D10-aq-12) |
| F34 | sequence audit endpoint | ✅ WORKING | But no scheduled run |
| F35 | IGST in pre-save | ⚠️ PARTIAL | Pre-save splits; aggregator pipeline ignores placeOfSupply (D2-aq-08) |
| F36 | excludedByPackage filter | ❌ **DORMANT** | Schema + filter shipped but `attachPackageToAdmission` NEVER sets the flag (D5-aq-08) |
| F37 | dischargeOverage detection | ⚠️ PARTIAL | Field set but no UI consumer + no audit (D5-aq-10) |

**Scorecard: 12 fully working / 19 partial / 6 broken.**

---

## R7aq findings by dimension

| Dim | Status | Count | Critical findings |
|---|---|---|---|
| D1 — DB schemas | ✅ | 17 | F13 reads non-existent field (CRIT); F36 ignored by recalcTotals (CRIT); excludedByPackage not honoured in receipt totals |
| D2 — Service math | ✅ | 14 | byMode case drift CASH≠Cash (CRIT); LRU never invalidated (HIGH); UTC vs IST midnight (HIGH) |
| D3 — API/security | ✅ | 18 | JWT id≠_id (CRIT); 9 write routes ungated (CRIT); date-param injection on 7 endpoints |
| D4 — Frontend | ✅ | 24 | money.js 1 of 8 pages adopted; TPA outstanding KPI uses non-existent field; ShiftTab localStorage |
| D5 — Bridge | ✅ | 17 | F36/F20 dormant (CRIT); refund-to-advance double-counts (CRIT); CreditNote orphan |
| D6 — NABH/GST | partial | 8 | No UI for GST fields; no retention archiver; 7 audit events missing |
| D7 — Concurrency | partial | 5 | Retry only on tpaApprove; invariant skipped on findOneAndUpdate |
| D8 — Perf | partial | 6 | Only 1 endpoint cached; populate N+1; $unwind storms |
| D9 — Cross-page | ✅ | 17 | F16 12% adoption; F17 zero consumers; "Today" tile still stale (D9-02 unfixed) |
| D10 — Cron | ✅ | 14 | Boot+daily different lock names; shift-auto-close fakes variance=0; flushDaily runs before TX |
| **TOTAL** | | **140** | |

By severity: ~30 CRIT · ~50 HIGH · ~40 MED · ~20 LOW.

---

## R7ar Remediation Sprint — 25 items prioritised

### Immediate Critical (P0 — must fix this hour)

**P0-1 — JWT identity bug**
- File: every controller using `req.user?._id`
- Fix: replace with `req.user?.id || req.user?._id` (or fix authMiddleware to expose both)
- Closes: D3-aq-01, F20 fully

**P0-2 — Wire missing auth gates on 9 billing write routes**
- File: `Backend/routes/Billing/billingRoutes.js`
- Add `requireAction("billing.write")` to: `POST /create`, `/:billId/add-service`, `/generate`, `/payment`, `/settlement-adjust`, `/nurse-charge`, `/uhid/:UHID/collect-all`
- Add `requireAction("billing.discount")` to: `/uhid/:UHID/bulk-settle`
- Add `requireAction("billing.override")` to: `PUT /:billId/items/:itemId`
- Add `requireAction("billing.cancel-charge")` to: `DELETE /:billId/items/:itemId`, `/cancel-order`
- Add `requireAction("reports.audit")` to: `/audit/:triggerId/confirm-bill`
- Closes: D3-aq-02, D3-aq-03

**P0-3 — F13 GST register: fix field name**
- File: `billingController.js:1673`
- Change `$sum: "$billItems.taxableAmount"` to `$sum: "$billItems.netAmount"`
- Closes: D1-aq-02

**P0-4 — F36 actually flag existing items on package attach**
- File: `autoBillingService.js:1330` (`attachPackageToAdmission`)
- Add `PatientBill.updateMany({admission, billStatus:{$in:[DRAFT,GENERATED]}}, {$set:{"billItems.$[el].excludedByPackage":true}}, {arrayFilters:[{"el.serviceCode":{$in:exclusionCodes}}]})` after creating package trigger
- Also: add reverse logic on `detachPackageFromAdmission`
- Also: make `recalcTotals` skip excluded items (D1-aq-01)
- Closes: D5-aq-08/09, D1-aq-01

**P0-5 — Refund-to-advance double-count fix**
- File: `billingService.js:1291` (second-leg PatientAdvance.create)
- Tag with `isRefundCredit:true` field on PatientAdvance OR route through `patientAdvanceService.createAdvance` with a `skipDayBook` option
- Filter `paidAt`-window advance loop in `computeCollectionSummary` to exclude isRefundCredit rows
- Closes: D5-aq-01

**P0-6 — byMode case normalisation**
- File: `billingController.js:1334, 1410, 1423`
- Seed `byMode` with UPPERCASE keys; normalise inputs via `.toUpperCase()`
- Closes: D2-aq-01

### Critical (P1 — fix this week)

**P1-7 — LRU cache invalidation**
- File: `billingController.js` — export `_collectionSummaryCache`
- Call `cache.invalidate("daybook:" + dateKey)` from `recordPayment`, `recordRefund`, `voidPayment`, `createAdvance`, `applyAdvanceToBill`, `refundAdvance`
- Closes: D2-aq-02, D5-aq-16, D9-aq-07

**P1-8 — IST date-key in Day Book + crons**
- File: `billingController.js:1297`, `index.js:227`
- Replace `new Date().toISOString().slice(0,10)` with IST-aware date-key formatter (already exists in `cronScheduler.js`)
- Closes: D2-aq-03, D10-aq-08

**P1-9 — Date-param validation across 7 endpoints**
- File: `queryGuards.js` — add `parseHospitalDate(str)` helper
- Apply to: revenue-breakdown, aging, collection-summary, audit, gst-register, advance/refunds, cashier-sessions list
- Closes: D3-aq-05, D3-aq-06

**P1-10 — Frontend ShiftTab → CashierSession migration**
- File: `AccountsConsole.jsx:735-882`
- Replace localStorage with axios calls to `/api/cashier-sessions/*`
- Closes: D5-aq-11, D4-aq-04, D9-aq-09

**P1-11 — CashierSession close window filter by cashier**
- File: `cashierSessionController.js:71`
- Add `payments.receivedById: session.cashierId` to PatientBill query, plus `receivedById` on PatientAdvance query
- Closes: D1-aq-07

**P1-12 — Day Book frontend: render 4 new Cash flow tiles**
- File: `AccountsConsole.jsx:133-138`
- Add KPI tiles for advanceDepositsIn, advanceRefundsOut, billRefundsOut, netCashFlow
- Closes: D5-aq-15

**P1-13 — ReceptionBilling "Today" tile auto-refresh**
- File: `ReceptionBilling.jsx:362`
- Lift `loadTodaySummary()` out of mount-only useEffect; call from every mutation success path (recordPayment, refund, advance)
- Closes: D9-aq-02, D4-aq-02

**P1-14 — money.js migration across 7 remaining pages**
- Files: ReceptionBilling, ReceptionDashboard, DischargeQueue, IPDBillingLedger, PatientLookupPage, RoleDashboardPage, BillingAuditTrailPage
- Replace local `fmtCur/fmtINR/inr` with imported `fmtINR0/fmtINR2/toMoney/eff`
- Closes: D9-aq-01, D4-aq-05/06/07/12/13/14, D4-aq-23

**P1-15 — CreditNote listing endpoint + GSTR register integration**
- File: `billingController.js`
- Add `GET /api/billing/credit-notes?from&to`
- Subtract CN tax from `getHospitalGstRegister` aggregation
- Closes: D5-aq-05, D6-aq-05

**P1-16 — F19 CreditNote tax pro-rata math fix**
- File: `billingService.js:1228-1232`
- Compute `taxableValue = amt × (gross - tax) / (gross + tax)` instead of `(amt / billGross) × billTax`
- Also use `eligibleTax = sum(item.taxAmount * (1 - excludedByPackage))`
- Closes: D1-aq-08, D2-aq-07

**P1-17 — F26 extend VersionError retry to 5 missing sites**
- Files: `billingService.js` (voidPayment, bulkCollectByUHID, settlementAdjust), `billingController.js` (cancelBill, tpaSettle)
- Wrap with `retryVersionError` helper
- Closes: D7-aq-01

**P1-18 — BillingTrigger dedup includes pending-review**
- File: `autoBillingService.js:413`
- Add `pending-review` to status array
- Closes: D1-aq-06, D7-aq-03

**P1-19 — Cron lock atomicity + holder uniqueness**
- File: `cronScheduler.js`
- Collapse 2-step deleteOne+create into single `findOneAndUpdate({...$or expired or missing}, {$setOnInsert:...}, {upsert:true})`
- Append `crypto.randomUUID()` to HOLDER
- Use same lock name for boot-catchup and daily cron
- Closes: D7-aq-04, D10-aq-01, D10-aq-06, D10-aq-07

**P1-20 — Cron BillingAudit emits + retention archiver**
- Add 7 events to enum: `SHIFT_OPENED`, `SHIFT_CLOSED`, `BULK_COLLECT`, `BULK_SETTLEMENT_ADJUSTED`, `OVERAGE_DETECTED`, `ITEM_VOIDED`, `PACKAGE_ATTACHED`/`DETACHED`
- Wire emits at all sites
- Add weekly retention-archiver cron
- Closes: D5-aq-04/06/13, D6-aq-04/07, D10-aq-03, D10-aq-12

**P1-21 — flushDailyChargesForAdmission after discharge TX commits**
- File: `admissionService.js:267`
- Move flush from BEFORE TX to AFTER `endSession()`
- Closes: D10-aq-09

**P1-22 — Shift-auto-close compute real variance**
- File: `index.js:267` (shift-auto-close cron body)
- Reuse `closeSession` windowed compute; mark `closedByCron: true, varianceNote: "AUTO_CLOSED_PENDING_REVIEW"`
- Closes: D10-aq-02

**P1-23 — GST monthly snapshot writes frozen table**
- File: `index.js:212` (gst-monthly-snapshot cron)
- Add `GstMonthlySnapshot` model + write totals + flip `CreditNote.periodLocked` for prior period
- Closes: D10-aq-11

**P1-24 — F37 dischargeOverage UI + audit emit**
- File: `DischargeQueue.jsx` — add overage badge + refund-confirm action
- Add `OVERAGE_DETECTED` audit emit in `admissionService.dischargePatient`
- Closes: D5-aq-10

**P1-25 — printAdvanceRefundReceipt template + wiring**
- File: new printable + wire to `RefundAdvanceModal` `onDone` callback
- Closes: D5-aq-07

### Medium / cleanup (P2 — backlog)

26. PatientAdvance pre-validate via `runValidators:true` on findOneAndUpdate (D1-aq-05)
27. Per-page migration to `/billing/uhid/:UHID/summary` consumer (D9-aq-06, D4-aq-24)
28. TDS subtracted from netCashFlow + extend fields (tdsDeductorPan, tdsDate, tdsChallanNo) (D5-aq-03, D6-aq-02)
29. RefundAdvanceModal handle CAS-race UX (D4-aq-03)
30. Add caching to getRevenueBreakdown / getAging / gst-register (D8-aq-01/02)
31. Replace populate with $lookup on listAdvanceRefunds (D8-aq-03)
32. Add pagination to getHospitalGstRegister / getUhidSummary (D8-aq-05)
33. Response shape standardise remaining 4 endpoints (D3-aq-11, D4-aq-19)
34. Hardcoded payer/visitType pills → fetch from backend enum (D9-aq-10)
35. ErrorBoundary remount on Retry via key bump (D4-aq-10)
36. Hospital GST card loading skeleton (D4-aq-12)
37. Stuck-trigger retry sweeper cron (D10-aq-13)
38. Frontend pages visibilityState pause on poll (D10-aq-14)
39. PatientAdvance UHID/GSTIN regex validation (D1-aq-15)
40. BillingAudit before/after Mixed size cap (D1-aq-11)

---

## Headline

**R7ap delivered real value** — Decimal128 unwrap, atomic refund, IPD advance balance, audit collection, IST cron, ErrorBoundary — these all work. The fix list closed many money-correctness bugs and the page is materially safer.

**But 6 of 37 fixes don't actually work end-to-end** — F13/F19/F20/F32/F36/F19. And R7ap left 9 write routes ungated + broke JWT identity assumption. The re-audit caught all 140 issues including these. **Net status of /accounts module: substantial progress, but more work remains.**

R7ar sprint = 25 prioritised items, of which 6 are P0 (CRIT — should fix today).

*R7aq complete. Saved 20 May 2026.*
