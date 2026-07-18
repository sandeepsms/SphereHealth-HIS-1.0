// services/Billing/claimFormService.js
// R7hr(CLAIM-P1.2) — canonical claim-data builder. ONE assembler feeds
// EVERY claim-form template (IRDAI Part A/B, pre-auth, CGHS-MRC, ESIC).
// Forms differ by payer, but ~85% of the data is identical — so we build
// it once here from the admission + its bill(s) and each printable maps
// its own fields off this shape. Nothing is invented: fields the system
// genuinely can't know (patient bank details, occupation, out-of-hospital
// bills) are simply absent — the template leaves those boxes blank for the
// patient to fill.

const { toNum } = require("../../utils/money");
const { getInsurer } = require("../../config/insurers");

// Raw ServiceMaster / bill-item categories → the insurer's Part-B buckets.
function partBBucket(rawCat = "", serviceCode = "") {
  const c = String(rawCat).toUpperCase();
  const s = String(serviceCode).toUpperCase();
  if (c === "ROOM" || c === "DAYCARE" || s.startsWith("BED-")) return "Room / Bed Charges";
  if (c === "ICU" || c.includes("ICU") || s.startsWith("ICU-")) return "ICU / Monitoring";
  if (c === "NURSING" || c === "LINEN" || c === "HOUSEKEEPING" || c === "SUPPORT" || s.startsWith("NURSING")) return "Nursing & Service Charges";
  if (c === "OT" || c === "PROCEDURE" || c === "PER_PROCEDURE") return "OT / Procedure Charges";
  if (c === "DOCTOR" || c === "DOCTOR_VISIT" || c === "CONSULTATION" || s.startsWith("DOC-") || s.startsWith("RMO")) return "Professional / Consultant Fees";
  if (c === "LAB" || c === "INVESTIGATION" || c.includes("LAB")) return "Investigations / Lab";
  if (c === "RADIOLOGY" || c.includes("IMAG")) return "Radiology / Imaging";
  if (c === "PHARMACY" || c === "MEDICATION" || c === "IV_FLUID" || s.startsWith("PHARM")) return "Pharmacy / Medicines";
  if (c === "BLOODTRANSFUSION" || c.includes("BLOOD")) return "Blood / Transfusion";
  if (c === "CONSUMABLE" || c === "CONSUMABLES") return "Consumables / Disposables";
  return "Other Charges";
}

const PARTB_ORDER = [
  "Room / Bed Charges", "ICU / Monitoring", "Nursing & Service Charges",
  "Professional / Consultant Fees", "OT / Procedure Charges",
  "Investigations / Lab", "Radiology / Imaging", "Pharmacy / Medicines",
  "Blood / Transfusion", "Consumables / Disposables", "Other Charges",
];

