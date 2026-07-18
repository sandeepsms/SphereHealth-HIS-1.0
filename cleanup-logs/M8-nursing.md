# M8-nursing — Cleanup Log

## Connections (dusre modules se joints)
- **Clinical shared:** NursePatientPanel bhi (Doctor panel jaise) R7gn se SHARED `Components/clinical/PatientPanelTabs.jsx` use karta hai — purane local tabs isliye dead the.
- **MAR/Vitals:** nursing pages MAR write (mar.write), vitals (vitals.write), handovers/care-plans Clinical models me.
- **Pharmacy:** nurse indent.raise → pharmacy live queue.
- **Prints:** nursing IA shared renderer (buildInitialAssessmentHtml), vital sheets.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A/B | NursePatientPanel.jsx | **1,095 dead lines removed:** superseded local NursingNotesTab + DoctorNotesTab + VCard + NOTE_CFG + NoteModuleBody (1,003) + 5 orphan helpers NOTE_STYLE_TL/TL_MODULES/DR_NOTE_STYLE/DR_MODULES/DrInitialDetails (92) — sab R7gn shared-tabs migration ke leftovers | 1,095 | vite build green ×2 + /nurse-patient-panel?uhid=UH01 render (patient data, 0 errors) |
| A | NurseInitialAssessmentPage.jsx | dead YesNo component (22 lines) | 22 | build green |

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
