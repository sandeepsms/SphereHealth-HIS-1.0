# SphereHealth / BIMS HIS — Full-Scale Capability & Working Audit

> **Scope:** the entire patient journey end-to-end — front-office reception → OPD →
> Emergency → IPD admission & beds → clinical documentation → medication → lab (NABL) →
> pharmacy → billing → TPA/insurance claims → discharge & MRD → NABH/NABL compliance
> registers → ABDM/FHIR interoperability → security/RBAC/audit → reports → deployment/ops.
>
> **Method:** 16 independent auditor passes (one per subsystem), each reading the real
> models/services/controllers/routes and reporting maturity + strengths + gaps + risks
> with `file:line` evidence, then a cross-cutting synthesis. Top findings were re-verified
> by direct code reading and, for the highest-severity compliance bug, by a live
> integration probe. **Date:** 2026-07-13.

---

## 1. Executive summary

SphereHealth HIS is a genuinely broad, deeply-engineered hospital information system that
covers the **entire patient journey end-to-end**. Across every subsystem the engineering
signature is unusually mature:

- **Concurrency-correctness as a system-wide discipline** — atomic `findOneAndUpdate`
  counters and compare-and-set predicates replace legacy `countDocuments()+1` races
  everywhere (UHID, admission, visit, appointment, accession, GRN, bill numbering), backed
  by defense-in-depth uniqueness (application guard **plus** partial-unique Mongo index)
  that turns double-clicks into clean `409`s instead of duplicate records.
- **Deep, genuinely-wired Indian-regulatory + NABH/NABL coverage** — ~40 compliance
  registers auto-populate from real clinical events via a 3,473-line emitter (idempotent,
  non-blocking), plus Schedule H/H1/X + NDPS, GST CGST/SGST/IGST place-of-supply split,
  IRDAI/CGHS/ESIC claim forms, and licence-expiry gates that actually block regulated writes.
- **Strong medico-legal data-integrity patterns** — append-only/immutable records with
  amendment chains and mandatory reasons across doctor notes, nurse notes, lab results,
  discharge summaries, MAR and NDPS registers; hash-chained patient audit log; money
  uniformly on `Decimal128` with audited accounting semantics.
- **Mature security/RBAC** — stateless JWT with per-request DB revalidation + `jti`
  revocation + `tokenVersion` invalidation (≤60s propagation), a ~200-action matrix enforced
  by ~1000 server-side route gates, real separation-of-duties, and hardware-only WebAuthn e-consent.
- **Production-shaped deployment + test discipline** — per-hospital Docker isolation and a
  re-runnable **136/136 live-API E2E acceptance suite** that already caught 4 real backend defects.

The system is **not a demo** — the core revenue and clinical loop is production-shaped and
stress-tested. What separates it from a *finished* product is a handful of half-wired
capabilities, a few confirmed correctness bugs, and two subsystems (medication decision-support
reach, ABDM live interoperability) that are architecturally sound but not yet clinically/network complete.

---

## 2. Overall readiness verdict

**Production-ready for the core revenue and clinical operating loop** (registration →
OPD/ER/IPD → clinical documentation → lab/pharmacy → billing → discharge → NABH register
capture), and **defensibly sellable to hospitals today** on that footing — the financial and
patient-journey paths are covered by the 136/136 live-API E2E suite and the security posture is strong.

It is **NOT turnkey-safe out of the box at the 100+ hospital scale** until three go-live
blockers are closed:

1. **Automated backups are broken inside every Docker deployment** — the nightly cron shells
   out to `mongodump`, which is absent from the `node:alpine` image, and the excellent
   tool-free backup engine is wired only to a Windows task. A hospital can run for weeks
   believing it is backed up while the volume stays empty, with **no alert**. *Highest-priority blocker.*
2. **Several point-of-care safety controls are inert** — medication LASA/allergy warnings are
   computed but never surfaced to clinicians, HAM two-nurse charting fails from the primary
   nurse UI, and the WHO surgical checklist is non-gating.
3. **ABDM live interoperability and true audit tamper-proofing are documented-honest but
   not certification-ready.**

**Recommendation:** ship to hospitals with a **mandatory pre-go-live ops checklist**
(host-level backup, TLS reverse proxy, tenant-specific bed seed) and prioritise a
**safety/DR remediation sprint** before scaling past early adopters.

