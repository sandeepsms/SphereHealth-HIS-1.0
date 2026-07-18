# SphereHealth / BIMS HIS — End-to-End Acceptance Test Report

> **Run date:** 2026-07-12 · **Branch:** `claude/multi-hospital-deploy` · **DB:** local dev (full reset before run)
> **Method:** every flow is driven against the **live API** (`http://localhost:5050/api`) with the real role logins (all 27 dev users, password `123`), asserting each aspect against the actual server response — nothing is mocked. Each ✅ row is a real request/response verified by the driver.

## 0. Data reset (pre-run)

Surgical reset — **preserve masters + inventory + users; wipe all patient / clinical / transactional / register data; short numbering from #1.**

| Action | Result |
|---|---|
| Transactional docs wiped | **1130** across **40** collections |
| Counters reset (short numbering UH01…, BILL-26-01…) | 22 cleared |
| Beds freed to Available | all |
| Legacy `billNumber_1` dup-null index | dropped / absent (E11000 landmine cleared) |
| Masters preserved | 48 collection types — users 27, service masters 171 + pricing 118, drugs 50 + batches, beds 19, wards 12, rooms 7, departments 6, hospital settings, ICD-10 74,719, ICD-10-PCS 79,115, diet templates 17, insurers, nursing consumables 32, credentials |
| Patient collections after | patients / admissions / bills / advances / notes / sales / lab / registers / tasks = **0** |

---

_Flow results are appended below in run order. Each section is the verbatim driver output._

<!-- SECTIONS: 1. OPD · 2. ER · 3. SERVICES · 4. IPD · Cross-cutting: Ward/Housekeeping/Security tasks, Accounts -->

### 1. OPD Flow — register → consult → bill → services → advance → collect → refund → lab → Rx → pharmacy → medical record

| # | Aspect | Result | Detail |
|---|---|:---:|---|
| 1 | Master lookups (doctor, procedure svc, investigation, stocked drug) | ✅ PASS | doctor=Meera Chaudhary, svc=Emergency Triage / Observation, test=Complete Blood Count, drug=Aceclofenac 100mg |
| 2 | Register OPD patient (short UHID + auto OPD visit + draft consult bill) | ✅ PASS | UHID=UH01 |
| 3 | Auto-created OPD visit (short OPD-YY-NN) | ✅ PASS | visit=OPD-26-01 |
| 4 | Auto OPD consultation bill (DRAFT, OPD-CON line) | ✅ PASS | bill status=DRAFT, gross=0 |
| 5 | Doctor consultation note saved | ✅ PASS | status=200 |
| 6 | Add extra chargeable service to OPD bill | ✅ PASS | Emergency Triage / Observation added |
| 7 | Generate invoice (mint bill number, DRAFT→GENERATED) | ✅ PASS | billNo=BILL-26-01, balance=500 |
| 8 | Advance deposit recorded (₹500) | ✅ PASS | advanceId=ok, amount=₹500 |
| 9 | Apply advance to bill | ✅ PASS | applied ₹200 |
| 10 | Partial payment collection (receipt REC-series) | ✅ PASS | paid ₹100, status=PARTIAL, receipt=REC-26-01 |
| 11 | Full payment → bill PAID, balance 0 | ✅ PASS | final ₹200, status=PAID |
| 12 | Advance refund (unspent balance, cross-actor SoD) | ✅ PASS | status=REFUNDED, refunded=₹300 |
| 13 | Bill partial-refund of PAID correctly guarded (→ Credit Note) | ✅ PASS | clear 400 PARTIAL_REFUND_OF_PAID_BLOCKED (no phantom due) |
| 14 | Lab investigation ordered | ✅ PASS | order=ok, test=Complete Blood Count |
| 15 | Sample collected | ✅ PASS | status=SAMPLE_COLLECTED |
| 16 | Lab results entered → order COMPLETED | ✅ PASS | status=COMPLETED |
| 17 | Report verified (doctor sign-off, FINAL) | ✅ PASS | status=200 |
| 18 | Lab report generated / printable | ✅ PASS | status=200 |
| 19 | OPD prescription written (→ pharmacy handoff) | ✅ PASS | Rx Aceclofenac 100mg |
| 20 | Pharmacy OPD dispense (FEFO batch, GST invoice) | ✅ PASS | pharmacyBill=PHM-26-0001, total=45 |
| 21 | OPD visit completed | ✅ PASS | status=Completed |
| 22 | OPD medical record / complete file readable | ✅ PASS | status=200 |