async function buildClaimData(billId) {
  const PatientBill      = require("../../models/PatientBillModel/PatientBillModel");
  const Admission        = require("../../models/Patient/admissionModel");
  const Patient          = require("../../models/Patient/patientModel");
  const HospitalSettings = require("../../models/HospitalSettings");
  const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");

  const seed = await PatientBill.findById(billId).lean();
  if (!seed) { const e = new Error("Bill not found"); e.status = 404; throw e; }

  // Gather the WHOLE episode's bills (multi-bill admissions — P1.2/R3), so
  // the claim reflects total hospitalisation cost, not one bill.
  let bills = [seed];
  if (seed.admission) {
    bills = await PatientBill.find({
      $or: [{ admission: seed.admission }, { admissionNumber: seed.admissionNumber || "__NONE__" }],
      billStatus: { $ne: "CANCELLED" },
    }).lean();
    if (!bills.length) bills = [seed];
  }

  const admission = seed.admission ? await Admission.findById(seed.admission).lean() : null;
  const patient   = await Patient.findOne({ UHID: seed.UHID }).populate("tpa", "tpaName tpaCode").lean();
  const hs        = (await HospitalSettings.findOne({}).lean()) || {};

  // ── Diagnosis (CLAIM-P3.1) ──────────────────────────────────────────
  // Insurers/schemes need an ICD-10 coded diagnosis. The discharge summary
  // (NABH AAC.5) is where the FINAL, ICD-coded diagnosis + comorbidities are
  // captured — so we prefer it over the admission's provisional free-text.
  // No new capture UI: this reuses what discharge already records.
  const ds = admission
    ? await DischargeSummary.findOne({
        $or: [{ admissionId: admission._id }, { ipdNo: admission.admissionNumber }],
      }).sort({ createdAt: -1 }).lean()
    : null;
  const finalDx  = ds?.finalDiagnosis || admission?.finalDiagnosis || admission?.provisionalDiagnosis || admission?.diagnosis || "";
  const admitDx  = ds?.admittingDiagnosis || admission?.provisionalDiagnosis || "";
  const primaryIcd = ds?.icdCode || admission?.icd10Code || "";
  const comorbid = (ds?.comorbidities || []).filter(Boolean);
  const diagnoses = [];
  // R7hr(ICD-P2) — prefer the picker-driven coded list captured on the
  // discharge form; fall back to the legacy single-code + prose shape.
  const codedList = (ds?.codedDiagnoses || []).filter((d) => d.code || d.description);
  if (codedList.length) {
    for (const d of codedList) diagnoses.push({ type: d.dxType || "Secondary", code: d.code || "", description: d.description || "" });
  } else {
    if (finalDx || primaryIcd) diagnoses.push({ type: "Primary", code: primaryIcd, description: finalDx });
    for (const c of comorbid) diagnoses.push({ type: "Secondary", code: "", description: c });
  }

  // R7hr(PCS-P1) — coded procedures for the claim: the discharge form's
  // proceduresDone rows now carry an ICD-10-PCS code alongside the name.
  const procedures = (ds?.proceduresDone || [])
    .filter((p) => p.procedureName || p.pcsCode)
    .map((p) => ({
      name: p.procedureName || "",
      pcsCode: p.pcsCode || "",
      date: p.date || null,
      performedBy: p.performedBy || "",
    }));

  // ── Category rollup (billable lines only, mirrors FinalBill) ──
  const buckets = {};
  let gross = 0, discount = 0, tax = 0, net = 0;
  for (const b of bills) {
    for (const it of b.billItems || []) {
      if (it.orderStatus && !["Completed"].includes(it.orderStatus)) continue;   // skip Ordered/Cancelled
      if (it.excludedByPackage) continue;
      const bucket = partBBucket(it.category, it.serviceCode);
      const amt = toNum(it.netAmount);
      if (!buckets[bucket]) buckets[bucket] = { name: bucket, amount: 0, items: 0 };
      buckets[bucket].amount += amt;
      buckets[bucket].items  += 1;
      gross += toNum(it.grossAmount) || amt;
      discount += toNum(it.discountAmount);
      tax += toNum(it.taxAmount);
    }
    net += toNum(b.netAmount);
  }
  const billBreakup = PARTB_ORDER
    .filter((n) => buckets[n])
    .map((n) => ({ ...buckets[n], amount: Math.round(buckets[n].amount * 100) / 100 }))
    .concat(Object.values(buckets).filter((x) => !PARTB_ORDER.includes(x.name)));

  // ── Bills + receipts enumeration (Part B: bill no / date / amount) ──
  const billsList = bills.map((b) => ({
    billNumber: b.billNumber, billDate: b.billGeneratedAt || b.createdAt,
    netAmount: toNum(b.netAmount), paid: toNum(b.advancePaid), balance: toNum(b.balanceAmount),
  }));
  const receipts = bills.flatMap((b) => (b.payments || [])
    .filter((p) => toNum(p.amount) > 0)
    .map((p) => ({ receiptNumber: p.receiptNumber || null, date: p.paidAt, mode: p.paymentMode, amount: toNum(p.amount) })));

  const totals = {
    gross: Math.round(gross * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    net: Math.round(net * 100) / 100,
    tpaPayable: bills.reduce((s, b) => s + toNum(b.tpaPayableAmount), 0),
    patientPayable: bills.reduce((s, b) => s + toNum(b.patientPayableAmount), 0),
    collected: bills.reduce((s, b) => s + toNum(b.advancePaid), 0),
    balance: bills.reduce((s, b) => s + toNum(b.balanceAmount), 0),
  };

  // Pre-auth (from the primary TPA bill if any)
  const tpaBill = bills.find((b) => b.tpaPreAuthNumber || toNum(b.tpaApprovedAmount) > 0) || seed;

  // Insurer (CLAIM-P4.1) — the company that issued the policy; drives which
  // company's claim form the PDF engine fills. Falls back to OTHER.
  const insurer = getInsurer(patient?.insurerCode || patient?.insurerName || "");

  return {
    generatedAt: new Date(),
    hospital: {
      name: hs.hospitalName || "",
      address: [hs.addressLine1, hs.addressLine2, hs.city, hs.state, hs.pincode].filter(Boolean).join(", "),
      phone: hs.phone1 || hs.phone2 || "",
      email: hs.email || "",
      gstin: hs.gstin || "", pan: hs.panNumber || "",
      registrationNo: hs.registrationNo || "",
      rohiniId: hs.rohiniId || "",           // insurer-mandatory on Part B
    },
    patient: {
      name: patient?.fullName || seed.patientName || "",
      uhid: seed.UHID, age: patient?.age, gender: patient?.gender,
      dob: patient?.dateOfBirth, phone: patient?.contactNumber,
      address: patient?.address?.completeAddress || "",
      payerScheme: patient?.payerScheme || "CASH",
      schemeIds: patient?.schemeIds || {},
      tpaName: tpaBill.tpaName || patient?.tpa?.tpaName || "",
      insurerCode: insurer.code,
      insurerName: patient?.insurerName || insurer.name || "",
      policyNumber: patient?.policyNumber || "",
      policyHolderName: patient?.policyHolderName || "",
      sumInsured: patient?.sumInsured || null,
    },
    // Insurer registry record (CLAIM-P4.1) — name/type/submission/portal so
    // the filled form carries the right company branding + where to send it.
    insurer: {
      code: insurer.code, name: insurer.name, legalName: insurer.legalName,
      type: insurer.type, formTitle: insurer.formTitle,
      claimEmail: insurer.claimEmail, claimAddress: insurer.claimAddress,
      portal: insurer.portal, mandatesOwnForm: insurer.mandatesOwnForm,
    },
    admission: admission ? {
      admissionNumber: admission.admissionNumber, ipNo: admission.admissionNumber,
      type: admission.admissionType,
      admissionDate: admission.admissionDate, dischargeDate: admission.actualDischargeDate,
      roomCategory: admission.roomNumber || admission.bedNumber || "",
      consultant: admission.attendingDoctor || "",
      provisionalDiagnosis: admitDx,
      finalDiagnosis: finalDx,
      admittingDiagnosis: admitDx,
      icdCode: primaryIcd,
      icdDescription: finalDx,
      comorbidities: comorbid,
      diagnoses,                                   // [{type, code, description}] — primary + secondary
      procedures,                                  // R7hr(PCS-P1): [{name, pcsCode, date, performedBy}]
      reasonForAdmission: admission.reasonForAdmission || "",
      isMLC: !!admission.isMLC, mlcNumber: admission.mlcNumber || "",
    } : { admissionNumber: seed.admissionNumber, type: seed.visitType, diagnoses: [], procedures: [] },
    preAuth: {
      number: tpaBill.tpaPreAuthNumber || "",
      sanctionedAmount: toNum(tpaBill.tpaPreAuthAmount) || null,
      claimNumber: tpaBill.tpaClaimNumber || "",
      approvedAmount: toNum(tpaBill.tpaApprovedAmount) || null,
      status: tpaBill.tpaClaimStatus || "",
    },
    billBreakup,
    totals,
    billsList,
    receipts,
    // Standard supporting-document checklist (same across payers).
    docsChecklist: [
      "Duly filled & signed claim form", "Original final hospital bill + itemised breakup",
      "Original paid receipts", "Discharge summary", "All investigation / diagnostic reports",
      "Prescriptions & pharmacy bills", "Implant sticker / invoice (if any)",
      "KYC + cancelled cheque / bank details", "Policy copy / e-card",
      "MLC / FIR (accident cases)",
    ],
  };
}

module.exports = { buildClaimData, partBBucket };
