// R7ft — Shared data normalizer for all 5 patient-file print themes.
//
// Every theme (Narrative / Timeline / Executive / Audit / Editorial)
// must consume the SAME shape so swapping themes is a render-only
// difference, never a data-fetch difference. This module is the only
// place that translates the raw `receipt` payload from the backend
// into the canonical clinical-file shape.
//
// Contract:
//   normalizeFileData(rawReceipt) → CanonicalFileData
//   buildChronologicalEvents(canonical) → Event[]  (sorted ascending by date)
//
// CanonicalFileData (every theme reads from this):
//   meta: { ipdNo, uhid, printedAt, printCount }
//   patient: { fullName, age, gender, mobile, bloodGroup, address }
//   admission: { date, type, modeOfArrival, referringDoctor, consultant,
//                department, bed, ward, reasonForAdmission,
//                provisionalDiagnosis, workingDiagnosis, finalDiagnosis,
//                icd10, icd10Desc, dischargeDate, totalDays }
//   alerts: { allergies[], isolationFlags[], crossCheckAlerts[] }
//   vitals: { onAdmission: {...}, trend: [{date,bp,pulse,...}] }
//   history: { chief, hopi, medical, surgical, family, social,
//              obstetric, immunisation, anthropometry, homeMeds[] }
//   exam: { generalExam, systemicExam, ros }
//   investigations: [{ name, orderedAt, reportedAt, result }]
//   doctorNotes: [{ noteType, createdAt, content, doctorName,
//                   signedAt, signedBy }]
//   nursingNotes: [{ noteType, createdAt, content, nurseName,
//                    shift, signedAt }]
//   ia: { doctor: {…}, nursing: {…} }   // signed Initial Assessments
//   medications: [{ drug, generic, dose, route, frequency, startDate,
//                   endDate, indication, givenDoses[] }]
//   procedures: [{ name, date, surgeon, anaesthetist, findings, notes }]
//   consents: [{ name, signed, signedAt, signedBy, witness }]
//   discharge: { summary, advice, followUpDate, condition }
//   signatures: { consultant, mro }
//
// Author note: if you find yourself reaching for `receipt.foo` inside
// a theme component, add the field here first. Themes should never
// know about raw API shapes — that's a separation-of-concerns rule.

/* ── helpers ─────────────────────────────────────────────────── */
const toArr  = (v) => Array.isArray(v) ? v : (v ? [v] : []);
const toStr  = (v) => v == null ? "" : String(v).trim();
const toNum  = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "object" && v.$numberDecimal) return Number(v.$numberDecimal);
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const toDate = (v) => {
  if (!v) return null;
  try { const d = new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; }
};
const joinNonEmpty = (...parts) => parts.filter(p => p != null && p !== "").join(" ");

