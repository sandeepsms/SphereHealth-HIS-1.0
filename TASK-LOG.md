# 📋 TASK LOG — SphereHealth / BIMS HIS

> **Ye file kya hai:** Har session ka running task log. Naya session shuru karo toh **sirf ye file padho** — 2 minute me pata chal jayega kya chal raha tha, kaha se pick karna hai, aage kya karna hai.
> **Rule:** Har work-session ke END pe ye file update karke commit karni hai.

**Last updated:** 2026-07-11 · **Branch:** `claude/multi-hospital-deploy` · **Tree:** clean ✅ · **npm audit:** 0/0 ✅ · **Build:** green ✅

---

## 🎯 ABHI YAHA HAI (resume point)

**Abhi hua:** **TPA-P3 DONE** — claim-pack **documents** (scanned pre-auth/approval/POD upload → uploads/tpa-docs, JWT-serve, delete+unlink) + **dispatch tracking** (COURIER/EMAIL/PORTAL/HAND_DELIVERY; courier ke liye AWB mandatory — wahi number desk chase karta hai). PatientBill: tpaDocuments[] + tpaDispatchLog[]; atomic endpoints (tpa.claim); BillingAudit: TPA_DOC_ATTACHED/REMOVED/DISPATCHED. TPA Desk pe per-claim "📎 Docs" modal. E2E 9/9 (attach→serve→AWB-guard→dispatch→audit→delete→CASH-guard). **TPA arc P1+P2+P3 poora complete.**

**Abhi hua:** **TECH-DEBT SWEEP DONE** `9d517753`+TD-3 — (TD-1) PharmacySale `{patientUHID,createdAt}` index (Complete File COLLSCAN khatam); (TD-2a) OPD-embedded investigations ab lab WORKLIST me auto-order banate hain (Rx-bridge reuse, E2E: INV-20260711-0001); (TD-2b) **QC gate LIVE** — analyser ka latest QC FAIL ho to trendVerify 409 QC_FAILED, PASS ke baad release (NABH AAC.3 ka deferred gate band); (TD-3) Complete File truncation notice (silent oldest-drop ab toast ke saath), printEnrichment old-reprint ab APNI admission ke bed/ward stamp karta hai (latest nahi), escapeRegex dedup. IA language/assessedAt already-fixed nikle. Deferred documented: sig-img×4/buildReceipt×2/IA-adapters merges (risk vs value), coverage admission-scoping (product call), InvestigationMaster ref-ranges (product data).

**Abhi hua:** **ICD-P2 + LAB-FU DONE** `9daf3e03` — **(ICD-P2)** discharge pe multi-diagnosis coded editor: "Additional Coded Diagnoses (Secondary)" rows sab Icd10Picker se, Primary = icdCode+finalDiagnosis; save pe `codedDiagnoses[]` DischargeSummaryModel me; claimFormService coded list prefer karta hai → har claim form pe poori coded diagnosis list. PCS/NAMASTE defer (owner call). Bonus: claimFormService me corrupt NUL byte fix ("0"→"__NONE__"). **(LAB-FU)** discharge Key Investigations ab chronological range-aware narrative se lead karta hai (+ day-wise aggregate); Investigations tab me "Attached original reports" card (JWT-blob open, attachments hone par hi dikhta hai — upload UI off hai, future-ready). E2E: 3 coded dx → claim diagnoses ✓; browser: editor + pick I10 → code+description auto-fill ✓.

