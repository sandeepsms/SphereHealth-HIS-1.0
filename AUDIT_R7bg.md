# R7bg — Pharmacist workflow + Accountant role · 10-dim deep audit (229 findings)

**Cycle**: R7bg (after R7bf closed 155 R7be findings + 4 R7bd META reships)
**Scope**: Pharmacist workflow + Accountant role through 10 orthogonal lenses (Mongo, Auth, API, React, Node, Billing, Print, NABH, Perf, Security)
**Method**: 10 parallel deep-audit agents, each given strict dimensional ownership and asked to re-verify prior-cycle "shipped" claims (META check)
**Result**: **229 findings** (66 CRIT + 96 HIGH + 67 MED)

---

## Agent ownership

| Agent | Dim | CRIT | HIGH | MED | Total |
|---|---|---:|---:|---:|---:|
| R7bg-1 | MongoDB / data integrity | 14 | 26 | 8 | 48 |
| R7bg-2 | Auth + permissions | 0 | 4 | 7 | 11 |
| R7bg-3 | API contract consistency | 12 | 12 | 6 | 30 |
| R7bg-4 | React frontend | 3 | 9 | 13 | 25 |
| R7bg-5 | Node middleware + error handling | 0 | 4 | 7 | 11 |
| R7bg-6 | Billing ledger correctness | 9 | 10 | 4 | 23 |
| R7bg-7 | Print + receipt completeness | 8 | 8 | 7 | 23 |
| R7bg-8 | NABH + regulatory | 10 | 7 | 5 | 22 |
| R7bg-9 | Performance + scale | 6 | 9 | 5 | 20 |
| R7bg-10 | Security + workflow race | 4 | 7 | 5 | 16 |
| **Total** | | **66** | **96** | **67** | **229** |

---

## META — prior-cycle "shipped" claims that are dead in practice

The most expensive findings: code that exists but was never wired, or wired against fields that don't exist. R7bd taught the team to verify META; this cycle found 5 fresh ones.

| ID | Claim | Reality |
|---|---|---|
| **R7bg-META-1** | R7bf-F PrintAudit + DUPLICATE watermark shipped (closes A4-CRIT-4/5) | Worktree-wide grep `printAudit:` returns **zero** matches outside the helper. **No callsite** passes `printAudit:{entityType,entityId}` in the openPrint payload → `recordPrintAudit()` never fires → `printCount` never increments → DUPLICATE never renders. **A4-CRIT-4 and A4-CRIT-5 are effectively NOT closed.** [R7bg-7-CRIT-1] |
| **R7bg-META-2** | R7bf-I `_refuseDeleteIfTriggersReference` guards orphan trigger refs | Guard queries `BillingTrigger.countDocuments({ linkedBillId: id })` but the field is named **`billId`**, not `linkedBillId`. countDocuments always returns 0 → guard never trips → bills with linked triggers CAN be hard-deleted. [R7bg-6-CRIT-6] |
| **R7bg-META-3** | R7bd-E Schedule X narcotics register shipped | `scheduleXRegister.recordDispense` exists, **but main `POST /api/pharmacy/dispense` does NOT detect `drug.schedule==="X"` and route through it.** Any Schedule X drug sold via the standard counter flow bypasses witness gate + register + daily balance. NDPS Act exposure. [R7bg-8-CRIT-P1] |
| **R7bg-META-4** | R7bf-H Day Book fix closes A6-CRIT-6 (reversed-refund leak) | Fix lives in `Backend/services/Reports/dayBookService.js` but **5 frontend dashboards** still call legacy `billingController.computeCollectionSummary` which doesn't use the new service. The leak persists in production. [R7bg-6-CRIT-5] |
| **R7bg-META-5** | R7bf-J vendor-misc 837KB → 44KB | Fresh `npm run build` produces 43.5KB hash ✓. But **stale `Frontend/dist/assets/vendor-misc-C0hLEsXO.js` = 857KB** still sits on disk dated 11:22 (before R7bf-J commit at 12:34). Any nginx/CDN pointing at the old hash still serves the 857KB bundle. Action: `rm -rf Frontend/dist && rebuild && redeploy`. [R7bg-9-CRIT-6] |

