# AUDIT-R8 — 20-Dimension Functionality/Correctness/Security Re-Audit

**Date:** 2026-07-14 · **Branch:** `claude/multi-hospital-deploy` · **Scope:** whole HIS codebase (Backend 619 `.js` + Frontend 387 `.jsx/.js`)

## Method
A fan-out audit: **20 independent auditor agents** (one per dimension) read the real code and produced severity-ranked findings with concrete failure scenarios; **each finding was then adversarially verified** by an independent skeptic agent that re-read the code path and returned CONFIRMED / PLAUSIBLE / REFUTED with a reproduction. **76 agents total.** Verifiers frequently *corrected* the auditors (some severities up, several down) and refuted 3 false positives.

## Result
| | Count |
|---|---|
| Findings verified | 56 |
| **CONFIRMED** | **52** |
| Refuted (false positive) | 3 |

Confirmed by severity (post-verification): **2 critical · 16 high · 20 medium · 14 low.**

---

## ✅ Fixed this arc — the 2 CRITICAL (financial), live-verified

### C1 — Pharmacy GST silently zeroed on the filed GSTR-1 return
`Backend/services/Tax/gstr1Exporter.js`. The pharmacy-sale bucketing read `it.gstPercent`/`it.taxableValue`, but pharmacy `SALE_ITEM` stores the rate as **`gstRate`** and the pre-tax base as **`taxableAmount`** (`netAmount` is tax-inclusive). So **every** pharmacy line resolved to rate 0 → all pharmacy output GST on the statutory GSTR-1 was **₹0 and mislabelled exempt**, taxable value inflated (read the tax-inclusive `netAmount`). Also the B2C branch collapsed a mixed-rate basket onto a single "dominant" rate.
**Fix:** read `gstRate`/`taxableAmount`, and emit one B2C(S) row **per GST rate** (no dominant-rate collapse).
**Live-verify (hard-task):** seeded a synthetic 5%+18% walk-in sale → total B2C GST **+₹230** (was ₹0), 5%→₹50, 18%→₹180, per-rate split present. **4/4.**

### C2 — New-patient OPD consultation billed ₹0 (receipt vs ledger mismatch)
`patientService.js` (registration auto-dispatch) + `OPDService.js` (same-day dedup) + `autoBillingService.js` (0-override). On new-patient OPD registration the auto-dispatched visit was created **without** `consultationFee`; `autoBillingService` treated `0 >= 0` as a valid override → OPD-CON line at **₹0**; then the fee-bearing follow-up `createOPDVisit` was deduped away. The printed receipt showed ₹500 while the ledger held ₹0 — silent revenue leak on the highest-volume flow.
**Fix:** carry `consultationFee` through registration → auto-dispatch → visit (frontend + `patientService`); and treat `0`/unset as "fall back to the ServiceMaster consult price" (`> 0`, never a silent ₹0).
**Live-verify (hard-task):** new OPD patient w/ fee 500 → OPD-CON line **₹500** (was ₹0); no-fee → ServiceMaster ₹500 (never ₹0). **HT1/HT1b pass.**

## Hard-task live testing (running system)
| Probe | Result |
|---|---|
| GST mixed-rate export (C1) | ✅ 4/4 — +₹230, correct per-rate split |
| OPD consult with fee (C2) | ✅ bills ₹500 (was ₹0) |
| OPD consult no-fee → ServiceMaster | ✅ ₹500, never silent ₹0 |
| Sequence under concurrency (6 parallel advances) | ✅ 6 unique receipts, no collision |
| Advance earmark isolation (cross-patient) | ✅ rejected ("UHID does not match", 400) |
| E2E acceptance regression | ✅ 136/136 (post-fix) |

---

## Confirmed findings for owner prioritization