/* ── public: normalize the raw receipt payload ──────────────── */
export function normalizeFileData(receipt = {}) {
  const r = receipt || {};

  const ia = r.ia || r.initialAssessment || {};
  const iaDoctor  = ia.doctor  || r.doctorIA  || {};
  const iaNursing = ia.nursing || r.nursingIA || {};

  return {
    meta: {
      ipdNo:       toStr(r.ipdNo || r.admissionNo),
      uhid:        toStr(r.uhid || r.uhId),
      printedAt:   toDate(r.printedAt) || new Date(),
      printCount:  toNum(r.printCount) || 0,
    },

    patient: {
      fullName:    toStr(r.patientName || r.fullName),
      age:         toNum(r.age),
      gender:      toStr(r.gender || r.sex),
      mobile:      toStr(r.mobile || r.contactNumber || r.phone),
      bloodGroup:  toStr(r.bloodGroup),
      address:     toStr(r.completeAddress || r.address),
    },

    admission: {
      date:            toDate(r.admissionDate || r.admittedAt),
      type:            toStr(r.admissionType),
      modeOfArrival:   toStr(r.modeOfArrival),
      referringDoctor: toStr(r.referringDoctor),
      consultant:      toStr(r.consultantName || r.consultant || r.attendingDoctor),
      department:      toStr(r.department),
      bed:             toStr(r.bedNumber || r.bed),
      ward:            toStr(r.wardName || r.ward),
      reasonForAdmission:   toStr(r.reasonForAdmission),
      provisionalDiagnosis: toStr(r.provisionalDiagnosis),
      workingDiagnosis:     toStr(r.workingDiagnosis),
      finalDiagnosis:       toStr(r.finalDiagnosis),
      icd10:           toStr(r.icd10),
      icd10Desc:       toStr(r.icd10Desc),
      dischargeDate:   toDate(r.dischargeDate || r.dischargedAt),
      totalDays:       toNum(r.totalDays || r.lengthOfStay),
    },

    alerts: {
      allergies:        toArr(r.allergies).map(a => typeof a === "string" ? { allergen: a } : a),
      isolationFlags:   toArr(r.isolationFlags).map(f => toStr(f)).filter(Boolean),
      crossCheckAlerts: toArr(r.crossCheckAlerts || iaNursing.crossCheckAlerts),
    },

    vitals: {
      onAdmission: r.vitalsOnAdmission || {},
      trend:       toArr(r.vitalsTrend || r.vitalSheet),
    },

    history: {
      chief:        toStr(r.chiefComplaints || r.complaints),
      hopi:         toStr(r.history || r.hopi || r.historyOfPresentingIllness),
      medical:      toStr(r.medicalHistory || iaDoctor.briefPmh || iaNursing.briefPmh),
      surgical:     toStr(r.surgicalHistory),
      family:       toStr(r.familyHistory),
      social:       toStr(r.socialHistory),
      obstetric:    iaDoctor.obstetricGynae || iaNursing.obstetricGynae || {},
      immunisation: iaDoctor.immunisation   || iaNursing.immunisation   || {},
      anthropometry:iaDoctor.anthropometry  || iaNursing.anthropometry  || {},
      homeMeds:     toArr(iaDoctor.medicationReconciliation || iaNursing.medicationReconciliation || r.homeMedications),
    },

    exam: {
      generalExam:  toStr(iaDoctor.generalExamination),
      systemicExam: toStr(iaDoctor.systemicExamination),
      ros:          iaDoctor.reviewOfSystems || {},
    },

    investigations: toArr(r.investigations).map(inv => ({
      name:       toStr(inv.name || inv.test),
      orderedAt:  toDate(inv.orderedAt),
      reportedAt: toDate(inv.reportedAt),
      result:     toStr(inv.result || inv.findings),
    })),

    doctorNotes: toArr(r.doctorNotes).map(n => ({
      noteType:   toStr(n.noteType || n.type || "Progress"),
      createdAt:  toDate(n.createdAt || n.date || n.noteDate),
      content:    toStr(n.content || n.text || n.note),
      doctorName: toStr(n.doctorName || n.signedByName),
      signedAt:   toDate(n.signedAt),
      signedBy:   toStr(n.signedBy || n.signedByName),
    })).filter(n => n.createdAt),

    nursingNotes: toArr(r.nursingNotes).map(n => ({
      noteType:   toStr(n.noteType || n.type || "Care note"),
      createdAt:  toDate(n.createdAt || n.date || n.noteDate),
      content:    toStr(n.content || n.text || n.note || n.remarks),
      nurseName:  toStr(n.nurseName || n.signedByName),
      shift:      toStr(n.shift),
      signedAt:   toDate(n.signedAt || n.submittedAt),
    })).filter(n => n.createdAt),

    ia: { doctor: iaDoctor, nursing: iaNursing },

    medications: toArr(r.medications).map(m => ({
      drug:       toStr(m.drug || m.name || m.medicationName),
      generic:    toStr(m.generic),
      dose:       toStr(m.dose || m.strength),
      route:      toStr(m.route),
      frequency:  toStr(m.frequency || m.freq),
      startDate:  toDate(m.startDate),
      endDate:    toDate(m.endDate),
      indication: toStr(m.indication || m.notes),
      givenDoses: toArr(m.givenDoses || m.administrations),
    })),

    procedures: toArr(r.procedures).map(p => ({
      name:        toStr(p.name || p.procedure),
      date:        toDate(p.date),
      surgeon:     toStr(p.surgeon),
      anaesthetist:toStr(p.anesthesia || p.anesthetist || p.anaesthetist),
      findings:    toStr(p.findings),
      notes:       toStr(p.notes),
    })),

    consents: toArr(r.consents).map(c => ({
      name:      toStr(c.name || c.formName),
      signed:    !!c.signed,
      signedAt:  toDate(c.signedAt),
      signedBy:  toStr(c.signedBy),
      witness:   toStr(c.witness),
    })),

    discharge: {
      summary:      toStr(r.dischargeSummary),
      advice:       toStr(r.dischargeAdvice),
      followUpDate: toDate(r.followUpDate),
      condition:    toStr(r.dischargeCondition || r.conditionAtDischarge),
    },

    signatures: {
      consultant: toStr(r.consultantName || r.attendingDoctor),
      mro:        toStr(r.mro || r.medicalRecordsOfficer),
    },
  };
}

/* ── public: chronological event timeline ────────────────────
   Builds a single ordered stream of clinically-significant events
   so the Timeline + Narrative themes can render a true day-diary.
   Each event: { at: Date, kind, actor, summary, detail? }      */