**CODE-CLEANER PROGRAM COMPLETE + FINAL VERIFICATION ✅** — closing sweep: npm audit 0/0 dono side, FE build green, **20/20 cross-module API smoke** (pharmacy/reports/tax/billing/insurers/lab/icd10/patient-file/clinical×4/doctors/patients/nabh-registers×2/investigations/indents sab 200 fresh restart pe). Program: (~1,900 dead LOC, 73 catches→shared sendErr, sab verified; details `cleanup-logs/`). Pehle tha: M1→M8 (~1,850 dead LOC removed total). Sabse bade: **M7 Doctor 621** + **M8 Nursing 1,117** — dono me R7gn shared-PatientPanelTabs migration ke superseded local tabs + orphan helpers mile (provably unreferenced, build+browser verified). M6 Clinical: 34 catches→sendErr 7 controllers me. **Agla: M9-A Patient/Reception BE.** Pehle tha: M1→M5 (12 me se 5 module). M3 Billing: naya shared `utils/sendErr.js` + 12 raw catches converted (money math untouched); M4 Lab: 8 catches→sendErr + 2 unused requires (intentional 400s untouched); M5 TPA/Claims: audit-clean. Har module ka connections-section bhara. **Agla: M6-A Clinical BE models (16.6k — sabse bada).** Status: `cleanup-logs/00-PROGRAM.md`. Pehle tha: (`cleanup-logs/00-PROGRAM.md` = master plan + status board, har module ka apna log). M1 Pharmacy: 61 LOC removed (dead TemplatePreviewModal 56 + unused TEMPLATES import + 3 unused requires... nahi — 2 raw catches→sendErr bhi), backend layers R7-cycles se already tight nikle (3 automated scans zero). M2 Accounts/Finance: 3 unused requires removed, baaki clean. **Agla: M3-A Billing** (models+money utils — RULE: money math bina before/after test ke NAHI chhedna). Har part = scan → change → smoke → module-log → commit. Resume karne ke liye 00-PROGRAM.md ka status board padho.

**FIN-AUDIT DONE** — Accounts & Finance full working audit **20/20 green** (Accountant role se): day-book / today-revenue / gst-monthly / hospital-register / refunds / sequence-audit; GSTR-1+3B **preview→generate→finalize→mark-filed(ARN)** poora lifecycle; Form 16A register; cashier session open→close (close field = `closingCash` + `varianceNote`), **variance bina note BLOCKED (400)**, note ke saath ₹500 variance recorded; Nurse RBAC 403 financial reads+writes pe. **Koi code fix nahi laga — module poora functional.** Test sessions/snapshots cleaned.

**PHARM-AUDIT DONE** `2fe8b2fa` — pharmacy module 5-flow live E2E **18/18 green** (stock-in GRN / inventory-FEFO-expiry-alerts / OPD dispense+GST / IPD indent raise→ack→release / IPD credit ledger+billing trigger). **Root cause mila:** dev DB me kisi user ke paas PCI/State Pharmacy Council registration nahi thi — GRN/dispense/release sab licensed acts hain (D&C Rules 65 gate) → 403. Fix: `scripts/seedPharmacistCredential.js` (har deployment pe ek baar chalana; production me HR se credential add hota hai). Dispense me 2 real fixes: drugName/hsnCode server-side backfill + ValidationError ab 400 (500 nahi). Module already PRO-grade tha: 10 tabs, FEFO, Schedule H/H1/X registers, GST/GSTR-1, invoice-parse GRN, stock-take, vendor returns, day-close, credit ledger with discharge-block.

**LAB-P4 DONE** `17124bdd` — **in-house lab reports ab NABL/ISO 15189 standard pe print hote hain.** LabTrend me sample meta (sampleId/accession, collected+received date-TIME, referring doctor, analyser, per-test method) + `verifiedByName` dono models pe; trendUpdate pe anti-forge guard (generic write verified status nahi bana sakta). Release rules: **FINAL sirf doctor-verify ke baad** (warna amber PROVISIONAL strip), signatory = verifier (printer nahi), post-verify edit → red **AMENDED** strip; NABL cert number ab settings `accreditations[]` se print hota hai. Entry UI me "Sample details (NABL)" card + Method column. E2E: meta persist → forge blocked → verify stamp → amended detect; PROVISIONAL aur FINAL+AMENDED dono print variants browser-verified. **Upload UI gated OFF** `42505621` (owner: manual entry only; `SHOW_OUTSIDE_UPLOAD` flag se wapas aayega).

**LAB-P1/P2/P3 DONE** — lab/imaging reporting suite. **(P1)** `4274fc24` System se hi NABL-standard lab report + NABH-standard imaging/diagnostic report print hote hain: `/lab-results` Trend Sheet pe "Print report" (H/L/HH/LL flags, ref ranges), aur naya **DiagnosticReport** printable (slug `diagnostic-report`) — X-Ray/USG/CT/MRI/mammo/DEXA + micro (culture+sensitivity)/histopath/cytology/ECG/echo/PFT/endoscopy, per-type title+modality, findings/impression, radiologist-vs-pathologist sign-off. **(P2)** `6fb475d8` Investigations tab me **chronological narrative** — same values date-order paragraph me, ref-range wali light explanation ke saath ("On 08 Jul, Hb 9.2 g/dL (critically low, ref 12–16)… Trend: Hb fell 11.0→9.2") — shared util `labNarrative.js`, `/lab-records/trends` se. **(P3)** `88fed633` **"Imaging / Outside Reports" tab me original scanned PDF/JPG upload** — dormant `safeUpload` wire kiya (POST/DELETE `/lab-records/reports/:id/attachment`, hardened multer, uploads/lab-records/, filterSafeUrls); chips se open (authed blob), delete + disk-unlink. E2E: upload 201→serve 200 (application/pdf)→html reject 415→delete+unlink. Isse pehle ICD-P1 (ICD-10 master) + CLAIM-P1→P4 sab complete.

