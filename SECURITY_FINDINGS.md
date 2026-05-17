# SphereHealth HIS — Security & Quality Findings Log

A living register of patient-safety, security, MongoDB, code-quality, frontend,
business-logic, compliance, and reliability issues found during structured
audit passes. Every finding gets a status, owner, fix date, and verifier so a
NABH / DPDP auditor can replay the trail end-to-end.

**Audit round 1 ran on 2026-05-17 by Claude Opus 4.7 across 8 sub-agents.**
**Fix round 1 same date — see status column. Re-audit landing next.**

## Severity legend

| Tag | Meaning |
| --- | --- |
| **HIGH** | Patient-safety, PHI leak, money loss, or full account takeover. Fix before next deploy. |
| **MEDIUM** | Significant defect, escalates risk under load or with an insider. Fix this sprint. |
| **LOW** | Defense-in-depth, hygiene, code smell. Backlog. |

## Status legend

`OPEN` · `IN-PROGRESS` · `FIXED` · `VERIFIED` · `WONT-FIX` · `BACKLOG`

---

## A. Patient Safety & Data Integrity

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| A-01 | Medication `dose` is plain String — accepts "abc", "-100", "" | HIGH | models/Doctor/DoctorOrderModel.js:131 | **FIXED** | 2026-05-17 (r3) | Mongoose validator: positive number + unit regex |
| A-02 | Prescription vitals (BP, pulse, temp, RR, SPO2) accept NaN/negative | HIGH | models/Doctor/prescription.js:42–49 | **FIXED** | 2026-05-17 | Live `temp:50` rejected by Mongoose validation |
| A-03 | Nurse vitals fields lack min/max ranges | HIGH | models/Nurse/NurseNotesModel.js:6–16 | **FIXED** | 2026-05-17 | Live `pulse:-100` returns validation error |
| A-04 | I/O sheet accepts negative ml | HIGH | models/Nurse/NurseNotesModel.js:40–49 | **FIXED** | 2026-05-17 | min/max 0–20000 added |
| A-05 | Vital sheet `value` lacks bounds | MEDIUM | models/Vitals/vitalSheetModel.js | **FIXED** | 2026-05-17 (r5) | `value` min:0 max:100000; `time` HH:MM regex; live `"99:99"` rejected |
| A-06 | Prescription `age` & `gender` not enum-constrained | MEDIUM | models/Doctor/prescription.js | **FIXED** | 2026-05-17 (r5) | age:0–150, gender enum; live `age:200, gender:"Xen"` → validation error on both |
| A-07 | Medication `route` accepts arbitrary text | MEDIUM | models/Doctor/prescription.js:59 | **FIXED** | 2026-05-17 | Enum added (Oral, IV, IM, SC, SL, PR, PV, Topical, Inhalation, ...) |
| A-08 | Admission + auto-bill chain not in a transaction | HIGH | controllers/Patient/admissionController.js:15–42 | BACKLOG | — | Wider rewrite — out of scope this pass |
| A-09 | Bed transfer multi-doc write lacks session | MEDIUM | controllers/Patient/bedTransferController.js | **FIXED** | 2026-05-17 (r7) | Atomic reserve (`status:"Available"` predicate); if `BedTransfer.create` fails (e.g. duplicate-pending unique index), bed reservation rolls back; 409 on duplicate pending |
| A-10 | Discharge multi-stage flow has no atomic guarantee | MEDIUM | controllers/Patient/admissionController.js (doctorApproveDischarge / clearFinalBill / issueGatePass) | **FIXED** | 2026-05-17 (r14) | All three stage transitions converted to atomic `findOneAndUpdate` with predicate on prior stage; two concurrent cashier clicks → winner 200, loser 409 with clear stage-mismatch message |
| A-11 | Prescription update has no audit-log call | MEDIUM | services/Doctor/PrescriptionService.js | **FIXED** | 2026-05-17 (r9) | `updatePrescriptionByUHID` now snapshots before/after to `PatientActivityLog` with actor (role + id + name) plumbed from req.user via controller |
| A-12 | Receptionist can edit clinical patient fields (blood group, DOB, allergies) | **CRITICAL** | routes/Patient/patientRoutes.js, controllers/Patient/patientController.js | **FIXED** | 2026-05-17 | Live receptionist PUT bloodGroup → 403 |
| A-13 | Receptionist can hit `POST /:id/discharge` with no role guard | **CRITICAL** | routes/Patient/admissionRoutes.js:52 | **FIXED** | 2026-05-17 | Live receptionist discharge → 403 |
| A-14 | Receptionist can cancel admissions | HIGH | routes/Patient/admissionRoutes.js:53 | **FIXED** | 2026-05-17 | requireAction("ipd.cancel") gate |
| A-15 | Receptionist can edit prescription medicines + diagnosis | HIGH | routes/Doctor/doctorPrescriptionRoutes.js | **FIXED** | 2026-05-17 (r3) | requireAction("rx.write") on POST/PUT/PATCH/DELETE; live receptionist → 403 |