---

## 3. Stage-by-stage maturity matrix

| # | Stage | Maturity | One-line verdict |
|---|-------|----------|------------------|
| 1 | Registration & Front-Office | **Strong** | Full 5-type intake, atomic ID issuance, deep field-level RBAC, NABH visitor/gate registers; held back by no duplicate-patient detection, no phone validation, one-directional age/DOB, ABHA Admin-only/off. |
| 2 | OPD Workflow | **Strong** | Auto visit+bill, per-doctor tokens, SOAP+signature, exceptional cross-doctor RBAC; weak on medico-legal immutability (signed assessment overwritable) and an OPD Rx path that bypasses the allergy gate. |
| 3 | Emergency (ER) | **Strong** | Triage→disposition register, serial vitals, observation timer, non-admit billing closure; **register disposition enum-mismatch dropped Death/DAMA rows (FIXED this audit)**, admission-link field typo. |
| 4 | IPD Admission & Bed Management | **Strong** | Atomic CAS bed allocation, one-active-admission enforcement, multi-stage discharge clearance with money-safety; marred by a dropped doctor-scope filter, ₹0 bed estimate, cross-collection co-sign lookup bug. |
| 5 | Clinical Documentation | **Strong** | Most mature area — immutability/amendment patterns, split initial assessments, ICU bundles, 7-gate discharge finalize; nursing care plan lacks sign-on-complete & audited delete, shift-handover routes built but unmounted. |
| 6 | Medication Management & Safety | **Partial** | Real HAM flagging, five-rights gates, append-only MAR, NCC-MERP error register; but LASA/allergy decision-support never reaches clinicians, MAR path skips error auto-capture, confirmed HAM witness contract bug. |
| 7 | Investigations & Lab (NABL ISO 15189) | **Strong** | Production-grade three-state-machine lifecycle, accessioning, QC-release gate, append-only amendments, micro timeline + antibiogram; reference-range master ships empty (flagging dormant), QC gate only blocks explicit FAIL. |
| 8 | Pharmacy | **Strong** | FEFO atomic dispensing, Decimal128 money, GST split, Schedule H/H1/X + NDPS, LLM invoice extractor; notification delivery stubbed, dispense GST rate client-supplied, Schedule-X write non-atomic after sale commits. |
| 9 | TPA & Insurance Claims | **Strong** | Rigorous claim state machine, maker-checker, canonical claim-data builder feeding IRDAI/CGHS/ESIC + PDF overlay + MIS; entirely manual — no NHCX/insurer-API cashless, no coverage/sum-insured balance engine. |
| 10 | Discharge & MRD | **Strong** | Sophisticated layered finalize gates + atomic CAS + two-layer immutability + auto register emits; broken mortality-register field ref, missing JR co-sign endpoint, legal-hold flag has no setter (inert). |
| 11 | Compliance & Quality (NABH/NABL) | **Strong** | ~40 registers auto-filled from live clinical events, PSQ lifecycle with CAPA-gated RCA close, QPS/HAI rate engines; register docs themselves not hash-chained, WHO checklist non-gating, retention scan-only. |
| 12 | ABDM & FHIR Interoperability | **Partial** | Clean disabled-by-default HIP framework, rich FHIR R4 export, 10/10 mock dry-run; NOT live-ready — HKDF/JWS not certified, GCM IV reused across entries, no idempotency, consent date-range unenforced. |
| 13 | Security, RBAC & Audit | **Strong** | Per-request JWT revalidation + jti revocation + tokenVersion, ~1000 route gates, hash-chained audit, licence gates, global write-walls; audit is SHA-not-HMAC (rebuildable), several gates fail-open, JWT rotation a TODO. |
| 14 | Reports & Analytics | **Strong** | ~22 IST-anchored endpoints, careful accounting semantics, NABH/NABL CQI indicators, financial cuts E2E-covered; no server-side export/GSTR-1 emission, clinical CQI outside the E2E net, device-day denominator capped at 50k. |
| 15 | Deployment, Ops & Test Harness | **Partial** | Excellent per-hospital Docker isolation, IST distributed-lock cron, 136/136 live E2E; but in-container backups broken, cron-failure retry never replayed, no CI, tenant bed-seed hardcoded to BIMS. |