**ICD-P1 DONE** `f979aed4` — **ICD-10 master hamesha updated** (owner: "manually description na dalna pde"). Poora CMS/NCHS ICD-10-CM FY2026 release (74,719 billable codes, public domain) repo me shipped (`Backend/data/icd10cm-codes-2026.txt.gz`) + dev DB seeded. **Typeahead coding** teeno coding surfaces pe: OPD Assessment, IPD Initial Assessment, Discharge Summary — code YA words type karo ("J18" / "pneumonia" / "diabetes type 2") → coded list → pick pe **code + official description dono auto-fill**. Yearly refresh: `node scripts/importIcd10.js <file>` ya **POST /api/icd10/import** (Admin/MRD, browser se CMS file upload) — dropped codes deactivate hote hain (delete nahi), <1000-row file reject (bad upload master wipe nahi kar sakta). Search: `GET /api/icd10/search` code-prefix/dotted/multi-word (17ms), `/api/icd10/meta` freshness. E2E: discharge form pe "appendicitis" → K35.80 pick → code + Final Diagnosis auto-filled, 0 console errors. Isse pehle CLAIM-P1→P4 (company-specific PDF forms) sab complete.

**Sabse pehle karne layak (koi bhi ek):**
1. **`git push`** — **~7 commits unpushed** (ICD-P1 `f979aed4`, portal-fix `c9be2456`, LAB-P1/P2/P3 `4274fc24..88fed633` + logs; c9be2456 tak push ho chuka). PR pe auto-add.
2. **LAB-P4 (optional):** uploaded outside-report attachments Doctor/Nurse **Investigations panel** me bhi dikhein (abhi sirf lab desk ReportTab me open hote hain) — InvestigationsSummaryTab me reports+attachments fetch + viewer. Chronological narrative ko discharge `keyInvestigationsText` me bhi feed karna.
3. **Insurer PDFs plug-in karna:** har insurer ki official blank claim PDF **/insurer-forms** page pe upload karna (Admin) — fillable PDF auto-map; bina upload ke bhi generated standard form chalta hai.
4. **ICD-P2 (optional):** multi-diagnosis picker editor, ICD-10-PCS procedure codes, NAMASTE/Ayush codes.
5. VPS Docker dry-run (Docker install/server chahiye) · Task #43 prints unification.

**ER-P2 DONE (2026-07-09)** `6783318a`: SBAR er-handover printable (Admitted rows pe ⇄), Referred pe ReferralLetter auto-print wiring, `GET /api/reports/er-tat` (live-verified: count 4, avg 2min, max 8min). **ER + DC workflows: P1+P2 sab complete.**

**TPA-P1 DONE (2026-07-09)** `9784d2d7`: `GET /api/reports/tpa-mis?from&to&staleDays` (tpa.claim) — status counts, approval %, submit→approve TAT, approved-vs-settled **realization %**, per-TPA breakdown, **staleClaims chase-list**. Fixture-verified exact. Dev creds sab `123`.

**CLAIM-P1 DONE (2026-07-09)** — multi-payer claim forms: `95cfbbd9` Patient `payerScheme` enum + `schemeIds` (CGHS/ESIC/ECHS/PMJAY/STATE ids) + `claimFormService.buildClaimData(billId)` (episode ke saare bills → insurer Part-B category buckets + hospital ROHINI/GSTIN + patient policy + preauth + docs-checklist) + `GET /billing/:billId/claim-data`; `d2c236dd` 3 printables — **ClaimFormPartB** (hospital, ~95% auto — ROHINI, category breakup, TPA-payable split), **ClaimFormPartA** (insured — known fields prefilled, bank/occupation dashed-blank), **PreAuthRequest** (cashless, estimatedCost se) + IPD Ledger pe **"Claim Pack"** button. Live-verified (endpoint 200 → Part B/A/PreAuth sab render). **Design: 1 data-builder, N templates — form payer se badalti hai product se nahi.** Registration UI me payerScheme dropdown + govt-scheme printables (CGHS-MRC/ESIC) + claim-docket = **CLAIM-P2 (niche)**.

