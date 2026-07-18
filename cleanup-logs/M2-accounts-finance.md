# M2-accounts-finance — Cleanup Log

## Connections (dusre modules se joints)
- **Billing:** day-book/today-revenue/gst-monthly `PatientBill` payments + `CreditNote` + PharmacySale se aggregate; `CashierSession` billing.write se open/close (close = `closingCash`+`varianceNote`, variance>±0.5 bina note 400); clear-close = billing.refund.
- **Pharmacy:** pharmacy revenue day-book/today-revenue me alag bucket (`pharmacyRevenue`); pharmacy-revenue-trend PharmacySale se.
- **Tax:** GSTR-1/3B snapshots `models/Tax/GstReturnSnapshotModel` (preview→generate→finalize→mark-filed ARN); TDS `TdsCertificateModel`. Tokens: tax.returns.read/write, tax.tds.* (Admin+Accountant).
- **Permissions:** reports.financial (Admin/Accountant), reports.audit (sequence-audit).
- **FE:** AccountsConsole 7 tabs (daybook/revenue/gst/outstanding/bills/refunds/shift) + TaxReturnsPage + TdsCertificatesPage.

## Changes
| Part | File | Kya tha → kya hua | LOC saved | Verified |
|---|---|---|---|---|
| A | controllers/Reports/dashboardsController.js | 3 unused requires (mongoose, DrugBatch, Drug) removed | 3 | node -c + day-book/today-revenue/gst-monthly/pharmacy-revenue-trend sab 200 |
| A | baaki BE (3.85k LOC: Reports+Tax+cashier) | Audit-clean — dup helpers 0, raw 500-catches 0 | 0 | scans |
| B | pages/accounts/* (1.8k LOC) | Audit-clean — dead components 0 (recent rebuild, task #5 arc) | 0 | dead-code scan |

## Security / NABH-NABL notes

## Left as-is (jaanbujhkar, wajah ke saath)