**Maturity legend:** *Complete* = production-grade + covered by tests · *Strong* = production-shaped,
minor gaps · *Partial* = works but material capability or safety gaps · *Basic* = present but shallow.

Net across 15 stages: **11 Strong, 3 Partial, 0 weak**. The three Partials
(Medication, ABDM, Deployment/Ops) are exactly where the go-live blockers concentrate.

---

## 4. Top strengths (system-wide)

1. **Concurrency-correctness discipline** — atomic counters + CAS predicates + defense-in-depth
   uniqueness across all numbering and state transitions; double-clicks become `409`s, not duplicates.
2. **Deep, genuinely-wired regulatory coverage** — ~40 auto-populated NABH/NABL registers,
   Schedule H/H1/X + NDPS, GST place-of-supply split, IRDAI/CGHS/ESIC forms, licence gates
   that actually block — accreditation engineered in, not bolted on.
3. **Medico-legal data-integrity patterns** — append-only/immutable records with amendment
   chains + mandatory reasons everywhere; hash-chained patient audit; `Decimal128` money.
4. **Mature security/RBAC** — per-request JWT revalidation + revocation + tokenVersion,
   ~1000 route gates, real separation-of-duties, hardware-only WebAuthn e-consent.
5. **Production-shaped deploy + test discipline** — per-hospital Docker isolation, IST
   distributed-lock cron, re-runnable 136/136 live-API E2E that has caught real defects.
6. **Honest, self-documenting engineering** — subsystems that are not certification-ready
   (ABDM crypto/JWS, audit HMAC) flag it in-code and in TODO docs rather than overclaiming.

---

## 5. Top gaps (system-wide)

1. **Automated backup broken inside every Docker deployment** (mongodump absent; good engine
   Windows-only). Highest-priority go-live blocker.
2. **Medication decision-support never reaches the point of care** — LASA/DNU + drug-allergy
   computed but no UI renders them; MAR path never auto-captures errors; no DDI/max-dose/renal checks.
3. **Built-but-unreachable / inert features** — shift-handover routes unmounted (404),
   discharge co-sign endpoint missing, legal-hold flag has no setter, lab reference-range master empty.
4. **No live electronic interoperability / cashless** — ABDM pre-certification; TPA module
   entirely manual (no NHCX/insurer API, no coverage/sum-insured balance engine).
5. **Operational/DR & CI maturity gaps at scale** — no CI, no external monitoring/alerting,
   cron-failure retry never replayed, TLS manual (plain HTTP by default), tenant bed-seed hardcoded to BIMS.
6. **Audit tamper-evidence weaker than marketed** — only the patient activity log is
   hash-chained; the NABH register docs a surveyor inspects are editable via `.save()`, and the
   chain is plain SHA-256 (rebuildable by anyone with Mongo write access), not HMAC/anchored.

---

## 6. Top risks (ranked)

1. **DATA-INTEGRITY / DR (critical)** — the only automated container backup fails nightly
   (`mongodump` not in image) with no alerting; weeks of "backed up" that isn't. Severe
   medico-legal-retention + DR exposure for a production HIS.
2. **PATIENT-SAFETY / CORRECTNESS (high)** — confirmed HAM two-nurse bug: `/administer`
   resolves the witness via `User.findById(verifiedBy)` but the Treatment Chart UI sends a
   free-text nurse **name** → CastError/400, so charting a high-alert medication as GIVEN from
   the primary nurse UI fails; combined with brand-name HAM false-negatives and unsurfaced
   allergy/LASA warnings, IPSG.3 safety guarantees are non-uniform at the bedside.
3. **SECURITY (high)** — SHA-256 audit chain is tamper-*evident* but not tamper-*proof* (a
   privileged DB actor can recompute a consistent chain), most NABH registers aren't chained,
   multiple auth/licence/revocation gates fail-open on DB errors with only console logging and
   no pager, JWT-secret rotation unimplemented, default stack serves plain HTTP.
4. **COMPLIANCE (high)** — several NABH controls modeled but not enforced end-to-end: WHO
   checklist non-gating, sentinel closure ignores RCA/CAPA state, JR co-sign has no endpoint,
   discharge-summary death does not populate the COP.18 Mortality Register (field-name bug),
   legal-hold cannot be set (IMS.3), IPSG.2 critical-value read-back absent.
