# 📋 TASK LOG — SphereHealth / BIMS HIS

> **Ye file kya hai:** Har session ka running task log. Naya session shuru karo toh **sirf ye file padho** — 2 minute me pata chal jayega kya chal raha tha, kaha se pick karna hai, aage kya karna hai.
> **Rule:** Har work-session ke END pe ye file update karke commit karni hai.

**Last updated:** 2026-07-08 (raat) · **Branch:** `claude/multi-hospital-deploy` · **Tree:** clean ✅ · **npm audit:** 0/0 ✅ · **Build:** green ✅

---

## 🎯 ABHI YAHA HAI (resume point)

**Abhi hua:** ER-P1 (4 commits) + **DC-P1 + DC-P2-conversion DONE**. Emergency aur Day Care dono ke core loops band.

**Sabse pehle karne layak (koi bhi ek):**
1. **`git push`** — **~10 commits unpushed** (`5f3f5d9c..9e25ab56` — ER-P1 arc + DC-P1 + DC-P2 poora + TASK-LOGs). PR pe auto-add.
2. **ER-P2** — SBAR handover on Admit, referral-letter wiring, ER TAT tile.
3. VPS Docker dry-run (Docker install/server chahiye) · Task #43 prints unification.

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
| Branch | `claude/multi-hospital-deploy` (**17 commits push pending**) |
| Dev servers | preview_start: "Backend (Express)" :5050 · "Frontend (Vite)" :5173 |
| Dev login | `admin@spherehealth.com` / `Welcome@123` (drift ho jaye toh bcrypt cost-12 reset — ho chuka hai ek baar) |
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
