/**
 * PharmacyBill.jsx
 *
 * R7fr Track B: refactored onto the new shared <PrintShell> contract
 * (templates/PrintShell.jsx). The 10-template visual cascade
 * (PharmacyBillTemplates.jsx) is retired — every pharmacy bill now
 * renders through the same NABH-style triple-zone header + 2-col
 * patient strip + line-items body + GST/HSN/totals + amount-in-words.
 *
 * Preserved unchanged:
 *   • GST + HSN/SAC + line-item compute (sub-total, discount, taxable,
 *     tax, CGST/SGST/IGST split, round-off, grand total, balance)
 *   • Decimal128 wire-shape unwrap on every money field (Mongoose
 *     `.lean()` surfaces { $numberDecimal: "320" } — bare Number()
 *     NaNs and pollutes summations)
 *   • Outsourced-pharmacy identity (pharmacy.mode === "outsourced"
 *     remaps name/GSTIN/D.L./address — those flow into PrintShell's
 *     hospital prop so the shell header carries the pharmacy brand)
 *   • Returns / Supplements / REVISED / CANCELLED watermark sections
 *   • billLabel override for Cash Memo / Credit Note reprints
 *   • DUPLICATE watermark on reprints (PrintWatermark)
 *
 * Patient-strip mapping (Track-B contract):
 *   left:  Bill No · UHID · Patient · Age/Sex · Contact
 *   right: Bill Date · Doctor · Counter · Payer · GSTIN
 */
import React from "react";
import PrintShell from "@/templates/PrintShell";
import "../print.css";
import { fmtINR, amountInWords } from "../amountWords";
// R7hr-12 (D7-01) — PrintWatermark is now rendered by PrintShell itself
// (Frontend/src/templates/PrintShell.jsx) from meta.printCount /
// meta.watermarkLabel / meta.watermarkRecipient, so the bespoke import
// + in-body render that this file carried as the Track-A workaround is
// removed to avoid a doubled "DUPLICATE" stamp.
import { toNum } from "../../../utils/printUtils";

const _fmtDate = (d, opts) => d
  ? new Date(d).toLocaleDateString("en-IN", opts || { day: "2-digit", month: "short", year: "numeric" })
  : "—";