**CLAIM-P2 DONE (2026-07-09)** `2f5433dc`: **payer-scheme registration UI** — ReceptionConsole me "Payer Scheme" dropdown (CASH/RETAIL_TPA/CORPORATE/CGHS/ESIC/ECHS/PMJAY/STATE/OTHER) + conditional govt-scheme-ID fields (CGHS card+ward+PPO / ESIC IP+employer+dispensary / ECHS card / PMJAY id / state name+id) → `patient.schemeIds` (emptyPatient + existing-patient load + save payload sab wired). **3 naye govt printables** (sab `buildClaimData` se): **CghsMrc** (ek template, PPO ho toh MRC(P) pensioner warna MRC(S) serving; card/ward auto, bank boxes blank, Annexure-B enclosure checklist), **EsicClaim** (IP/employer/dispensary auto, treatment+amount, bank blank), **ClaimDocket** (universal cover-sheet — episode summary + scheme-payable vs patient-share + enclosed-docs grid; PMJAY/STATE ke liye "TMS portal pe file hoti hai, ye proof-pack hai" note). IPD Ledger **Claim Pack** ab payer-aware: CGHS→MRC+docket, ESIC→ESIC+docket, PMJAY/STATE/ECHS→docket, warna IRDAI Part B+A. Live-verified: CGHS payload→MRC(P) (card CG-778899, Semi-Private ward, Annexure-B), PMJAY payload→docket (PM-JAY + tms.pmjay.gov.in note + enclosures). **CLAIM-P3 (niche).**

**CLAIM-P3 DONE (2026-07-09)** `01a16aad`: **(P3.1 ICD-10)** `buildClaimData` ab episode ka **DischargeSummary** (NABH AAC.5) load karke `finalDiagnosis`+`icdCode`+`comorbidities` merge karta hai → `claim.admission.diagnoses[]` (Primary + Secondary), koi naya capture UI nahi (discharge already leta hai; fallback provisional prose). Part B pe coded table, baaki forms pe ICD line. **(P3.2 editable overlay)** dashed blank fields (bank/occupation/IFSC/relationship) ab **typeable inputs** — claims desk preview me bharke print kare (print route button-driven hai, auto-print nahi, isliye type-before-print chalta hai); shared `Fill` primitive naya `claimBits.jsx` me. **(P3.3 combined pack)** naya `claim-pack` printable payer ke saare forms ek document me stack karta hai (page-break se) → ek print/PDF; scheme→forms routing `ClaimPackBundle` me central; IPD Ledger "Claim Pack" button ab single bundle kholta hai (pehle N tabs). Verified: real IPD bill pe throwaway discharge-summary (J18.9 + pneumonia + 2 comorbid) → `diagnoses` = Primary + 2 Secondary, temp deleted (real data untouched); browser `/print/claim-pack` (RETAIL_TPA) → 2 pages + 1 break, ICD+comorbid table, 9 editable claim-fill inputs (typing persist), no crash.

**CLAIM-P4 DONE (2026-07-09)** — "**company ka apna form bharke de**" (owner ki request). Approach: **official PDF overlay** + generated fallback; coverage: **saari ~28 major insurers**. New dep **pdf-lib** (pure-JS, 0 vulns).
- `a631fa29` **(P4.1+P4.2)**: **`config/insurers.js`** registry — ~28 insurers (standalone-health/private-general/PSU/digital) with legal name + type + **claim email/postal-hub/portal + common TPAs** (2026 research se accurate), `getInsurer`/`listInsurers`, `GET /api/insurers`. Patient pe **`insurerCode`+`insurerName`** (TPA se alag — TPA administer karta hai, insurer form owns) + ReceptionConsole "Insurance Company" dropdown (type-grouped). `buildClaimData` me `claim.insurer` block. **`insurerFormService.js`** (pdf-lib engine): `fillInsurerForm(billId,insurerCode)` → **overlay path** (uploaded official blank PDF pe AcroForm-field/x-y overlay) ya **generated fallback** (apni layout ka clean standard Part A/B — letterhead, ROHINI, category breakup table, ICD diagnoses, totals, TPA-vs-patient split, preauth, docs, declaration, submit-to footer — kisi copyrighted form ki copy NAHI). `GET /billing/:billId/insurer-form.pdf?insurerCode=` streams PDF; IPD Ledger **"Company Form"** button (blob fetch). Live-verified: /insurers→28, insurer-form.pdf→200 %PDF-, per-insurer branded filenames.
- `52e6fa7d` **(P4.3)**: hospital ki **uploaded official blank PDF** support — **`InsurerFormTemplate`** model (PDF bytes + fieldMap + detected acroFields, versioned), `/api/insurer-forms` (upload/list/get/blank-preview/map/remove; settings.write). Upload pdf-lib se AcroForm fields detect karke **auto-map** karta hai (keyword→system-value). **`/insurer-forms` admin page** (InsurerFormsPage): har insurer ka form status (on-file/generated) + upload/replace/preview/map-editor/remove; sidebar+route (Admin). **Live-verified E2E**: fillable AcroForm PDF STAR pe upload→201, 6 fields auto-mapped; insurer-form.pdf?STAR ne asli values overlay kiye — pdf-parse se "JaiBhagwan", policy STAR-HLTH-99887766, hospital name, "Rs. 1,130.00", "10 May 2026" confirmed. Admin page 28 insurers, no crash.

