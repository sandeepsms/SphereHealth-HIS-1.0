# R7bl — Re-audit of R7bf → R7bk shipped work (134 findings)

**Cycle**: R7bl (re-audit after R7bk wired sidebar + stub pages for backend-only modules)
**Scope**: Verify every claim in R7bf, R7bh, R7bj, R7bk against the actual filesystem state. Flag where "shipped" code is dead, broken, or only partially landed.
**Method**: 10 parallel agents, orthogonal dimensions, each instructed to be skeptical — META check via grep/glob, not just trust prior cycle docs.
**Result**: **134 findings** (28 CRIT + 47 HIGH + 59 MED)

---

## Agent ownership

| Agent | Dim | CRIT | HIGH | MED | Total |
|---|---|---:|---:|---:|---:|
| R7bl-1 | MongoDB / data integrity | 4 | 8 | 7 | 19 |
| R7bl-2 | Auth + permissions | 1 | 1 | 4 | 6 |
| R7bl-3 | API contract consistency | 3 | 4 | 6 | 13 |
| R7bl-4 | React frontend | 2 | 12 | 14 | 28 |
| R7bl-5 | Node middleware + error | 0 | 3 | 5 | 8 |
| R7bl-6 | Billing ledger | 4 | 3 | 4 | 11 |
| R7bl-7 | Print + receipt | 3 | 2 | 3 | 8 |
| R7bl-8 | NABH + regulatory | 10 | 9 | 8 | 27 |
| R7bl-9 | Performance + scale | 0 | 2 | 5 | 7 |
| R7bl-10 | Security + workflow race | 1 | 3 | 3 | 7 |
| **Total** | | **28** | **47** | **59** | **134** |

---

## 🚨 Top META findings — code claimed shipped that is DEAD or BROKEN

### **META-1: PhysioSession + PhysioPlan + KitchenIndentSlip slug registry COMMENTED OUT**
[Multi-agent: R7bl-1, R7bl-7, R7bl-8]
Templates exist on disk (R7bj-F1 + F2 shipped them), but `printables/index.js` lines 134-136 have the 3 slugs **commented out** with stale comment "must wait until the component file exists". Every `openPrint("physio-session"|"physio-plan"|"kitchen-indent-slip", …)` falls through to the 404 handler. **Net effect**: 3 R7bj print templates are unreachable from the router.

### **META-2: Cold-chain routes SILENTLY UNGATED**
[R7bl-2-CRIT-1]
`Backend/routes/Pharmacy/coldChainRoutes.js:9` requires `../../middleware/permissions` which **does not exist** (path is wrong — should be `middleware/auth`). The try/catch fallback installs a noop middleware. Every authenticated user (Ward Boy, Receptionist, Security, etc.) can POST `/api/cold-chain/log`, PUT acknowledge, GET fridge data — bypassing `pharmacy.cold-chain.write/read` entirely.

### **META-3: Kitchen + Physio emit sites BYPASS new BillingTrigger enums**
[R7bl-1-CRIT-2/3, R7bl-6-MED-1/2/3]
R7bj-F5 extended BillingTrigger.orderedByRole + sourceType enums to include `Physiotherapist`, `Kitchen`, `PHYSIO_SESSION`, `DIET_MEAL`, etc. But the emitting services (`physioService.completeSession`, `kitchenIndentService.markServed`) STILL write `sourceType:"Procedure"` / `"AutoCharge"` and `orderedByRole:"System"`. The new enum values are dead. Comments in the code admit "F5 to extend later" — F5 DID extend.

### **META-4: PrintAuditController.ENTITY_MODEL missing all 18 R7bj-F7 keys**
[R7bl-7-CRIT-1]
PrintAuditModel.entityType enum has all 18 new values, BUT `Backend/controllers/Print/printAuditController.js`'s ENTITY_MODEL map (used to `$inc:{printCount}`) has **zero** of them. POST `/api/print-audit` returns `printCount: 1` always for any of the 18 new types → **DUPLICATE watermark never fires** on reprints of WardTask, EquipmentTransport, SampleCollection, CleaningTask, SpillageReport, PestControl, AreaChecklist, GateLog, IncidentReport, SecurityShiftRegister, DietPlan, MortuaryHandover, BmwManifest, CodeResponse, PhysioSession, PhysioPlan, KitchenIndent, AdverseFoodReaction.

