# HIS Certification — Requirements, Readiness & Go-Live Roadmap

> **Product:** SphereHealth / BIMS HIS · **Date:** 2026-07-12 · **Market:** India (hospitals, incl. govt / PM-JAY / insurance)
> **Method:** the certification landscape below is standard India-market guidance; the **"Our readiness"** scores are a code-grounded audit of this repo (3 read-only auditors, every claim carries `file:line` evidence). This is a planning document, not legal advice — final statutory/certification specifics vary by state + buyer and should be signed off by a compliance consultant.

---

## 0. TL;DR (one screen)

- **A "HIS certificate" is not one thing.** You need a *mix* of (a) **statutory compliance** (legal to operate), (b) **security certifications** buyers demand in tenders, (c) **ABDM interoperability** (increasingly required for govt/insurance), and (d) **accreditation *support*** (the hospital gets NABH/NABL; your software must *enable* it).
- **Most "certificates" are external audits/paperwork that code cannot self-satisfy** — good code makes them *pass faster and cheaper*, but you still commission the audit.
- **Where our code stands today (audited):**

| Domain | Code readiness | Verdict |
|---|:---:|---|
| Statutory (GST/IT-Rule-46 · D&C/NDPS pharmacy · NABH/NABL support) | **83% 🟢** | Strong — enforced, not just modelled |
| Security & DPDP technical controls (ISO 27001 / VAPT base) | **72% 🟢** | Genuinely strong auth/RBAC/audit; real gaps in encryption-at-rest + DPDP rights |
| ABDM / FHIR interoperability (M1/M2/M3) | **~60% 🟡** | Framework built 2026-07-13 (`2e564241`) — HIP callbacks, ABHA link, consent + care-context models, X25519/AES-GCM HIE, FHIR R4 document bundle; disabled by default. Needs sandbox creds + milestone certification |

- **Fastest path to first sales (weeks, low cost):** VAPT report + DPDP privacy pack + India-region hosting. Sellable to small/mid hospitals immediately.
- **Biggest single build gap:** ABDM live-gateway integration (needed for govt/PM-JAY empanelment).

---

## 1. Certification landscape — what a HIS needs in India

### 🔴 A. Legal / Statutory (mandatory to operate — mostly *compliance posture*, not a paper certificate)

| Item | What it is | Time | Cost (approx) | Note |
|---|---|---|---|---|
| **DPDP Act 2023** | Consent, purpose-limitation, data-principal rights, breach-notify. **India data-localization** for health data | 2–4 wk setup + ongoing | ₹50k–2L (legal/DPA) | No cert body issues it; you self-attest + can be audited. Rules operationalising 2025 |
| **IT Act 2000 + SPDI Rules** | "Reasonable security practices" — ISO 27001 is the named standard | — | — | Covered by ISO 27001 |
| **CERT-In Directions 2022** | Breach report ≤6 h, 180-day logs, India NTP time-sync | Config | Low | Ops/logging setup |

### 🟠 B. Security certifications (tenders/buyers demand — *sales-gating*)

| Certificate | Issuer | Time | Cost | How essential |
|---|---|---|---|---|
| **VAPT report** (CERT-In empanelled auditor) | Empanelled security firm | **1–3 wk / cycle** | ₹50k–2.5L | **Most common tender ask — do first** |
| **ISO/IEC 27001** (ISMS) | Accredited body (BSI/TÜV/…) | **3–6 mo** | ₹3–8L + annual surveillance | Corporate / chain hospitals |
| **ISO 9001** (QMS) | Cert body | 2–4 mo | ₹1–3L | Credibility, optional |
| **SOC 2 Type II** | CPA/audit firm | 6–12 mo | high | **Only** if international/US clients |

### 🟡 C. ABDM — national interoperability (govt / PM-JAY / insurance increasingly *mandatory*)

