# M4-lab-investigation — Cleanup Log

## Connections (dusre modules se joints)
- **2 parallel result stores:** `InvestigationOrder` (order pipeline: sample→result→verify, lab.order/collect/result-entry/verify/dispatch tokens) vs `LabTrend`+`LabReport` (manual entry, lab.records.* tokens) — sirf `admissionInvestigationsService` read-side me stitch karta hai.
- **Clinical:** Investigations tab + discharge keyInvestigationsText dono `GET /admission-investigations` se; range-aware narrative `utils/labNarrative.js` (FE) `/lab-records/trends` se.
- **Prints:** `lab-report` (NABL) + `diagnostic-report` (NABH) printables LabResultsEntry ke adapters se; PROVISIONAL/FINAL/AMENDED release-rules verify stamps se.
- **Billing:** order create/result/verify pe autoBilling hooks; PrescriptionService._createLabOrder doctor-Rx → order banata hai (OPD-embedded path NAHI banata — known gap).
- **Uploads:** LabReport.attachments → safeUpload → /uploads/lab-records (UI flag OFF: SHOW_OUTSIDE_UPLOAD).
- **ICD-10:** icd10 master (74,719) → Icd10Picker → DischargeSummary/OPD/IPD-IA → claimFormService diagnoses.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A | labRecordsController (6) + icd10Controller (2) | 8 raw `catch→500` → shared `sendErr` (12 intentional 400-catches jaanbujhkar untouched — wo client-fault-biased design hai) | ~6 | node -c + 7 endpoints 200 restart ke baad |
| A | investigationMasterService, labReportService | 2 unused requires (tpaService, mongoose) removed | 2 | node -c |
| B | pages/lab + Components/lab (FE) | Audit-clean — dead components 0 | 0 | scan |

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