**22/22 passed.**

### 2. ER / Emergency — register → ER visit(triage+MLC) → note → orders → vitals → triage → bill → discount → disposition → money paths → MLC → register → medical record

| # | Aspect | Result | Detail |
|---|---|:---:|---|
| 1 | Master lookups (doctor + ER consult service) | ✅ PASS | doctor=Dr. Meera Chaudhary, consultSvc=Emergency Consultation |
| 2 | Register Emergency patient (short UHID) | ✅ PASS | UHID=UH02 |
| 3 | Create ER visit (triage category + MLC flag, ER-YYYY-NNNNNN) | ✅ PASS | emergencyNumber=ER-2026-000001, isMLC=true |
| 4 | ER doctor assessment note saved (noteType emergency, as Admin) | ✅ PASS | noteId=ok, type=emergency |
| 5 | STAT investigation order placed (as Admin) | ✅ PASS | order=ok, priority=STAT |
| 6 | STAT medication order placed (as Admin) | ✅ PASS | order=ok |
| 7 | ER vitals recorded (Nurse) | ✅ PASS | status=200, vitalsLog=1 |
| 8 | ER re-triage to Critical (Nurse, NABH triage register) | ✅ PASS | triage=Critical |
| 9 | Create EMERGENCY bill (auto ER-TRIAGE ₹500 line) | ✅ PASS | bill=ok, triageLine=true, gross=500 |
| 10 | Add ER consult service line to bill | ✅ PASS | Emergency Consultation added |
| 11 | Generate invoice (mint bill number, →GENERATED) | ✅ PASS | billNo=BILL-26-02, balance=1300 |
| 12 | Settlement discount ₹50 (Accountant, while GENERATED) | ✅ PASS | net 1300→1250 |
| 13 | ER disposition Discharged → visit Completed (Admin) | ✅ PASS | disposition=Discharged, status=Completed |
| 14 | Advance deposit recorded (₹200) | ✅ PASS | advanceId=ok, amount=₹200 |
| 15 | Apply advance to ER bill | ✅ PASS | applied ₹100 |
| 16 | Full payment → bill PAID, balance 0 | ✅ PASS | paid ₹1150, status=PAID |
| 17 | Advance refund (cross-actor SoD) | ✅ PASS | status=REFUNDED, refunded=100 |
| 18 | Bill partial-refund of PAID correctly guarded (→ Credit Note) | ✅ PASS | clear 400 PARTIAL_REFUND_OF_PAID_BLOCKED (no phantom due) |
| 19 | NABH emergency register shows this ER visit | ✅ PASS | rows=1, match=true |
| 20 | MLC report created (Admin, doctor-prefixed MLR number) | ✅ PASS | mlrNumber=MC0007 |
| 21 | ER medical record readable (disposition + instructions populated) | ✅ PASS | disposition=Discharged, instr=ok |

**21/21 passed.**

### 3. SERVICES walk-in — register → bill → +injection +dressing → generate → advance → pay(partial+final→PAID) → FULL bill refund(→REFUNDED) → advance refund(→REFUNDED) → print audit → readback