### **META-5: TPA WRITEOFF fields SILENTLY DROPPED**
[R7bl-6-CRIT-1]
R7bj-F10 ask to F1 (add `writeOffAmount/writeOffReason/writeOffBy/writeOffAt` to PatientBill schema) was **never implemented**. `billingController.tpaSettle` calls `bill.markModified('writeOffAmount')` but Mongoose strict mode discards the unknown fields before save. Write-off signal survives only in `bill.remarks` free-text. GSTR-1 / TPA reconciliation reads `writeOffAmount` → undefined.

### **META-6: 5 new R7bj controllers NEVER imported apiEnvelope**
[R7bl-3-CRIT-1, HIGH-1]
R7bj-F4/F8 claimed full envelope migration. Actual adoption: **17/22 = 77%**. The 5 that never imported: `bmwManifestController`, `codeResponseController`, `sharpsInjuryController`, `taxReturnController`, `tdsController`. They use 52 manual `res.json` calls + 23 unprotected `:id` routes (no validateObjectIdParam).

### **META-7: Decimal128 wire leak on Tax/TDS/Kitchen endpoints**
[R7bl-3-CRIT-1/2/3]
TaxReturnsPage + TdsCertificatesPage controllers use `.lean()` without `decimalToNumber` toJSON unwrap. All `summary.totalTaxable/totalCgst/totalSgst/totalIgst/totalAmountPaid` ship as `{$numberDecimal:"…"}` → KPI tiles render ₹0 or NaN. Same in `kitchenIndentService` list endpoints.

### **META-8: SearchInput onChange CRASH on first keystroke**
[R7bl-4-CRIT-1/2]
ColdChainPage L130 + FoodReactionsPage L130 use `<SearchInput value={x} onChange={setX}/>` — but `SearchInput` passes the **raw event** to onChange (`admin-theme.jsx:437`). State becomes a SyntheticEvent → `x.toLowerCase()` throws → page crashes on first keystroke.

### **META-9: IncidentReport.actionTaken UNREACHABLE**
[R7bl-1-CRIT-1]
Schema field `actionTaken` is `String` but the R7bj-F3 append-only guard rejects `$set` on it saying "must use `$push`". `$push` only works on arrays. **Non-admin users cannot ever update `actionTaken` for any incident** — every legitimate write hits 409. Schema must become `[String]` or guard logic must allow `$set`.

### **META-10: localStorage fallback in 23 files (not just 9 dropped by F9)**
[R7bl-10-HIGH-1, R7bl-2-MED-4]
R7bj-F9 dropped fallback in 9 files. Repo-wide grep finds **23 remaining** files that still read `localStorage.getItem("his_token")`: DoctorNotesPage, NursingNotes (4 reads each), AdmittedPatientPanel, AccountsConsole, LabTechConsole, PharmacyHomePage, all 5 R7bf-G NABH pages (Critical Value, FireDrill, ADR, Grievance, Credentialing), 3 ward-button components, etc. Cross-tab session-bleed vector alive on these surfaces.

### **META-11: multer NOT installed → safeUpload returns 501 on every photo POST**
[R7bl-1-CRIT-4, R7bl-10-MED-1]
R7bj-F10 shipped safeUpload.js middleware with `require("multer")` wrapped in try/catch. multer is **not in package.json** → middleware returns 501 `UPLOAD_DISABLED` for every photo upload. VisitorPass.photoUrl, IncidentReport.attachments, SharpsInjury, BmwManifest signature — all schemas have validators but the actual upload surface is dead.

---

## CRIT roster (28 across all dims)

### R7bl-1 Mongo (4 CRIT)
- **1-CRIT-1** IncidentReport.actionTaken schema=String but guard demands `$push` (untouchable)
- **1-CRIT-2** kitchenIndentService.markServed writes stale enum values (Kitchen/DIET_MEAL never used)
- **1-CRIT-3** physioService.completeSession writes "Procedure" not "PHYSIO_SESSION"
- **1-CRIT-4** multer not installed → safeUpload returns 501 (META-11)

