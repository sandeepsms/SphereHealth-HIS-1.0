# R7be — A4 + A5 + A6 + A7 + A8 deep audit (155 findings)

**Cycle**: R7be (after R7bd closed all 67 R7bc findings)
**Scope**: Print pipeline (A4) · NABH compliance (A5) · Reports & dashboards (A6) · State machines (A7) · Performance & scale (A8)
**Method**: 5 parallel deep-audit agents, orthogonal scopes, each instructed "no token budget, dig deep, surface every gap"
**Result**: **155 new findings** (42 CRIT + 68 HIGH + 45 MED)

---

## Agent ownership

| Agent | Scope | Findings | CRIT | HIGH | MED |
|---|---|---:|---:|---:|---:|
| **A4** Print pipeline (receipts, bills, lab reports, discharge summary, MAR sheet, prescription) | 22 | 5 | 11 | 6 |
| **A5** NABH 5th Ed compliance (10 chapters: AAC, COP, MOM, PRE, HIC, CQI, ROM, FMS, HRD, IMS) | 54 | 16 | 22 | 16 |
| **A6** Reports & dashboards (analytics, GST snapshots, KPI tiles, day-book, TPA outstanding) | 26 | 8 | 10 | 8 |
| **A7** State machines + workflow guards (admission, MLC, consent, TPA, user, sample) | 28 | 7 | 14 | 7 |
| **A8** Performance + scale (queries, indexes, cron memory, frontend polling, bundle size) | 25 | 6 | 11 | 8 |
| **Total** | | **155** | **42** | **68** | **45** |

---

## META findings — verify before next cycle

R7be-A7 META audit cross-checked R7bd "shipped" claims against the actual filesystem. Some files claimed by R7bd-D do **not** exist in the worktree:

| Claimed in R7bd | Reality | Impact |
|---|---|---|
| `Backend/utils/statusTransitionGuard.js` | **MISSING** | R7bd-D-9 shared state-machine registry never landed; each model rolls its own |
| `Backend/models/Clinical/CriticalValueAlertModel.js` | **MISSING** | R7bd-D-2 / A3-CRIT-2 never landed |
| `Backend/services/Notification/criticalValueAlerter.js` | **MISSING** | Same — service file absent |
| `Backend/routes/Clinical/criticalValueAlertRoutes.js` | **MISSING** | Same — routes never wired |

**Action**: Either ship these in R7bf, or correct AUDIT_R7bd.md to remove the false-positive claims. NABH AAC.6 (critical-value notification) gap **remains open**.

Cross-checked and **confirmed shipped**: ScheduleXEntryModel, StockTakeModel, LabTechConsole, RadiologistConsole, reorderNotifier. So R7bd-E shipped correctly; only the D-2/D-9 cluster regressed.

---

## A4 Print Pipeline — 22 findings

### A4-CRIT (5)

| ID | File / Surface | Defect | Compliance impact |
|---|---|---|---|
| A4-CRIT-1 | `Frontend/src/pages/print/*` + `Backend/services/Print/*` | **Two parallel print pipelines** — server-side puppeteer + client-side `window.print()` divergent. Same bill printed two ways shows different totals when invoiced after edit (server cached, client live). | NABH IMS.4 contradicted |
| A4-CRIT-2 | `Frontend/src/Components/lab/LabReport.jsx` | Lab reports printed **without NABH-mandated fields**: lab accreditation number, method, equipment ID, reference range source, biological reference interval, units. Just shows result + flag. | NABH AAC.3 violated |
| A4-CRIT-3 | `Backend/services/Billing/billPrintService.js` | **GST tax-invoice gaps** on most non-pharmacy bills — HSN/SAC absent, place of supply absent, customer GSTIN absent. Pharmacy fixed in R7ar-F18 but OPD/IPD/Daycare/ER bills still non-compliant. | GST Rules §46 violated |
| A4-CRIT-4 | `Backend/controllers/Print/printAuditController.js` | **No `PRINTED` audit row written on reprints** — every reprint of bill/receipt should emit BillingAudit event with operator + count. Currently silent. | NABH IMS.5, GST §35 |
| A4-CRIT-5 | `Frontend/src/Components/print/*` | **No `DUPLICATE` watermark** on reprints (bills, receipts, lab reports). First print and 50th print look identical. | GST Rules §48(4), NABH IMS.4 |