**Cross-checked clean (verified shipped)**:
- statusTransitionGuard.js — exists, populated, wired ✓
- CriticalValueAlertModel + service + routes — all exist + mounted ✓
- ADRReport, Grievance, FireDrill, Credential — all 4 model+controller+route quartets exist ✓
- 11 R7bf permission keys — present in both Backend/config/permissions.js AND Frontend/src/config/permissions.js ✓
- TPA state-machine guards (R7bf-I) — correctly enforced in billingController ✓

---

## CRIT roster — top 66 (by dim)

### R7bg-1 Mongo (14 CRIT)
- **R7bg-1-CRIT-1** `PharmacySaleModel.js:16-167` — **23+ money fields are `Number`**, not Decimal128. Float drift on every retail sale. (DB-CRIT-02 unshipped since R3.)
- **R7bg-1-CRIT-2** `PharmacySaleModel.js` — **No `printCount` field** → `$inc:{printCount:1}` silently no-ops on pharmacy reprints → watermark never fires.
- **R7bg-1-CRIT-3** `pharmacyController.js:920-932 cancelSale` — **load→modify→save race** on DrugBatch.remaining vs concurrent atomic `$inc` dispense; restoration clobbers the in-flight dispense.
- **R7bg-1-CRIT-4** `indentService.js:188-194 acknowledgeIndent` — load→check→mutate→save without CAS; two pharmacists ack same indent both succeed → ack-ownership downstream fires on wrong actor.
- **R7bg-1-CRIT-5** `PharmacySettingsModel.js:17,97` — Singleton broken. `{_id: "default"}` with schema option `{_id:false}` drops the explicit `_id`. Each upsert creates a new ObjectId-keyed doc → endless competing settings rows in production.
- **R7bg-1-CRIT-6** `BillingTrigger.js:19-20` — **`unitPrice + totalAmount` still `Number`**, not Decimal128. DB-CRIT-01 open since R3. Cascades into every BillItem.
- **R7bg-1-CRIT-7** `AutoBilledItemsModel.js:49,76` — same Number issue at the source of the daily cron rollup.
- **R7bg-1-CRIT-8** 6 schemas (`PrintAudit`, `CriticalValueAlert`, `ADRReport`, `Grievance`, `Credential`, `FireDrill`) ref `"Hospital"` but **`Hospital` model is never registered** anywhere → `populate("hospitalId")` throws `MissingSchemaError` first time it's called.
- **R7bg-1-CRIT-9** `BillingAudit.js:209` — TTL `expireAfterSeconds:0` on `retainUntil` plus caller-supplied retention overrides → financial audit chain can develop holes. NABH AAC.7 single timeline broken.
- **R7bg-1-CRIT-10** `PatientBillModel.js:587-606` — DRAFT compound unique partial filter excludes GENERATING state → fast retry can land two GENERATING docs for same UHID+visitType+admission.
- **R7bg-1-CRIT-11** `CreditNote.js:90-120` — Cold-start parallel writes both seed counter → duplicate `CN-2025-000001` triggers E11000 at cashier.
- **R7bg-1-CRIT-12** `gstService.js:91-118` — Pharmacy GST pipeline assumes 100% intra-state (CGST/SGST=gst/2); PharmacySale has no `placeOfSupply` field → cross-state OTC buyer gets wrong tax line on GSTR-1.
- **R7bg-1-CRIT-13** `dayBookService.js:64-167` — **Day Book Cash In excludes pharmacy revenue entirely**. Legal Bahi Khata misses 30-40% of hospital cash.
- **R7bg-1-CRIT-14** `PharmacySaleModel.js SALE_ITEM` — No CGST/SGST/IGST split per line; only total `gstAmount`. GSTR-1 line 12 (HSN) reconciliation impossible for multi-state ops.

