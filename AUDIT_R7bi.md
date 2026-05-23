# R7bi — Ward Boy + Housekeeping + Security + Dietician + Physiotherapist · 10-dim deep audit (338 findings)

**Cycle**: R7bi (after R7bh closed ~196 of 229 R7bg findings)
**Scope**: 5 support-role workflows — **Ward Boy + Housekeeping + Security + Dietician + Physiotherapist** — plus the **Kitchen indent → Diet plan** cross-role flow.
**Method**: 10 parallel deep-audit agents, orthogonal dimensions, each instructed to verify META claims from R7bh.
**Result**: **338 findings** (79 CRIT + 152 HIGH + 107 MED)

---

## Agent ownership

| Agent | Dim | CRIT | HIGH | MED | Total |
|---|---|---:|---:|---:|---:|
| R7bi-1 | MongoDB / data integrity | 17 | 21 | 10 | 48 |
| R7bi-2 | Auth + permissions | 4 | 13 | 11 | 28 |
| R7bi-3 | API contract consistency | 6 | 16 | 13 | 35 |
| R7bi-4 | React frontend | 1 | 26 | 17 | 44 |
| R7bi-5 | Node middleware + error handling | 1 | 19 | 17 | 37 |
| R7bi-6 | Billing ledger correctness | 13 | 8 | 3 | 24 |
| R7bi-7 | Print + receipt completeness | 16 | 16 | 5 | 37 |
| R7bi-8 | NABH + regulatory | 11 | 11 | 7 | 29 |
| R7bi-9 | Performance + scale | 1 | 11 | 13 | 25 |
| R7bi-10 | Security + workflow race | 9 | 11 | 11 | 31 |
| **Total** | | **79** | **152** | **107** | **338** |

---

## ⚡ Headline showstoppers

### 🚨 PHYSIOTHERAPIST MODULE IS WHOLLY ABSENT (10/10 agents flagged)

Every single dimension surfaced this. The `Physiotherapist` role exists in:
- `Backend/models/User/userModel.js` role enum ✓
- `Backend/config/permissions.js:407,428` (`physio.note.write` token reserved) ✓
- `Backend/seedRoleUsers.js` (test user provisioned) ✓
- `Frontend/src/Components/Sidebar.jsx:9-11,30,52` (sidebar colour/icon) ✓
- `Frontend/src/pages/RoleDashboardPage.jsx:671-688` ("coming soon" banner) ✓

But **zero backend models, services, controllers, routes, or workspace pages exist**. Grep confirms:
- `Backend/models/**/Physio*` → 0 hits
- `Backend/controllers/**/physio*` → 0 hits
- `Backend/routes/**/physio*` → 0 hits
- `Backend/services/**/physio*` → 0 hits
- `Frontend/src/pages/physiotherapist/*` → 0 hits

**Impact**: NABH COP.20 (rehabilitation services) non-compliant. Doctor's order panel CREATES physio orders (`DoctorOrdersPanel.jsx:48,442-453`) but **no one can action them**. Revenue leak: every physio session goes unbilled. Pre-paid physio packages can't be refunded on early discharge.

### 💀 Kitchen indent has NO close-loop endpoint

`KitchenIndentModel` ships with `status: PENDING|PREPARED|SERVED|CANCELLED` lifecycle in its header docstring, but **no controller exists** to flip PENDING→PREPARED→SERVED. Grep `markServed|markPrepared|kitchenIndent.complete` returns 0 matches outside the model. Dietitian writes plan → indents queue up → kitchen has no UI/API → meals are conceptually un-served forever. KitchenIndent collection is write-only from dietitian. [R7bi-1-CRIT-13, R7bi-3-HIGH-2]

### 💀 BillingAudit never called from autoBillingService

`autoBillingService.js` (2725+ lines) — **zero `BillingAudit.emit` calls** (grep confirmed). Every bed-day, nursing-day, doctor-visit, MAR-admin auto-charge emits a `BillingTrigger` but no companion BillingAudit row. NABH AAC.7 "single chronological audit log" requirement only partially met — auto-billing is the largest blind spot. [R7bi-6-TBA-CRIT-1]

### 💀 GST is missing on every auto-billed line

`addItemToBill` (autoBillingService.js:319-351) does NOT propagate `isTaxable` or `taxPercent` from ServiceMaster onto BillItem. Every bed/nursing/MAR/doctor-visit auto-line lands with `taxPercent: 0`. Only manual `addServiceToBill` (billingService.js:347-356) honours the slab. Net effect: **entire IPD daily-charge stream prints with no GST**, undercollecting state tax. [R7bi-6-TBA-CRIT-3]

