// Components/scribe/scribeApply.js
// Pure mappers: a structured AI-scribe note (from POST /api/clinical-scribe/
// structure) -> per-surface candidate field bags. The host page applies these
// with FILL-EMPTY (scalars) / APPEND-dedupe (rows) semantics so nothing the
// doctor already typed is clobbered. No imports, no side effects — easy to test.

/* first diagnosis text of a given type; falls back to the first diagnosis. */
function dxText(note, type) {
  const list = Array.isArray(note.diagnoses) ? note.diagnoses : [];
  const hit = list.find((d) => d && d.type === type && d.text);
  if (hit) return hit.text;
  return type === "provisional" && list[0] && list[0].text ? list[0].text : "";
}

/* first diagnosis carrying an ICD-10 hint → { code, description }. */
function firstIcd(note) {
  const list = Array.isArray(note.diagnoses) ? note.diagnoses : [];
  const hit = list.find((d) => d && d.icd10Hint);
  return hit ? { code: hit.icd10Hint, description: hit.text || "" } : { code: "", description: "" };
}

/* "3 days" -> { value:"3", unit:"Days" }; unknown -> { value:<raw>, unit:"Days" }. */
function splitDuration(raw) {
  const s = String(raw || "").trim();
  if (!s) return { value: "", unit: "Days" };
  const m = s.match(/(\d+(?:\.\d+)?)\s*(hour|hr|day|week|wk|month|mo|year|yr)/i);
  if (m) {
    const u = m[2].toLowerCase();
    const unit = u.startsWith("hour") || u === "hr" ? "Hours"
      : u.startsWith("week") || u === "wk" ? "Weeks"
      : u.startsWith("month") || u === "mo" ? "Months"
      : u.startsWith("year") || u === "yr" ? "Years"
      : "Days";
    return { value: m[1], unit };
  }
  return { value: s, unit: "Days" };
}

/* "120/80" -> { bp_sys, bp_dia }; spo2 "98%" -> "98". */
function parseVitals(v) {
  const vit = v || {};
  const out = {
    bp_sys: "", bp_dia: "",
    pulse: String(vit.pulse || "").replace(/[^\d.]/g, ""),
    temp: String(vit.temp || "").replace(/[^\d.]/g, ""),
    spo2: String(vit.spo2 || "").replace(/[^\d.]/g, ""),
    rr: String(vit.respRate || "").replace(/[^\d.]/g, ""),
  };
  const bp = String(vit.bp || "").match(/(\d+)\s*\/\s*(\d+)/);
  if (bp) { out.bp_sys = bp[1]; out.bp_dia = bp[2]; }
  return out;
}

const examJoined = (note) => [note.examination && note.examination.general, note.examination && note.examination.systemic]
  .map((s) => String(s || "").trim()).filter(Boolean).join("\n");

const adviceWithFollowUp = (note) => [String(note.advice || "").trim(), note.followUp ? `Follow-up: ${String(note.followUp).trim()}` : ""]
  .filter(Boolean).join("\n");

/* ── OPD Assessment (Frontend/src/pages/doctor/OPDAssessmentPage.jsx) ── */
export function opdFromNote(note) {
  note = note || {};
  const h = note.hopi || {};
  const icd = firstIcd(note);
  const dur = splitDuration(h.duration);
  const soap = note.soap || {};
  return {
    soapPatch: {
      subjectiveNote: note.chiefComplaint || "",
      objectiveNote: soap.objective || examJoined(note),
      assessmentNote: soap.assessment || "",
      planNote: soap.plan || "",
      provisionalDiagnosis: dxText(note, "provisional"),
      workingDiagnosis: dxText(note, "working"),
      finalDiagnosis: dxText(note, "final"),
      icd10Code: icd.code,
      icd10Description: icd.description,
      generalExamination: (note.examination && note.examination.general) || "",
      systemicExamination: (note.examination && note.examination.systemic) || "",
      advice: adviceWithFollowUp(note),
    },
    hopiPatch: {
      onset: h.onset || "",
      durationValue: dur.value,
      durationUnit: dur.unit,
      progression: h.progression || "",
      character: h.character || "",
      associatedSymptoms: Array.isArray(h.associatedSymptoms) ? h.associatedSymptoms : [],
      aggravating: h.aggravatingFactors || "",
      relieving: h.relievingFactors || "",
      narrative: h.narrative || "",
      treatmentTried: h.treatmentTried || "",
    },
    chronic: note.pastHistory ? { conditions: [], others: String(note.pastHistory) } : null,
    medRows: (note.medications || []).map((m) => ({
      name: m.name || "", dose: m.dose || "", frequency: m.frequency || "",
      mealStatus: "", duration: m.duration || "", route: m.route || "Oral", instructions: m.instructions || "",
    })),
    investRows: (note.investigations || []).map((i) => ({
      name: i.name || "", urgency: i.urgency === "STAT" ? "STAT" : "Routine", instructions: i.instructions || "", status: "Ordered",
    })),
  };
}

/* ── IPD daily progress note (Frontend/src/pages/doctor/DoctorNotesPage.jsx) ── */
export function ipdFromNote(note) {
  note = note || {};
  const soap = note.soap || {};
  const icd = firstIcd(note);
  return {
    soap: {
      subjective: soap.subjective || note.chiefComplaint || "",
      objective: soap.objective || examJoined(note),
      assessment: soap.assessment || dxText(note, "working") || dxText(note, "provisional"),
      plan: soap.plan || adviceWithFollowUp(note),
    },
    vitals: parseVitals(note.examination && note.examination.vitals),
    diag: {
      provisional: dxText(note, "provisional"),
      working: dxText(note, "working"),
      final: dxText(note, "final"),
      icd10Code: icd.code,
      icd10Description: icd.description,
    },
    invxString: (note.investigations || []).map((i) => i.name).filter(Boolean).join(", "),
    orderRows: (note.medications || []).map((m) => ({
      type: "medication",
      instruction: m.name || "",
      dose: m.dose || "",
      route: m.route || "",
      frequency: m.frequency || "",
      duration: m.duration || "",
      notes: m.instructions || "",
      priority: "routine",
    })),
  };
}

/* ── Discharge Summary (Frontend/src/pages/clinical/DischargeSummaryPage.jsx) ── */
export function dischargeFromNote(note) {
  note = note || {};
  const icd = firstIcd(note);
  const finalDx = dxText(note, "final") || dxText(note, "working") || dxText(note, "provisional")
    || ((note.diagnoses && note.diagnoses[0] && note.diagnoses[0].text) || "");
  return {
    formPatch: {
      finalDiagnosis: finalDx,
      icdCode: icd.code,
      comorbidities: note.pastHistory || "",
      historyOfPresentIllness: (note.hopi && note.hopi.narrative) || "",
      courseInHospital: note.courseInHospital || (note.soap && note.soap.plan) || "",
      significantFindings: examJoined(note),
      keyInvestigationsText: (note.investigations || []).map((i) => i.name + (i.instructions ? ` — ${i.instructions}` : "")).join("\n"),
      conditionOnDischarge: note.conditionOnDischarge || "",
      specialInstructions: note.advice || "",
      followUpInstructions: note.followUp || "",
      emergencyWarnings: (note.redFlags || []).join("; "),
    },
    medRows: (note.medications || []).map((m) => ({
      drug: m.name || "", dose: m.dose || "", route: m.route || "Oral",
      frequency: m.frequency || "OD", duration: m.duration || "", instructions: m.instructions || "",
    })),
    investRows: (note.investigations || []).map((i) => ({ name: i.name || "", result: "", unit: "", status: "" })),
    procRows: [],
  };
}