### R7bg-3 API contracts (12 CRIT)
- **CRIT-1** `pharmacyController.js` stats/listBatches/stockRollup/listSales/getSale — **Decimal128 wire leak** (no `decimalToNumber` unwrap on ANY pharmacy read).
- **CRIT-2** `dispense` returns 200 not 201; no Idempotency-Key — double-click drains stock twice.
- **CRIT-3** `returnItems` + `addItems` use `{success,data:{sale,returnRecord}}` while `getSale` uses flat `data:sale` — frontend can't trust shape.
- **CRIT-4** `getCollectionSummary`/`getAging`/`getAuditTrail` skip envelope entirely — top-level scatter.
- **CRIT-5** `TPAServicebillcontroller.TestName/getTpaId` return raw arrays/docs with no envelope + 3 different error keys (`msg`/`error`/`message`).
- **CRIT-6** `listAdvancesByUHID` returns dual-shape (`data:{advances,total}` AND `advances` top-level AND `meta`).
- **CRIT-7** `applyAdvanceToBill` uses bare keys; siblings `refundAdvance`/`refundPayment` use 3 different shapes.
- **CRIT-8** `TPAServicesController.js:37` exposes stack trace when `NODE_ENV !== "development"` falsy → leaks paths on staging.
- **CRIT-9** `TPAServicebillcontroller.Servicebillfun:38-46` — `Number(s.Amount)` (R2 violation: money as float) + PascalCase fields clash with rest of codebase.
- **CRIT-10** TPA `preAuthSubmit`/`approve`/`settle` return 3 different response shapes and 2 different error codes (400 vs 409) — client can't share a handler.
- **CRIT-11** `paymentMode` enum case differs across modules (`"Card"` in PharmacySale vs `"CARD"` in PatientBill) → reports join silently mis-bucket.
- **CRIT-12** Envelope inventory: **6 distinct success shapes + 3 distinct error shapes** across the controllers in scope. R7ap-F23 "standardise" only landed on 3 endpoints.

### R7bg-4 React (3 CRIT)
- **CRIT-1** `PharmacyIndentsPage.jsx:90` — Stale closure: `load()` reads `list.length>0` but `list` not in deps; STAT chime misfires on filter switch.
- **CRIT-2** `PharmacyIndentsPage.jsx:77-113` — No AbortController on `/indents` poll; in-flight stale fetch can overwrite fresh data.
- **CRIT-3** `AccountsConsole.jsx:48-55` — Bidirectional URL↔tab sync with stale `setParams` reference; tab desyncs after browser back navigation.

### R7bg-6 Billing ledger (9 CRIT)
- **CRIT-1** `autoBillingService.js:262-265 addItemToBill` — Reads `pricing.finalPrice` (Decimal128) and multiplies by quantity without `toNum()` → `Decimal128 × Number = NaN`. **Hot path for every MAR/cron/order** → flood of pending-review triggers.
- **CRIT-2** `PharmacySaleModel.js` — All money fields `Number` (DB-CRIT-02 open since R3).
- **CRIT-3** `pharmacyController.js:579-741 returnItems` — Pharmacy refund posts **no CreditNote** → §34 reversal never happens; GSTR-1 over-reports.
- **CRIT-4** `pharmacyController.js:498/737/866` — **No `BillingAudit.emit()` row at any pharmacy money event**. NABH AAC.7 timeline broken for pharmacy.
- **CRIT-5** `billingController.js:1928 computeCollectionSummary` — **5 frontend dashboards still hit legacy aggregator**. R7bf-H Day Book fix landed in `dayBookService.js` but no consumer wired (META-4).
- **CRIT-6** `PatientBillModel.js:640` — `_refuseDeleteIfTriggersReference` queries `linkedBillId` but BillingTrigger field is `billId` → guard always passes 0 (META-2).
- **CRIT-7** `billingService.js:1505 recordRefund` — No `bill.isLocked`/`finalizedAt` flag; post-discharge charges land on Discharged admission's DRAFT bill silently.
- **CRIT-8** `BillingTrigger.js:19-20` — Number not Decimal128; every bed-day stores money in float space.
- **CRIT-9** `indentService.js:489-510 cancelIndent` — Network-retry race after release-saved-but-before-trigger-emit leaves indent Released with no BillingTrigger → drugs dispensed but never billed.