### R7bl-2 Auth (1 CRIT)
- **2-CRIT-1** Cold-chain routes silently fail-open: bad require path collapses to noop middleware (META-2)

### R7bl-3 API contracts (3 CRIT)
- **3-CRIT-1** Tax controllers `.lean()` + no Decimal128 unwrap → `summary.totalTaxable` ships raw on GSTR-1 endpoint
- **3-CRIT-2** TDS Form 16A same Decimal128 leak (totalAmountPaid, totalTdsDeducted)
- **3-CRIT-3** Kitchen indent service `.lean()` leaks unitPrice / totalAmount per item

### R7bl-4 React (2 CRIT)
- **4-CRIT-1** ColdChainPage SearchInput onChange contract mismatch → page crashes on first keystroke
- **4-CRIT-2** FoodReactionsPage same crash (META-8)

### R7bl-6 Billing (4 CRIT)
- **6-CRIT-1** TPA WRITEOFF fields silently dropped by Mongoose strict — META-5
- **6-CRIT-2** onOrderCancelled CN hardcodes `taxAmount:0` — GSTR-1 reversal under-reports tax
- **6-CRIT-3** IPD-PHY-001 not seeded — physio sessions land with no GST
- **6-CRIT-4** IPD-SUP-002/003 (Dietician/Diet) missing taxPercentage in seeder

### R7bl-7 Print (3 CRIT)
- **7-CRIT-1** PrintAuditController.ENTITY_MODEL missing all 18 R7bj-F7 keys — DUPLICATE watermark broken (META-4)
- **7-CRIT-2** Physio/Kitchen slugs commented out in printables/index.js (META-1)
- **7-CRIT-3** OPDAssessmentPage `opd-prescription` openPrint missing printAudit block → highest-volume OPD print never audited

### R7bl-8 NABH+Regulatory (10 CRIT)
- **8-CRIT-1** Physio/Kitchen slugs commented out (dup with 7-CRIT-2)
- **8-CRIT-2** credentialExpiryBlocker middleware wired on ZERO routes — HRD.3 unenforced
- **8-CRIT-3** SharpsInjury has NO retainUntil — HIC.6 retention gap
- **8-CRIT-4** ColdChainLog has NO retainUntil
- **8-CRIT-5** pvpiSubmitter is console-log stub — CDSCO submission unproven
- **8-CRIT-6** BmwManifest totals card missing BLACK + CYTOTOXIC colours
- **8-CRIT-7** No printables for SharpsInjury, ColdChainLog, AdverseFoodReaction
- **8-CRIT-8** SharpsInjury create() doesn't auto-schedule 0w/6w/3m/6m follow-up windows
- **8-CRIT-9** CodeResponse cross-links to MortuaryRecord/IncidentReport are caller-supplied only — no auto-link on PRONOUNCED_DEAD outcome
- **8-CRIT-10** gstr1Exporter defaults state to "29" silently when env unset — wrong-state filing risk

### R7bl-10 Security (1 CRIT)
- **10-CRIT-1** dietitianController.getPlan IDOR — any `dietitian.read` holder fetches any plan by `:id`; no ownership check (PHI BOLA)

---

## HIGH highlights (47 total — selected representatives)