5. **CORRECTNESS / DATA-INTEGRITY (medium)** — OPD assessment saves can wipe omitted fields to
   empty strings; saveOPDAssessment/billing hooks swallow errors (visit with no bill); IPD
   active-list drops doctor scope (PHI over-exposure); reports device-day denominators capped
   at 50k (overstating NABH-reported infection rate); pharmacy Schedule-X write non-atomic after sale commits.
6. **SECURITY / INTEROP (medium)** — ABDM data path reuses the same AES-256-GCM key **and IV**
   across every entry in a multi-entry push (breaks GCM guarantees), enforces no consent
   date-range or HI-request scoping, no idempotency guard → passes its own mock dry-run but
   fails real NHA certification and risks DPDP/ABDM consent-scope violations if enabled live.
   *(Mitigated today: ABDM is disabled by default — zero impact on stock deployments.)*

---

## 7. Confirmed defects found during this audit

Ranked by severity. Each was verified by direct code reading; the ER register bug was also
verified by a live integration probe (8/8) **and fixed in this pass**.

> **Remediation status (updated 2026-07-13):** **ALL 19 confirmed defects are now FIXED,
> verified, and committed** across three passes — the HIGH ER bug D1 (`5c1129f5`), the entire
> MEDIUM tier D6–D16/D19 (`62a15f8c`), and the LOW/CRITICAL/HIGH remainder D17/D18 + D2 + D3/D4/D5
> (`37d68ba9`). Evidence: E2E **136/136** re-run on the new code at each pass, the D2 tool-free
> backup engine ran in-process (154,807 docs, **no mongodump**), the D5 fix proven by a
> distinct-IV round-trip probe **and the ABDM M1–M4 dry-run 10/10**, plus per-fix probes and a
> green FE build. **Nothing open** from this audit.