### A4-HIGH (11)

| ID | Defect | File |
|---|---|---|
| A4-HIGH-1 | Discharge summary print mixes Decimal128 raw `{$numberDecimal:"…"}` into total field — `₹{$numberDecimal:'4500.00'}` shown literally. | `DischargeSummary.jsx` |
| A4-HIGH-2 | MAR sheet print drops nurse signature column when > 1 day window. | `TreatmentChartPrint.jsx` |
| A4-HIGH-3 | Prescription print missing meal-status (Before food / After food) — collected in form but not rendered. | `OPDPrescriptionPrint.jsx` |
| A4-HIGH-4 | Advance receipt print uses bill template — wrong header ("Tax Invoice" instead of "Receipt"). | `AdvanceReceipt.jsx` |
| A4-HIGH-5 | Refund receipt missing refund mode + UTR reference. | `RefundReceipt.jsx` |
| A4-HIGH-6 | Patient-file consolidated print: order of sections inconsistent; nursing notes between doctor orders and assessments. | `PatientFilePrintPage.jsx` |
| A4-HIGH-7 | Settlement statement print omits TDS deducted line — total mismatch on TPA cases. | `SettlementStatementPrint.jsx` |
| A4-HIGH-8 | Daycare same-day proration not labelled on bill — patient sees "Bed: ₹250" but no clue why it's half. | `daycareBillService.js` |
| A4-HIGH-9 | IPD interim bill print missing "as on dd-mmm hh:mm" timestamp — patient queries "is this final?" | `IPDBillingLedger.jsx` |
| A4-HIGH-10 | Pharmacy retail sale receipt missing prescriber name on Schedule-H/H1 dispense. | `PharmacySalePrint.jsx` |
| A4-HIGH-11 | Lab report print doesn't show "VERIFIED BY" + DMC number — only name. | `LabReport.jsx` |

### A4-MED (6)

| ID | Defect |
|---|---|
| A4-MED-1 | Print preview opens in new tab — pop-up blockers kill it; should use modal iframe. |
| A4-MED-2 | Hospital logo loaded as relative URL — broken when printed from staging URL. |
| A4-MED-3 | Print font size hard-coded 12pt — too small for elderly patients reading lab report. |
| A4-MED-4 | Receipt print doesn't auto-cut on thermal printer (no `<feed>` ESC/POS sequence). |
| A4-MED-5 | Bill print page-break-inside not honored on long itemized lists — last line orphaned on page 2. |
| A4-MED-6 | OT note print missing scrub-tech + circulating-nurse signatures. |

---

## A5 NABH Compliance — 54 findings

Chapter-wise gap matrix (10 chapters, 102 standards reviewed):

| Chapter | Standards covered | Gaps | Notes |
|---|---:|---:|---|
| **AAC** Access, Assessment, Continuity | 14 | 4 | AAC.6 critical-value alert MISSING (R7bd claimed but not shipped — see META), AAC.3 lab accreditation fields absent on reports |
| **COP** Care of Patient | 21 | 11 | No blood-bank module (COP.18), no OT safety checklist (COP.13), no end-of-life care doc (COP.19), no restraint protocol (COP.10), no pain re-assessment (COP.7) |
| **MOM** Management of Medication | 11 | 6 | No ADR (adverse drug reaction) reporting (MOM.7), no high-alert med list flag (MOM.4 partial), no medication reconciliation at handover (MOM.5) |
| **PRE** Patient Rights and Education | 8 | 5 | **No grievance redressal portal** (PRE.6), no informed-consent registry (PRE.4 — exists but unguarded — see A7), no patient-education tracker (PRE.7) |
| **HIC** Hospital Infection Control | 9 | 5 | No HAI surveillance dashboard (HIC.4), no surgical-site infection tracking (HIC.5), no antimicrobial stewardship (HIC.3) |
| **CQI** Continuous Quality Improvement | 8 | 7 | **Nearly empty chapter** — only quality indicators exist; no PDCA cycles, no clinical audit, no benchmarking, no patient-satisfaction module |
| **ROM** Responsibilities of Management | 7 | 3 | No board minutes module, no risk register, no annual quality report |
| **FMS** Facilities Management and Safety | 9 | 5 | **No fire-drill tracker** (FMS.4), no PPM (planned preventive maintenance) for medical equipment (FMS.3), no hazmat handling SOP |
| **HRD** Human Resource Development | 8 | 4 | **No credentialing module** (HRD.3) — privileges, scope of practice never tracked. No CME tracker (HRD.4) |
| **IMS** Information Management System | 7 | 4 | No record retention policy enforced UI-side (R7bd-D-3 backend exists, no admin UI), no privacy-impact assessment, no breach-notification workflow |
| **Total** | 102 | 54 | |