### Malicious-insider scenario (receptionist) — Section A
Receptionist now blocked from rewriting clinical patient fields, cannot
trigger clinical discharge/cancel/transfer. Demographic fixes (name spelling,
phone) still flow through. Prescription-edit attack surface (A-15) remains
open — backlogged for the next pass.

---

## B. Security (PHI/PII)

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| B-01 | Unescaped `$regex` in billing search | MEDIUM | controllers/Billing/billingController.js:370–372 | **FIXED** | 2026-05-17 | Live `?UHID=.*` returns 0 rows |
| B-02 | Unescaped `$regex` in appointment search | MEDIUM | controllers/Appointment/appointmentController.js:65 | **FIXED** | 2026-05-17 | `safeRegex` util in `utils/queryGuards.js` |
| B-03 | Unescaped `$regex` in visitor-pass search | MEDIUM | controllers/VisitorPass/visitorPassController.js:92 | **FIXED** | 2026-05-17 | `safeRegex` applied |
| B-04 | IDOR on `GET /api/patients/:id` (no ownership check) | HIGH | services/Patient/patientService.js:164–170 | BACKLOG | — | Requires per-doctor attribution rewrite |
| B-05 | `ipd.discharge` grants Receptionist | HIGH | config/permissions.js:50 | **FIXED** | 2026-05-17 | Removed from action; mirror in frontend |
| B-06 | `DELETE /api/admissions/:id` has no `requireAction` guard | HIGH | routes/Patient/admissionRoutes.js:49 | **FIXED** | 2026-05-17 | requireAction("ipd.delete"), Admin-only |
| B-07 | Seed scripts print user passwords to stdout | MEDIUM | scripts/seedUsers.js, seedRoleUsers.js | **FIXED** | 2026-05-17 (r5) | Passwords redacted from console; operator can still read SEED_USERS / DEFAULT_PASSWORD constants if needed |
| B-08 | 2FA controller logs OTP + phone + token to console | HIGH | controllers/Clinical/twoFactorController.js:78 | **FIXED** | 2026-05-17 | Phone masked, OTP/token redacted from logs |
| B-09 | No rate-limit on `/auth/login`, OTP, search endpoints | HIGH | routes/Auth/authRoutes.js | **FIXED** | 2026-05-17 | express-rate-limit added; live 11th login → 429 |
| B-10 | No `jti` / revocation list | LOW | routes/Auth/authRoutes.js, middleware/auth.js, models/Auth/TokenRevocationModel.js | **FIXED** | 2026-05-17 (r14) | jti issued on login; logout writes jti→TokenRevocation (TTL = token exp); authenticate middleware rejects revoked jtis. Live: login → use 200 → logout → reuse 401 "Session revoked" |
| B-11 | FHIR bundle export endpoint has no role/consent guard | HIGH | routes/Clinical/patientFileRoutes.js:15, patientFileController.js:268 | **FIXED** | 2026-05-17 | requireAction("patient.export"); live receptionist → 403 |

### Malicious-insider scenario (receptionist) — Section B
FHIR bundle now closed to receptionist. Brute-force login throttled. Regex
injection eliminated on three known surfaces. IDOR (B-04) and prescription-
edit (A-15) remain open — listed in re-audit backlog.