| Milestone | Prove | Time | Cost |
|---|---|---|---|
| Sandbox onboarding + HFR/HPR registration | Register app + facility/professional in NHA registries | days | Free |
| **M1** — ABHA create/verify | Create/link ABHA (health ID) | weeks | Free (dev effort) |
| **M2** — HIP link + share | Care-context linking + consent-based FHIR record share | 1–2 mo | Dev effort |
| **M3** — HIU consent-fetch | Consent-manager request + fetch external records | 1–2 mo | Dev effort |

> ABDM certification itself is **free** — the cost is integration engineering. It runs against the NHA sandbox.

### 🟢 D. Accreditation *support* (the **hospital's** cert; your software must not block it)

| Item | Whose cert | Time (for hospital) | Our role |
|---|---|---|---|
| **NABH** (hospital accreditation) | The hospital | 6–18 mo | Provide registers + audit trails + workflows. **Our support ≈ 80%** (see `NABH-NABL-COMPLIANCE-REVIEW.md`) |
| **NABL** (lab accreditation, ISO 15189) | The lab | 6–12 mo | Sample lifecycle + QC + critical-value + amendment trail. **Our support ≈ 70%** |
| **JCI** (international) | Premium hospitals | 12–24 mo | Superset of NABH; same support model |

### ⚪ E. SaMD / CDSCO — **generally NOT applicable** (do not chase this)