### A5-CRIT (16) — chapter standards that block accreditation

1. **A5-CRIT-1 / AAC.6** Critical lab/vital value alert (READ META — R7bd's fix never landed).
2. **A5-CRIT-2 / COP.13** OT safety / WHO surgical safety checklist — not implemented.
3. **A5-CRIT-3 / COP.18** Blood-bank module — no donor, cross-match, issue trail.
4. **A5-CRIT-4 / MOM.7** ADR reporting + PvPI submission — not implemented.
5. **A5-CRIT-5 / PRE.6** Grievance redressal — no module, no SLA, no escalation matrix.
6. **A5-CRIT-6 / HRD.3** Credentialing — doctor scope-of-practice / privileges not tracked.
7. **A5-CRIT-7 / FMS.4** Fire-drill tracker + emergency code register absent.
8. **A5-CRIT-8 / HIC.4** Hospital-acquired infection surveillance absent.
9. **A5-CRIT-9 / CQI.1** Clinical audit framework absent.
10. **A5-CRIT-10 / CQI.4** Patient-satisfaction survey instrument absent.
11. **A5-CRIT-11 / COP.10** Physical/chemical restraint protocol + consent absent.
12. **A5-CRIT-12 / COP.19** End-of-life care documentation absent.
13. **A5-CRIT-13 / MOM.5** Medication reconciliation at admission/transfer/discharge — fragmentary.
14. **A5-CRIT-14 / IMS.5** Disaster recovery / business-continuity plan not implemented in code (no backup-restore drill).
15. **A5-CRIT-15 / AAC.13** Patient-transfer (inter-hospital) checklist + summary absent.
16. **A5-CRIT-16 / COP.7** Pain assessment & re-assessment loop absent (initial pain captured, re-eval not enforced).

### A5-HIGH (22)

(Abbreviated — full list per chapter in agent transcript)

- COP.2 nursing care plan template not tied to diagnosis
- COP.4 patient assessment not time-stamped within 24h of admission
- COP.6 transfer summary not auto-printed
- COP.11 vulnerable-patient flag absent (paediatric, elderly, mentally ill, pregnant)
- COP.12 brought-dead protocol partial
- COP.14 anaesthesia pre-op assessment absent
- COP.15 procedural sedation tracker absent
- COP.16 organ donation consent absent
- COP.17 organ transplant module absent
- COP.20 rehabilitation services absent
- COP.21 nutritional therapy absent
- MOM.2 medication storage temperature log absent (cold-chain UI exists, audit log not enforced)
- MOM.3 narcotic register UI exists (R7bd-E-1) but reconciliation cron absent
- MOM.6 patient self-administration of medication policy absent
- PRE.1 patient rights display absent
- PRE.2 informed consent for HIV testing absent
- PRE.3 informed consent for blood transfusion absent
- PRE.7 patient-education tracker absent
- HIC.1 ICAN team module absent
- HIC.2 antibiotic policy module absent
- HIC.6 needle-stick injury log absent
- ROM.4 risk register absent

### A5-MED (16)

- 16 documentation/template gaps across chapters — see agent transcript

---

## A6 Reports & Dashboards — 26 findings

### A6-CRIT (8)

| ID | File | Defect |
|---|---|---|
| A6-CRIT-1 | `Backend/services/Reports/gstService.js` | **Pharmacy GST never in monthly snapshot** — `aggregateGSTForMonth` excludes pharmacy sales. Monthly GSTR-1 filing under-reports. |
| A6-CRIT-2 | `Backend/controllers/Reports/hospitalRegisterController.js` | **3 drift sources** in hospital register: (1) `paid` from bill.paidAmount NOT from PaymentReceipt; (2) discharged count uses admission.status NOT IPDAdmission.dischargedAt; (3) admitted count includes Daycare. |
| A6-CRIT-3 | `Backend/controllers/tpa/tpaController.js::getTPACases` | **Includes PAID bills** in outstanding total — inflates dashboard by 10x for hospitals with rolling TPA settlements. Filter missing `bill.status !== 'PAID'`. |
| A6-CRIT-4 | `Frontend/src/Components/billing/RefundsTab.jsx` | **Date filter ignored** — `from/to` params built into URL but backend route handler skips them. Always returns all-time refunds. |
| A6-CRIT-5 | `Frontend/src/pages/AdminHome.jsx` | **Wrong field references** in low-stock and expiring queries — uses `currentStock` (does not exist, should be `remaining`) and `drug` (should be `drugId`). All admin KPIs are 0. |
| A6-CRIT-6 | `Backend/services/Reports/dayBookService.js` | **EOD Day Book cash-in misses advance refunds being reversed** (refund-of-refund) — net cash position wrong. |
| A6-CRIT-7 | `Backend/services/Reports/incomeService.js` | **TodayRevenue counts ADVANCE_DEPOSIT as revenue** — should be liability. Doubled income on advance + bill same day. |
| A6-CRIT-8 | `Backend/services/Billing/billingMath.js` | **byCategory.discount distribution rounds independently** per category — sum ≠ bill total discount. Off by ₹0.01–0.50 per bill on rounded discounts. |

### A6-HIGH (10)

- Patient census tile uses 24h window but timezone-naive — undercount near IST midnight
- Pharmacy revenue chart caches 24h — stale after bulk sale
- Doctor performance dashboard counts cancelled appointments
- Bed occupancy doesn't exclude maintenance/cleaning beds
- Lab turnaround time uses createdAt for both endpoints — always near-zero
- Inventory ABC analysis missing
- AR (accounts receivable) aging report absent
- Daily-collection drill-down by mode broken on >100 rows
- Doctor-wise revenue ignores procedure attribution
- Diagnosis-frequency chart raw ICD strings not normalized

### A6-MED (8)

- 8 minor display + export issues — full list in agent transcript

---

## A7 State Machines + Workflow Guards — 28 findings

### A7-META

**Backend/utils/statusTransitionGuard.js does NOT exist** despite R7bd-D-9 claim. Each model still rolls its own pre-save guard. Refactor never landed.

### A7-CRIT (7)

| ID | File | Defect |
|---|---|---|
| A7-CRIT-1 | `Backend/controllers/tpa/tpaController.js::tpaApprove` | Allows approve on **never-submitted** TPA case (DRAFT → APPROVED skipping SUBMITTED). State machine missing entirely. |
| A7-CRIT-2 | `Backend/controllers/tpa/tpaController.js::tpaSettle` | **Skips APPROVED state** — can settle from any state including DRAFT. Major financial integrity hole. |
| A7-CRIT-3 | `Backend/models/Patient/MLCModel.js` | **No state-machine transition guard** — MLC can move IN_PROGRESS → CLOSED → IN_PROGRESS, breaks police/court audit trail. |
| A7-CRIT-4 | `Backend/models/Patient/ConsentFormModel.js::refuse / revoke` | **Both endpoints unguarded** — can refuse already-revoked consent; can revoke after procedure complete. NABH PRE.4 breach. |
| A7-CRIT-5 | `Backend/services/User/userService.js::activateUser` | **Ignores Terminated state** — reactivates terminated employee to Active without re-onboarding flow. Compliance + access-control breach. |
| A7-CRIT-6 | `Backend/services/Patient/admissionService.js::recordDischarge` | Allows discharge while ACTIVE OT booking exists for this admission. |
| A7-CRIT-7 | `Backend/controllers/Pharmacy/pharmacyController.js::cancelIndent` | Allows cancel after RELEASED — stock already debited, no reversal. |

### A7-HIGH (14)

- Refund state allows "completed → reversed" without ledger entry
- Bill status PAID → PARTIALLY_PAID transition possible via discount-after-payment path
- DRAFT bill can be deleted after trigger linked (orphans triggers)
- AppointmentModel allows SCHEDULED → COMPLETED skipping CHECKED_IN
- DoctorOrder allows AMEND after EXECUTED
- LabOrder allows REJECT after VERIFIED
- RadiologyOrder no state machine — free-form status string
- PrescriptionRefill counter not capped
- ICUTransfer doesn't release ward bed atomically
- Discharge summary FINALIZED → DRAFT (correction) silently — no audit
- IPDAdmission.status not enum-validated — any string accepted
- Bed status CLEANING → OCCUPIED skipping AVAILABLE
- PatientAdvance status `ACTIVE`/`EXHAUSTED`/`REFUNDED` not enforced — string field
- Sample state REJECTED can be VERIFIED via direct PATCH

### A7-MED (7)

- 7 minor enum / transition gaps

---

## A8 Performance + Scale — 25 findings

### A8-CRIT (6)

| ID | File | Defect | Scale impact |
|---|---|---|---|
| A8-CRIT-1 | `Backend/services/Patient/patientService.js::searchPatients` | **Text search COLLSCAN at 30k records** — index on `name` is regex-incompatible. p95 latency 8.4s on 30k synthetic patients. | Hospital with > 20k patients UX dies |
| A8-CRIT-2 | `Backend/controllers/Patient/patientController.js::getCompleteFile` | **Unbounded fetch** for long-stay patient — loads every nursing note, vital, MAR, order, lab, radiology since admission. 30-day ICU file = 28MB response, OOMs Node on 4 concurrent requests. | Server crash risk |
| A8-CRIT-3 | `Backend/services/Billing/advancePoolReconCron.js` | **Cron loads all PatientAdvance docs** into memory — `find({})` no pagination. At 5k advances × 12 versions in audit = 800MB RSS spike at 02:00 IST. | OOM at scale |
| A8-CRIT-4 | `Frontend/src/**/*.jsx` (17+ files) | **17+ frontend polling intervals** still active (3s–60s). Most are `setInterval` without cleanup — leaks on tab switch. Total background traffic: 14 req/min idle. | Battery + bandwidth + server load |
| A8-CRIT-5 | `Frontend/vite.config.js` | **vendor-misc bundle 837KB** still > Vite warning threshold (500KB). Slow first paint on 3G/4G — Indian tier-3 city users blocked. | First-load TTI degraded |
| A8-CRIT-6 | `Backend/services/Lab/labReportService.js::buildCumulativeView` | **N+1 query** — fetches each test result individually for a panel of 30 tests = 30 round-trips. Cumulative view 12s on 6-month panel. | Lab dashboard unusable |

### A8-HIGH (11)

- IPDLedger aggregation reads BillingTrigger collection without index on `admissionId + createdAt`
- Pharmacy stock-rollup runs in O(n²) when batch count > 200
- `getDoctorOrders` no projection — pulls full clinical note
- Mongoose `lean()` missing on 23 read paths
- BillingAudit collection 4.2GB (no archiver running per current TTL gap)
- AbortController missing on 6 search forms — duplicate in-flight requests
- React Query staleTime 0 default — re-fetches on every focus
- Image attachments served via Node, not nginx static — 200ms per radiology preview
- Mongoose plugin `mongoose-paginate` not used — manual skip/limit with O(skip) cost
- Server-side sort on `findOne().sort()` without index on 4 endpoints
- BedTransfer endpoint chains 4 sequential awaits — should be one transaction

### A8-MED (8)

- 8 minor index + caching + bundle suggestions

---

## Aggregated CRIT roster (42 across all scopes)

| ID | Title | Owner scope |
|---|---|---|
| A4-CRIT-1 | Two parallel print pipelines | Print |
| A4-CRIT-2 | NABH fields missing on lab reports | Print |
| A4-CRIT-3 | GST tax-invoice gaps on most bills | Print |
| A4-CRIT-4 | No PRINTED audit row on reprints | Print |
| A4-CRIT-5 | No DUPLICATE watermark on reprints | Print |
| A5-CRIT-1..16 | NABH chapter gaps (AAC.6, COP.13/18/19/10/7, MOM.7/5, PRE.6, HRD.3, FMS.4, HIC.4, CQI.1/4, IMS.5, AAC.13) | NABH |
| A6-CRIT-1 | Pharmacy GST never in monthly snapshot | Reports |
| A6-CRIT-2 | Hospital-register 3 drift sources | Reports |
| A6-CRIT-3 | getTPACases includes PAID inflating outstanding | Reports |
| A6-CRIT-4 | RefundsTab date filter ignored | Reports |
| A6-CRIT-5 | AdminHome queries wrong fields | Reports |
| A6-CRIT-6 | EOD Day Book cash-in misses refund-of-refund | Reports |
| A6-CRIT-7 | TodayRevenue counts ADVANCE_DEPOSIT as revenue | Reports |
| A6-CRIT-8 | byCategory discount distribution rounds independently | Reports |
| A7-CRIT-1 | tpaApprove allows DRAFT → APPROVED | State |
| A7-CRIT-2 | tpaSettle skips APPROVED | State |
| A7-CRIT-3 | MLC has no transition guard | State |
| A7-CRIT-4 | ConsentForm refuse/revoke unguarded | State |
| A7-CRIT-5 | User activate ignores Terminated | State |
| A7-CRIT-6 | Discharge allowed with active OT booking | State |
| A7-CRIT-7 | Cancel indent after RELEASED | State |
| A8-CRIT-1 | Patient text-search COLLSCAN | Perf |
| A8-CRIT-2 | getCompleteFile unbounded → OOM | Perf |
| A8-CRIT-3 | advance-pool-recon loads all docs | Perf |
| A8-CRIT-4 | 17+ frontend polling intervals | Perf |
| A8-CRIT-5 | vendor-misc bundle 837KB | Perf |
| A8-CRIT-6 | Cumulative lab view N+1 → 12s | Perf |

---

## Suggested R7bf shape (5 parallel agents)

| Agent | Scope (rough fix budget) |
|---|---|
| **F** Print pipeline collapse + GST + NABH lab/bill fields + DUPLICATE watermark + PRINTED audit + Decimal128 unwrap (A4 all) |
| **G** NABH critical: AAC.6 critical-value-alert RESHIP (META), MOM.7 ADR, PRE.6 grievance, FMS.4 fire-drill, HRD.3 credentialing scaffolds (A5 CRIT subset) |
| **H** Reports: GST snapshot includes pharmacy, hospital register single source of truth, getTPACases filter, RefundsTab date filter, AdminHome field rename, TodayRevenue advance exclusion (A6 all CRIT) |
| **I** State machines: build the missing `statusTransitionGuard.js` registry, retrofit TPA/MLC/Consent/User/Indent (A7 CRIT + HIGH) |
| **J** Performance: patient search index, getCompleteFile pagination + cursor, advance-pool-recon batch, polling cleanup, bundle-split (A8 CRIT) |

Carry MEDs into R7bg if R7bf budget tight.

---

## Verification (this audit only — no code changes shipped this cycle)

- ✅ All 5 audit agents reported back; 155 findings captured
- ✅ META cross-check verified: 4 R7bd-claimed files genuinely missing (statusTransitionGuard, CriticalValueAlertModel, criticalValueAlerter, criticalValueAlertRoutes)
- ✅ Other R7bd-E claims (ScheduleX, StockTake, LabTechConsole, reorderNotifier) confirmed shipped
- ✅ Backend on port 5050, frontend builds, login working — no regressions surfaced during audit

---

*Authored R7be by Dr Sandeep + Claude. 5 parallel deep-audit agents on A4-A8. 155 findings (42 CRIT + 68 HIGH + 45 MED). 4 META findings flagging R7bd unshipped claims. Awaiting R7bf fix cycle.*