### 💀 File-upload pipeline does NOT exist

`Backend/package.json` has no `multer`/`formidable`. `IncidentReport.attachments`, mortuary handover, visitor-pass photo, spillage photo, diet card photo, treatment photo — all schemas use `[String]` URL arrays trusted from `req.body`. Attackers ship `javascript:`, `data:`, or external tracker URLs. **Severity CRIT once any frontend wires file picker**. Visitor pass print currently shows a placeholder photo box that never renders. [R7bi-10-X-CRIT-1, R7bi-7-HIGH-8, R7bi-2-MED-5]

### 💀 BillingTrigger `orderedByRole` enum locks out support-staff roles

`BillingTrigger.orderedByRole` enum (line 55) does NOT include `Physiotherapist`, `Dietitian`, `Housekeeping`, `Security`, `Ward Boy`, `Kitchen`. If physio/diet/housekeeping triggers were retrofitted today, a Physiotherapist-attributed emit would fail validation. [R7bi-6-TBA-MED-1]

---

## META re-verification (R7bh shipped vs filesystem)

R7bi-8 + R7bi-1 cross-checked filesystem:

| Asset | Path | Status |
|---|---|---|
| ColdChainLogModel.js | `Backend/models/Pharmacy/` | ✅ PRESENT (append-only + WHO PQS bands) |
| coldChainLogger.js | `Backend/services/Pharmacy/` | ✅ PRESENT |
| CriticalValueAlertModel.js | `Backend/models/Clinical/` | ✅ PRESENT (AAC.6) |
| ADRReportModel.js | `Backend/models/Pharmacy/` | ✅ PRESENT (MOM.7/PvPI) |
| GrievanceModel.js | `Backend/models/Quality/` | ✅ PRESENT (PRE.6) |
| FireDrillModel.js + cron | `Backend/models/Compliance/` | ✅ PRESENT |
| CredentialModel.js | `Backend/models/HR/` | ✅ PRESENT BUT enum lacks `RD_LICENCE`, `IAP_REG`, `PSARA_GUARD`, `FSSAI_FOOD_HANDLER` |
| HospitalModel.js | `Backend/models/` | ✅ PRESENT (R7bh-F3 stub) |
| pollingHelpers.js (useVisiblePoll) | `Frontend/src/utils/` | ✅ PRESENT BUT zero adopters in these 5 role pages |
| authFetch.js localStorage drop | `Frontend/src/utils/` | ✅ PRESENT BUT 9 role pages still have stale inline fallback |

**No false-positive shipped this cycle.** R7bh's code landed. But two coverage gaps remain: `useVisiblePoll` never propagated beyond Pharmacy/Admin/Lab, and the localStorage cleanup runs only in `AuthContext` (page-tree top) — 9 role pages still advertise the fallback in their inline `axios` configs.

---

## CRIT roster — top 79 (compressed)

### R7bi-1 Mongo (17 CRIT)

| ID | Surface | Defect |
|---|---|---|
| 1-CRIT-1 | WardTaskModel | No append-only / transition history → ward-boy productivity dispute unresolvable |
| 1-CRIT-2 | wardOpsController.shiftStart/end | load-modify-save race → duplicate breaks / clobbered handover notes |
| 1-CRIT-3 | CodeBlueEvent.responders.push | race → lost-update on simultaneous responders |
| 1-CRIT-4 | housekeepingModels CleaningTask.type | enum drift from R20 invariant — missing `"isolation-prep"` |
| 1-CRIT-5 | ChemicalInventory.currentStock | no `$gte` predicate on consume → negative stock |
| 1-CRIT-6 | housekeeping.taskComplete | non-tx bed-flip; bed stays `CleaningPending` forever if flip fails |
| 1-CRIT-7 | GateLog / IncidentReport | NO retention TTL — NABH IMS.3 requires 5-10y |
| 1-CRIT-8 | IncidentReport.updateStatus | append-only audit absent — criminal-investigation row can be silently rewritten |
| 1-CRIT-9 | GateLog.recordedBy free-text | Security clerk can forge identity attribution |
| 1-CRIT-10 | dietitianService.pushToKitchenIndent | race — two clicks → duplicate trays, NABH COP.18 |
| 1-CRIT-11 | PatientDietPlan.updatePlan | raw spread of req.body silently overwrites assessor identity |
| 1-CRIT-12 | PatientDietPlan plan revision | no revision history — meal plan changes mid-admission don't re-push tomorrow's indents |
| 1-CRIT-13 | KitchenIndentModel | NO controller for PENDING→PREPARED→SERVED lifecycle |
| 1-CRIT-14 | (Physio) | NO model exists for sessions/charges/plans |
| 1-CRIT-15 | (Physio) | NO assessment / treatment-plan / progress-note model — NABH COP.16 unmet |
| 1-CRIT-16 | dietitianService.pushToKitchenIndent | no `admission.status === Active` check — discharged patient sends trays to empty bed |
| 1-CRIT-17 | housekeeping.taskComplete + admissionService | non-transactional bed flip + no nightly reconciliation cron for orphan `CleaningPending` |