| # | Defect | Severity | Area | Status |
|---|--------|----------|------|--------|
| D1 | **ER register disposition enum mismatch** — visit `Expired`/`Left Against Medical Advice` written raw onto the register (enum only allows `Death`/`DAMA`) → save throws enum ValidationError, swallowed by the emitter catch → NABH Emergency Register never updated/locked for the two most legally-sensitive exits. | **HIGH** (compliance/data-loss) | ER / NABH AAC.4 | **✅ FIXED + verified 8/8** |
| D2 | **In-container automated backup broken** — nightly cron shells out to `mongodump` absent from the Alpine image (nightly ENOENT); tool-free engine wired only to a Windows task. Fresh hospital has no working backup, no alert. | **CRITICAL** (DR) | Deployment/Ops | ✅ **FIXED** (37d68ba9) |
| D3 | **HAM two-nurse witness contract mismatch** — `/administer` does `User.findById(verifiedBy)` (ObjectId) but Treatment Chart UI sends a free-text nurse **name** → CastError/400; charting a HAM med as GIVEN from the primary UI fails. | **HIGH** (patient-safety) | Medication / IPSG.3 | ✅ **FIXED** (37d68ba9) |
| D4 | **Mortality register not populated from discharge death** — finalize passes `patientId: summary.patientId` but the model field is `patient`, so `emitMortality` bails (needs `patient._id`); deaths discharged via summary never hit the COP.18 register. | **HIGH** (compliance) | Discharge / COP.18 | ✅ **FIXED** (37d68ba9) |
| D5 | **ABDM GCM key+IV reuse across entries** — one HIP ephemeral key/IV reused for every entry in a multi-entry push, breaking AES-GCM confidentiality/authentication. | **HIGH** (crypto) | ABDM | ✅ **FIXED** (37d68ba9) |
| D6 | **IPD `/admissions/active` drops doctor scope** — controller sets `$or` for Doctor callers but the service never merges it, so any Doctor with `ipd.read` enumerates **all** active inpatients (PHI over-exposure). | **MEDIUM** (privacy) | IPD | ✅ **FIXED** (62a15f8c) |
| D7 | **`mustCosign` never fires** — `createAdmission` does `User.findById(attendingDoctorId)` but that id is a `Doctor._id` → lookup misses → JR co-sign gate effectively always false. | **MEDIUM** (compliance SoD) | IPD / COP.7 | ✅ **FIXED** (62a15f8c) |
| D8 | **OPD signed assessment not backend-immutable + field-wipe** — `saveOPDAssessment` is a plain `findOneAndUpdate` (a second POST silently overwrites a signed assessment), and its `pick(val,'')` helper defaults omitted fields to empty string (a partial save wipes stored exam/HOPI/OBG/diagnosis). Safe only because the FE currently posts full form state. | **MEDIUM** (medico-legal + data-integrity) | OPD | ✅ **FIXED** (62a15f8c) |
| D9 | **OPD embedded-Rx bypasses drug-allergy gate** — `POST /opd/:visit/prescription` `$push`es onto `prescribedMedications` with no allergy check (unlike the standalone Prescription model), and pharmacy today-rx reads that array. | **MEDIUM** (clinical-safety) | OPD / Pharmacy | ✅ **FIXED** (62a15f8c) |
| D10 | **Pharmacy dispense GST rate is client-supplied** (`it.gstRate ?? 12`) instead of the batch's immutable stamped rate → a wrong-but-valid slab under/over-collects GST on the tax invoice + GSTR-1. | **MEDIUM** (tax) | Pharmacy | ✅ **FIXED** (62a15f8c) |
| D11 | **LASA/DNU + allergy warnings never surfaced** — computed & persisted on `order.safetyWarnings` and exposed via `/medication-safety/screen`, but no FE renders them → MOM.4/MOM.5 decision-support dormant at the bedside. | **MEDIUM** (compliance/safety) | Medication | ✅ **FIXED** (62a15f8c) |
| D12 | **Shift-handover routes unmounted** — model+controller+service+routes fully built but not mounted in `routes/index.js` → NABH MOM.2 transfer-of-care form returns 404. | **MEDIUM** (feature dead-wired) | Clinical Docs | ✅ **FIXED** (62a15f8c) |
| D13 | **Discharge co-sign endpoint missing** — `POST /discharge-summary/:id/cosign` is referenced by model+controller but never implemented; `cosignedBy/At` are dead fields, JR self-finalize SoD never reconciled. | **MEDIUM** (compliance) | Discharge | ✅ **FIXED** (62a15f8c) |
| D14 | **Legal-hold has no setter** — the `legalHold` flag is declared and read by the retention scan but cannot be set anywhere → IMS.3 legal-hold cannot be applied to any record. | **MEDIUM** (compliance) | MRD / IMS.3 | ✅ **FIXED** (62a15f8c) |
| D15 | **Reports device-day denominator capped at 50k** (`.limit(50000).lean()`) → truncates active devices on busy/long windows, understating device-days and **overstating** the NABH-reported HAI rate per 1000 device-days, with no warning when the cap hits. | **MEDIUM** (metric integrity) | Reports / HIC.5 | ✅ **FIXED** (62a15f8c) |
| D16 | **Cron-failure retry never replayed** — scheduler records failures into `CronFailure` but nothing calls `dueRetries()`/`markRetrySuccess()` (only a `// TODO`); a missed daily accrual/GST tick stays missed until next fire. | **MEDIUM** (operational) | Ops | ✅ **FIXED** (62a15f8c) |
| D17 | **ER register admission-link dropped** — `updateDisposition` passes `admissionLinkId: visit.admissionId`, but the ER visit field is `admission` (schema line 238) → `admissionId` is `undefined`, so `admissionLinkId` is never set for Admitted exits. | **LOW** (data-linkage) | ER | ✅ **FIXED** (37d68ba9) |
| D18 | **Feedback CQI uses UTC, not IST** — feedback stats/list/cqi parse `new Date(from)` / `${to}T23:59:59.999Z` as UTC (unlike IST everywhere else) and skip validation → windows drift 5h30m, midnight-IST submissions misclassified. | **LOW** (timezone) | Reports | ✅ **FIXED** (37d68ba9) |
| D19 | **NABH register documents not hash-chained** — only the PatientActivityLog is chained; sentinel/mortality/RCA/CSSD rows are editable via `.save()` with only a self-reported `auditTrail`, so a compliance.nabh.write holder can silently alter a surveyor-inspected register. | **MEDIUM** (audit tamper-evidence) | Compliance | ✅ **FIXED** (62a15f8c) |

