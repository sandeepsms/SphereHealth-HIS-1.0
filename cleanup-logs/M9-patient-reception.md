# M9-patient-reception — Cleanup Log

## Connections (dusre modules se joints)
- **Billing:** registration pending-dues + advance earmark; admission → cost estimate (PRE.4); payerScheme/insurer capture → claims.
- **ER/DC:** admission model ER intake fields + DC conversion; visits OPD/ER synthetic ids billing me.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A | BE Patient (9.5k) | OPDController: 1 raw catch → sendErr; baaki audit-clean | 1 | node -c + /api/patients 200 |
| B/C | FE reception+patient (18.5k) | Audit-clean — dead components 0 (recent arcs me heavily reworked) | 0 | scan |

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
