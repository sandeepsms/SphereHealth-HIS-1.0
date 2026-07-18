# AUDIT-R8 — Remediation Report & Recommended Fix Order

**Companion to `AUDIT-R8-20DIM.md`.** The 2 CRITICAL (pharmacy-GST-zero, OPD-consult-₹0) are **already fixed + live-verified** (`b0133670`). This plan covers the **50 remaining confirmed findings** — what each fix is, its effort, and the **recommended order** to do them in.

**Effort key:** S = small/localised (≤~1 file, a guard or field) · M = moderate (a few files / a flow) · L = large.

## ✅ Recommended fix order (8 waves)

Do the waves top-to-bottom. Within a wave, order doesn't matter much (they're independent). Rationale is *impact first, then blast-radius, then effort* — money & medico-legal before convenience.

### Wave 1 — Money & books correctness  *(6 findings · 2S / 4M)*
Same class as the two fixed CRITICALs — wrong GST on filed returns, uncollectable/leaked cash, and a deposit double-spend race. Highest business/legal exposure, and several share the billing/GST code so they batch cleanly.

| # | Sev | Finding | Fix | Eff |
|---|---|---|---|:--:|
| 2 | H | Cancelled numbered invoices are double-reversed in GST → output tax under-reported / under-paid | cancelBill must not ALSO cut a full-value CreditNote for an unpaid/never-filed bill — reverse GST once (single path), or gate CN creation on 'was filed'. | M |
| 3 | H | Credit note over-reverses GST — tax split uses pre-tax net as denominator instead of tax-inclusive total | recordRefund tax split: use the tax-INCLUSIVE total as the denominator (taxShare = amt/(net+tax)*tax), not the pre-tax net. | S |
| 7 | H | Concurrent advance apply + refund double-spends the same deposit (stale-doc save resurrects a REFUNDED advance) | Make apply + refund atomic: findOneAndUpdate with a status/appliedAmount precondition (or a version guard) so a stale-doc save can't resurrect a REFUNDED advance. | M |
| 19 | M | Discharge waterfall silently absorbs overpayment onto the last bill with no advance/refund record | Discharge bill-clear must reject/route OVER-payment to advance or refund — don't silently absorb it onto the last bill. | M |
| 34 | M | TPA short-pay routed to patient (default) becomes uncollectable — balanceAmount stored as 0 and per-bill collection blocked with OVERPAY | TPA short-pay-to-patient: recompute patientPayable/balanceAmount so the shortfall is collectable (don't store balance 0 / OVERPAY-block it). | M |
| 36 | M | Refund cash cap counts TPA settlement (TPA_CLAIM) as refundable cash — insurer money can be paid out of the till to the patient | Exclude TPA_CLAIM rows from refundableCash so insurer money can't be refunded as cash from the till. | S |

### Wave 2 — Clinical-record integrity (medico-legal)  *(4 findings · 4S / 0M)*
Attested doctor/nurse notes can be erased or silently rewritten after amendment — a direct NABH/legal exposure. All are small, bounded guard fixes in the two note services.

| # | Sev | Finding | Fix | Eff |
|---|---|---|---|:--:|
| 4 | H | A signed doctor note becomes deletable after one amendment - amend-then-delete erases the attested record | Delete guard must block any attested state — status ∈ {signed, amended}, not just 'signed'. | S |
| 5 | H | A submitted nurse note becomes deletable after one amendment - same amend-then-delete data loss | Nurse delete guard must block {submitted, amended} (not just submitted). | S |
| 6 | H | PUT on an already-amended doctor note silently rewrites the attested record in place - no addendum, no amendment entry, no audit | updateDoctorNote in-place path must reject a signed OR amended note — route edits through amend/addendum. | S |
| 20 | M | PUT and blood-transfusion PATCHes mutate an already-amended nurse note in place, bypassing the append-only trail | Apply the append-only guard on nurse PUT + blood-monitoring/status PATCH (block in-place when submitted\|amended). | S |

### Wave 3 — Patient-safety gates  *(6 findings · 3S / 3M)*
IPSG/ISMP medication-safety gates (five-rights, HAM dual-witness, allergy screen, HAM flagging, dose units, LASA). Concentrated in marController + DoctorOrderModel + medicationSafety.

| # | Sev | Finding | Fix | Eff |
|---|---|---|---|:--:|
| 13 | H | HAM two-nurse independent double-check is defeatable by one nurse via free-text witness name | Require the HAM witness to be a distinct authenticated nurse (ObjectId ref, != givenBy) — reject free-text. | M |
| 14 | H | Electrolyte doses in mEq are rejected by the dose validator even though the order form offers 'mEq' as a unit | Add 'mEq' to the dose-validator's allowed units. | S |
| 25 | M | MAR five-rights gate and High-Alert-Med dual-witness are bypassable via createOrGet / addMedication | Apply the five-rights + HAM dual-witness gate on the createOrGet / addMedication embedded-administration path too. | M |
| 26 | M | HAM / concentrated-electrolyte auto-flagging ignores IV_Fluid fluidName and additives fields | isHAM()/concentrated-electrolyte detection must inspect IV_Fluid fluidName + additives, not only medicineName. | S |
| 27 | M | MAR administration path is missing the drug-allergy gate it is documented to enforce | Evaluate the drug-allergy collision on the MAR /administer path (covers ward-stock drugs with no per-patient dispense). | M |
| 44 | L | LASA / tall-man collision check silently misses drug names with a dosage-form prefix | Strip the dosage-form prefix (Inj/Tab/Cap…) before the LASA/tall-man lookup. | S |

### Wave 4 — Workflow-blocking operational bugs  *(9 findings · 5S / 4M)*
Features staff literally cannot use today — ER Expired/LAMA can't be recorded, ER→IPD accrues no charges, lab collect/reject 409s, pharmacy credit uncollectable, discharge wrongly blocked. Each is user-visible and revenue/throughput-affecting.

| # | Sev | Finding | Fix | Eff |
|---|---|---|---|:--:|
| 9 | H | ER 'Expired' disposition can never be recorded from the UI (death-cert field-shape mismatch) | Align the Expired death-cert payload keys (declaredBy/immediateCause/mannerOfDeath) between the modal and updateDisposition (frontend or accept both). | S |
| 10 | H | ER 'Left Against Medical Advice' disposition can never be recorded from the UI (missing patientSignature) | Include patientSignature in the DAMA payload (or relax the required field) so LAMA disposition saves. | S |
| 11 | H | ER->IPD bridge admission accrues ZERO bed/nursing/room charges for the entire inpatient stay | ER→IPD bridge admission must set roomId/roomCategory + an admissionType the bed/nursing gate accepts (IPD/DAYCARE) so bed-day + nursing charges accrue. | M |
| 12 | H | collectSamples() hard-fails (409) on any order already IN_PROGRESS — add-on / staggered sample collection is blocked and no accession is minted | collectSamples must mint accessions for newly-added PENDING items even when the order is IN_PROGRESS — guard per-item, not per-order. | M |
| 15 | H | Outstanding pharmacy credit on Supplemented / Partial-Return sales is uncollectable, blocking IPD discharge | collectCredit / applyAdvanceToSale must handle Supplemented / Partial-Return statuses (compute outstanding from balanceDue regardless of status). | M |
| 21 | M | Generic ER update (PUT /:emergencyNumber) lets Admin set terminal dispositions, bypassing the disposition state machine | Strip 'disposition' from the generic ER PUT for ALL roles (incl. Admin) — force it through the disposition state machine. | S |
| 22 | M | Discharge OT/procedure gate is UHID-scoped (patient-wide) instead of admission-scoped, blocking legitimate discharges | Scope the open-procedure discharge gate to the current admissionId, not the whole UHID. | S |
| 23 | M | rejectSample() forces resultStatus COMPLETED->PENDING which the LabResult guard rejects — rejecting a compromised specimen after results are entered 409s and rejects nothing | Allow a COMPLETED→PENDING (or a REJECTED-result) transition for sample rejection so a compromised specimen can actually be rejected + recollected. | M |
| 35 | M | Overlay onto uploaded insurer PDF omits ignoreEncryption — encrypted official forms upload fine but every 'company form' print 500s (no fallback) | Pass ignoreEncryption:true when overlaying the uploaded insurer PDF (+ fall back to the generated form on failure). | S |

### Wave 5 — Audit, cron & register completeness  *(10 findings · 6S / 4M)*
Silent gaps: crons swallow errors (no retry, false heartbeat), audit rows dropped by bad enums, statutory registers raised late / never / from the wrong producer. Surveyor-critical but not day-1 blocking.

| # | Sev | Finding | Fix | Eff |
|---|---|---|---|:--:|
| 8 | H | Entire doctor-order lifecycle + infusion completion audit is silently dropped (invalid enum event "STATUS_CHANGE") | Add the real event strings ('STATUS_CHANGE' etc.) to the ClinicalAudit event enum (or emit a valid value) so order-lifecycle audit rows actually persist. | S |
| 16 | H | 10 scheduleDaily cron callbacks swallow their own errors (return {error}) — CronFailure is never recorded, the retry sweeper never replays them, and a false "ok" heartbeat is written to the BillingAudit register | Cron callbacks must THROW on failure (not return {error}) so cronScheduler records CronFailure + retries; never write a false 'ok' heartbeat on error. | M |
| 24 | M | Shift-handover vitals snapshot is always empty (date-format mismatch with VitalSheet) | Match the VitalSheet date format when fetching the handover vitals snapshot. | S |
| 28 | M | Schedule-X (NDPS narcotic) running balance is never reversed on return, cancel, or vendor-return, drifting the statutory register out of sync with physical stock | Reverse ScheduleXBalance on return / cancel / vendor-return so the narcotic register tracks physical stock. | M |
| 31 | M | Notifiable-disease register auto-raises only at discharge finalize, missing the IDSP statutory reporting window for inpatients | Raise the notifiable-disease register at diagnosis/lab-confirm (admission time), not only at discharge finalize. | M |
| 39 | L | PROM/PREM survey signature emits an invalid enum event, dropping every audit row | Emit a valid ClinicalAudit enum for the PROM/PREM survey-signature audit row. | S |
| 40 | L | Demo-seed order route emits invalid enum event "SEED_DEMO" (audit row silently dropped) | Use a valid enum (or skip audit) for the demo-seed order route. | S |
| 42 | L | Readmission register treats auto-closed OPD visits as the index discharge, inflating the NABH COP.16 readmission metric | Exclude OPD-type auto-closed visits from the readmission index (don't count OPD→IPD same-day as a readmission). | S |
| 45 | L | getCompleteFile silently caps several sections without surfacing them in the truncation flag | Add the fixed-cap sections (bills@50, prescriptions/pharmacy@100…) to the truncation marker. | S |
| 47 | L | Fall-with-major-injury → SentinelEventRegister auto-chain is unreachable dead code (no producer sends the trigger fields) | Wire the fall-with-major-injury trigger fields from FallRiskAssessment so the sentinel-event auto-chain actually fires (currently dead code). | M |

### Wave 6 — Security hardening  *(6 findings · 5S / 1M)*
PHI file-serving without ownership authz, a forgeable register-HMAC default secret, unescaped $regex search, and a print PHI leak. Batch the security review together.

| # | Sev | Finding | Fix | Eff |
|---|---|---|---|:--:|
| 29 | M | Print Center section picker fails to strip physical exam + admission vitals (PHI leaks into subset/"Billing-only" prints) | Strip physical-exam + admission-vitals for the excluded sections in CompleteIPDFile (as it already does for history/ia). | S |
| 30 | M | PHI file-serving route (/uploads/*) has authentication but no role/ownership authorization — any authenticated role can read files the metadata APIs restrict | Add role/ownership authorization on the /uploads/* PHI file-serving route (not just authentication). | M |
| 32 | M | createPatient accepts client-supplied UHID/patientId, bypassing the atomic sequence | Strip client-supplied UHID/patientId in createPatient (as updatePatient already does). | S |
| 33 | M | NABH register tamper-evidence falls back to a source-known HMAC secret (no fail-fast, undocumented env var) — forgeable in production | Add REGISTER_HMAC_SECRET to requireEnv() (fail-fast) + the .env examples — don't silently key on the source-known dev default. | S |
| 46 | L | Code-blue respond/close reachable by Ward Boy despite route comment stating 'only doctor/nurse close' | Restrict code-blue respond/close to Doctor/Nurse (matches the route's own comment). | S |
| 50 | L | Regex injection / ReDoS in several authenticated search services — existing escapeRegex guard not applied | Apply escapeRegex + a length cap to the user-search $regex (and audit the other raw-$regex search services). | S |

### Wave 7 — ABDM (do before ABDM go-live)  *(3 findings · 2S / 1M)*
Consent window/frequency + demographic-match defects — but ABDM is feature-flagged OFF, so not live until enabled. Fold into the NHA M1–M4 certification prep.

| # | Sev | Finding | Fix | Eff |
|---|---|---|---|:--:|
| 1 | H | Consent permission.dateRange is never enforced — HIP pushes all-time clinical records outside the consented date window (PHI over-disclosure) | Enforce permission.dateRange — filter every clinical query in the HIP data-flow assembly to the consented window. | M |
| 17 | M | Discovery demographic match ignores yearOfBirth in the name fallback — returns the wrong same-named patient's care contexts | Include yearOfBirth in the demographic name-fallback match. | S |
| 37 | L | Consent permission.frequency (allowed fetch count/period) is stored but never enforced — unlimited repeat pulls served per consent | Enforce permission.frequency (allowed fetch count/period) before serving a repeat pull. | S |

### Wave 8 — Low-impact polish / quick wins  *(6 findings · 6S / 0M)*
Cosmetic or narrow-edge (visit counters, IST date match, seed-counter edge, doctor-access flag, fp field). Cheap; sweep in one batch whenever convenient.

| # | Sev | Finding | Fix | Eff |
|---|---|---|---|:--:|
| 18 | M | GSTR-1 and GSTR-3B 'fp' return-period field is YYYYMM instead of GSTN-required MMYYYY | Emit GSTR-1/3B 'fp' as MMYYYY (not YYYYMM). | S |
| 38 | L | BILL/REC seed self-heal uses lexicographic sort with 2-digit padding — can reissue an existing number when a counter is absent past serial 99 | Self-heal the BILL/REC counter by NUMERIC max, not lexicographic, so serial >99 isn't reissued. | S |
| 41 | L | checkDoctorAccess populates attendingDoctorId against the wrong model, making isOwner always false | Populate attendingDoctorId against the correct model so checkDoctorAccess isOwner works. | S |
| 43 | L | GET MAR by IPD+date exact-match fails in IST due to local-vs-UTC midnight mismatch | IST-aware date-range match on GET MAR by ipd+date (not exact-equality on a UTC-shifted midnight). | S |
| 48 | L | Emergency visit counter double-incremented on ER registration | Remove the duplicate Emergency visit-count increment (one of the two $inc sites). | S |
| 49 | L | IPD/Daycare visit counters never incremented for returning patients' subsequent admissions | Increment IPD/Daycare/Services visit counters on createAdmission (mirror the existing cancel-decrement). | S |

---

## Full index — all 50 with file + fix
| # | Sev | Wave | Dim | Finding | File | Recommended fix | Eff |
|---|---|:--:|---|---|---|---|:--:|
| 2 | H | 1 | `accounts` | Cancelled numbered invoices are double-reversed in GST → output tax under-reported / under-paid | `Backend/services/Reports/gstService.js:60:gstService.js:60-63 / billingController.js:1915` | cancelBill must not ALSO cut a full-value CreditNote for an unpaid/never-filed bill — reverse GST once (single path), or gate CN creation on 'was filed'. | M |
| 3 | H | 1 | `billing` | Credit note over-reverses GST — tax split uses pre-tax net as denominator instead of tax-inclusive total | `Backend/services/Billing/billingService.js:2223-2226` | recordRefund tax split: use the tax-INCLUSIVE total as the denominator (taxShare = amt/(net+tax)*tax), not the pre-tax net. | S |
| 7 | H | 1 | `concurrency` | Concurrent advance apply + refund double-spends the same deposit (stale-doc save resurrects a REFUNDED advance) | `Backend/services/Billing/patientAdvanceService.js:182` | Make apply + refund atomic: findOneAndUpdate with a status/appliedAmount precondition (or a version guard) so a stale-doc save can't resurrect a REFUNDED advance. | M |
| 19 | M | 1 | `billing` | Discharge waterfall silently absorbs overpayment onto the last bill with no advance/refund record | `Backend/controllers/Patient/admissionController.js:1221` | Discharge bill-clear must reject/route OVER-payment to advance or refund — don't silently absorb it onto the last bill. | M |
| 34 | M | 1 | `tpa-claims` | TPA short-pay routed to patient (default) becomes uncollectable — balanceAmount stored as 0 and per-bill collection blocked with OVERPAY | `Backend/controllers/Billing/billingController.js:2411-2456 (PATIENT branch)` | TPA short-pay-to-patient: recompute patientPayable/balanceAmount so the shortfall is collectable (don't store balance 0 / OVERPAY-block it). | M |
| 36 | M | 1 | `tpa-claims` | Refund cash cap counts TPA settlement (TPA_CLAIM) as refundable cash — insurer money can be paid out of the till to the patient | `Backend/services/Billing/billingService.js:2032-2043` | Exclude TPA_CLAIM rows from refundableCash so insurer money can't be refunded as cash from the till. | S |
| 4 | H | 2 | `clinical-docs` | A signed doctor note becomes deletable after one amendment - amend-then-delete erases the attested record | `Backend/services/Doctor/doctorNotesService.js:1157` | Delete guard must block any attested state — status ∈ {signed, amended}, not just 'signed'. | S |
| 5 | H | 2 | `clinical-docs` | A submitted nurse note becomes deletable after one amendment - same amend-then-delete data loss | `Backend/services/Nurse/nurseNotesService.js:645` | Nurse delete guard must block {submitted, amended} (not just submitted). | S |
| 6 | H | 2 | `clinical-docs` | PUT on an already-amended doctor note silently rewrites the attested record in place - no addendum, no amendment entry, no audit | `Backend/services/Doctor/doctorNotesService.js:791` | updateDoctorNote in-place path must reject a signed OR amended note — route edits through amend/addendum. | S |
| 20 | M | 2 | `clinical-docs` | PUT and blood-transfusion PATCHes mutate an already-amended nurse note in place, bypassing the append-only trail | `Backend/services/Nurse/nurseNotesService.js:463` | Apply the append-only guard on nurse PUT + blood-monitoring/status PATCH (block in-place when submitted\|amended). | S |
| 13 | H | 3 | `orders-rx` | HAM two-nurse independent double-check is defeatable by one nurse via free-text witness name | `Backend/routes/Doctor/doctorOrderRoutes.js:1345-1372` | Require the HAM witness to be a distinct authenticated nurse (ObjectId ref, != givenBy) — reject free-text. | M |
| 14 | H | 3 | `orders-rx` | Electrolyte doses in mEq are rejected by the dose validator even though the order form offers 'mEq' as a unit | `Backend/models/Doctor/DoctorOrderModel.js:280` | Add 'mEq' to the dose-validator's allowed units. | S |
| 25 | M | 3 | `nursing` | MAR five-rights gate and High-Alert-Med dual-witness are bypassable via createOrGet / addMedication | `D:\Spherehealth\Backend\controllers\Clinical\marController.js:74-89` | Apply the five-rights + HAM dual-witness gate on the createOrGet / addMedication embedded-administration path too. | M |
| 26 | M | 3 | `orders-rx` | HAM / concentrated-electrolyte auto-flagging ignores IV_Fluid fluidName and additives fields | `Backend/models/Doctor/DoctorOrderModel.js:644-649` | isHAM()/concentrated-electrolyte detection must inspect IV_Fluid fluidName + additives, not only medicineName. | S |
| 27 | M | 3 | `orders-rx` | MAR administration path is missing the drug-allergy gate it is documented to enforce | `Backend/controllers/Clinical/marController.js:153-357` | Evaluate the drug-allergy collision on the MAR /administer path (covers ward-stock drugs with no per-patient dispense). | M |
| 44 | L | 3 | `orders-rx` | LASA / tall-man collision check silently misses drug names with a dosage-form prefix | `Backend/services/Clinical/medicationSafety.js:101-119` | Strip the dosage-form prefix (Inj/Tab/Cap…) before the LASA/tall-man lookup. | S |
| 9 | H | 4 | `emergency` | ER 'Expired' disposition can never be recorded from the UI (death-cert field-shape mismatch) | `Frontend/src/pages/emergency/EmergencyList.jsx:383 (frontend)` | Align the Expired death-cert payload keys (declaredBy/immediateCause/mannerOfDeath) between the modal and updateDisposition (frontend or accept both). | S |
| 10 | H | 4 | `emergency` | ER 'Left Against Medical Advice' disposition can never be recorded from the UI (missing patientSignature) | `Frontend/src/pages/emergency/EmergencyList.jsx:380 (frontend)` | Include patientSignature in the DAMA payload (or relax the required field) so LAMA disposition saves. | S |
| 11 | H | 4 | `emergency` | ER->IPD bridge admission accrues ZERO bed/nursing/room charges for the entire inpatient stay | `Backend/services/Patient/emergencyService.js:382-405 (stub create` | ER→IPD bridge admission must set roomId/roomCategory + an admissionType the bed/nursing gate accepts (IPD/DAYCARE) so bed-day + nursing charges accrue. | M |
| 12 | H | 4 | `lab` | collectSamples() hard-fails (409) on any order already IN_PROGRESS — add-on / staggered sample collection is blocked and no accession is minted | `Backend/services/Investigation/investigationOrderService.js:208 (set)` | collectSamples must mint accessions for newly-added PENDING items even when the order is IN_PROGRESS — guard per-item, not per-order. | M |
| 15 | H | 4 | `pharmacy` | Outstanding pharmacy credit on Supplemented / Partial-Return sales is uncollectable, blocking IPD discharge | `Backend/controllers/Pharmacy/pharmacyController.js:2608 (collectCredit) and 2773 (applyAdvanceToSale) vs 1897 (getOutstandingForAdmission) / 3303 / 3604 / 3619` | collectCredit / applyAdvanceToSale must handle Supplemented / Partial-Return statuses (compute outstanding from balanceDue regardless of status). | M |
| 21 | M | 4 | `emergency` | Generic ER update (PUT /:emergencyNumber) lets Admin set terminal dispositions, bypassing the disposition state machine | `Backend/controllers/Patient/emergencyController.js:187-201 (updateEmergencyVisit)` | Strip 'disposition' from the generic ER PUT for ALL roles (incl. Admin) — force it through the disposition state machine. | S |
| 22 | M | 4 | `ipd` | Discharge OT/procedure gate is UHID-scoped (patient-wide) instead of admission-scoped, blocking legitimate discharges | `Backend/services/Patient/admissionService.js:357-361` | Scope the open-procedure discharge gate to the current admissionId, not the whole UHID. | S |
| 23 | M | 4 | `lab` | rejectSample() forces resultStatus COMPLETED->PENDING which the LabResult guard rejects — rejecting a compromised specimen after results are entered 409s and rejects nothing | `Backend/services/Investigation/investigationOrderService.js:239-253 (esp. 247)` | Allow a COMPLETED→PENDING (or a REJECTED-result) transition for sample rejection so a compromised specimen can actually be rejected + recollected. | M |
| 35 | M | 4 | `tpa-claims` | Overlay onto uploaded insurer PDF omits ignoreEncryption — encrypted official forms upload fine but every 'company form' print 500s (no fallback) | `Backend/services/Billing/insurerFormService.js:278` | Pass ignoreEncryption:true when overlaying the uploaded insurer PDF (+ fall back to the generated form on failure). | S |
| 8 | H | 5 | `data-integrity` | Entire doctor-order lifecycle + infusion completion audit is silently dropped (invalid enum event "STATUS_CHANGE") | `Backend/routes/Doctor/doctorOrderRoutes.js:49-50` | Add the real event strings ('STATUS_CHANGE' etc.) to the ClinicalAudit event enum (or emit a valid value) so order-lifecycle audit rows actually persist. | S |
| 16 | H | 5 | `resilience` | 10 scheduleDaily cron callbacks swallow their own errors (return {error}) — CronFailure is never recorded, the retry sweeper never replays them, and a false "ok" heartbeat is written to the BillingAudit register | `Backend/index.js:770-807` | Cron callbacks must THROW on failure (not return {error}) so cronScheduler records CronFailure + retries; never write a false 'ok' heartbeat on error. | M |
| 24 | M | 5 | `nursing` | Shift-handover vitals snapshot is always empty (date-format mismatch with VitalSheet) | `D:\Spherehealth\Backend\services\Nurse\shiftHandoverService.js:6-21` | Match the VitalSheet date format when fetching the handover vitals snapshot. | S |
| 28 | M | 5 | `pharmacy` | Schedule-X (NDPS narcotic) running balance is never reversed on return, cancel, or vendor-return, drifting the statutory register out of sync with physical stock | `Backend/controllers/Pharmacy/pharmacyController.js:returnItems 3211-3216` | Reverse ScheduleXBalance on return / cancel / vendor-return so the narcotic register tracks physical stock. | M |
| 31 | M | 5 | `registers` | Notifiable-disease register auto-raises only at discharge finalize, missing the IDSP statutory reporting window for inpatients | `Backend/controllers/Clinical/dischargeSummaryController.js:453-464` | Raise the notifiable-disease register at diagnosis/lab-confirm (admission time), not only at discharge finalize. | M |
| 39 | L | 5 | `data-integrity` | PROM/PREM survey signature emits an invalid enum event, dropping every audit row | `Backend/controllers/Clinical/promPremSurveyController.js:219-229` | Emit a valid ClinicalAudit enum for the PROM/PREM survey-signature audit row. | S |
| 40 | L | 5 | `data-integrity` | Demo-seed order route emits invalid enum event "SEED_DEMO" (audit row silently dropped) | `Backend/routes/Doctor/doctorOrderRoutes.js:2358-2360` | Use a valid enum (or skip audit) for the demo-seed order route. | S |
| 42 | L | 5 | `ipd` | Readmission register treats auto-closed OPD visits as the index discharge, inflating the NABH COP.16 readmission metric | `Backend/services/Compliance/nabhRegisterEmitter.js:1447-1462` | Exclude OPD-type auto-closed visits from the readmission index (don't count OPD→IPD same-day as a readmission). | S |
| 45 | L | 5 | `prints` | getCompleteFile silently caps several sections without surfacing them in the truncation flag | `Backend/controllers/Clinical/patientFileController.js:565-572` | Add the fixed-cap sections (bills@50, prescriptions/pharmacy@100…) to the truncation marker. | S |
| 47 | L | 5 | `registers` | Fall-with-major-injury → SentinelEventRegister auto-chain is unreachable dead code (no producer sends the trigger fields) | `Backend/services/Compliance/nabhRegisterEmitter.js:651-673` | Wire the fall-with-major-injury trigger fields from FallRiskAssessment so the sentinel-event auto-chain actually fires (currently dead code). | M |
| 29 | M | 6 | `prints` | Print Center section picker fails to strip physical exam + admission vitals (PHI leaks into subset/"Billing-only" prints) | `Frontend/src/Components/print/printables/CompleteIPDFile.jsx:42-92` | Strip physical-exam + admission-vitals for the excluded sections in CompleteIPDFile (as it already does for history/ia). | S |
| 30 | M | 6 | `rbac` | PHI file-serving route (/uploads/*) has authentication but no role/ownership authorization — any authenticated role can read files the metadata APIs restrict | `Backend/routes/Files/uploadsRoutes.js:56-58 (mount: Backend/index.js:1377)` | Add role/ownership authorization on the /uploads/* PHI file-serving route (not just authentication). | M |
| 32 | M | 6 | `registration` | createPatient accepts client-supplied UHID/patientId, bypassing the atomic sequence | `Backend/services/Patient/patientService.js:26-73 (no strip)` | Strip client-supplied UHID/patientId in createPatient (as updatePatient already does). | S |
| 33 | M | 6 | `security` | NABH register tamper-evidence falls back to a source-known HMAC secret (no fail-fast, undocumented env var) — forgeable in production | `Backend/utils/registerIntegrity.js:42-59` | Add REGISTER_HMAC_SECRET to requireEnv() (fail-fast) + the .env examples — don't silently key on the source-known dev default. | S |
| 46 | L | 6 | `rbac` | Code-blue respond/close reachable by Ward Boy despite route comment stating 'only doctor/nurse close' | `Backend/routes/Clinical/wardOpsRoutes.js:33-36` | Restrict code-blue respond/close to Doctor/Nurse (matches the route's own comment). | S |
| 50 | L | 6 | `security` | Regex injection / ReDoS in several authenticated search services — existing escapeRegex guard not applied | `Backend/services/User/userService.js:624-627` | Apply escapeRegex + a length cap to the user-search $regex (and audit the other raw-$regex search services). | S |
| 1 | H | 7 | `abdm` | Consent permission.dateRange is never enforced — HIP pushes all-time clinical records outside the consented date window (PHI over-disclosure) | `Backend/services/Abdm/abdmDataFlowService.js:19-49` | Enforce permission.dateRange — filter every clinical query in the HIP data-flow assembly to the consented window. | M |
| 17 | M | 7 | `abdm` | Discovery demographic match ignores yearOfBirth in the name fallback — returns the wrong same-named patient's care contexts | `Backend/services/Abdm/abdmLinkService.js:116-120` | Include yearOfBirth in the demographic name-fallback match. | S |
| 37 | L | 7 | `abdm` | Consent permission.frequency (allowed fetch count/period) is stored but never enforced — unlimited repeat pulls served per consent | `Backend/services/Abdm/abdmDataFlowService.js:142-146` | Enforce permission.frequency (allowed fetch count/period) before serving a repeat pull. | S |
| 18 | M | 8 | `accounts` | GSTR-1 and GSTR-3B 'fp' return-period field is YYYYMM instead of GSTN-required MMYYYY | `Backend/services/Tax/gstr1Exporter.js:830:gstr1Exporter.js:830` | Emit GSTR-1/3B 'fp' as MMYYYY (not YYYYMM). | S |
| 38 | L | 8 | `accounts` | BILL/REC seed self-heal uses lexicographic sort with 2-digit padding — can reissue an existing number when a counter is absent past serial 99 | `Backend/services/Billing/billingService.js:39-64 (generateBillNumber)` | Self-heal the BILL/REC counter by NUMERIC max, not lexicographic, so serial >99 isn't reissued. | S |
| 41 | L | 8 | `ipd` | checkDoctorAccess populates attendingDoctorId against the wrong model, making isOwner always false | `Backend/services/Patient/admissionService.js:1669-1673` | Populate attendingDoctorId against the correct model so checkDoctorAccess isOwner works. | S |
| 43 | L | 8 | `nursing` | GET MAR by IPD+date exact-match fails in IST due to local-vs-UTC midnight mismatch | `D:\Spherehealth\Backend\controllers\Clinical\marController.js:102-107` | IST-aware date-range match on GET MAR by ipd+date (not exact-equality on a UTC-shifted midnight). | S |
| 48 | L | 8 | `registration` | Emergency visit counter double-incremented on ER registration | `Backend/services/Patient/patientService.js:149-157 (also emergencyService.js:96)` | Remove the duplicate Emergency visit-count increment (one of the two $inc sites). | S |
| 49 | L | 8 | `registration` | IPD/Daycare visit counters never incremented for returning patients' subsequent admissions | `Backend/services/Patient/patientService.js:62-68 (create pre-set)` | Increment IPD/Daycare/Services visit counters on createAdmission (mirror the existing cancel-decrement). | S |

*The # column matches the numbering in `AUDIT-R8-20DIM.md`. Full failure scenario + reproduction per finding is in the audit workflow journal (`his-audit-r8-20dim`).*