export function buildChronologicalEvents(canonical) {
  const events = [];
  const f = canonical || {};

  if (f.admission?.date) {
    events.push({
      at: f.admission.date, kind: "admission",
      actor: f.admission.consultant,
      summary: joinNonEmpty(
        `Admitted to ${f.admission.ward || "ward"}`,
        f.admission.bed ? `(bed ${f.admission.bed})` : "",
        "under",
        f.admission.consultant ? `Dr. ${f.admission.consultant.replace(/^Dr\.\s*/i, "")}` : "consultant on call",
        f.admission.provisionalDiagnosis ? `— provisional Dx ${f.admission.provisionalDiagnosis}` : "",
      ).trim(),
      detail: f.admission.reasonForAdmission,
    });
  }

  // Initial Assessment (doctor / nursing) — one event each
  if (f.ia?.doctor && Object.keys(f.ia.doctor).length) {
    events.push({
      at: toDate(f.ia.doctor.signedAt) || toDate(f.ia.doctor.assessmentDate) || f.admission.date,
      kind: "ia-doctor",
      actor: f.ia.doctor.signedByName || f.admission.consultant,
      summary: "Doctor Initial Assessment signed",
      detail: f.ia.doctor.briefPmh || f.history.chief,
    });
  }
  if (f.ia?.nursing && Object.keys(f.ia.nursing).length) {
    events.push({
      at: toDate(f.ia.nursing.signedAt) || toDate(f.ia.nursing.submittedAt) || f.admission.date,
      kind: "ia-nursing",
      actor: f.ia.nursing.nurseName || f.ia.nursing.signedByName,
      summary: "Nursing Initial Assessment signed",
      detail: joinNonEmpty(
        f.ia.nursing.identification?.bandAttached === "Yes" ? "Band on." : "",
        f.alerts.allergies.length ? `Allergy: ${f.alerts.allergies.map(a => a.allergen || a.agent || a).join(", ")}` : "",
      ),
    });
  }

  // Doctor notes
  f.doctorNotes.forEach(n => events.push({
    at: n.createdAt, kind: "doctor-note", actor: n.doctorName,
    summary: `${n.noteType}: ${truncate(n.content, 120)}`,
    detail: n.content,
  }));

  // Nursing notes
  f.nursingNotes.forEach(n => events.push({
    at: n.createdAt, kind: "nursing-note", actor: n.nurseName,
    summary: `${n.noteType}${n.shift ? ` (${n.shift})` : ""}: ${truncate(n.content, 120)}`,
    detail: n.content,
  }));

  // Investigations
  f.investigations.forEach(inv => {
    if (inv.orderedAt) events.push({
      at: inv.orderedAt, kind: "lab-order", actor: "",
      summary: `${inv.name} ordered`, detail: "",
    });
    if (inv.reportedAt) events.push({
      at: inv.reportedAt, kind: "lab-report", actor: "",
      summary: `${inv.name} reported${inv.result ? `: ${truncate(inv.result, 80)}` : ""}`,
      detail: inv.result,
    });
  });

  // Procedures
  f.procedures.forEach(p => p.date && events.push({
    at: p.date, kind: "procedure", actor: p.surgeon,
    summary: `Procedure: ${p.name}`,
    detail: joinNonEmpty(p.findings, p.notes),
  }));

  // Medication start / end (each dose-given would be too noisy)
  f.medications.forEach(m => {
    if (m.startDate) events.push({
      at: m.startDate, kind: "med-start", actor: "",
      summary: `Started ${joinNonEmpty(m.drug, m.dose, m.route, m.frequency)}`,
      detail: m.indication,
    });
    if (m.endDate) events.push({
      at: m.endDate, kind: "med-stop", actor: "",
      summary: `Stopped ${joinNonEmpty(m.drug, m.dose)}`,
    });
  });

  // Discharge
  if (f.admission?.dischargeDate) {
    events.push({
      at: f.admission.dischargeDate, kind: "discharge",
      actor: f.signatures.consultant,
      summary: `Discharged${f.discharge.condition ? ` in ${f.discharge.condition} condition` : ""}${f.admission.finalDiagnosis ? ` — final Dx ${f.admission.finalDiagnosis}` : ""}`,
      detail: f.discharge.summary,
    });
  }

  // Sort ascending; events with null `at` sink to the end.
  return events
    .filter(e => e.at instanceof Date && !isNaN(e.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function truncate(s, n) {
  if (!s) return "";
  const str = String(s).replace(/\s+/g, " ").trim();
  return str.length <= n ? str : str.slice(0, n - 1).trimEnd() + "…";
}

/* ── small reusable formatters every theme can import ──────── */
export const fmtDate = (d, withTime = false) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", withTime
      ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(d); }
};

export const fmtTime = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return String(d); }
};

export const fmtDayMonth = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short" });
  } catch { return String(d); }
};

export const pronoun = (gender) => {
  const g = String(gender || "").toLowerCase();
  if (g.startsWith("f")) return { subj: "She", pos: "her", obj: "her" };
  if (g.startsWith("m")) return { subj: "He",  pos: "his", obj: "him" };
  return { subj: "The patient", pos: "their", obj: "them" };
};