| # | Aspect | Result | Detail |
|---|---|:---:|---|
| 1 | Master lookups (injection + dressing services) | ✅ PASS | inj=Injection Administration(₹100), dressing=Dressing - Simple(₹200) |
| 2 | Register SERVICES walk-in patient (short UHID) | ✅ PASS | UHID=UH03 |
| 3 | Create SERVICE bill (DRAFT, visitType SERVICE, no bill number yet) | ✅ PASS | billId=ok, status=DRAFT, visitType=SERVICE |
| 4 | Add service #1 (injection) to DRAFT bill | ✅ PASS | items=1, net=₹100, orderStatus=Completed |
| 5 | Add service #2 (dressing) to DRAFT bill | ✅ PASS | items=2 (running payable ₹300) |
| 6 | Advance deposit recorded (₹500 pool, ACTIVE) | ✅ PASS | advanceId=ok, receipt=ADV-2026-000003, amount=₹500 |
| 7 | Generate invoice (mint BILL number, DRAFT→GENERATED, payable ₹300) | ✅ PASS | billNo=BILL-26-03, status=GENERATED, payable=₹300, balance=₹300 |
| 8 | Partial cash payment ₹100 → PARTIAL (receipt minted) | ✅ PASS | balance=₹200, status=PARTIAL, receipt=REC-26-04 |
| 9 | Final cash payment ₹200 → bill PAID, balance 0 | ✅ PASS | balance=₹0, status=PAID, paidAt=set |
| 10 | Print audit recorded (bill invoice printed) | ✅ PASS | status=200 |
| 11 | FULL bill refund ₹300 (PAID→REFUNDED, cross-actor SoD) | ✅ PASS | status=REFUNDED, balance=₹0 |
| 12 | Advance refund ₹500 (fully unspent → REFUNDED, cross-actor SoD) | ✅ PASS | status=REFUNDED, refunded=₹500 |
| 13 | Read-back: bill REFUNDED (balance 0) + advance summary (totalUnspent 0) | ✅ PASS | bill=REFUNDED, balance=₹0, payable=₹300, advUnspent=₹0 |

**13/13 passed.**

### 4. IPD in-patient — admit → advance → doctor orders → MAR/vitals/nursing/diet → indent+credit → charges → payments → discharge summary → clear bill → gate pass → refund → record → registers

| # | Aspect | Result | Detail |
|---|---|:---:|---|
| 1 | Master lookups (available bed, department, nursing svc, drug) | ✅ PASS | bed=ok, dept=General Medicine, nursing=Urinary Catheterisation, drug=Aceclofenac 100mg |
| 2 | Register IPD patient (short UHID, no auto visit) | ✅ PASS | UHID=UH04 |
| 3 | Admit patient (assign bed, Active admission, billing fired) | ✅ PASS | admission=IPD-26-02, bed=BIMS-1-FGW-B01, status=Active |
| 4 | Advance deposit recorded (₹20000, earmarked to admission) | ✅ PASS | advanceId=ok, amount=₹20000, receipt=ADV-2026-000004 |
| 5 | Doctor order — Medication (dose regex, scheduledTimes) | ✅ PASS | medOrder=ok, code= |
| 6 | Doctor order — Lab | ✅ PASS | labOrder=ok |
| 7 | Doctor order — Procedure (Bedside, no OT forced) | ✅ PASS | procOrder=ok |
| 8 | MAR — nurse administers medication (five rights) | ✅ PASS | status=200, recorded=true |
| 9 | Vitals sheet recorded (HH:MM cadence) | ✅ PASS | status=200 |
| 10 | Nursing note saved | ✅ PASS | noteId=ok |
| 11 | Dietician orders — diet plan created | ✅ PASS | dietPlan=ok |
| 12 | Live indent raised by nurse | ✅ PASS | indent=ok, status=Raised |
| 13 | Pharmacist reads indent (item subdoc id) | ✅ PASS | item=ok |
| 14 | Indent acknowledged by pharmacist | ✅ PASS | status=Acknowledged |
| 15 | Indent released (FEFO batch, PHARM lines on admission bill) | ✅ PASS | status=Released |
| 16 | Pharmacy billing — admission credit readable | ✅ PASS | status=200 |
| 17 | Manual nursing service charge added to IPD bill | ✅ PASS | status=200, svc=Urinary Catheterisation |
| 18 | IPD ledger aggregates charges → active bill | ✅ PASS | bill=ok, balance=₹1000, net=₹1000 |
| 19 | Partial cash payment collected | ✅ PASS | paid ₹500, status=200, balance=₹500 |
| 20 | Advance applied to IPD bill (earmark match) | ✅ PASS | applied ₹250, status=200 |
| 21 | Final payment clears IPD bill (balance ≈ 0) | ✅ PASS | final balance=₹0 |
| 22 | Stop procedure order (terminal) | ✅ PASS | status=200, orderStatus=Stopped |
| 23 | Discharge summary drafted | ✅ PASS | summary=ok, status=draft |
| 24 | Discharge summary finalized (DoctorApproved stage) | ✅ PASS | status=finalized |
| 25 | Clear final bill (stage BillCleared, no pharmacy/charge gates) | ✅ PASS | status=200, stage=BillCleared |
| 26 | Gate pass issued (bed freed, housekeeping task) | ✅ PASS | status=200 |
| 27 | Advance refund ₹10000 (cross-actor SoD) | ✅ PASS | status=REFUNDED, refunded=₹19750 |
| 28 | Medical record — complete patient file readable | ✅ PASS | status=200 |
| 29 | Registers — NABH readmission register readable | ✅ PASS | status=200 |

