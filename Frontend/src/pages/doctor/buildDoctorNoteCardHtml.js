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
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
const COMPACT_GRID_CSS = `<style>
  .dfx-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:11.5px;margin:6px 0 10px}
  .dfx-grid .lbl{font-weight:600;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:.3px;display:block;margin-bottom:1px}
  .dfx-grid .val{color:#0f172a;font-size:11.5px;white-space:pre-wrap}
  .dfx-grid .full{grid-column:1 / -1}
  .dfx-h{margin:10px 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:4px}
  .dfx-tbl{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 8px;page-break-inside:avoid;break-inside:avoid}
  .dfx-tbl th{padding:4px 6px;border:1px solid #cbd5e1;background:#f1f5f9;font-size:10px;text-align:left;color:#334155}
  .dfx-tbl td{padding:4px 6px;border:1px solid #e2e8f0;color:#0f172a}
  .dfx-narr{margin:6px 0 10px;padding:8px 12px;background:#f8fafc;border-left:3px solid #94a3b8;font-size:11.5px;white-space:pre-wrap;line-height:1.45}
  .dfx-banner{margin:6px 0 12px;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600}
</style>`;

const _kv = (label, value, isFull = false) => {
  const v = fmtVal(value);
  if (!v) return "";
  return `<div${isFull ? ' class="full"' : ""}><span class="lbl">${escapeHtml(label)}</span><span class="val">${escapeHtml(v)}</span></div>`;
};
const _section = (title, color, bodyHtml) =>
  bodyHtml ? `<div class="dfx-h" style="background:${color}20;color:${color};border-left:3px solid ${color}">${escapeHtml(title)}</div>${bodyHtml}` : "";
const _grid = (cells) => {
  const kept = cells.filter(Boolean);
  return kept.length ? `<div class="dfx-grid">${kept.join("")}</div>` : "";
};
const _narr = (text) => text ? `<div class="dfx-narr">${escapeHtml(String(text))}</div>` : "";