// R7da — Decimal128-aware numeric coercion for reduce()/sum sites.
// Mongoose Decimal128 fields surface as { $numberDecimal: "320" } when
// the backend uses .lean(). Plain Number() on that wrapper returns NaN
// so a single ₹NaN poisoned summations on supplementary + return slips.
const _dec = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
  if (typeof v === "object") {
    if (typeof v.$numberDecimal === "string") return parseFloat(v.$numberDecimal) || 0;
    if (typeof v.toString === "function") {
      const n = parseFloat(v.toString());
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
};
const _fmtAddr = (s = {}) => [
  s.addressLine1, s.addressLine2,
  [s.city, s.state, s.pincode].filter(Boolean).join(", "),
  s.country,
].filter(Boolean).join(", ");

/** Pharmacy settings (when mode=outsourced) override hospital identity
 *  so the shell header shows the pharmacy brand instead of the hospital.
 *  Returned shape matches PrintShell.hospital prop conventions. */
function resolveIdentityForShell(hospital = {}, pharmacy = null) {
  const isOut = pharmacy?.mode === "outsourced";
  if (isOut) {
    return {
      // PrintShell reads from these fields directly
      name:          pharmacy.pharmacyName || "Pharmacy",
      hospitalName:  pharmacy.pharmacyName || "Pharmacy",
      tagline:       pharmacy.tagline || "",
      logo:          pharmacy.showLogoInPrint === false ? null : pharmacy.logo || null,
      addressLine1:  pharmacy.addressLine1 || hospital.addressLine1,
      addressLine2:  pharmacy.addressLine2 || hospital.addressLine2,
      city:          pharmacy.city || hospital.city,
      state:         pharmacy.state || hospital.state,
      pincode:       pharmacy.pincode || hospital.pincode,
      phone:         [pharmacy.phone1, pharmacy.phone2].filter(Boolean).join(" · "),
      email:         pharmacy.email,
      website:       pharmacy.website,
      gstin:         pharmacy.gstin,
      printHeaderColor: pharmacy.headerColor || hospital.printHeaderColor || "#1e3a8a",
      helpline24x7:  hospital.helpline24x7,
      // Pharmacy-specific identifiers — surfaced in footer GSTIN line
      // via NABH cert slot (D.L. is the regulatory pharmacy equivalent).
      nabhCertNumber: pharmacy.drugLicenseNo
        ? `D.L. ${pharmacy.drugLicenseNo}`
        : hospital.nabhCertNumber,
      // For per-bill resolution downstream
      _stateForGst:  pharmacy.state || hospital.state,
      _isOutsourced: true,
    };
  }
  // In-house — hospital identity carries through unchanged.
  return {
    ...hospital,
    name:         hospital.hospitalName || hospital.name || "Hospital Pharmacy",
    _stateForGst: hospital.state,
    _isOutsourced: false,
  };
}

const PharmacyBill = ({ settings = {}, receipt = {} }) => {
  const id = resolveIdentityForShell(settings, receipt.pharmacySettings);
  const r = receipt;
  const items = Array.isArray(r.items) ? r.items : [];
  // R7hr-15-OPD: explicit OPD flag, hoisted ahead of docTitle so the
  // regulatory-aware Tax-Invoice default below can reference it. Treats
  // both literal "OPD" and the empty/missing saleType as OPD (legacy
  // callers that hit the cart-based New Sale flow at PharmacyHomePage
  // L1131 didn't always tag saleType). Also gates OPD-only strip
  // additions (Rx Ref + prescriber reg) further down.
  const isOPD = String(r.saleType || "OPD").trim() === "OPD";
  // R7hr-15-Walk-in: explicit Walk-in flag for the cash-memo / OTC path.
  // Drives (a) the default docTitle to "Cash Memo" when no billLabel set
  // and the bill is not a B2B/controlled-drug tax invoice, (b) the
  // anonymous-buyer collapse of the patient strip, (c) the PAN-cash-
  // threshold reminder (Income Tax Rule 114B, bills > ₹2L), and (d) the
  // DUPLICATE watermark recipient label.
  const isWalkIn = String(r.saleType || "").trim() === "Walk-in";

  // R7eo-A — billLabel override drives the document title (Cash Memo,
  // Credit Note, Pharmacy Bill, etc.) and the browser document.title
  // (file-name in print dialog + OS taskbar). Default = "Pharmacy Bill".
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    if (!r.billLabel) return;
    const prev = document.title;
    document.title = String(r.billLabel);
    return () => { document.title = prev; };
  }, [r.billLabel]);
  // R7hr-15-OPD (knownIssue #5): regulatory-aware default. When the caller
  // didn't pass an explicit billLabel and the OPD bill is either B2B
  // (customerGstin present) or carries Sch H/H1/X items, the document is
  // a Tax Invoice under GST §31 — not a generic "Pharmacy Bill". The Sch
  // signal is derived inline from `items` because the outer `hasControlled`
  // flag is computed further down (post-totals). Caller-supplied
  // billLabel still wins so cash-memo / credit-note reprints are unaffected.
  const _hasSchOnTitle = items.some(it => it.schedule && /^(H|H1|X)$/i.test(it.schedule));
  const _opdSchOnTitle = isOPD && _hasSchOnTitle;
  // R7hr-15-Walk-in (layoutNotes): Walk-in defaults to "Cash Memo" per
  // PharmacyHomePage L1154. The B2C cash memo is promoted to "Tax Invoice"
  // when the buyer supplies a GSTIN (corporate walk-in / B2B) or when any
  // dispensed item is Sch H/H1/X (controlled-drug sale becomes a regulated
  // tax invoice regardless of buyer identity). Caller-supplied billLabel
  // still wins.
  const docTitle = r.billLabel
    || (isWalkIn
        ? ((r.customerGstin || _hasSchOnTitle) ? "Tax Invoice" : "Cash Memo")
        : (isOPD && (r.customerGstin || _opdSchOnTitle) ? "Tax Invoice" : "Pharmacy Bill"));

  /* Tax + HSN ─────────────────────────────────────────────────── */
  const customerState = String(r.customerState || id._stateForGst || "").trim().toLowerCase();
  const hospState     = String(id._stateForGst || "").trim().toLowerCase();
  const isInterState  = !!customerState && !!hospState && customerState !== hospState;

  // R7hr-7 Fix #1+#2: PharmacySale.items defaults `discountAmount`,
  // `taxableAmount`, `gstAmount` to Decimal128(0). The previous
  // `it.taxableAmount != null` check accepted that zero as a literal
  // override and forced totalTaxable / totalTax to ₹0 for any sale
  // that didn't write those fields explicitly (every IPD release +
  // every consolidated reprint). Result: every "Final Pharmacy Bill"
  // showed Taxable ₹0 / CGST ₹0 / SGST ₹0 and per-line Amount ₹0
  // even though qty × rate was perfectly readable.
  // Treat 0 as "missing → compute from gross" so a default-valued
  // schema field falls through to the derived value. Real, non-zero
  // overrides still win.
  const _present = (v) => _dec(v) > 0; // any non-zero, decimal-aware presence test
  const hsnMap = new Map();
  let subTotal = 0, totalDisc = 0, totalTaxable = 0, totalTax = 0;
  for (const it of items) {
    const qty   = toNum(it.quantity || it.qty);
    const rate  = toNum(it.unitPrice || it.rate);
    const gst   = toNum(it.gstRate ?? 12);
    const gross = qty * rate;
    const disc  = _present(it.discountAmount)
      ? toNum(it.discountAmount)
      : gross * (toNum(it.discountPercent) / 100);
    const taxable = _present(it.taxableAmount)
      ? toNum(it.taxableAmount)
      : Math.max(0, gross - disc);
    const tax = _present(it.gstAmount)
      ? toNum(it.gstAmount)
      : taxable * (gst / 100);
    subTotal += gross; totalDisc += disc; totalTaxable += taxable; totalTax += tax;
    const hsn = it.hsnCode || "30049099";
    const key = `${hsn}__${gst}`;
    if (!hsnMap.has(key)) hsnMap.set(key, { hsn, gstRate: gst, taxable: 0, tax: 0, qty: 0 });
    const row = hsnMap.get(key);
    row.taxable += taxable; row.tax += tax; row.qty += qty;
  }
  const hsnRows = [...hsnMap.values()];
  // R7hr-7 Fix #3: if the caller-supplied grandTotal disagrees with the
  // taxable+tax derivation, trust the computed math (it's the GST audit
  // trail) and treat the difference as round-off — but only when it's
  // actually a rounding-sized delta (< ₹1). A bill that says grandRaw=0
  // and grandTotal=175 isn't "rounded" — the math is simply missing, so
  // we recompute grandTotal as subTotal-disc+tax for safety and skip
  // showing a misleading Round-off line.
  const grandRaw      = totalTaxable + totalTax;
  const callerGrand   = r.grandTotal != null ? toNum(r.grandTotal) : null;
  const grandTotal    = grandRaw > 0
    ? toNum(callerGrand != null ? callerGrand : Math.round(grandRaw))
    : (callerGrand != null ? callerGrand : Math.round(subTotal - totalDisc));
  const rawRoundOff   = r.roundOff != null ? toNum(r.roundOff) : grandTotal - grandRaw;
  // Hide Round-off if it would be a full-amount surprise — the math
  // didn't round, it failed entirely.
  const showRoundOff  = grandRaw > 0 && Math.abs(rawRoundOff) >= 0.01 && Math.abs(rawRoundOff) < 1;
  const roundOff      = showRoundOff ? rawRoundOff : 0;
  const paid          = toNum(r.amountPaid != null ? r.amountPaid : grandTotal);
  // R7hr-12-S3 (D7-09): Prefer caller-supplied r.balanceDue when it is
  // explicitly present and a finite number — that field is the source of
  // truth the IPD pharmacy ledger (PharmacyLedgerPage) and the
  // PharmacySale schema (PharmacySaleModel.js L140) both read. Falling
  // back to a local grandTotal-paid recompute is only safe when
  // balanceDue is missing/NaN (legacy rows or pre-credit-collection
  // intermediate prints), otherwise bill print and pharmacy ledger can
  // disagree after partial collection/refund. Mirrors the precedence
  // pattern used for grandTotal (L173-L176).
  const _hasBalance   = r.balanceDue != null
    && Number.isFinite(_dec(r.balanceDue));
  const balance       = _hasBalance
    ? Math.max(0, toNum(r.balanceDue))
    : Math.max(0, grandTotal - paid);
  const hasControlled = items.some(it => it.schedule && /^(H|H1|X)$/i.test(it.schedule));

  /* Returns / supplements / revised state ──────────────────────── */
  const returns       = Array.isArray(r.returns) ? r.returns : [];
  const supplements   = Array.isArray(r.supplements) ? r.supplements : [];
  const isRevised     = ["Partial-Return", "Refunded", "Cancelled", "Supplemented"].includes(r.status);
  const refundTotal     = returns.reduce((s, x) => s + toNum(x.refundAmount), 0);
  const supplementTotal = supplements.reduce((s, x) => s + toNum(x.addedTotal), 0);
  const netAfter        = Math.max(0, toNum(r.grandTotal) + supplementTotal - refundTotal);
  const patientCred     = toNum(r.patientCredit);
  const printCount      = toNum(r.printCount);

  /* Patient-strip mapping — Track-B contract.
     R7hp-1: extend fallback chain to include `patientUHID` (the field
     name PharmacySale actually stores), `patientName`/`patientName` and
     resolve Counter from cashier/preparedBy/createdBy when no explicit
     counter is set. Pre-fix the strip showed UHID="—" / Age-Sex="—" /
     Contact="—" / Counter="—" on every dispense print because the
     template was reading the wrong field names.

     R7hr-12-S2 (D7-04): when the bill is tied to an admission
     (saleType IPD/Daycare/Emergency), surface IPD No, Bed, Ward on
     the strip so the printed bill carries the bed + admission ID
     NABH HIC.4/IPC.2 expect on every patient-facing encounter
     document. Walk-in/OPD bills must NOT carry dashed IPD fields
     so we gate the three KVs on `isIPD`. Fallback chain mirrors the
     existing chain-of-fallbacks idiom already used on lines 205-214
     and covers both `bedNumber` (sent by PharmacyLedgerPage's
     `buildConsolidatedPayload`) and `bed`/`bedNo` (legacy callers). */
  const genderAge = [r.gender, r.age && `${r.age}Y`].filter(Boolean).join(" ");
  const isIPD = ["IPD", "Daycare", "Day Care", "Emergency"].includes(
    String(r.saleType || "").trim()
  );
  // R7hr-15-OPD (knownIssue #2): top-level prescriberRegistrationNo
  // (PharmacySale schema L111 — D8-07 Sch H register completeness). Surface
  // it next to the doctor name so the dispense bill carries the prescriber's
  // MCI/state-council reg as D&C Schedule H/H1/X register mandates.
  // `isOPD` is hoisted to the top of the component (see L113) so the
  // regulatory-aware docTitle above can use it; do not re-declare here.
  const prescriberReg = r.prescriberRegistrationNo
    || r.doctorRegistrationNo
    || r.prescriberRegNo
    || "";
  // R7hr-15-IPD (knownIssue #5): IPD bills SHOULD carry patient address
  // when available — GST §31 supplier-buyer-address snapshot + NABH IPC.2
  // patient identification on encounter documents. Only render when the
  // caller passes an address (PharmacySale schema doesn't persist it yet
  // — once admissionPatient.address is forwarded into the payload, the
  // strip light up automatically). Walk-in / OPD skip this row.
  const patientAddress = isIPD
    ? (r.patientAddress
        || r.address
        || _fmtAddr({
            addressLine1: r.addressLine1,
            addressLine2: r.addressLine2,
            city:         r.city,
            state:        r.state,
            pincode:      r.pincode,
          }) || "")
    : "";
  // R7hr-15-Walk-in (knownIssue #1): collapse 5 dashed identity rows on
  // anonymous walk-in sales (OTC cash sale with no buyer identity captured).
  // For Walk-in we only include each KV when an actual value resolves so
  // the strip naturally shrinks; if literally no buyer fields are present
  // we emit a single "Customer · Walk-in (anonymous)" line so the strip
  // still anchors the bill against the right column without painting 4-5
  // empty dashes. When ANY buyer identity (UHID/Patient/Contact) IS
  // present (e.g. controlled-drug Walk-in where Sch H controller forces
  // patient capture, or B2B with customerLegalName) those rows are shown.
  // OPD/IPD strips are untouched — they still get the full 5-row identity
  // block (statutory for prescription/admission paths).
  const _walkInPatient = r.patientName || r.fullName || r.customerLegalName || "";
  const _walkInUHID    = r.UHID || r.uhid || r.patientUHID || "";
  const _walkInContact = r.contactNumber || r.mobile || r.phone || "";
  const _walkInHasIdentity = !!(_walkInPatient || _walkInUHID || _walkInContact || genderAge);
  const patientLeft = isWalkIn && !_walkInHasIdentity
    ? [
        { label: "Bill No",  value: r.billNumber || r.invoiceNo || "—" },
        { label: "Customer", value: "Walk-in (anonymous)" },
      ]
    : isWalkIn
      ? [
          { label: "Bill No",  value: r.billNumber || r.invoiceNo || "—" },
          ...(_walkInUHID    ? [{ label: "UHID",    value: _walkInUHID }]    : []),
          ...(_walkInPatient ? [{ label: "Patient", value: _walkInPatient }] : [{ label: "Customer", value: "Walk-in" }]),
          ...(genderAge      ? [{ label: "Age/Sex", value: genderAge }]      : []),
          ...(_walkInContact ? [{ label: "Contact", value: _walkInContact }] : []),
          ...(patientAddress
            ? [{ label: "Address", value: patientAddress }]
            : []),
        ]
      : [
          { label: "Bill No",  value: r.billNumber || r.invoiceNo || "—" },
          { label: "UHID",     value: r.UHID || r.uhid || r.patientUHID || "—" },
          { label: "Patient",  value: r.patientName || r.fullName || "—" },
          { label: "Age/Sex",  value: genderAge || "—" },
          { label: "Contact",  value: r.contactNumber || r.mobile || r.phone || "—" },
          ...(patientAddress
            ? [{ label: "Address", value: patientAddress }]
            : []),
        ];
  // R7hr-15-OPD (knownIssue #2): for OPD bills, append prescriber reg
  // when present so the doctor cell prints "Dr. R. Kapoor · Reg. KMC-…"
  // — NABH MOM.4 + Sch H/H1/X register need identifiable + registered
  // prescriber on the dispense document. IPD/Walk-in keep the bare name.
  // R7hr-15-IPD (knownIssue #8): IPD bills SHOULD also surface attending
  // consultant's registration number (NABH MOM.4 identifiable prescriber)
  // — prefer consultantName over doctorName per spec layoutNotes; append
  // reg when consultantRegistrationNo / doctorRegistrationNo is present.
  const doctorNameRaw = isIPD
    ? (r.consultantName || r.doctorName || r.prescribingDoctor || "—")
    : (r.doctorName || r.prescribingDoctor || r.consultantName || "—");
  const consultantReg = isIPD
    ? (r.consultantRegistrationNo
        || r.doctorRegistrationNo
        || r.prescriberRegistrationNo
        || "")
    : "";
  // R7hr-15-Walk-in (knownIssue #5): Walk-in dispenses carrying Sch
  // H/H1/X items MUST show prescriber identity (D&C Act §65; controller
  // PharmacySaleController L844-849 enforces capture). When the bill has
  // a controlled drug, suffix the doctor name with the prescriber reg
  // (mirrors the OPD branch); otherwise legitimate OTC walk-in leaves
  // the cell as-is so the strip can hide it when no value resolves.
  const doctorCell = (isOPD && prescriberReg && doctorNameRaw !== "—")
    ? `${doctorNameRaw} · Reg. ${prescriberReg}`
    : (isIPD && consultantReg && doctorNameRaw !== "—")
      ? `${doctorNameRaw} · Reg. ${consultantReg}`
      : (isWalkIn && _hasSchOnTitle && prescriberReg && doctorNameRaw !== "—")
        ? `${doctorNameRaw} · Reg. ${prescriberReg}`
        : doctorNameRaw;
  const patientRight = [
    { label: "Bill Date", value: _fmtDate(r.createdAt || r.billDate || new Date(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
    // R7hr-15-Walk-in (knownIssue #1 + layoutNotes): OTC walk-in
    // legitimately has no prescriber — only emit Doctor row when a real
    // value resolves OR when the bill carries Sch H/H1/X items (then
    // doctorName is statutorily required and even an "—" placeholder
    // signals "MISSING" alongside the controlled-drug banner). OPD/IPD
    // always render the row (existing contract).
    ...((!isWalkIn || doctorNameRaw !== "—" || _hasSchOnTitle)
      ? [{ label: "Doctor", value: doctorCell }]
      : []),
    { label: "Counter",   value: r.counter || r.pharmacyCounter || r.cashier || r.preparedBy || r.createdBy || "—" },
    // R7hr-12-S3 (D7-08): Extend payer fallback chain to surface TPA /
    // panel attribution when the PharmacySale row carries any of the
    // admission-derived hints. Schema-level persistence (payer/tpaName
    // on PharmacySale, populated from Admission.tpaProvider /
    // Admission.payerType / Admission.scheme at dispense time) is the
    // longer-term fix tracked separately, but the template should
    // already render whichever of these the caller passes, so an IPD
    // bill billed to MediCare TPA does not print "Self".
    { label: "Payer",     value: r.payer
        || r.tpaName
        || r.tpaProvider
        || r.panelName
        || r.scheme
        || (r.payerType && r.payerType !== "Self" ? r.payerType : null)
        || "Self" },
    // R7hr-15-Walk-in (knownIssue #1 + layoutNotes): only emit GSTIN row
    // when the buyer actually supplied one (B2B walk-in / corporate buy).
    // The pre-fix unconditional row painted an empty label+value pair on
    // every anonymous cash sale. OPD/IPD keep emitting GSTIN row (legacy
    // payer-facing contract) — they get `""` when not B2B which renders
    // an empty value cell rather than dropping a row.
    ...(isWalkIn
      ? (r.customerGstin ? [{ label: "GSTIN", value: r.customerGstin }] : [])
      : [{ label: "GSTIN", value: r.customerGstin || "" }]),
    // R7hr-12-S2 (D7-04): IPD/Daycare/Emergency context — bed +
    // admission identifiers required for NABH-compliant patient-facing
    // documents and for TPA/insurance reconciliation of per-admission
    // pharmacy spend.
    // R7hr-15-IPD (knownIssue #6 + #7): also surface Admission Date and
    // Diagnosis/ICD-10 in the same context strip — NABH MOM.4 expects
    // diagnosis context on IPD pharmacy docs; admission date is GST §31
    // buyer-snapshot data and TPA reconciliation needs the LoS window.
    // Only render when a value resolves so we don't paint dashed rows on
    // legacy callers that don't pass these fields yet.
    ...(isIPD ? [
      { label: "IPD No", value: r.admissionNumber || r.ipdNo || r.ipdNumber || "—" },
      { label: "Bed",    value: r.bedNumber || r.bed || r.bedNo || "—" },
      { label: "Ward",   value: r.wardName || r.ward || "—" },
    ] : []),
    ...((isIPD && (r.admissionDate || r.dateOfAdmission))
      ? [{ label: "Admission Date", value: _fmtDate(r.admissionDate || r.dateOfAdmission) }]
      : []),
    ...((isIPD && (r.diagnosis || r.icd10 || r.icdCode || r.provisionalDiagnosis))
      ? [{
          label: "Diagnosis",
          value: [r.diagnosis || r.provisionalDiagnosis, r.icd10 || r.icdCode]
            .filter(Boolean)
            .join(" · "),
        }]
      : []),
    // R7hr-15-OPD (knownIssue #1): surface the prescription/visit ref so
    // an OPD dispense bill can be reconciled back to its script. Schema
    // stores it at PharmacySale.prescriptionRef (L122) — Dispense-All sets
    // it to visit.visitNumber (PharmacyHomePage L3772). Only render when
    // a value resolves so non-Rx walk-up cash sales don't carry a dashed
    // row. Gated on isOPD so IPD/Walk-in strips are untouched.
    ...((isOPD && (r.prescriptionRef || r.visitNumber || r.rxRef || r.visitId))
      ? [{
          label: "Rx Ref",
          value: r.prescriptionRef || r.visitNumber || r.rxRef || r.visitId,
        }]
      : []),
  ];

  return (
    <PrintShell
      hospital={id}
      docTitle={docTitle}
      docSubtitle={isInterState ? "Inter-State (IGST)" : "Intra-State (CGST + SGST)"}
      patient={{ left: patientLeft, right: patientRight }}
      signatures={{
        type: "prepared-by",
        preparedBy: {
          // R7hr-12-S3 (D8-11): Extend the signatory fallback chain so
          // an identified pharmacist's name + registration number print
          // on the bill (NABH MOM.4 + Drugs & Cosmetics Form 5 require
          // an identifiable registered-pharmacist signatory on every
          // dispensed prescription / Schedule H sale). Order:
          //   pharmacistName → preparedBy → cashier → counter →
          //   pharmacist → createdBy → generic "Pharmacist" only as the
          //   last-resort legacy fallback for pre-pharmacist-tracking
          //   rows. The dedicated pharmacistId/pharmacistName/
          //   pharmacistRegistrationNo schema fields land separately;
          //   the template surfaces whichever the caller passes today.
          name: r.pharmacistName
            || r.preparedBy
            || r.cashier
            || r.counter
            || r.pharmacist
            || r.createdBy
            || "Pharmacist",
          role: r.pharmacistRegistrationNo
            ? `Pharmacist · Reg. ${r.pharmacistRegistrationNo}`
            : "Pharmacist",
        },
        showAttestedStamp: true,
      }}
      banners={{ emergency24x7: true }}
      meta={{
        docNumber: r.billNumber,
        pageOf:    "1 of 1",
        printCount,
        // R7hr-12 (D7-01) — recipient that PrintShell will splice into
        // the "DUPLICATE FOR …" stamp. Preserves the prior in-body
        // workaround's behaviour (patient name, falling back to a
        // generic "RECIPIENT" label).
        // R7hr-15-Walk-in (knownIssue #4): for Walk-in we prefer
        // patientName → customerLegalName (B2B walk-in) → "WALK-IN
        // CUSTOMER" as the recipient label so the reprint stamps
        // "DUPLICATE FOR WALK-IN CUSTOMER" instead of the generic
        // "RECIPIENT" placeholder. Non-Walk-in keeps the existing chain.
        watermarkRecipient: isWalkIn
          ? (r.patientName || r.customerLegalName || "WALK-IN CUSTOMER")
          : (r.patientName || "RECIPIENT"),
      }}
    >
      {/* R7hr-12 (D7-01) — PrintWatermark is now emitted by PrintShell
          from `meta.printCount` / `meta.watermarkRecipient`. The local
          render that lived here as the Track-A workaround is removed
          to avoid double-stamping. */}

      {isRevised && (
        <div style={{
          margin: "0 0 10px", padding: "7px 12px",
          background: r.status === "Cancelled" ? "#fef2f2" : "#fffbeb",
          border: `1.5px solid ${r.status === "Cancelled" ? "#fecaca" : "#fcd34d"}`,
          borderRadius: 6, fontSize: 10.5,
          color: r.status === "Cancelled" ? "#7f1d1d" : "#92400e",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>
            <b>{r.status === "Cancelled" ? "CANCELLED BILL" : "REVISED BILL"}</b>
            {" · "}
            {r.status === "Refunded"       && "All items returned"}
            {r.status === "Partial-Return" && "One or more items returned"}
            {r.status === "Cancelled"      && "Sale cancelled — invoice retained for audit"}
            {r.status === "Supplemented"   && `${supplements.length} item${supplements.length === 1 ? "" : "s"} added via supplementary invoice`}
          </span>
          <span>
            Original&nbsp;{fmtINR(r.grandTotal)}
            {supplementTotal > 0 && <> · Added&nbsp;<b style={{ color: "#15803d" }}>+ {fmtINR(supplementTotal)}</b></>}
            {refundTotal > 0     && <> · Refund&nbsp;<b style={{ color: "#b45309" }}>− {fmtINR(refundTotal)}</b></>}
            {(supplementTotal > 0 || refundTotal > 0) && <> · Net&nbsp;<b>{fmtINR(netAfter)}</b></>}
          </span>
        </div>
      )}

      {/* R7hr-15-IPD (knownIssue #2): consolidated INTERIM/FINAL banner.
          PharmacyLedgerPage.buildConsolidatedPayload stamps
          `isConsolidated` + `consolidatedFrom` (sale count) + `note` on
          the payload but the pre-R7hr-15 template ignored them — a 7-
          dispense FINAL bill looked identical to a single counter sale.
          The banner surfaces the consolidation context so the discharge
          cashier knows it is a settlement aggregate and how many dispense
          rows it covers. Gated on isIPD because only the IPD ledger path
          mints consolidated bills today; consolidatedFrom > 1 keeps OPD/
          Walk-in (which never pass these fields) silent and also
          suppresses single-bill IPD prints that just happen to set the
          flag. */}
      {isIPD && r.isConsolidated && toNum(r.consolidatedFrom) > 0 && (
        <div style={{
          margin: "0 0 10px", padding: "7px 12px",
          background: "#eff6ff", border: "1.5px solid #93c5fd",
          borderRadius: 6, fontSize: 10.5, color: "#1e3a8a",
          display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 12,
        }}>
          <span>
            <b>
              {String(r.billLabel || "").toUpperCase().includes("FINAL")
                ? "FINAL CONSOLIDATED BILL"
                : String(r.billLabel || "").toUpperCase().includes("INTERIM")
                  ? "INTERIM CONSOLIDATED BILL"
                  : "CONSOLIDATED PHARMACY BILL"}
            </b>
            {" · "}
            Aggregates <b>{toNum(r.consolidatedFrom)}</b> dispense
            {toNum(r.consolidatedFrom) === 1 ? "" : "s"} on this admission
          </span>
          {r.note && (
            <span style={{ fontSize: 10, fontStyle: "italic", textAlign: "right", maxWidth: "55%" }}>
              {r.note}
            </span>
          )}
        </div>
      )}

      {hasControlled && (
        <div style={{
          margin: "0 0 10px", padding: "7px 12px",
          background: "#fef2f2", border: "1.5px solid #fecaca",
          borderRadius: 6, fontSize: 10.5, color: "#7f1d1d",
          fontWeight: 700,
        }}>
          ⚠ This bill contains Schedule H/H1/X controlled drugs. Sale recorded under
          Drugs &amp; Cosmetics Act §65 — prescription mandatory.
          {/* R7hr-15-Walk-in (knownIssue #5): on a Walk-in Sch H/H1/X
              sale the controller (PharmacySaleController L844-849) gates
              patient + prescriber + Rx ref capture. If the payload still
              reaches the template missing any of them (legacy override
              or backdated re-print), flag the specific missing field
              inline so the audit/pharmacist signing the bill knows what
              to chase. OPD/IPD skip this callout — their separate
              identity rows already make the gap visible. */}
          {isWalkIn && (() => {
            const _missing = [];
            if (!_walkInPatient && !_walkInUHID) _missing.push("Patient identity");
            if (doctorNameRaw === "—") _missing.push("Prescriber name");
            if (!prescriberReg) _missing.push("Prescriber Reg. No");
            if (!r.prescriptionRef && !r.rxRef) _missing.push("Rx reference");
            return _missing.length > 0 ? (
              <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, color: "#b91c1c" }}>
                Missing statutory field{_missing.length === 1 ? "" : "s"}: {_missing.join(" · ")}
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* ── Line items ── */}
      <table className="pr-table" style={{ marginBottom: 10, fontSize: 10.5 }}>
        <thead>
          <tr>
            <th style={{ width: 26 }}>#</th>
            <th>Drug</th>
            <th style={{ width: 70 }}>Batch</th>
            <th style={{ width: 64 }}>Expiry</th>
            <th style={{ width: 60 }}>HSN</th>
            <th style={{ width: 36 }} className="right">Qty</th>
            <th style={{ width: 60 }} className="right">Rate</th>
            <th style={{ width: 48 }} className="right">Disc</th>
            <th style={{ width: 48 }} className="right">GST%</th>
            <th style={{ width: 68 }} className="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={10} style={{ textAlign: "center", padding: 18, color: "#94a3b8" }}>No items on this bill</td></tr>
          ) : items.map((it, i) => {
            const qty = toNum(it.quantity || it.qty);
            const rate = toNum(it.unitPrice || it.rate);
            const gst = toNum(it.gstRate ?? 12);
            const gross = qty * rate;
            // R7hr-7 Fix #1: same 0-treated-as-missing rule as the
            // outer aggregator so per-line Amount ≠ ₹0 when the schema
            // wrote Decimal128(0) defaults for taxableAmount/discount/
            // gstAmount.
            const disc = _present(it.discountAmount)
              ? toNum(it.discountAmount)
              : gross * (toNum(it.discountPercent) / 100);
            const taxable = _present(it.taxableAmount)
              ? toNum(it.taxableAmount)
              : Math.max(0, gross - disc);
            const tax = _present(it.gstAmount)
              ? toNum(it.gstAmount)
              : taxable * (gst / 100);
            const lineNet = taxable + tax;
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{it.drugName || it.name || "—"}</div>
                  {it.generic && <div className="muted" style={{ fontSize: 9.5 }}>({it.generic})</div>}
                  {it.schedule && /^(H|H1|X)$/i.test(it.schedule) && (
                    <div style={{ fontSize: 9, color: "#b91c1c", fontWeight: 700 }}>Sch {it.schedule}</div>
                  )}
                  {/* R7hr-15-IPD (knownIssue #3): per-line source-bill
                      breadcrumb on consolidated IPD bills.
                      PharmacyLedgerPage.buildConsolidatedPayload (L632-633)
                      stamps `sourceBillNumber` + `sourceDate` on each line
                      so the discharge cashier can reconcile each line back
                      to its original dispense. Only render on IPD
                      consolidated prints (single-dispense bills already
                      carry the bill no in the header). */}
                  {isIPD && r.isConsolidated && it.sourceBillNumber && (
                    <div style={{
                      fontSize: 9, color: "#475569", marginTop: 2,
                      fontFamily: "'DM Mono', monospace",
                    }}>
                      {it.sourceBillNumber}
                      {it.sourceDate && <> · {_fmtDate(it.sourceDate)}</>}
                    </div>
                  )}
                </td>
                {/* R7hr-7 Fix #4: PharmacySale.items uses `batchNumber`
                    (Mongoose schema field); legacy callers passed `batchNo`.
                    Without the alias the consolidated reprint showed every
                    Batch column as "—". */}
                <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5 }}>{it.batchNo || it.batchNumber || "—"}</td>
                <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5 }}>{_fmtDate(it.expiry || it.expDate || it.expiryDate, { month: "short", year: "2-digit" })}</td>
                <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5 }}>{it.hsnCode || "30049099"}</td>
                <td className="right">{qty}</td>
                <td className="right">{fmtINR(rate)}</td>
                <td className="right">{disc > 0 ? fmtINR(disc) : "—"}</td>
                <td className="right">{gst}%</td>
                <td className="right" style={{ fontWeight: 700 }}>{fmtINR(lineNet)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── HSN + Totals split: side-by-side ── */}
      <div style={{ display: "grid", gridTemplateColumns: hsnRows.length ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 10 }}>
        {hsnRows.length > 0 && (
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
            <div style={{
              padding: "5px 10px", background: "#f1f5f9", color: "#0f172a",
              fontSize: 10, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase",
            }}>HSN / SAC Summary</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr>
                  <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>HSN</th>
                  <th style={{ padding: "4px 8px", textAlign: "right", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>GST%</th>
                  <th style={{ padding: "4px 8px", textAlign: "right", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Taxable</th>
                  <th style={{ padding: "4px 8px", textAlign: "right", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Tax</th>
                </tr>
              </thead>
              <tbody>
                {hsnRows.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", fontFamily: "'DM Mono', monospace" }}>{row.hsn}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>{row.gstRate}%</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>{fmtINR(row.taxable)}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>{fmtINR(row.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
          <div style={{
            padding: "5px 10px", background: "#f1f5f9", color: "#0f172a",
            fontSize: 10, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase",
          }}>Bill Summary</div>
          <div style={{ padding: "8px 12px", fontSize: 11 }}>
            <Row label="Sub Total" value={fmtINR(subTotal)} />
            {totalDisc > 0 && <Row label="Discount" value={`- ${fmtINR(totalDisc)}`} />}
            <Row label="Taxable Value" value={fmtINR(totalTaxable)} />
            {isInterState
              ? <Row label={`IGST`} value={fmtINR(totalTax)} />
              : (
                <>
                  <Row label="CGST" value={fmtINR(totalTax / 2)} />
                  <Row label="SGST" value={fmtINR(totalTax / 2)} />
                </>
              )}
            {Math.abs(roundOff) > 0.001 && (
              <Row label="Round-off" value={(roundOff >= 0 ? "+ " : "- ") + fmtINR(Math.abs(roundOff))} />
            )}
            <div style={{
              marginTop: 5, padding: "6px 0", borderTop: "1.5px solid #0f172a",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontWeight: 800, fontSize: 13,
            }}>
              <span>Grand Total</span>
              <span>{fmtINR(grandTotal)}</span>
            </div>
            {paid > 0 && <Row label="Paid" value={fmtINR(paid)} />}
            {balance > 0 && (
              <Row label="Balance Due" value={fmtINR(balance)} bold color="#dc2626" />
            )}
          </div>
        </div>
      </div>

      {/* ── Amount in words ── */}
      <div style={{
        padding: "8px 12px", marginBottom: 10,
        background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 6,
        fontSize: 11, fontStyle: "italic",
      }}>
        {/* R7hr-7 Fix #5: amountInWords() already returns
            "…Rupees Only"; the trailing " only." double-stamped it as
            "Rupees Only only." Just terminate with a period. */}
        <b>Amount in words:</b> {amountInWords(grandTotal)}.
      </div>

      {/* R7hr-15-Walk-in (knownIssue #2): PAN-cash-threshold reminder
          (Income Tax Rule 114B). For any walk-in / B2C cash sale where
          grandTotal exceeds ₹2,00,000 the seller is statutorily required
          to capture and quote the buyer's PAN on the invoice. Until the
          form-side flow surfaces a PAN field we render a visible audit-
          trail reminder so the cashier captures it before handing the
          bill over. When buyerPan is supplied on the payload we render
          it as compliance evidence instead of the reminder. Gated to
          Walk-in so OPD/IPD (which already carry full patient identity +
          UHID-based PAN trace) stay silent. */}
      {isWalkIn && grandTotal > 200000 && (
        <div style={{
          margin: "0 0 10px", padding: "7px 12px",
          background: r.buyerPan ? "#f0fdf4" : "#fffbeb",
          border: `1.5px solid ${r.buyerPan ? "#86efac" : "#fcd34d"}`,
          borderRadius: 6, fontSize: 10.5,
          color: r.buyerPan ? "#166534" : "#92400e",
          display: "flex", justifyContent: "space-between",
          alignItems: "center", gap: 12,
        }}>
          <span>
            <b>PAN-cash threshold (Income Tax Rule 114B)</b>
            {" · "}
            Cash sale exceeds ₹2,00,000 — buyer's PAN is statutorily
            required on this invoice.
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace" }}>
            {r.buyerPan
              ? <>Buyer PAN: <b>{r.buyerPan}</b></>
              : <b style={{ color: "#b45309" }}>PAN: REQUIRED</b>}
          </span>
        </div>
      )}

      {/* R7hr-15-IPD (knownIssue #4): Collection-history strip on IPD
          bills. PharmacyLedgerPage merges every sale's collectionLog into
          the payload (L639) but pre-R7hr-15 it was never rendered — in-
          admission credit collections were invisible on the FINAL bill,
          making it impossible for the discharge cashier to reconcile what
          had already been paid against the consolidated balance. Schema
          shape: collectionLog[] = { amount, mode, txnRef, receiptNumber,
          collectedAt, collectedBy } (PharmacySaleModel.js L191-211). Gated
          on isIPD + non-empty array so OPD/Walk-in untouched and a
          consolidated bill with zero credit collections stays clean. */}
      {isIPD && Array.isArray(r.collectionLog) && r.collectionLog.length > 0 && (
        <div style={{
          marginBottom: 10,
          border: "1px solid #cbd5e1", borderRadius: 6, overflow: "hidden",
        }}>
          <div style={{
            padding: "5px 10px", background: "#f1f5f9", color: "#0f172a",
            fontSize: 10, fontWeight: 800, letterSpacing: ".4px",
            textTransform: "uppercase",
            display: "flex", justifyContent: "space-between",
          }}>
            <span>Credit-Collection History — {r.collectionLog.length} receipt(s)</span>
            <span>
              Total collected:{" "}
              <b>{fmtINR(r.collectionLog.reduce((s, c) => s + _dec(c.amount), 0))}</b>
            </span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>#</th>
                <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Receipt</th>
                <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Date</th>
                <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Mode</th>
                <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Txn Ref</th>
                <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Collected by</th>
                <th style={{ padding: "4px 8px", textAlign: "right", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.collectionLog.map((c, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{i + 1}</td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", fontFamily: "'DM Mono', monospace", fontSize: 9.5 }}>{c.receiptNumber || "—"}</td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{_fmtDate(c.collectedAt, { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{c.mode || "—"}</td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", fontFamily: "'DM Mono', monospace", fontSize: 9 }}>{c.txnRef || "—"}</td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{c.collectedBy || "—"}</td>
                  <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: 700 }}>{fmtINR(_dec(c.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Payment method chip + R7hp-2 structured details ──
           Renders BOTH the legacy `r.method`/`r.refNo` short-form AND
           the new `r.paymentMode` + `r.paymentDetails` shape that the
           Dispense All flow now ships. Card last-4, UPI txn ref and
           Mix-mode splits get itemised so the patient sees exactly
           which slice of the bill was settled by which mode. */}
      {(r.method || r.paymentMode) && (
        <div style={{ marginBottom: 10, fontSize: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#475569", fontWeight: 700 }}>Paid via:</span>
            <span className={`pr-paymethod pr-paymethod--${String(r.method || r.paymentMode).toLowerCase()}`}>
              {String(r.method || r.paymentMode).toUpperCase()}
            </span>
            {r.refNo && <span style={{ color: "#64748b", fontSize: 10.5 }}>Ref: {r.refNo}</span>}
            {/* Card last-4 — masked PAN format */}
            {r.paymentDetails?.cardLast4 && (
              <span style={{ color: "#64748b", fontSize: 10.5 }}>
                Card: <span style={{ fontFamily: "'DM Mono', monospace" }}>•••• {r.paymentDetails.cardLast4}</span>
                {r.paymentDetails.cardHolderName && ` · ${r.paymentDetails.cardHolderName}`}
              </span>
            )}
            {/* UPI txn ref */}
            {r.paymentDetails?.upiTxnRef && (
              <span style={{ color: "#64748b", fontSize: 10.5 }}>
                UPI Ref: <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.paymentDetails.upiTxnRef}</span>
              </span>
            )}
          </div>
          {/* Mix-mode split breakdown */}
          {Array.isArray(r.paymentDetails?.splits) && r.paymentDetails.splits.length > 0 && (
            <div style={{
              marginTop: 4, paddingLeft: 8,
              borderLeft: "2px solid #cbd5e1",
              fontSize: 10.5, color: "#475569",
              display: "flex", gap: 14, flexWrap: "wrap",
            }}>
              {r.paymentDetails.splits.map((s, i) => (
                <span key={i}>
                  <strong>{s.mode}:</strong> {fmtINR(_dec(s.amount))}
                  {s.txnRef && <span style={{ color: "#64748b", marginLeft: 4 }}>({s.txnRef})</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tax Identification (B2B GSTIN block) ── */}
      {(r.customerGstin || settings.gstin) && (
        <div style={{ marginBottom: 10, fontSize: 10.5 }}>
          <div style={{ fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px", fontSize: 9.5, marginBottom: 3 }}>
            Tax Identification
          </div>
          <div><strong>Pharmacy GSTIN:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{id.gstin || settings.gstin || "—"}</span></div>
          {r.customerGstin && (
            <div style={{ marginTop: 2 }}>
              <strong>Customer GSTIN:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.customerGstin}</span>
            </div>
          )}
          {r.customerLegalName && (
            <div style={{ marginTop: 2 }}><strong>Legal Name:</strong> {r.customerLegalName}</div>
          )}
          {/* R7hr-15-Walk-in (optionalFields): customerAddress + state
              for B2B walk-in — GST §31 buyer-address requirement and
              the intra/inter-state place-of-supply trail. Only render
              when caller passes a value so non-B2B (anonymous OTC) and
              OPD/IPD prints stay untouched. */}
          {r.customerAddress && (
            <div style={{ marginTop: 2 }}><strong>Address:</strong> {r.customerAddress}</div>
          )}
          {r.customerState && (
            <div style={{ marginTop: 2 }}>
              <strong>Place of Supply:</strong> {r.customerState}
              {isInterState && <span style={{ color: "#b45309", marginLeft: 6 }}>(Inter-State)</span>}
            </div>
          )}
        </div>
      )}

      {/* ── Supplements (debit-note slips) ── */}
      {supplements.length > 0 && (
        <div style={{ marginBottom: 10, border: "1.5px dashed #16a34a", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "7px 12px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0", fontSize: 10.5, color: "#166534", display: "flex", justifyContent: "space-between" }}>
            <b>SUPPLEMENTARY INVOICE — {supplements.length} slip(s)</b>
            <span>Added total: <b>{fmtINR(supplementTotal)}</b></span>
          </div>
          {supplements.map((sup, si) => (
            <SubBillSlip key={si} slip={sup} idx={si} kind="supplement" />
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, padding: "6px 12px", background: "#f0fdf4", fontSize: 10.5 }}>
            <span>Paid: <b style={{ color: "#15803d" }}>{fmtINR(supplements.reduce((s, x) => s + _dec(x.amountPaid), 0))}</b></span>
            <span>Balance due: <b style={{ color: "#dc2626" }}>{fmtINR(supplements.reduce((s, x) => s + _dec(x.balanceDue), 0))}</b></span>
            <span>Addendum total: <b style={{ color: "#15803d" }}>{fmtINR(supplementTotal)}</b></span>
          </div>
        </div>
      )}

      {/* ── Returns / refunds ── */}
      {returns.length > 0 && (
        <div style={{ marginBottom: 10, border: "1.5px dashed #f59e0b", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "7px 12px", background: "#fffbeb", borderBottom: "1px solid #fde68a", fontSize: 10.5, color: "#92400e", display: "flex", justifyContent: "space-between" }}>
            <b>RETURNS &amp; REFUNDS — {returns.length} slip(s)</b>
            <span>Net of returns: <b>{fmtINR(netAfter)}</b></span>
          </div>
          {returns.map((ret, ri) => (
            <SubBillSlip key={ri} slip={ret} idx={ri} kind="return" />
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, padding: "6px 12px", background: "#fffbeb", fontSize: 10.5 }}>
            <span>Total refunded: <b style={{ color: "#b45309" }}>{fmtINR(refundTotal)}</b></span>
            {patientCred > 0 && <span>Credit held: <b style={{ color: "#0369a1" }}>{fmtINR(patientCred)}</b></span>}
          </div>
        </div>
      )}
    </PrintShell>
  );
};

/* Internal helpers ─────────────────────────────────────────────── */

function Row({ label, value, bold, color }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "2px 0", fontSize: 11,
      fontWeight: bold ? 800 : 500,
      color: color || "inherit",
    }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function SubBillSlip({ slip, idx, kind }) {
  const isSup = kind === "supplement";
  const headBg = isSup ? "#f0fdf4" : "#fffdf5";
  const headBorder = isSup ? "#86efac" : "#fcd34d";
  const slipNo = isSup ? slip.supplementSlipNumber : slip.refundSlipNumber;
  const slipDate = isSup ? slip.addedAt : slip.refundedAt;
  const mode = isSup ? slip.paymentMode : slip.refundMode;
  const rowItems = isSup ? slip.addedItems : slip.refundedItems;
  const total = isSup ? slip.addedTotal : slip.refundAmount;
  return (
    <div style={{ borderTop: idx > 0 ? `1px solid ${headBorder}` : "none" }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        padding: "5px 12px", background: headBg,
        borderBottom: `1px dashed ${headBorder}`,
        fontSize: 10,
      }}>
        <span>
          <b style={{ fontFamily: "'DM Mono', monospace" }}>{slipNo || `${isSup ? "Supplement" : "Refund"} #${idx+1}`}</b>
          {slipDate && <> · {_fmtDate(slipDate)}</>}
          {mode && <> · {mode}</>}
          {slip.reason && <> · <i>{slip.reason}</i></>}
        </span>
        <span>{isSup ? "Total" : "Refund"}: <b>{fmtINR(total)}</b></span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr>
            <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", width: 28 }}>#</th>
            <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>Drug</th>
            <th style={{ padding: "4px 8px", textAlign: "left", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", width: 80 }}>Batch</th>
            <th style={{ padding: "4px 8px", textAlign: "right", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", width: 50 }}>Qty</th>
            <th style={{ padding: "4px 8px", textAlign: "right", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", width: 70 }}>Rate</th>
            <th style={{ padding: "4px 8px", textAlign: "right", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", width: 70 }}>GST</th>
            <th style={{ padding: "4px 8px", textAlign: "right", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", width: 80 }}>Net</th>
          </tr>
        </thead>
        <tbody>
          {(rowItems || []).map((it, ii) => (
            <tr key={ii}>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{ii + 1}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{it.drugName}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", fontFamily: "'DM Mono', monospace", fontSize: 9 }}>{it.batchNo || "—"}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{it.quantity}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{fmtINR(it.unitPrice)}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{fmtINR(it.gstAmount)}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: 700 }}>{fmtINR(it.netAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PharmacyBill;
