# M5-tpa-claims — Cleanup Log

## Connections (dusre modules se joints)
- **Billing:** tpaQueryLog + preauth fields PatientBill pe; claimFormService (bills→Part-B buckets) + insurerFormService (PDF overlay) services/Billing me rehte hain par yeh module ke hain; tpa-mis reports.
- **Patient:** payerScheme + schemeIds + insurerCode registration se; TPA ref patientModel pe.
- **Prints:** claim-part-a/b, pre-auth, cghs-mrc, esic-claim, claim-docket printables — sab `GET /billing/:billId/claim-data` se.
- **Config:** config/insurers.js registry (28 insurers) — single edit point.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A | BE tpa/* + claim/insurer services + config (2.2k) | Audit-clean — raw 500-catches 0, unused requires 0 | 0 | scans |
| B | FE TPA pages + 6 claim printables | Audit-clean — dead components 0 | 0 | scan |

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