### 🔴 HIGH (16) — recommend next
| # | Dim | Finding | File |
|---|---|---|---|
| 1 | `abdm` | Consent permission.dateRange is never enforced — HIP pushes all-time clinical records outside the consented date window (PHI over-disclosure) | `Backend/services/Abdm/abdmDataFlowService.js:19-49` |
| 2 | `accounts` | Cancelled numbered invoices are double-reversed in GST → output tax under-reported / under-paid | `Backend/services/Reports/gstService.js:60:gstService.js:60-63 / billingController.js:1915` |
| 3 | `billing` | Credit note over-reverses GST — tax split uses pre-tax net as denominator instead of tax-inclusive total | `Backend/services/Billing/billingService.js:2223-2226` |
| 4 | `clinical-docs` | A signed doctor note becomes deletable after one amendment - amend-then-delete erases the attested record | `Backend/services/Doctor/doctorNotesService.js:1157` |
| 5 | `clinical-docs` | A submitted nurse note becomes deletable after one amendment - same amend-then-delete data loss | `Backend/services/Nurse/nurseNotesService.js:645` |
| 6 | `clinical-docs` | PUT on an already-amended doctor note silently rewrites the attested record in place - no addendum, no amendment entry, no audit | `Backend/services/Doctor/doctorNotesService.js:791` |
| 7 | `concurrency` | Concurrent advance apply + refund double-spends the same deposit (stale-doc save resurrects a REFUNDED advance) | `Backend/services/Billing/patientAdvanceService.js:182` |
| 8 | `data-integrity` | Entire doctor-order lifecycle + infusion completion audit is silently dropped (invalid enum event "STATUS_CHANGE") | `Backend/routes/Doctor/doctorOrderRoutes.js:49-50` |
| 9 | `emergency` | ER 'Expired' disposition can never be recorded from the UI (death-cert field-shape mismatch) | `Frontend/src/pages/emergency/EmergencyList.jsx:383 (frontend)` |
| 10 | `emergency` | ER 'Left Against Medical Advice' disposition can never be recorded from the UI (missing patientSignature) | `Frontend/src/pages/emergency/EmergencyList.jsx:380 (frontend)` |
| 11 | `emergency` | ER->IPD bridge admission accrues ZERO bed/nursing/room charges for the entire inpatient stay | `Backend/services/Patient/emergencyService.js:382-405 (stub create` |
| 12 | `lab` | collectSamples() hard-fails (409) on any order already IN_PROGRESS — add-on / staggered sample collection is blocked and no accession is minted | `Backend/services/Investigation/investigationOrderService.js:208 (set)` |
| 13 | `orders-rx` | HAM two-nurse independent double-check is defeatable by one nurse via free-text witness name | `Backend/routes/Doctor/doctorOrderRoutes.js:1345-1372` |
| 14 | `orders-rx` | Electrolyte doses in mEq are rejected by the dose validator even though the order form offers 'mEq' as a unit | `Backend/models/Doctor/DoctorOrderModel.js:280` |
| 15 | `pharmacy` | Outstanding pharmacy credit on Supplemented / Partial-Return sales is uncollectable, blocking IPD discharge | `Backend/controllers/Pharmacy/pharmacyController.js:2608 (collectCredit) and 2773 (applyAdvanceToSale) vs 1897 (getOutstandingForAdmission) / 3303 / 3604 / 3619` |
| 16 | `resilience` | 10 scheduleDaily cron callbacks swallow their own errors (return {error}) — CronFailure is never recorded, the retry sweeper never replays them, and a false "ok" heartbeat is written to the BillingAudit register | `Backend/index.js:770-807` |


