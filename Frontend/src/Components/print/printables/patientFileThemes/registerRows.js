/**
 * registerRows.js — R7hr(THEME-REG)
 * ONE source of truth for how the Complete-File coverage records and the
 * NABH Safety & Compliance registers map model fields → print cells.
 *
 * Extracted verbatim from Narrative.jsx after REG-V proved the danger of
 * per-theme copies: the pick chains drifted from the real schema names and
 * every runtime-written register row printed blank cells. Narrative renders
 * these through its own MiniTable; the other four themes render them via
 * SharedRegisterSections.jsx — both consume THESE definitions, so a field
 * rename now updates every theme at once.
 *
 * R7hr(REG-V): each chain carries the REAL schema/emitter field names
 * (appended after the legacy names, so precedence is unchanged).
 */

export const _pick = (o, ...keys) => { for (const k of keys) { const v = o?.[k]; if (v != null && v !== "") return v; } return ""; };

export const _cfmtDate = (d) => {
  try {
    return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
};

export const _cfmt = (v) => {
  if (v == null || v === "") return "";
  if (v instanceof Date) return _cfmtDate(v);
  if (typeof v === "object") return "";               // never dump [object Object]
  // ISO date-only ("2026-05-14") or full timestamp → localised print date.
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return _cfmtDate(v);
  return String(v);
};

export function _cnum(v) {
  const n = typeof v === "object" && v ? Number(v.$numberDecimal ?? v) : Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-IN") : "";
}

// Each: { key (file field), title, nabh, headers, widths, row(x)->cells }
export const COVERAGE_BLOCKS = [
  { key: "appointments", title: "Appointments", nabh: "",
    headers: ["Date", "Department", "Doctor", "Complaint", "Status"], widths: ["16%","20%","22%","28%","14%"],
    row: (x) => [_cfmt(_pick(x,"appointmentDate","date","slotStart","createdAt")), _pick(x,"department","departmentName"), _pick(x,"doctorName","consultantName"), _pick(x,"chiefComplaint","reason"), _pick(x,"status")] },
  { key: "emergencyCases", title: "Emergency / ER Visits", nabh: "NABH AAC.1",
    headers: ["Date", "Triage", "Complaint", "Disposition", "Consultant"], widths: ["15%","12%","33%","20%","20%"],
    row: (x) => [_cfmt(_pick(x,"arrivalTime","visitDate","createdAt")), _pick(x,"triageLevel","triageCategory"), _pick(x,"chiefComplaint","presentingComplaint"), _pick(x,"disposition","outcome"), _pick(x,"consultantName","attendingDoctor")] },
  { key: "prescriptions", title: "Prescriptions (Rx)", nabh: "NABH MOM.2",
    headers: ["Date", "Rx no", "Doctor", "Medicines", "Advice"], widths: ["14%","16%","20%","32%","18%"],
    row: (x) => [_cfmt(_pick(x,"prescriptionDate","createdAt")), _pick(x,"prescriptionNumber","rxNo"), _pick(x,"doctorName","consultantName"),
      (Array.isArray(x.medicines || x.medications) ? (x.medicines||x.medications) : []).map(m=>_pick(m,"medicineName","name","drug")).filter(Boolean).join(", "), _pick(x,"advice","generalAdvice")] },
  { key: "medReconciliation", title: "Medication Reconciliation", nabh: "NABH MOM.1",
    headers: ["Date", "Phase", "Home meds", "Reconciled by", "Discrepancies"], widths: ["15%","16%","26%","22%","21%"],
    row: (x) => [_cfmt(_pick(x,"reconciledAt","createdAt")), _pick(x,"phase","stage","type"),
      String((Array.isArray(x.homeMedications||x.medications)?(x.homeMedications||x.medications):[]).length || _pick(x,"homeMedCount") || ""),
      _pick(x,"reconciledByName","pharmacistName","reconciledBy"), _pick(x,"discrepancies","discrepancyNotes")] },
  { key: "diabeticCharts", title: "Diabetic / Blood-Sugar Chart", nabh: "NABH COP.3",
    headers: ["Date", "Readings", "Insulin", "Notes"], widths: ["18%","34%","24%","24%"],
    row: (x) => {
      const n = (Array.isArray(x.readings || x.entries) ? (x.readings || x.entries) : []).length;
      return [_cfmt(_pick(x,"chartDate","date","createdAt")),
        n > 0 ? `${n} reading(s)` : "", _pick(x,"insulinRegimen","insulin"), _pick(x,"notes","remarks")];
    } },
  { key: "procedureNotes", title: "Procedure Notes", nabh: "NABH COP.13",
    headers: ["Date", "Procedure", "Performed by", "Site", "Notes"], widths: ["15%","22%","20%","15%","28%"],
    row: (x) => [_cfmt(_pick(x,"procedureDate","performedAt","createdAt")), _pick(x,"procedureName","procedure","name"), _pick(x,"performedByName","doctorName","performedBy"), _pick(x,"site","bodyPart"), _pick(x,"notes","findings")] },
  { key: "physioPlans", title: "Physiotherapy Plans", nabh: "NABH COP.20",
    headers: ["Date", "Diagnosis", "Goals", "Modalities", "Sessions"], widths: ["14%","22%","24%","24%","16%"],
    row: (x) => [_cfmt(_pick(x,"createdAt","planDate")), _pick(x,"diagnosis","indication"), _pick(x,"goals","goal"),
      (Array.isArray(x.modalities)?x.modalities:[]).join(", ") || _pick(x,"modalities"), String(_pick(x,"sessionCount","totalSessions") || "")] },
  { key: "physioSessions", title: "Physiotherapy Sessions", nabh: "NABH COP.20",
    headers: ["Date", "Modality", "Duration", "Therapist", "Response"], widths: ["16%","24%","14%","22%","24%"],
    row: (x) => [_cfmt(_pick(x,"sessionDate","performedAt","createdAt")), _pick(x,"modality","treatment"), _pick(x,"duration","durationMin"), _pick(x,"therapistName","performedBy"), _pick(x,"patientResponse","response","notes")] },
  { key: "medicalCertificates", title: "Medical Certificates", nabh: "NABH IMS.1",
    headers: ["Date", "Cert no", "Type", "Issued by", "Validity"], widths: ["15%","18%","22%","23%","22%"],
    row: (x) => [_cfmt(_pick(x,"issuedAt","createdAt")), _pick(x,"certificateNumber","certNo"), _pick(x,"certificateType","type"), _pick(x,"issuedByName","doctorName"),
      [_cfmt(_pick(x,"validFrom","fromDate")), _cfmt(_pick(x,"validTo","toDate"))].filter(Boolean).join(" – ")] },
  { key: "pharmacySales", title: "Pharmacy Dispenses", nabh: "",
    headers: ["Date", "Bill no", "Type", "Items", "Net (₹)"], widths: ["16%","20%","14%","32%","18%"],
    row: (x) => [_cfmt(_pick(x,"createdAt","saleDate")), _pick(x,"billNumber","invoiceNumber"), _pick(x,"saleType","type"),
      String((Array.isArray(x.items)?x.items:[]).length || "") + " item(s)", _cnum(_pick(x,"grandTotal","netAmount","total"))] },
  { key: "advances", title: "Advance Deposits & Refunds", nabh: "",
    headers: ["Date", "Receipt", "Amount (₹)", "Mode", "Applied / Refund"], widths: ["16%","18%","16%","16%","34%"],
    row: (x) => [_cfmt(_pick(x,"paidAt","createdAt")), _pick(x,"receiptNumber","receiptNo"), _cnum(_pick(x,"amount")), _pick(x,"paymentMode","mode"),
      [_pick(x,"appliedAmount") && `applied ${_cnum(x.appliedAmount)}`, _pick(x,"refundedAmount") && `refunded ${_cnum(x.refundedAmount)}`].filter(Boolean).join(" · ")] },
  { key: "adrReports", title: "Adverse Drug Reactions", nabh: "Pharmacovigilance",
    headers: ["Date", "Suspected drug", "Reaction", "Severity", "Outcome"], widths: ["15%","22%","28%","15%","20%"],
    row: (x) => [_cfmt(_pick(x,"reportedAt","reactionDate","createdAt")), _pick(x,"suspectedDrug","drugName"), _pick(x,"reaction","adverseEffect"), _pick(x,"severity"), _pick(x,"outcome")] },
  { key: "foodReactions", title: "Adverse Food Reactions", nabh: "",
    headers: ["Date", "Food", "Reaction", "Severity", "Action"], widths: ["16%","22%","28%","14%","20%"],
    row: (x) => [_cfmt(_pick(x,"reactionDate","createdAt")), _pick(x,"foodItem","food"), _pick(x,"reaction","symptoms"), _pick(x,"severity"), _pick(x,"actionTaken","action")] },
  { key: "codeResponseEvents", title: "Code / Resuscitation Events", nabh: "NABH FMS.5",
    headers: ["Time", "Code", "Location", "Outcome", "Response"], widths: ["18%","16%","22%","22%","22%"],
    // R7hr(REG-V): real rows carry alertedAt / arrivalDelaySec /
    // durationMinutes (codeResponseService), not the alertTime /
    // responseTime the seed used — Response printed blank on every real
    // code event (the NABH FMS.5 response-time figure).
    row: (x) => {
      const respMin = Number.isFinite(x.arrivalDelaySec) ? Math.round(x.arrivalDelaySec / 6) / 10
        : (Number.isFinite(x.durationMinutes) ? x.durationMinutes : _pick(x, "responseTime"));
      return [_cfmt(_pick(x,"alertedAt","alertTime","createdAt")), _pick(x,"codeType","code"), _pick(x,"location","area"), _pick(x,"outcome"),
        (respMin !== "" && respMin != null) ? `${respMin} min` : ""];
    } },
  { key: "promPremSurveys", title: "Patient Experience (PROM / PREM)", nabh: "Patient Feedback",
    headers: ["Date", "Type", "Score", "Comments"], widths: ["18%","20%","16%","46%"],
    row: (x) => [_cfmt(_pick(x,"submittedAt","createdAt")), _pick(x,"surveyType","type"), String(_pick(x,"overallScore","score") || ""), _pick(x,"comments","feedback")] },
];

// Clinical records first, then administrative / feedback — a readable
// medical-record order regardless of the config array's authoring order.
export const COVERAGE_ORDER = [
  "emergencyCases", "prescriptions", "medReconciliation", "procedureNotes",
  "diabeticCharts", "physioPlans", "physioSessions", "adrReports",
  "foodReactions", "codeResponseEvents", "medicalCertificates",
  "appointments", "pharmacySales", "advances", "promPremSurveys",
];

export const REGISTER_META = {
  restraints:       { title: "Restraint Register",        nabh: "NABH COP.17" },
  fallEvents:       { title: "Fall-Risk / Fall Register", nabh: "NABH COP.12" },
  pressureUlcers:   { title: "Pressure-Ulcer Register",   nabh: "NABH COP.4"  },
  medicationErrors: { title: "Medication-Error Register", nabh: "NABH COP.16" },
  sentinelEvents:   { title: "Sentinel-Event Register",   nabh: "NABH QMS"    },
  haiSurveillance:  { title: "HAI Surveillance",          nabh: "NABH HIC.1"  },
  lama:             { title: "LAMA / DAMA Register",      nabh: "NABH COP.20" },
  mortality:        { title: "Mortality Register",        nabh: "NABH IMS"    },
  nearMissEvents:   { title: "Near-Miss Register",        nabh: "NABH FMS.7"  },
  otRegister:       { title: "OT Register",               nabh: "NABH COP.7"  },
  antimicrobialUse: { title: "Antimicrobial Use",         nabh: "NABH IPC"    },
};

export const REGISTER_HEADERS = ["Date", "Detail", "Indication / Reason", "By", "Status"];
export const REGISTER_WIDTHS  = ["16%","30%","26%","16%","12%"];

/* R7hr(REG-V): each chain now ALSO carries the real schema/emitter field
   names (appended, so existing precedence is unchanged) — real runtime
   rows used to print blank Detail/Reason/By cells because only seed-era
   names were read. */
export const registerRow = (x) => [
  _cfmt(_pick(x,"eventDate","assessedAt","appliedAt","occurredAt","onsetDate","lamaAt","discoveredAt","startTime","createdAt")),
  _pick(x,"deviceType","stage","errorType","eventType","diagnosis","organism","detail","summary","description","title",
         "antibiotic","medicationName","HAIType","actualProcedure","surgeryName","plannedProcedure","primaryCause","doctorCounsellingNotes")
    || [_pick(x,"restraintType"), Array.isArray(x.restraintDevice) ? x.restraintDevice.join(", ") : "", _pick(x,"chemicalAgent")].filter(Boolean).join(" · ")
    || [_pick(x,"ulcerStage") && `Stage ${x.ulcerStage}`, _pick(x,"ulcerSite")].filter(Boolean).join(" · ")
    || (x.morseScore != null && x.morseScore !== "" ? `Morse ${x.morseScore}` : ""),
  _pick(x,"indication","reason","rootCause","cause","riskLevel","category",
         "lamaReason","interventionTaken","immediateCauseOfDeath","underlyingCause","riskTier","immediateAction","surgicalSpeciality"),
  _pick(x,"recordedByName","orderedByName","assessedByName","recordedBy","actorName",
         "orderingDoctor","appliedBy","assessedBy","observedByName","reportedByName","counsellingDoctor",
         "attendingDoctor","certifyingDoctor","surgeonName","identifiedByEmpId","discoveredByEmpId","createdByName"),
  _pick(x,"status","outcome","severity","severityNCC","interventionBundle"),
];
