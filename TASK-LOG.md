# 📋 TASK LOG — SphereHealth / BIMS HIS

> **Ye file kya hai:** Har session ka running task log. Naya session shuru karo toh **sirf ye file padho** — 2 minute me pata chal jayega kya chal raha tha, kaha se pick karna hai, aage kya karna hai.
> **Rule:** Har work-session ke END pe ye file update karke commit karni hai.

**Last updated:** 2026-07-09 · **Branch:** `claude/multi-hospital-deploy` · **Tree:** clean ✅ · **npm audit:** 0/0 ✅ · **Build:** green ✅

---

## 🎯 ABHI YAHA HAI (resume point)

**Abhi hua:** **CLAIM-P1 + P2 + P3 DONE** — multi-payer claim forms ka poora loop band. Private IRDAI Part A/B + Pre-Auth, govt CGHS-MRC/ESIC/universal docket, **ICD-10 coded diagnoses** (discharge summary se auto), **editable blank fields** (bank/occupation on-screen bharo → print), aur **one-click combined Claim Pack** (ek print = poora pack). Isse pehle TPA-P1/P2, ER-P1/P2, DC-P1/P2 sab complete.

**Sabse pehle karne layak (koi bhi ek):**
1. **`git push`** — **6 commits unpushed** (`95cfbbd9..01a16aad` — poora CLAIM arc P1+P2+P3 + TASK-LOGs; TPA-P2 tak `c72a78cd` push ho chuka). PR pe auto-add.
2. **CLAIM-P4 (optional, future):** config-driven state-scheme templates (Aarogyasri/MJPJAY variants — abhi universal docket handle karta hai), discharge-summary form me inline ICD-10 picker (abhi ICD discharge me capture hota hai, dedicated picker nahi).
3. VPS Docker dry-run (Docker install/server chahiye) · Task #43 prints unification.

**ER-P2 DONE (2026-07-09)** `6783318a`: SBAR er-handover printable (Admitted rows pe ⇄), Referred pe ReferralLetter auto-print wiring, `GET /api/reports/er-tat` (live-verified: count 4, avg 2min, max 8min). **ER + DC workflows: P1+P2 sab complete.**

**TPA-P1 DONE (2026-07-09)** `9784d2d7`: `GET /api/reports/tpa-mis?from&to&staleDays` (tpa.claim) — status counts, approval %, submit→approve TAT, approved-vs-settled **realization %**, per-TPA breakdown, **staleClaims chase-list**. Fixture-verified exact. Dev creds sab `123`.

**CLAIM-P1 DONE (2026-07-09)** — multi-payer claim forms: `95cfbbd9` Patient `payerScheme` enum + `schemeIds` (CGHS/ESIC/ECHS/PMJAY/STATE ids) + `claimFormService.buildClaimData(billId)` (episode ke saare bills → insurer Part-B category buckets + hospital ROHINI/GSTIN + patient policy + preauth + docs-checklist) + `GET /billing/:billId/claim-data`; `d2c236dd` 3 printables — **ClaimFormPartB** (hospital, ~95% auto — ROHINI, category breakup, TPA-payable split), **ClaimFormPartA** (insured — known fields prefilled, bank/occupation dashed-blank), **PreAuthRequest** (cashless, estimatedCost se) + IPD Ledger pe **"Claim Pack"** button. Live-verified (endpoint 200 → Part B/A/PreAuth sab render). **Design: 1 data-builder, N templates — form payer se badalti hai product se nahi.** Registration UI me payerScheme dropdown + govt-scheme printables (CGHS-MRC/ESIC) + claim-docket = **CLAIM-P2 (niche)**.

**CLAIM-P2 DONE (2026-07-09)** `2f5433dc`: **payer-scheme registration UI** — ReceptionConsole me "Payer Scheme" dropdown (CASH/RETAIL_TPA/CORPORATE/CGHS/ESIC/ECHS/PMJAY/STATE/OTHER) + conditional govt-scheme-ID fields (CGHS card+ward+PPO / ESIC IP+employer+dispensary / ECHS card / PMJAY id / state name+id) → `patient.schemeIds` (emptyPatient + existing-patient load + save payload sab wired). **3 naye govt printables** (sab `buildClaimData` se): **CghsMrc** (ek template, PPO ho toh MRC(P) pensioner warna MRC(S) serving; card/ward auto, bank boxes blank, Annexure-B enclosure checklist), **EsicClaim** (IP/employer/dispensary auto, treatment+amount, bank blank), **ClaimDocket** (universal cover-sheet — episode summary + scheme-payable vs patient-share + enclosed-docs grid; PMJAY/STATE ke liye "TMS portal pe file hoti hai, ye proof-pack hai" note). IPD Ledger **Claim Pack** ab payer-aware: CGHS→MRC+docket, ESIC→ESIC+docket, PMJAY/STATE/ECHS→docket, warna IRDAI Part B+A. Live-verified: CGHS payload→MRC(P) (card CG-778899, Semi-Private ward, Annexure-B), PMJAY payload→docket (PM-JAY + tms.pmjay.gov.in note + enclosures). **CLAIM-P3 (niche).**

**CLAIM-P3 DONE (2026-07-09)** `01a16aad`: **(P3.1 ICD-10)** `buildClaimData` ab episode ka **DischargeSummary** (NABH AAC.5) load karke `finalDiagnosis`+`icdCode`+`comorbidities` merge karta hai → `claim.admission.diagnoses[]` (Primary + Secondary), koi naya capture UI nahi (discharge already leta hai; fallback provisional prose). Part B pe coded table, baaki forms pe ICD line. **(P3.2 editable overlay)** dashed blank fields (bank/occupation/IFSC/relationship) ab **typeable inputs** — claims desk preview me bharke print kare (print route button-driven hai, auto-print nahi, isliye type-before-print chalta hai); shared `Fill` primitive naya `claimBits.jsx` me. **(P3.3 combined pack)** naya `claim-pack` printable payer ke saare forms ek document me stack karta hai (page-break se) → ek print/PDF; scheme→forms routing `ClaimPackBundle` me central; IPD Ledger "Claim Pack" button ab single bundle kholta hai (pehle N tabs). Verified: real IPD bill pe throwaway discharge-summary (J18.9 + pneumonia + 2 comorbid) → `diagnoses` = Primary + 2 Secondary, temp deleted (real data untouched); browser `/print/claim-pack` (RETAIL_TPA) → 2 pages + 1 break, ICD+comorbid table, 9 editable claim-fill inputs (typing persist), no crash. **Claim suite ab poori complete.** CLAIM-P4 optional: config-driven state-scheme templates.

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
| Branch | `claude/multi-hospital-deploy` (**6 commits push pending** — `95cfbbd9..01a16aad`) |
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