### R7bg-7 Print (8 CRIT)
- **CRIT-1** **`openPrint(...)` callsites worktree-wide never pass `printAudit:{...}`** → entire R7bf-F PrintAudit infrastructure is dead infrastructure (META-1).
- **CRIT-2** `printCount` field exists only on PatientBill + PatientAdvance. **Missing on PharmacySale, LabRecord, DischargeSummary, OPDPrescription, ConsentForm, MedicalCertificate, DoctorOrder, Admission** → `$inc` silently no-ops for 8 of 14 entity types.
- **CRIT-3** No `SettlementStatement*.jsx`, no `CreditNotePrint*.jsx`, no `DayBookPrint`, no `GstReportPrint`, no `TpaSettlementPrint`, no `CashierShiftClosePrint` — accountant has no NABH/GST-compliant statement printing.
- **CRIT-4** `PaymentReceipt.jsx:19,57` — bare `Number(amount)` (R10 violation), legacy `amountInWords` (no Paise, GST §46 non-compliant), no printCount/watermark. Most-fired receipt in HIS.
- **CRIT-5** `PharmacyBill.jsx:101-119` — Money fields coerced with bare `Number()` not `toNum()` → totals print as `₹NaN` once payload is Decimal128.
- **CRIT-6** No `ScheduleXRegisterPrint.jsx` despite R7bd-E claim. Witness-signature register cannot be printed → D&C Rules §66/67 narcotic audit gap.
- **CRIT-7** `PharmacyRegister.jsx` — no watermark, no printCount, no numberToIndianWords → statutory pharmacy registers reprint identically; DUPLICATE forgery vector.
- **CRIT-8** `PrintPreviewModal.jsx:88-90` — Iframe modal doesn't call `recordPrintAudit()` before `print()`; only the new-tab path does. Operators using modal preview never audit.

### R7bg-8 NABH+Regulatory (10 CRIT)
- **CRIT-P1** Schedule X dispense bypass (META-3) — NDPS Act exposure.
- **CRIT-P2** `prescriptionRef` defaults to `""` for Sch H/H1/X drugs — no controller guard rejects empty Rx ref → walk-in Tramadol against blank prescription. D&C Rule 65(9).
- **CRIT-P3** Prescriptions + discharge summaries print **without doctor's NMC/DMC registration number**. Only `MedicalCertificate.jsx` carries DMC. MCI Regulation 1.4.2.
- **CRIT-P4** ADR PvPI submission is manual paste of reference number; no outbound submission, no Form 1 PDF. `PVPI_FILED` status set without filing artifact.
- **CRIT-A1** **No GSTR-1 / GSTR-3B export endpoint** at all. Monthly filing is manual copy-paste. GST §37+§39.
- **CRIT-A2** TDS captured per-payment but **no Form 16A generator, no quarterly 26Q export**. Income Tax §194J/§194O exposure.
- **CRIT-A3** BillingTrigger has **no `triggeredBy/triggeredById/triggeredByRole`** trio. Cron-fired triggers leave actor null entirely. R13 invariant violation.
- **CRIT-A4** BillingTrigger Number not Decimal128 (same as -1-CRIT-6).
- **CRIT-A5** **No retention enforcement on PatientBill, DoctorNote, MAR, DischargeSummary, ConsentForm, Prescription**. Only BillingAudit has retainUntil. IT §44AA + NABH IMS.3.
- **CRIT-A6** Grievance `slaHours` captured but **no SLA-breach cron** auto-escalates. PRE.6.

### R7bg-9 Perf (6 CRIT)
- **CRIT-1** `pharmacyController.js:78-87 searchDrugs` — regex COLLSCAN (no `^` anchor, `i` flag); needs $text index like R7bf-J shipped for patients.
- **CRIT-2** `pharmacyController.js:1150-1219 stats` + `closeDay` — loads every in-stock DrugBatch (50k docs × 500B = 25MB) per request; PharmacyHomePage polls every 15s.
- **CRIT-3** `pharmacyController.js:1267-1470` register endpoints — unbounded `.find().sort().lean()`; full-year query = 350MB single response → OOM.
- **CRIT-4** `billingService.js:187-196 getBillsByUHID` — no `.lean()`, no `.limit()`, 3 chained `.populate()`. PERF-CRIT-01 still unshipped.
- **CRIT-5** `dayBookService.js:65/incomeService.js:68/dashboardsController.js:528` — `payments.voidedAt` is NOT indexed but `$or:[{paidAt},{voidedAt}]` match relies on it → COLLSCAN at scale.
- **CRIT-6** META-5 stale dist artifact (857KB) sitting on disk.