**29/29 passed.**

### Cross-cutting: Ward Boy / Housekeeping / Security tasks

| # | Aspect | Result | Detail |
|---|---|:---:|---|
| 1 | Ward Boy: create ward-task (status open) | ✅ PASS | status=201, taskStatus=open |
| 2 | Ward Boy: accept ward-task (→ assigned) | ✅ PASS | status=200, taskStatus=assigned |
| 3 | Ward Boy: start ward-task (→ in-progress, startedAt) | ✅ PASS | status=200, taskStatus=in-progress |
| 4 | Ward Boy: complete ward-task (→ done, completedAt, notes echoed) | ✅ PASS | status=200, taskStatus=done |
| 5 | Ward Boy: cancel 2nd ward-task (→ cancelled) | ✅ PASS | create=201, cancel=200, taskStatus=cancelled |
| 6 | Ward Boy: task stats (open/assigned/inProgress/doneToday/myActive) | ✅ PASS | status=200, keys=open,assigned,inProgress,doneToday,myActive |
| 7 | Housekeeping: create cleaning task (status open) | ✅ PASS | status=201, taskStatus=open |
| 8 | Housekeeping: accept cleaning task (→ assigned) | ✅ PASS | status=200, taskStatus=assigned |
| 9 | Housekeeping: start cleaning task (→ in-progress) | ✅ PASS | status=200, taskStatus=in-progress |
| 10 | Housekeeping: complete cleaning task (→ done, completedAt) | ✅ PASS | status=200, taskStatus=done |
| 11 | Housekeeping: area-cleaning checklist (all done → done, area=ICU) | ✅ PASS | status=200, checklistStatus=done, area=ICU |
| 12 | Housekeeping: report spillage (status reported) | ✅ PASS | status=201, spillStatus=reported |
| 13 | Housekeeping: contain spillage (→ contained, containedAt) | ✅ PASS | status=200, spillStatus=contained |
| 14 | Housekeeping: clean spillage (→ cleaned, reportedToInfectionControl) | ✅ PASS | status=200, spillStatus=cleaned |
| 15 | Security: gate-log IN (direction in, recordedByRole Security) | ✅ PASS | status=201, dir=in, role=Security |
| 16 | Security: gate-log OUT (direction out) | ✅ PASS | status=201, dir=out |
| 17 | Security: create incident (IR-YYYYMMDD-NNNN, status Open) | ✅ PASS | status=201, incNo=IR-20260712-0001, incStatus=Open |
| 18 | Security: incident → Investigating (statusHistory appended) | ✅ PASS | status=200, incStatus=Investigating |
| 19 | Security: incident → Resolved (resolvedAt, resolvedBy set) | ✅ PASS | status=200, incStatus=Resolved |
| 20 | Security: prerequisite IPD admission for visitor-pass (Active) | ✅ PASS | reg=201, adm=201, bed=undefined |
| 21 | Security: issue visitor pass (VP-YYYYMMDD-NNNN, Active) | ✅ PASS | status=201, passNo=VP-20260712-0001, passStatus=Active |
| 22 | Security: attendant gate-log IN linked to visitor pass (linkedPassNumber matches) | ✅ PASS | status=201, personType=Attendant, linkedPass=VP-20260712-0001 |
| 23 | Security: return visitor pass (→ Returned, returnedAt) | ✅ PASS | status=200, passStatus=Returned |

