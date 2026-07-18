# M6-clinical — Cleanup Log

## Connections (dusre modules se joints)
- **Patient-file aggregation hub:** patientFileController `/patient-file/:uhid/complete` — SAB modules ka data ek receipt me (IA, notes, MAR, vitals, labs via admissionInvestigationsService, bills) → CompleteIPDFile print themes.
- **Billing:** MAR administration → autoBilling onMARAdministration (PHARMACY category + 2h indent-dedup); discharge summary → claim diagnoses (icdCode).
- **Lab:** admissionInvestigationsService yahan hai (M4 me covered); DischargeSummaryModel.icdCode → claimFormService.
- **Prints:** discharge-summary, consent-form, medical-certificate, ipd-file printables in module ke data se.
- **Auth:** twoFactorController Clinical me hai (2FA); safetyController break-glass = patient.export token.
- **HR:** credentialExpiryBlocker NMC_REG discharge-summary sign flows pe.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A | models/Clinical/* minus lab (3.9k) | Audit-clean — dup helpers 0, unused requires 0 | 0 | scans |
| B | 7 controllers (diabeticChart 8, icuBundle 4, medRecon 5, patientFile 7, patientHistory 3, safety 5, twoFactor 2) | 34 raw `catch→500` → shared `sendErr` | ~27 | node -c ×8 + 6 GET endpoints 200 (safety/2fa POST-only — syntax check) |
| B | marController | unused `roleCan` require removed | 1 | node -c |
| C | IPDInitialAssessmentPage.jsx | dead locals removed: Grid3 + Grid4 components (unrendered) + FREQS const (unused) | 7 | vite build green |
| C | pages/clinical baaki | `import React` 6 files me technically unused (naya JSX transform) — **chhoda**: poore codebase ka consistent house-style hai, churn worth nahi | 0 | — |

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
