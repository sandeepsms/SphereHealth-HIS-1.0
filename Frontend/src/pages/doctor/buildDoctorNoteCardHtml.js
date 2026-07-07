// R7gd — exported helper that returns the inner HTML body for a single
// doctor note (header bar + per-type compact card + late-entry banner +
// signature footer). Mirrors the R7fx TYPE_BUILDERS pattern in
// DoctorNotesPage.jsx printNote() so the Complete Patient File Narrative
// theme can embed identical per-type cards inside the day-wise journey.
//
// R7gx — Initial Assessment card now pulls every populated NABH P1+P2
// sub-bucket through the shared renderer module so the patient panel
// surfaces every assessed dimension (NABH AAC.1 / AAC.2 / IPSG.6),
// not just the six sections the original builder hard-coded.

import {
  renderDoctorNabhExtras,
  renderNursingNabhExtras,
} from "../../Components/clinical/iaNabhRenderers";

const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); // R7hr-251 (audit) — single-quoted attribute contexts

const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// Robust fmt — never emits [object Object]; extracts scalar from objects,
// joins arrays, formats ISO timestamps.
const fmtVal = (v) => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") {
    if (ISO_RX.test(v)) {
      try {
        return new Date(v).toLocaleString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
      } catch { /* fall */ }
    }
    return v;
  }
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "object" && x !== null)
      ? (x.value || x.text || x.name || JSON.stringify(x))
      : String(x)).filter(Boolean).join(", ");
  }
  if (typeof v === "object") {
    if ("systolic" in v || "diastolic" in v) {
      return `${v.systolic ?? "—"}/${v.diastolic ?? "—"}`;
    }
    const scalar = v.value ?? v.text ?? v.name ?? v.label;
    if (scalar !== undefined && scalar !== null && scalar !== "") return String(scalar);
    const entries = Object.entries(v)
      .filter(([, val]) => val !== undefined && val !== null && val !== "" && val !== false)
      .map(([k, val]) => (val === true ? k : `${k}: ${fmtVal(val)}`));
    return entries.length ? entries.join("; ") : "";
  }
  return String(v);
};

// R7gf — tables get page-break-inside:avoid (WHO checklist, ICU bundle,
// MCCD layer table, GCS row should never split mid-row). Card-level
// avoid is dropped in the wrapper below — that fixed pages that
// previously held a single Vital Signs / small card and the rest empty.
// R7hr-107 — Bolder field-label headlines.
// User feedback: the labels above doctor's text-field values were the same
// weight (600) and a soft slate-600 grey, so the eye couldn't anchor on them
// when scanning a long IA card. Bumping the label to 800 weight + darker
// slate-800 colour + slightly larger 11px gives the labels a true headline
// feel — the doctor can now skim the labels and jump straight to the line
// they need. Section dividers and table headers nudged the same way for
// consistency. Values unchanged (already near-black at 11.5px).
// R25-safe: pure CSS tweak, no markup change, no field gain/loss.
const COMPACT_GRID_CSS = `<style>
  .dfx-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 18px;font-size:11.5px;margin:6px 0 11px}
  /* R7hr-108 — 3-column variant for sections with many short key/value
     pairs (Examination Findings sub-blocks — General Exam chips +
     CVS / RS / CNS / P-A). Doctor's values here are mostly 1–2 word
     answers (Yes / No / Normal / Conscious / Well hydrated / S1 S2
     Normal / E4 V5 M6 / B/L equal etc.), so 3 columns pack tighter
     without truncation. All other sections (History, Diagnosis,
     Investigations & Plan) stay 2-column because their values are
     longer free text. The .full class still spans the full row. */
  .dfx-grid--3col{grid-template-columns:1fr 1fr 1fr;gap:4px 14px}
  .dfx-grid .lbl{font-weight:800;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:2px}
  .dfx-grid .val{color:#0f172a;font-size:11.5px;white-space:pre-wrap}
  .dfx-grid .full{grid-column:1 / -1}
  .dfx-h{margin:13px 0 6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:5px 10px;border-radius:5px}
  .dfx-tbl{width:100%;border-collapse:collapse;font-size:11px;margin:5px 0 10px;page-break-inside:avoid;break-inside:avoid}
  .dfx-tbl th{padding:5px 8px;border:1px solid #e7edf3;background:#f6f8fb;font-size:10px;font-weight:800;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.3px}
  .dfx-tbl td{padding:5px 8px;border:1px solid #eef2f6;color:#0f172a}
  /* R7hu — the Rx / Infusions / Lab-order tables use class .ndx-tbl, which was
     never defined here → they rendered as unstyled browser-default tables that
     overflowed the ~703px A4 print width and split mid-row across pages. Define
     it: fixed layout keeps the 6 columns in-bounds, word-break wraps long
     instructions, page-break-inside:avoid keeps each drug row whole. */
  .ndx-tbl{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5px;margin:5px 0 10px;page-break-inside:avoid;break-inside:avoid}
  .ndx-tbl th{padding:4px 6px;border:1px solid #e7edf3;background:#f6f8fb;font-size:9.5px;font-weight:800;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.3px;word-break:break-word}
  .ndx-tbl td{padding:4px 6px;border:1px solid #eef2f6;color:#0f172a;font-size:10.5px;word-break:break-word;overflow-wrap:anywhere;vertical-align:top}
  .dfx-narr{margin:6px 0 11px;padding:9px 13px;background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:0 6px 6px 0;font-size:11.5px;white-space:pre-wrap;line-height:1.45}
  .dfx-banner{margin:6px 0 12px;padding:9px 14px;border-radius:7px;font-size:12px;font-weight:700}
  /* R7hu — PROSE variant (Complete File print): every note renders as flowing
     bold-label lines like the Doctor Initial Assessment narrative, no card
     chrome. Triggered by opts.prose; the card classes above are untouched so
     the Doctor Notes timeline + patient panel keep the card design. */
  /* R7hu — 2-column "book" layout: each note's fields flow into two columns so
     the note is compact instead of one tall single column that wasted the right
     half of the page and added blank space / extra pages. The title, section
     headings, signature and any table span BOTH columns; a field line never
     splits across a column. */
  .pfx-note{font-size:11px;color:#1e293b;line-height:1.4;display:grid;grid-template-columns:repeat(auto-fit,minmax(max(240px,40%),1fr));column-gap:26px;row-gap:1px;align-content:start}
  .pfx-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#334155;margin:0 0 5px;padding-bottom:3px;border-bottom:2px solid #e2e8f0;grid-column:1 / -1}
  .pfx-h{margin:7px 0 1px;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;grid-column:1 / -1}
  .pfx-line{margin:2px 0;font-size:11px;line-height:1.4;color:#1e293b;white-space:pre-wrap;break-inside:avoid;min-width:0}
  .pfx-line strong{color:#0f172a;font-weight:700}
  .pfx-sign{margin-top:8px;padding-top:5px;border-top:1px solid #e2e8f0;font-size:10px;color:#475569;grid-column:1 / -1}
  .pfx-note table{grid-column:1 / -1}
</style>`;

// R7hu — when true, the shared helpers below emit the PROSE variant (bold-label
// lines) instead of the card grid. Set per-call at the top of the exported
// builder from opts.prose; JS is single-threaded so a module-level flag is safe.
let _prose = false;

// R7hu — omit a field whose value is only a placeholder dash (— / – / - / --)
// or N/A / null / undefined; the standing rule is that "—" never prints where
// a value should. Real clinical negatives ("None", "Nil") are kept.
const _isPlaceholderDash = (s) =>
  /^[\s—–-]+$/.test(String(s)) || /^(n\/?a|null|undefined)$/i.test(String(s).trim());
const _kv = (label, value, isFull = false) => {
  const v = fmtVal(value);
  if (!v || _isPlaceholderDash(v)) return "";
  if (_prose) return `<div class="pfx-line"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(v)}</div>`;
  return `<div${isFull ? ' class="full"' : ""}><span class="lbl">${escapeHtml(label)}</span><span class="val">${escapeHtml(v)}</span></div>`;
};
const _section = (title, color, bodyHtml) =>
  !bodyHtml ? ""
  : _prose ? `<div class="pfx-h" style="color:${color}">${escapeHtml(title)}</div>${bodyHtml}`
  : `<div class="dfx-h" style="background:${color}20;color:${color};border-left:3px solid ${color}">${escapeHtml(title)}</div>${bodyHtml}`;