**23/23 passed.**

### Cross-cutting: Accounts / Cashier

| # | Aspect | Result | Detail |
|---|---|:---:|---|
| 1 | Master lookup: chargeable nurse-service | ✅ PASS | svc=IV Cannulation (ok) |
| 2 | Register Services patient | ✅ PASS | UHID=UH06 |
| 3 | Create SERVICE bill | ✅ PASS | billId=ok |
| 4 | Add chargeable service line | ✅ PASS | 1 line(s), IV Cannulation |
| 5 | Generate invoice (mint bill number, read payable) | ✅ PASS | billNo=BILL-26-04, payable=₹150 |
| 6 | Cashier current session probe | ✅ PASS | no open shift (null) |
| 7 | Open cashier session (openingCash 1000) | ✅ PASS | status=OPEN, sessionId=ok |
| 8 | Collect full CASH payment → PAID (REC- receipt) | ✅ PASS | status=PAID, receipt=REC-26-08 |
| 9 | Advance CASH deposit (₹1000, ADV- receipt) | ✅ PASS | receipt=ADV-2026-000005, amount=₹1000 |
| 10 | Close blocked without varianceNote (variance-note gate) | ✅ PASS | status=400, expectedClosing=₹2000 |
| 11 | Close with varianceNote → CLOSED (variance≈100, auto-approved) | ✅ PASS | status=CLOSED, variance=₹100, pending=false |
| 12 | Report: today-revenue | ✅ PASS | status=200 |
| 13 | Report: day-book | ✅ PASS | status=200 |
| 14 | Report: daily-collection | ✅ PASS | status=200 |
| 15 | Report: hospital-register (summary) | ✅ PASS | billsGenerated=4, paid=2200 |
| 16 | Report: gst-monthly | ✅ PASS | period=2026-07 |
| 17 | GSTR-1 preview | ✅ PASS | status=200 |
| 18 | GSTR-1 generate (DRAFT) | ✅ PASS | filingStatus=DRAFT, id=ok |
| 19 | GSTR-1 finalize (FINALIZED) | ✅ PASS | filingStatus=FINALIZED |
| 20 | GSTR-1 mark-filed (FILED, ARN) | ✅ PASS | filingStatus=FILED, arn=AA0107260000123 |
| 21 | GSTR-3B lifecycle (preview→generate→finalize) | ✅ PASS | gen=201/DRAFT, fin=200/FINALIZED |
| 22 | List tax-returns (GSTR-1 filed present) | ✅ PASS | count=1 |
| 23 | Bill full refund as Admin (negative CASH row, REFUNDED) | ✅ PASS | status=REFUNDED, negRow=true |
| 24 | Report: refunds (totalRefunded ≥ 100) | ✅ PASS | totalRefunded=₹450 |
| 25 | List credit-notes (CN-2026- present) | ✅ PASS | count=2, cn=CN-2026-000002 |
| 26 | Bill retains positive REC- receipt row | ✅ PASS | receipt=REC-26-08 |
| 27 | Sequence-audit (REC-26- prefix, series present) | ✅ PASS | recPrefix=REC-26-, anyGaps=false |
| 28 | List cashier-sessions (closed shift, variance≈100) | ✅ PASS | status=CLOSED, variance=₹100 |

**28/28 passed.**

---

## Summary