### R7bg-10 Security (4 CRIT)
- **CRIT-1** `pharmacyController.js:459/795` — **`unitPrice` from body** drives the cash register on dispense + addItems. Pharmacist with `pharmacy.dispense` can POST `unitPrice:1` for ₹10k oncology drug (cash skim) or `unitPrice:99999` for ₹50 paracetamol (over-charge TPA).
- **CRIT-2** `scheduleXRegister.js:101-130` — **TOCTOU race on NDPS register**. Two concurrent dispenses both pass `currentBalance < n` and both insert → register goes negative (illegal under NDPS).
- **CRIT-3** `billingService.js:1300-1315 recordPayment` — **No duplicate-transactionId check**. Cashier double-click → two UPI/CARD payment rows. TPA leg has this guard; bill leg doesn't.
- **CRIT-4** `billingController.js:1492-1504 cancelBill` — `paid > 0` gate caught by `applyAdvanceToBill` writing ADVANCE_ADJUSTMENT row, so currently safe — but `bill.advancePaid > 0` defense-in-depth missing.

---

## HIGH highlights (96 total — full list per agent transcript)

Selected representatives:

- **R7bg-2-HIGH-1** Admin holds BOTH `indent.raise` AND `indent.fulfill` → no SoD between raiser/releaser/canceller. NABH MOM.3 maker-checker missing.
- **R7bg-2-HIGH-3** ADR `PUT /:id/reopen` allows the original reporter to silently rewrite the regulator-facing record.
- **R7bg-3-HIGH-1** paymentMode + saleType enum **case drift** across pharmacy (Title-case) vs billing (UPPERCASE) vs reports.
- **R7bg-3-HIGH-5** TPA master CRUD: 4 endpoints, 4 different shapes; `deleteTPA` returns 200 not 204.
- **R7bg-4-HIGH-2** All 6 pharmacy `openPrint(...)` calls OMIT `printAudit:{...}` block (instance of META-1).
- **R7bg-5-HIGH-1** `indentService.js:468-475` — `onIndentReleased` failure caught with `console.error` only; no pending-review fallback → drugs gone, no trigger.
- **R7bg-5-HIGH-4** `TPAServicesController.js:6` — `console.log("Incoming request body:", req.body)` leaks potential PII on every TPA create.
- **R7bg-6-HIGH-1** `onOrderCancelled` creates CN with `taxAmount:0/cgst:0/sgst:0/igst:0` even for GST-bearing services → output GST stays inflated.
- **R7bg-6-HIGH-5** TPA write-off marks `bill.tpaClaimStatus="REJECTED"` (semantically wrong — TPA approved + paid partial). Inflates "TPA Denied" KPI.
- **R7bg-6-HIGH-6** `closeSession` doesn't refuse close while cashier owns unpaid PARTIAL/GENERATED bills.
- **R7bg-6-HIGH-7** Bill refund in TPA_CLAIM mode has no TPA-side reversal/payable-to-insurer ledger.
- **R7bg-7-HIGH-1/2/3/4** Multiple high-fraud documents (prescription, consent, medical-certificate, fitness, TPA-authorization) lack printCount/watermark wiring.
- **R7bg-7-HIGH-3** AdvanceReceipt missing GSTIN — 2026 GST circular requires customer GSTIN for advances ≥ ₹50k.
- **R7bg-7-HIGH-4** RefundReceipt UTR slip always blank — field name mismatch (`utrReference` vs `refNo`).
- **R7bg-9-HIGH-1** Sequential awaits in `indentService.releaseIndent` for 15 items = 750ms; `Promise.all` cuts to 80ms.
- **R7bg-9-HIGH-2** `reorder-notifier` cron loads every active Drug (50k × 1KB = 50MB RSS spike).
- **R7bg-9-HIGH-4** Zero `visibilitychange` gating on any `setInterval` polling in HIS — background tabs burn battery/bandwidth 24/7.
- **R7bg-10-HIGH-1** Mass-assignment on `Drug.create({...req.body})` + Supplier + Settings — body can stuff `coldChain/schedule/isNarcotic/defaultSalePrice`.
- **R7bg-10-HIGH-3** `settlementAdjust` mass-spread `...req.body` — possible bypass to `payments[]/billStatus/billItems[]`.
- **R7bg-10-HIGH-4** `paymentMode` not enum-validated on bill payments — `"ESCROW"` accepted, breaks shift reconciliation.
- **R7bg-10-HIGH-6** R7y sessionStorage migration incomplete — every `authFetch` reader still has `sessionStorage.getItem || localStorage.getItem` fallback chain.

---

## MED highlights (67 total)