- **R7bl-1-HIGH-1** PhysioSession `index: -1` is invalid Mongoose syntax (silently ignored)
- **R7bl-1-HIGH-2** AdverseFoodReaction docstring claims append-only but no pre-update guard
- **R7bl-1-HIGH-3** MortuaryRecord append-only only on `pre("findOneAndUpdate")` — `updateOne`/`updateMany` bypass
- **R7bl-1-HIGH-4** CodeBlueEvent.responders.push race unchanged from R7bi
- **R7bl-1-HIGH-5** ChemicalInventory guard admits `$inc -N` bypasses pre-save
- **R7bl-1-HIGH-6** BillingTrigger.triggeredByRole is free-text (not enum) — asymmetric to orderedByRole
- **R7bl-1-HIGH-7** Hospital model stub has minimal fields; populates with `select("contactNumber email license")` get undefined
- **R7bl-2-HIGH-1** clinical.sharps-injury asymmetric read/write — Ward Boy can POST but not view own filing
- **R7bl-3-HIGH-1** 5 new controllers never imported apiEnvelope (META-6)
- **R7bl-3-HIGH-2** 23 unprotected `:id` route handlers across 5 R7bj route files
- **R7bl-3-HIGH-3** Local `_err()` in taxReturnController emits code-first envelope vs canonical
- **R7bl-3-HIGH-4** No Idempotency-Key on physio.completeSession + kitchen.markServed
- **R7bl-4-HIGH-1** 7 R7bk stub pages all missing AbortController
- **R7bl-4-HIGH-2** Tax/TDS pages use bare `Number()` on Decimal128 → ₹0 KPIs (META-7)
- **R7bl-4-HIGH-3** BmwManifest `key={i}` on dynamic bags array
- **R7bl-4-HIGH-4** 4 pages claimed in R7bj-F9 polling migration list but DON'T use useVisiblePoll (WardManagerDashboard, HousekeepingManagerDashboard, DieticianConsole, IncidentsPage)
- **R7bl-5-HIGH-1** Cache-Control no-store missing on 6 new module paths (cold-chain, bmw, code-response, sharps-injury, tax-returns, tds)
- **R7bl-5-HIGH-2** No Joi/validateRequest on new POST endpoints
- **R7bl-5-HIGH-3** dietitianService standalone-mongo fallback silent on prod misconfig
- **R7bl-6-HIGH-1** physioService bypasses _emitTrigger → no TRIGGER_EMITTED audit row
- **R7bl-6-HIGH-2** kitchenIndentService bypasses _emitTrigger → same audit gap
- **R7bl-6-HIGH-3** Decimal128 leak on IPDLedger reads (.lean() defeats toJSON)
- **R7bl-7-HIGH-1** PhysioSession bare `Number(r.sessionFee)` → ₹NaN on slip
- **R7bl-7-HIGH-2** pharmacy-register openPrint x2 missing printAudit block
- **R7bl-8-HIGH-1** KitchenIndent retainUntil but no legalHold partial filter
- **R7bl-8-HIGH-2** AdverseFoodReaction can't trace meal back to ColdChainLog breach
- **R7bl-8-HIGH-3** ColdChainLog temperature validation only in service (direct .create() bypasses)
- **R7bl-8-HIGH-4** Physio service doesn't check IAP_REG credential before completing session
- **R7bl-8-HIGH-5** Kitchen DELIVERED transition doesn't enforce FSSAI_FOOD_HANDLER credential
- **R7bl-8-HIGH-6** BMW manifest doesn't validate vendor's `cbwtfLicenceNumber` whitelist
- **R7bl-8-HIGH-7** expire-credentials cron flips status but no pre-expiry email/alert
- **R7bl-8-HIGH-8** No cron escalating unacknowledged ColdChainLog breaches
- **R7bl-8-HIGH-9** CodeResponseEvent no escalation cron for unresolved events
- **R7bl-9-HIGH-1** 13+ data-fetch setInterval still not migrated to useVisiblePoll (TreatmentChart, DoctorOrders, NurseOrders, AdmittedPatientPanel, EmergencyList, LabTechConsole, RadiologistConsole, MaintenanceDashboardPage, DischargeQueue, Appointments, ReceptionDashboard, etc.)
- **R7bl-9-HIGH-2** gstr1Exporter materialises full month of PatientBill rows in Node — 50k-bill month = 150-300MB heap
- **R7bl-10-HIGH-1** 23 files still read `localStorage.getItem("his_token")` (META-10)
- **R7bl-10-HIGH-2** mortuaryHandover endpoint BROKEN — controller never sets schema-required witness trio; every call returns 400 MORTUARY_WITNESS_REQUIRED
- **R7bl-10-HIGH-3** Mortuary `witnessName ≠ receivedBy` is name-only string compare (should be witnessId !== handoverById)

---

## MED highlights (59 total)