### R7bi-2 Auth+Perms (4 CRIT)

- **WB-CRIT-1** Mortuary handover — only one user as actor; NABH AAC requires 2-signature witness attestation for body release
- **WB-CRIT-2** `POST /ward-ops/mortuary/declare` gated on `ward.mortuary` (includes Ward Boy) → WB can declare death without doctor co-sign, no admission-link check
- **PT-CRIT-1** Phantom role — Physiotherapist user can log in but has zero actionable endpoints/routes (already covered above)
- (X-MED-1 multi-tenant hospitalId gap deferred to MED tier)

### R7bi-3 API contracts (6 CRIT)

- 3-CRIT-1 `wardOps.managerStats` returns top-level scattered keys instead of nesting under `data`
- 3-CRIT-1 Housekeeping `managerStats` same envelope leak
- 3-CRIT-1 Security `visitor-passes/active-count` returns `{success, count}` with NO `data` field
- 3-CRIT-1 Dietitian `pushKitchenIndent` spreads `{created, updated, indents}` at top level
- 3-CRIT-1 Physio module absent (no API to audit)
- 3-CRIT-1 **F8's `apiEnvelope.js` is unused by EVERY controller in R7bi scope** — 0/7 adopters; the audit-driven helper shipped, the migration didn't

### R7bi-4 React (1 CRIT)

- 4-CRIT-1 `localStorage.getItem("his_token")` legacy fallback in 9 role pages despite R7y/R7bh-F9 — runtime cleanup in AuthContext masks it but cross-tab session-bleed vector remains; defense-in-depth + policy violation

### R7bi-5 Node middleware (1 CRIT)

- 5-CRIT-1 `dietitianService.pushToKitchenIndent` non-atomic fan-out — 5-meal push that fails on meal #3 leaves 2 indented and 3 missing → kitchen feeds wrong-patient half-meals

### R7bi-6 Billing ledger (13 CRIT)

- PHY-CRIT-1/2/3 — no billing path for any physio session; double-charge / no discharge cascade
- DK-CRIT-1/2/3/4 — dietitian consult fee never reaches bill; every meal served free; no double-source dietitian-vs-kitchen contract; re-push double-charges if retrofitted
- HK-CRIT-1 — housekeeping charges (linen, biomedical waste, laundry) seeded in ServiceMaster but `isAutoCharged: false` and never fire
- SEC-CRIT-1/2 — gate-log replay attack; every visitor pass free (no `feeAmount`)
- TBA-CRIT-1 BillingAudit never called from autoBillingService (covered above)
- TBA-CRIT-2 BillingTrigger.originalUnitPrice/originalQuantity still plain Number (DB-CRIT-01 sub-instance)
- TBA-CRIT-3 GST gap on all auto-billed lines (covered above)

### R7bi-7 Print (16 CRIT)

- **No printable** exists for:
  - Ward Boy: task ticket, equipment-transport slip, sample-collection slip
  - Housekeeping: cleaning-task slip, spillage report, pest-control register
  - Security: gate-log slip, incident-report (legal/insurance/police-FIR-precursor)
- Dietitian print uses raw `window.open` + `document.write` bypassing PrintShell entirely — no hospital header/GSTIN/footer/watermark
- No DUPLICATE watermark, no PrintAudit on diet plan / kitchen indent
- `PrintAuditModel` enum missing `WardTask`, `CleaningTask`, `SpillageIncident`, `PestControl`, `AreaCleaningLog`, `GateLog`, `IncidentReport`, `PatientDietPlan` → every print attempt from these 5 roles will return 400
- No physio prints (module absent)

### R7bi-8 NABH+Regulatory (11 CRIT)

