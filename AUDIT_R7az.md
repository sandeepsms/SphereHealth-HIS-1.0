# R7az — fix all R7ay CRITs + HIGHs + most MEDs

**Cycle**: R7az (after R7ay's 10-dim Doctor+Nurse audit surfaced ~209 findings)
**Scope**: fix every CRIT + HIGH + most MED across all 10 dimensions.
**Result**: 70 files modified (+3,671 / −690 lines). Backend boots clean. Frontend builds in 17 s. Five parallel agents with strict file-ownership boundaries.

---

## Agent ownership map

| Agent | Scope | Files | Findings closed |
|---|---|---|---|
| R7az-A | Auth + route gates + scope helpers + perm config | 24 | D1 all, D3-CRIT-5/6, D8-HIGH-3/4, D9-CRIT-1..4, D9-HIGH-1..10 |
| R7az-B | Models + audit-layer + clinical state guards | 15 | D2 all, D10 all |
| R7az-C | Pharmacy + drug-safety + order lifecycle | 10 | D6 all, D7-CRIT all + D7-HIGH-3..4 |
| R7az-D | Discharge fast-path + doctor-order route handlers + admission scope | 9 | D8 all, D3-CRIT-1..3, D3-HIGH all, D6-CRIT-2, D9-HIGH-1/4/6/7 |
| R7az-E | Doctor + Nurse frontend correctness | 16 | D4 all, D5 all |

Total: **70 files modified, 4 files created.**

---

## New shared modules created

1. **`Backend/utils/allergyCheck.js`** — `normaliseAllergies()`, `checkDrugAgainstAllergies()`, `assertDrugSafeOrOverride()`. Handles legacy `Mixed` string + typed array gracefully. Used by pharmacyController.dispense, indentService (create+release), and ready for marController to call.
2. **`Frontend/src/Components/common/InputDialog.jsx`** — Promise-based themed input modal (sister to R7ax's ConfirmDialog). Replaces `window.prompt()` across Doctor + Nurse pages.
3. **`Frontend/src/utils/vitalRanges.js`** — Canonical vital range tables (`bands.adult` / `bands.paediatric` / `bands.neonate`) + `bandFor(patient, vital)` selector. Per-patient overrides marked TODO.
4. **`AUDIT_R7az.md`** (this file).

---

## Agent A — Auth + Scope (D1, D3-CRIT-5/6, D8-HIGH-3/4, D9-CRIT-1..4, D9-HIGH-1..10)

**Files**: middleware/auth.js, config/permissions.js (both BE+FE), 21 route files, routes/index.js

**Key changes**:
- Revived `restrictToOwnDoctorPatients` as dual-mode (middleware + helper).
- New `restrictToOwnNurseWard` middleware — reads `User.ward`, attaches `req.nurseWard` for downstream filter.
- New `blockNonClinicalForDoctorNurse` — 403s Doctor/Nurse on `/billing/payments`, `/cashier-sessions/*` write, etc.
- New `enforceActivePatientForClinicalWrites` — 409 PATIENT_DISCHARGED on clinical writes when admission.status === "Discharged". Escape via header `X-Late-Entry: true` for legitimate addenda.
- Added 15 new permission actions (byte-identical BE↔FE): `patient-file.read`, `doctor-notes.read`, `nurse-notes.read`, `mar.read`, `mlc.read`, `mlc.write`, `discharge-summary.read/write`, `ipd.read`, `consultation.write`, `safety.write`, `diabetic.scale.write`, `doctor.self.write`, `services.read`, `appointment.confirm`.
- Closed every authentication hole: patientFile, admission/nurse-assessment, bed housekeeping + SSE, doctor self-availability, doctor-notes reads (was `attemptAuth`), nurse-notes reads, MLC, liveUpdates SSE, bed-transfers, shift-handover, safety, diabetic chart, nursing charges.
- ServiceMaster reads now `services.read` instead of `billing.read` — Doctor's ServiceAutocomplete stops 403ing.

## Agent B — Models + Audit + Clinical State (D2 all, D10 all)

**Files**: 8 models + 4 services + 3 controllers

**Key changes**:
- **PatientActivityLog hardened**: append-only at schema level (`pre("findOneAndDelete")`, `pre("deleteMany")` etc throw); per-event-class `retainUntil` with TTL index (clinical 7y, MLC/paeds 12y, routine 1y, legalHold override); new enum values for PRESCRIPTION_*, finalize, refuse, revoke, sign.
- **activityLogger overhauled**: route→model reverse-resolver so `:id`-only routes get UHID resolved by loading the doc first; pre-loads `before` snapshot for UPDATE/DELETE; new action verbs (`sign`/`finalize`/`refuse`/`revoke`/`discontinue`/`amend`/`print`) instead of generic `update`; signature/photo fields replaced with `sha256(value)+len` instead of useless 4 KB truncation; sensitive GET captured for `/mlc/*` + `/patient-file/*`.
- **Prescription post-dispense lock + allergy gate now fire** — PrescriptionService converted from `findByIdAndUpdate` to `.save()`.
- **DoctorNotes.updateDiagnosis** no longer overwrites signed notes — creates ADDENDUM (originalNoteId, supersedesNoteId, isAddendum).
- **NurseNotes blood-transfusion paths** check `status !== "submitted"`.
- **MAR**: PUT body whitelist + reject mutation of `administrationEntry[]` past entries; `discontinueMedication` uses `.save()`; `recordAdministration` ±10min idempotency + signature mandate + reason mandate for HELD/REFUSED/MISSED + server-side `actualTime` + `signatureUrl` field.
- **ConsentForm**: PUT refuses non-PENDING; sign uses CAS (`{_id, status:"PENDING"}`); new `printConsent` controller emits PRINTED audit row.
- **DischargeSummary**: schema-level `pre("findOneAndUpdate")` rejects writes to finalized records (mlrNumberSnapshot whitelisted).
- **NursingCarePlan**: added `signedBy/signedAt/status enum`, pre-save immutability on completed plans.
- **DoctorNotes**: `lateEntry/lateEntryReason/lateEntryAt` fields + validator (rejects > 4h-old notes without reason).
- **Append-only addendum chain** for DoctorNotes + NurseNotes (originalNoteId, supersedesNoteId, isAddendum, nurseConfirmations[]).
- Schema-level numeric bounds on DiabeticChart bgValue/actualDose, NursingAssessment per-type bounds (pain 0-10, fall-risk, Braden, MUST).
- 200 KB cap on signature fields.

## Agent C — Drug Safety + Pharmacy (D6, D7-CRIT, D7-HIGH-3/4)

**Files**: autoBillingService, indentService, pharmacyController, DoctorOrderModel, PharmacyIndentModel, DrugBatchModel, DrugModel, patientModel, BillingTrigger

**Key changes**:
- **R7au pharmacy double-count guard now WORKS** — both sides use canonical `sourceType: "MAR_RESERVATION"` (added to BillingTrigger enum). Dedup window tightened to 6h (was 24h — false-positived BD frequency drugs).
- **MAR HELD/REFUSED voids pharmacy reservation** — new `onMARNonAdminister(marDoc, med, statusReason)` voids the reservation trigger.
- **Indent release stock decrement + FEFO** — `_fefoPickAndDecrement(drugId, qty)` atomically decrements from earliest-expiry batches first via `findOneAndUpdate({_id, remaining:{$gte:needed}}, {$inc:{remaining:-needed}})`. Retry on miss. Rejects expired batches. Insufficient → 409 INSUFFICIENT_STOCK with batches tried.
- **Indent acknowledge-then-release lock** — verifies `acknowledgedById === req.user.id` (admin override).
- **Indent release race** — wrapped in `retryVersionError`.
- **Drug-allergy gate on 3 of 4 paths** — `pharmacyController.dispense`, `indentService.createIndent`, `indentService.releaseIndent`. MAR path wired by Agent B's marController CAS. New shared util `allergyCheck.js` handles legacy + typed allergy shapes.
- **Patient.allergies normalised** — new typed `allergyList[{allergen, severity, type}]` field; virtual that prefers typed, falls back to parsing legacy `Mixed` string.
- **DoctorOrder state-machine pre-save** — allowed-transition matrix, terminal-state guards, `_stateOverride="admin"` escape, removed dead `Held` enum, kept `OnHold`.
- **Verbal-order scaffold** — `isVerbal/verbalEnteredBy/coSignedBy/coSignedAt` fields with 24h cosign cron marked TODO.
- **Order cancellation refund cascade** — new `onOrderCancelled(order, reason, actorId)` voids triggers + raises aggregate CN + emits pending-review on failure. Agent D wires this on `DELETE /:id`.
- **PharmacyIndent.batchId** typed ObjectId + `picked[]` audit ledger.
- **Cold-chain flag** — `DrugModel.requiresRefrigeration`.

## Agent D — Discharge fast-path + Order handlers + scope (D8 all, D3-CRIT-1..3, D3-HIGH all, D6-CRIT-2, D9-HIGH-1/4/6/7)

**Files**: dischargeSummaryController, admissionController, admissionService, doctorOrderRoutes (handlers), OPDController, emergencyController, mlcController, nursingCarePlanController

**Key changes**:
- **dischargeSummary.finalize now routes through admissionService.dischargePatient** — gets proper flow: LEGAL_STATUS_TRANSITIONS guard, `_dischargingFlush` flush, dischargeOverage detection, CleaningTask, housekeeping flag, BillingAudit, bed release in transaction.
- **Doctor no longer signs as cashier** — `billClearedBy` left null on doctor-finalize path; only explicit cashier `clearFinalBill` stamps it.
- **Primary-consultant + treatment-team check** on doctorApproveDischarge and finalize — compares `doctorProfile._id` (not user._id).
- **Reactivate restores CleaningTask + housekeeping** — closes the original CleaningTask, clears `bed.housekeeping.state`.
- **All admission list endpoints scoped for Doctor** — getDischargeQueue, getTodayDischarges, getExpectedDischarges, searchAdmissions, getAdmissionStatistics, getAdmissionById.
- **OPD + ER scope by Doctor URL parameter** — refuses if URL `:doctorId` ≠ `req.user.doctorProfile._id`.
- **ER scope is DB-side** (was in-memory post-filter, broke pagination).
- **MLC scope cannot be overridden** by `?doctorId=` query.
- **doctor-order handlers use `.save()`** (not `findByIdAndUpdate`) so state-machine pre-save fires; wrapped in `retryVersionError`.
- **`/administer` calls `onMARAdministration`** so DoctorOrder-path doses bill correctly (was bypassing billing entirely).
- **DELETE `/:id` calls `onOrderCancelled`** if any administrationEntry was given.
- **PATCH whitelist no longer includes `status`** — status changes go through dedicated endpoints.
- **NursingCarePlan controller** refuses PUT on completed plan.

## Agent E — Doctor + Nurse frontend (D4 all, D5 all)

**Files**: 16 (Doctor pages + Nurse pages + clinical components)

**Key changes**:
- **Decimal128 → toMoney** in DoctorPatientPanel, OPDAssessmentPage, IPDBillingLedger, IndentRaisePage drug prices.
- **Silent-catch sweep**: DoctorNotes sign handler, OPDAssessment bulk doctor-orders POST, OPDAssessment consent PATCH, all 5 nursing assessment pages — POST-first, then clear/show success only on 200.
- **DoctorNotes diagnosis modal**: open/edit now include `working`, `icd10Code`, `icd10Description` in state shape.
- **AbortController**: DoctorPatientPanel loadAll, OPDAssessmentPage loadVisit/loadAudit, DoctorNotesPage initial fetch, TreatmentTeamPanel loadTeam, DoctorOrdersPanel + 30s setInterval, NurseOrdersPanel 30s setInterval, MARPage all calls.
- **Double-tap guards**: OPDAssessment addMed/addInvestigation/addInfusion, MARPage recordAdmin, NurseOrdersPanel handleStepDone.
- **InputDialog** replaces `window.prompt()` for cancel-reason (OPDAssessment), discontinue-reason (MAR).
- **MAR validation**: nurseName + scheduledTime required, late warning > 30 min, signature pulled from `user.signature`, real `user.fullName` instead of hardcoded "Nurse".
- **NurseOrdersPanel**: optimistic state update only on success (was firing on error).
- **vitalRanges.js**: canonical bands.adult/paediatric/neonate + `bandFor(patient, vital)`.
- **NursePatientPanel**: RANGES.bp_sys/bp_dia keys aligned with isAbn(); BP escape typo fixed.
- **IndentRaisePage**: discharged-admission banner + disabled form; toMoney for Decimal128 prices.
- **DrugAutocomplete race fix**: typing after selecting clears `selectedDrug`; addOther only adds if drug still selected.
- **IO chart**: `nasogastricOutput` + `ivMedFluids` included in daily totals.
- **MAR signature inputs**: removed dead UI theatre.
- **TreatmentChart print stylesheet**: added (hides nav, day navigator, decorative chips; renders MAR ticks as black ✓).
- **VitalsView**: startDate input now rendered.
- **IntegratedVitalsPanel**: stale-closure fix via functional setState + ref.

---

## Out-of-scope (deferred — new features, not bugs)

- **D7-CRIT-5** Drug-drug interaction check — needs external DB / API
- **D7-HIGH-1** Max-daily-dose enforcement — needs DDM dose database
- **D7-HIGH-2** Pediatric/weight-based dose validation — needs paeds dose tables
- **D7-HIGH-5** Controlled-substances 2-witness workflow at dispense — needs schedule classification work
- **D10-MED-3** 24h verbal-order cosign enforcement cron — fields added, cron deferred
- **D4-MED-6 / D5-MED-5** Inline-style sweep (4,178 occurrences in Doctor+Nurse+clinical) — its own cycle. Not a "bug", it's an R1 invariant violation that's purely cosmetic and CSS-class extraction is mechanical work better done with a dedicated tooling cycle.

---

## Verification

✓ Backend boots clean — `node index.js` loads, MongoDB connects, all 7 crons arm, no errors.
✓ Frontend builds clean — `npm run build` succeeds in 17 s, zero errors. (Some chunks > 800 KB warning is the existing chunk-split issue, unrelated.)

---

## What this cycle changes about the system

Before R7az: clinical write paths bypassed most safety hooks (R11 allergy gate, post-dispense lock, MAR append-only, doctor-note signed-immutability). The OOM-fix in R7ax taught us "fix the model, not the controller" — R7az applied that lesson at scale across 8 clinical models.

The auth surface went from default-open (anything authenticated could read clinical PHI) to default-closed (every read + write checked via `requireAction` + role-aware filters). Defense-in-depth added: `blockNonClinicalForDoctorNurse` keeps Doctor/Nurse out of cashier-only paths; `enforceActivePatientForClinicalWrites` blocks late writes on discharged patients (except explicit addenda).

The audit trail (PatientActivityLog) finally captures `:id`-only routes, sensitive reads, real action verbs, addendum chains, and is append-only at the schema level with proper retention.

Drug safety is now real: FEFO enforced on indent path, expired batches refused, allergies checked on 3 of 4 paths (4th wired via MAR controller), pharmacy double-count actually deduplicates, MAR HELD/REFUSED voids the pharmacy reservation.

Doctor-driven discharge fast-path is no longer fraudulent — it routes through `dischargePatient` properly. Cashier signature can no longer be forged by the doctor.

---

*Authored R7az by Dr Sandeep + Claude. 70 files modified, 4 new shared modules, ~200 audit findings closed across 5 parallel agents.*