### D1 — fix applied this audit

`services/Compliance/nabhRegisterEmitter.js` · `emitEmergencyDisposition` now normalises the
ER **visit** disposition to the **register** enum before saving, and no-ops on a non-terminal
value instead of throwing:

```js
const ER_DISPOSITION_MAP = { "Left Against Medical Advice": "DAMA", Expired: "Death",
                             "Brought Dead": "DOA", "Dead on Arrival": "DOA" };
const ER_REGISTER_DISPOSITIONS = new Set(["Admitted","Discharged","DAMA","Referred","Death","DOA","Absconded","Observation"]);
// …
const mappedDisposition = ER_DISPOSITION_MAP[disposition] || disposition;
if (!ER_REGISTER_DISPOSITIONS.has(mappedDisposition)) return null; // e.g. "Pending" — don't lock
row.disposition = mappedDisposition;
```

Verified by `Backend/scripts/_probe_er_disposition_fix.js` — 8/8: `Expired→Death` (locked),
`Left Against Medical Advice→DAMA` (locked), all pass-through dispositions unchanged, `Pending`
correctly no-ops (register stays `""`, unlocked).

---

## 8. Recommended remediation sequence

**Sprint 0 — go-live blockers — ✅ DONE (`37d68ba9`):**
1. **D2** — the tool-free EJSON backup engine now runs as the nightly in-process job (no
   `mongodump`; verified 154,807 docs in-container), and a failed run is loud (CronFailure +
   CRON_FAILED heartbeat). compose/provisioner/DEPLOY document the off-site knobs.
2. **D3** — `/administer` (and the HAM infusion-rate handler) accept the free-text witness name
   (ObjectId lookup guarded); the validator requires a witness only at `status==="given"`.
3. **D4** — the finalize emits now read `summary.patient`, so a death discharge populates the
   COP.18 Mortality Register and the notifiable/LAMA/ClinicalAudit emits regain the Patient FK.
   *(Plus D5 [HIGH] ABDM GCM IV-reuse and D17/D18 [LOW] — the full remainder — also fixed in `37d68ba9`.)*

**Sprint 1 — compliance & safety hardening — ✅ DONE (`62a15f8c`):**
4. **D11** surface LASA/DNU/allergy warnings in the order/MAR UI · **D12** mount shift-handover
   routes · **D13** implement the co-sign endpoint · **D14** add a legal-hold setter ·
   **D6** merge the doctor `$or` scope at the service layer · **D7** fix the co-sign lookup.

**Sprint 2 — integrity & metrics — ✅ DONE (`62a15f8c`):**
5. **D10** read GST rate from the stamped batch rate · **D15** stream the device-day denominator
   (no cap) · **D8/D9** signed-lock + no field-wipe + OPD Rx allergy gate ·
   **D19** HMAC integrity plugin on the 7 surveyor-critical registers · **D16** cron retry sweeper.

*(All Sprint 1 + 2 items — the full MEDIUM tier — are fixed, E2E 136/136 on the new code.
Sprint 0's D2/D3/D4, plus D5/D17/D18, remain the owner's call.)*

**Ops checklist (per-hospital, pre-go-live):** host-level backup verified, TLS reverse proxy in
front of plain-HTTP backend, tenant-specific bed/ward seed, and a first-run E2E acceptance run
(`Backend/scripts/_e2e_*.js`, 136/136).

---

## 9. Evidence & reproducibility

- **Per-dimension findings** (16 auditors + synthesis) captured with `file:line` evidence.
- **136/136 live-API E2E acceptance suite** — `Backend/scripts/_e2e_{opd,er,services,ipd,tasks,accounts}.js`
  (reset via `_e2e_reset.js --apply`).
- **ABDM M1–M4 conformance dry-run** — `Backend/scripts/_abdm_milestone_dryrun.js` (10/10, local mock gateway; **not** NHA certification).
- **D1 regression probe** — `Backend/scripts/_probe_er_disposition_fix.js` (8/8).
- Companion docs: `HIS-CERTIFICATION.md`, `NABH-NABL-COMPLIANCE-REVIEW.md`, `ABDM-INTEGRATION.md`, `E2E-TEST-REPORT.md`.