const _grid = (cells) => {
  const kept = cells.filter(Boolean);
  return kept.length ? (_prose ? kept.join("") : `<div class="dfx-grid">${kept.join("")}</div>`) : "";
};
// R7hr-108 — 3-column grid for chip-style sections (used by
// Examination Findings sub-blocks where each value is 1–2 words).
const _grid3 = (cells) => {
  const kept = cells.filter(Boolean);
  return kept.length ? (_prose ? kept.join("") : `<div class="dfx-grid dfx-grid--3col">${kept.join("")}</div>`) : "";
};
const _narr = (text) => text ? (_prose ? `<div class="pfx-line">${escapeHtml(String(text))}</div>` : `<div class="dfx-narr">${escapeHtml(String(text))}</div>`) : "";

// Per-type builders — compact equivalents of DoctorNotesPage TYPE_BUILDERS.
// R7hr-100 — `opts` (default {}) is forwarded from the outer
// buildDoctorNoteCardHtml(note, opts) so the `initial` builder can
// honour opts.hideNursingExtras. All other builders ignore opts;
// signature stays back-compat — passing nothing preserves prior behaviour.
const buildBuilder = (note, opts = {}) => {
  const nd = note.noteDetails || {};

  const BUILDERS = {
    admission: () => {
      const identity = _section("Admission Identity", "#4f46e5", _grid([
        _kv("Mode of Admission", nd.modeOfAdmission),
        _kv("Brought By", nd.broughtBy),
        _kv("First Contact", nd.firstContactTime),
        _kv("Triage", nd.triageCategory),
        _kv("Admitting Dept", nd.admittingDept),
        _kv("Consultant On-Call", nd.consultantOnCall),
        _kv("Bed Allocated", nd.bedAllocated),
        _kv("Risk Stratification", nd.riskStratification),
        _kv("Infection Status", nd.infectionStatus, true),
      ]));
      const cc = note.soap?.subjective ? _section("Chief Complaint / HPI", "#0d9488", _narr(note.soap.subjective)) : "";
      const ax = note.soap?.assessment ? _section("Assessment", "#d97706", _narr(note.soap.assessment)) : "";
      const pl = note.soap?.plan ? _section("Initial Plan", "#16a34a", _narr(note.soap.plan)) : "";
      return identity + cc + ax + pl;
    },

    icu: () => {
      // R7hu — the ICU form (DoctorNotesPage) saves flat ventilator + system
      // fields; the old builder read a bundleCompliance / ventilatorStatus shape
      // the form never writes, so every captured ICU value was dropped and the
      // bundle table showed "NOT DONE" for every row. Read the actual saved keys
      // (empty sections auto-hide); keep the legacy bundle table ONLY when the
      // note genuinely carries a bundleCompliance object.
      const vent = _section("Ventilator Settings", "#dc2626", _grid([
        _kv("Mode", nd.ventMode || nd.ventilatorStatus),
        _kv("FiO₂", nd.fio2), _kv("PEEP", nd.peep), _kv("Tidal Volume", nd.tv),
        _kv("Vent RR", nd.ventRR), _kv("PIP", nd.pip), _kv("MAP", nd.map), _kv("CVP", nd.cvp),
      ]));
      const support = _section("Sedation & Haemodynamics", "#b91c1c", _grid([
        _kv("RASS Score", nd.rassScore), _kv("BPS Score", nd.bpsScore),
        _kv("Sedation", nd.sedation || nd.sedationStatus),
        _kv("Vasopressors", typeof nd.vasopressors === "boolean" ? (nd.vasopressors ? "Yes" : "No") : nd.vasopressors),
        _kv("Vasopressor Detail", nd.vasopressorDetail || nd.invasiveLines, true),
      ]));
      const systems = _section("System Review", "#475569", _grid([
        _kv("Neuro", nd.neuro, true), _kv("CVS", nd.cvs, true), _kv("Respiratory", nd.resp, true),
        _kv("Renal", nd.renal, true), _kv("GI", nd.gi, true), _kv("Haematology", nd.haem, true),
        _kv("Infective", nd.infective, true),
      ]));
      const goals = _section("Daily Goals & Care", "#0891b2", _grid([
        _kv("Daily Goals", nd.dailyGoals || nd.goalsOfCare, true),
        _kv("Family Meeting", nd.familyMeeting, true),
      ]));
      const bc = nd.bundleCompliance;
      const bundle = (bc && Object.keys(bc).length) ? (() => {
        const bcRows = [
          ["VAP — HOB Elevated ≥30°", bc.vapHobElevated], ["VAP — Oral Care q4h", bc.vapOralCare],
          ["DVT Prophylaxis", bc.dvtProphylaxis], ["Stress-ulcer Prophylaxis", bc.stressUlcerProphylaxis],
          ["Glycaemic Control", bc.glucoseControl],
        ];
        const bcTable = `<table class="dfx-tbl"><tr><th>NABH COP.5 Bundle Element</th><th>Status</th></tr>${bcRows.map(r => {
          const raw = r[1];
          const cell = (raw === undefined || raw === null || raw === "" || raw === false)
            ? `<strong style="color:#dc2626">✗ NOT DONE</strong>` : `<strong>${escapeHtml(String(raw))}</strong>`;
          return `<tr><td>${escapeHtml(r[0])}</td><td>${cell}</td></tr>`;
        }).join("")}</table>`;
        return _section("Bundle Compliance (NABH COP.5)", "#dc2626", bcTable);
      })() : "";
      const narr = note.soap?.assessment ? _section("Clinical Progress", "#475569", _narr(note.soap.assessment)) : "";
      return vent + support + systems + goals + bundle + narr;
    },

    procedure: () => {
      // R7hu — read the keys the procedure form actually saves (anaesthesia,
      // position, technique, findings, bloodLoss, specimenType, postInstructions)
      // alongside the legacy aliases. Bools → readable text.
      const proc = _section(`Procedure — ${nd.procedureName || "—"}`, "#ea580c", _grid([
        _kv("Indication", nd.indication, true),
        _kv("Anatomical Site / Position", nd.anatomicalSite || nd.position),
        _kv("Operator / Surgeon", nd.operator || nd.surgeon),
        _kv("Assistants", nd.assistants || nd.assistant),
        _kv("Anaesthesia", nd.anaesthesia),
        _kv("Time", nd.time),
        _kv("Consent", nd.consentType || (typeof nd.consentObtained === "boolean" ? (nd.consentObtained ? "Obtained" : "Not obtained") : nd.consentObtained)),
        _kv("Asepsis", nd.asepsisMaintained),
        _kv("WHO Timeout", nd.timeoutPerformed),
      ]));
      const tech = _section("Technique & Findings", "#475569", _grid([
        _kv("Technique", nd.technique, true),
        _kv("Findings", nd.findings || note.soap?.objective, true),
      ]));
      const out = _section("Outcome", "#475569", _grid([
        _kv("Complications", nd.complications, true),
        _kv("Blood Loss", nd.bloodLoss),
        _kv("Initial Drainage", nd.initialDrainage),
        _kv("Specimens", typeof nd.specimenSent === "boolean" ? (nd.specimenSent ? (nd.specimenType || "Sent") : "") : (nd.specimens || nd.specimenType)),
        _kv("Post-procedure Vitals", nd.postProcedureVitals, true),
        _kv("Post-procedure Instructions", nd.postInstructions, true),
      ]));
      const narr = note.soap?.assessment ? _section("Notes", "#475569", _narr(note.soap.assessment)) : "";
      return proc + tech + out + narr;
    },

    consultation: () => {
      const mast = _section("Referral Masthead", "#7c3aed", _grid([
        _kv("From", nd.referredBy),
        _kv("To", nd.referredTo || nd.consultantName),
        _kv("Speciality", nd.speciality),
        _kv("Reason", nd.consultReason || nd.reason, true),
      ]));
      const summ = note.soap?.subjective ? _section("Clinical Summary", "#475569", _narr(note.soap.subjective)) : "";
      const imp = note.soap?.assessment ? _section("Impression", "#d97706", _narr(note.soap.assessment)) : "";
      const recos = note.soap?.plan ? _section("Recommendations", "#7c3aed", _narr(note.soap.plan)) : "";
      return mast + summ + imp + recos;
    },

    discharge: () => {
      const meta = _section("Discharge Summary", "#16a34a", _grid([
        _kv("Admission Date", nd.admissionDate),
        _kv("Discharge Date", nd.dischargeDate),
        _kv("Length of Stay", nd.lengthOfStay),
        _kv("Outcome", nd.outcome),
        _kv("Disposition", nd.disposition, true),
      ]));
      const course = (note.soap?.subjective || note.soap?.objective || note.soap?.assessment)
        ? _section("Course in Hospital", "#475569", _narr([note.soap?.subjective, note.soap?.objective, note.soap?.assessment].filter(Boolean).join("\n\n")))
        : "";
      const meds = nd.dischargeMedications
        ? _section("Discharge Medications", "#4f46e5", _narr(nd.dischargeMedications))
        : "";
      const advice = note.soap?.plan ? _section("Discharge Instructions", "#0d9488", _narr(note.soap.plan)) : "";
      return meta + course + meds + advice;
    },

    death: () => {
      const banner = `<div class="dfx-banner" style="background:#fef2f2;color:#991b1b;border:2px solid #dc2626;text-align:center">DEATH SUMMARY · NABH COP.19 · WHO MCCD</div>`;
      const headline = _section("Pronouncement", "#dc2626", _grid([
        _kv("Time of Death", nd.timeOfDeath || nd.dateTime),
        _kv("Mode of Death", nd.modeOfDeath),
        _kv("Place of Death", nd.placeOfDeath),
        _kv("Pronounced By", nd.certifiedBy || note.signedByName),
        _kv("Certifier Reg No", nd.certifiedByReg || note.signedByReg || note.doctorRegNo),
      ]));
      const mccdRows = [
        ["I (a) Immediate Cause", nd.causeDeath1 || nd.causeOfDeath],
        ["I (b) Antecedent Cause", nd.causeDeath2],
        ["I (c) Underlying Cause", nd.causeDeath3],
        ["II Contributing Conditions", nd.contributing],
      ].filter(r => r[1]);
      const mccd = mccdRows.length
        ? _section("Cause of Death (MCCD)", "#dc2626",
            `<table class="dfx-tbl"><tr><th style="width:35%">WHO MCCD Layer</th><th>Cause</th></tr>${mccdRows.map(r => `<tr><td>${escapeHtml(r[0])}</td><td><strong>${escapeHtml(String(r[1]))}</strong></td></tr>`).join("")}</table>`)
        : "";
      // R7hu — the death form saves familyInformed / mlc / dnrInPlace / pmAdvised
      // / postMortemDone as BOOLEANS and adds sequenceOfEvents + certificate date;
      // the old builder printed the boolean straight into "Family Member" and
      // dropped the sequence. Format bools as Yes/No and surface the sequence.
      const yn = (v) => typeof v === "boolean" ? (v ? "Yes" : "No") : v;
      const seq = nd.sequenceOfEvents ? _section("Sequence of Events", "#475569", _narr(nd.sequenceOfEvents)) : "";
      const family = _section("Family Informed", "#475569", _grid([
        _kv("Family Informed", yn(nd.familyInformed)),
        _kv("Informed By", nd.familyInformedBy),
        _kv("Informed At", nd.familyInformedTime),
      ]));
      const admin = _section("Administrative", "#475569", _grid([
        _kv("MLC", yn(nd.mlcRequired ?? nd.mlc)),
        _kv("DNR", yn(nd.dnrInPlace)),
        _kv("PM Advised", yn(nd.pmAdvised)),
        _kv("PM Done", yn(nd.postMortemDone)),
        _kv("Certificate No", nd.deathCertificateNumber),
        _kv("Certificate Issued At", nd.deathCertificateIssuedAt),
        _kv("Body Disposition", nd.bodyDisposition, true),
      ]));
      return banner + headline + mccd + seq + family + admin;
    },

    amendment: () => {
      const banner = `<div class="dfx-banner" style="background:#fffbeb;color:#92400e;border:2px solid #f59e0b;text-align:center">CLINICAL DOCUMENT AMENDMENT · NABH IMS.2 · ORIGINAL RECORD RETAINED</div>`;
      const orig = _section("Original Note Reference", "#94a3b8", _grid([
        _kv("Original Note Type", nd.originalNoteType),
        _kv("Original Note Date", nd.originalNoteDate),
        _kv("Original Note ID", nd.originalNoteId),
      ]));
      const reason = nd.amendmentReason
        ? `<div style="margin:8px 0;padding:10px 14px;background:#fef3c7;border-left:4px solid #f59e0b;font-size:12px"><strong style="display:block;margin-bottom:4px;color:#92400e">Reason for Amendment</strong>${escapeHtml(nd.amendmentReason)}</div>` : "";
      const witness = _section("Witness / Co-signature", "#16a34a", _grid([
        _kv("Witnessed By", nd.witnessedBy),
        _kv("Compliance Note", nd.complianceNote, true),
      ]));
      return banner + orig + reason + witness;
    },

    operative: () => {
      const proc = _section(`Operative — ${nd.procedurePerformed || nd.procedureName || "—"}`, "#7c3aed", _grid([
        _kv("Pre-op Dx", nd.preopDiagnosis),
        _kv("Post-op Dx", nd.postopDiagnosis),
        _kv("Surgeon", nd.surgeon || nd.operator),
        _kv("Anaesthetist", nd.anaesthetist),
        _kv("Start Time", nd.startTime),
        _kv("End Time", nd.endTime),
      ]));
      const intra = _section("Intra-operative", "#475569", _grid([
        _kv("Blood Loss", nd.bloodLoss),
        _kv("Fluids Given", nd.fluidsGiven),
        _kv("Specimens", nd.specimens || nd.specimenSent, true),
      ]));
      return proc + intra;
    },

    preop: () => {
      const banner = `<div class="dfx-banner" style="background:#ecfeff;color:#155e75;border:2px solid #06b6d4;text-align:center">WHO SURGICAL SAFETY CHECKLIST · Pre-operative · NABH COP.13</div>`;
      // R7hu — the pre-op form saves FLAT fields (preopDiagnosis, plannedAnaesthesia,
      // bloodGroup, crossMatch, fastingHours, airwayPlan, comorbidities, currentMeds,
      // allergies, surgeon, anaesthetist, preopOrders, preOpBp/Pulse/Temp/Spo2, and
      // per-investigation reviewed flags cbc/pt/ecg/cxr/echo/lfts/rft). The old
      // builder read only a nested `preopChecklist` object the form never writes,
      // so the WHO table showed "NOT RECORDED" for everything. Read the real keys;
      // keep the legacy checklist table only when a preopChecklist object exists.
      const yn = (v) => typeof v === "boolean" ? (v ? "✓ Yes" : "✗ No") : v;
      const proc = _section("Planned Procedure", "#0891b2", _grid([
        _kv("Planned Procedure", nd.plannedProcedure || nd.procedure, true),
        _kv("Indication", nd.indication, true),
        _kv("Pre-op Diagnosis", nd.preopDiagnosis, true),
        _kv("ASA Class", nd.asaClass || nd.asaGrade),
        _kv("Planned Anaesthesia", nd.plannedAnaesthesia),
        _kv("Surgeon", nd.surgeon), _kv("Anaesthetist", nd.anaesthetist),
      ]));
      const prep = _section("Preparation", "#0891b2", _grid([
        _kv("Fasting", nd.fastingHours ? `${nd.fastingHours} h` : nd.nbmStatus),
        _kv("Blood Group", nd.bloodGroup),
        _kv("Cross-match", yn(nd.crossMatch)),
        _kv("Airway Plan", nd.airwayPlan, true),
        _kv("Comorbidities", nd.comorbidities, true),
        _kv("Current Meds", nd.currentMeds, true),
        _kv("Allergies", nd.allergies, true),
        _kv("Consent Obtained", yn(nd.consentObtained)),
        _kv("Pre-op Orders", nd.preopOrders, true),
      ]));
      const vitals = _section("Pre-op Vitals", "#dc2626", _grid([
        _kv("BP", nd.preOpBp), _kv("Pulse", nd.preOpPulse),
        _kv("Temp", nd.preOpTemp), _kv("SpO₂", nd.preOpSpo2),
      ]));
      const invRows = [
        ["CBC", nd.cbcReviewed], ["PT / INR", nd.ptReviewed], ["ECG", nd.ecgReviewed],
        ["Chest X-ray", nd.cxrReviewed], ["Echo", nd.echoReviewed],
        ["LFTs", nd.lftsReviewed], ["RFT", nd.rftReviewed],
      ].filter(r => r[1] !== undefined && r[1] !== null && r[1] !== "");
      const invTable = invRows.length
        ? _section("Investigations Reviewed", "#0891b2",
            `<table class="dfx-tbl"><tr><th style="width:65%">Investigation</th><th>Reviewed</th></tr>${invRows.map(r => {
              const ok = r[1] === true || /yes|done|reviewed/i.test(String(r[1]));
              const txt = r[1] === true ? "✓ Reviewed" : r[1] === false ? "✗ Not reviewed" : escapeHtml(String(r[1]));
              return `<tr><td>${escapeHtml(r[0])}</td><td><strong style="color:${ok ? "#16a34a" : "#dc2626"}">${txt}</strong></td></tr>`;
            }).join("")}</table>`)
        : "";
      const ck = nd.preopChecklist;
      const ckTable = (ck && Object.keys(ck).length) ? (() => {
        const ckRows = [
          ["Patient identity confirmed", ck.identityConfirmed], ["Consent signed", ck.consentSigned],
          ["Surgical site marked", ck.siteMarked], ["Allergies reviewed", ck.allergiesReviewed],
          ["Blood available", ck.bloodAvailable], ["Imaging available", ck.imagingAvailable],
          ["Anaesthetist review", ck.anaesthetistReview],
        ];
        return _section("WHO Safety Checklist", "#0891b2",
          `<table class="dfx-tbl"><tr><th style="width:65%">WHO Safety Sign-In Item</th><th>Status</th></tr>${ckRows.map(r => {
            const raw = r[1];
            let cell;
            if (raw === undefined || raw === null || raw === "") cell = `<strong style="color:#dc2626">— NOT RECORDED —</strong>`;
            else if (raw === false) cell = `<strong style="color:#dc2626">✗ NOT CHECKED</strong>`;
            else cell = `<strong style="color:#16a34a">✓</strong> ${escapeHtml(String(raw))}`;
            return `<tr><td>${escapeHtml(r[0])}</td><td>${cell}</td></tr>`;
          }).join("")}</table>`);
      })() : "";
      return banner + proc + prep + vitals + invTable + ckTable;
    },

    postop: () => {
      // R7hu — the post-op form saves procedurePerformed / operativeFindings /
      // postopDiagnosis / surgeon / anaesthetist / times / bloodLoss /
      // transfusion / fluidsGiven / urineOutput / specimen* / conditionLeavingOT
      // / recoveryInstructions / postopOrders. The old builder read only
      // postopVitals/consciousness/painScore/wardTransferTime — so almost the
      // whole post-op note was dropped. Read the actual keys (legacy aliases kept).
      const proc = _section(`Post-op — ${nd.procedurePerformed || "—"}`, "#16a34a", _grid([
        _kv("Procedure Performed", nd.procedurePerformed, true),
        _kv("Post-op Diagnosis", nd.postopDiagnosis, true),
        _kv("Operative Findings", nd.operativeFindings, true),
        _kv("Surgeon", nd.surgeon), _kv("Anaesthetist", nd.anaesthetist),
        _kv("Anaesthesia", nd.anaesthesia),
        _kv("Start Time", nd.startTime), _kv("End Time", nd.endTime),
      ]));
      const intra = _section("Intra-operative", "#475569", _grid([
        _kv("Blood Loss", nd.bloodLoss), _kv("Transfusion", nd.transfusion),
        _kv("Fluids Given", nd.fluidsGiven), _kv("Urine Output", nd.urineOutput),
        _kv("Specimens", typeof nd.specimenSent === "boolean" ? (nd.specimenSent ? (nd.specimenType || "Sent") : "") : nd.specimenType),
      ]));
      const recovery = _section("Recovery & Post-op Orders", "#16a34a", _grid([
        _kv("Condition Leaving OT", nd.conditionLeavingOT || nd.consciousness, true),
        _kv("Post-op Vitals", nd.postopVitals, true),
        _kv("Pain Score", nd.painScore),
        _kv("Complications", nd.complications, true),
        _kv("Recovery Instructions", nd.recoveryInstructions, true),
        _kv("Post-op Orders", nd.postopOrders, true),
        _kv("Ward Transfer Time", nd.wardTransferTime, true),
      ]));
      const narr = note.soap?.plan ? _section("Orders / Plan", "#16a34a", _narr(note.soap.plan)) : "";
      return proc + intra + recovery + narr;
    },

    initial: () => {
      // R7gp — full per-type Initial Assessment card. Replaces the prior
      // skeleton (which only emitted Chief Complaint + Diagnosis and let
      // KeyValueAll dump the rest as raw JSON). Renders every NABH P0+P1
      // sub-block as a tidy grid / table so the panel mirrors the printed
      // R7fh discharge / Complete File layout.
      //
      // R7gp-FIX — When the doctor IA was saved before the doctor side
      // was filled (drafts, early sign-by-admin), noteDetails has only
      // `nursing` + `nursingNabh` + `crossCheckAlerts` and no `doctor`
      // key. Fall back through nursingNabh so the card still surfaces
      // the patient's PMH / allergies / home meds / anthropometry that
      // the nurse intake captured — those fields are clinically shared
      // and the empty doctor card was misleading.
      const _dp = nd.doctor || nd;
      // R7hu — the demo / legacy flat shape writes the IA fields straight on
      // the doctor payload, with slightly different names than the current IPD
      // form (which nests most under `.nabh`). Normalise so THIS card renders
      // both shapes — real `.nabh` data wins; the flat aliases fill the gaps —
      // exactly like the Complete File print already does.
      const docPayload = {
        ..._dp,
        chiefComplaint: _dp.chiefComplaint ?? _dp.chiefComplaints,
        hopi:   _dp.hopi ?? _dp.historyOfPresentingIllness ?? _dp.hpi,
        pmh:    _dp.pmh ?? _dp.pastMedicalHistory,
        famHx:  _dp.famHx ?? _dp.familyHistory,
        socHx:  _dp.socHx ?? _dp.socialHistory,
        genExam:_dp.genExam ?? _dp.generalExamination,
        provDx: _dp.provDx ?? _dp.provisionalDiagnosis,
        finalDx:_dp.finalDx ?? _dp.finalDiagnosis,
      };
      // R7hu — the demo / legacy flat ROS uses cvs/rs/git/gut/cns keys; the
      // shared renderer keys on cardiac/respiratory/gi/gu/neuro, so an un-mapped
      // ROS surfaced only the "skin" row. Remap the aliases so every reviewed
      // system shows. The flat shape also stores functionalEcog as one string
      // while the renderer wants {score,disabilities,aidsRequired} — split the
      // leading grade off. (The Complete File Narrative reads these two from a
      // different path — f.exam.ros + the raw string — so it is untouched.)
      const _rosAlias = { cvs: "cardiac", rs: "respiratory", git: "gi", gut: "gu", cns: "neuro" };
      const _remapRos = (r) => {
        if (!r || typeof r !== "object" || Array.isArray(r)) return r;
        const out = {};
        for (const [k, v] of Object.entries(r)) out[_rosAlias[k] || k] = v;
        return out;
      };
      const _ecogObj = (e) => {
        if (!e || typeof e === "object") return e;
        const s = String(e).trim(); const g = s.match(/^\d/);
        return g ? { score: g[0], disabilities: s.replace(/^\d[\s.—:()-]*/, "").replace(/\)$/, "").trim() } : { score: s };
      };
      const _flatNabh = {
        chiefComplaint:  docPayload.chiefComplaint,
        workingDx:       _dp.workingDiagnosis,
        differentialDx:  _dp.differentialDiagnosis,
        comorbidities:   _dp.comorbidities,
        reviewOfSystems: _remapRos(_dp.reviewOfSystems),
        functionalEcog:  _ecogObj(_dp.functionalEcog),
        goalOfCare:      _dp.goalOfCare,
        elosDays:        _dp.elosDays,
        codeStatus: typeof _dp.codeStatus === "string" ? { value: _dp.codeStatus } : _dp.codeStatus,
        prognosis:  typeof _dp.prognosis === "string" ? { summary: _dp.prognosis } : _dp.prognosis,
        clinicalExamination: _dp.systemicExamination ? { systemicExamination: _dp.systemicExamination } : undefined,
      };
      const nabh = { ..._flatNabh, ...(_dp.nabh || nd.nabh || {}) };
      const nursing = nd.nursing || {};
      const nNabh   = nd.nursingNabh || {};
      // Map nurse home medications onto the doctor's medicationReconciliation
      // shape so the same table builder works for either source.
      const fallbackMedRec = (nNabh.homeMedications || []).map(m => ({
        drug: m.drug, dose: m.dose, frequency: m.frequency,
        lastTaken: m.lastTaken, continueOnAdmit: m.continueOnAdmit || "(from nurse intake)",
      }));

      // Cross-check alerts (R7ff) — banner at top so doctor sees nurse↔doctor
      // mismatches before reading the rest.
      const alerts = Array.isArray(nd.crossCheckAlerts) ? nd.crossCheckAlerts : [];
      const alertBanner = alerts.length
        ? `<div class="dfx-banner" style="background:#fef2f2;color:#991b1b;border:2px solid #dc2626">
  <strong>⚠ Cross-Check Alerts (${alerts.length})</strong>
  <ul style="margin:6px 0 0;padding-left:18px;font-weight:400;font-size:11px">
    ${alerts.map(a => `<li><strong>${escapeHtml(a.severity || "")}</strong> · ${escapeHtml(a.category || "")} — ${escapeHtml(a.message || "")}</li>`).join("")}
  </ul>
</div>` : "";

      // Chief Complaint & HPI (P0)
      const cc = _section("Chief Complaint & HPI", "#0d9488", _grid([
        _kv("Chief Complaint", nabh.chiefComplaint || docPayload.chiefComplaint || nursing.chiefComplaint, true),
        _kv("Duration", nabh.ccDuration || docPayload.duration),
        _kv("HoPI", docPayload.hopi || docPayload.hpi || note.historyOfPresentIllness, true),
      ]));

      // History (PMH/PSH/Family/Social/Allergy) — fall back to
      // nursingNabh when the doctor side wasn't filled. Allergy list
      // prefers doctor's own list; otherwise pulls the nurse's IPSG.3
      // table (clinical allergens are shared, no need to retype).
      const allergyList = (nabh.allergies?.list && nabh.allergies.list.length)
        ? nabh.allergies.list
        : (nNabh.allergies?.list || []);
      const allergyText = allergyList.length
        ? allergyList.map(a => `${a.agent || "—"} (${a.severity || "?"}${a.reaction ? " — " + a.reaction : ""})`).join("; ")
        : ((nabh.allergies?.noKnown || nNabh.allergies?.noKnown) ? "No known allergies" : "");
      const history = _section("History", "#4f46e5", _grid([
        _kv("PMH", docPayload.pmh || nNabh.briefPmh, true),
        _kv("PSH", docPayload.psh, true),
        _kv("Family Hx", docPayload.famHx, true),
        _kv("Social Hx", docPayload.socHx, true),
        _kv("Allergies", allergyText || docPayload.docAllergy, true),
      ]));

      // Vitals + Anthropometry — anthropometry falls back to nurse side
      // (same numbers; nurse measured at intake).
      const v = nursing.vitals || {};
      const anthro = nabh.anthropometry || nNabh.anthropometry || {};
      const vitalCells = [
        ["BP",   v.bpSys && v.bpDia ? `${v.bpSys}/${v.bpDia} mmHg` : ""],
        ["Pulse", v.pulse ? `${v.pulse} /min` : ""],
        ["Temp",  v.temp ? `${v.temp} °C` : ""],
        ["SpO₂", v.spo2 ? `${v.spo2}%` : ""],
        ["RR",   v.rr ? `${v.rr} /min` : ""],
        ["Wt",   v.weight || anthro.weightKg ? `${v.weight || anthro.weightKg} kg` : ""],
        ["Ht",   v.height || anthro.heightCm ? `${v.height || anthro.heightCm} cm` : ""],
        ["BMI",  anthro.bmi || ""],
        ["IBW",  anthro.idealBodyWeightKg ? `${anthro.idealBodyWeightKg} kg` : ""],
      ].filter(c => c[1]);
      const vitalsHtml = vitalCells.length
        ? _section("Vitals on Admission", "#dc2626",
            `<table class="dfx-tbl"><tr>${vitalCells.map(c => `<th>${escapeHtml(c[0])}</th>`).join("")}</tr><tr>${vitalCells.map(c => `<td>${escapeHtml(c[1])}</td>`).join("")}</tr></table>`)
        : "";

      // Examination findings
      // R7hr-106 — Surface the structured Clinical Examination (R7hr-58)
      // alongside the legacy free-text fields. Pre-R7hr-58 the form had
      // 5 free-text textareas (genExam / cvs / rs / abdomen / cns) and the
      // builder read those directly. R7hr-58 replaced them with a
      // structured form that writes to `nabh.clinicalExamination.genExam`
      // (built / nourishment / consciousness / orientation / pallor /
      // pedalEdema / hydration / jvp / icterus / cyanosis / clubbing /
      // lymphadenopathy / febrile) plus `sysExam.{cvs,rs,cns,pa}` each
      // with rich sub-fields, but the card kept reading the now-empty
      // legacy keys so post-R7hr-58 IAs rendered empty Exam sections even
      // when the doctor filled everything (Ramesh's IA: all 4 sysExam
      // blocks fully populated, but card showed only Local Exam).
      // We now render BOTH: legacy free-text first (if filled) for
      // back-compat with older records, then the structured General
      // Examination as a chip grid, then per-system CVS/RS/CNS/P-A blocks
      // with their structured findings. Empty blocks stay hidden.
      const clinExam = nabh.clinicalExamination || {};
      const ge = clinExam.genExam || {};
      const sx = clinExam.sysExam || {};
      const genHasContent = Object.values(ge).some(v => v !== "" && v !== false && v != null);
      const sysHasContent = ["cvs","rs","cns","pa"].some(k => {
        const blk = sx[k] || {};
        return Object.values(blk).some(v => v !== "" && v !== false && v != null);
      });
      const legacyExam = (docPayload.genExam || docPayload.cvs || docPayload.rs || docPayload.abdomen || docPayload.cns);
      const renderGenExamChips = () => {
        const labelMap = {
          built: "Built", nourishment: "Nourishment", consciousness: "Consciousness",
          orientation: "Orientation", pallor: "Pallor", pedalEdema: "Pedal Edema",
          hydration: "Hydration", jvp: "JVP", icterus: "Icterus", cyanosis: "Cyanosis",
          clubbing: "Clubbing", lymphadenopathy: "Lymphadenopathy", febrile: "Febrile",
          lymphLocation: "Lymph Location",
        };
        const cells = Object.entries(ge)
          .filter(([k, v]) => v !== "" && v != null && v !== false)
          .map(([k, v]) => {
            const lbl = labelMap[k] || k;
            const val = typeof v === "boolean" ? (v ? "✓ Yes" : "No") : v;
            return _kv(lbl, val);
          });
        // R7hr-108 — 3-col grid (short chip values).
        return cells.length ? _grid3(cells) : "";
      };
      const renderSysBlock = (key, label) => {
        const b = sx[key] || {};
        const cells = Object.entries(b)
          .filter(([k, v]) => v !== "" && v != null && v !== false && k !== "other" && !k.endsWith("Details") && !k.endsWith("Location"))
          .map(([k, v]) => {
            const niceK = k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, " $1");
            const val = typeof v === "boolean" ? "✓ Yes" : v;
            return _kv(niceK, val);
          });
        // tail: structured "details" / "location" / "other" fields
        // (kept as `full` rows so they wrap the entire row regardless
        //  of column count; they hold longer free-text answers).
        const extras = [];
        if (b.tenderLocation) extras.push(_kv("Tender Location", b.tenderLocation));
        if (b.murmurDetails) extras.push(_kv("Murmur Details", b.murmurDetails, true));
        if (b.organomegalyDetails) extras.push(_kv("Organomegaly Details", b.organomegalyDetails, true));
        if (b.other) extras.push(_kv("Other", b.other, true));
        const all = cells.concat(extras);
        if (!all.length) return "";
        // R7hr-108 — 3-col grid for CVS / RS / CNS / P-A.
        return `<div style="margin-top:8px"><div style="font-size:11.5px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${label}</div>${_grid3(all)}</div>`;
      };
      const examInner = [
        legacyExam ? _grid([
          _kv("General", docPayload.genExam, true),
          _kv("CVS", docPayload.cvs),
          _kv("RS", docPayload.rs),
          _kv("Abdomen", docPayload.abdomen),
          _kv("CNS", docPayload.cns),
        ]) : "",
        genHasContent ? `<div style="margin-top:${legacyExam ? "10px" : "0"}"><div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">General Examination</div>${renderGenExamChips()}</div>` : "",
        sysHasContent ? renderSysBlock("cvs", "CVS — Cardiovascular") : "",
        sysHasContent ? renderSysBlock("rs", "RS — Respiratory") : "",
        sysHasContent ? renderSysBlock("cns", "CNS — Central Nervous System") : "",
        sysHasContent ? renderSysBlock("pa", "P/A — Per Abdomen") : "",
        clinExam.generalExamination ? _grid([_kv("General Notes", clinExam.generalExamination, true)]) : "",
        clinExam.systemicExamination ? _grid([_kv("Systemic Notes", clinExam.systemicExamination, true)]) : "",
        nabh.localExamination ? _grid([_kv("Local Exam", nabh.localExamination, true)]) : "",
      ].filter(Boolean).join("");
      const exam = examInner
        ? _section("Examination Findings", "#475569", examInner)
        : "";

      // Medication Reconciliation (NABH MOM.5 / COP.2) — falls back to
      // nurse-side homeMedications list mapped onto the same shape.
      const medRecSource = Array.isArray(nabh.medicationReconciliation) && nabh.medicationReconciliation.length
        ? nabh.medicationReconciliation
        : fallbackMedRec;
      const medRecHtml = medRecSource.length
        ? _section("Medication Reconciliation", "#7c3aed",
            `<table class="dfx-tbl"><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Last Taken</th><th>On Admit</th></tr>${medRecSource.map(m =>
              `<tr><td>${escapeHtml(m.drug || "—")}</td><td>${escapeHtml(m.dose || "—")}</td><td>${escapeHtml(m.frequency || "—")}</td><td>${escapeHtml(m.lastTaken || "—")}</td><td>${escapeHtml(m.continueOnAdmit || "—")}</td></tr>`
            ).join("")}</table>`)
        : "";

      // R7gx — Doctor NABH extras (Comorbidities + ROS + ECOG +
      // Immunisation + Spiritual + Obstetric/Gynae) emitted through
      // the shared renderer module. Each renderer returns "" when its
      // bucket is empty so populated ones surface in form-order and
      // empty ones stay hidden. Pre-R7gx the card only emitted a
      // capitalize-keys chip strip for comorbidities and silently
      // dropped the other 5 sub-blocks even when fully populated.
      const H = { _section, _grid, _kv, _narr, cssPrefix: "dfx" };
      const nabhExtras = renderDoctorNabhExtras(nabh, H);

      // Code Status + Goals of Care + Prognosis
      const cs = nabh.codeStatus || {};
      const prog = nabh.prognosis || {};
      const codeSection = (cs.value || prog.discussedWith || nabh.goalOfCare)
        ? _section("Code Status & Goals of Care", "#0891b2", _grid([
            _kv("Code Status", cs.value && cs.value.replace(/_/g, " ")),
            _kv("Discussed With (code)", cs.discussedWith),
            _kv("Limitations", cs.limitations, true),
            _kv("Goal of Care", nabh.goalOfCare, true),
            _kv("ELOS (days)", nabh.elosDays),
            _kv("Prognosis Discussed With", prog.discussedWith),
            _kv("Language Used", prog.languageUsed),
            _kv("Prognosis Summary", prog.summary, true),
          ]))
        : "";

      // Risk Acknowledgement (P0) — only show acknowledged
      const ra = nabh.riskAcknowledgement || {};
      const ackedRisks = Object.entries(ra).filter(([_, v]) => v?.acknowledged);
      const riskHtml = ackedRisks.length
        ? _section("Risk Acknowledgement (NABH IPSG)", "#dc2626",
            `<table class="dfx-tbl"><tr><th>Risk</th><th>Score</th><th>Plan</th></tr>${ackedRisks.map(([k, v]) =>
              `<tr><td style="text-transform:uppercase;font-weight:600">${escapeHtml(k)}</td><td>${escapeHtml(v.score || "—")}</td><td>${escapeHtml(v.plan || "—")}</td></tr>`
            ).join("")}</table>`)
        : "";

      // Consent Required — only TRUE ones
      const consent = nabh.consentRequired || {};
      const consentList = Object.entries(consent).filter(([_, v]) => v === true).map(([k]) => k);
      const consentHtml = consentList.length
        ? _section("Consent Required", "#7c3aed",
            `<div style="display:flex;flex-wrap:wrap;gap:5px">${consentList.map(c => `<span style="padding:3px 10px;border-radius:999px;background:#ede9fe;color:#5b21b6;font-size:11px;font-weight:600;text-transform:uppercase">${escapeHtml(c)}</span>`).join("")}</div>`)
        : "";

      // Diagnosis & Plan
      const dx = _section("Diagnosis", "#d97706", _grid([
        _kv("Provisional", docPayload.provDx || note.provisionalDiagnosis),
        _kv("Working", nabh.workingDx || docPayload.workingDx || note.workingDiagnosis),
        _kv("Differential", nabh.differentialDx, true),
        _kv("Final", docPayload.finalDx || note.finalDiagnosis),
        _kv("ICD-10", docPayload.icd10 || note.icd10Code),
      ]));

      // R7hr-123 — Structured Lab orders / Prescription / Infusion lists.
      // Pre-fix the IA card silently dropped these even when the doctor
      // had ordered CBC, Amoxiclav, IV NS etc. — the payload lives at
      // noteDetails.doctor.{invests, meds, infusions} as arrays of typed
      // rows that the IPD IA form (R7hr-67/68/69) writes. Render each as
      // its own colored table block so the consultant on rounds, the
      // pharmacist, and the nurse at MAR all see what was actually
      // ordered without opening the print. Empty arrays → block hidden.
      const invList = Array.isArray(docPayload.invests) ? docPayload.invests
                    : Array.isArray(docPayload.investigations) && typeof docPayload.investigations !== "string" ? docPayload.investigations
                    : [];
      const labOrdersHtml = invList.length
        ? _section("Laboratory & Investigation Orders", "#0ea5e9",
            `<table class="ndx-tbl"><tr><th>Test</th><th>Urgency</th><th>Instructions</th></tr>${invList.map(i => `<tr><td><strong>${escapeHtml(i.name || i.test || i.investigation || "—")}</strong></td><td>${i.urgency ? `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;background:${/urgent|stat/i.test(i.urgency)?"#fee2e2":"#e0e7ff"};color:${/urgent|stat/i.test(i.urgency)?"#dc2626":"#4f46e5"}">${escapeHtml(i.urgency)}</span>` : "—"}</td><td>${escapeHtml(i.instructions || i.notes || "—")}</td></tr>`).join("")}</table>`)
        : "";

      const medsList = Array.isArray(docPayload.meds) ? docPayload.meds
                     : Array.isArray(docPayload.rxRows) ? docPayload.rxRows
                     : Array.isArray(docPayload.prescription) ? docPayload.prescription
                     : [];
      // R7hr-128-FIX — Render dilution sub-label (Vol mL / fluid / over min)
      // under the drug name when the doctor filled it on the parenteral
      // strip in PrescriptionPanel. Without this the meds card on patient
      // panel / Doctor Notes timeline / Complete File print silently drops
      // the dilution metadata even though the fan-out + DoctorOrder
      // already carry it. Smallest-diff: same 6 columns, only the Drug
      // cell grows by one sub-line when present.
      const _medDilution = (m) => {
        const vol = Number(m.dilutionVolume);
        if (!Number.isFinite(vol) || vol <= 0) return "";
        const fluid = (m.dilutionFluid || "NS 0.9%").toString();
        const over = Number(m.infuseOverMinutes);
        const overTxt = (Number.isFinite(over) && over > 0) ? ` over ${over} min` : "";
        return `<div style="font-size:10px;color:#0369a1;font-weight:600;margin-top:2px">💧 in ${vol} mL ${escapeHtml(fluid)}${escapeHtml(overTxt)}</div>`;
      };
      const rxHtml = medsList.length
        ? _section("Prescription / Medications", "#7c3aed",
            `<table class="ndx-tbl"><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Notes</th></tr>${medsList.map(m => `<tr><td><strong>${escapeHtml(m.name || m.drug || "—")}</strong>${m.genericName ? `<div style="font-size:10px;color:#64748b">${escapeHtml(m.genericName)}</div>` : ""}${_medDilution(m)}</td><td>${escapeHtml(m.dose || "—")}</td><td>${escapeHtml(m.route || "—")}</td><td>${escapeHtml(m.frequency || "—")}</td><td>${escapeHtml(m.duration || "—")}</td><td>${escapeHtml([m.mealStatus, m.instructions, m.notes].filter(Boolean).join(" · ") || "—")}</td></tr>`).join("")}</table>`)
        : "";

      const infList = Array.isArray(docPayload.infusions) ? docPayload.infusions
                    : Array.isArray(docPayload.infusion) ? docPayload.infusion
                    : Array.isArray(docPayload.ivFluids) ? docPayload.ivFluids
                    : [];
      const infusionHtml = infList.length
        ? _section("IV Fluids / Infusions", "#0d9488",
            `<table class="ndx-tbl"><tr><th>Fluid</th><th>Volume</th><th>Rate</th><th>Duration</th><th>Route</th><th>Additives / Notes</th></tr>${infList.map(f => `<tr><td><strong>${escapeHtml(f.name || f.fluid || f.drug || "—")}</strong>${f.strength ? `<div style="font-size:10px;color:#64748b">${escapeHtml(f.strength)}</div>` : ""}</td><td>${escapeHtml(f.totalVolume ? `${f.totalVolume} ml` : f.volume || "—")}</td><td>${escapeHtml(f.rate ? `${f.rate} ml/hr` : "—")}</td><td>${escapeHtml(f.duration || "—")}</td><td>${escapeHtml(f.route || "—")}</td><td>${escapeHtml([f.additives, f.instructions, f.notes].filter(Boolean).join(" · ") || "—")}</td></tr>`).join("")}</table>`)
        : "";

      // Investigations + Plan + Advice (text fields — kept separate from
      // the structured lab table above so a free-text Investigations note
      // can co-exist with structured rows).
      // R7hr-130 — User asked to rename this section header to just
      // "Plan" because Investigations already has its own dedicated
      // Lab Orders table above. The free-text Investigations sub-row
      // stays inside this block so any narrative investigation note
      // the doctor types in the IA form still surfaces, but the section
      // title no longer double-counts it. R25-safe: copy change only.
      const planSection = (docPayload.investigations && typeof docPayload.investigations === "string" || docPayload.treatmentPlan || docPayload.followupNotes || docPayload.dietAdvice || docPayload.activityAdvice)
        ? _section("Plan", "#16a34a", _grid([
            _kv("Investigations", typeof docPayload.investigations === "string" ? docPayload.investigations : null, true),
            _kv("Treatment Plan", docPayload.treatmentPlan, true),
            _kv("Follow-up Notes", docPayload.followupNotes, true),
            _kv("Diet Advice", docPayload.dietAdvice, true),
            _kv("Activity Advice", docPayload.activityAdvice, true),
          ]))
        : "";

      // R7gx — Cross-disciplinary nursing intake. Even on the doctor
      // card, surface the populated nursingNabh.* sub-blocks so a
      // doctor reviewing IA on rounds sees Barthel / Special
      // Precautions / Cultural-Spiritual / Caregiver / etc. inline
      // without having to scroll down to the nurse card. Empty
      // buckets stay hidden; if no nursing sub-blocks are populated
      // the divider+block is suppressed entirely.
      // R7hr-100 — When caller (IA tab) explicitly requested hiding the
      // nursing intake extras (because no separate Nurse Initial
      // Assessment exists yet), skip rendering the cross-disciplinary
      // block entirely. Default behaviour unchanged for prints +
      // timelines (opts.hideNursingExtras is undefined / falsy there).
      const nursingExtras = opts.hideNursingExtras ? "" : renderNursingNabhExtras(nNabh, H);
      const nursingBlock = nursingExtras
        ? `<div style="margin:18px 0 6px;padding:6px 12px;border-radius:6px;background:linear-gradient(90deg,#eef2ff,#fdf2f8);font-size:11px;font-weight:700;color:#312e81;letter-spacing:.5px;text-align:center">━━━ NURSING INTAKE — CROSS-DISCIPLINARY (NABH IPSG.6) ━━━</div>${nursingExtras}`
        : "";

      return alertBanner + cc + history + vitalsHtml + exam + medRecHtml + nabhExtras + codeSection + riskHtml + consentHtml + dx + labOrdersHtml + rxHtml + infusionHtml + planSection + nursingBlock;
    },
    // R7gp — initialAssessment is the alias the frontend sends from the
    // IPD Initial Assessment doctor form; route it to the same builder.
    initialAssessment: function() { return BUILDERS.initial(); },
  };

  return BUILDERS[note.noteType] || null;
};

