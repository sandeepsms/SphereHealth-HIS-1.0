/**
 * PatientPanelTabs — shared tab components used by both DoctorPatientPanel
 * and NursePatientPanel.
 *
 * Per the user's spec:
 *   1. First tab: Initial Assessment (Doctor + Nursing combined)
 *   2. Second tab: MLC (if patient has one) OR Doctor Notes
 *   3. Nursing Notes — categorized + FULLY EXPANDABLE for proper reading
 *      and printing
 *   4. Vital Chart
 *   5. Input / Output Chart
 *   6. Blood Transfusion Records
 *   7. RBS Monitoring + Medication for the same
 *
 * Every section is rendered FULLY EXPANDED — no truncation, no "show
 * more" tease — so the printable view shows the entire record. Styles
 * live in patient-panel-tabs.css.
 */

import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import SecureImage from "../SecureImage";
import { useInlinedUploadsHtml } from "../../utils/secureUploads";
import "./patient-panel-tabs.css";
// R7gn — Reuse the SAME per-type card builders that the Complete File
// (Narrative.jsx) prints. The patient panel was showing a generic
// expanded-note skeleton; the user wants the live panel to mirror the
// Complete File 1:1 — same admission/ICU/procedure/discharge/consult
// templates, same headers, same vitals tables.
import { buildDoctorNoteCardHtml } from "../../pages/doctor/buildDoctorNoteCardHtml";
import { buildNurseNoteCardHtml }  from "../../pages/nursing/printNurseNote";
// R7hs — The Initial Assessment tab renders the doctor + nurse IA through the
// SAME comprehensive prose renderer that the Complete IPD File print and the
// individual IA print use, so the panel IA is 1:1 with the print. The per-type
// note-card builders (buildDoctorNoteCardHtml / buildNurseNoteCardHtml) are a
// LESS-comprehensive renderer and stay in use only for the day-wise timelines.
import { buildInitialAssessmentHtml } from "@/Components/print/printables/patientFileThemes/buildInitialAssessmentHtml";
import { getVitalSheet } from "../../Services/vital/vitalService";

/* ──────────────────────── Formatters ───────────────────────── */
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// R7gn — Day-bucket helpers (same shape as Narrative.jsx so the panel
// view and the printed Complete File group identically).
const dayKey = (d) => {
  if (!d) return "";
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ""; }
};
const dayHeading = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", weekday: "short",
    });
  } catch { return String(d); }
};
const dayNumber = (eventDate, admissionDate) => {
  if (!eventDate || !admissionDate) return null;
  const a = new Date(admissionDate);
  const e = new Date(eventDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(e.getTime())) return null;
  const diff = Math.floor((dayKeyToMidnight(e) - dayKeyToMidnight(a)) / 86_400_000);
  return diff >= 0 ? diff + 1 : null;
};
const dayKeyToMidnight = (d) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime();
};

