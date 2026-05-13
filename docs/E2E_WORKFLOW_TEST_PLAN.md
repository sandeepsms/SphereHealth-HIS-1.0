# HIS End-to-End Workflow Test Plan

Reset → OPD → Vitals → Doctor → Prescription → Investigations →
IPD → Day Care → Services → Final Bill → Discharge.

Run sections in order; each step has a verification checkpoint.

---

## 0. Reset patient data

```bash
node Backend/scripts/resetPatientData.js --confirm
```

**Verify**
- Console reports counts for every patient-facing collection.
- All beds flipped to `Available`.
- Counters (UHID / admissionNumber / billNumber / etc.) cleared.
- Master data preserved: log in, doctors/beds/rooms/services still present.

---

## 1. OPD registration → OPD receipt

Path: **Reception → Patient Registration → New Patient (OPD)**

1. Register a fresh patient. Capture `UHID` from the success toast.
2. Navigate to **Reception → Billing**.
3. Pay the consultation fee → click **Print Receipt**.

**Verify**
- A popup opens at `/print/opd-receipt?ts=…` with hospital header (logo/
  address/phones/GSTIN), the patient row, INR amount + words, and a paper-
  size selector. (`Frontend/src/pages/reception/ReceptionBilling.jsx:118`.)
- Backend audit: `GET /api/admin-ops/health` returns 200; backend log shows
  the `[daily-accrual] boot` message from `index.js`.

---

## 2. Nurse vitals

Path: **Nurse Console → OPD queue → patient → Vitals**

1. Record BP / pulse / temp / SpO2 / RR.
2. Save.

**Verify**
- POST `/api/opd/:visitId/vitals` returns 200.
- `onOPDVitalsRecorded` fires a vitals trigger (look in `BillingTrigger`).

---

## 3. Doctor consultation + prescription print

Path: **Doctor Console → patient → OPD Assessment**

1. Fill complaints / history / examination / diagnosis.
2. Add ≥ 2 medications + ≥ 1 investigation suggestion.
3. Click **Save & Print**.

**Verify**
- Popup opens at `/print/opd-prescription?ts=…` with the Rx body and
  doctor's signature block. (`OPDAssessmentPage.jsx:320`.)
- `onOPDAssessmentSaved` recorded a `CON-001` trigger.

---

## 4. Investigation / service billing

Path: **Reception → Billing → patient**

1. Add the suggested investigations as billable items.
2. Collect payment → **Print Receipt**.

**Verify**
- Bill items now include the investigation rows.
- Payment-receipt popup shows the method + amount-in-words.

---

## 5. IPD admission

Path: **Reception → Admit / IPD → New Admission**

1. Choose the same patient, bed category (e.g. `General`), bed.
2. Submit.

**Verify**
- `Admission.status === "Active"`, bed status flipped to `Occupied`.
- `BillingTrigger` collection grew by **3** entries for this admission:
  `REG-IPD`, `ADM-IPD`, `BED-DAY-IPD` (Day 1).
- One `PatientBill` doc created (visitType=IPD, status=Draft).

---

## 6. Day-care / services / IPD round-trip

1. Discharge from IPD → re-register the same UHID as **Day Care**.
2. After day-care: register as **Services** (lab-only visit).
3. Re-admit as IPD.

**Verify**
- Each admission re-fires its own REG / ADM / BED-DAY trigger set with
  the correct `patientType` (IPD / DAYCARE / EMERGENCY / OPD).
- No bed double-booking — each admission picks a fresh `Available` bed.

---

## 7. Auto-accrued daily charges

While the IPD admission stays Active:

```bash
curl -X POST http://localhost:5000/api/admin-ops/run-daily-accrual \
  -H "Authorization: Bearer $ADMIN_JWT"
```

**Verify**
- Response shape: `{ success:true, result:{ active, fired, skipped, errors } }`.
- Re-run immediately: `fired === 0`, `skipped === active` (daily dedup
  prevents double-charge on the same calendar day).
- Wait until next calendar day OR temporarily edit `admissionDate` back
  by 24h to test Day-N labeling: the trigger created carries
  `serviceName: "IPD Bed Charge (Day N)"`.

---

## 8. Nursing staff add bills during duty

Path: **Nurse Console → patient → MAR + Procedure / Equipment notes**

1. Mark an IV insertion (NurseNote:iv).
2. Mark wound dressing (NurseNote:wound).
3. Administer a med via MAR.
4. Charge a consumable from Nursing Charges.

**Verify**
- Each action fired a trigger that **auto-billed** (autoCharge=true) and
  appears in the patient's draft bill within seconds.
- `getAdmissionBillingSummary(admissionId)` shows the running total
  growing with each action.

---

## 9. Printable media per workflow step

| Workflow point                | Print slug                   |
|-------------------------------|------------------------------|
| OPD receipt                   | `opd-receipt`                |
| OPD prescription              | `opd-prescription`           |
| Payment / advance receipt     | `payment-receipt` / `advance-receipt` |
| IPD admission consent         | `consent-form` (admission)   |
| Pre-surgical consent          | `consent-form` (surgical)    |
| HIV / DNR / autopsy           | `consent-form` (hiv/dnr/autopsy) |
| Anesthesia consent            | `consent-form` (anesthesia)  |
| Emergency attendance cert     | `medical-certificate` certType=`emergency` |
| Sick-leave cert               | `medical-certificate` certType=`sick-leave` |
| Extending-leave cert          | `medical-certificate` certType=`extending-leave` |
| Healthy-now (fit-to-resume)   | `medical-certificate` certType=`healthy-now` |
| Fitness / sickness / disability | `medical-certificate` certType=`fitness`/`sickness`/`disability` |
| Visitor / attendant pass      | `visitor-pass`               |
| MAR sheet / doctor order      | `mar-sheet` / `doctor-order` |
| Complete IPD file             | `ipd-file`                   |
| Discharge summary             | `discharge-summary`          |
| Cost estimate                 | `cost-estimate`              |
| TPA authorization letter      | `tpa-authorization`          |
| Referral letter               | `referral-letter`            |
| Refund receipt                | `refund-receipt`             |
| Final IPD bill                | `final-bill`                 |

Preview any of them with demo data at **/print-gallery** → "Preview".

---

## 10. Final bill + discharge

Path: **Reception → Discharge Queue → patient**

1. Click **Print Final Bill** (uses `final-bill` slug). Verify totals
   include: REG + ADM + N × BED-DAY + all nurse/doctor triggers + MAR
   admin charges + consumables.
2. Click **Print Discharge Summary** (uses `discharge-summary`).
3. Click **Print Gate Pass / Visitor Pass** as needed.
4. Finalize discharge → admission status flips to `Discharged`, bed
   freed back to `Available`.

**Verify**
- Daily-accrual no longer touches this admission (status != Active).
- A new patient can take the same bed without conflict.

---

## Smoke-pass criteria (must be green 10× consecutively)

After each pass run:

```bash
cd Frontend && npm run build           # must end in "✓ built"
```

A pass is GREEN when:
- Frontend build exits 0 (only the harmless `@page` CSS warnings).
- Backend boots cleanly (`Server running on port 5000` + `MongoDB connected`).
- `/api/admin-ops/health` returns 200.
- Every printable slug in §9 renders demo data via `/print-gallery`.