**Honest note:** hum insurers ki copyrighted PDFs ship nahi karte — hospital har insurer ki official blank PDF ek baar /insurer-forms pe upload kare (fillable auto-map ho jaati hai); bina upload ke generated standard form (jo IRDAI-standard hone se har insurer accept karti hai) chalta hai. **Claim suite ab poori complete (P1–P4).** CLAIM-P5 optional: flat-PDF visual coordinate-mapper, config-driven state-scheme templates.

**TPA-P2 DONE (2026-07-09)** `3b1c7827`: **insurer query loop** — `tpaQueryLog[]` + POST `/:billId/tpa-query` & `/tpa-query/:queryId/reply` (ATOMIC updates — partial-select save() recalcTotals pe crash karta tha, E2E me pakda; OPEN-filter se double-reply 409), audit events `TPA_QUERY_RAISED/REPLIED`, tpa-mis me `openQueries` facet (ageing ke saath); **`/tpa-desk` page** (sidebar: Admin/TPA/AC) — KPI tiles, per-TPA table, stale + open-query chase-lists, Queries modal (raise/reply/REJECTED→Re-submit via existing preauth-submit). Full loop live-verified. TPA master CRUD backend+UI pehle se tha (AddTpa/TPAServiceManagement). **TPA-P3 pending**: pre-auth document attachments (upload-infra decision chahiye), courier/dispatch tracking.

**DC-P2 DONE (2026-07-09):** `b6469107` DC→IPD conversion; `9e25ab56` NABH Day Care register (`DayCareRegisterModel` + `emitDayCare`, idempotent, gate-pass + conversion se emit) + `dc-summary` printable (checklist state + Aldrete breakdown + home advice, board pe 🖨). **Emergency + Day Care dono workflows ab complete** (ER-P2/P3 polish backlog me).

### DC-P1 + P2-conversion (2026-07-09)
| Commit | Kya hua |
|---|---|
| `57915ba0` | **/daycare board** (sidebar "Day Care Today"): stage chips (pre-proc pending → checklist ✓ → recovery score → ✅ READY ≥9/10 → ⏰ OVERDUE), Checklist modal (consent/NPO/site/high-risk-meds), Aldrete-style Readiness modal; `PATCH /admissions/:id/daycare` (vitals.write) |
| `b6469107` | **DC→IPD conversion** `POST /:id/convert-to-ipd` (reason mandatory, trail stamped, 409 re-convert guard) — same admission, bed/bills/episode intact; board pe "→ IPD" button. Billing split R3 multi-bill gate handle karta hai |

### ER-P1 (2026-07-08 raat) — Emergency loop band
| Commit | Kya hua |
|---|---|
| `5f3f5d9c` | Serial vitals: `vitalsLog[]` + POST /:erNo/vitals + board pe heart-button modal (snapshot bhi refresh) |
| `d1d10de4` | **Disposition modal** (R7z attestation ka pehla UI!) + `ERDischargeSummary` printable — Discharged/Referred/LAMA pe auto-print |
| `3f4270cb` | **Walk-in ER bill latent bug fix** (synthetic visit._id pe bill kabhi banta hi nahi tha — pending-review me atakta) + exit pe DRAFT→generateFinalBill + "₹X due" prompt |
| `49e6a00c` | Observation mode: 2h review clock (`ER_OBS_REVIEW_HOURS`), vitals entry se reset, board pe ⏰ OVERDUE chip |