// Per-type builders — compact equivalents of DoctorNotesPage TYPE_BUILDERS.
// R7hr-100 — `opts` (default {}) is forwarded from the outer
// buildDoctorNoteCardHtml(note, opts) so the `initial` builder can
// honour opts.hideNursingExtras. All other builders ignore opts;
// signature stays back-compat — passing nothing preserves prior behaviour.
const buildBuilder = (note, opts = {}) => {
  const nd = note.noteDetails || {};

  const BUILDERS = {
    admission: () => {
      const identity = _section("Admission Identity", "#1d4ed8", _grid([
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
      const bc = nd.bundleCompliance || {};
      const bcRows = [
        ["VAP — HOB Elevated ≥30°", bc.vapHobElevated],
        ["VAP — Oral Care q4h", bc.vapOralCare],
        ["DVT Prophylaxis", bc.dvtProphylaxis],
        ["Stress-ulcer Prophylaxis", bc.stressUlcerProphylaxis],
        ["Glycaemic Control", bc.glucoseControl],
      ];
      const bcTable = `<table class="dfx-tbl"><tr><th>NABH COP.5 Bundle Element</th><th>Status</th></tr>${bcRows.map(r => {
        const raw = r[1];
        let cell;
        if (raw === undefined || raw === null || raw === "" || raw === false) {
          cell = `<strong style="color:#dc2626">✗ NOT DONE</strong>`;
        } else {
          cell = `<strong>${escapeHtml(String(raw))}</strong>`;
        }
        return `<tr><td>${escapeHtml(r[0])}</td><td>${cell}</td></tr>`;
      }).join("")}</table>`;
      const snap = _section("ICU Snapshot", "#dc2626", _grid([
        _kv("Ventilator Status", nd.ventilatorStatus),
        _kv("Vasopressors", nd.vasopressors),
        _kv("Sedation Status", nd.sedationStatus),
        _kv("Invasive Lines", nd.invasiveLines, true),
      ]));
      const goals = _section("Goals of Care & Family Meeting", "#475569", _grid([
        _kv("Goals of Care", nd.goalsOfCare, true),
        _kv("Family Meeting", nd.familyMeeting, true),
      ]));
      const narr = note.soap?.assessment ? _section("Clinical Progress", "#475569", _narr(note.soap.assessment)) : "";
      return snap + _section("Bundle Compliance (NABH COP.5)", "#dc2626", bcTable) + goals + narr;
    },

    procedure: () => {
      const proc = _section(`Procedure — ${nd.procedureName || "—"}`, "#ea580c", _grid([
        _kv("Indication", nd.indication, true),
        _kv("Anatomical Site", nd.anatomicalSite),
        _kv("Operator", nd.operator || nd.surgeon),
        _kv("Assistants", nd.assistants || nd.assistant),
        _kv("Consent", nd.consentType || nd.consentObtained),
        _kv("Asepsis", nd.asepsisMaintained),
        _kv("WHO Timeout", nd.timeoutPerformed),
      ]));
      const out = _section("Outcome", "#475569", _grid([
        _kv("Complications", nd.complications, true),
        _kv("Initial Drainage", nd.initialDrainage),
        _kv("Specimens", nd.specimens || nd.specimenSent),
        _kv("Post-procedure Vitals", nd.postProcedureVitals, true),
      ]));
      const tech = (note.soap?.objective || note.soap?.assessment)
        ? _section("Technique & Findings", "#475569", _narr([note.soap.objective, note.soap.assessment].filter(Boolean).join("\n\n")))
        : "";
      return proc + tech + out;
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
        ? _section("Discharge Medications", "#1d4ed8", _narr(nd.dischargeMedications))
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
      const family = _section("Family Informed", "#475569", _grid([
        _kv("Family Member", nd.familyInformed),
        _kv("Informed By", nd.familyInformedBy),
        _kv("Informed At", nd.familyInformedTime),
      ]));
      const admin = _section("Administrative", "#475569", _grid([
        _kv("MLC", nd.mlcRequired || nd.mlc),
        _kv("DNR", nd.dnrInPlace),
        _kv("PM Advised", nd.pmAdvised),
        _kv("PM Done", nd.postMortemDone),
        _kv("Certificate No", nd.deathCertificateNumber),
        _kv("Body Disposition", nd.bodyDisposition, true),
      ]));
      return banner + headline + mccd + family + admin;
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
      const proc = _section("Planned Procedure", "#0891b2", _grid([
        _kv("Planned Procedure", nd.plannedProcedure || nd.procedure, true),
        _kv("ASA Class", nd.asaClass || nd.asaGrade),
      ]));
      const nbm = nd.nbmStatus
        ? `<div style="margin:8px 0;padding:8px 14px;background:#fef9c3;border:2px solid #ca8a04;border-radius:6px;font-size:13px;text-align:center;font-weight:700;color:#854d0e">NBM STATUS: ${escapeHtml(nd.nbmStatus)}</div>`
        : "";
      const ck = nd.preopChecklist || {};
      const ckRows = [
        ["Patient identity confirmed", ck.identityConfirmed],
        ["Consent signed", ck.consentSigned],
        ["Surgical site marked", ck.siteMarked],
        ["Allergies reviewed", ck.allergiesReviewed],
        ["Blood available", ck.bloodAvailable],
        ["Imaging available", ck.imagingAvailable],
        ["Anaesthetist review", ck.anaesthetistReview],
      ];
      const ckTable = `<table class="dfx-tbl"><tr><th style="width:65%">WHO Safety Sign-In Item</th><th>Status</th></tr>${ckRows.map(r => {
        const raw = r[1];
        let cell;
        if (raw === undefined || raw === null || raw === "") cell = `<strong style="color:#dc2626">— NOT RECORDED —</strong>`;
        else if (raw === false) cell = `<strong style="color:#dc2626">✗ NOT CHECKED</strong>`;
        else cell = `<strong style="color:#16a34a">✓</strong> ${escapeHtml(String(raw))}`;
        return `<tr><td>${escapeHtml(r[0])}</td><td>${cell}</td></tr>`;
      }).join("")}</table>`;
      return banner + proc + nbm + _section("WHO Safety Checklist", "#0891b2", ckTable);
    },

    postop: () => {
      const proc = _section(`Post-op — ${nd.procedurePerformed || "—"}`, "#16a34a", _grid([
        _kv("Procedure Performed", nd.procedurePerformed, true),
      ]));
      const recovery = _section("Recovery", "#16a34a", _grid([
        _kv("Post-op Vitals", nd.postopVitals, true),
        _kv("Consciousness", nd.consciousness),
        _kv("Pain Score", nd.painScore),
        _kv("Complications", nd.complications, true),
        _kv("Ward Transfer Time", nd.wardTransferTime, true),
      ]));
      return proc + recovery;
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
      const docPayload = nd.doctor || nd;
      const nabh = docPayload.nabh || nd.nabh || {};
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
      const history = _section("History", "#1d4ed8", _grid([
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
      const exam = _section("Examination Findings", "#475569", _grid([
        _kv("General", docPayload.genExam, true),
        _kv("CVS", docPayload.cvs),
        _kv("RS", docPayload.rs),
        _kv("Abdomen", docPayload.abdomen),
        _kv("CNS", docPayload.cns),
        _kv("Local Exam", nabh.localExamination, true),
      ]));

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

      // Investigations + Plan + Advice
      const planSection = (docPayload.investigations || docPayload.treatmentPlan || docPayload.followupNotes || docPayload.dietAdvice || docPayload.activityAdvice)
        ? _section("Investigations & Plan", "#16a34a", _grid([
            _kv("Investigations", docPayload.investigations, true),
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

      return alertBanner + cc + history + vitalsHtml + exam + medRecHtml + nabhExtras + codeSection + riskHtml + consentHtml + dx + planSection + nursingBlock;
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
  const statusBadge = `<div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:${isSigned ? "#dcfce7" : "#fffbeb"};color:${isSigned ? "#16a34a" : "#d97706"}">${isSigned ? "✓ SIGNED" : "DRAFT"}</div>`;
  const critical = note.isCritical
    ? '<div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:#fef2f2;color:#dc2626">⚠ CRITICAL EVENT</div>'
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
          ["S — Subjective", "#1d4ed8", note.soap.subjective],
          ["O — Objective", "#0d9488", note.soap.objective],
          ["A — Assessment", "#d97706", note.soap.assessment],
          ["P — Plan", "#16a34a", note.soap.plan],
        ].filter(p => p[2]);
        if (!parts.length) return "";
        return `<div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px">SOAP Notes</div>
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
    ? `<div style="font-size:11px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.5px;margin:8px 0 4px">Diagnosis</div><p style="font-size:12px;margin:0;line-height:1.6">${diagParts.join(" &nbsp;|&nbsp; ")}</p>`
    : "";

  // Per-type builder body
  // R7hr-100 — forward opts so the `initial` builder can honour
  // opts.hideNursingExtras. Default {} → all existing call sites
  // (prints, timelines) keep their unchanged behaviour.
  const builder = buildBuilder(note, opts);
  const typeBody = builder ? builder() : "";

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
                     && (sigSrc.startsWith("data:image/")
                         || sigSrc.startsWith("/uploads/")
                         || /^https?:\/\//.test(sigSrc)))
    ? `<div style="margin-top:6px"><img src="${escapeHtml(sigSrc)}" alt="Signature" style="max-height:40px;max-width:200px;border:1px solid #e2e8f0;background:#fff;padding:2px;border-radius:3px"/></div>`
    : "";
  const sigHtml = isSigned
    ? `<div style="margin-top:14px;padding:8px 12px;border:1px solid #bbf7d0;border-radius:6px;background:#f0fdf4;font-size:11px;color:#166534">
  <strong style="color:#15803d">✓ SIGNED & SUBMITTED</strong> · By: ${escapeHtml(note.doctorName || note.signedByName || "Doctor")}${empIdShown ? ` · Emp ID: ${escapeHtml(empIdShown)}` : ""}${note.doctorRegNo || note.signedByReg ? ` · Reg: ${escapeHtml(note.doctorRegNo || note.signedByReg)}` : ""}${note.signedAt ? ` · ${fmtDate(note.signedAt)}` : ` · ${noteDate}`}
  ${sigImgHtml}
</div>`
    : `<div style="margin-top:14px;padding:6px 12px;border:1px solid #fde68a;border-radius:6px;background:#fffbeb;font-size:11px"><strong style="color:#d97706">DRAFT — Not yet signed</strong></div>`;

  return COMPACT_GRID_CSS + `
<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin:8px 0;background:#fff">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">
    <div style="padding:5px 14px;border-radius:6px;font-size:13px;font-weight:800;background:#eff6ff;color:#1e40af">${escapeHtml(typeLabel)}</div>
    ${statusBadge}
    ${critical}
    <div style="margin-left:auto;font-size:12px;color:#64748b">Shift: <strong style="text-transform:capitalize">${escapeHtml(shift)}</strong> · ${noteDate}</div>
  </div>
  ${lateBanner}
  ${vitalsHtml}
  ${typeBody}
  ${soapHtml}
  ${diagHtml}
  ${sigHtml}
</div>`;
}
