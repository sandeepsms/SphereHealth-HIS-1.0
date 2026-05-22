# R7bc — Deep cross-cutting audit (A1 + A2 + A3) — 67 findings

**Cycle**: R7bc (after R7bb closed all 224 user-role + permissions findings)
**Scope**: 3 high-value cross-cutting areas. 3 parallel deep agents.
**Result**: **67 findings** — 15 CRIT + 28 HIGH + 24 MED across patient lifecycle, pharmacy, and lab/radiology surfaces.

---

## Severity tally

| Area | CRIT | HIGH | MED | Total |
|---|---|---|---|---|
| **A1** Patient lifecycle E2E | 6 | 10 | 9 | 25 |
| **A2** Pharmacy workflow | 4 | 8 | 8 | 20 |
| **A3** Lab + Radiology + Imaging | 5 | 9 | 8 | 22 |
| **TOTAL** | **15** | **27** | **25** | **67** |

---

## Critical findings (must-fix — 15)

### A1 — Patient lifecycle E2E (cascade gaps + orphans)

1. **A1-CRIT-1** `DELETE /api/patients/:id` soft-deletes with **ZERO cascade** — open admissions stay Active, beds stay Occupied, DRAFT bills/advances/orders/MAR/consents/MLC all orphan. Bills + ledger ghost forever; bed never frees.
2. **A1-CRIT-2** `deleteAdmission` does **HARD DELETE** — every cross-collection ObjectId becomes dangling. 14+ collections affected. Aggregations silently return null.
3. **A1-CRIT-3** `cancelAdmission` doesn't cascade to DoctorOrders, MAR, NursingCarePlan, ConsentForms, BillingTriggers, DRAFT bills, MLC. In-flight triggers stay `pending` forever.
4. **A1-CRIT-4** `DELETE /doctor-orders/:id` uses `findByIdAndUpdate` — **bypasses state-machine pre-save guard AND never calls `onOrderCancelled`**. Bill keeps charge for cancelled work.
5. **A1-CRIT-5** `attendingDoctorId` schema/data mismatch persists — OPDService writes `Doctor._id` into a field declared `ref:"User"`. R7az fixed read path only; write path still broken.
6. **A1-CRIT-6** `patientAdvanceService.applyAdvanceToBill` ledger formula doesn't subtract `refundedAmount` — apply path can over-apply.

### A2 — Pharmacy workflow

7. **A2-CRIT-1** `recordVendorReturn` uses non-atomic load-modify-save — concurrent vendor returns race + clobber `vendorReturned` counter. Stock count drifts silently.
8. **A2-CRIT-2** `marController.recordAdministration` only invokes `onMARAdministration` on GIVEN. `onMARNonAdminister` exported (R7az) **but never called** — HELD/REFUSED/MISSED leave RESV-* triggers billed AND stock outside ward.
9. **A2-CRIT-3** **Schedule-H / H1 / X dispense unprotected** — walk-in can buy Alprazolam/Morphine with no Rx, no prescriber recorded. D&C Rules §65(9) violation.
10. **A2-CRIT-4** `stockRollup` + `closeDay` + low-stock alerts include **expired batches** — no `expiryDate >= today` filter. Dashboard "stock value" and day-close ledger include unsellable stock; low-stock alerts under-fire.

### A3 — Lab + Radiology + Imaging

11. **A3-CRIT-1** **All POSTs from `InvestigationOrders.jsx` lack `Authorization: Bearer` header** — create/collect/enter-results/verify/cancel/print all 401 in production after R7bb's soft-auth tightening. Primary lab-order screen completely broken.
12. **A3-CRIT-2** **Critical-value / panic-alert pipeline does not exist** — no panic detection, no doctor SMS/email/push, no acknowledgment loop, no HOD escalation. NABH AAC.6 gap; potential patient-safety event.
13. **A3-CRIT-3** **QC failure does not block result entry** — R7bb added LabQCLogModel with comment "enforced at order-verify endpoint in a later cycle". Never wired. NABH AAC.3 / ISO 15189 broken.
14. **A3-CRIT-4** **No SoD on lab verification** — same Lab Tech can enter AND verify. NABH POE.5 two-person sign-off for histopath/cytology/bone-marrow not enforced.
15. **A3-CRIT-5** **Sample-rejection workflow modelled but unreachable** — `REJECTED` enum + `rejectionReason` field exist; no endpoint sets them. NABH POE.3 broken.

---

## HIGH findings (27)