**Emergency + Day Care workflow plans** conversation me diye gaye the (2026-07-08) — DC-P1/P2/P3 aur ER-P2/P3 ki phased list wahi hai; DC plan: DC Today board + pre-procedure checklist + Aldrete-style discharge-readiness (P1), DC→IPD conversion + DC register (P2).

---

## ✅ ABHI-ABHI COMPLETE (2026-07-08) — Billing NABH arc

### Round 1 — Owner ke 3 billing rules + audit fixes
| Commit | Kya fix hua |
|---|---|
| `bac0bc73` | ER→IPD billing bootstrap (reg/adm fees ab bill hote hain) + OPD→IPD episode consolidation (`convertedFrom/To` link, ledger banner, discharge OPD-dues gate) |
| `ce16afb0` | Rule 1: previous PENDING dues registration + billing counter pe surface (settled = fresh slate) |
| `96b42703` | Advance admission-earmark ENFORCE — doosri admission pe kharch nahi ho sakta (409 `ADVANCE_EARMARK_MISMATCH`) |
| `a3424f1d` | Discharge gate ab SAARE open bills sum karta hai + payment waterfall (oldest-first) |
| `9ad06bda` | FinalBill Payment History = saare bills ke payments + Total Paid tie-out row |
| `deb78316` | ER-triage charge ER→IPD episode me rebind (phantom visit-id bill fix) |
| `eed69d5f` | SERVICE walk-in fresh-slate — purana DRAFT auto-finalize, naya bill fresh (koi silent merge nahi) |
| `581d06c7` | `/billing/uhid/:UHID` pe optional `?visitId/?admissionId/?visitType` scope params (additive) |

### Round 2 — NABH re-audit P1 (statutory/core)
| Commit | Kya fix hua |
|---|---|
| `67c5891c` | **Room rent >₹5000/day (non-ICU) → 5% GST** (Notification 03/2022; ICU/CCU/NICU exempt; `ROOM_RENT_GST_THRESHOLD` env) |
| `b5bed4e9` | Sequence auditor ab short `BILL-YY-` series dekhta hai (pehle andha tha) + model fallback `pre("validate")` me + ek hi counter/series |
| `375c7caf` | **Discount cap** — non-Admin ≤10% net reduction (`BILLING_DISCOUNT_CAP_PCT`), line-edit write-off bhi pakda jaata hai; `billing.discount` action ab live |
| `ccddf851` | **PRE.4 Cost Estimate wired** — IPD form me Estimated Cost field → save pe `EST-<admNo>` document auto-print + AdvanceReceipt me estimate block |

### Round 3 — NABH re-audit P2 (process/controls)
| Commit | Kya fix hua |
|---|---|
| `ab0525a5` | BillingAudit blind spots band — order complete/cancel emits, pharmacy sale timeline me, TPA_REFUND enum fix |
| `ec6dfea4` | Har ServiceMaster price change ab audited (sub-threshold direct + maker-checker approve dono) |
| `b320e045` | Unspent advance discharge pe surface — response note + `dischargeWorkflow.unspentAdvanceAtClear` + audit row (Death → next-of-kin wording) |
| `b0f5f560` | **FY-aware series (Apr–Mar)** — BILL/ADV/CN ab Jan 1 pe reset nahi; `fyStartYear()` util; deploy-safe |
| `b87b15e1` | **Discharge-TAT CQI** — `GET /api/reports/discharge-tat` (billing/exit/total mins, byType, 5 slowest) |

**Har fix live-verified** (real DB/HTTP/browser pe, temp fixtures se — real seed data kabhi mutate nahi hui), commit-per-fix, `node -c` + vite build green.

---

### Round 4 — NABH P3 polish (2026-07-08 late) — SAB DONE ✅
| Commit | Kya fix hua |
|---|---|
| `50c293de` | **Round-off** (patient share nearest-rupee + `roundOffAmount` + print line) **+ per-line Disc column** on FinalBill (+ raw-billItems `netAmount` fallback — DischargeQueue path ₹0 bug fix) |
| `5412d7d7` | Numbered-invoice cancel → **§34 credit note pair** (register me invoice rehta hai, CN reverse karta hai — net zero WITH trail); snapshot cron mirror |
| `d7869061` | **REC-YY-N payment receipt serials** — recordPayment + bulk legs + discharge waterfall; sequence-audit me `receipts` series; PaymentReceipt print prefers real serial |
| `63f72465` | **CN_CREATE_FAILED** timeline marker + bill remarks; **tpaPreAuthNumber/tpaPreAuthAmount** structured fields; **refundedToName/Relation** (Death → next-of-kin) |
| `e0c5ca48` | **Patient-facing Tariff List printable** + Print Tariff button on /chargeable-services (PRE.4) |