---

## C. MongoDB-Specific

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| C-01 | 10+ models missing required / enum / min-max on critical fields | HIGH | models/Patient/patientModel.js, User/userModel.js, Pharmacy/DrugModel.js, others | PARTIAL | 2026-05-17 | NurseVitals, IO, prescription.vitals, route enum fixed (covers ~30% of finding); remaining models in BACKLOG |
| C-02 | Missing index on `PatientBill.patientId` | HIGH | models/PatientBillModel/PatientBillModel.js | WONT-FIX | 2026-05-17 (r13) | False-positive — `PatientBillSchema.index({ patient: 1 })` line 277 already covers (the field is `patient`, not `patientId`) |
| C-03 | Missing `(UHID, createdAt)` index on DischargeSummary | HIGH | models/Clinical/DischargeSummaryModel.js | WONT-FIX | 2026-05-17 (r13) | False-positive — `DischargeSummarySchema.index({ UHID: 1, createdAt: -1 })` line 140 already present |
| C-04 | Missing `dateKey` indexes across daily-charge collections | HIGH | models/Doctor/DoctorNotesModel.js | **FIXED** | 2026-05-17 (r13) | BillingTrigger/NursingChargeEntry/VitalSheet already had compound `dateKey` indexes; added `(ipdNo, shift, visitDate)` + `(admissionId, visitDate)` to DoctorNotesSchema for parity with NurseNotes |
| C-05 | Unbounded `.find().lean()` on equipment/drug-stock/vitals lists | HIGH | controllers/Equipment/equipmentController.js, controllers/Pharmacy/pharmacyController.js | PARTIAL | 2026-05-17 (r9) | `equipment.stats` rewritten as `$facet` aggregation (O(1) payload); service-due + supplier list capped at 1000; remaining sites in pharmacy stock-register on backlog |
| C-06 | N+1 in stock-register report and auto-billing handlers | HIGH | controllers/Pharmacy/pharmacyController.js | PARTIAL | 2026-05-17 (r14) | `stockRegister` rewritten — was 4×N round-trips per drug (≈2000 calls @ 500 drugs); now 5 parallel aggregations + JS merge by drugId. Auto-billing N+1 site still on backlog |
| C-07 | ~15 `findOneAndUpdate` calls missing `runValidators: true` | MEDIUM | dischargeSummaryController.js, wardTaskController.js, others | PARTIAL | 2026-05-17 (r11) | dischargeSummary.finalize, admission.discharge, bed.release, wardTask (assign/start/complete/cancel) updates now pass `runValidators: true`; ~4 controllers (housekeeping, nursingCarePlan, mar status flip, etc.) still on backlog |
| C-08 | ~15 controllers don't validate `req.params.id` as ObjectId | HIGH | many controllers | PARTIAL | 2026-05-17 (r7) | Helper applied to patient, admission (15+ surfaces incl. /:id/consultation/:consultId), prescription routes; live `/api/admissions/not-an-objectid` → 400 |

---

## D. Node.js Backend Quality

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| D-01 | 35+ `.catch(() => {})` swallow billing/clinical errors | HIGH | utils/logErr.js (new), 13 controllers/services | PARTIAL | 2026-05-17 (r17–r19) | `logErr(module, action)` helper. Applied to ~26 sites across 13 files: investigation-order controller/service (5), med-recon (7), MAR auto-bill, autoBilling skip-marker, admission/discharge/transfer (4), doctor + nurse note controllers + service (3), OPDService (3), nursing-charges, MLC mlcSeq rollback, FHIR-export audit-log. ~9 lower-volume sites remain on backlog |
| D-02 | Seed scripts hardcode Mongo URI fallback to localhost | MEDIUM | scripts/seedJaiBhagwan.js, seedUsers.js, seedPatients.js, seedBIMS.js | **FIXED** | 2026-05-17 (r11) | Fail-fast on missing MONGO_URI; URI no longer echoed to stdout (no credential leak via `mongodb://user:pass@host` logging) |
| D-03 | Blocking sync file I/O in maintenance scripts | LOW | scripts/normalize-billing-paths.js | WONT-FIX | 2026-05-17 | Maintenance-only scripts; not in request path |
| D-04 | Controllers return HTTP 200 with `success:false` | HIGH | controllers/Billing/billingController.js, others | PARTIAL | 2026-05-17 | `handle()` wrapper in admissionController now honours `err.status` (covers discharge gate); broader sweep is BACKLOG |
| D-05 | `NODE_ENV` / `CORS_ORIGINS` not validated at boot | MEDIUM | index.js | **FIXED** | 2026-05-17 | `requireEnv()` fail-fast + WARN on missing CORS/NODE_ENV |