- KitchenIndent TTL has no legalHold partial filter
- statusHistory subdoc on IncidentReport — correctly `_id:true` but `_id:false` on PersonInvolvedSchema unchanged
- pvpi/gst/16A submission stubs use string-name fallback for TPA dedup (case-sensitive collisions)
- 8 of 14 R7bj-F7 templates with tables lack `pageBreakInside:avoid`
- 7 stub modals don't reset form on cancel
- ColdChain Fridges KPI shows local count under global label
- CodeResponse resolve modal state leaks across resolves
- SharpsInjury no follow-up table action
- BMW manifest `cbwtfReceivedAt` missing from print
- AdminOverride pattern inconsistent (some use `options.adminOverride`, others use bypass key on instance)
- admissionModel.estimatedCost/totalCost/advancePaid still Number (DB-CRIT-03 unchanged)
- AdverseFoodReaction `linkedClinicalNote` hard ref to DoctorNotes (should be `refPath` for polymorphic)
- 17/22 controllers adopted apiEnvelope; 5 didn't (bmw, codeResponse, sharpsInjury, tax, tds)
- 9 controllers outside R7bj scope still bare-spread `req.body`
- cv-alert + grievance-sla cron not `.unref()`'d (block shutdown)
- vendor-prime 743KB + vendor-pdf-html2pdf 776KB still > warning threshold
- BmwManifestSchema.bags[] has no max array cap
- gateLogController.list unbounded `q` regex DoS
- responseEnvelope.js opt-in only, new R7bj routes don't import
- Form 16A dedup uses lower-case tpaName fallback (string variants split)
- mortuaryHandover witness compare is name-string (wrong axis — should be userId)

---

## Verification status — what we shipped correctly (✅)

| R7bj-claimed item | Actually shipped? |
|---|---|
| BillingTrigger orderedByRole + sourceType enum extension | ✅ enums present, but emit sites don't use them (META-3) |
| BillingTrigger originalUnitPrice/Quantity Decimal128 | ✅ |
| BillingAudit emit at 6+ sites in autoBillingService | ✅ 8 sites, all try/catch |
| addItemToBill GST propagation | ✅ |
| HospitalModel stub | ✅ |
| KitchenIndent DELIVERED state + Decimal128 + TTL | ✅ (but no legalHold partial) |
| Append-only on GateLog/IncidentReport/VisitorPass | ✅ findOneAndUpdate+updateOne+updateMany |
| Append-only on Bmw/CodeResponse/SharpsInjury | ✅ findOneAndUpdate+updateOne, ❌ updateMany missing |
| Append-only on MortuaryRecord | ❌ only findOneAndUpdate |
| Append-only on KitchenIndent/PhysioPlan/PhysioSession/AdverseFoodReaction | ❌ none (service-layer only) |
| Append-only on WardTask via transitions[] | ✅ |
| R7bj-F4 mass-assignment fixes on 7 controllers | ✅ verified |
| R7bj-F4 IDOR fixes (wardTask list, dietitian patientPlans) | ✅ |
| R7bj-F4 visitor-pass replay check | ✅ |
| R7bj-F9 useVisiblePoll migration | PARTIAL — 3/7 pages migrated; 4 (WardManagerDashboard, HousekeepingManagerDashboard, DieticianConsole, IncidentsPage) "claimed but unfulfilled" |
| R7bj-F9 localStorage fallback in 9 role pages | ✅ in those 9, but 23 OTHER files still read it (META-10) |
| R7bj-F10 file upload pipeline | PARTIAL — middleware exists, multer not installed (META-11) |
| R7bj-F10 urlValidator | ✅ blocks javascript:/data:/file: |
| R7bj-F10 Cache-Control extended | PARTIAL — 3 of 9 new paths covered; cold-chain, bmw, code-response, sharps-injury, tax-returns, tds missing |
| R7bj-F10 Sidebar + App.jsx route wiring | ✅ |
| R7bh-F1 PrintAudit recordPrintAudit on openPrint() callers | PARTIAL — ~61% adoption (22/36 callsites have printAudit:) |
| R7bh-F5 BillingAudit event enum extension | ✅ |
| PrintAuditModel.entityType enum 18 new values | ✅ (but ENTITY_MODEL map empty — META-4) |
| 14 new R7bj-F7 print templates | ✅ all exist |
| Physio + Kitchen print templates | ✅ exist but slugs commented out (META-1) |
| R7bh-F5 DMC# on OPDPrescription + DischargeSummary | ✅ |
| R7bf-J patient text index, drug text index, voidedAt sparse, BillingTrigger compound | ✅ all |
| R7bh-F6 GSTR + TDS exporters + crons | ✅ but state-code default risky (META-CRIT-10) |
| R7bf-G all 5 NABH scaffolds (CritValAlert, ADR, Grievance, FireDrill, Credential) | ✅ |
| Cron count at boot | ✅ 14 (vs expected 12-14) |
| R7bh-F4 Schedule X main-dispense routing (META reship) | ✅ |
| R7bf-I statusTransitionGuard.js (META reship) | ✅ |
| visitorPassExpiryCron (R7bj-F9 reship) | ✅ |
| 7 R7bk stub pages built | ✅ but 2 crash on first search keystroke (META-8) |
| New permission keys defined backend + frontend | ✅ |