### A1 — Patient lifecycle
- **A1-HIGH-7** No active-admission uniqueness for bedless types (OPD/Daycare/Services) — patient can have 2 simultaneous admissions
- **A1-HIGH-8** `generateOPDAdmissionNumber` uses race-prone find-then-insert (R7ab migrated IPD but left OPD on legacy pattern)
- **A1-HIGH-9** OPD `visitNumber` unique index lacks `sparse:true`
- **A1-HIGH-10** `transferBed` doesn't re-stamp bill — historical bed-day rate stays attached
- **A1-HIGH-11** Doctor termination doesn't reassign open admissions — junior resident + `mustCosign:true` admission becomes unsignable
- **A1-HIGH-12** `issueGatePass` skips housekeeping — bed goes Available immediately with no CleaningTask (NABH IPC.6 gap)
- **A1-HIGH-13** `dischargePatient` overage detection ignores DRAFT bills — overage wildly overstated if discharge runs before final-bill consolidation
- **A1-HIGH-14** MRD `retentionReview` collides with BillingAudit TTL — most retention-due rows reaped by TTL before MRD sees them
- **A1-HIGH-15** PatientActivityLog hash chain breaks at every TTL boundary — chain-verifier can't distinguish tampered from TTL-reaped
- **A1-HIGH-16** State-machine guard only fires on pre-save; reactivate + DELETE bypass via findByIdAndUpdate

### A2 — Pharmacy
- **A2-HIGH-5** No Purchase Order model; `recordGRN` has random 4-digit suffix (collision-prone)
- **A2-HIGH-6** FEFO has no tie-breaker — 2 batches with identical expiry pick non-deterministically
- **A2-HIGH-7** `DrugModel.requiresRefrigeration` set by R7az but no code reads it — dead flag
- **A2-HIGH-8** `closeDay` doesn't break out cash/card/UPI/credit, doesn't check duplicate close, server-local time (not IST)
- **A2-HIGH-9** PharmacySale `paymentMode: "Mixed"` accepted but no split fields — GSTR-1 + day-close can't reconcile
- **A2-HIGH-10** `cancelSale` doesn't void MAR_RESERVATION triggers
- **A2-HIGH-11** `deleteDrug` doesn't check open indents or remaining batches
- **A2-HIGH-12** No reservation cleanup cron — discharged patient's reserved drugs sit as billed forever

### A3 — Lab + Radiology
- **A3-HIGH-6** Hardcoded actor strings poison audit (`"Lab Staff"`, `"Pathologist"`, `"Staff"`) — defeats accountability
- **A3-HIGH-7** No reference-range bands per age/sex; no delta check; `normalRange` is free-text String
- **A3-HIGH-8** TAT tracking absent; `tatHours` declared but never read; no SLA breach report
- **A3-HIGH-9** Microbiology multi-step (Day 0 → Day 5 antibiogram) can't be modelled — single `organism` + `sensitivity` String
- **A3-HIGH-10** No imaging worklist, prior-study viewer, DICOM/PACS, structured templates — Radiologist surface = stub
- **A3-HIGH-11** Order cancellation never refunds when patient already paid — money lost silently
- **A3-HIGH-12** Post-verification lock bypassable via `findByIdAndUpdate` — `markReportPrinted` + retest use the pattern
- **A3-HIGH-13** Order state-machine has skip-paths — `collectSamples` regresses IN_PROGRESS → SAMPLE_COLLECTED; `verifyResults` silently no-ops on mismatched IDs
- **A3-HIGH-14** Lab report print missing NABH-mandated fields — no hospital address, no NABH accreditation #, no MCI/MMC, no method, no actual verifier name (just labels)

---

## MED findings (25)

### A1 (9)
- A1-MED-17 `Bed.admission` + `currentAdmission` both refs to Admission — `bed.admission` is dead schema field
- A1-MED-18 `sequenceAudit` covers BILL/ADV/CN only — misses GP, IPD, OPD, INV, MLC, refund receipts
- A1-MED-19 `updateVisitCount` only increments, never decrements on cancellation
- A1-MED-20 Reactivate clears gatePass number without rolling back sequence — register has invisible gaps
- A1-MED-21 Reactivate doesn't un-finalize DischargeSummary — subsequent discharge can't write
- A1-MED-22 Package `tierUsed` doesn't auto-update on bed transfer — wrong tier billed
- A1-MED-23 `createAdvance` doesn't reject archived patients
- A1-MED-24 **No patient merge / unmerge endpoint** — duplicate UHIDs unfix-able
- A1-MED-25 Pre-R7aw BillingAudit rows still carry old 7y retainUntil — bloat survives

### A2 (8)
- A2-MED-13 GRN/FEFO IST boundary mismatch — 00:00–05:29 IST batch accepted by GRN, rejected by FEFO
- A2-MED-14 No expiry write-off endpoint — expired batches linger, no ITC reversal
- A2-MED-15 `returnItems` always restocks — no scrapped path
- A2-MED-16 No Schedule-X (narcotics) register — lumped with H/H1, no witness col
- A2-MED-17 No reorder push notification
- A2-MED-18 No physical-stocktake / cycle-count endpoint
- A2-MED-19 `releaseIndent` skips FEFO for null `drugId` items — stock drifts permanently
- A2-MED-20 No same-batch merge or amend endpoint — operator forced to lose traceability

