# R7ay — Doctor + Nurse role audit (10 dimensions, ~75 findings)

**Cycle**: R7ay (post R7ax OOM-fix + ConfirmDialog)
**Scope**: Two clinical user roles in depth — Doctor + Nurse. Ten orthogonal dimensions, ten parallel agents, ~12 minutes wall-clock.
**Output**: this consolidated map. No fixes applied yet.

---

## Systemic patterns that surfaced across multiple dimensions

These are the threads — fix the underlying pattern once and ~15 findings collapse:

### S1 — `restrictToOwnDoctorPatients` middleware is dead code
Exported from `Backend/middleware/auth.js:160` but **never imported anywhere**. The Doctor scope filter is hand-rolled in 4+ controllers (admission, OPD, ER, MLC) with drifting field names. (D3-CRIT-6, D9-MED-2, D1-MED-1)

### S2 — `attendingDoctorId` schema/data type mismatch
Schema declares `ref: "User"`; actual data stored is `Doctor._id`. Every `.populate("attendingDoctorId", "…")` silently returns null. Same for `treatmentTeam.doctorId`. This is the R7f bug expanded — frontend `/access` page fixed, backend still broken on five surfaces. (D3-CRIT-1, D3-CRIT-2, D3-CRIT-4, D3-MED-6)

### S3 — `findByIdAndUpdate` / `findOneAndUpdate` bypasses every Mongoose `pre('save')` guard
Same anti-pattern in: prescription post-dispense lock (R11), MAR append-only, doctor-note signed-immutability, consent-form PUT, discharge-summary PUT, drug-allergy gate. **All of R11's safety hooks are dead on the primary write paths.** (D2-CRIT-3, D2-CRIT-5, D2-CRIT-6, D2-HIGH-1, D6-HIGH-7, D7-CRIT-4)

### S4 — Doctor-driven discharge fast-path bypasses billing + audit + state machine
`dischargeSummaryController.finalize` writes the doctor's name as `billClearedBy`, never calls `flushDailyChargesForAdmission`, never runs overage detection, never creates CleaningTask, never enforces the LEGAL_STATUS_TRANSITIONS, never verifies primary-consultant. **Patient walks out with unpaid bill; audit shows doctor "cleared" it.** (D8-CRIT-1 through D8-CRIT-5)

### S5 — No nurse ward-scope anywhere
`User.ward` field exists. Zero code reads it. Every Nurse sees every patient on every ward — ICU nurse can chart in OPD; OT nurse can administer in oncology. (D1-HIGH-9, D3-CRIT-5, D9-HIGH-2)

### S6 — `:id`-only audit routes silently drop PatientActivityLog rows
`activityLogger.middleware()` resolves UHID via params/body/query only. PUT/PATCH on `/doctor-notes/:id`, `/mar/:id/.../administer`, `/discharge-summary/:id/finalize`, `/consent-forms/:id/sign` — none carry UHID, so the audit short-circuits silently. **The clinical audit feed is structurally incomplete.** (D2-CRIT-7, D10-CRIT-2, D10-HIGH-3)

### S7 — `PRESCRIPTION_*` audit actions never validate, never persist
PrescriptionService uses enum values (`"PRESCRIPTION_UPDATE"` etc.) that aren't in `ALLOWED_ACTIONS`. Every prescription edit throws Mongoose ValidationError, silently swallowed. Zero prescription audit trail in PatientActivityLog. (D2-HIGH-2, D10-CRIT-1)

### S8 — Reads of PHI are NOT audited
`activityLogger` ignores GET entirely. NABH AAC.7 + DPDP want sensitive reads tracked. MLC, complete-file, doctor-notes — all silently readable. (D9-MED-1, D10-HIGH-4)

### S9 — Silent catch blocks on critical writes
OPDAssessmentPage's bulk doctor-orders POST, DoctorNotes sign, ConsentForm PATCH, all 5 nursing assessment pages — fire-and-forget catches show "Saved ✓" even when the server rejected. (D4-CRIT-3, D4-CRIT-4, D4-HIGH-5, D5-CRIT-1)

### S10 — Inline-style explosion
Doctor pages: **1,362** `style={{…}}` occurrences. Nurse pages: **1,222**. Clinical components: another 1,594. R1's invariant was supposed to keep these out — never enforced for clinical surfaces. (D4-MED-6, D5-MED-5)

---

## CRIT findings (must fix — patient safety / data integrity / privacy)