---

## Suggested R7bm fix shape (10 parallel agents)

| Agent | Theme | Findings closed |
|---|---|---|
| **F1** META quick fixes | META-1 (uncomment 3 slugs) + META-4 (extend ENTITY_MODEL with 18 keys) + META-9 (IncidentReport.actionTaken schema/guard) + 7-CRIT-3 (OPD prescription printAudit) |
| **F2** META-2/-11 + Cache-Control | Cold-chain routes require path fix; install multer + smoke-test safeUpload; Cache-Control on 6 new paths |
| **F3** BillingTrigger enum adoption | physioService + kitchenIndentService rewrite emit sites to use _emitTrigger + new enum values (META-3 + 6-HIGH-1/2) |
| **F4** Tax/TDS Decimal128 unwrap | TaxReturnsPage + TdsCertificatesPage use toNum; controllers add post-aggregation unwrap (META-7) |
| **F5** SearchInput contract fix | Update admin-theme.jsx SearchInput to call onChange(value) not onChange(event); OR fix ColdChain + FoodReactions to wrap event handler (META-8) |
| **F6** TPA WRITEOFF schema + CN GST distribution | Add writeOffAmount/Reason/By/At fields to PatientBill; fix onOrderCancelled CN GST distribution (META-5 + 6-CRIT-2) |
| **F7** Regulatory holes | SharpsInjury retainUntil 5y + ColdChainLog retainUntil + sharpsInjury follow-up auto-schedule; BMW totals card 2 missing colours; print templates for SharpsInjury + ColdChainLog + AdverseFoodReaction (10 CRIT findings) |
| **F8** Credential enforcement | Wire credentialExpiryBlocker on clinical routes; IAP_REG check on physio.completeSession; FSSAI_FOOD_HANDLER on kitchen DELIVERED; CBWTF licence whitelist on BMW; expire-credentials pre-notice cron |
| **F9** localStorage cleanup + envelope adoption | 23 file sweep dropping legacy fallback; bmw/codeResponse/sharpsInjury/tax/tds controllers migrate to apiEnvelope + add validateObjectIdParam on 23 :id routes; physio/kitchen Idempotency-Key |
| **F10** Misc + IDOR + mortuary | dietitianController.getPlan IDOR ownership check; mortuaryHandover witness trio fix + controller wiring; pvpiSubmitter HTTPS POST; gstr1 state default safety; ServiceMaster seed IPD-PHY-001 + tax fields |

---

## Verification (this cycle — no code changes)

- ✅ All 10 audit agents reported
- ✅ 11 META findings cross-verified against filesystem
- ✅ Verification matrix tracks R7bf → R7bk claims vs reality (16 ✅, 7 PARTIAL, 5 ❌ false claims)
- ✅ Backend still boots clean (14 IST + interval crons armed)
- ✅ Frontend still builds (1m 21s)

---

*Authored R7bl by Dr Sandeep + Claude. 10 parallel re-audit agents covering R7bf → R7bk shipped work. 134 findings (28 CRIT + 47 HIGH + 59 MED). 11 META findings reveal R7bj claims that landed code but didn't land behavior. Awaiting R7bm fix cycle.*