/**
 * R7gd — returns inner HTML for a single doctor note's card body.
 * Used by Narrative.jsx day-wise journey to embed identical per-type
 * cards inline. Falls back to a SOAP narrative summary when no
 * dedicated builder exists for the noteType.
 */
export function buildDoctorNoteCardHtml(note, opts = {}) {
  // R7hr-100 — opts.hideNursingExtras (default false → preserves all
  // existing behaviour for prints + timelines). The Initial Assessment
  // tab in the patient panel sets it to TRUE when no separate Nurse
  // IA note exists, so doctors don't see the "NURSING INTAKE — CROSS-
  // DISCIPLINARY" block with default values (Barthel max scores,
  // dropdown defaults) before the nurse has actually filled anything.
  // The Complete File print (Narrative.jsx) and Doctor Notes timeline
  // never pass this option, so they continue to render the full card
  // exactly as before. R25-safe: additive, default-preserving.
  _prose = !!opts.prose;   // R7hu — prose variant for the Complete File print
  const fmtDate = (d) => d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) : "—";
  const noteDate = fmtDate(note.visitDate || note.createdAt);
  const shift = note.shift || "morning";

  const TYPE_LABELS = {
    general: "General Note", admission: "Admission Note",
    initial: "Initial Doctor Assessment", progress: "Progress Note",
    daily: "Daily Progress", icu: "ICU / Critical Care",
    procedure: "Procedure Note", consultation: "Consultation",
    assessment: "Reassessment", discharge: "Discharge Summary",
    death: "Death Note", amendment: "Amendment",
    operative: "Operative Note", preop: "Pre-operative", postop: "Post-operative",
  };
  const typeLabel = TYPE_LABELS[note.noteType] || "Doctor Note";

  const isSigned = (note.status === "signed");
  const statusBadge = isSigned
    ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;background:#dcfce7;color:#15803d;border:1px solid #bbf7d0">● Signed</span>'
    : '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;background:#fef3c7;color:#b45309;border:1px solid #fde68a">● Draft</span>';
  const critical = note.isCritical
    ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca">⚠ Critical</span>'
    : "";

  const lateBanner = note.lateEntry
    ? `<div style="margin:8px 0 14px;padding:8px 12px;border:1px solid #fcd34d;background:#fffbeb;border-radius:6px;font-size:11px;color:#92400e;display:flex;gap:8px;align-items:flex-start">
  <strong style="white-space:nowrap">⚠ LATE ENTRY</strong>
  <div style="flex:1">${escapeHtml(note.lateEntryReason || "Retrospective entry — NABH HIC.6")}${note.lateEntryAt ? ` · Recorded: ${fmtDate(note.lateEntryAt)}` : ""}</div>
</div>` : "";

  // Vitals strip
  const v = note.vitals;
  const vitalsHtml = v && (v.bp || v.pulse || v.temp || v.spo2 || v.rr) ? (() => {
    const cells = [
      ["BP", v.bp ? `${v.bp.systolic || "—"}/${v.bp.diastolic || "—"} mmHg` : ""],
      ["Pulse", v.pulse ? `${v.pulse} /min` : ""],
      ["Temp", v.temp ? `${v.temp}°C` : ""],
      ["SpO₂", v.spo2 ? `${v.spo2}%` : ""],
      ["RR", v.rr ? `${v.rr} /min` : ""],
    ].filter(c => c[1]);
    if (!cells.length) return "";
    return `<div class="dfx-h" style="background:#dc262620;color:#dc2626;border-left:3px solid #dc2626">Vital Signs</div>
<table class="dfx-tbl"><tr>${cells.map(c => `<th>${escapeHtml(c[0])}</th>`).join("")}</tr><tr>${cells.map(c => `<td>${escapeHtml(c[1])}</td>`).join("")}</tr></table>`;
  })() : "";

  // SOAP block (used by general/progress/daily/assessment)
  const soapHtml = note.soap && !["admission","icu","procedure","consultation","discharge","death","amendment","operative","preop","postop","initial"].includes(note.noteType)
    ? (() => {
        const parts = [
          ["S — Subjective", "#4f46e5", note.soap.subjective],
          ["O — Objective", "#0d9488", note.soap.objective],
          ["A — Assessment", "#d97706", note.soap.assessment],
          ["P — Plan", "#16a34a", note.soap.plan],
        ].filter(p => p[2]);
        if (!parts.length) return "";
        return `<div style="font-size:11px;font-weight:700;color:#4338ca;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px">SOAP Notes</div>
${parts.map(p => `<div style="margin-bottom:6px;border-left:3px solid ${p[1]};padding-left:10px"><strong style="font-size:10px;text-transform:uppercase;color:${p[1]}">${escapeHtml(p[0])}</strong><p style="margin:3px 0;font-size:12px;white-space:pre-wrap">${escapeHtml(p[2])}</p></div>`).join("")}`;
      })()
    : "";

  // Diagnosis line — skipped for note types whose per-type builder
  // already renders a Diagnosis section, else we'd get the same data
  // twice (R7gp-FIX: was showing on Initial Doctor Assessment).
  const builderRendersDiagnosis = new Set(["initial", "initialAssessment", "admission", "discharge", "consultation"]);
  const diagParts = [];
  if (!builderRendersDiagnosis.has(note.noteType)) {
    if (note.provisionalDiagnosis) diagParts.push(`<strong>Provisional:</strong> ${escapeHtml(note.provisionalDiagnosis)}`);
    if (note.workingDiagnosis)     diagParts.push(`<strong>Working:</strong> ${escapeHtml(note.workingDiagnosis)}`);
    if (note.finalDiagnosis)       diagParts.push(`<strong>Final:</strong> ${escapeHtml(note.finalDiagnosis)}`);
    if (note.icd10Code)            diagParts.push(`<strong>ICD-10:</strong> ${escapeHtml(note.icd10Code)}${note.icd10Description ? " — " + escapeHtml(note.icd10Description) : ""}`);
  }
  const diagHtml = diagParts.length
    ? `<div style="font-size:11px;font-weight:700;color:#4338ca;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px">Diagnosis</div><p style="font-size:12px;margin:0;line-height:1.6">${diagParts.join(" &nbsp;|&nbsp; ")}</p>`
    : "";

  // Per-type builder body
  // R7hr-100 — forward opts so the `initial` builder can honour
  // opts.hideNursingExtras. Default {} → all existing call sites
  // (prints, timelines) keep their unchanged behaviour.
  const builder = buildBuilder(note, opts);
  const typeBody = builder ? builder() : "";

  if (_prose) {
    // R7hu — Complete File print: render the note as flowing bold-label prose
    // (matching the Doctor Initial Assessment narrative), no card chrome — one
    // uppercase type title, the per-type body (helpers emit prose lines above),
    // and a single signed line. Reset the module flag before returning.
    const pv = (v && (v.bp || v.pulse || v.temp || v.spo2 || v.rr)) ? (() => {
      const cells = [
        v.bp ? `BP ${v.bp.systolic || "—"}/${v.bp.diastolic || "—"} mmHg` : "",
        v.pulse ? `Pulse ${v.pulse}/min` : "", v.temp ? `Temp ${v.temp}°C` : "",
        v.spo2 ? `SpO₂ ${v.spo2}%` : "", v.rr ? `RR ${v.rr}/min` : "",
      ].filter(Boolean);
      return cells.length ? `<div class="pfx-line"><strong>Vitals:</strong> ${escapeHtml(cells.join(", "))}</div>` : "";
    })() : "";
    const ps = (note.soap && !["admission","icu","procedure","consultation","discharge","death","amendment","operative","preop","postop","initial"].includes(note.noteType)) ? (() => {
      const parts = [["Subjective", note.soap.subjective], ["Objective", note.soap.objective], ["Assessment", note.soap.assessment], ["Plan", note.soap.plan]].filter((p) => p[1]);
      return parts.map((p) => `<div class="pfx-line"><strong>${p[0]}:</strong> ${escapeHtml(p[1])}</div>`).join("");
    })() : "";
    const pd = diagParts.length ? `<div class="pfx-line">${diagParts.join(" &nbsp;·&nbsp; ")}</div>` : "";
    const _empId = note.signedByEmpId || note.doctorEmpId || "";
    const _reg = note.doctorRegNo || note.signedByReg;
    const _when = note.signedAt ? fmtDate(note.signedAt) : noteDate;
    const psign = isSigned
      ? `<div class="pfx-sign">✓ <strong>${escapeHtml(typeLabel)} signed</strong> · By: <strong>${escapeHtml(note.doctorName || note.signedByName || "Doctor")}</strong>${_empId ? ` · Emp ${escapeHtml(_empId)}` : ""}${_reg ? ` · Reg ${escapeHtml(_reg)}` : ""} · ${escapeHtml(_when)}</div>`
      : `<div class="pfx-sign">✎ Draft — not yet signed</div>`;
    const out = COMPACT_GRID_CSS + `<div class="pfx-note"><div class="pfx-title">${escapeHtml(typeLabel)}</div>${lateBanner}${pv}${ps}${pd}${typeBody}${psign}</div>`;
    _prose = false;
    return out;
  }

  // Signature footer
  // R7go — Render the signer's hospital employee ID next to name + MCI reg
  // so every signed note is traceable to a specific staff record without
  // opening the User collection. signedByEmpId is preferred (captured at
  // sign time); doctorEmpId is the original author's ID and shown when no
  // explicit signer-emp-id was stored (older notes / handover scenarios).
  // R7gu — Embed the actual digital signature image (data: URL or
  // /uploads/ path) inside the footer when present, so the printed copy
  // looks like a real signed document, not just a text claim.
  const empIdShown = note.signedByEmpId || note.doctorEmpId || "";
  const sigSrc = note.signature || note.signatureImage || "";
  const sigImgHtml = (isSigned && sigSrc && typeof sigSrc === "string"
                     // R7hr-251 (audit: external img fetch) — only data:image/
                     // and local /uploads/ signatures; never an attacker-set
                     // http(s) URL (tracking pixel / SSRF-lite / referer leak).
                     && (sigSrc.startsWith("data:image/")
                         || sigSrc.startsWith("/uploads/")))
    ? `<div style="margin-left:auto;text-align:center;flex:none"><img src="${escapeHtml(sigSrc)}" alt="Signature" style="max-height:38px;max-width:170px;border:1px solid #e2e8f0;background:#fff;padding:2px 8px;border-radius:5px"/><div style="font-size:8px;color:#94a3b8;letter-spacing:.5px;text-transform:uppercase;margin-top:2px">e-signature</div></div>`
    : "";
  // R7hr-222 — formal "authenticated" panel (presentation only; same fields:
  // signer name, emp id, MCI reg, signed timestamp, signature image).
  const sigHtml = isSigned
    ? `<div style="margin-top:14px;display:flex;align-items:center;gap:12px;padding:10px 13px;border:1px solid #bbf7d0;border-radius:9px;background:#f3fcf6">
  <div style="width:30px;height:30px;border-radius:50%;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none">✓</div>
  <div style="min-width:0;line-height:1.45;flex:1">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#15803d">Digitally signed &amp; authenticated</div>
    <div style="font-size:12px;color:#0f172a"><strong>${escapeHtml(note.doctorName || note.signedByName || "Doctor")}</strong><span style="color:#64748b">${empIdShown ? ` · Emp ${escapeHtml(empIdShown)}` : ""}${note.doctorRegNo || note.signedByReg ? ` · Reg ${escapeHtml(note.doctorRegNo || note.signedByReg)}` : ""}${note.signedAt ? ` · ${fmtDate(note.signedAt)}` : ` · ${noteDate}`}</span></div>
  </div>
  ${sigImgHtml}
</div>`
    : `<div style="margin-top:14px;padding:8px 13px;border:1px dashed #fcd34d;border-radius:9px;background:#fffbeb;font-size:11px;color:#b45309;display:flex;align-items:center;gap:8px"><span style="font-size:14px">✎</span><strong>Draft — not yet signed</strong></div>`;

  // R7hr-222 — NABH note-card visual polish (presentation only; no data,
  // section, field, gate or page-break change). A per-type accent colour,
  // NABH sub-label and glyph drive a document-style letterhead band + a
  // left accent stripe. Critical events override the accent to red.
  const _accent = note.isCritical ? "#dc2626"
    : ({ death: "#475569", icu: "#dc2626", procedure: "#7c3aed", operative: "#7c3aed",
         preop: "#7c3aed", postop: "#7c3aed", discharge: "#0d9488", consultation: "#0891b2",
         amendment: "#b45309", initial: "#4f46e5" }[note.noteType] || "#4f46e5");
  // Sub-label is a record CLASSIFICATION line under the type title — it must
  // add information, not repeat the title. NABH chapter tags only where the
  // codebase already asserts them; everything else → the generic discipline tag.
  const _sub = ({ initial: "Initial Assessment · NABH COP.2",
    icu: "Critical Care · NABH COP.5", procedure: "Procedure Record · NABH COP.13",
    preop: "Pre-op Checklist · WHO / COP.13", death: "Death Summary · NABH COP.19",
    amendment: "Document Amendment · NABH IMS.2" }[note.noteType] || "Physician Record");
  const _icon = ({ initial: "🩺", admission: "🏥", progress: "📋", daily: "📋", general: "📝",
    assessment: "📋", icu: "🫀", procedure: "🔧", operative: "🔧", preop: "✅", postop: "🩹",
    consultation: "🤝", discharge: "📤", death: "🕊", amendment: "✍" }[note.noteType] || "🩺");

  return COMPACT_GRID_CSS + `
<div class="dfx-card" style="border:1px solid #e2e8f0;border-left:4px solid ${_accent};border-radius:10px;margin:10px 0;background:#fff;overflow:hidden">
  <div style="display:flex;align-items:center;gap:11px;padding:11px 16px;background:${_accent}0d;border-bottom:1px solid ${_accent}24">
    <div style="width:34px;height:34px;border-radius:8px;background:${_accent}1f;color:${_accent};display:flex;align-items:center;justify-content:center;font-size:17px;flex:none">${_icon}</div>
    <div style="min-width:0">
      <div style="font-size:14px;font-weight:800;color:#0f172a;line-height:1.15">${escapeHtml(typeLabel)}</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#64748b">${escapeHtml(_sub)}</div>
    </div>
    <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:5px">
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${statusBadge}${critical}</div>
      <div style="font-size:11px;color:#475569">Shift: <strong style="color:#1e293b;text-transform:capitalize">${escapeHtml(shift)}</strong> · ${noteDate}</div>
    </div>
  </div>
  <div style="padding:12px 16px 14px">
    ${lateBanner}
    ${vitalsHtml}
    ${typeBody}
    ${soapHtml}
    ${diagHtml}
    ${sigHtml}
  </div>
</div>`;
}