| # | Tag | Headline |
|---|---|---|
| 1 | D1-CRIT-1 | `/patient-file/:uhid/complete` has zero auth gate — any role dumps full PHI |
| 2 | D1-CRIT-2 | `/admissions/:id/nurse-assessment` and `/initial-assessment` have no `requireAction` |
| 3 | D1-CRIT-3 | `/api/bedss/*` housekeeping + SSE stream have no gate |
| 4 | D1-CRIT-4 | `/doctors/:id/availability` + `/serve-next` — caller ownership not enforced |
| 5 | D2-CRIT-1 | ConsentForm PUT overwrites signed records (auditTrail clobberable) |
| 6 | D2-CRIT-2 | DischargeSummary PUT mutates finalized records; POST upserts blindly |
| 7 | D2-CRIT-3 | Prescription post-dispense lock + allergy gate bypassed on every UPDATE |
| 8 | D2-CRIT-4 | Blood-transfusion monitoring entries mutable after submit |
| 9 | D2-CRIT-5 | MAR PUT route bypasses append-only pre-save guard |
| 10 | D2-CRIT-6 | DoctorNotes has no `lateEntryReason` field/validator (NurseNotes has it) |
| 11 | D2-CRIT-7 | activityLogger silently drops every `:id`-only clinical write |
| 12 | D3-CRIT-1 | `checkDoctorAccess` compares User._id vs Doctor._id — always 403 for real doctors |
| 13 | D3-CRIT-2 | addConsultation / updateConsultation / removeConsultation broken for non-Admin doctors |
| 14 | D3-CRIT-3 | `/admissions/:id` GET has no doctor-scope check — any doctor reads any chart |
| 15 | D3-CRIT-4 | `attendingDoctorId` schema/data mismatch (ref User vs stored Doctor._id) |
| 16 | D3-CRIT-5 | No nurse ward-scope ENFORCEMENT exists anywhere |
| 17 | D3-CRIT-6 | `restrictToOwnDoctorPatients` exported but never imported (dead helper) |
| 18 | D4-CRIT-1 | DoctorPatientPanel `fmtCur` uses `Number()` — every Decimal128 → ₹NaN |
| 19 | D4-CRIT-2 | DoctorPatientPanel loadAll: 9 parallel axios, no AbortController, no debounce |
| 20 | D4-CRIT-3 | DoctorNotes sign-handler silent-catch → "signed ✓" toast when server rejected |
| 21 | D4-CRIT-4 | OPDAssessmentPage bulk doctor-orders POST silent-catch — meds never reach nurse |
| 22 | D4-CRIT-5 | DoctorNotes diagnosis modal drops `working` + ICD on every edit-open |
| 23 | D5-CRIT-1 | 5 nursing assessment pages: localStorage-first + silent POST catch + auto clearDraft |
| 24 | D5-CRIT-2 | MARPage Mark Given: no validation, no double-tap guard, no late warning |
| 25 | D5-CRIT-3 | NurseOrdersPanel: optimistic state update fires on axios FAILURE |
| 26 | D5-CRIT-4 | Vital "abnormal" flag is dead — `RANGES.bp_sys` key not defined |
| 27 | D5-CRIT-5 | Vital thresholds hardcoded adult-only — paeds/COPD trigger wrong alerts |
| 28 | D6-CRIT-1 | R7au pharmacy double-count guard NEVER MATCHES — drugs still double-billed |
| 29 | D6-CRIT-2 | DoctorOrder `/administer` never calls billing — meds via that path bypass invoice |
| 30 | D6-CRIT-3 | MAR recordAdministration is non-idempotent — 200ms double-tap = 2 doses |
| 31 | D6-CRIT-4 | Cancelled/Stopped orders silently revive on `/step` or `/administer` |
| 32 | D6-CRIT-5 | Indent release never decrements DrugBatch — FEFO bypassed on IPD path entirely |
| 33 | D6-CRIT-6 | MAR HELD/REFUSED leaves pharmacy reservation trigger forever — patient billed |
| 34 | D6-CRIT-7 | Order cancellation after billing has no refund / CN / trigger-void cascade |
| 35 | D7-CRIT-1 | Drug-allergy gate ONLY on Rx pre-save — pharmacy dispense + MAR unchecked |
| 36 | D7-CRIT-2 | Allergy gate silently bypassed when `knownAllergies` is an array |
| 37 | D7-CRIT-3 | Indent path does NOT decrement DrugBatch, allows expired batches |
| 38 | D7-CRIT-4 | Rx post-dispense lock bypassable via update API (same as D2-CRIT-3) |
| 39 | D7-CRIT-5 | No drug-drug interaction check anywhere |
| 40 | D8-CRIT-1 | Doctor-finalize writes Doctor as `billClearedBy` — fraudulent cashier signature |
| 41 | D8-CRIT-2 | Doctor-finalize skips discharge-day flush — revenue loss on every fast-path |
| 42 | D8-CRIT-3 | Doctor-finalize skips overage detection, CleaningTask, housekeeping |
| 43 | D8-CRIT-4 | Doctor-finalize uses `findByIdAndUpdate` — bypasses LEGAL_STATUS_TRANSITIONS |
| 44 | D8-CRIT-5 | No primary-consultant check on doctorApproveDischarge / finalize |
| 45 | D9-CRIT-1 | `/patient-file/:uhid/complete` — universal PHI dump (also D1-CRIT-1) |
| 46 | D9-CRIT-2 | Doctor-notes routes use `attemptAuth` only — anonymous reads possible |
| 47 | D9-CRIT-3 | Nurse-notes report routes unscoped |
| 48 | D9-CRIT-4 | Patient search returns entire hospital regardless of role |
| 49 | D9-CRIT-5 | Doctor-note impersonation via body-supplied `doctorId` |
| 50 | D9-CRIT-6 | `updateDiagnosis` rewrites signed notes without ownership check |
| 51 | D10-CRIT-1 | PRESCRIPTION_* audit enum invalid — silently dropped (same as S7) |
| 52 | D10-CRIT-2 | `/doctor-orders/:id/*` nurse mutations all skip the audit feed |
| 53 | D10-CRIT-3 | PATCH `/sign` `/finalize` `/refuse` audit-action downgraded to `"update"` |
| 54 | D10-CRIT-4 | Auto-middleware never captures `before` snapshot on UPDATE/DELETE |
| 55 | D10-CRIT-5 | PatientActivityLog has no schema-level append-only guard |

