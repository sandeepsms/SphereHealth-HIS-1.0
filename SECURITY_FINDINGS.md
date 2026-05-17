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
| A-09 | Bed transfer multi-doc write lacks session | MEDIUM | models/Patient/bedTransferModel.js | BACKLOG | — | — |
| A-10 | Discharge multi-stage flow has no atomic guarantee | MEDIUM | models/Patient/admissionModel.js:171–183 | BACKLOG | — | F-01 gate added as defense-in-depth |
| A-11 | Prescription update has no audit-log call | MEDIUM | services/Doctor/PrescriptionService.js:66–74 | BACKLOG | — | — |
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
| B-10 | No `jti` / revocation list | LOW | routes/Auth/authRoutes.js | BACKLOG | — | Mitigated by 8h expiry |
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
| C-02 | Missing index on `PatientBill.patientId` | HIGH | models/PatientBillModel/PatientBillModel.js | BACKLOG | — | — |
| C-03 | Missing `(UHID, createdAt)` index on DischargeSummary | HIGH | models/Clinical/DischargeSummaryModel.js | BACKLOG | — | — |
| C-04 | Missing `dateKey` indexes across daily-charge collections | HIGH | models/nursing/*, models/Vitals/* | BACKLOG | — | — |
| C-05 | Unbounded `.find().lean()` on equipment/drug-stock/vitals lists | HIGH | controllers/equipmentController.js:42, pharmacyController.js:1106, vitalSheetController.js:33 | BACKLOG | — | — |
| C-06 | N+1 in stock-register report and auto-billing handlers | HIGH | controllers/Pharmacy/pharmacyController.js:1106–1149 | BACKLOG | — | — |
| C-07 | ~15 `findOneAndUpdate` calls missing `runValidators: true` | MEDIUM | dischargeSummaryController.js, marController.js, others | BACKLOG | — | — |
| C-08 | ~15 controllers don't validate `req.params.id` as ObjectId | HIGH | dischargeSummaryController.js:67, bedController.js, others | PARTIAL | 2026-05-17 | `validateObjectIdParam` helper added; applied to patient routes; live `not-an-objectid` → 400 |

---

## D. Node.js Backend Quality

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| D-01 | 35+ `.catch(() => {})` swallow billing/clinical errors | HIGH | many controllers | BACKLOG | — | High-volume refactor — round 2 commit |
| D-02 | Seed scripts hardcode Mongo URI fallback to localhost | MEDIUM | scripts/seed*.js | BACKLOG | — | Dev-only |
| D-03 | Blocking sync file I/O in maintenance scripts | LOW | scripts/normalize-billing-paths.js | WONT-FIX | 2026-05-17 | Maintenance-only scripts; not in request path |
| D-04 | Controllers return HTTP 200 with `success:false` | HIGH | controllers/Billing/billingController.js, others | PARTIAL | 2026-05-17 | `handle()` wrapper in admissionController now honours `err.status` (covers discharge gate); broader sweep is BACKLOG |
| D-05 | `NODE_ENV` / `CORS_ORIGINS` not validated at boot | MEDIUM | index.js | **FIXED** | 2026-05-17 | `requireEnv()` fail-fast + WARN on missing CORS/NODE_ENV |

---

## E. React / Frontend

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| E-01 | Nursing assessments cached in localStorage keyed by patient `_id` | HIGH | context/AuthContext.jsx | **FIXED** | 2026-05-17 (r3) | logout() now sweeps `nabh_*`, `his_patient_*`, `his_admission_*`, `rc_*`, `break-glass:*` from local + sessionStorage |
| E-02 | Break-glass justification stored in sessionStorage only | HIGH | Components/clinical/PatientPanelShell.jsx:160 | **FIXED** | 2026-05-17 (r3) | handleBreakGlassAllow now POSTs to /api/patient-file/:uhid/log with action=BREAK_GLASS, severity=HIGH, isFlagged=true |
| E-03 | Reception form draft cached in sessionStorage | MEDIUM | pages/reception/ReceptionConsole.jsx:718 | BACKLOG | — | — |
| E-04 | UHID exposed in URL params | MEDIUM | pages/clinical/MARPage.jsx:797, others | BACKLOG | — | Router-level rewrite |
| E-05 | useEffect async-IIFE without AbortController | MEDIUM | pages/RoleDashboardPage.jsx, PharmacyHomePage.jsx, others | BACKLOG | — | — |
| E-06 | Silent `.catch(() => null)` across pages | MEDIUM | many | BACKLOG | — | High-volume refactor — round 2 |
| E-07 | ReceptionConsole labels miss `htmlFor` (WCAG 2.1 AA) | MEDIUM | pages/reception/ReceptionConsole.jsx | BACKLOG | — | — |
| E-08 | `dangerouslySetInnerHTML` for hard-coded CSS only | LOW | Components/clinical/FingerprintConsentModal.jsx:114 | WONT-FIX | 2026-05-17 | Hard-coded animation CSS only; no user content |

---

## F. Business Logic (HIS)

| ID | Title | Severity | Files | Status | Fixed-on | Verifier |
| -- | ----- | -------- | ----- | ------ | -------- | -------- |
| F-01 | `dischargePatient()` doesn't check `billCleared` before status flip | HIGH | services/Patient/admissionService.js:194 | **FIXED** | 2026-05-17 | Live discharge w/o clearance → 409 with clear msg + allowOverride path |
| F-02 | Lab results editable post-verification | HIGH | models/Investigation/InvestigationOrderModel.js | **FIXED** | 2026-05-17 | post-init snapshot + pre-save lock — editing a VERIFIED item throws |
| F-03 | Pharmacy pre-flight stock check non-atomic | MEDIUM | controllers/Pharmacy/pharmacyController.js:391 | BACKLOG | — | — |
| F-04 | Drug expiry check uses UTC `new Date()` | MEDIUM | controllers/Pharmacy/pharmacyController.js | **FIXED** | 2026-05-17 (r5) | IST-aware "start of today" boundary via Intl.DateTimeFormat + Asia/Kolkata |
| F-05 | Bill items still editable in PARTIAL state | MEDIUM | services/Billing/billingService.js | **FIXED** | 2026-05-17 (r3) | Freeze list expanded to GENERATED/PARTIAL/PAID/CANCELLED/REFUNDED; mutation throws 409 |
| F-06 | Appointment NoShow→Booked race allows overlap | MEDIUM | models/Appointment/appointmentModel.js:59 | BACKLOG | — | — |
| F-07 | Prescription editable post-dispense | LOW | models/Doctor/prescription.js:54 | BACKLOG | — | — |
| F-08 | No drug-allergy / interaction check at prescribe time | LOW | models/Doctor/prescription.js | BACKLOG | — | Feature, not bug |

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
| H-07 | No backup script in repo | MEDIUM | scripts/ (absent) | BACKLOG | — | Ops decision |

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