/* R7gn — Wraps the Complete File per-type card HTML so the patient
   panel and the printed file show identical artwork. The builder
   returns a self-contained HTML string with its own inline styles
   (.dfx-* / .nfx-* classes) — safe to drop in via dangerouslySetInnerHTML.
*/
function NoteCardEmbed({ note, role, hideNursingExtras = false }) {
  // R7hr-100 — hideNursingExtras forwards to buildDoctorNoteCardHtml so
  // the Initial Assessment tab can suppress the "NURSING INTAKE — CROSS-
  // DISCIPLINARY" block when no separate Nurse IA exists. Default false
  // preserves all existing call sites (prints, timelines, MLC tab).
  // R7hr — PROSE arrangement (same as the Complete IPD File print) so the
  // patient-panel note view matches the launch-ready file layout everywhere.
  const rawHtml = role === "nurse"
    ? buildNurseNoteCardHtml(note, { prose: true })
    : buildDoctorNoteCardHtml(note, { prose: true, hideNursingExtras });
  // /uploads signature images are JWT-gated — resolve them to data: URLs
  // through the authenticated axios pipe before injecting the markup
  // (a raw <img src="/uploads/…"> can't send the Authorization header).
  const html = useInlinedUploadsHtml(rawHtml);
  return (
    <div
      className={`ppt-embed-card ppt-embed-card--${role}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   R7hs — Initial-Assessment adapters + shared-renderer embed.

   A saved IA note stores its role-specific data under nested NABH wrappers
   (mirrors IPDInitialAssessmentPage's save payload L1679-1775 and its restore
   L1421-1571):
     • Doctor : note.noteDetails.doctor  +  note.noteDetails.doctor.nabh
                (plus top-level mirrors chiefComplaint / provisionalDiagnosis …)
     • Nurse  : note.noteDetails.nursing +  note.noteDetails.nursingNabh
                (or, on the mirrored NursingNotes row, note.noteData.nursing +
                 note.noteData.nursingNabh)

   The shared prose renderer buildInitialAssessmentHtml expects the CANONICAL
   nested shape (renderDoctor / renderNursing). adaptDoctor / adaptNursing map
   the raw saved keys → canonical, using the SAME field aliases as Narrative's
   `iaForFile` (L1184-1284) and IPDInitialAssessmentPage's `buildIaFromState`
   (L1789-1893) so the panel output is identical to the two print surfaces.
   ═══════════════════════════════════════════════════════════════════════ */

// Flatten the doctor note the way IPDInitialAssessmentPage restore reads it:
// nabh wrapper first (so its canonical NABH keys are visible), then the plain
// doctor block, then the note's top-level mirrors. Later spreads win on a key
// collision — top-level mirrors (chiefComplaint etc.) override, matching
// normalizeData.js L124-126's "flat legacy field wins" precedence.
function adaptDoctor(note) {
  if (!note || typeof note !== "object") return {};
  const doc = note.noteDetails?.doctor || {};
  const d = { ...(doc.nabh || {}), ...doc, ...note };

  return {
    doctorName: d.doctorName || d.signedByName || d.signedBy,
    regNo: d.regNo || d.signedByReg || d.mciRegNo,
    assessedAt: d.assessmentDate || d.signedAt || d.createdAt,
    // chiefComplaint (nabh/top-level) → chiefComplaints; hopi is the CC fallback.
    chiefComplaints: d.chiefComplaints || d.chiefComplaint || d.cc,
    ccDuration: d.ccDuration,
    hopi: d.hopi || d.historyOfPresentIllness || d.historyOfPresentingIllness,
    // R7hr-70 — structured PSH/Fam/Soc summaries feed History; legacy strings fall back.
    pastMedical: d.pastMedical || d.pmh || d.briefPmh || d.pastMedicalHistory,
    pastSurgical: d.pastSurgical || d.psh,
    familyHistory: d.familyHistory || d.famHx,
    socialHistory: d.socialHistory || d.socHx,
    comorbidities: d.comorbidities || null,
    allergies: {
      noKnown: d.allergies?.noKnown ?? d.noKnownAllergies,
      list: d.allergies?.list || [],
    },
    medReconciliation: Array.isArray(d.medicationReconciliation)
      ? d.medicationReconciliation
      : (Array.isArray(d.medReconciliation) ? d.medReconciliation : []),
    clinicalExamination: {
      general: d.clinicalExamination?.general || d.generalExamination || d.genExam,
      systemic: d.clinicalExamination?.systemic || d.systemicExamination,
      cvs: d.clinicalExamination?.cvs || d.cvs,
      rs: d.clinicalExamination?.rs || d.rs,
      abdomen: d.clinicalExamination?.abdomen || d.abdomen,
      cns: d.clinicalExamination?.cns || d.cns,
      ros: d.clinicalExamination?.ros || d.reviewOfSystems || d.ros || {},
    },
    localExam: (typeof d.localExamination === "string" ? d.localExamination : "") || d.localExam,
    provisionalDiagnosis: d.provisionalDiagnosis || d.provDx,
    workingDiagnosis: d.workingDiagnosis || d.workingDx,
    finalDiagnosis: d.finalDiagnosis || d.finalDx,
    icd10: d.icd10 || d.icdCode,
    icd10Description: d.icd10Description || d.icdDescription,
    patientStatus: d.patientStatus,
    differentialDiagnosis: d.differentialDiagnosis || d.differentialDx,
    anthropometry: d.anthropometry || {},
    investigations: Array.isArray(d.invests)
      ? d.invests
      : (Array.isArray(d.investigations) ? d.investigations : []),
    investigationsText: typeof d.investigations === "string" ? d.investigations : (d.plannedInvestigations || ""),
    treatmentPlan: d.treatmentPlan,
    // Structured Rx (meds) preferred; legacy rxRows fall back.
    prescription: (Array.isArray(d.meds) && d.meds.length)
      ? d.meds.map((m) => ({
          drug: m.drug || m.name, dose: m.dose, route: m.route, frequency: m.frequency,
          duration: m.duration, instructions: m.instructions,
          dilutionVolume: m.dilutionVolume, dilutionFluid: m.dilutionFluid,
          infuseOverMinutes: m.infuseOverMinutes,
        }))
      : (Array.isArray(d.prescription) ? d.prescription
         : (Array.isArray(d.rxRows) ? d.rxRows : [])),
    infusions: Array.isArray(d.infusions) ? d.infusions : [],
    codeStatus: (typeof d.codeStatus === "object" && d.codeStatus) ? d.codeStatus.value : d.codeStatus,
    codeStatusDiscussedWith: (typeof d.codeStatus === "object" && d.codeStatus) ? d.codeStatus.discussedWith : d.codeStatusDiscussedWith,
    codeStatusLimitations: (typeof d.codeStatus === "object" && d.codeStatus) ? d.codeStatus.limitations : d.codeStatusLimitations,
    elosDays: d.elosDays,
    goalOfCare: d.goalOfCare,
    riskAcknowledgement: d.riskAcknowledgement || null,
    referrals: Array.isArray(d.referrals) ? d.referrals : [],
    prognosis: (typeof d.prognosis === "object" && d.prognosis) ? d.prognosis : (d.prognosis ? { summary: d.prognosis } : {}),
    consentNeeded: d.consentNeeded || d.consentRequired || d.consentsRequired || {},
    obGyn: d.obstetricGynae || d.obGyn || {},
    immunisation: d.immunisationStatus || d.immunisation || {},
    ecog: (typeof d.functionalEcog === "object" && d.functionalEcog) ? d.functionalEcog : (d.functionalEcog ? { score: d.functionalEcog } : (d.ecog || {})),
    spiritual: d.spiritualNeeds || d.spiritual || {},
    dietAdvice: d.dietAdvice,
    activityAdvice: d.activityAdvice,
    followupNotes: d.followupNotes || d.followUp,
    signedBy: {
      name: d.signedByName || d.signedBy || d.doctorName,
      reg: d.signedByReg || d.mciRegNo || d.regNo,
      empId: d.signedByEmpId || d.doctorEmpId,
      at: d.signedAt || d.assessmentDate,
    },
  };
}

// Flatten the nurse note: nursingNabh first, then the plain nursing block, then
// the noteData.* mirror (NursingNotes row), then the note top-level.
function adaptNursing(note) {
  if (!note || typeof note !== "object") return {};
  const nabh = note.noteDetails?.nursingNabh || note.noteData?.nursingNabh || {};
  const nur = note.noteDetails?.nursing || note.noteData?.nursing || {};
  const n = { ...nabh, ...nur, ...note };

  const score = (obj) =>
    (obj && typeof obj === "object")
      ? { total: obj.total ?? obj.score, meta: obj.meta, risk: obj.risk || obj.band }
      : null;

  return {
    admission: {
      date: n.admitDate, time: n.admitTime, ipdNo: n.ipdNo,
      mode: n.modeOfAdmit || n.modeOfAdmission, ward: n.ward, bed: n.bedNo,
      consciousness: n.consciousnessLevel,
      mobility: typeof n.mobility === "string" ? n.mobility : "",
    },
    identification: n.identification || n.idBand || {},
    vitals: n.vitals || {},
    anthropometry: n.anthropometry || {},
    allergies: {
      noKnown: n.allergies?.noKnown ?? n.noKnownAllergies ?? n.nurseNoKnownAllergies,
      list: n.allergies?.list || [],
    },
    briefHistory: n.briefPmh || n.briefHistory || n.nurseBriefPmh,
    homeMeds: Array.isArray(n.homeMedications) ? n.homeMedications
              : (Array.isArray(n.homeMeds) ? n.homeMeds : []),
    pain: n.pain || {
      present: n.painPresent, score: n.painScore,
      location: n.painLocation, character: n.painCharacter,
    },
    morse: score(n.morse),
    braden: score(n.braden),
    // saved as `nutri`; renderer reads `nutrition`. Carry the quick-screen too.
    nutrition: (() => {
      const s = score(n.nutrition || n.nutri);
      const quick = n.nutritionalScreeningQuick || n.nutrition?.quick || n.nutri?.quick;
      if (!s && !quick) return null;
      return { ...(s || {}), quick };
    })(),
    vte: score(n.vte),
    dvt: score(n.dvt),
    gcs: score(n.gcs),
    psychosocial: (typeof n.psychosocial === "object" && n.psychosocial) ? n.psychosocial : {},
    barthel: n.adlBarthel || n.barthel || n.adl || {},
    bodyChart: n.bodyChart || {},
    precautions: n.specialPrecautions || n.precautions || {},
    education: (typeof (n.educationNeeds || n.education) === "object") ? (n.educationNeeds || n.education) : {},
    dischargePlanning: (typeof n.dischargePlanning === "object" && n.dischargePlanning) ? n.dischargePlanning : {},
    cognitive: (typeof (n.cognitiveCommunication || n.cognitive) === "object") ? (n.cognitiveCommunication || n.cognitive) : {},
    cultural: n.culturalSpiritual || n.cultural || {},
    elimination: (typeof (n.bowelBladder || n.elimination) === "object") ? (n.bowelBladder || n.elimination) : {},
    sleep: (typeof (n.sleepPattern || n.sleep) === "object") ? (n.sleepPattern || n.sleep) : {},
    valuables: n.valuablesBelongings || n.valuables || {},
    caregiver: (typeof (n.familyCaregiver || n.caregiver) === "object") ? (n.familyCaregiver || n.caregiver) : {},
    highRisk: n.highRiskFlags || n.highRisk || {},
    mobility: (typeof (n.mobilityGait || n.mobility) === "object") ? (n.mobilityGait || n.mobility) : (n.mobility || {}),
    preAnaesthesia: n.preAnaesthesia || {},
    prom: n.promPremTriggers || n.prom || {},
    plan: {
      problems: n.nursingProblems || n.plan?.problems,
      goals: n.nursingGoals || n.plan?.goals,
      notes: n.nursingNotes || n.plan?.notes,
    },
    signedBy: {
      name: n.nurseName || n.signedByName || n.signedBy,
      reg: n.signedByReg || n.nurseRegNo,
      empId: n.signedByEmpId || n.nurseEmployeeId,
      at: n.signedAt || n.submittedAt,
    },
  };
}

/* Renders a single IA note (doctor OR nurse) through the shared prose renderer,
   inlining any /uploads signature images through the authenticated pipe just
   like NoteCardEmbed. */
function IAEmbed({ note, role }) {
  const ia = role === "nurse"
    ? { role: "nurse", nursing: adaptNursing(note) }
    : { role: "doctor", doctor: adaptDoctor(note) };
  const rawHtml = buildInitialAssessmentHtml(ia, { prose: true });
  const html = useInlinedUploadsHtml(rawHtml);
  if (!html) return null;
  return (
    <div
      className={`ppt-embed-card ppt-embed-card--${role}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* R7gn — Group notes by calendar day; entries inside a day are kept
   in chronological order (oldest-first) — matches Complete File.
   Day buckets themselves are ordered most-recent-day-first so the
   doctor on rounds sees today's notes at the top. */
function groupByDayChrono(notes, getAt) {
  const map = new Map();
  (notes || []).forEach((n) => {
    const at = getAt(n);
    const k = dayKey(at);
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(n);
  });
  // Oldest-first within each day
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(getAt(a)) - new Date(getAt(b)));
  }
  // Most-recent day first
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

/* R7hr-230 — The patient panel shows SIGNED clinical notes only. An unsigned
   DRAFT is private to its author (like an unsent WhatsApp message): it stays
   editable on the Doctor / Nursing Notes compose page, where the author can
   continue or clear it, and only appears here for the rest of the team once it
   has been signed & submitted. Doctor notes sign to status "signed"; nurse
   notes to "submitted" (or "signed"). Everything else is treated as a draft and
   hidden from the panel timelines. */
const isSignedNote = (n) => !!n && (n.status === "signed" || n.status === "submitted");

/* ────────────────────────────────────────────────────────────────
   1. InitialAssessmentTab
   ────────────────────────────────────────────────────────────────
   Combines Doctor's initial assessment + Nurse's initial assessment
   so the team sees the full intake picture in one place.
*/
export function InitialAssessmentTab({ doctorNotes = [], nursingNotes = [], admission }) {
  // R7hr-120 — section-aware split. After R26 the Doctor IA and Nurse IA
  // BOTH live in the DoctorNotes collection with noteType:"initial" but
  // differ by `section` ("doctor" vs "nursing"). Pre-fix the filter just
  // matched on noteType so the Nurse IA landed in the doctor bucket and
  // the "Nursing Initial Assessment" card never rendered — even though
  // the gate flag was flipped and the count badge said "2". Now we route
  // section="nursing" rows from DoctorNotes into nurseInitial, alongside
  // any legacy NurseNotes collection rows. Legacy doctor notes without a
  // section field still default to the doctor bucket (treat unknown as
  // doctor to preserve old data).
  const _allInitialFromDocCol = doctorNotes.filter(
    (n) => n.noteType === "initial" || n.noteType === "initialAssessment",
  );
  const _isNurseSection = (n) => {
    if (n.section === "nursing") return true;
    if (n.section === "doctor") return false;
    // Pre-R26 fallback — sniff wrappers when section is missing.
    if (n.noteDetails?.nursing || n.noteDetails?.nursingNabh) {
      const hasDoctorWrappers = !!(n.noteDetails?.doctor || n.noteDetails?.nabh);
      if (!hasDoctorWrappers) return true;
    }
    return false;
  };
  // R7hr-230 — signed-only on the panel; a draft IA stays editable on the
  // Initial Assessment compose page until signed.
  const docInitial         = _allInitialFromDocCol.filter((n) => !_isNurseSection(n)).filter(isSignedNote);
  const _nurseInDocCol     = _allInitialFromDocCol.filter(_isNurseSection);
  const _nurseFromNurseCol = nursingNotes.filter((n) => n.noteType === "initial" || n.noteType === "initialAssessment");
  const nurseInitial       = [..._nurseInDocCol, ..._nurseFromNurseCol].filter(isSignedNote);

  // R7hr-109 — Read-side fallback for empty Admission Summary fields.
  // Receptionist registration doesn't enforce Reason for Admission or
  // Provisional Diagnosis (often the doctor only firms those up during
  // first assessment), so without a fallback the card stays "—" forever.
  // The Doctor IA sign now backfills the admission record (backfillAdmissionFromIA),
  // but for already-signed historical records we also derive on the read
  // side so the card lights up without a re-sign cycle. R25-safe — purely
  // additive; the admission field stays the source of truth when filled.
  const _docIAsorted = [...docInitial].sort(
    (a, b) => new Date(b.signedAt || b.createdAt || 0) - new Date(a.signedAt || a.createdAt || 0)
  );
  const _latestDocIA = _docIAsorted[0] || null;
  // R7hs — latest signed nurse IA (newest by signedAt/noteDate/createdAt), fed
  // to the shared renderer the same way the doctor card is.
  const _latestNurseIA = [...nurseInitial].sort(
    (a, b) => new Date(b.signedAt || b.noteDate || b.createdAt || 0) - new Date(a.signedAt || a.noteDate || a.createdAt || 0)
  )[0] || null;
  const _isBlank = (v) => v == null || String(v).trim() === "" || String(v).trim() === "—";
  const _derivedChiefComplaint =
    _latestDocIA?.chiefComplaint ||
    _latestDocIA?.noteDetails?.nabh?.chiefComplaint ||
    // R7hr-109 — last-resort fallback to HOPI. The legacy DoctorNotes schema
    // strict-stripped top-level chiefComplaint (it isn't a defined field), so
    // for historic signed IAs the only populated free-text complaint is
    // noteDetails.doctor.hopi. Better to surface that than render "—".
    _latestDocIA?.noteDetails?.doctor?.hopi ||
    _latestDocIA?.historyOfPresentIllness ||
    "";
  const _derivedProvDx =
    _latestDocIA?.provisionalDiagnosis ||
    _latestDocIA?.noteDetails?.doctor?.provDx ||
    "";
  const _reasonForAdmission = _isBlank(admission?.reasonForAdmission)
    ? _derivedChiefComplaint
    : admission?.reasonForAdmission;
  const _provisionalDiagnosis = _isBlank(admission?.provisionalDiagnosis)
    ? _derivedProvDx
    : admission?.provisionalDiagnosis;

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">🩺 Initial Assessment</h2>
        <p className="ppt-tab-sub">Combined doctor + nursing intake records (NABH COP.2 + IPSG.6)</p>
      </div>

      {admission && (
        <div className="ppt-card ppt-card--admission hga-enter-fade">
          <div className="ppt-section-title">Admission Summary</div>
          <div className="ppt-detail-grid">
            <Field label="IPD / Admission No." value={admission.admissionNumber} mono />
            <Field label="Admitted On"          value={fmtDateTime(admission.admissionDate)} />
            <Field label="Reason for Admission" value={_reasonForAdmission} wide />
            <Field label="Provisional Diagnosis" value={_provisionalDiagnosis} wide />
            <Field label="Attending Doctor"     value={admission.attendingDoctor} />
            <Field label="Department"           value={admission.department} />
            <Field label="Bed / Ward"           value={[admission.bedNumber, admission.wardName].filter(Boolean).join(" — ")} />
          </div>
        </div>
      )}

      {/* R7gp — Doctor + Nurse initial assessments now use the same
          per-type card builders the printed Complete File uses. Replaces
          the legacy DoctorNoteExpanded/NurseNoteExpanded fallback that
          rendered noteDetails.nabh as raw stringified JSON. */}
      <div className="ppt-card ppt-card--doctor">
        <div className="ppt-section-title">
          <span className="ppt-section-icon">👨‍⚕️</span>
          Doctor's Initial Assessment
          <span className={`ppt-badge ${docInitial.length ? "ppt-badge--ok" : "ppt-badge--warn"}`}>
            {docInitial.length ? `${docInitial.length} record(s)` : "Not recorded"}
          </span>
        </div>
        {docInitial.length === 0 ? (
          <div className="ppt-empty">
            ⚠️ Doctor's initial assessment is mandatory before any further documentation. NABH COP.2.
          </div>
        ) : (
          // R7hs — Render the LATEST signed doctor IA through the SHARED prose
          // renderer (buildInitialAssessmentHtml) so the panel matches the
          // Complete IPD File print and the individual IA print 1:1. Initial
          // Assessment is one clinical record; amendments / re-sign attempts can
          // leave older rows, so we show only the most current sign
          // (_latestDocIA — already the newest by signedAt/createdAt).
          <IAEmbed key={_latestDocIA._id} note={_latestDocIA} role="doctor" />
        )}
      </div>

      {/* R7hr-95 — Hide the entire Nursing IA card until a nurse has
          actually submitted/signed their Initial Assessment. The
          earlier "Not recorded · Nursing initial assessment pending"
          placeholder confused doctors when they opened a freshly-
          admitted patient's IA panel before the nurse had filled
          anything. Now the section appears only after the nurse
          actually contributes a record — nurses fill theirs from the
          dedicated Nursing Initial Assessment tile, not from this
          aggregate view. */}
      {nurseInitial.length > 0 && (
        <div className="ppt-card ppt-card--nurse">
          <div className="ppt-section-title">
            <span className="ppt-section-icon">👩‍⚕️</span>
            Nursing Initial Assessment
            <span className="ppt-badge ppt-badge--ok">
              {nurseInitial.length} record(s)
            </span>
          </div>
          {/* R7hs — LATEST signed nurse IA via the SHARED prose renderer. */}
          {_latestNurseIA && <IAEmbed key={_latestNurseIA._id} note={_latestNurseIA} role="nurse" />}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   2. MLCOrDoctorNotesTab
   ────────────────────────────────────────────────────────────────
   If the patient has an MLC on record → show MLC details (+ a quick
   link to the full MLC page). Otherwise → show doctor notes timeline
   fully expanded.
*/
export function MLCOrDoctorNotesTab({ patient, doctorNotes = [], admission }) {
  const [mlcList, setMlcList]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const uhid = patient?.UHID;

  // FIX (audit P27-B1): cancel late stale fetches on rapid UHID changes
  // so the prior patient's MLC list doesn't flash into the new patient's
  // panel.
  useEffect(() => {
    if (!uhid) return;
    let cancelled = false;
    setLoading(true);
    axios.get(`${API_ENDPOINTS.MLC}?UHID=${encodeURIComponent(uhid)}&limit=50`)
      .then((r) => { if (!cancelled) setMlcList(r.data?.data || []); })
      .catch(() => { if (!cancelled) setMlcList([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uhid]);

  const hasMLC = mlcList.length > 0;
  const nonInitialDocNotes = doctorNotes.filter(
    (n) => n.noteType !== "initial" && n.noteType !== "initialAssessment" && isSignedNote(n), // R7hr-230 — signed-only
  );

  // R7gn — Day-wise group, same shape as Complete File Narrative theme.
  const admissionDate = admission?.admissionDate || admission?.date;
  const daysByDate = useMemo(
    () => groupByDayChrono(nonInitialDocNotes, (n) => n.noteDate || n.visitDate || n.createdAt),
    [nonInitialDocNotes],
  );

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">
          {hasMLC ? "⚖ Medico-Legal Case (MLC)" : "🩺 Doctor Notes"}
        </h2>
        <p className="ppt-tab-sub">
          {hasMLC
            ? "This patient has one or more medico-legal cases on file. Doctor notes follow."
            : "Doctor's clinical notes — admission, daily progress, ICU, procedure, consultation, pre/post-op, etc. Same per-type cards as the printed Complete File."}
        </p>
      </div>

      {loading && <div className="ppt-empty"><i className="pi pi-spin pi-spinner" /> Loading MLC records…</div>}

      {hasMLC && mlcList.map((m) => <MLCExpanded key={m._id} mlc={m} />)}

      <div className="ppt-card">
        <div className="ppt-section-title">
          <span className="ppt-section-icon">📝</span>
          Doctor Notes Timeline
          <span className="ppt-badge ppt-badge--info">{nonInitialDocNotes.length} note(s)</span>
        </div>
        {nonInitialDocNotes.length === 0 ? (
          <div className="ppt-empty">No further doctor notes yet.</div>
        ) : (
          daysByDate.map(([k, notes]) => {
            const dn = dayNumber(k, admissionDate);
            return (
              <div key={k} className="ppt-day-block">
                <div className="ppt-day-heading">
                  {dn ? <span className="ppt-day-num">Day {dn}</span> : null}
                  <span className="ppt-day-date">{dayHeading(k)}</span>
                  <span className="ppt-day-count">{notes.length} note{notes.length === 1 ? "" : "s"}</span>
                </div>
                {notes.map((n) => <NoteCardEmbed key={n._id} note={n} role="doctor" />)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   3. NursingNotesExpandedTab
   ────────────────────────────────────────────────────────────────
   Categorised list of nursing notes, fully expanded for reading +
   printing. Categories: General, Vitals, Pain, Neuro/GCS, Intake/
   Output, IV Infusion, Blood Transfusion, Wound, Skin, Fall Risk,
   Procedure, Discharge/SBAR, MEWS.
*/
export function NursingNotesExpandedTab({ nursingNotes = [], admission }) {
  // R7gn — Layout matches Complete File: day-wise blocks, each entry
  // rendered with the SAME per-type card builder Narrative.jsx uses for
  // print. The previous "group by type" layout buried the timeline; the
  // user wants chronological journey parity with the printed file.
  const filtered = useMemo(
    () => (nursingNotes || []).filter((n) => n.noteType !== "initial" && n.noteType !== "initialAssessment" && isSignedNote(n)), // R7hr-230 — signed-only
    [nursingNotes],
  );
  const admissionDate = admission?.admissionDate || admission?.date;
  const daysByDate = useMemo(
    () => groupByDayChrono(filtered, (n) => n.noteDate || n.createdAt),
    [filtered],
  );

  // Type-count chips at the top — quick scan of what's been written.
  const typeCounts = useMemo(() => {
    const m = {};
    filtered.forEach((n) => { const t = n.noteType || "general"; m[t] = (m[t] || 0) + 1; });
    return m;
  }, [filtered]);
  const TYPE_LABEL = {
    general: "📋 General", vitals: "📈 Vitals", pain: "😣 Pain", neuro: "🧠 Neuro/GCS",
    intake: "💧 I/O", iv: "🩸 IV", blood: "🩸 Blood Transfusion", wound: "🩹 Wound",
    skin: "🌡️ Skin", fall: "⚠️ Fall", procedure: "⚙️ Procedure", discharge: "📤 Discharge/SBAR",
    mews: "📊 MEWS", daily: "🗓️ Daily", careplan: "💚 Care Plan", nutrition: "🍎 Nutrition",
    education: "📚 Education",
  };

  // R7hu — attach each vitals note's day VitalSheet so its card shows that
  // day's hourly grid (matching the Complete File print + the nurse timeline)
  // instead of a single snapshot. Self-contained fetch — vitals notes
  // dual-write the sheet on save, so it's always available; the card falls
  // back to the snapshot until the sheet loads.
  const _vsUhid = (nursingNotes || []).map((n) => n.patientUHID || n.UHID).find(Boolean)
    || admission?.UHID || admission?.patientId?.UHID || admission?.uhid;
  const [vitalSheets, setVitalSheets] = useState({});
  const vitalDateKey = (n) => {
    const d = new Date(n?.noteDate || n?.visitDate || n?.createdAt || 0);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  useEffect(() => {
    if (!_vsUhid) return;
    const want = [...new Set(filtered.filter((n) => n.noteType === "vitals").map(vitalDateKey).filter(Boolean))]
      .filter((d) => !(d in vitalSheets));
    if (!want.length) return;
    let cancelled = false;
    (async () => {
      const pairs = await Promise.all(want.map(async (date) => {
        try {
          const res = await getVitalSheet(_vsUhid, date);
          const s = res?.data && Array.isArray(res.data.tableData) ? res.data
                  : Array.isArray(res?.tableData) ? res : null;
          return [date, s];
        } catch { return [date, null]; }
      }));
      if (!cancelled) setVitalSheets((prev) => { const nx = { ...prev }; pairs.forEach(([d, s]) => { nx[d] = s; }); return nx; });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, _vsUhid]);
  const withSheet = (n) =>
    (n.noteType === "vitals" && vitalSheets[vitalDateKey(n)])
      ? { ...n, vitalSheet: vitalSheets[vitalDateKey(n)] }
      : n;

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">📝 Nursing Notes — Chronological Journey</h2>
        <p className="ppt-tab-sub">
          Day-wise, ordered the same way as the printed Complete File · {filtered.length} record(s)
        </p>
      </div>

      {Object.keys(typeCounts).length > 0 && (
        <div className="ppt-chip-list" style={{ marginBottom: 12 }}>
          {Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => (
              <span key={t} className="ppt-chip ppt-chip--info">
                {TYPE_LABEL[t] || t} · {n}
              </span>
            ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="ppt-empty">No nursing notes recorded yet.</div>
      ) : (
        daysByDate.map(([k, notes]) => {
          const dn = dayNumber(k, admissionDate);
          return (
            <div key={k} className="ppt-day-block">
              <div className="ppt-day-heading">
                {dn ? <span className="ppt-day-num">Day {dn}</span> : null}
                <span className="ppt-day-date">{dayHeading(k)}</span>
                <span className="ppt-day-count">{notes.length} note{notes.length === 1 ? "" : "s"}</span>
              </div>
              {notes.map((n) => <NoteCardEmbed key={n._id} note={withSheet(n)} role="nurse" />)}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   4. VitalChartTab
   ────────────────────────────────────────────────────────────────
   Tabular trend of vitals across every nursing note that captured
   them. Print-friendly grid.
*/
export function VitalChartTab({ nursingNotes = [], vitalSheet = [] }) {
  const rows = useMemo(() => {
    const vNotes = nursingNotes
      .filter((n) => n.vitals && (n.vitals.bp || n.vitals.pulse || n.vitals.temp || n.vitals.spo2 || n.vitals.rr))
      .map((n) => ({
        when: n.noteDate || n.createdAt,
        by:   n.nurseName || "—",
        bp:   n.vitals?.bp ? `${n.vitals.bp.systolic || "—"}/${n.vitals.bp.diastolic || "—"}` : "—",
        pulse:n.vitals?.pulse,
        temp: n.vitals?.temp,
        rr:   n.vitals?.rr,
        spo2: n.vitals?.spo2,
        bsl:  n.vitals?.bloodSugar,
        gcs:  n.noteData?.glasgowComaScale || n.noteData?.gcs,
        src:  "Nursing",
      }));
    const vsRows = (vitalSheet || []).map((v) => ({
      when: v.recordedAt || v.createdAt,
      by:   v.recordedBy || "—",
      bp:   v.bloodPressure || (v.bp ? `${v.bp.systolic||"—"}/${v.bp.diastolic||"—"}` : "—"),
      pulse:v.pulse,
      temp: v.temperature || v.temp,
      rr:   v.respiratoryRate || v.rr,
      spo2: v.oxygenSaturation || v.spo2,
      bsl:  v.bloodSugar,
      gcs:  v.glasgowComaScale || v.gcs,
      src:  "Vital Sheet",
    }));
    // FIX (audit P27-B5): de-dupe nursing-note vitals against vital-sheet
    // entries that landed at the same minute (some nursing flows write
    // both). Key on minute-precision timestamp + recorder name.
    const merged = [...vNotes, ...vsRows];
    const seen = new Set();
    const deduped = merged.filter((r) => {
      const minute = r.when ? new Date(r.when).toISOString().slice(0, 16) : "";
      const key = `${minute}|${r.by}|${r.bp || ""}|${r.pulse || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return deduped.sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [nursingNotes, vitalSheet]);

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">📈 Vital Chart</h2>
        <p className="ppt-tab-sub">All vital recordings — nursing notes + dedicated vital sheets · {rows.length} entries</p>
      </div>
      {rows.length === 0 ? (
        <div className="ppt-empty">No vital recordings yet.</div>
      ) : (
        <div className="ppt-table-wrap">
          <table className="ppt-table">
            <thead>
              <tr>
                <th>Recorded At</th>
                <th>By</th>
                <th>BP</th>
                <th>Pulse</th>
                <th>Temp</th>
                <th>RR</th>
                <th>SpO₂</th>
                <th>BSL</th>
                <th>GCS</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={isAbnormal(r) ? "ppt-tr--alert" : ""}>
                  <td>{fmtDateTime(r.when)}</td>
                  <td>{r.by}</td>
                  <td>{r.bp || "—"}</td>
                  <td>{r.pulse ?? "—"}</td>
                  <td>{r.temp != null ? `${r.temp}°F` : "—"}</td>
                  <td>{r.rr ?? "—"}</td>
                  <td>{r.spo2 != null ? `${r.spo2}%` : "—"}</td>
                  <td>{r.bsl != null ? `${r.bsl} mg/dL` : "—"}</td>
                  <td>{r.gcs ?? "—"}</td>
                  <td className="ppt-cell-src">{r.src}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function isAbnormal(r) {
  const p = Number(r.pulse);
  const sp = Number(r.spo2);
  const t = Number(r.temp);
  const bsl = Number(r.bsl);
  return (p && (p > 100 || p < 60)) ||
         (sp && sp < 94) ||
         (t && t > 100.4) ||
         (bsl && (bsl > 180 || bsl < 70));
}

/* ────────────────────────────────────────────────────────────────
   5. IntakeOutputChartTab
   ────────────────────────────────────────────────────────────────
   Daily I/O summary aggregated from nursing notes' `intakeOutput`.
*/
export function IntakeOutputChartTab({ nursingNotes = [] }) {
  // R7az-D5-MED-2 / D5-MED-9 — Match the full set of intake & output
  // buckets that NursingNotes.jsx actually writes:
  //   intake : oral, ivFluids, ivMedFluids, bloodProducts
  //   output : urineOutput, otherOutput, nasogastricOutput
  // Pre-fix the chart only added oral+ivFluids on the intake side and
  // urineOutput+otherOutput on the output side — so IV-med volumes and
  // NGT drainage silently disappeared from the daily totals + net
  // balance row.
  const rows = useMemo(() => {
    return nursingNotes
      .filter((n) => n.intakeOutput && (
        n.intakeOutput.oral || n.intakeOutput.ivFluids || n.intakeOutput.ivMedFluids ||
        n.intakeOutput.bloodProducts || n.intakeOutput.urineOutput ||
        n.intakeOutput.otherOutput || n.intakeOutput.nasogastricOutput
      ))
      .map((n) => {
        const io = n.intakeOutput || {};
        const oral   = Number(io.oral)            || 0;
        const iv     = Number(io.ivFluids)        || 0;
        const ivMed  = Number(io.ivMedFluids)     || 0;
        const blood  = Number(io.bloodProducts)   || 0;
        const urine  = Number(io.urineOutput)     || 0;
        const ngt    = Number(io.nasogastricOutput) || 0;
        const other  = Number(io.otherOutput)     || 0;
        const intake = oral + iv + ivMed + blood;
        const output = urine + ngt + other;
        return {
          _id: n._id,
          when: n.noteDate || n.createdAt,
          by:   n.nurseName || "—",
          shift: n.shift || "—",
          oral, iv, ivMed, blood,
          urine, ngt, other,
          intake, output,
          balance: intake - output,
          notes: io.notes,
        };
      })
      .sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [nursingNotes]);

  const totals = rows.reduce((acc, r) => {
    acc.intake += r.intake;
    acc.output += r.output;
    return acc;
  }, { intake: 0, output: 0 });

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">💧 Intake / Output Chart</h2>
        <p className="ppt-tab-sub">All recorded I/O entries · {rows.length} entries</p>
      </div>

      {rows.length === 0 ? (
        <div className="ppt-empty">No intake/output recordings yet.</div>
      ) : (
        <>
          <div className="ppt-io-totals hga-stagger">
            <div className="ppt-io-card ppt-io-card--in">
              <div className="ppt-io-label">Total Intake</div>
              <div className="ppt-io-val">{totals.intake} <span>mL</span></div>
            </div>
            <div className="ppt-io-card ppt-io-card--out">
              <div className="ppt-io-label">Total Output</div>
              <div className="ppt-io-val">{totals.output} <span>mL</span></div>
            </div>
            <div className={`ppt-io-card ${totals.intake - totals.output >= 0 ? "ppt-io-card--pos" : "ppt-io-card--neg"}`}>
              <div className="ppt-io-label">Net Balance</div>
              <div className="ppt-io-val">{totals.intake - totals.output >= 0 ? "+" : ""}{totals.intake - totals.output} <span>mL</span></div>
            </div>
          </div>

          <div className="ppt-table-wrap">
            <table className="ppt-table">
              <thead>
                <tr>
                  <th>Recorded At</th>
                  <th>By / Shift</th>
                  <th>Oral (mL)</th>
                  <th>IV (mL)</th>
                  <th className="ppt-th-sum">Intake</th>
                  <th>Urine (mL)</th>
                  <th>Other (mL)</th>
                  <th className="ppt-th-sum">Output</th>
                  <th className="ppt-th-sum">Net</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td>{fmtDateTime(r.when)}</td>
                    <td>{r.by}<br/><small className="ppt-shift">{r.shift}</small></td>
                    <td>{r.oral || "—"}</td>
                    <td>{r.iv || "—"}</td>
                    <td className="ppt-td-sum">{r.intake}</td>
                    <td>{r.urine || "—"}</td>
                    <td>{r.other || "—"}</td>
                    <td className="ppt-td-sum">{r.output}</td>
                    <td className={`ppt-td-sum ${r.balance >= 0 ? "ppt-pos" : "ppt-neg"}`}>
                      {r.balance >= 0 ? "+" : ""}{r.balance}
                    </td>
                    <td>{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   6. BloodTransfusionRecordsTab
   ────────────────────────────────────────────────────────────────
   Every nursing note tagged `blood` with full transfusion details
   (component, group, units, monitoring observations).
*/
export function BloodTransfusionRecordsTab({ nursingNotes = [] }) {
  const records = nursingNotes
    .filter((n) => n.noteType === "blood")
    .sort((a, b) => new Date(b.noteDate || b.createdAt) - new Date(a.noteDate || a.createdAt));

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">🩸 Blood Transfusion Records</h2>
        <p className="ppt-tab-sub">NABH COP.7 / MOM.4 · {records.length} transfusion record(s)</p>
      </div>
      {records.length === 0 ? (
        <div className="ppt-empty">No blood transfusion records on file.</div>
      ) : (
        records.map((n) => (
          <BloodTransfusionCard key={n._id} note={n} />
        ))
      )}
    </div>
  );
}

/* R7gy — Normalises BOTH stored shapes the nursing note can carry:
   - FORM shape (NursingNotes.jsx "blood" modal):
       { product, bagNo, crossMatchNo, volume, preBP_sys, preBP_dia,
         prePulse, preTemp, postBP_sys, postBP_dia, postPulse, postTemp,
         reactionType, status, secondNurse, groupVerified, intra: [...] }
   - REGISTER / seed shape (BloodTransfusionRegister + emitter):
       { component, bagNumber, bloodGroup, volumeMl,
         preVitalsBP, preVitalsPulse, preVitalsTemp,
         postVitalsBP, postVitalsPulse, postVitalsTemp,
         reaction, givenBy, witnessedBy, startTime, endTime }
   Pre-R7gy the renderer only knew the seed shape's labels but read with
   the form shape's keys → almost every field rendered "—" even when the
   data was present. Now we coalesce both into one canonical view.
*/
function BloodTransfusionCard({ note }) {
  const d = note.noteData?.bloodTransfusion || note.noteData || {};
  const component = d.component || d.product || "Blood Product";
  const bagNo     = d.bagNumber || d.bagNo || d.unitNumber;
  const crossNo   = d.crossMatchNo || d.crossMatchNumber;
  const volume    = d.volumeMl ?? d.volume;
  const bg        = d.bloodGroup || d.group;
  const preBP     = d.preVitalsBP  || (d.preBP_sys && d.preBP_dia ? `${d.preBP_sys}/${d.preBP_dia}` : "");
  const prePulse  = d.preVitalsPulse ?? d.prePulse;
  const preTemp   = d.preVitalsTemp  ?? d.preTemp;
  const postBP    = d.postVitalsBP || (d.postBP_sys && d.postBP_dia ? `${d.postBP_sys}/${d.postBP_dia}` : "");
  const postPulse = d.postVitalsPulse ?? d.postPulse;
  const postTemp  = d.postVitalsTemp  ?? d.postTemp;
  const reaction  = d.reaction || d.reactionType || d.reactions;
  const reactionDesc = d.reactionDescription || d.reactionNotes;
  const givenBy   = d.givenBy || d.transfusedByName || d.administeredBy || note.nurseName;
  const witness   = d.witnessedBy || d.secondNurse || d.secondNurseName;
  const groupVer  = d.groupVerified;
  const status    = d.status;
  const consent   = d.consentTaken ?? d.consentSigned;
  const crossDone = d.crossMatchDone ?? (crossNo ? true : null);
  const docNotified = d.doctorNotified || d.doctorInformed;
  const intraVitals = Array.isArray(d.intra) ? d.intra : Array.isArray(d.intraVitals) ? d.intraVitals : [];
  const hasReaction = reaction && String(reaction).toLowerCase() !== "nil" && String(reaction).toLowerCase() !== "none";

  return (
    <div className="ppt-card ppt-card--blood">
      <div className="ppt-section-title">
        <span className="ppt-section-icon">🩸</span>
        {component} — {fmtDateTime(note.noteDate || note.createdAt)}
        {bg && <span className="ppt-badge ppt-badge--info" style={{ background: "#fee2e2", color: "#991b1b" }}>{bg}</span>}
        {status && <span className="ppt-badge ppt-badge--info">{status}</span>}
        <span className="ppt-badge ppt-badge--info">By {givenBy || "Nurse"}</span>
        {hasReaction && <span className="ppt-badge" style={{ background: "#fef2f2", color: "#dc2626", fontWeight: 700 }}>⚠ REACTION</span>}
      </div>

      {/* Bag info row */}
      <div className="ppt-bt-row" style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px" }}>Bag / Unit Details</strong>
        <div className="ppt-detail-grid" style={{ marginTop: 6 }}>
          <Field label="Component"        value={component} />
          <Field label="Blood Group"      value={bg} />
          <Field label="Bag / Unit No."   value={bagNo} mono />
          <Field label="Volume"           value={volume ? `${volume} mL` : null} />
          <Field label="Cross-match No."  value={crossNo} mono />
          <Field label="Cross-match Done" value={crossDone == null ? null : (crossDone ? "✓ Yes" : "✗ No")} />
          <Field label="Group Verified (2nd nurse)" value={groupVer == null ? null : (groupVer ? "✓ Yes" : "✗ No")} />
          <Field label="Consent on File"  value={consent == null ? null : (consent ? "✓ Yes" : "✗ No")} />
        </div>
      </div>

      {/* Timeline row */}
      <div className="ppt-bt-row" style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px" }}>Transfusion Timeline</strong>
        <div className="ppt-detail-grid" style={{ marginTop: 6 }}>
          <Field label="Start Time" value={fmtDateTime(d.startTime)} />
          <Field label="End Time"   value={fmtDateTime(d.endTime)} />
          <Field label="Duration"   value={computeDurationLabel(d.startTime, d.endTime)} />
        </div>
      </div>

      {/* Vitals row — pre + post side-by-side */}
      {(preBP || prePulse || preTemp || postBP || postPulse || postTemp) && (
        <div className="ppt-bt-row" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px" }}>Pre / Post Transfusion Vitals</strong>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ padding: "6px 8px", border: "1px solid #cbd5e1", textAlign: "left", color: "#334155" }}>Phase</th>
                <th style={{ padding: "6px 8px", border: "1px solid #cbd5e1", color: "#334155" }}>BP (mmHg)</th>
                <th style={{ padding: "6px 8px", border: "1px solid #cbd5e1", color: "#334155" }}>Pulse</th>
                <th style={{ padding: "6px 8px", border: "1px solid #cbd5e1", color: "#334155" }}>Temp</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "6px 8px", border: "1px solid #e2e8f0", fontWeight: 600 }}>Pre-transfusion</td>
                <td style={{ padding: "6px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{preBP || "—"}</td>
                <td style={{ padding: "6px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{prePulse != null && prePulse !== "" ? `${prePulse} /min` : "—"}</td>
                <td style={{ padding: "6px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{preTemp != null && preTemp !== "" ? `${preTemp}°` : "—"}</td>
              </tr>
              <tr>
                <td style={{ padding: "6px 8px", border: "1px solid #e2e8f0", fontWeight: 600 }}>Post-transfusion</td>
                <td style={{ padding: "6px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{postBP || "—"}</td>
                <td style={{ padding: "6px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{postPulse != null && postPulse !== "" ? `${postPulse} /min` : "—"}</td>
                <td style={{ padding: "6px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{postTemp != null && postTemp !== "" ? `${postTemp}°` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Intra-transfusion monitoring (Q15min × 1h then Q1h per NABH COP.7) */}
      {intraVitals.length > 0 && (
        <div className="ppt-bt-row" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px" }}>Intra-Transfusion Monitoring ({intraVitals.length} readings)</strong>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ padding: "5px 8px", border: "1px solid #cbd5e1", color: "#334155" }}>At (min)</th>
                <th style={{ padding: "5px 8px", border: "1px solid #cbd5e1", color: "#334155" }}>BP</th>
                <th style={{ padding: "5px 8px", border: "1px solid #cbd5e1", color: "#334155" }}>Pulse</th>
                <th style={{ padding: "5px 8px", border: "1px solid #cbd5e1", color: "#334155" }}>Temp</th>
              </tr>
            </thead>
            <tbody>
              {intraVitals.map((iv, idx) => {
                const ivBP = iv.bp || (iv.bp_sys && iv.bp_dia ? `${iv.bp_sys}/${iv.bp_dia}` : "—");
                return (
                  <tr key={idx}>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{iv.atMin ?? iv.at ?? "—"}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{ivBP}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{iv.pulse ?? "—"}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0", textAlign: "center" }}>{iv.temp ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Reaction + witness row */}
      <div className="ppt-bt-row" style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 12, color: "#475569", textTransform: "uppercase", letterSpacing: ".4px" }}>Reaction Monitoring & Sign-off (NABH MOM.4)</strong>
        <div className="ppt-detail-grid" style={{ marginTop: 6 }}>
          <Field label="Reaction"          value={reaction} danger={hasReaction} />
          <Field label="Reaction Notes"    value={reactionDesc} wide danger={hasReaction} />
          <Field label="Doctor Notified"   value={docNotified === true ? "✓ Yes" : docNotified === false ? "✗ No" : docNotified} />
          <Field label="Administered By"   value={givenBy} />
          <Field label="Witnessed By (2nd nurse)" value={witness} />
        </div>
      </div>

      {(d.remarks || note.remarks) && (
        <Field label="Remarks" value={d.remarks || note.remarks} wide />
      )}
    </div>
  );
}

/* Pretty duration "1h 30m" / "45m" — empty if either side missing or invalid. */
function computeDurationLabel(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  if (!isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/* ────────────────────────────────────────────────────────────────
   7. RBSMonitoringTab
   ────────────────────────────────────────────────────────────────
   Random Blood Sugar chart + insulin / OHA orders given against it.
   Reads `vitals.bloodSugar` from nursing notes and joins them with
   matching antidiabetic medication doses (insulin / metformin etc.)
   from doctorOrders' administrationRecord.
*/
export function RBSMonitoringTab({ nursingNotes = [], doctorOrders = [] }) {
  const readings = useMemo(() => {
    return nursingNotes
      .filter((n) => n.vitals?.bloodSugar != null)
      .map((n) => ({
        when: n.noteDate || n.createdAt,
        bsl:  Number(n.vitals.bloodSugar),
        by:   n.nurseName || "—",
        shift: n.shift,
      }))
      .sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [nursingNotes]);

  // Antidiabetic medications administered. Generic + common Indian
  // brand names. `glucose`/`dextrose` are included because hospital
  // RBS-monitoring flow tracks the rescue dose alongside the antidiabetic.
  const ANTIDIABETIC_RE = new RegExp([
    // Insulins — generic + trade names
    "insulin", "humulin", "novolin", "actrapid", "mixtard", "humalog",
    "lantus", "levemir", "novorapid", "novomix", "tresiba", "ryzodeg",
    "glargine", "aspart", "lispro", "detemir", "degludec",
    // Sulfonylureas
    "glimepiride", "gliclazide", "glipizide", "glibenclamide", "glyburide",
    // Biguanides
    "metformin", "glycomet",
    // DPP-4 inhibitors
    "sitagliptin", "vildagliptin", "linagliptin", "saxagliptin", "teneligliptin",
    // SGLT2 inhibitors
    "empagliflozin", "dapagliflozin", "canagliflozin", "ertugliflozin",
    // GLP-1 agonists
    "liraglutide", "semaglutide", "dulaglutide", "exenatide",
    // Thiazolidinediones
    "pioglitazone", "rosiglitazone",
    // Meglitinides
    "repaglinide", "nateglinide",
    // α-glucosidase inhibitors
    "acarbose", "miglitol", "voglibose",
    // Rescue / monitoring
    "glucose", "dextrose",
  ].join("|"), "i");
  const doses = useMemo(() => {
    const list = [];
    (doctorOrders || []).forEach((o) => {
      const isAD = ANTIDIABETIC_RE.test(`${o.drug || ""} ${o.drugFluid || ""} ${o.medicineName || ""}`);
      if (!isAD) return;
      (o.administrationRecord || []).forEach((a) => {
        if (!a.givenAt) return;
        list.push({
          when:  a.givenAt,
          drug:  o.drug || o.drugFluid || o.medicineName || "Antidiabetic",
          dose:  a.doseGiven || a.dose || o.dose,
          route: a.route || o.route,
          by:    a.givenBy || "—",
          status: a.status || "given",
          reason: a.statReason || a.reason,
        });
      });
    });
    return list.sort((a, b) => new Date(b.when) - new Date(a.when));
  }, [doctorOrders]);

  const flagBSL = (bsl) =>
    bsl > 180 ? "ppt-bsl--high" :
    bsl < 70  ? "ppt-bsl--low"  : "";

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">🩸 RBS Monitoring &amp; Diabetic Medication</h2>
        <p className="ppt-tab-sub">
          {readings.length} blood-sugar reading(s) · {doses.length} antidiabetic dose(s)
        </p>
      </div>

      <div className="ppt-grid-2">
        <div className="ppt-card">
          <div className="ppt-section-title">📈 Blood Sugar Readings</div>
          {readings.length === 0 ? (
            <div className="ppt-empty">No RBS readings recorded yet.</div>
          ) : (
            <table className="ppt-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>BSL (mg/dL)</th>
                  <th>Shift / Nurse</th>
                </tr>
              </thead>
              <tbody>
                {readings.map((r, i) => (
                  <tr key={i} className={flagBSL(r.bsl)}>
                    <td>{fmtDateTime(r.when)}</td>
                    <td className="ppt-bsl-cell"><strong>{r.bsl}</strong></td>
                    <td>{r.shift || "—"}<br/><small>{r.by}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="ppt-card">
          <div className="ppt-section-title">💉 Antidiabetic Doses Given</div>
          {doses.length === 0 ? (
            <div className="ppt-empty">No antidiabetic medications administered yet.</div>
          ) : (
            <table className="ppt-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Drug</th>
                  <th>Dose</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {doses.map((d, i) => (
                  <tr key={i}>
                    <td>{fmtDateTime(d.when)}</td>
                    <td>
                      <strong>{d.drug}</strong>
                      {d.route && <><br/><small>{d.route}</small></>}
                    </td>
                    <td>{d.dose || "—"}</td>
                    <td>{d.by}<br/><small className={`ppt-status ppt-status--${d.status}`}>{d.status}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="ppt-card">
        <div className="ppt-section-title">🚦 Reference Range</div>
        <div className="ppt-bsl-legend">
          <span className="ppt-bsl-chip ppt-bsl-chip--low">&lt; 70 mg/dL · Hypoglycaemia</span>
          <span className="ppt-bsl-chip ppt-bsl-chip--normal">70–140 mg/dL · Normal fasting</span>
          <span className="ppt-bsl-chip ppt-bsl-chip--ok">140–180 mg/dL · Acceptable post-meal</span>
          <span className="ppt-bsl-chip ppt-bsl-chip--high">&gt; 180 mg/dL · Hyperglycaemia — needs action</span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   8. HandoverNotesTab
   ────────────────────────────────────────────────────────────────
   Aggregates every kind of handover record on file for this admission
   so the next shift / next doctor / receiving department picks up
   without losing context:

     • 🛏  Bed-Transfer Handover (Doctor → Nurse handover that's already
            its own state-machine — Doctor initiates, Nurse completes)
     • 🌅  Nursing Shift (SBAR)   — noteType="discharge" with SBAR or
                                    noteType="handover"/"shiftHandover"
     • 🩺  Doctor Shift Handover  — doctor noteType="handover"/"shift"
     • ➡  Doctor → Nurse Care    — doctor handover meant for nursing
                                    (noteData.targetRole === "Nurse")
     • ⚠   Critical Findings      — nurse → doctor escalation
                                    (noteData.handoverType === "critical")
     • 🚪  Pre-Discharge Handover — doctor or nurse with
                                    noteType="predischarge"

   Each entry renders fully expanded for proper reading + printing.
*/
export function HandoverNotesTab({ patient, admission, doctorNotes = [], nursingNotes = [] }) {
  const admissionId = admission?._id;
  const [transfers, setTransfers] = useState([]);
  const [loadingTx, setLoadingTx]   = useState(false);

  useEffect(() => {
    if (!admissionId) { setTransfers([]); return; }
    let cancelled = false;
    setLoadingTx(true);
    axios.get(`${API_ENDPOINTS.BASE}/bed-transfers?admissionId=${admissionId}`)
      .then((r) => { if (!cancelled) setTransfers(r.data?.data || r.data?.transfers || []); })
      .catch(() => { if (!cancelled) setTransfers([]); })
      .finally(() => { if (!cancelled) setLoadingTx(false); });
    return () => { cancelled = true; };
  }, [admissionId]);

  /* ── Classify nursing handovers ───────────────────────────────── */
  const nursingHandovers = nursingNotes.filter((n) => {
    const t = (n.noteType || "").toLowerCase();
    const subtype = (n.noteData?.handoverType || "").toLowerCase();
    return t === "discharge" || t === "handover" || t === "shifthandover" || t === "sbar"
        || subtype === "shift" || subtype === "sbar";
  });

  const sbar     = nursingHandovers.filter((n) => {
    const t = (n.noteType || "").toLowerCase();
    return t !== "predischarge" && (n.noteData?.handoverType || "").toLowerCase() !== "critical";
  });
  const critical = nursingHandovers.filter((n) => (n.noteData?.handoverType || "").toLowerCase() === "critical");

  /* ── Classify doctor handovers ───────────────────────────────── */
  const doctorHandovers = doctorNotes.filter((n) => {
    const t = (n.noteType || "").toLowerCase();
    return t === "handover" || t === "shift" || t === "shifthandover";
  });
  const doctorShift = doctorHandovers.filter((n) => {
    const target = (n.noteData?.targetRole || n.targetRole || "").toLowerCase();
    return target !== "nurse";
  });
  const doctorToNurse = doctorHandovers.filter((n) => {
    const target = (n.noteData?.targetRole || n.targetRole || "").toLowerCase();
    return target === "nurse";
  });

  /* ── Pre-discharge handovers (from either side) ─────────────── */
  const preDischarge = [
    ...doctorNotes.filter((n) => (n.noteType || "").toLowerCase() === "predischarge"),
    ...nursingNotes.filter((n) => (n.noteType || "").toLowerCase() === "predischarge"),
  ].sort((a, b) => new Date(b.createdAt || b.noteDate) - new Date(a.createdAt || a.noteDate));

  /* ── Bed-transfer handovers ──────────────────────────────────── */
  const pending  = transfers.filter((t) => t.status === "PendingHandover");
  const completed = transfers.filter((t) => t.status === "Complete");

  const totalCount = pending.length + completed.length + sbar.length + critical.length
                   + doctorShift.length + doctorToNurse.length + preDischarge.length;

  return (
    <div className="ppt-tab">
      <div className="ppt-tab-header">
        <h2 className="ppt-tab-title">🔄 Handover Notes — All Types</h2>
        <p className="ppt-tab-sub">
          Shift handovers, bed-transfer handovers, doctor→nurse care plans, critical-findings escalations,
          and pre-discharge handovers · {totalCount} record(s)
        </p>
      </div>

      {/* 1 — Pending bed-transfer (action required) */}
      {pending.length > 0 && (
        <div className="ppt-card ppt-card--mlc hga-pop">
          <div className="ppt-section-title">
            <span className="ppt-section-icon">🛏</span>
            Bed Transfer — Handover Pending
            <span className="ppt-badge ppt-badge--warn">ACTION REQUIRED</span>
          </div>
          {pending.map((t) => <BedTransferRow key={t._id} t={t} state="pending" />)}
        </div>
      )}

      {/* 2 — Nursing Shift (SBAR) */}
      <HandoverSection
        title="🌅 Nursing Shift Handover (SBAR)"
        items={sbar}
        emptyMsg="No nursing shift handovers recorded yet."
        kind="nurse"
      />

      {/* 3 — Doctor Shift */}
      <HandoverSection
        title="🩺 Doctor Shift Handover"
        items={doctorShift}
        emptyMsg="No doctor shift handovers recorded yet."
        kind="doctor"
      />

      {/* 4 — Doctor → Nurse care plan */}
      <HandoverSection
        title="➡ Doctor → Nurse Care Handover"
        items={doctorToNurse}
        emptyMsg="No doctor-to-nurse care handovers recorded yet."
        kind="doctor"
      />

      {/* 5 — Critical Findings (nurse → doctor escalation) */}
      <HandoverSection
        title="⚠ Critical Findings Handover (Nurse → Doctor escalation)"
        items={critical}
        emptyMsg="No critical-findings escalations on record."
        kind="nurse"
        urgent
      />

      {/* 6 — Pre-Discharge */}
      <HandoverSection
        title="🚪 Pre-Discharge Handover"
        items={preDischarge}
        emptyMsg="No pre-discharge handovers recorded yet."
        kind="mixed"
      />

      {/* 7 — Completed bed-transfer history */}
      <div className="ppt-card">
        <div className="ppt-section-title">
          <span className="ppt-section-icon">🛏</span>
          Bed-Transfer Handover History
          <span className="ppt-badge ppt-badge--info">{completed.length} completed</span>
        </div>
        {loadingTx && <div className="ppt-empty"><i className="pi pi-spin pi-spinner" /> Loading transfers…</div>}
        {!loadingTx && completed.length === 0 && (
          <div className="ppt-empty">No completed bed transfers on file.</div>
        )}
        {completed
          .sort((a, b) => new Date(b.handoverAt || b.updatedAt) - new Date(a.handoverAt || a.updatedAt))
          .map((t) => <BedTransferRow key={t._id} t={t} state="completed" />)}
      </div>
    </div>
  );
}

function HandoverSection({ title, items, emptyMsg, kind, urgent }) {
  return (
    <div className={`ppt-card ${urgent ? "ppt-card--blood" : kind === "doctor" ? "ppt-card--doctor" : kind === "nurse" ? "ppt-card--nurse" : ""}`}>
      <div className="ppt-section-title">
        {title}
        <span className={`ppt-badge ${items.length === 0 ? "ppt-badge--info" : urgent ? "ppt-badge--warn" : "ppt-badge--ok"}`}>
          {items.length} record(s)
        </span>
      </div>
      {items.length === 0 ? (
        <div className="ppt-empty">{emptyMsg}</div>
      ) : (
        items.map((n) => (
          <NoteCardEmbed key={n._id} note={n} role={kind === 'mixed' ? 'doctor' : kind} />
        ))
      )}
    </div>
  );
}

function BedTransferRow({ t, state }) {
  return (
    <div className="ppt-note ppt-note--nurse">
      <div className="ppt-note-head">
        <span className="ppt-note-type">
          {t.transferNo || "Bed Transfer"}
          {state === "pending"  && <span className="ppt-note-status ppt-note-status--draft">{t.status}</span>}
          {state === "completed" && <span className="ppt-note-status ppt-note-status--signed">{t.status}</span>}
        </span>
        <span className="ppt-note-meta">
          Initiated: {fmtDateTime(t.requestedAt)} {t.requestedBy && <>by <strong>{t.requestedBy}</strong></>}
          {t.handoverAt && <> · Completed: {fmtDateTime(t.handoverAt)} by <strong>{t.handoverBy || "Nurse"}</strong></>}
        </span>
      </div>
      <div className="ppt-detail-grid">
        <Field label="From Bed" value={[t.fromBedNumber, t.fromWardName].filter(Boolean).join(" — ")} />
        <Field label="To Bed"   value={[t.toBedNumber, t.toWardName].filter(Boolean).join(" — ")} />
        <Field label="Reason"   value={t.reason} wide />
        <Field label="Doctor's Shifting Notes" value={t.shiftingNotes} wide />
        {t.handoverNotes && <Field label="Nurse's Handover Notes" value={t.handoverNotes} wide />}
      </div>
    </div>
  );
}

/* ─── note building-blocks ─── */

function SoapRow({ letter, label, body }) {
  return (
    <div className="ppt-soap-row">
      <span className="ppt-soap-letter">{letter}</span>
      <div className="ppt-soap-body">
        <div className="ppt-soap-label">{label}</div>
        <div className="ppt-soap-text">{body}</div>
      </div>
    </div>
  );
}

function VitalsChipRow({ vitals }) {
  const items = [];
  if (vitals.bp && (vitals.bp.systolic || vitals.bp.diastolic)) {
    items.push({ k: "BP",   v: `${vitals.bp.systolic || "—"}/${vitals.bp.diastolic || "—"}`, u: "mmHg" });
  } else if (typeof vitals.bp === "string" && vitals.bp) {
    items.push({ k: "BP", v: vitals.bp, u: "mmHg" });
  }
  if (vitals.pulse) items.push({ k: "Pulse", v: vitals.pulse, u: "bpm" });
  if (vitals.temp)  items.push({ k: "Temp",  v: vitals.temp,  u: "°F" });
  if (vitals.rr)    items.push({ k: "RR",    v: vitals.rr,    u: "/min" });
  if (vitals.spo2)  items.push({ k: "SpO₂",  v: vitals.spo2,  u: "%" });
  if (vitals.bsl)   items.push({ k: "BSL",   v: vitals.bsl,   u: "mg/dL" });
  if (vitals.gcs)   items.push({ k: "GCS",   v: vitals.gcs,   u: "" });
  if (vitals.pain != null) items.push({ k: "Pain", v: vitals.pain, u: "/10" });
  if (!items.length) return null;
  return (
    <div className="ppt-vitals-row">
      {items.map((it, i) => (
        <div key={i} className="ppt-vital-chip">
          <span className="ppt-vital-k">{it.k}</span>
          <span className="ppt-vital-v">{it.v}</span>
          {it.u && <span className="ppt-vital-u">{it.u}</span>}
        </div>
      ))}
    </div>
  );
}

function IORows({ intake = [], output = [] }) {
  return (
    <div className="ppt-table-wrap">
      <table className="ppt-table ppt-table--compact">
        <thead>
          <tr><th>Type</th><th>Time</th><th>Item</th><th>Route</th><th>Amount (ml)</th></tr>
        </thead>
        <tbody>
          {intake.map((r, i) => (
            <tr key={`in-${i}`}>
              <td><span className="ppt-chip ppt-chip--info">IN</span></td>
              <td>{fmtDateTime(r.time || r.at)}</td>
              <td>{r.item || r.fluid || r.type || "—"}</td>
              <td>{r.route || "—"}</td>
              <td className="ppt-mono">{r.amount || r.volume || "—"}</td>
            </tr>
          ))}
          {output.map((r, i) => (
            <tr key={`out-${i}`}>
              <td><span className="ppt-chip ppt-chip--warn">OUT</span></td>
              <td>{fmtDateTime(r.time || r.at)}</td>
              <td>{r.item || r.fluid || r.type || "—"}</td>
              <td>{r.route || "—"}</td>
              <td className="ppt-mono">{r.amount || r.volume || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Signature footer — the real fix.
 * Renders the signature as an <img> when it's a data URL or a /uploads/ path;
 * otherwise shows a clean "Signed by Name (Reg) on date" line. NEVER spits
 * raw base64 into the page. */
function NoteSignature({ note, role }) {
  const sig = note.signature || note.nurseSignature || "";
  const isImg = typeof sig === "string" && (sig.startsWith("data:image/") || sig.startsWith("/uploads/") || /^https?:\/\//.test(sig));
  const signedByName = note.signedByName || (role === "Nurse" ? note.nurseName : note.doctorName) || "";
  const signedByReg  = note.signedByReg  || note.doctorRegNo || "";
  // R7go — Hospital employee ID surfaced next to the name + reg no. Same
  // field precedence used by the HTML builders so panel + print stay in
  // sync. signedByEmpId is captured at sign time; doctorEmpId /
  // nurseEmployeeId are the original author's IDs and shown when nothing
  // explicit was recorded at sign time (older notes).
  const signedByEmpId = note.signedByEmpId
    || (role === "Nurse" ? note.nurseEmployeeId : note.doctorEmpId)
    || "";
  const signedAt     = note.signedAt;

  if (!sig && !signedByName && !signedAt) return null;
  return (
    <div className="ppt-sig">
      <div className="ppt-sig-line">
        {isImg ? (
          // SecureImage: /uploads/ signatures are JWT-gated — a plain <img>
          // can't send the Authorization header (data:/https pass through).
          <SecureImage src={sig} alt={`${role} signature`} className="ppt-sig-img" />
        ) : sig ? (
          <span className="ppt-sig-cursive">{signedByName || "Signed"}</span>
        ) : (
          <span className="ppt-sig-cursive ppt-sig-cursive--placeholder">— digital signature —</span>
        )}
      </div>
      <div className="ppt-sig-meta">
        <strong>{signedByName || `${role} (unsigned)`}</strong>
        {signedByEmpId && <span className="ppt-emp-id">Emp ID {signedByEmpId}</span>}
        {signedByReg && <span className="ppt-reg">Reg {signedByReg}</span>}
        {signedAt && <span>· {fmtDateTime(signedAt)}</span>}
        {role && <span className="ppt-sig-role">· {role}</span>}
      </div>
    </div>
  );
}

/* Renders any remaining structured fields not handled by the per-section blocks.
 * Heavy nested objects (noteData / intakeOutput / vitalsHistory) get
 * specialised renderers below so the user never sees raw JSON dumped on the
 * page — that was the old "looks bad" UX.
 */
function ExtraFields({ note }) {
  const HANDLED = new Set([
    ...SKIP_NOTE_FIELDS,
    "soap","vitals","orders","investigations","tags","noteDetails",
    "remarks","note","noteText","content","patientStatus","isCritical",
    "doctorName","doctorRegNo","nurseName","shift","status","signedAt",
    "doctorId","consultantName","visitDate","painAssessment","gcs",
    "intake","output","bloodTransfusion","provisionalDiagnosis",
    "workingDiagnosis","finalDiagnosis","icd10Code","icd10Description",
    // Heavy keys handled by dedicated child blocks below
    "noteData","intakeOutput","ivLine","nursingCare","painScore",
    "generalCondition","isCriticalEvent","triagecategory","triageCategory",
  ]);
  const note0 = note || {};
  const entries = Object.entries(note0)
    .filter(([k, v]) => !HANDLED.has(k) && v != null && v !== "" && v !== false)
    .filter(([, v]) => !(Array.isArray(v) && v.length === 0))
    .filter(([, v]) => typeof v !== "object" || Object.keys(v).length > 0);

  return (
    <>
      {/* General-condition + IV-line summary chips (nursing-specific) */}
      <NursingSummaryChips note={note0} />

      {/* Intake / output structured block */}
      <IntakeOutputBlock io={note0.intakeOutput} />

      {/* Free-text observation (noteData.generalObservation etc.) */}
      <ObservationBlock data={note0.noteData} />

      {entries.length > 0 && (
        <div className="ppt-inline-block">
          <div className="ppt-section-sub">Additional Fields</div>
          <div className="ppt-detail-grid">
            {entries.map(([k, v]) => (
              <Field key={k} label={prettyKey(k)} value={renderValue(v)} wide={typeof v === "string" && v.length > 60} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Renders a few quick-reference chips (general condition, IV line, pain) so
 * the reader doesn't need to dig through Additional Fields. Only the truthy
 * values show up. */
function NursingSummaryChips({ note }) {
  const gc = note.generalCondition;
  const iv = note.ivLine;
  const ps = note.painScore;
  const items = [];
  if (gc && typeof gc === "object") {
    Object.entries(gc).forEach(([k, v]) => { if (v && v !== "false") items.push({ k: prettyKey(k), v }); });
  }
  if (iv && typeof iv === "object" && iv.condition) items.push({ k: "IV Line", v: iv.condition });
  if (ps != null && ps !== "") items.push({ k: "Pain", v: `${ps}/10` });
  if (!items.length) return null;
  return (
    <div className="ppt-chip-list" style={{ margin: "10px 0" }}>
      {items.map((it, i) => (
        <span key={i} className="ppt-chip ppt-chip--info">
          <strong>{it.k}:</strong> {String(it.v)}
        </span>
      ))}
    </div>
  );
}

/** Intake / Output — supports a few shapes:
 *  - { ivFluidEntries: [{time, volume, fluid, via, ...}], oral, urineOutput, ... }
 *  - flat numbers (oral, ivFluids, urineOutput, otherOutput)
 */
function IntakeOutputBlock({ io }) {
  if (!io || typeof io !== "object") return null;
  const entries = Array.isArray(io.ivFluidEntries) ? io.ivFluidEntries : [];
  const totals = {};
  ["oral","ivFluids","urineOutput","otherOutput","stool","drain","ngOutput"].forEach((k) => {
    if (io[k] != null && io[k] !== "" && io[k] !== 0) totals[k] = io[k];
  });
  if (entries.length === 0 && Object.keys(totals).length === 0) return null;
  return (
    <div className="ppt-inline-block">
      <div className="ppt-section-sub">Intake / Output</div>
      {Object.keys(totals).length > 0 && (
        <div className="ppt-chip-list" style={{ marginBottom: 8 }}>
          {Object.entries(totals).map(([k, v]) => (
            <span key={k} className="ppt-chip">
              <strong>{prettyKey(k)}:</strong> {v}{typeof v === "number" || /^\d+$/.test(String(v)) ? " ml" : ""}
            </span>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <div className="ppt-table-wrap">
          <table className="ppt-table ppt-table--compact">
            <thead>
              <tr><th>Time</th><th>Fluid</th><th>Volume</th><th>Via</th><th>Entered By</th></tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(e.time)}</td>
                  <td>{e.fluid || "—"}</td>
                  <td className="ppt-mono">{e.volume != null ? `${e.volume} ml` : "—"}</td>
                  <td>{e.via || "—"}</td>
                  <td className="ppt-cell-src">{e.enteredBy || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Free-text observation block — pulls human-readable paragraphs out of a
 * Mixed-type noteData blob and renders them as a proper card body rather
 * than the JSON dump the legacy code produced. */
function ObservationBlock({ data }) {
  if (!data || typeof data !== "object") return null;
  // Pull out string fields that look like observations (no nested JSON)
  const textFields = [];
  const structured = {};
  Object.entries(data).forEach(([k, v]) => {
    if (k === "_id" || k === "__v") return;
    if (typeof v === "string" && v.length > 0 && !v.startsWith("data:image/")) {
      textFields.push({ k: prettyKey(k), v });
    } else if (typeof v === "object" && v != null && !Array.isArray(v)) {
      structured[k] = v;
    } else if (Array.isArray(v) && v.length > 0) {
      structured[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      if (v !== false && v !== 0) textFields.push({ k: prettyKey(k), v: String(v) });
    }
  });
  if (textFields.length === 0 && Object.keys(structured).length === 0) return null;
  return (
    <div className="ppt-inline-block">
      <div className="ppt-section-sub">Observation</div>
      {textFields.length > 0 && (
        <div className="ppt-detail-grid">
          {textFields.map((t, i) => (
            <Field key={i} label={t.k} value={t.v} wide={t.v.length > 80} />
          ))}
        </div>
      )}
      {Object.keys(structured).length > 0 && (
        <div className="ppt-detail-grid" style={{ marginTop: 8 }}>
          {Object.entries(structured).map(([k, v]) => (
            <Field key={k} label={prettyKey(k)} value={renderValue(v)} wide />
          ))}
        </div>
      )}
    </div>
  );
}

function MLCExpanded({ mlc }) {
  return (
    <div className="ppt-card ppt-card--mlc hga-pop">
      <div className="ppt-section-title">
        <span className="ppt-section-icon">⚖</span>
        MLR&nbsp;<span className="ppt-mlr">{mlc.mlrNumber}</span>
        <span className={`ppt-badge ppt-badge--${mlc.status === "Closed" ? "info" : "warn"}`}>{mlc.status}</span>
        <span className="ppt-badge ppt-badge--info">{mlc.source} · {mlc.mlcType}</span>
      </div>
      <div className="ppt-detail-grid">
        <Field label="Issued By"            value={mlc.doctorName} />
        <Field label="Recorded On"          value={fmtDateTime(mlc.createdAt)} />
        <Field label="Incident Date / Time" value={`${fmtDate(mlc.incidentDate)} ${mlc.incidentTime || ""}`} />
        <Field label="Place of Incident"    value={mlc.incidentPlace} />
        <Field label="Brought By"           value={[mlc.broughtBy, mlc.broughtByName].filter(Boolean).join(" — ")} />
        <Field label="Police Station"       value={mlc.policeStation} />
        <Field label="FIR No."              value={mlc.firNumber} mono />
        <Field label="Investigating Officer" value={mlc.investigatingOfficer} />
        <Field label="Alleged History"      value={mlc.allegedHistory} wide />
        <Field label="Provisional Diagnosis" value={mlc.provisionalDiagnosis} />
        <Field label="Disposition"          value={mlc.disposition} />
        <Field label="Doctor's Opinion"     value={mlc.opinion} wide />
        {mlc.source === "External" && (
          <>
            <Field label="External MLC No."     value={mlc.externalDetails?.externalMlcNumber} mono />
            <Field label="External Hospital"    value={mlc.externalDetails?.externalHospital} />
            <Field label="External Date"        value={fmtDate(mlc.externalDetails?.externalDate)} />
          </>
        )}
      </div>
      {(mlc.injuries || []).length > 0 && (
        <div className="ppt-mlc-injuries">
          <div className="ppt-section-sub">Injuries Documented</div>
          <table className="ppt-table ppt-table--inj">
            <thead><tr><th>#</th><th>Region</th><th>Type</th><th>Size</th><th>Age</th><th>Description</th></tr></thead>
            <tbody>
              {mlc.injuries.map((inj, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{inj.region || "—"}</td>
                  <td>{inj.type}</td>
                  <td>{inj.size || "—"}</td>
                  <td>{inj.ageOfInjury || "—"}</td>
                  <td>{inj.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── tiny helpers ──────────────────── */

const SKIP_NOTE_FIELDS = new Set([
  "_id","__v","createdAt","updatedAt","patient","patientName","patientUHID",
  "nurseStaffId","nurseEmployeeId","nurse","doctor","department","ipdNo",
  "noteType","noteDate","createdBy","modifiedBy","modifiedAt","auditTrail","loginUserId",
  // FIX (signature bug): these are rendered by <NoteSignature/> at the
  // bottom of every note. Listing them here keeps the raw base64 string
  // / name / reg number from showing up as a "field" inside the body.
  "signature","nurseSignature","signedByName","signedByReg","signedAt","signedByRole",
  "updatedBy",
]);

function renderValue(v) {
  if (v == null) return "—";
  if (typeof v === "string") {
    // FIX (signature bug): a base64 data URL is an embedded image, not a
    // string field — render it as an <img>. Same for /uploads/ paths and
    // remote http(s) image URLs. Anything else stays as text.
    if (v.startsWith("data:image/") || v.startsWith("/uploads/") || /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)$/i.test(v)) {
      return <SecureImage src={v} alt="" className="ppt-inline-img" />;
    }
    // ISO date strings → format. Heuristic — must look like an ISO date.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      return fmtDateTime(v);
    }
    return v;
  }
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return fmtDateTime(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    if (typeof v[0] === "string" || typeof v[0] === "number") return v.join(", ");
    return v.map((x, i) => <div key={i} className="ppt-sub-row">{renderObj(x)}</div>);
  }
  if (typeof v === "object") return renderObj(v);
  return String(v);
}

function renderObj(o) {
  return Object.entries(o)
    // FIX (note rendering): drop noise — `false` defaults and empty arrays.
    // These are normally unchecked checkboxes / unfilled radios that the
    // backend stored as the schema default. They add clutter without
    // signal (e.g. "Bedsore Check: false" means the box was never ticked).
    .filter(([k, val]) => {
      if (val == null || val === "" || val === false) return false;
      if (k === "_id" || k === "__v") return false;
      if (Array.isArray(val) && val.length === 0) return false;
      if (typeof val === "object" && Object.keys(val).length === 0) return false;
      return true;
    })
    .map(([k, val]) => {
      let display;
      // Strings that are actually images → render as <img>, never as text.
      if (typeof val === "string" && (val.startsWith("data:image/") || val.startsWith("/uploads/"))) {
        display = <SecureImage src={val} alt={k} className="ppt-inline-img" />;
      } else if (typeof val === "string" && val.length > 200) {
        // Truncate absurdly long strings (very long signatures, dumps) so the
        // UI never gets bricked.
        display = `${val.slice(0, 200)}…[truncated]`;
      } else if (Array.isArray(val)) {
        // Arrays of primitives render as a clean comma-separated list — never
        // as raw JSON like `["None"]`. Arrays of objects fall back to JSON
        // (no good single-line representation) but go through the try/catch
        // below.
        if (val.length === 0) {
          display = "—";
        } else if (val.every((x) => typeof x === "string" || typeof x === "number")) {
          display = val.join(", ");
        } else {
          try { display = JSON.stringify(val); } catch { display = "[array]"; }
        }
      } else {
        // FIX (audit P27-B2): wrap JSON.stringify in try/catch — Mongoose
        // populated docs can contain circular references that would crash
        // the tab. On failure, fall back to a safe placeholder.
        try {
          display = typeof val === "object" ? JSON.stringify(val) : String(val);
        } catch {
          display = "[object]";
        }
      }
      return (
        <span key={k} className="ppt-sub-kv">
          <span className="ppt-sub-k">{prettyKey(k)}:</span>{" "}
          <span className="ppt-sub-v">{display}</span>
        </span>
      );
    });
}

function prettyKey(k) {
  return k.replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/_/g, " ")
          .replace(/^./, (c) => c.toUpperCase());
}

function Field({ label, value, mono, wide, danger }) {
  const isEmpty = value == null || value === "" || (typeof value === "string" && value.trim() === "");
  return (
    <div className={`ppt-field ${wide ? "ppt-field--wide" : ""}`}>
      <div className="ppt-field-label">{label}</div>
      <div className={`ppt-field-value ${mono ? "ppt-mono" : ""} ${danger ? "ppt-danger" : ""}`}>
        {isEmpty ? "—" : value}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   R7hr-143 — Pending Investigation Reports

   Shared tab visible inside BOTH Doctor Notes and Nursing Notes patient
   panels. Lists every Investigation order whose auditLog contains a
   `Sample Sent` step but no `Report Collected` step — i.e. the bench
   is processing it and the result hasn't come back yet.

   Why this matters (NABH AAC.4 / IPSG.2):
   • Surveyor question: "Where do you see, at a glance, every lab/imaging
     report you're still waiting on for this patient?"
   • Pre-fix, that list only existed inside the order panel which was
     mixed with new orders, completed orders, and other order types.
     Doctors had no way to scan an at-a-glance "waiting" list.

   Workflow:
   • Nurse clicks Sample Collected → Sample Sent on the order card. The
     order's `auditLog` now contains a `Sample Sent` row → the order
     shows up here.
   • When report arrives, the nurse clicks "✅ Mark Report Collected"
     here → POSTs /step with step="Report Collected" → backend's
     existing /step handler closes the order (status Completed) and
     stamps `completedBy`/`completedAt`. The auto-bill hook fires.

   Render contract:
   • `admission` provides admissionId / ipdNo / UHID for the GET.
   • `canMarkReportCollected` (default true) — set false for read-only
     surfaces. Caller (Nurse vs Doctor panel) decides based on perms.
   • Component is data-driven via its own fetch so the parent doesn't
     need to know about DoctorOrder shape.
───────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   R7hr-229 — Investigations (this admission). Read-only tab for BOTH the
   Doctor and Nurse panels. Pulls the day-wise + trend aggregate from
   GET /api/admission-investigations (InvestigationOrder results + LabTrend
   daily readings + LabReport narrative reports, scoped to the admission's
   date window). Shows the SAME paragraph that auto-fills the discharge
   summary (keyInvestigationsText), plus a day-wise grouped view + trends.
   ADDITIVE: a new export; touches no existing tab.
───────────────────────────────────────────────────────────────────── */
export function InvestigationsSummaryTab({ admission, patient }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const UHID = patient?.UHID || admission?.UHID || "";
  const admissionId = admission?._id || "";

  useEffect(() => {
    if (!UHID && !admissionId) { setData(null); return; }
    let cancelled = false;
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (UHID) params.set("uhid", UHID);
    if (admissionId) params.set("admissionId", String(admissionId));
    axios.get(`${API_ENDPOINTS.BASE}/admission-investigations?${params.toString()}`)
      .then((r) => { if (!cancelled) setData(r.data?.data || null); })
      .catch((e) => { if (!cancelled) { setError(e?.response?.data?.message || e.message || "Failed to load"); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [UHID, admissionId]);

  if (loading) return <div className="ppt-empty" style={{ padding: 24, color: "#64748b" }}>Loading investigations…</div>;
  if (error)   return <div className="ppt-empty" style={{ padding: 24, color: "#b91c1c" }}>⚠ {error}</div>;

  const days   = data?.days   || [];
  const trends = data?.trends || [];
  const para   = (data?.paragraph || "").trim();
  if (!para && days.length === 0) {
    return <div className="ppt-empty" style={{ padding: 28, textAlign: "center", color: "#64748b" }}>
      🧪 No investigations recorded for this admission yet.
    </div>;
  }

  const card = { border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", overflow: "hidden" };
  const head = (bg, color) => ({ padding: "8px 14px", background: bg, color, fontSize: 12, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 2px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>🧪 Investigations — this admission</div>
        <span style={{ fontSize: 11.5, color: "#475569", background: "#eef2ff", border: "1px solid #dbe3ec", borderRadius: 999, padding: "3px 10px" }}>
          {data?.counts?.days || 0} day{(data?.counts?.days || 0) === 1 ? "" : "s"} · {data?.counts?.panels || 0} lab panel{(data?.counts?.panels || 0) === 1 ? "" : "s"} · {data?.counts?.reports || 0} report{(data?.counts?.reports || 0) === 1 ? "" : "s"}
        </span>
      </div>

      {/* The narrative paragraph (same text that flows to the discharge summary) */}
      {para && (
        <div style={{ ...card, borderLeft: "4px solid #4f46e5" }}>
          <div style={head("#eef2ff", "#4338ca")}>Summary (day-wise + trend)</div>
          <p style={{ margin: 0, padding: "12px 16px", fontSize: 13, lineHeight: 1.6, color: "#0f172a", whiteSpace: "pre-wrap" }}>{para}</p>
          <div style={{ padding: "0 16px 10px", fontSize: 10.5, color: "#94a3b8" }}>This is the same summary that auto-fills the discharge summary's Key Investigations.</div>
        </div>
      )}

      {/* Day-wise grouped detail */}
      {days.map((b) => (
        <div key={b.dateKey} style={card}>
          <div style={head("#f1f5f9", "#334155")}>Day {b.dayNo} · {b.dateLabel}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              {b.items.map((it, i) => (
                <tr key={i} style={{ borderTop: i ? "1px solid #f1f5f9" : "none" }}>
                  <td style={{ padding: "7px 14px", fontWeight: 700, color: "#0f172a", width: "34%", verticalAlign: "top" }}>
                    {it.type === "report" ? "🖼 " : "🧫 "}{it.name}
                  </td>
                  <td style={{ padding: "7px 14px", color: "#334155", whiteSpace: "pre-wrap" }}>{it.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Trends */}
      {trends.length > 0 && (
        <div style={{ ...card, borderLeft: "4px solid #0d9488" }}>
          <div style={head("#f0fdfa", "#0f766e")}>Trends across the stay</div>
          <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
            {trends.map((t, i) => (
              <div key={i} style={{ fontSize: 12.5, color: "#0f172a" }}>
                <b>{t.test}</b>: {t.first} <span style={{ color: "#0d9488" }}>→</span> {t.last}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PendingInvestigationReportsTab({ admission, patient, canMarkReportCollected = true, actorName = "" }) {
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [busyId, setBusyId]   = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const UHID  = patient?.UHID || admission?.UHID || "";
  const ipdNo = admission?.ipdNo || admission?.admissionNo || "";

  useEffect(() => {
    if (!UHID && !ipdNo) { setOrders([]); return; }
    let cancelled = false;
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (UHID)  params.set("UHID", UHID);
    if (ipdNo) params.set("ipdNo", ipdNo);
    params.set("orderType", "Investigation");
    params.set("limit", "500");
    axios.get(`${API_ENDPOINTS.BASE}/doctor-orders?${params.toString()}`)
      .then((r) => {
        if (cancelled) return;
        const all = r.data?.data || [];
        setOrders(all);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.error || e.message || "Failed to load");
        setOrders([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [UHID, ipdNo, refreshTick]);

  /* ── Filter: orders that hit "Sample Sent" but NOT "Report Collected" ── */
  // Backward compat: pre-R7hr-143 imaging orders used "Done" instead of
  // "Sample Sent" and "Report Received" instead of "Report Collected".
  // Keep those aliases in the membership test so legacy orders surface
  // here too (per R25: don't regress already-flowing data).
  const SAMPLE_SENT_ALIASES   = new Set(["Sample Sent", "Done"]);
  const REPORT_DONE_ALIASES   = new Set(["Report Collected", "Report Received"]);

  const pending = useMemo(() => {
    return (orders || [])
      .filter((o) => o.orderType === "Investigation")
      .filter((o) => o.status !== "Cancelled")
      .map((o) => {
        const log = Array.isArray(o.auditLog) ? o.auditLog : [];
        const sentRow   = log.find((r) => SAMPLE_SENT_ALIASES.has(r.step));
        const reportRow = log.find((r) => REPORT_DONE_ALIASES.has(r.step));
        return { ...o, _sentRow: sentRow, _reportRow: reportRow };
      })
      .filter((o) => o._sentRow && !o._reportRow)
      .sort((a, b) => new Date(a._sentRow?.doneAt || 0) - new Date(b._sentRow?.doneAt || 0));
  }, [orders]);

  const completedToday = useMemo(() => {
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    return (orders || []).filter((o) => {
      const log = Array.isArray(o.auditLog) ? o.auditLog : [];
      const reportRow = log.find((r) => REPORT_DONE_ALIASES.has(r.step));
      return reportRow && new Date(reportRow.doneAt) >= startToday;
    });
  }, [orders]);

  async function markReportCollected(orderId) {
    if (!canMarkReportCollected) return;
    if (busyId) return;
    setBusyId(orderId);
    try {
      // R7hr-143 — Drive the same /step pipeline the order card uses so
      // the backend auto-bill hook + ClinicalAudit emit + status
      // moveStatus() machinery all fire identically. We pass
      // totalSteps=3 so the route treats this as the last step and
      // flips status to Completed.
      await axios.post(`${API_ENDPOINTS.BASE}/doctor-orders/${orderId}/step`, {
        step: "Report Collected",
        doneBy: actorName || "Nurse",
        totalSteps: 3,
      });
      setRefreshTick((t) => t + 1);
    } catch (e) {
      alert(e?.response?.data?.message || e.message || "Failed to mark report collected");
    } finally {
      setBusyId(null);
    }
  }

  const fmtAgo = (d) => {
    if (!d) return "—";
    const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const urgencyColor = (u) => {
    const x = (u || "").toUpperCase();
    if (x === "STAT")    return { bg: "#fef2f2", fg: "#dc2626", bd: "#fecaca" };
    if (x === "URGENT")  return { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" };
    return { bg: "#f1f5f9", fg: "#475569", bd: "#cbd5e1" };
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
            🧪 Pending Investigation Reports
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Samples sent — awaiting report. Click <strong>Mark Report Collected</strong> when the result arrives.
          </div>
        </div>
        <button
          onClick={() => setRefreshTick((t) => t + 1)}
          style={{
            background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 6,
            padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, color: "#475569",
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700, letterSpacing: 0.5 }}>AWAITING REPORT</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#b45309", marginTop: 2 }}>{pending.length}</div>
        </div>
        <div style={{ background: "#ecfdf5", border: "1px solid #86efac", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#166534", fontWeight: 700, letterSpacing: 0.5 }}>REPORTS RECEIVED TODAY</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#15803d", marginTop: 2 }}>{completedToday.length}</div>
        </div>
        <div style={{ background: "#eef2ff", border: "1px solid #93c5fd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: "#4338ca", fontWeight: 700, letterSpacing: 0.5 }}>STAT / URGENT WAITING</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#4f46e5", marginTop: 2 }}>
            {pending.filter((o) => ["STAT","Urgent","URGENT"].includes(o.orderDetails?.urgency)).length}
          </div>
        </div>
      </div>

      {loading && <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Loading…</div>}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: 12, borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!loading && pending.length === 0 && !error && (
        <div style={{
          padding: 40, textAlign: "center", background: "#f8fafc",
          border: "1px dashed #cbd5e1", borderRadius: 8, color: "#64748b",
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>No pending reports</div>
          <div style={{ fontSize: 13 }}>
            All investigation samples have either not been sent yet, or all reports have been collected.
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {pending.map((o) => {
            const u = urgencyColor(o.orderDetails?.urgency);
            const sentAt = o._sentRow?.doneAt;
            return (
              <div key={o._id} style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderLeft: "4px solid #f59e0b",
                borderRadius: 8,
                padding: 14,
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 14,
                alignItems: "center",
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{
                      background: u.bg, color: u.fg, border: `1px solid ${u.bd}`,
                      borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
                    }}>
                      {(o.orderDetails?.urgency || "Routine").toUpperCase()}
                    </span>
                    <span style={{
                      background: "#eef2ff", color: "#4f46e5", border: "1px solid #93c5fd",
                      borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700,
                    }}>
                      Investigation
                    </span>
                    {o.orderDetails?.category && (
                      <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                        · {o.orderDetails.category}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
                    {o.orderDetails?.testName || o.orderDetails?.displayName || "Investigation"}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>
                      <strong style={{ color: "#0f172a" }}>Sample sent:</strong>{" "}
                      {sentAt
                        ? `${new Date(sentAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })} (${fmtAgo(sentAt)})`
                        : "—"}
                    </span>
                    {o._sentRow?.doneBy && (
                      <span>
                        · <strong style={{ color: "#0f172a" }}>By:</strong> {o._sentRow.doneBy}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                    Rx by: {o.orderedBy || "Doctor"}
                    {o.orderedByEmployeeId && ` (${o.orderedByEmployeeId})`}
                    {" · Ordered "}
                    {o.createdAt
                      ? new Date(o.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })
                      : "—"}
                  </div>
                </div>
                {canMarkReportCollected && (
                  <button
                    onClick={() => markReportCollected(o._id)}
                    disabled={busyId === o._id}
                    style={{
                      background: busyId === o._id ? "#94a3b8" : "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 14px",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: busyId === o._id ? "wait" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {busyId === o._id ? "Saving…" : "✅ Mark Report Collected"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