### 🟠 MEDIUM (20)
| # | Dim | Finding | File |
|---|---|---|---|
| 1 | `abdm` | Discovery demographic match ignores yearOfBirth in the name fallback — returns the wrong same-named patient's care contexts | `Backend/services/Abdm/abdmLinkService.js:116-120` |
| 2 | `accounts` | GSTR-1 and GSTR-3B 'fp' return-period field is YYYYMM instead of GSTN-required MMYYYY | `Backend/services/Tax/gstr1Exporter.js:830:gstr1Exporter.js:830` |
| 3 | `billing` | Discharge waterfall silently absorbs overpayment onto the last bill with no advance/refund record | `Backend/controllers/Patient/admissionController.js:1221` |
| 4 | `clinical-docs` | PUT and blood-transfusion PATCHes mutate an already-amended nurse note in place, bypassing the append-only trail | `Backend/services/Nurse/nurseNotesService.js:463` |
| 5 | `emergency` | Generic ER update (PUT /:emergencyNumber) lets Admin set terminal dispositions, bypassing the disposition state machine | `Backend/controllers/Patient/emergencyController.js:187-201 (updateEmergencyVisit)` |
| 6 | `ipd` | Discharge OT/procedure gate is UHID-scoped (patient-wide) instead of admission-scoped, blocking legitimate discharges | `Backend/services/Patient/admissionService.js:357-361` |
| 7 | `lab` | rejectSample() forces resultStatus COMPLETED->PENDING which the LabResult guard rejects — rejecting a compromised specimen after results are entered 409s and rejects nothing | `Backend/services/Investigation/investigationOrderService.js:239-253 (esp. 247)` |
| 8 | `nursing` | Shift-handover vitals snapshot is always empty (date-format mismatch with VitalSheet) | `D:\Spherehealth\Backend\services\Nurse\shiftHandoverService.js:6-21` |
| 9 | `nursing` | MAR five-rights gate and High-Alert-Med dual-witness are bypassable via createOrGet / addMedication | `D:\Spherehealth\Backend\controllers\Clinical\marController.js:74-89` |
| 10 | `orders-rx` | HAM / concentrated-electrolyte auto-flagging ignores IV_Fluid fluidName and additives fields | `Backend/models/Doctor/DoctorOrderModel.js:644-649` |
| 11 | `orders-rx` | MAR administration path is missing the drug-allergy gate it is documented to enforce | `Backend/controllers/Clinical/marController.js:153-357` |
| 12 | `pharmacy` | Schedule-X (NDPS narcotic) running balance is never reversed on return, cancel, or vendor-return, drifting the statutory register out of sync with physical stock | `Backend/controllers/Pharmacy/pharmacyController.js:returnItems 3211-3216` |
| 13 | `prints` | Print Center section picker fails to strip physical exam + admission vitals (PHI leaks into subset/"Billing-only" prints) | `Frontend/src/Components/print/printables/CompleteIPDFile.jsx:42-92` |
| 14 | `rbac` | PHI file-serving route (/uploads/*) has authentication but no role/ownership authorization — any authenticated role can read files the metadata APIs restrict | `Backend/routes/Files/uploadsRoutes.js:56-58 (mount: Backend/index.js:1377)` |
| 15 | `registers` | Notifiable-disease register auto-raises only at discharge finalize, missing the IDSP statutory reporting window for inpatients | `Backend/controllers/Clinical/dischargeSummaryController.js:453-464` |
| 16 | `registration` | createPatient accepts client-supplied UHID/patientId, bypassing the atomic sequence | `Backend/services/Patient/patientService.js:26-73 (no strip)` |
| 17 | `security` | NABH register tamper-evidence falls back to a source-known HMAC secret (no fail-fast, undocumented env var) — forgeable in production | `Backend/utils/registerIntegrity.js:42-59` |
| 18 | `tpa-claims` | TPA short-pay routed to patient (default) becomes uncollectable — balanceAmount stored as 0 and per-bill collection blocked with OVERPAY | `Backend/controllers/Billing/billingController.js:2411-2456 (PATIENT branch)` |
| 19 | `tpa-claims` | Overlay onto uploaded insurer PDF omits ignoreEncryption — encrypted official forms upload fine but every 'company form' print 500s (no fallback) | `Backend/services/Billing/insurerFormService.js:278` |
| 20 | `tpa-claims` | Refund cash cap counts TPA settlement (TPA_CLAIM) as refundable cash — insurer money can be paid out of the till to the patient | `Backend/services/Billing/billingService.js:2032-2043` |


### 🟡 LOW (14)
| # | Dim | Finding | File |
|---|---|---|---|
| 1 | `abdm` | Consent permission.frequency (allowed fetch count/period) is stored but never enforced — unlimited repeat pulls served per consent | `Backend/services/Abdm/abdmDataFlowService.js:142-146` |
| 2 | `accounts` | BILL/REC seed self-heal uses lexicographic sort with 2-digit padding — can reissue an existing number when a counter is absent past serial 99 | `Backend/services/Billing/billingService.js:39-64 (generateBillNumber)` |
| 3 | `data-integrity` | PROM/PREM survey signature emits an invalid enum event, dropping every audit row | `Backend/controllers/Clinical/promPremSurveyController.js:219-229` |
| 4 | `data-integrity` | Demo-seed order route emits invalid enum event "SEED_DEMO" (audit row silently dropped) | `Backend/routes/Doctor/doctorOrderRoutes.js:2358-2360` |
| 5 | `ipd` | checkDoctorAccess populates attendingDoctorId against the wrong model, making isOwner always false | `Backend/services/Patient/admissionService.js:1669-1673` |
| 6 | `ipd` | Readmission register treats auto-closed OPD visits as the index discharge, inflating the NABH COP.16 readmission metric | `Backend/services/Compliance/nabhRegisterEmitter.js:1447-1462` |
| 7 | `nursing` | GET MAR by IPD+date exact-match fails in IST due to local-vs-UTC midnight mismatch | `D:\Spherehealth\Backend\controllers\Clinical\marController.js:102-107` |
| 8 | `orders-rx` | LASA / tall-man collision check silently misses drug names with a dosage-form prefix | `Backend/services/Clinical/medicationSafety.js:101-119` |
| 9 | `prints` | getCompleteFile silently caps several sections without surfacing them in the truncation flag | `Backend/controllers/Clinical/patientFileController.js:565-572` |
| 10 | `rbac` | Code-blue respond/close reachable by Ward Boy despite route comment stating 'only doctor/nurse close' | `Backend/routes/Clinical/wardOpsRoutes.js:33-36` |
| 11 | `registers` | Fall-with-major-injury → SentinelEventRegister auto-chain is unreachable dead code (no producer sends the trigger fields) | `Backend/services/Compliance/nabhRegisterEmitter.js:651-673` |
| 12 | `registration` | Emergency visit counter double-incremented on ER registration | `Backend/services/Patient/patientService.js:149-157 (also emergencyService.js:96)` |
| 13 | `registration` | IPD/Daycare visit counters never incremented for returning patients' subsequent admissions | `Backend/services/Patient/patientService.js:62-68 (create pre-set)` |
| 14 | `security` | Regex injection / ReDoS in several authenticated search services — existing escapeRegex guard not applied | `Backend/services/User/userService.js:624-627` |


### ⚪ Refuted / false positives (3) — no action
- `lab` — Partial hand-entered reference bounds suppress master-driven critical thresholds — panic values downgraded to a plain H/L flag with no alert — The suppression logic is real as described (service line 350 hasBounds is an OR of refLow/refHigh presence; the master criticalLow/criticalHigh stamping at 351-361 is gated behind !hasBounds; _classif
- `concurrency` — idempotencyGuard is check-then-act (reservation written only AFTER handler runs) — concurrent same-key requests both execute, double-collecting cash/bulk payments — The code observation is accurate — idempotencyGuard.js is check-then-act (findOne L85 -> next L135, cache create deferred into patched res.json L112-133), so the unique index on `key` catches only the
- `resilience` — idempotencyGuard caches error responses (4xx/5xx) under the Idempotency-Key, so a transient failure on a money POST becomes a sticky error replayed for 24h — retry-with-same-key can never succeed — The auditor's code reading is factually correct — idempotencyGuard.js:117-124 caches responseBody+statusCode for ANY status (no 2xx filter), guarded controllers (billingController.js:536) and the cent

---

## Per-dimension summary
| Dimension | Confirmed | Crit | High | Med | Low |
|---|---|---|---|---|---|
| `abdm` | 3 | 0 | 1 | 1 | 1 |
| `accounts` | 4 | 1 | 1 | 1 | 1 |
| `billing` | 2 | 0 | 1 | 1 | 0 |
| `clinical-docs` | 4 | 0 | 3 | 1 | 0 |
| `concurrency` | 1 | 0 | 1 | 0 | 0 |
| `data-integrity` | 3 | 0 | 1 | 0 | 2 |
| `emergency` | 4 | 0 | 3 | 1 | 0 |
| `ipd` | 3 | 0 | 0 | 1 | 2 |
| `lab` | 2 | 0 | 1 | 1 | 0 |
| `nursing` | 3 | 0 | 0 | 2 | 1 |
| `opd` | 1 | 1 | 0 | 0 | 0 |
| `orders-rx` | 5 | 0 | 2 | 2 | 1 |
| `pharmacy` | 2 | 0 | 1 | 1 | 0 |
| `prints` | 2 | 0 | 0 | 1 | 1 |
| `rbac` | 2 | 0 | 0 | 1 | 1 |
| `registers` | 2 | 0 | 0 | 1 | 1 |
| `registration` | 3 | 0 | 0 | 1 | 2 |
| `resilience` | 1 | 0 | 1 | 0 | 0 |
| `security` | 2 | 0 | 0 | 1 | 1 |
| `tpa-claims` | 3 | 0 | 0 | 3 | 0 |

*Full failure-scenario + reproduction for every finding is in the workflow journal (`his-audit-r8-20dim`). This report is the actionable index.*