- **WB-CRIT-1 BMW Rules 2016** — only bag-weights captured; no barcode/manifest/Form-IV/CBWTF handover → monthly state PCB return cannot be filed
- **WB-CRIT-2 COP.2** — no PatientTransport model → inter-ward / OT shifts untracked
- **HK-CRIT-1 HIC.6** — no needle-stick / sharps-injury schema (PEP status, source serology consent, follow-up)
- **HK-CRIT-2 FSSAI Schedule IV** — pest-control register lacks FSSAI vendor licence # / CIB pesticide registration # / kitchen-area distinction → FSSAI annual inspection failure
- **SEC-CRIT-1** — no unified code-response register (FireDrill covers drills not events; no CodeRed/Pink/Grey/Yellow)
- **SEC-CRIT-2 PSARA Act 2005** — no `PSARA_GUARD` credential type
- **DT-CRIT-1** — IDA Registered Dietitian (RD#) credential not enforceable
- **DT-CRIT-2 MOM.1** — no drug-nutrient interaction service
- **PT-CRIT-1** — entire physio module absent
- **PT-CRIT-2** — no IAP credential check
- **KI-CRIT-1** — adverse-food-reaction loop absent (ADR is drug-only)
- **KI-CRIT-2** — no DELIVERED_TO_PATIENT state on KitchenIndent → no chain-of-custody on meal handover

### R7bi-9 Performance (1 CRIT)

- 9-CRIT-1 **R7bg-9-HIGH-4 still open for this wing** — `useVisiblePoll` zero adopters; 7 raw setInterval polls at 30s/60s burn ~840 req/hr on backgrounded kiosks across these 5 role pages

### R7bi-10 Security+Race (9 CRIT)

- WB-CRIT-1 — Mass assignment on `POST /ward-tasks` (can forge same-day "completed" stats)
- WB-CRIT-2 — IDOR on `GET /ward-tasks?assignedTo=<anyUserId>` — Ward Boy A sees Ward Boy B's tasks with PHI
- HK-CRIT-1 — Mass assignment on `POST /housekeeping/*`
- HK-CRIT-2 — Spillage `contain`/`clean` no state guard → infection-control audit-trail tamper
- SEC-CRIT-1 — Gate-log + Incident `create` mass-assignment + attribution forgery
- SEC-CRIT-2 — GateLog/Incident schemas have NO append-only enforcement
- SEC-CRIT-3 — Visitor-pass replay attack (no Active/validUntil check on link)
- DT-CRIT-1 — `createPlan`/`updatePlan` mass-assignment can attach allergy/condition profile to another patient's UHID
- X-CRIT-1 — No file-upload pipeline (covered above)

---

## HIGH highlights (152 total — selected representatives)

- **R7bi-1-HIGH-13** Dietitian assessment lab values (`bloodSugarFasting`, `hba1c`, `creatinine`, `potassium`) stored as plain Number with NO min/max bounds → typo "180" instead of "108" silently triggers diabetic diet
- **R7bi-2-HIGH-1** Admin holds BOTH `indent.raise` AND `indent.fulfill` → no SoD for ward-task / housekeeping / kitchen-indent
- **R7bi-2-HIGH-3** ADR `reopen` allows original reporter to silently rewrite regulator-facing record (already covered)
- **R7bi-3-HIGH-1** 3 distinct list response shapes across in-scope controllers; UHID filter param has 4 naming conventions in 5 files
- **R7bi-4-HIGH-1** WardBoyConsole + HousekeepingConsole + GateLogPage + DieticianConsole all carry legacy `localStorage.getItem("his_token")` fallback
- **R7bi-4-HIGH-3** Bidirectional URL↔tab sync stale-closure bug in 3 of 4 consoles (WardBoy, Housekeeping, Dietitian)
- **R7bi-5-HIGH-1** `dietitianService` admission fetch wrapped in silent `catch (_) { }` → empty bed/ward/IPD# in indent if admission load fails
- **R7bi-5-HIGH-2** `Cache-Control: no-store, private` missing on `/api/visitor-passes`, `/api/gate-log`, `/api/dietitian/patient/:uhid/plans` (PHI replay on browser-back after logout)
- **R7bi-5-HIGH-3** No `withSession` ANYWHERE in scope (grep zero) — every multi-doc write is non-atomic
- **R7bi-6-PHY-HIGH-1** Even if entered via manual charge, addItemToBill never sets `isTaxable`/`taxPercent` → GST=0
- **R7bi-7-HIGH-3** Diet plan print missing signature block (Dietician + Doctor signature mandated for therapeutic diets)
- **R7bi-8-HIGH-1** Sample transport cold-chain missing (cross-cut to coldChainLogger which is fridge-only)
- **R7bi-9-HIGH-2** Inventory list endpoint no `.limit()` — at 2-3k SKUs, response > 1MB
- **R7bi-9-HIGH-3** `visitorPass.updateMany` expires stale passes on EVERY list/stats request → write-lock contention
- **R7bi-10-WB-HIGH-1** Mortuary handover overwritable without state predicate
- **R7bi-10-HK-HIGH-2** ChemicalInventory race: concurrent consume both succeed → negative stock
- **R7bi-10-DT-HIGH-1** Two dietitians pushing concurrent updates can overwrite each other's allergens array on a PREPARED indent

---

## MED highlights (107 total)

- Sidebar lacks Physiotherapist hard-fork (NAV array empty for role)
- Form state not reset on cancel across 6+ modals
- Zero `aria-label` on icon-only buttons across audited consoles
- `key={i}` patterns in ~10 list components
- No `useDebounce` adoption beyond pharmacy
- ChemicalInventory unique on `productName` missing
- DieticianModels referredPatients mixes IPD/OPD payload shape without discriminator
- BillingTrigger.orderedByRole enum missing 6 role values
- ServiceMaster IPD-SUP-002/003 have no taxPercentage / hsnSacCode
- 32+ files repo-wide still read `localStorage.getItem("his_token")` (dead branches per AuthContext cleanup, but advertise the vector)
- Manager-stats endpoints (3) use sequential awaits instead of `Promise.all`

---

## Suggested R7bj shape (~10 parallel fix agents)

Given the scale (79 CRIT + 152 HIGH), split into focused tracks. Strict file-ownership matrix:

| Agent | Theme |
|---|---|
| **F1 PHYSIO MODULE** | Build whole stack: PhysioSession + PhysioPlan models + service + controller + routes + frontend pages. Wire to DoctorOrder consume path. Permissions, sidebar, billing trigger emit. |
| **F2 Kitchen indent close-loop** | KitchenIndentController (markPrepared/markServed/markDelivered) + per-meal trigger emit + WardBoy delivery handover + DELIVERED state + AdverseFoodReaction loop |
| **F3 Append-only + retention** | Schema-level append-only guards on GateLog, IncidentReport, MortuaryRecord, CleaningTask, WardTask. retainUntil + TTL on security logs (5y) per IMS.3 |
| **F4 Mass-assignment + IDOR sweep** | Explicit destructure on every `Model.create(req.body)` site in scope (12+ controllers). Add ownership/role check on `?assignedTo` queries |
| **F5 BillingAudit + GST on auto lines** | Wire BillingAudit.emit into autoBillingService; propagate isTaxable/taxPercent from ServiceMaster to BillItem; extend BillingTrigger.orderedByRole enum |
| **F6 NABH + regulatory scaffolds** | BMW Rules transport manifest, code-response register, FSSAI allergen enum (14 items), needle-stick model with PEP, PSARA/IAP/RD/FSSAI credential types |
| **F7 Print templates greenfield** | WardTask slip, CleaningTask slip, SpillageReport, PestControl register, GateLog slip, IncidentReport (legal/insurance), DietPlan migrate to PrintShell, KitchenIndent slip. Extend PrintAuditModel enum |
| **F8 API envelope migration** | Migrate all 7 R7bi-scope controllers to F8's `apiEnvelope.sendOk/sendErr`. Fix shape drift on managerStats / active-count / pushKitchenIndent |
| **F9 Polling + perf** | `useVisiblePoll` migration across 9 role pages; AbortController on list fetches; `Promise.all` on 3 managerStats; visitor-pass expiry to cron not hot path |
| **F10 File-upload + Cache-Control** | Install multer; safe-upload middleware (size, content-type, scan); URL validator on attachments; Cache-Control no-store on PHI endpoints; complete localStorage fallback removal |

---

## Verification (this audit cycle — no code changes)

- ✅ All 10 audit agents reported; 338 findings catalogued
- ✅ META cross-check verified: 10 R7bf-G/R7bh-F5 files all present; F8 apiEnvelope helper shipped but unadopted; F9 pollingHelpers shipped but unadopted in this wing
- ✅ Backend boots clean on port 5050 with 11 IST crons (verified during R7bi demo)
- ✅ Frontend builds; no regressions surfaced

---

*Authored R7bi by Dr Sandeep + Claude. 10 parallel deep-audit agents · 5 support-role workflows + Kitchen-indent → Diet-plan cross-cut across 10 dims. 338 findings (79 CRIT + 152 HIGH + 107 MED). Awaiting R7bj fix cycle.*
