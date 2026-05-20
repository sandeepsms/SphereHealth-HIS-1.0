# R7ar — 25-Item Remediation Sprint (P0 + P1 + P2)

**Goal:** Close every prioritised item from the R7aq deep re-audit (140 findings, 25 actionable P0/P1/P2 items).
**Outcome:** 25 / 25 items landed across 19 files. Commit 35743b4 covered the 6 P0 + 7 P1 starter set; this batch closes the remaining 12 P1 + selected high-value P2.

*Saved 20 May 2026 (IST). Worktree `romantic-blackwell-6a8e35`.*

---

## P0 — CRITICAL (closed in commit 35743b4)

| # | Code | Finding | Where |
|---|------|---------|-------|
| 1 | P0-1 | JWT `id` vs `_id` mismatch → 12 endpoints broken | `middleware/auth.js` |
| 2 | P0-2 | 9 ungated billing write routes | `routes/Billing/billingRoutes.js` |
| 3 | P0-3 | F13 GST register reads non-existent field | `billingController.js` |
| 4 | P0-4 | F36 dormant — package never sets excludedByPackage | `autoBillingService.js`, `PatientBillModel.js` |
| 5 | P0-5 | Refund-to-advance double-counted in Day Book | `PatientAdvanceModel.js`, `billingService.js` |
| 6 | P0-6 | byMode case-drift bucket duplicates | `billingController.js` |

## P1 — HIGH (closed in this batch)

| # | Code | Finding | Where |
|---|------|---------|-------|
| 7 | P1-7 | Day Book cache stayed stale 30s after writes | `billingController.js`, `billingService.js`, `patientAdvanceService.js` |
| 8 | P1-8 | Day Book defaulted to YESTERDAY at IST 00:35 | `billingController.js` |
| 9 | P1-9 | Date-range helpers + strict YYYY-MM-DD validation | `utils/queryGuards.js` |
| 10 | **P1-10** | **ShiftTab on localStorage → CashierSession API** | `AccountsConsole.jsx` |
| 11 | P1-11 | closeSession aggregated across cashiers | `cashierSessionController.js` |
| 12 | **P1-12** | **Day Book frontend missing 4 cash-flow tiles** | `AccountsConsole.jsx` |
| 13 | P1-13 | ReceptionBilling "Today" tile mount-only refresh | `ReceptionBilling.jsx` |
| 14 | **P1-14** | **money.js migration across 7 pages** | 7 pages |
| 15 | **P1-15** | **CreditNote listing endpoint + Refunds tab UI** | `billingController.js`, `billingRoutes.js`, `AccountsConsole.jsx` |
| 16 | **P1-16** | **CreditNote tax pro-rata over-attribution** | `billingService.js` |
| 17 | **P1-17** | **VersionError retry on 5 missing sites** | `billingController.js`, `billingService.js` |
| 18 | P1-18 | BillingTrigger dedup ignored `pending-review` | `autoBillingService.js` |
| 19 | **P1-19** | **Cron lock atomicity + holder UUID** | `cronScheduler.js` |
| 20 | **P1-20** | **Cron BillingAudit emits + retention archiver** | `index.js`, `cashierSessionController.js`, `BillingAudit.js` |
| 21 | **P1-21** | **flushDailyChargesForAdmission moved after TX** | `admissionService.js` |
| 22 | P1-22 | Shift-auto-close compute real variance | `index.js` |
| 23 | **P1-23** | **GST monthly snapshot frozen table** | new `GstMonthlySnapshot.js`, `index.js`, `billingController.js`, routes |
| 24 | **P1-24** | **DischargeQueue overage UI badge + OVERAGE_DETECTED audit** | `DischargeQueue.jsx`, `reception-shared.css`, `admissionService.js` |
| 25 | **P1-25** | **AdvanceRefundReceipt template + RefundAdvanceModal wire** | already wired in R7ao — verified |

(Bold rows = newly landed this batch.)

## P2 — Selected items closed this batch

| # | Code | Finding | Where |
|---|------|---------|-------|
| 26 | **P2-28** | **TDS subtracted from netCashFlow** | `billingController.js` |
| 27 | **P2-37** | **Stuck-trigger retry sweeper cron** | `index.js` |
| 28 | **P2-39** | **PatientAdvance UHID regex validation** | `PatientAdvanceModel.js` |
| 29 | **P2-40** | **BillingAudit before/after blob size cap (12 KB)** | `BillingAudit.js` |

P2 items deferred (low-value or out-of-scope for this sprint):
26 runValidators sweep · 27 single-summary endpoint adoption · 29 RefundAdvanceModal CAS-race UX · 30 caching for revenue/aging · 31 populate→$lookup · 32 pagination · 33 response shape · 34 enum endpoint · 35 ErrorBoundary key bump · 36 GST card skeleton · 38 visibilityState pause

---

## Architecture changes (worth knowing)

### `GstMonthlySnapshot` model (new)
One frozen row per `period: "YYYY-MM"`. Written by the 1st-of-month-02:00-IST `gst-monthly-snapshot` cron. Has `lockedAt` / `lockedBy` for the accountant's post-GSTR-1 lock toggle. When `lockedAt` is set, `recordRefund` adds a "period LOCKED; reconcile via amendment" note to the credit-note `reasonText` instead of failing.

Endpoints:
- `GET  /api/billing/gst-snapshots?from=&to=` — list
- `POST /api/billing/gst-snapshots/:period/lock` — flip `lockedAt` + cascade `periodLocked:true` on CreditNotes
- `GET  /api/billing/gst-register` — now returns `totals.net*` (gross − reversals) + `snapshots` array

