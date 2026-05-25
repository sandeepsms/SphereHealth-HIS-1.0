# Pharmacy Standalone Deployment Guide

**R7cs** — Deploying the Pharmacy module as a retail chemist-shop application,
detached from the full HIS.

## When to use this mode

- You're selling the Pharmacy module to a retail chemist shop or pharmacy chain.
- The deployment has no doctors / nurses / patient admissions / OPD visits.
- All sales are counter sales (walk-in customers), not linked to a hospital
  admission or doctor's prescription stored in the HIS.

## What changes

### Frontend (Vite build-time)

Set `VITE_PHARMACY_MODE=standalone` before running `npm run build`:

```bash
VITE_PHARMACY_MODE=standalone npm run build
```

This:

- Filters the Pharmacy tab strip — hides **OPD Rx** and **Live Indents** tabs.
- Hides the **UHID — pull from HIS** field in the Dispense tab.
- Hides the **Linked to HIS** badge.
- Collapses the Sidebar to show only the **Pharmacy** section regardless of role.
- Adds a small "**Retail Pharmacy**" badge in the orange Pharmacy hero so
  the user knows which deployment they're using.

### Backend (process env)

Set `PHARMACY_MODE=standalone` before starting the Node process:

```bash
PHARMACY_MODE=standalone node index.js
```

This:

- Returns **HTTP 404** on `GET /api/opd/uhid/:UHID/today-rx` — the OPD-Rx lookup
  endpoint (defence-in-depth alongside the hidden frontend tab).
- Returns **HTTP 404** on every route under `/api/indents/*` — IPD indents
  are a hospital-coupled workflow.
- All other Pharmacy routes (drug master, batches, GRN, sales, returns,
  registers, schedule-X, ADR) work normally.

The 404 (rather than 403) is intentional: in a standalone deployment those
features don't exist at all, so we don't reveal that they would be permission-
gated in another deployment shape.

## What survives standalone mode

All counter-pharmacy features stay functional:

- **Drug Master** — CRUD on drugs, brands, generics, schedules, HSN, GST rate
- **Inventory** — live stock rollup per drug + batch + expiry
- **Goods Receipt (GRN)** — atomic batch creation from supplier deliveries
- **Dispense** — walk-in counter sale with FEFO batch consumption
- **Sales Register** — history with filters + reprint + cancel + return
- **Returns** — partial returns, refunds, credit notes
- **Schedule-X Ledger** — narcotics register with witness + daily verify
- **ADR Reporting** — adverse-drug reaction submissions
- **Registers** — Sales / Purchase / Stock / Expiry / GST / Schedule-H
- **Suppliers** — supplier master + purchase history
- **Settings** — pharmacy-level identity (own header for retail-store bills)

## What goes away in standalone mode

- **OPD Rx Lookup tab** — needs hospital OPD visits
- **Live Indents tab** — needs IPD admissions + nurse workflow
- **UHID → patient + admission lookup** in Dispense — no Patient DB
- **Sidebar sections** for Doctor / Nurse / Reception / Billing / Lab / Accounts
- **IPD Live Ledger** / **Reception Billing** — non-pharmacy modules

## Deployment checklist

For a new retail-pharmacy customer:

1. Provision a MongoDB instance (no patient/admission collections needed).
2. Set env: `PHARMACY_MODE=standalone` (backend) + `VITE_PHARMACY_MODE=standalone` (frontend build).
3. Seed the Drug Master with the customer's product list (or import from Excel).
4. Add the customer's hospital identity in Settings (own logo, address, GSTIN).
5. Create one **Admin** user + one or more **Pharmacist** users.
6. Pharmacist user lands on `/pharmacy` after login — that's the only page they need.

## Backlog before launch (P0 fixes deferred from the 20-dim audit)

The standalone toggle ships. The following P0 fixes should land before
selling to a retail customer that needs GST-Act-compliant invoices:

- Populate `placeOfSupply` + `customerGstin` on dispense (B2B inter-state ITC)
- Snapshot `hsnCode` onto SALE_ITEM at dispense time (preserves historical GSTR)
- Convert dispense money fields to `Decimal128` (consistency with R7bh-F2)
- Compute per-item CGST/SGST/IGST split based on `placeOfSupply`
- Add Schedule H1 Form-5 register (D&C Rule 32) — currently missing
- Drug recall workflow (NABH MOM.8) — currently missing
- Month-close lock (post-GSTR-3B file) — currently missing
- Rate-limit `POST /api/pharmacy/sales` (no throttle today)
- Add expiry-alert cron (T-7 day batch warnings)
- Emit `BillingAudit` rows on PharmacySale state changes (audit trail gap)