---

## E. React / Frontend

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| E-01 | Nursing assessments cached in localStorage keyed by patient `_id` | HIGH | context/AuthContext.jsx | **FIXED** | 2026-05-17 (r3) | logout() now sweeps `nabh_*`, `his_patient_*`, `his_admission_*`, `rc_*`, `break-glass:*` from local + sessionStorage |
| E-02 | Break-glass justification stored in sessionStorage only | HIGH | Components/clinical/PatientPanelShell.jsx:160 | **FIXED** | 2026-05-17 (r3) | handleBreakGlassAllow now POSTs to /api/patient-file/:uhid/log with action=BREAK_GLASS, severity=HIGH, isFlagged=true |
| E-03 | Reception form draft cached in sessionStorage | MEDIUM | pages/reception/ReceptionConsole.jsx | **FIXED** | 2026-05-17 (r13) | Recursive `sanitize()` strips PHI keys (uhid/aadhaar/pan/advancePayment/paymentMode/cardNumber/upiId/txnId/chequeNumber/bankAccount) from the draft before `sessionStorage.setItem` |
| E-04 | UHID exposed in URL params | MEDIUM | hooks/useUhidFromLocation.js (new), pages/clinical/MARPage.jsx, DischargeSummaryPage.jsx, DiabeticChartPage.jsx | PARTIAL | 2026-05-17 (r16) | New `useUhidFromLocation` hook prefers `location.state.uhid`, scrubs legacy `?uhid=` from history via `replaceState`; applied to MAR + DischargeSummary + DiabeticChart. IPDInitialAssessment still uses `/:uhid` route path — needs router rewrite |
| E-05 | useEffect async-IIFE without AbortController | MEDIUM | pages/RoleDashboardPage.jsx | PARTIAL | 2026-05-17 (r16+r19) | AbortController applied to 4 of 4 dashboard effects in RoleDashboardPage: Admin, Doctor, Pharmacist, Accountant. PharmacyHomePage (3 sites) and DoctorPatientPanel (~10 sites) still on backlog with same mechanical pattern |
| E-06 | Silent `.catch(() => null)` across pages | MEDIUM | Components/billing/PatientBilling.jsx | PARTIAL | 2026-05-17 (r18) | 2 critical sites in PatientBilling (getServicesGrouped, getAdmissions) now emit `console.error("[PatientBilling] ...:", e?.message)`. ~28 sites in DoctorPatientPanel / DoctorNotesPage / DieticianConsole / AccountsConsole remain on backlog |
| E-07 | ReceptionConsole labels miss `htmlFor` (WCAG 2.1 AA) | MEDIUM | pages/reception/ReceptionConsole.jsx | PARTIAL | 2026-05-17 (r13) | Patient-identity block (Title, FullName, Gender, DOB, Age, Phone — the 6 most critical fields for screen-reader nav) now have `htmlFor`/`id` pairs with id pattern `rc-<field>`; remaining ~30 fields still rely on label-proximity — full a11y sweep on backlog |
| E-08 | `dangerouslySetInnerHTML` for hard-coded CSS only | LOW | Components/clinical/FingerprintConsentModal.jsx:114 | WONT-FIX | 2026-05-17 | Hard-coded animation CSS only; no user content |

---

