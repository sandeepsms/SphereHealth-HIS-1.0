# M3-billing — Cleanup Log

## Connections (dusre modules se joints)
- **Sab clinical modules → autoBillingService** (5k LOC): order/pharmacy/MAR/indent hooks → BillingTrigger (pending-review) → bill lines. Pharmacy 2h MAR-dedup yahin.
- **Money primitives:** `utils/money.js` (toNum/decimalToNumber, Decimal128) + `utils/counter.js` (`fyStartYear()` Apr–Mar IST; series BILL-YY-N/ADV/CN/REC/DCR/EST) — **RULE 3: kabhi cleanup me nahi chhedna.**
- **Patient/Reception:** registration pending-dues surface; advance earmark enforce (409 ADVANCE_EARMARK_MISMATCH); discharge gate saare open bills + pharmacy outstanding.
- **Tax/Accounts:** GST monthly snapshots, CN §34 pairing, REC serials, round-off; cashier sessions billing.write.
- **TPA/Claims:** tpaPreAuth fields + query loop billingController me; claimFormService bills→Part-B buckets; insurerFormService PDF overlay.
- **Statutory gates:** discount cap (BILLING_DISCOUNT_CAP_PCT), room-rent GST (ROOM_RENT_GST_THRESHOLD), zero-payment cancel → CreditNote, idempotencyGuard money POSTs pe.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A | models/Billing/* + PatientBillModel/* + money/counter utils (2.7k) | Audit-clean — dup helpers 0, unused requires 0, dead exports 0. Per-file `mongoose`/`Dec` requires = normal Node pattern. Money utils untouched (Rule 3). | 0 | scans |
| B | billingController (7) + insurerFormTemplateController (5) | 12 raw `catch→500` → naya **shared `utils/sendErr.js`** (ValidationError/CastError→400, 11000→409, e.status passthrough — ab "Bill not found" 404 degi, 500 nahi) | ~4 net | node -c ×3 + billing/uhid/UH01, sequence-audit, insurer-forms, insurers sab 200 restart ke baad |
| B | autoBillingService + billingService (7.8k) | Audit-clean — services res-handle nahi karte, unused requires 0 | 0 | scans |
| C | pages/billing/* (3.6k FE) | Audit-clean — dead components 0 | 0 | scan |

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