## 📌 AAGE KYA KARNA HAI

### Billing — bacha hua (sirf design/product calls, koi statutory gap nahi)
- [ ] CN hard-link decision (abhi: fail → CN_CREATE_FAILED marker + remarks; block karna hai ya nahi — owner call)
- [ ] Frontend: TPA pre-auth form me naye `preAuthNumber` field ka input + refund modal me "Refunded To/Relation" inputs (backend ready, UI optional)
- [ ] `migrateNumberShortFormat.js` dev DB pe chalana (16 legacy-format bills — sequence-audit `legacyFormat` me visible)

### Non-billing backlog (purane arcs se)
- [ ] **Task #43** — saare clinical prints (treatment chart, vital chart) Complete-File shared renderers pe unify (audit bola mostly already unified — verify + close)
- [ ] On-screen note list-item wrapper strip karna hai ya nahi — owner decision
- [ ] 6 standalone formal docs unification — owner decision
- [ ] **VPS Docker dry-run** — deploy/ + Dockerfiles ready hain (Option A: per-hospital deploy); user ka server chahiye
- [ ] Frontend dashboard tile for discharge-TAT / lab-TAT (endpoints ready, UI consumer koi nahi — optional)

### Standing discipline (har kaam pe lagoo)
- Tree hamesha clean, security issues turant fix, npm audit 0/0, commit-per-fix, har fix live verify
- Owner ke 3 billing rules canonical hain (memory: `spherehealth-billing-rules.md`)
- Money code pe kabhi rush nahi — pehle investigate, temp-fixture test, phir commit

---

## 🔑 QUICK REFERENCE

| Cheez | Value |
|---|---|
| Repo | `D:\Spherehealth` (Express+Mongoose backend, React+Vite frontend, MongoDB) |
| Branch | `claude/multi-hospital-deploy` (**3 commits push pending** — `a631fa29..`; CLAIM-P3 tak `3cd2a8cf` push ho chuka) |
| Dev servers | preview_start: "Backend (Express)" :5050 · "Frontend (Vite)" :5173 |
| Dev login | **sabhi 27 users** ka password `123` (2026-07-09 se, owner request; admin@spherehealth.com bhi). Drift ho jaye toh bcrypt cost-12 reset script pattern use karo |
| Backend verify | `node -c <file>` (build step nahi hai) |
| Frontend verify | `npm run build` (~20-40s) |
| Sequence audit | `GET /api/billing/sequence-audit` (`reports.audit`) — FY-start year param |
| Discharge TAT | `GET /api/reports/discharge-tat?from=&to=` (`reports.clinical`) |
| Test patients | UH01 (JaiBhagwan), UH04 (multi-bill pending dues) — temp tests `ZZ*` UHID pattern se karo, baad me delete |
| Env knobs (naye) | `BILLING_DISCOUNT_CAP_PCT` (10), `ROOM_RENT_GST_THRESHOLD` (5000) |
| gh CLI | Authed NAHI — PR via `pull/new` URL |
| Memory files | `spherehealth-billing-rules.md` (poora audit+fix detail), `spherehealth-backlog.md` (queue) |

---

## 🗂 PURANE ARCS (context — sab DONE)

- **2026-07-08 (subah):** Fable-5 re-audit of print/render unification (`e45edcd9`, 5 fixes) · Nursing IA 2-column book layout (`b9834ea7`) · Signed lines with Emp ID + digital signature everywhere (`dfc2d225`) · Launch-hardening review + fixes (`838c7659`) · 12 commits push (`1c4ff86e..838c7659`)
- **2026-07-05 arc:** Print/render unification (letterhead + IA shared renderer), doctor/nurse note capture↔render alignment, patient feedback system, IA forms validation/signature/responsive
- **Pehle:** Role dashboards audit, vital sheets, nursing workflows, GST invoicing, multi-hospital Docker foundation (deploy/)