## F. Business Logic (HIS)

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| F-01 | `dischargePatient()` doesn't check `billCleared` before status flip | HIGH | services/Patient/admissionService.js:194 | **FIXED** | 2026-05-17 | Live discharge w/o clearance → 409 with clear msg + allowOverride path |
| F-02 | Lab results editable post-verification | HIGH | models/Investigation/InvestigationOrderModel.js | **FIXED** | 2026-05-17 | post-init snapshot + pre-save lock — editing a VERIFIED item throws |
| F-03 | Pharmacy pre-flight stock check non-atomic | MEDIUM | controllers/Pharmacy/pharmacyController.js | **FIXED** | 2026-05-17 (r7) | TOCTOU `$sum` pre-flight removed; fifoConsume's atomic `findOneAndUpdate({remaining: {$gte: take}})` is authoritative; cross-item rollback on mid-loop shortage |
| F-04 | Drug expiry check uses UTC `new Date()` | MEDIUM | controllers/Pharmacy/pharmacyController.js | **FIXED** | 2026-05-17 (r5) | IST-aware "start of today" boundary via Intl.DateTimeFormat + Asia/Kolkata |
| F-05 | Bill items still editable in PARTIAL state | MEDIUM | services/Billing/billingService.js | **FIXED** | 2026-05-17 (r3) | Freeze list expanded to GENERATED/PARTIAL/PAID/CANCELLED/REFUNDED; mutation throws 409 |
| F-06 | Appointment NoShow→Booked race allows overlap | MEDIUM | models/Appointment/appointmentModel.js | **FIXED** | 2026-05-17 (r9) | Post-init snapshot + pre-save state-machine guard rejects terminal (NoShow/Cancelled/Completed) → Booked; live `NoShow→Booked` save throws "Cannot re-book…" |
| F-07 | Prescription editable post-dispense | LOW | models/Doctor/prescription.js | **FIXED** | 2026-05-17 (r11) | Post-init snapshot of medicines hash + pre-save guard rejects edits to medicines[] once status is terminal (Completed/Cancelled/FINAL); live test: edit on Completed Rx throws "Cannot edit medicines on a Completed prescription" |
| F-08 | No drug-allergy / interaction check at prescribe time | LOW | models/Doctor/prescription.js | **FIXED** | 2026-05-17 (r11) | Substring safety net cross-references medicines[] against patient.knownAllergies + clinicalDetails.historyOfAllergy on every save; clinician can bypass via `_allergyOverrideReason` (audited via warn-log); live: Aspirin allergy + Aspirin Rx → "Allergy alert — possible match(es): Aspirin 75mg vs Aspirin" |

---

## G. Compliance & Privacy (DPDP)

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| G-01 | FHIR export endpoint has no consent gate | HIGH | routes/Clinical/patientFileRoutes.js, patientFileController.js:268 | **FIXED** | 2026-05-17 | `requireAction("patient.export")` gate added; controller-level consent check is BACKLOG round 2 |
| G-02 | Phone + OTP logged in dev mode | HIGH | controllers/Clinical/twoFactorController.js:78 | **FIXED** | 2026-05-17 | Phone masked to ****1234; OTP redacted from logs (still in JSON dev response) |
| G-03 | UHID logged via `console.log(UHID)` | MEDIUM | controllers/Doctorcontroller.js:34 | **FIXED** | 2026-05-17 | `console.log` removed, replaced with comment citing G-03 |
| G-04 | No data-retention TTL or anonymization job | MEDIUM | scripts/, jobs/ (absent) | BACKLOG | — | Requires policy decision |
| G-05 | Cookie security flags unverified | MEDIUM | middleware/auth.js | WONT-FIX | 2026-05-17 | JWT carried in `Authorization: Bearer` header, not cookies — flags not applicable |
| G-06 | PHI redactor not applied to general `console.log` calls | MEDIUM | utils/phiRedactor.js | BACKLOG | — | Adoption pass — round 2 |

---