**Total CRIT: 55.** Across 10 dimensions. Many are clones / facets of the 10 systemic patterns above.

---

## HIGH findings (selected — see per-dim sections for full list)

- **D1-HIGH-1**: Doctor cannot add service to OPD (every keystroke 403s — ServiceAutocomplete needs `billing.read` which Doctor lacks)
- **D1-HIGH-2**: Nurse "biometric consent captured" toast fires but `consentStatus` PATCH 403s and is dropped from PATCH_ALLOWED
- **D1-HIGH-5**: `/api/live-updates/:uhid` SSE has no per-UHID auth
- **D2-HIGH-3**: NursingCarePlan has no signing, no status guard, no immutability
- **D2-HIGH-4**: No edit-history / `supersededBy` / addendum versioning ANYWHERE
- **D3-HIGH-1**: Doctor reads any patient's notes/orders/prescriptions by direct URL
- **D3-HIGH-2**: Any Doctor can write a note on any patient (role gate ≠ team gate)
- **D4-HIGH-3**: Doctor pages still use raw `alert()` and `window.prompt` (post R7ax-FIX-CONFIRM)
- **D5-HIGH-2**: DrugAutocomplete race — selecting Drug-A then typing for B submits A under B's name
- **D5-HIGH-3**: IndentRaisePage doesn't guard against discharged admissions
- **D6-HIGH-1**: MAR controller non-atomic (DB push + fire-and-forget billing call)
- **D6-HIGH-4**: Indent release race — two pharmacists can both release past requestedQty
- **D7-HIGH-1**: No max-daily-dose gate anywhere (paracetamol 6g/day passes)
- **D7-HIGH-2**: No pediatric/weight-based dose validation
- **D7-HIGH-3**: MAR nurse signature NOT mandatory
- **D7-HIGH-5**: Controlled substances — register is retrospective only, no two-witness gate at dispense
- **D8-HIGH-3**: `/discharge-queue` route has NO authentication
- **D8-HIGH-4**: dischargeSummaryRoutes opens PHI reads with no auth
- **D8-HIGH-5**: Bed release runs outside transaction — silent bed leak
- **D9-HIGH-3**: Nurse sees ALL medico-legal cases (privacy + competitive intel)
- **D9-HIGH-8**: No read-only lockout for Doctor / Nurse on financial paths (defense-in-depth gap)
- **D9-HIGH-10**: No "discharged patient" lockout on clinical writes — backdated notes possible
- **D10-HIGH-1**: No retention metadata on PatientActivityLog (BillingAudit got it in R7aw-FIX-5)
- **D10-HIGH-7**: Signature payloads truncated to 4KB in audit row → uselessness as evidence

**Approx HIGH: 35.**

---

## Severity tally

| Dim | CRIT | HIGH | MED |
|---|---|---|---|
| D1 RBAC | 4 | 9 | 6 |
| D2 Data integrity | 7 | 8 | 8 |
| D3 Patient scope | 6 | 7 | 7 |
| D4 Doctor frontend | 5 | 7 | 10 |
| D5 Nurse frontend | 5 | 7 | 10 |
| D6 Order lifecycle | 7 | 8 | 8 |
| D7 Drug safety | 5 | 6 | 6 |
| D8 Discharge | 5 | 8 | 8 |
| D9 Scope violations | 6 | 10 | 8 |
| D10 NABH audit trail | 5 | 7 | 6 |
| **TOTAL** | **55** | **77** | **77** |

(MED counts approximate — some overlap with the systemic patterns above.)

---

## What this audit reveals about cycle work to date

The R7as → R7ax cycles produced ~75 fixes, but the *fixes* were applied at the controller layer when the underlying bugs live at the **model + middleware** layer. R11's drug-allergy gate, R7f's doctor-scope, R7r's audit-trail coverage — all of them have working code but the write paths that matter most bypass them. The OOM in R7ax taught us the same lesson (`module.exports.emit` shadowing). The next cycle (R7az?) needs to be **model-first**: fix the hooks, then verify every controller uses `.save()` not `findByIdAndUpdate`, and add schema-level enum validation on every clinical model.

The Doctor + Nurse role surfaces are the most-touched in the system and the least defensible right now. Until S1–S10 are resolved, any new feature inherits the same holes.

---

*Authored R7ay by Dr Sandeep + Claude. Audit only — no fixes applied. Full per-dimension findings available in the agent transcripts.*