A pure HIS/EMR (billing, records, workflow, advisory) is **not a medical device** under CDSCO / Medical Device Rules 2017 → **exempt** from CDSCO registration + ISO 13485. It only applies if the software makes an autonomous *diagnostic/treatment decision* (e.g. an AI that outputs a diagnosis). Our system is record-keeping + advisory → out of scope. *(Common misconception — flagged so it isn't chased.)*

---

## 2. Our capability — code-grounded scorecard

### Statutory compliance — **83% 🟢** (strongest)

**Enforced in code (auditor-checkable):**
- Gap-less FY-keyed sequential numbering (IT-Rule-46) on one atomic counter — `utils/counter.js:48-101` (`nextSequence` atomic `$inc`).
- Full GST tax invoice — HSN/SAC per line + CGST/SGST/IGST split by place-of-supply, on both hospital bill + pharmacy sale — `PatientBillModel.js:566-592,666-676`.
- Credit notes per GST §34 (CDNR-shaped, reason 01–07) — `models/Billing/CreditNote.js:19-119`.
- D&C Schedule H/H1/X dispensing gate (Rx ref + prescriber reg) — `pharmacyController.js:951-964`.
- NDPS narcotic register + two-person witness + append-only balance — `services/Pharmacy/scheduleXRegister.js:72-82`.
- Pharmacist practising-registration credential gate — `pharmacyRoutes.js:56,68`.

**Residual gaps:**
- No auditor-facing **sequence-gap reconciliation report** (gaps from cancelled drafts/burnt serials are legitimate but unexplained to an IT-Rule-46 inspector). Effort **M**. → backlog task #154-adjacent.
- **GSTR-1/3B portal export** is a best-effort JSON skeleton (hard-coded state fallback, env GSTIN) — final portal validation manual. Effort **M**.
- NABH (~80%) / NABL (~70%) are the *hospital's* external audits — code supports, cannot satisfy.

### Security & DPDP — **72% 🟢** (strong base, real gaps)

**Enforced in code:**
- JWT with boot-hard-failed strong secret + per-request DB re-validation + `jti` revocation — `index.js:29`, `TokenRevocationModel.js`.
- bcrypt cost-12 + password policy + reuse history + **account lockout** — `userModel.js:385-386`, `authRoutes.js:109` (`loginRateLimit`).
- Fine-grained **RBAC — 142 action keys enforced at ~917 route sites** — `config/permissions.js` + `requireAction`.
- **PHI redaction** in logs/audit (Aadhaar/PAN/phone → hashed) — `utils/phiRedactor.js:31-73`.

**Gaps that block ISO 27001 / DPDP / a clean VAPT:**
- ❌ **No field-level encryption at rest** for sensitive PHI (Aadhaar/phone/clinical) — relies entirely on infra/disk encryption (unverifiable from code). Effort **L**. *(ISO A.8.24, DPDP "reasonable safeguards")*
- ❌ **No DPDP data-principal rights** — no erasure/right-to-be-forgotten, data-portability, or consent-withdrawal endpoints. Effort **L**. *(DPDP §11–14)*
- ❌ **No DPDP data-processing consent artifact** — `ConsentForm` is clinical consent only; no processing-purpose consent + no consent gate on export. Effort **L**. *(DPDP §6/§7)*
- 🟡 helmet **CSP disabled** + no in-app HSTS/HTTPS enforcement (depends on TLS proxy). Effort **S/M**. *(ISO A.8.24 in-transit)*
- 🟡 Audit **hash-chain is detection-only** (plain SHA-256, no HMAC secret / external anchoring; per-UHID not tenant-global; soft-fails; read-then-write race). Weakens non-repudiation. Effort **M**.
- 🟡 PHI sometimes in URL/query params; 2FA present but not enforced as step-up on high-risk actions.
- ⚪ **ISO 27001 + VAPT are external deliverables** — commission separately (code readiness only shortens them).

### ABDM / FHIR interoperability — **~60% 🟡** (framework built 2026-07-13, `2e564241` — see ABDM-INTEGRATION.md)

**Framework now in place (feature-flagged OFF):** `config/abdm.js` + `models/Abdm/*` (care context, consent artefact, transaction) + Patient ABHA fields + `services/Abdm/*` (X25519→HKDF→AES-256-GCM HIE crypto, gateway client with session/signed-request/on-* helpers, FHIR R4 **document** bundle builder with Composition, link + data-flow services) + HMAC callback middleware + pre-JWT gateway callback routes (`/api/abdm/v0.5/*`) + admin ops (`/api/abdm/status|link-abha|care-contexts|fhir-preview`). Verified: crypto round-trip + full HIP→HIU encrypted data-flow round-trip; E2E 136/136 with the flag off. **Remaining for certification:** align crypto to the certified ABDM library version, swap HMAC→JWS if the milestone needs it, enrich the FHIR bundle (consume DischargeSummary + emit lab Observations/SNOMED), HFR/HPR onboarding, and run the NHA-sandbox M1–M4 milestone suite.

**Original assessment (pre-framework) — 18% 🔴:**

**What exists:** a real server-side FHIR bundle exporter — `services/Clinical/fhirExporter.js` — emitting Organization/Patient/Encounter/Condition/Observation/MedicationRequest/DiagnosticReport/Consent, with LOINC-coded vitals (`:134-163`) + ICD-10 conditions (`:120-125`), and a disclosure-audit log on release.

**What's missing (the 82%):**
- ❌ **Zero ABDM gateway integration** — no ABHA create/verify, consent-manager callbacks, HIP care-context link/share, or HIU fetch. No outbound HTTP client even in `package.json`. **M1/M2/M3 all blocked.** Effort **L** each.
- ❌ Patient **ABHA id field is missing** on `patientModel.js` (exporter reads `p.abhaId`, always empty) → breaks core linkage. Effort **S**.
- 🟡 **R5 `collection` bundle, no Composition** — ABDM requires **R4 `document`** led by a Composition; current output won't validate against the ABDM FHIR IG. Effort **M**.
- 🟡 SNOMED (notes) + LOINC (lab) captured in schemas but **never emitted**; ICD-10-PCS procedures never surfaced as FHIR `Procedure`. Effort **S–M**.
- ⚪ No NHA sandbox onboarding / HFR-HPR verification / milestone certification (external process) + no frontend ABHA/consent UI. Effort **L**.

---

## 3. Prioritised go-live roadmap (phased)

**Phase 0 — Sellable NOW (small/mid hospitals):** nothing blocking. Statutory + security base already strong. Ship with a privacy policy + India hosting + honest capability sheet.

**Phase 1 — First tenders (2–6 weeks, mostly non-code):**
1. Commission a **VAPT** (CERT-In empanelled) → fix findings → clean report.
2. **DPDP pack:** privacy policy, DPA template, breach-response runbook, confirm India-region hosting + DB/disk encryption.
3. Quick security hardening (code): enable **helmet CSP + HSTS**, move any **PHI out of URLs**, add **cache-control no-store** on PHI responses. *(Effort S — highest ROI.)*

**Phase 2 — Govt/PM-JAY + insurance unlock (1–3 months):**
4. **ABDM M1** (ABHA create/verify) — add `abhaId` to Patient + ABDM auth session + OTP flow + frontend ABHA UI. *(Our FHIR base helps.)*
5. **ABDM FHIR fixes** — R4 document+Composition, emit SNOMED/LOINC/PCS codes → passes ABDM IG validation.
6. **ABDM M2** (HIP link + consent-based share) → then **M3** (HIU fetch).
7. **DPDP rights endpoints** — data-export, erasure/retention, consent-withdrawal + a processing-consent record.

**Phase 3 — Enterprise / chains (3–6 months):**
8. **ISO 27001** ISMS (with field-level PHI encryption-at-rest, HMAC/anchored audit chain, formal policies) → certification audit.
9. Deepen **NABH/NABL support** (remaining backlog #130–176) as an accreditation-accelerator USP.

---

## 4. Engineering backlog extracted from the audit (the parts that ARE code-work)

| # | Task | Unblocks | Effort | Evidence anchor |
|---|---|---|:---:|---|
| C1 | Enable helmet CSP + HSTS; PHI out of URLs; no-store cache headers | VAPT / ISO A.8.24 | **S** | helmet `contentSecurityPolicy:false` |
| C2 | Field-level encryption-at-rest for Aadhaar/phone/clinical PHI | ISO 27001 / DPDP | **L** | no AES/CSFLE in models |
| C3 | DPDP data-principal rights: export-my-data, erasure/retention, consent-withdrawal | DPDP §11–14 | **L** | none found |
| C4 | DPDP processing-consent record + export consent-gate | DPDP §6/§7 | **M** | ConsentForm = clinical only |
| C5 | Harden audit chain: HMAC/anchor, tenant-global, atomic write | ISO / non-repudiation | **M** | SHA-256 detection-only |
| C6 | Add `abhaId`/`abhaAddress` to Patient + capture path | ABDM M1/M2 | **S** | patientModel has no abhaId |
| C7 | ABDM gateway client: auth session + ABHA create/verify | **ABDM M1** | **L** | no HTTP client / gateway code |
| C8 | FHIR R4 migration: `document` bundle + Composition | ABDM IG validation | **M** | R5 `collection`, no Composition |
| C9 | Emit SNOMED (Condition) + LOINC (DiagnosticReport) + PCS (Procedure) | ABDM terminology | **S–M** | codes stored, never emitted |
| C10 | HIP link + share-records (consent-manager + encrypted transport) | **ABDM M2** | **L** | none |
| C11 | HIU consent request + fetch | **ABDM M3** | **L** | none |
| C12 | Frontend ABHA/consent UI | ABDM M1–M3 | **L** | none |
| C13 | Auditor sequence-gap reconciliation report | IT-Rule-46 defence | **M** | gaps enforced but unexplained |
| C14 | GSTR-1/3B validated portal export | GST filing | **M** | best-effort skeleton |

*(Non-code, commission externally: VAPT, ISO 27001, ISO 9001, ABDM sandbox certification, DPDP legal pack, India hosting.)*

---

## 5. Bottom line for the owner

- **You can start selling now** to small/mid private hospitals — the statutory + security spine is real (83% / 72%), not vapourware.
- **Two things gate the big markets:** a **VAPT report** (weeks, cheap) opens most tenders; **ABDM integration** (the one real build, ~2–3 months) opens govt/PM-JAY/insurance.
- **NABH/NABL support is a differentiator** — most competitors' "NABH-ready" claims are shallow; ours is code-enforced and documented.
- **Don't chase CDSCO/ISO 13485** — a pure HIS is exempt.

_See the engineering backlog (§4) tracked as tasks; the accreditation-support backlog is in `NABH-NABL-COMPLIANCE-REVIEW.md`._
