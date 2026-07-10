# M1-pharmacy — Cleanup Log

## Connections (dusre modules se joints)
- **Billing:** `services/Billing/autoBillingService.js` — hooks `onIndentReleased` / `onIndentReturned` / `onMARAdministration` / pharmacy-sale events → `BillingTrigger` (sourceType `MAR_RESERVATION`, pending-review me girta hai). IPD credit sales → `PatientBill` ledger; **discharge hard-block** jab tak pharmacy outstanding clear na ho.
- **HR/Middleware:** `credentialExpiryBlocker("PHARMACIST_REG")` → `models/HR/CredentialModel` (LICENCE + councilName ~ /pharmacy council|pci/). GRN/dispense/cancel/return/release sab is gate ke peeche. Seed: `scripts/seedPharmacistCredential.js`.
- **Patient:** indents admission-coupled (`admissionId` required, `requireHospitalMode`); IPD sale ko `admissionId` + `admissionNumber` dono chahiye.
- **Clinical/MAR:** MAR administration ↔ indent-reservation **2h dedup window** (autoBillingService L1325+) — double-charge guard.
- **GST:** `HSNMasterModel` ↔ `DrugModel` pre-save hook — HSN → gstRate FORCED canonical (drift impossible). Dispense me GSTR-1 fields (placeOfSupply, customerGstin).
- **Middleware:** `idempotencyGuard` on collect-credit / apply-advance (double-debit guard).
- **Permissions:** `pharmacy.grn/dispense/cancel/return/add-items/settings`, `indent.raise/read/fulfill/cancel/return`, `rx.read` (Doctor/Nurse scope-filtered via restrictToOwn*).
- **Prints:** `PharmacyBill` printable (slug via printables/index.js).
- **Mode:** `config/pharmacyMode.js` — standalone retail me indents/opdrx/ipdcredit tabs+routes 404.
- **Maker-checker:** self-cancel blocked (doosra pharmacist/Admin hi sale cancel kare).

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