- Sidebar/UI nits (5+ findings)
- `aria-label` missing across ~5000 LOC of pharmacy + accounts pages
- `key={i}` patterns in 6+ list components
- ErrorBoundary missing on PharmacyHomePage tabs (AccountsConsole has it)
- 17+ dead-permission keys flagged in permissions.js header but still in matrix
- 8 minor inline schema/audit truncation nits
- 5 console.log debug leaks in TPA/billing services
- Date-format / timezone hints missing in 3 print templates
- No `compression` middleware in Express

---

## Suggested R7bh shape (~10 parallel fix agents)

Given the scale (66 CRIT + 96 HIGH), split into focused tracks. Each agent owns disjoint files with clear deliverables.

| Agent | Theme | Findings closed |
|---|---|---:|
| **F1** META rewires (single-day quick wins) | META-1 add `printAudit:{}` to ~30 openPrint callsites + add printCount field to 8 models · META-2 rename `linkedBillId`→`billId` in delete guard · META-3 route Schedule X via register from main dispense · META-4 migrate 5 frontends to dashboardsController · META-5 rebuild dist | 5 META + 12 cascade |
| **F2** PharmacySale Decimal128 migration | All money fields + ITEM + returns + supplements + GST split + placeOfSupply/customerGstin + index updates | 8 CRIT (DB-CRIT-02 family + GST CRIT-12/13/14) |
| **F3** BillingTrigger Decimal128 + audit trio | unitPrice/totalAmount → Decimal128 + add triggeredBy/triggeredById/triggeredByRole + AutoBilledItems same | 4 CRIT + cascade |
| **F4** Race + concurrency hardening | cancelSale/acknowledgeIndent/cancelIndent CAS, PharmacySettings singleton fix, Hospital model stub, ScheduleX TOCTOU, recordPayment idempotency, addItemToBill toNum unwrap | 8 CRIT |
| **F5** Pharmacist regulatory shipping | Schedule X main-dispense routing, Rx-ref enforcement, DMC on prescription/discharge, ADR PvPI workflow, ColdChainLogModel | 4 CRIT + 5 HIGH |
| **F6** Accountant regulatory shipping | GSTR-1/3B export, Form 16A generator, retention enforcement on Bill/Note/MAR/Discharge/Consent/Prescription, Grievance SLA cron, FireDrill overdue cron, Credential expire-block | 6 CRIT + 5 HIGH |
| **F7** Print templates greenfield | SettlementStatement, CreditNotePrint, DayBookPrint, GstReportPrint, TpaSettlementPrint, CashierShiftClosePrint, ScheduleXRegisterPrint + watermark/printCount wiring across all high-fraud docs | 6 CRIT + 8 HIGH |
| **F8** API contract unification | Standardize envelope (single source `{success, data, meta?, error?}`), unify paymentMode enum case (UPPERCASE everywhere), unify UHID case, kill 3 error envelopes, fix TPA legacy controllers, drop stack-trace leak | 12 CRIT |
| **F9** Performance + index + cache | searchDrugs $text, stats $facet, register pagination + 90-day cap, getBillsByUHID lean+limit, payments.voidedAt index, indent Promise.all, reorder-notifier aggregation, visibilitychange gating on all polls | 6 CRIT + 6 HIGH |
| **F10** Security + cross-cut hardening | unitPrice body-trust gate, mass-assignment allow-lists, settlementAdjust destructure, recordPayment Idempotency-Key, drop localStorage fallback in authFetch, paymentMode enum validation, ScheduleX balance CAS | 4 CRIT + 7 HIGH |

Carry MEDs into R7bi backlog if R7bh budget tight.

---

## Verification (this cycle — no code changes)

- ✅ All 10 audit agents reported back; 229 findings catalogued
- ✅ 5 META findings cross-verified against filesystem (`linkedBillId` vs `billId`, printAudit callsites grep, ScheduleX route trace, dayBookService callers grep, dist hash diff)
- ✅ R7bf-G shipping confirmed for the 6 critical-value/ADR/Grievance/FireDrill/Credential file set
- ✅ Backend on 5050, frontend builds — no regressions surfaced

---

*Authored R7bg by Dr Sandeep + Claude. 10 parallel deep-audit agents · Pharmacist workflow + Accountant role across 10 dims. 229 findings (66 CRIT + 96 HIGH + 67 MED). 5 META findings reveal R7bd/R7bf "shipped" code that is dead in practice. Awaiting R7bh fix cycle.*