### A3 (8)
- A3-MED-15 No sample barcode generator, no fasting flag, no container colour
- A3-MED-16 Panel pricing sum-of-components only; no flat-rate panel, no proration on partial cancel
- A3-MED-17 No cumulative report endpoint for longitudinal trends
- A3-MED-18 Lab Tech / Radiologist consoles are single-page stubs vs Pharmacist's multi-tab
- A3-MED-19 External lab integration is one-field stub — no expectedBackBy, no HL7/CSV import
- A3-MED-20 LabReport has no editLock; `reportUpdate` allows post-verify edits via raw `findByIdAndUpdate`
- A3-MED-21 `lab.cancel` gated to Doctor only — Lab Tech can't mark sample rejected
- A3-MED-22 No `equipmentId` on order item — can't join QC log to result

---

## Systemic patterns

### S1 — `findByIdAndUpdate` bypass (R7az's lesson, still violated)
A1-CRIT-4, A1-HIGH-16, A3-HIGH-12, A3-MED-20 — same bug class. State-machine guards + lock hooks + audit emits all live in `pre("save")`. Every `findByIdAndUpdate` is a backdoor. R7az fixed clinical models; lab + doctor-order DELETE + reactivate + investigation print still bypass.

### S2 — Cascade gaps on lifecycle terminal events
A1-CRIT-1/2/3, A1-HIGH-11/12, A2-HIGH-12, A3-HIGH-11 — when a "parent" entity (Patient / Admission / DoctorOrder / Sale) terminates, dependent entities (Bills, Orders, Triggers, Cleaning, Refunds) don't cascade.

### S3 — Hardcoded actor strings
A3-HIGH-6 — same anti-pattern R7bb killed in billing (S5 body actor forgery). Lab still has it on every result-entry, verify, cancel.

### S4 — TTL + audit-trail chain incompatibility
A1-HIGH-14, A1-HIGH-15, A1-MED-25 — append-only chains with per-row TTL break their own integrity guarantee.

### S5 — Critical-value / SLA / TAT tracking absent across modules
A3-CRIT-2, A3-HIGH-8 — no notification pipeline. NABH gap. Could be one new shared service (`criticalValueAlerter`) used by Lab + Vitals + Drug-interaction.

### S6 — Stock + financial reconciliation include expired/cancelled
A2-CRIT-4 — `stockRollup`, `closeDay`, `lowStock` alert all share the same flaw. One missing `expiryDate >= today` predicate.

### S7 — Race-prone find-then-insert + load-modify-save
A1-HIGH-8 (OPD admission counter), A2-CRIT-1 (vendor return), A1-CRIT-6 (advance CAS missing field). Same pattern fixed in R7ab for IPD/UHID/billNumber — incomplete coverage.

### S8 — Role surfaces are stubs (Radiologist, Lab Tech, Dietician, Physio)
A3-HIGH-10, A3-MED-18 — R7az reinstated permissions but pages don't exist. Same gap noted in R7ba D6-CRIT-1/2.

---

## Recommended attack order (R7bd)

If the user wants to fix:

1. **A3-CRIT-1** (frontend lab POSTs missing auth header) — **trivial 1-hour fix**, unblocks entire lab workflow
2. **A2-CRIT-2** (wire `onMARNonAdminister`) — 1-hour fix, prevents stock + bill drift
3. **A2-CRIT-1 + A1-CRIT-6** (atomic concurrency fixes) — 2-3 hours, prevents data corruption
4. **A2-CRIT-3 + A2-CRIT-4** (Schedule-H Rx gate + expired-batch filter) — 3 hours, legal + GST compliance
5. **A1-CRIT-1..5** (cascade gaps) — 1 day, requires careful cascade design for each parent entity
6. **A3-CRIT-2** (critical-value alert pipeline) — 1-2 days, needs new service + email/SMS infra
7. **A3-CRIT-3 + A3-CRIT-4 + A3-CRIT-5** (QC gate + SoD + sample-reject workflow) — 1 day
8. **Everything else** — multi-cycle

If proceeding to A4 (Print pipeline) + A5 (NABH compliance) + A6 (Reports) + A7 (State machines) + A8 (Performance) — recommend 1-2 audit cycles per area.

---

*Authored R7bc by Dr Sandeep + Claude. 3 parallel agents. 67 findings surfaced across patient lifecycle + pharmacy + lab. No fixes applied — audit only. Full per-agent transcripts preserved in chapter scrollback.*