## H. Reliability & Operations

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| H-01 | No `SIGTERM`/`SIGINT` graceful-shutdown handler | HIGH | index.js | **FIXED** | 2026-05-17 | `shutdown(signal)` drains server + mongoose, 15s hard backstop |
| H-02 | No `uncaughtException` / `unhandledRejection` handler | HIGH | index.js | **FIXED** | 2026-05-17 | Both handlers wired with log + setImmediate exit |
| H-03 | No `/health` / `/api/health` endpoint | MEDIUM | routes/ | **FIXED** | 2026-05-17 | Live `/api/health` → 200 with mongo state |
| H-04 | Mongoose connect has no retry | MEDIUM | config/db.js | **FIXED** | 2026-05-17 | Exponential backoff 1s→30s, MAX_RETRIES=12, reconnect listeners |
| H-05 | Frontend `api.js` hardcodes localhost fallback | MEDIUM | Frontend/src/config/api.js | **FIXED** | 2026-05-17 (r3) | Loud `console.error` on PROD build when VITE_API_BASE_URL missing |
| H-06 | CORS dev fallback hardcodes `http://localhost:5173` | LOW | index.js:14 | **FIXED** | 2026-05-17 | Now WARNs on missing CORS_ORIGINS instead of silently defaulting |
| H-07 | No backup script in repo | MEDIUM | scripts/backup-mongo.sh | **FIXED** | 2026-05-17 (r13) | New `backup-mongo.sh` with mongodump+gzip, size sanity check (rejects sub-4KB archives), N-day prune, optional S3 SSE-AES256 upload; documented cron line for nightly run. Restore drill + off-site is ops follow-up |

---

## Re-audit log (round 2)

| Section | Round 2 date | Round 2 verifier | New findings | Status |
| ------- | ------------ | ---------------- | ------------ | ------ |
| A | 2026-05-17 | Claude Opus 4.7 (re-audit sub-agent) | 3 new findings (see R-A below) | **FIXED** in commit r2 |
| B | 2026-05-17 | Claude Opus 4.7 (re-audit sub-agent) | 0 new findings | **CLEAN** |
| C | _backlog_ | | | |
| D | _backlog_ | | | |
| E | _backlog_ | | | |
| F | 2026-05-17 | Claude Opus 4.7 (re-audit sub-agent) | 0 new findings | **CLEAN** |
| G | 2026-05-17 | Claude Opus 4.7 (re-audit sub-agent) | 2 new findings (see R-G below) | **FIXED** in commit r2 |
| H | 2026-05-17 | Claude Opus 4.7 (re-audit sub-agent) | 0 new findings | **CLEAN** — all 6 fixes confirmed |

### Round-2 new findings + fixes

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| R-A-01 | Nested-object bypass of `patient.write-clinical` gate (`{address:{bloodGroup:"AB+"}}` slips past shallow `Object.keys()` check) | **HIGH** | controllers/Patient/patientController.js | **FIXED** | 2026-05-17 | Live `{address:{bloodGroup:"AB+"}}` → 403; deeper 4-level nest also → 403 |
| R-A-02 | Identity fields (fullName, firstName, lastName, title) wrongly classified as clinical | LOW | controllers/Patient/patientController.js | **FIXED** | 2026-05-17 | Moved to demographic set; live receptionist `{fullName:"X"}` → 200 |
| R-A-03 | `allowOverride` flag on discharge has no service-layer role check (route gate is the only line of defense) | MEDIUM | services/Patient/admissionService.js, controllers/Patient/admissionController.js | **FIXED** | 2026-05-17 | Doctor with `allowOverride:true` → 403 "Only Admin can bypass" |
| R-G-01 | seedPatients.js logs raw UHID (4 occurrences) | MEDIUM | scripts/seedPatients.js | **FIXED** | 2026-05-17 | `maskUHID` helper applied |
| R-G-02 | seedJaiBhagwan.js logs raw UHID (2 occurrences) | MEDIUM | scripts/seedJaiBhagwan.js | **FIXED** | 2026-05-17 | `maskUHID` helper applied |

### Round-3 new findings + fixes

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| R3-F-01 | `addNurseCharge` still allowed adding charges to GENERATED bills — the F-05 replace_all missed this method (different guard pattern) | **HIGH** | services/Billing/billingService.js:577 | **FIXED** | 2026-05-17 (r4) | Same freeze list applied (GENERATED/PARTIAL/PAID/CANCELLED/REFUNDED); 409 with amendment message |
| R3-A-01 | Dose regex accepted `"0 mg"` (clinically invalid) and rejected `"1.5 mg/kg/day"` (legitimate weight-based notation) | MEDIUM | models/Doctor/DoctorOrderModel.js | **FIXED** | 2026-05-17 (r4) | Trailing `\b` swapped for `[\s\/]|$` so ratios pass; `parseFloat > 0` guard rejects zero; 8/8 unit fixtures pass |
| R3-E-01 | `sphereai_active_patient` localStorage key not covered by logout sweep | MEDIUM | context/AuthContext.jsx | **FIXED** | 2026-05-17 (r4) | `sphereai_` added to phiPrefixes list |