### `CreditNote` listing
`GET /api/billing/credit-notes?from=&to=&UHID=&billNumber=&reasonCode=`. Surfaced in Accounts → Refunds tab with total + tax-reversed footer.

### BillingAudit enum additions
`SHIFT_OPENED`, `SHIFT_CLOSED`, `SHIFT_AUTO_CLOSED`, `CRON_RECONCILED`, `OVERAGE_DETECTED`.

### Cron map (now 7 daily jobs, all IST-anchored + Mongo-locked)
| Job | Time IST | Purpose |
|-----|----------|---------|
| daily-accrual | 00:30 | Auto-bill bed/nursing/visit charges |
| advance-pool-recon | 00:15 | Sum `amount = applied + refunded + unspent` invariant check |
| gst-monthly-snapshot | 02:00 (1st only) | Freeze prev month into `GstMonthlySnapshot` |
| eod-day-book | 23:55 | Today's cash-in/refund-out aggregate log |
| shift-auto-close | 23:50 | Auto-close shifts open > 16h with real variance + audit emit |
| billing-audit-archive | 03:30 (Sun only) | Move expired `BillingAudit` rows → cold archive |
| stuck-trigger-sweeper | 01:00 | Re-flow BillingTrigger stuck in `pending-review` > 60 min |

### Distributed lock atomicity (P1-19)
`acquireLock` collapsed to one `findOneAndUpdate({_id:name, expiresAt:{$lt:now}}, {$set:...}, {upsert:true})`. Doc-missing → upsert wins; doc-expired → filter matches + rotates; doc-live → DuplicateKey (11000) → loses. Holder includes `crypto.randomUUID()` so K8s pods with shared hostname can't claim each other's locks.

### TPA / Cancel / Settlement-adjust retry semantics (P1-17)
All five mutation paths (`voidPayment`, `bulkCollectByUHID` per-leg, `settlementAdjust`, `cancelBill`, `tpaSettle`) now wrap load+mutate+save in `retryVersionError`. Bulk-collect surfaces per-bill `skipped[]` in the response so cashier sees what fell through. Audit emit is outside the retry block so a benign concurrent write doesn't double-emit.

### Day Book tiles (P1-12)
Surfaced existing backend fields the frontend never rendered: `advanceDepositsIn`, `advanceRefundsOut`, `billRefundsOut`, `netCashFlow` (= collections − refunds − TDS deductions).

### ShiftTab API migration (P1-10)
`/api/cashier-sessions/current|open|/:id/close|?limit=N`. Closed sessions persist Mongo-side; ShiftHistory reads from there with `closedByCron` flag. Variance-note gate requires note when |variance| > ₹0.50.

---

## Files touched this batch

```
Backend/
  controllers/Billing/billingController.js       — cancelBill, tpaSettle, listCreditNotes, listGstSnapshots, lockGstSnapshot, TDS, register reversals
  controllers/Billing/cashierSessionController.js — SHIFT_OPENED/CLOSED audit
  services/Billing/billingService.js              — settlementAdjust + bulkCollect retry, CN period-lock note, cache invalidate
  services/Patient/admissionService.js            — OVERAGE_DETECTED audit
  models/Billing/BillingAudit.js                  — 5 enum additions + blob size cap
  models/Billing/GstMonthlySnapshot.js (NEW)
  models/PatientBillModel/PatientAdvanceModel.js  — UHID regex
  utils/cronScheduler.js                          — atomic lock + UUID holder
  routes/Billing/billingRoutes.js                 — gst-snapshots + credit-notes
  index.js                                        — gst-snapshot cron rewrite, audit-archive, stuck-trigger sweep, shift-auto-close audit

Frontend/
  pages/accounts/AccountsConsole.jsx              — Day Book tiles, ShiftTab API, ShiftHistory API, Credit Notes section, toMoney imports
  pages/billing/IPDBillingLedger.jsx              — toMoney import
  pages/doctor/OPDAssessmentPage.jsx              — toMoney import
  pages/patient/PatientLookupPage.jsx             — toMoney import
  pages/reception/DischargeQueue.jsx              — overage chip
  pages/reception/ReceptionBilling.jsx            — toMoney sweep (8 sites)
  pages/reception/ReceptionConsole.jsx            — toMoney import
  pages/reception/ReceptionDashboard.jsx          — toMoney replaces local shim
  pages/reception/reception-shared.css            — .rx-card-stage--overage style
```

## Headline

R7ar is complete. The /accounts module + billing engine + reception desk now hold:

1. **Atomic money writes** — every mutation path retries on VersionError instead of 500ing.
2. **NABH-grade audit trail** — every shift open/close/auto-close + cron reconciliation lands in `BillingAudit`. before/after blobs capped at 12 KB.
3. **GST period lock** — accountant can freeze a month after filing; CN issuance against locked periods adds an amendment note (never silently mutates the filed total).
4. **Distributed cron safety** — single-roundtrip atomic lock, UUID-tagged holder, 7 IST-anchored jobs.
5. **Cash-flow truth in Day Book** — netCashFlow now nets out TDS deductions + advance refunds; tiles render the four flow fields the backend was already computing.
6. **Cross-device cashier shifts** — open on terminal A, close from terminal B; variance audit-trailed; auto-close at 23:50 IST + Sunday 03:30 archiver.

Pending P2 (deferred): cache layers on aging/gst-register, populate→$lookup on listAdvanceRefunds, ErrorBoundary key bump, hospital-GST loading skeleton, visibilityState pause, enum endpoint for payer/visitType pills.

*R7ar complete. 20 May 2026.*
