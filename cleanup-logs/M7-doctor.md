# M7-doctor — Cleanup Log

## Connections (dusre modules se joints)
- **Lab:** PrescriptionService._createLabOrder → InvestigationOrder (doctor Rx investigations[] se worklist order).
- **Pharmacy:** OPD Rx tab doctor prescriptions padhta hai; prescriber reg no Sch-H register me.
- **Clinical:** DoctorPatientPanel ab SHARED PatientPanelTabs use karta hai (R7gn) — isi wajah se purane local tabs dead the.
- **Prints:** OPDPrescription printable; buildDoctorNoteCardHtml per-type card builders (Narrative theme ke saath shared).
- **ICD:** OPD Assessment + IPD IA icd10Code/Description → discharge/claims tak.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A | BE Doctor (7.7k) | doctorController: 4 raw `catch→500` → shared sendErr; baaki audit-clean (unused requires 0) | ~3 | node -c + /api/doctors 200 |
| B/C | DoctorPatientPanel.jsx | **533 dead lines removed:** ClinicalNotesTab (315) + NursingRecordsTab (218) — R7gn me shared PatientPanelTabs ne replace kiye the, purane local versions reh gaye the; + unke 4 orphan helpers (NOTE_COLOR, DR_MODULES_DP, DpInitialDetails, NURS_NOTE_STYLE_DP = 72 lines) | 605 | vite build green + /doctor-patient-panel?uhid=UH01 browser render (JaiBhagwan data, 0 console errors) |
| B/C | DoctorNotesPage.jsx | dead SBARBox component (13 lines) removed | 13 | build + /doctor-notes render green |

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