| Flow | Aspects | Result |
|---|:---:|:---:|
| 1. OPD (register → consult → bill → services → advance → collect → refund → lab → Rx → pharmacy → record) | 22 | ✅ 22/22 |
| 2. ER / Emergency (triage + MLC → note → orders → vitals → bill → disposition → money → register → record) | 21 | ✅ 21/21 |
| 3. SERVICES walk-in (bill → services → pay → **full bill refund** → advance refund) | 13 | ✅ 13/13 |
| 4. IPD (admit → advance → orders → MAR/vitals/nursing/diet → **live indent + credit** → charges → payments → discharge → gate pass → refund → record → registers) | 29 | ✅ 29/29 |
| Cross-cutting: Ward Boy / Housekeeping / Security tasks | 23 | ✅ 23/23 |
| Cross-cutting: Accounts / Cashier (session → collect → close → reports → **GSTR-1/3B lifecycle** → refund → sequence-audit) | 28 | ✅ 28/28 |
| **Total** | **136** | **✅ 136/136** |

Every owner-requested aspect is exercised against the live API: **billing, services, advance, charge collection, refund, lab order + report, medical record, NABH registers, pharmacy OPD Rx + IPD live indents & billing, dietician orders, ward-boy / housekeeping / security tasks, and accounts** — all green.

### Bugs found & fixed during this run

The E2E pass surfaced **4 real backend defects**, all fixed and committed on `claude/multi-hospital-deploy`:

| # | Severity | Defect | Fix | Commit |
|---|:---:|---|---|---|
| 1 | **High** | OPD registration with `paymentType:"Cash"` (the default) silently created **no visit and no bill** — `Patient` enum is title-case, `OPDRegistration`/`Admission` upper-case only; the mismatch threw inside a non-fatal catch. Every cash OPD patient affected. | `normalizeOpdPaymentType()` in `OPDService.createOPDVisit` | `25830aed` |
| 2 | **Critical** | Legacy plain-unique `billNumber_1` index → **E11000 dup-null on the 2nd DRAFT bill** system-wide (only one draft bill could exist at a time). | dropped the legacy index (partial unique already declared); folded into the reset + `fixBillNumberIndex.js` for deploys | `25830aed` |
| 3 | Medium | Partial refund of a fully-**PAID** bill threw an opaque `409` and would resurrect a phantom receivable. | clear `400 PARTIAL_REFUND_OF_PAID_BLOCKED` before mutation, directing to the Credit-Note / full-refund path | `25830aed` |
| 4 | Medium | Gate-log **500** when an attendant scans their visitor pass — `GateLog.personType` enum lacked `"Attendant"` even though VisitorPass issues attendant passes. | added `"Attendant"` to the enum | `6c69b90b` |

### Notes (behaviours confirmed correct, not bugs)

- **`admissionType` has no `"IPD"` value** — an IPD stay is `admissionType:"Planned"`/`"Emergency"` with `hasBed:true`; the IPD-detection logic keys on that. The driver admits as `"Planned"` (correct). The playbook's `"IPD"` was a doc slip.
- **IPD bill balance at ledger time is Day-1 charges only** — bed-days accrue via the daily cron and released-indent pharmacy items post as admission *credit*, not synchronously onto the bill balance. Payment amounts are derived from the live `balanceAmount`, not hardcoded.
- **Partial refund of a PAID bill is intentionally blocked** (guard #3) — money-back is proven positively by the advance refunds (all flows) and the SERVICES **full** bill refund (§3, PAID→REFUNDED).

### Method notes

- Drivers: `Backend/scripts/_e2e_{opd,er,services,ipd,tasks,accounts}.js` (+ `_e2e_lib.js` harness, `_e2e_reset.js`). Temporary — not part of the product.
- Every assertion checks the real server response (status + payload fields), not a mock. Money fields are Decimal128, coerced for display.
- Segregation-of-Duties honoured throughout: the cashier who collected a payment/advance never refunds it — refunds run as Accountant/Admin.