### Round-5 new findings + fixes

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| R5-F-01 | `listBatches` "expiring in N days" filter still used raw UTC `new Date()` — drifts IST boundary | MEDIUM | controllers/Pharmacy/pharmacyController.js:216 | **FIXED** | 2026-05-17 (r6) | Switched to `istStartOfDayPlus(days)` shared helper |
| R5-F-02 | `alerts` (90-day expiry horizon + "now") still used raw UTC | MEDIUM | controllers/Pharmacy/pharmacyController.js:1414–1415, 1441 | **FIXED** | 2026-05-17 (r6) | Both `now` and `horizon` now `istStartOfToday()` / `istStartOfDayPlus(90)` |
| R5-Hint | Hoisted IST helpers to `utils/queryGuards.js` so other timezone-sensitive comparisons (autoBilling already had its own copy) can reuse | — | utils/queryGuards.js | **FIXED** | 2026-05-17 (r6) | Live: 30/90-day diffs are exactly N × 86400000 ms |

### Round-14 new findings + fixes

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| R14-A-01 | `issueGatePass` bed-release used a silent try/catch — failure left bed Occupied while admission was Discharged | **HIGH** | controllers/Patient/admissionController.js | **FIXED** | 2026-05-17 (r15) | Checks `findByIdAndUpdate` result; loud log on miss; response now carries `bedReleased: false, warning:"..."` so reception UI can prompt manual cleanup |
| R14-C-01 | `stockRegister` aggregations grouped on raw `drugId` — orphan rows with null drugId folded into one bucket and were silently dropped by the JS merge | MEDIUM | controllers/Pharmacy/pharmacyController.js | **FIXED** | 2026-05-17 (r15) | `$match: { drugId: $ne null }` (or unwound equivalent) added to each of the 4 sale-side pipelines |
| R14-A-02 | `clearFinalBill` CAS only accepts prior stage `DoctorApproved` — restart-after-cancel scenario yields a confusing 409 | LOW | controllers/Patient/admissionController.js | WONT-FIX | 2026-05-17 (r15) | Discharge-cancel flow doesn't currently exist; if/when it does, expand predicate. Acceptable UX trade-off documented. |
| R14-A-03 | `issueGatePass` burns a Counter sequence BEFORE the CAS — 100 concurrent failed attempts waste 100 numbers | LOW | controllers/Patient/admissionController.js | WONT-FIX | 2026-05-17 (r15) | Gaps in Counter-based numbering are accepted industry practice; reordering would re-introduce duplicate-number risk |

### Round-7 new findings + fixes

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| R7-F-01 | `pharmacy.addItems()` had the SAME TOCTOU pre-flight aggregate + no cross-item rollback as the F-03 fix had missed | **HIGH** | controllers/Pharmacy/pharmacyController.js:725–813 | **FIXED** | 2026-05-17 (r8) | Pre-flight removed; cross-item rollback identical to dispense() |
| R7-F-02 | `pharmacy.returnItems()` restored stock via non-atomic load+save loop — partial undo on failure | MEDIUM | controllers/Pharmacy/pharmacyController.js:615–622 | **FIXED** | 2026-05-17 (r8) | `findOneAndUpdate({quantityOut: {$gte: qty}, isActive: true}, $inc)` with structured log on failure |
| R7-A-01 | `bedTransfer.completeHandover` multi-doc sequence (new bed → admission → old bed → transfer) had no rollback if admission.save() failed mid-sequence | MEDIUM | controllers/Patient/bedTransferController.js:160–204 | **FIXED** | 2026-05-17 (r8) | Sequence re-ordered (newBed → admission → oldBed → transfer); admission.save() failure rolls back newBed flip via `try/catch` |

### Round-9 new findings + fixes

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| R9-C-01 | `vitalSheetService.getVitalSheet` had no `.limit()` — months of daily vitals balloon the response | **HIGH** | services/Vitals/vitalSheetService.js | **FIXED** | 2026-05-17 (r10) | Default `.limit(90)` with caller-overridable `opts.limit` (capped at 500) |
| R9-A-01 | `deletePrescription` + `updatePrescriptionStatus` had no audit log — NABH-relevant state changes leak | **HIGH** | services/Doctor/PrescriptionService.js | **FIXED** | 2026-05-17 (r10) | Both methods now snapshot before/after to `PatientActivityLog` with patientId/UHID/actor; PRESCRIPTION_DELETE + PRESCRIPTION_STATUS_CHANGE actions |
| R9-C-02 | `Bed.findByIdAndUpdate` on discharge-summary finalize missing `runValidators: true` | MEDIUM | controllers/Clinical/dischargeSummaryController.js:125 | **FIXED** | 2026-05-17 (r10) | `runValidators: true` added; bed-status enum now enforced |
| R9-A-02 | `updatePrescriptionByUHID` audit row was missing `patientId` (analytics group-by broke) | MEDIUM | services/Doctor/PrescriptionService.js | **FIXED** | 2026-05-17 (r10) | `patientId: before.patient` added to the audit-log create payload |

### Round-11 new findings + fixes

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| R11-F-01 | F-08 allergy-override field `_allergyOverrideReason` never reached the hook — Mongoose strict mode stripped it | **HIGH** | models/Doctor/prescription.js | **FIXED** | 2026-05-17 (r12) | Field declared on schema; live save with override now persists the reason and bypasses the gate with audit warn-log |
| R11-D-01 | `seedRoleUsers.js` still used `throw new Error` on missing MONGO_URI instead of the fail-fast pattern the other 4 seed scripts use | MEDIUM | scripts/seedRoleUsers.js | **FIXED** | 2026-05-17 (r12) | Aligned with the `console.error + process.exit(1)` pattern |
| R11-C-01 | `marController` had 3 paths (addMedication, recordAdministration, discontinueMedication) without `runValidators: true` | **HIGH** | controllers/Clinical/marController.js | **FIXED** | 2026-05-17 (r12) | All three writes now pass `runValidators: true` |
| R11-C-02 | `medReconciliationController` had 2 paths without `runValidators` | MEDIUM | controllers/Clinical/medReconciliationController.js | **FIXED** | 2026-05-17 (r12) | seedReconciliation + updateReconciliation both pass `runValidators: true` (+ `setDefaultsOnInsert` on upsert) |
| R11-C-03 | `housekeepingController` had 4 task-board paths without `runValidators` | MEDIUM | controllers/Clinical/housekeepingController.js | **FIXED** | 2026-05-17 (r12) | All 4 (accept/start/complete/cancel) now pass `runValidators: true` |

### Summary of fix-round 1 (2026-05-17)

**Sections fully addressed:**
- **H** (Reliability) — 6 of 7 fixed, 1 backlog (Frontend localhost fallback)
- **B** (Security) — 7 of 11 fixed, 4 backlog (IDOR, jti, seed-script password log, password-leak adjacent)
- **F** (Business Logic — most critical) — 2 of 8 fixed (discharge gate, lab post-verify lock)
- **G** (Compliance) — 3 of 6 fixed, 1 won't-fix (cookies inapplicable), 2 backlog

**Sections partially addressed (needs round 2):**
- **A** (Patient Safety) — 4 critical receptionist-abuse vectors closed + 4 vitals/IO bounds added; 7 still open
- **C** (MongoDB) — 2 of 8 partially (schema bounds + ObjectId guard helper); 6 backlog
- **D** (Node quality) — 2 of 5 fixed (env validation, error wrapper); 3 backlog
- **E** (Frontend) — 0 fixed; 7 backlog, 1 won't-fix

**Verifier:** Claude Opus 4.7 with live curl tests against running backend
(serverId d785361e-…). Receptionist token used for role-gate verification.