// R7gc — Per-type compact nursing-note print (mirrors DoctorNotesPage.jsx
// R7fx pattern). Each of the 17+ nurse note types gets a structured
// card with header bar, status pill, late-entry banner, 2-col grid,
// signature footer — matching the doctor-note examples user shared.
//
// Usage: printNurseNote(note, hospitalSettings).
//
//   note            — NurseNote document (server shape)
//   hospitalSettings— from useHospitalSettings() — populates PrintShell

import { buildPrintShellHtml } from "../../templates/PrintShell";
// R7gx — Shared NABH sub-bucket renderers so the nurse Initial
// Assessment card mirrors every populated nursingNabh.* block, not
// just the seven the original builder hard-coded (Identification,
// Allergies, Vitals, PMH+HomeMeds, Psychosocial+Edu, ADL-total,
// FamilyCaregiver, DischargePlanning). Pre-R7gx the card silently
// dropped bodyChart, specialPrecautions, cognitiveCommunication,
// culturalSpiritual, bowelBladder, sleepPattern, valuablesBelongings,
// highRiskFlags, mobilityGait, preAnaesthesia, NRS-2002, promPrem,
// and the per-item Barthel breakdown.
import {
  renderNursingNabhExtras,
} from "../../Components/clinical/iaNabhRenderers";

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// Robust scalar / object renderer — never emits [object Object]
const fmtVal = (v) => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") {
    if (ISO_RX.test(v)) {
      try {
        return new Date(v).toLocaleString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
      } catch { /* fall through */ }
    }
    return v;
  }
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "object" && x !== null
      ? (x.value || x.text || x.name || JSON.stringify(x))
      : String(x))).filter(Boolean).join(", ");
  }
  if (typeof v === "object") {
    if ("systolic" in v || "diastolic" in v) {
      return `${v.systolic ?? "—"}/${v.diastolic ?? "—"} mmHg`;
    }
    const scalar = v.value ?? v.text ?? v.name ?? v.label;
    if (scalar !== undefined && scalar !== null && scalar !== "") return String(scalar);
    const entries = Object.entries(v)
      .filter(([, val]) => val !== undefined && val !== null && val !== "" && val !== false)
      .map(([k, val]) => {
        if (val === true) return k;
        return `${k}: ${fmtVal(val)}`;
      });
    return entries.length ? entries.join("; ") : "";
  }
  return String(v);
};

// 2-col grid CSS used by every builder. R7gf — tables keep
// page-break-inside:avoid so Braden / MEWS / Morse stay intact;
// card-level avoid is dropped (see wrapper below) so a tiny Vital
// Signs card can pack onto the previous page instead of getting
// pushed to a near-empty new page.
const COMPACT_GRID_CSS = `<style>
  .nfx-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:11.5px;margin:6px 0 10px}
  .nfx-grid .lbl{font-weight:600;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:.3px;display:block;margin-bottom:1px}
  .nfx-grid .val{color:#0f172a;font-size:11.5px;white-space:pre-wrap}
  .nfx-grid .full{grid-column:1 / -1}
  .nfx-h{margin:10px 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:4px}
  .nfx-tbl{width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 8px;page-break-inside:avoid;break-inside:avoid}
  .nfx-tbl th{padding:4px 6px;border:1px solid #cbd5e1;background:#f1f5f9;font-size:10px;text-align:left;color:#334155}
  .nfx-tbl td{padding:4px 6px;border:1px solid #e2e8f0;color:#0f172a}
  .nfx-narr{margin:6px 0 10px;padding:8px 12px;background:#f8fafc;border-left:3px solid #94a3b8;font-size:11.5px;white-space:pre-wrap;line-height:1.45}
</style>`;

const _kv = (label, value, isFull = false) => {
  const v = fmtVal(value);
  if (!v) return "";
  return `<div${isFull ? ' class="full"' : ""}><span class="lbl">${escapeHtml(label)}</span><span class="val">${escapeHtml(v)}</span></div>`;
};
const _section = (title, color, bodyHtml) =>
  bodyHtml
    ? `<div class="nfx-h" style="background:${color}20;color:${color};border-left:3px solid ${color}">${escapeHtml(title)}</div>${bodyHtml}`
    : "";
const _grid = (cells) => {
  const kept = cells.filter(Boolean);
  return kept.length ? `<div class="nfx-grid">${kept.join("")}</div>` : "";
};
const _narr = (text) => (text ? `<div class="nfx-narr">${escapeHtml(String(text))}</div>` : "");

// ── Per-type builders ──────────────────────────────────────────────
// Each builder reads from `nd` (note.noteData first, then note top-level
// so seeded shapes and live form shapes both work). Returns HTML body.

const buildBuilder = (note) => {
  const nd = note.noteData || {};
  // Many seeded notes carry their structured payload at the TOP level
  // (e.g. seed-badal-nn.js) — merge as fallback.
  const topLvl = {
    vitals: note.vitals, ivInfusion: note.ivInfusion,
    intakeOutput: note.intakeOutput, painAssessment: note.painAssessment,
    woundCare: note.woundCare, skinAssessment: note.skinAssessment,
    fallRisk: note.fallRisk, neuroAssessment: note.neuroAssessment,
    mewsScore: note.mewsScore, bloodTransfusion: note.bloodTransfusion,
    procedure: note.procedure, dailyAssessment: note.dailyAssessment,
    carePlan: note.carePlan, nutritionalAssessment: note.nutritionalAssessment,
    patientEducation: note.patientEducation, discharge: note.discharge,
  };
  const get = (key) => nd[key] || topLvl[key] || {};

  const BUILDERS = {
    // ─── VITAL SIGNS ─────────────────────────────────────────────────
    vitals: () => {
      const v = get("vitals");
      const bp = v.bp || (v.bp_sys ? { systolic: v.bp_sys, diastolic: v.bp_dia } : null);
      return _section("Vital Signs", "#dc2626", _grid([
        _kv("BP", bp || v.bpStr),
        _kv("Pulse", v.pulse ? `${v.pulse} /min` : null),
        _kv("Temp", v.temp ? `${v.temp}°C` : null),
        _kv("SpO₂", v.spo2 ? `${v.spo2}%` : null),
        _kv("RR", v.rr ? `${v.rr} /min` : null),
        _kv("GCS", v.gcs),
        _kv("BSL", v.bsl ? `${v.bsl} mg/dL` : null),
      ]));
    },

    // ─── INTAKE / OUTPUT ─────────────────────────────────────────────
    // R7ge — Field names corrected to match the live nursing schema
    // (oral/ivFluids/ivMedFluids/urineOutput/...) and totals/netBalance
    // are computed on the fly so the card never shows phantom labels.
    intake: () => {
      const io = get("intakeOutput");
      const oral = Number(io.oral) || 0;
      const ivFluids = Number(io.ivFluids) || 0;
      const ivMedFluids = Number(io.ivMedFluids) || 0;
      const bloodProducts = Number(io.bloodProducts) || 0;
      const totalIntake = oral + ivFluids + ivMedFluids + bloodProducts;
      const urine = Number(io.urineOutput) || 0;
      const ng = Number(io.nasogastricOutput) || 0;
      const drain = Number(io.drainOutput) || 0;
      const bloodLoss = Number(io.bloodLoss) || 0;
      const emesis = Number(io.emesis) || 0;
      const otherOut = Number(io.otherOutput) || 0;
      const totalOutput = urine + ng + drain + bloodLoss + emesis + otherOut;
      const net = totalIntake - totalOutput;
      const has = io && Object.keys(io).length > 0;
      if (!has) return "";
      return _section("Intake / Output", "#0ea5e9", _grid([
        _kv("Oral", oral ? `${oral} ml` : null),
        _kv("IV Fluids", ivFluids ? `${ivFluids} ml` : null),
        _kv("IV Med Fluids", ivMedFluids ? `${ivMedFluids} ml` : null),
        _kv("Blood Products", bloodProducts ? `${bloodProducts} ml` : null),
        _kv("Total Intake", `${totalIntake} ml`),
        _kv("Urine Output", urine ? `${urine} ml` : null),
        _kv("NG Output", ng ? `${ng} ml` : null),
        _kv("Drain Output", drain ? `${drain} ml` : null),
        _kv("Blood Loss", bloodLoss ? `${bloodLoss} ml` : null),
        _kv("Emesis", emesis ? `${emesis} ml` : null),
        _kv("Other Output", otherOut ? `${otherOut} ml` : null),
        _kv("Total Output", `${totalOutput} ml`),
        _kv("Net Balance", `${net > 0 ? "+" : ""}${net} ml`, true),
      ]));
    },

    // ─── IV INFUSION ─────────────────────────────────────────────────
    iv: () => {
      const iv = get("ivInfusion");
      return _section("IV Infusion", "#0d9488", _grid([
        _kv("Drug", iv.drug, true),
        _kv("Dose", iv.dose),
        _kv("Route", iv.route),
        _kv("Rate", iv.rate),
        _kv("Site", iv.site),
        _kv("Site Condition", iv.siteCondition),
        _kv("Start Time", iv.startTime),
        _kv("End Time", iv.endTime),
        _kv("Nurse", iv.nurseName),
      ]));
    },

    // ─── PAIN ASSESSMENT ─────────────────────────────────────────────
    pain: () => {
      const p = get("painAssessment");
      return _section("Pain Assessment", "#f59e0b", _grid([
        _kv("Pain Score", p.painScore != null ? `${p.painScore}/10` : null),
        _kv("Location", p.painLocation),
        _kv("Character", p.painCharacter),
        _kv("Aggravating", p.aggravating),
        _kv("Relieving", p.relieving),
        _kv("Intervention", p.intervention, true),
      ]));
    },

    // ─── WOUND CARE ──────────────────────────────────────────────────
    wound: () => {
      const w = get("woundCare");
      return _section("Wound / Dressing", "#dc2626", _grid([
        _kv("Site Location", w.siteLocation, true),
        _kv("Wound Type", w.woundType),
        _kv("Wound Stage", w.woundStage),
        _kv("Dressing", w.dressing, true),
        _kv("Drainage", w.drainage),
        _kv("Odour", w.odour),
        _kv("Surrounding Skin", w.surroundingSkin, true),
        _kv("Next Dressing", w.nextDressing),
      ]));
    },

    // ─── SKIN / BRADEN ───────────────────────────────────────────────
    skin: () => {
      const s = get("skinAssessment");
      const rows = [
        ["Sensory Perception", s.bradenSensoryPerception],
        ["Moisture", s.bradenMoisture],
        ["Activity", s.bradenActivity],
        ["Mobility", s.bradenMobility],
        ["Nutrition", s.bradenNutrition],
        ["Friction & Shear", s.bradenFrictionShear],
      ];
      const bradenTbl = `<table class="nfx-tbl"><tr><th>Braden Sub-scale</th><th style="width:30%">Score</th></tr>${rows.map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${fmtVal(r[1]) || "—"}</td></tr>`).join("")}<tr style="background:#f0fdf4"><td><strong>Total</strong></td><td><strong>${s.bradenTotal ?? "—"}</strong></td></tr></table>`;
      return _section("Skin Assessment (Braden)", "#475569", bradenTbl + _grid([
        _kv("Risk Band", s.riskBand, true),
        _kv("Actions", s.actions, true),
      ]));
    },

    // ─── FALL RISK / MORSE ───────────────────────────────────────────
    fall: () => {
      const f = get("fallRisk");
      const rows = [
        ["History of Fall", f.historyOfFall],
        ["Secondary Diagnosis", f.secondaryDiagnosis],
        ["Ambulatory Aid", f.ambulatoryAid],
        ["IV Therapy", f.ivTherapy],
        ["Gait", f.gait],
        ["Mental Status", f.mentalStatus],
      ];
      const tbl = `<table class="nfx-tbl"><tr><th>Morse Fall Scale Item</th><th style="width:30%">Score</th></tr>${rows.map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${fmtVal(r[1]) || "—"}</td></tr>`).join("")}<tr style="background:#fef2f2"><td><strong>Total</strong></td><td><strong>${f.total ?? "—"}</strong></td></tr></table>`;
      return _section("Fall Risk (Morse)", "#b45309", tbl + _grid([
        _kv("Risk Band", f.riskBand, true),
        _kv("Precautions", f.precautions, true),
      ]));
    },

    // ─── NEURO ASSESSMENT ────────────────────────────────────────────
    neuro: () => {
      const n = get("neuroAssessment");
      const gcs = [["Eye", n.gcsEye], ["Verbal", n.gcsVerbal], ["Motor", n.gcsMotor]];
      const gcsTbl = `<table class="nfx-tbl"><tr><th>GCS</th>${gcs.map(g => `<th>${g[0]}</th>`).join("")}<th>Total</th></tr><tr><td>Score</td>${gcs.map(g => `<td>${fmtVal(g[1]) || "—"}</td>`).join("")}<td><strong>${n.gcsTotal ?? "—"}</strong></td></tr></table>`;
      return _section("Neurological Assessment", "#7c3aed", gcsTbl + _grid([
        _kv("Pupils Left", n.pupilsLeft),
        _kv("Pupils Right", n.pupilsRight),
        _kv("Motor Left", n.motorLeft),
        _kv("Motor Right", n.motorRight),
        _kv("Sensory", n.sensory, true),
        _kv("Orientation", n.orientation, true),
      ]));
    },

    // ─── MEWS SCORE ──────────────────────────────────────────────────
    mews: () => {
      const m = get("mewsScore");
      const rows = [
        ["Respiratory Rate", m.respRate],
        ["Heart Rate", m.heartRate],
        ["Systolic BP", m.systolicBP],
        ["Temperature", m.temperature],
        ["Consciousness", m.consciousness],
        ["Urine Output", m.urineOutput],
      ];
      const tbl = `<table class="nfx-tbl"><tr><th>MEWS Parameter</th><th style="width:30%">Score</th></tr>${rows.map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${fmtVal(r[1]) || "—"}</td></tr>`).join("")}<tr style="background:#fffbeb"><td><strong>Total</strong></td><td><strong>${m.total ?? "—"}</strong></td></tr></table>`;
      return _section("MEWS Score (Modified Early Warning)", "#d97706", tbl + _grid([
        _kv("Band / Interpretation", m.band, true),
      ]));
    },

    // ─── BLOOD TRANSFUSION ───────────────────────────────────────────
    blood: () => {
      const b = get("bloodTransfusion");
      return _section("Blood Transfusion", "#b91c1c", _grid([
        _kv("Component", b.component),
        _kv("Blood Group", b.bloodGroup),
        _kv("Bag Number", b.bagNumber),
        _kv("Volume", b.volumeMl != null ? `${b.volumeMl} ml` : null),
        _kv("Start Time", b.startTime),
        _kv("End Time", b.endTime),
        _kv("Pre-vitals", b.preVitalsBP ? `BP ${b.preVitalsBP}, Pulse ${b.preVitalsPulse}, Temp ${b.preVitalsTemp}` : null, true),
        _kv("Post-vitals", b.postVitalsBP ? `BP ${b.postVitalsBP}, Pulse ${b.postVitalsPulse}, Temp ${b.postVitalsTemp}` : null, true),
        _kv("Reaction", b.reaction),
        _kv("Given By", b.givenBy),
        _kv("Witness", b.witnessedBy),
      ]));
    },

    // ─── PROCEDURE (nurse-side) ──────────────────────────────────────
    procedure: () => {
      const p = get("procedure");
      return _section(`Procedure — ${p.procedureName || "—"}`, "#ea580c", _grid([
        _kv("Indication", p.indication, true),
        _kv("Consent", p.consentObtained),
        _kv("Asepsis", p.asepsisMaintained),
        _kv("Complications", p.complications, true),
        _kv("Urine Colour", p.urineColour),
        _kv("Initial Drainage", p.initialDrainage),
        _kv("Post-procedure Vitals", p.postProcVitals, true),
      ]));
    },

    // ─── DAILY ASSESSMENT ────────────────────────────────────────────
    daily: () => {
      const d = get("dailyAssessment");
      return _section("Daily Assessment", "#1d4ed8", _grid([
        _kv("General Condition", d.generalCondition, true),
        _kv("Appetite / Hydration", d.appetiteHydration, true),
        _kv("Mobility", d.mobility),
        _kv("Elimination", d.elimination),
        _kv("Sleep", d.sleep),
        _kv("Psychosocial", d.psychosocial),
        _kv("Shift Summary", d.shiftSummary, true),
      ]));
    },

    // ─── CARE PLAN ───────────────────────────────────────────────────
    careplan: () => {
      const c = get("carePlan");
      return _section("Nursing Care Plan", "#16a34a", _grid([
        _kv("Problem", c.problem, true),
        _kv("Goal", c.goal, true),
        _kv("Interventions", c.interventions, true),
        _kv("Expected Outcome", c.expectedOutcome, true),
        _kv("Evaluation Date", c.evaluationDate),
      ]));
    },

    // ─── NUTRITIONAL (NRS-2002) ──────────────────────────────────────
    nutrition: () => {
      const n = get("nutritionalAssessment");
      return _section("Nutritional Assessment (NRS-2002)", "#65a30d", _grid([
        _kv("Nutrition Score", n.nutritionScore),
        _kv("Disease Score", n.diseaseScore),
        _kv("Age Score", n.ageScore),
        _kv("NRS Total", n.nrsTotal),
        _kv("Risk Band", n.riskBand, true),
        _kv("Appetite", n.appetite),
        _kv("Weight Change", n.weightChange),
        _kv("Recommendations", n.recommendations, true),
      ]));
    },

    // ─── PATIENT EDUCATION ───────────────────────────────────────────
    education: () => {
      const e = get("patientEducation");
      return _section("Patient Education", "#7c3aed", _grid([
        _kv("Topic", e.topic, true),
        _kv("Method", e.method),
        _kv("Learner", e.learner),
        _kv("Comprehension Level", e.comprehensionLevel, true),
        _kv("Barriers", e.barriers, true),
        _kv("Follow-up Education", e.followUpEducation, true),
        _kv("Educator", e.educator),
      ]));
    },

    // ─── DISCHARGE PLANNING ──────────────────────────────────────────
    discharge: () => {
      const d = get("discharge");
      return _section("Discharge Planning", "#16a34a", _grid([
        _kv("Home Support", d.homeSupport),
        _kv("Primary Caregiver", d.primaryCaregiver),
        _kv("Transport Need", d.transportNeed),
        _kv("Anticipated Barriers", d.anticipatedBarriers, true),
        _kv("Follow-up Plan", d.followUpPlan, true),
        _kv("Medications to Continue", d.medicationsToContinue, true),
        _kv("Education Started", d.educationStarted, true),
      ]));
    },

    // R7gp — INITIAL ASSESSMENT (NABH IPSG.6) — full per-type card so the
    // nurse Initial Assessment card mirrors the printed Complete File
    // instead of dumping noteData.nursingNabh as raw JSON.
    initial: () => {
      const nrs = nd.nursing || {};
      const nNabh = nd.nursingNabh || {};
      const v = nrs.vitals || {};
      const anthro = nNabh.anthropometry || {};

      // Admission identity strip
      const admit = _section("Admission Identity", "#1d4ed8", _grid([
        _kv("Admit Date", nrs.admitDate),
        _kv("Admit Time", nrs.admitTime),
        _kv("IPD No.", nrs.ipdNo),
        _kv("Ward", nrs.ward),
        _kv("Bed No.", nrs.bedNo),
        _kv("Mode of Admit", nrs.modeOfAdmit),
        _kv("Consciousness", nrs.consciousnessLevel),
        _kv("Mobility", nrs.mobility),
      ]));

      // Allergies (NABH IPSG.3)
      const allergies = nNabh.allergies?.list || [];
      const allergyHtml = allergies.length
        ? _section("Allergies (NABH IPSG.3)", "#dc2626",
            `<table class="nfx-tbl"><tr><th>Type</th><th>Agent</th><th>Severity</th><th>Reaction</th></tr>${allergies.map(a => `<tr><td>${escapeHtml(a.type || "—")}</td><td><strong>${escapeHtml(a.agent || "—")}</strong></td><td style="color:#dc2626;font-weight:600">${escapeHtml(a.severity || "—")}</td><td>${escapeHtml(a.reaction || "—")}</td></tr>`).join("")}</table>`)
        : (nNabh.allergies?.noKnown ? _section("Allergies (NABH IPSG.3)", "#16a34a",
            `<div style="padding:6px 10px;background:#dcfce7;color:#15803d;border-radius:4px;font-size:11px;font-weight:600">No known allergies</div>`) : "");

      // Vitals on admission
      const vitalCells = [
        ["BP",   v.bpSys && v.bpDia ? `${v.bpSys}/${v.bpDia} mmHg` : ""],
        ["Pulse", v.pulse ? `${v.pulse} /min` : ""],
        ["Temp",  v.temp ? `${v.temp} °C` : ""],
        ["SpO₂", v.spo2 ? `${v.spo2}%` : ""],
        ["RR",   v.rr ? `${v.rr} /min` : ""],
        ["Wt",   v.weight ? `${v.weight} kg` : (anthro.weightKg ? `${anthro.weightKg} kg` : "")],
        ["Ht",   v.height ? `${v.height} cm` : (anthro.heightCm ? `${anthro.heightCm} cm` : "")],
        ["BMI",  anthro.bmi || ""],
      ].filter(c => c[1]);
      const vitalsHtml = vitalCells.length
        ? _section("Vitals on Admission", "#dc2626",
            `<table class="nfx-tbl"><tr>${vitalCells.map(c => `<th>${escapeHtml(c[0])}</th>`).join("")}</tr><tr>${vitalCells.map(c => `<td>${escapeHtml(c[1])}</td>`).join("")}</tr></table>`)
        : "";

      // Brief PMH + Home Medications (Medication reconciliation IPSG.6)
      const meds = nNabh.homeMedications || [];
      const pmhMedsHtml = (nNabh.briefPmh || meds.length)
        ? _section("History & Home Medications", "#7c3aed",
            (nNabh.briefPmh ? `<div style="font-size:11.5px;margin:0 0 8px"><strong>Brief PMH:</strong> ${escapeHtml(nNabh.briefPmh)}</div>` : "") +
            (meds.length ? `<table class="nfx-tbl"><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Last Taken</th></tr>${meds.map(m => `<tr><td>${escapeHtml(m.drug || "—")}</td><td>${escapeHtml(m.dose || "—")}</td><td>${escapeHtml(m.frequency || "—")}</td><td>${escapeHtml(m.lastTaken || "—")}</td></tr>`).join("")}</table>` : ""))
        : "";

      // Chief Complaint + Pain
      const ccPain = _section("Chief Complaint & Pain", "#0d9488", _grid([
        _kv("Chief Complaint", nrs.chiefComplaint, true),
        _kv("Pain Present", nrs.painPresent ? "Yes" : (nrs.painPresent === false ? "No" : null)),
        _kv("Pain Score", nrs.painScore),
        _kv("Pain Location", nrs.painLocation),
        _kv("Pain Character", nrs.painCharacter, true),
      ]));

      // R7gx — Every populated nursingNabh.* sub-block emitted through
      // the shared renderer module: Identification, Psychosocial,
      // ADL-Barthel (per-item table + total band), BodyChart,
      // SpecialPrecautions, Cognitive/Communication, Cultural-Spiritual,
      // Bowel/Bladder, SleepPattern, Valuables, FamilyCaregiver,
      // HighRiskFlags, MobilityGait, PreAnaesthesia, NRS-2002 quick,
      // DischargePlanning, EducationNeeds, PROM/PREM triggers.
      // Pre-R7gx the card silently dropped 12+ of these sub-blocks
      // even when fully populated — the patient panel only showed
      // ID-band + allergy + vitals + PMH + 3 compressed sections.
      const H = { _section, _grid, _kv, _narr, cssPrefix: "nfx" };
      const nursingExtras = renderNursingNabhExtras(nNabh, H);

      // Nursing diagnosis / problems / goals / notes (narrative)
      const narrHtml = (nrs.nursingProblems || nrs.nursingGoals || nrs.nursingNotes)
        ? _section("Nursing Diagnosis & Plan", "#475569", _grid([
            _kv("Problems Identified", nrs.nursingProblems, true),
            _kv("Goals", nrs.nursingGoals, true),
            _kv("Nursing Plan", nrs.nursingNotes, true),
          ]))
        : "";

      return admit + allergyHtml + vitalsHtml + pmhMedsHtml + ccPain + nursingExtras + narrHtml;
    },
    initialAssessment: function() { return BUILDERS.initial(); },

    // ─── GENERAL / FREE-FORM ─────────────────────────────────────────
    general: () => {
      // Bare narrative — read remarks / content / freeform
      const text = note.remarks || note.content || note.text || nd.content || nd.text || nd.note || "";
      const flags = [
        nd.doctorInformed && "Doctor Informed",
        nd.familyInformed && "Family Informed",
        nd.patientComfortable && "Patient Comfortable",
        nd.monitoringContinued && "Monitoring Continued",
      ].filter(Boolean);
      return _section("General Observation", "#475569",
        _narr(text) +
        (flags.length ? `<div style="margin:4px 0 8px;font-size:11px;color:#475569">${flags.map(f => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#eef2ff;border-radius:9999px">${escapeHtml(f)}</span>`).join("")}</div>` : "")
      );
    },
  };
  return BUILDERS[note.noteType] || BUILDERS.general;
};

/**
 * R7gd — exported helper: returns ONLY the body HTML (header + per-type
 * grid + late banner + signature) for a single nurse note. Used by the
 * Complete Patient File Narrative theme to embed identical per-type
 * cards inside the day-wise Clinical Journey.
 */
export function buildNurseNoteCardHtml(note) {
  const fmtDate = (d) => d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) : "—";
  const noteDate = fmtDate(note.noteDate || note.createdAt);
  const shift = note.shift || "general";

  const TYPE_LABELS = {
    vitals: "Vital Signs", intake: "Intake / Output", iv: "IV Infusion",
    pain: "Pain Assessment", wound: "Wound / Dressing", skin: "Skin Assessment",
    fall: "Fall Risk", neuro: "Neurological Assessment", mews: "MEWS Score",
    blood: "Blood Transfusion", procedure: "Procedure Note",
    daily: "Daily Assessment", careplan: "Care Plan",
    nutrition: "Nutritional Assessment", education: "Patient Education",
    discharge: "Discharge Planning", initial: "Initial Assessment",
    general: "General Observation",
  };
  const typeLabel = TYPE_LABELS[note.noteType] || (note.noteType || "Nursing Note").toUpperCase();

  const isSigned = (note.status === "submitted" || note.status === "signed");
  const statusBadge = `<div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:${isSigned ? "#dcfce7" : "#fffbeb"};color:${isSigned ? "#16a34a" : "#d97706"}">${isSigned ? "✓ SIGNED" : "DRAFT"}</div>`;
  const critical = (note.isCriticalEvent || note.isCritical)
    ? '<div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:#fef2f2;color:#dc2626">⚠ CRITICAL EVENT</div>'
    : "";

  const lateBanner = note.lateEntry
    ? `<div style="margin:8px 0 14px;padding:8px 12px;border:1px solid #fcd34d;background:#fffbeb;border-radius:6px;font-size:11px;color:#92400e;display:flex;gap:8px;align-items:flex-start">
  <strong style="white-space:nowrap">⚠ LATE ENTRY</strong>
  <div style="flex:1">${escapeHtml(note.lateEntryReason || "Retrospective entry — NABH HIC.6")}${note.lateEntryAt ? ` · Recorded: ${fmtDate(note.lateEntryAt)}` : ""}</div>
</div>` : "";

  const builder = buildBuilder(note);
  const typeBody = builder();
  const remarks = (note.remarks && note.noteType !== "general")
    ? `<div style="margin-top:8px;padding:6px 10px;background:#f8fafc;border-left:3px solid #94a3b8;font-size:11.5px;white-space:pre-wrap">${escapeHtml(note.remarks)}</div>` : "";
  // R7go — Surface hospital employee ID next to the signer's name so
  // every signed nursing note is traceable to a specific staff record.
  // Prefer signedByEmpId (captured at sign time, may be admin/charge-nurse
  // co-sign) then nurseEmployeeId (original author).
  // R7gu — Embed the digital signature image when present (data: URL,
  // /uploads/ path or http(s) image) so the printed Complete File looks
  // like a real signed document.
  const nurseEmpIdShown = note.signedByEmpId || note.nurseEmployeeId || "";
  const nSigSrc = note.signature || note.signatureImage || "";
  const nSigImgHtml = (isSigned && nSigSrc && typeof nSigSrc === "string"
                      && (nSigSrc.startsWith("data:image/")
                          || nSigSrc.startsWith("/uploads/")
                          || /^https?:\/\//.test(nSigSrc)))
    ? `<div style="margin-top:6px"><img src="${escapeHtml(nSigSrc)}" alt="Signature" style="max-height:40px;max-width:200px;border:1px solid #e2e8f0;background:#fff;padding:2px;border-radius:3px"/></div>`
    : "";
  const sigHtml = isSigned
    ? `<div style="margin-top:14px;padding:8px 12px;border:1px solid #bbf7d0;border-radius:6px;background:#f0fdf4;font-size:11px;color:#166534">
  <strong style="color:#15803d">✓ SIGNED & SUBMITTED</strong> · By: ${escapeHtml(note.nurseName || note.signedByName || "Nurse")}${nurseEmpIdShown ? ` · Emp ID: ${escapeHtml(nurseEmpIdShown)}` : ""}${note.signedAt ? ` · ${fmtDate(note.signedAt)}` : ` · ${noteDate}`}
  ${nSigImgHtml}
</div>`
    : `<div style="margin-top:14px;padding:6px 12px;border:1px solid #fde68a;border-radius:6px;background:#fffbeb;font-size:11px"><strong style="color:#d97706">DRAFT — Not yet signed</strong></div>`;

  return COMPACT_GRID_CSS + `
<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin:8px 0;background:#fff">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e2e8f0">
    <div style="padding:5px 14px;border-radius:6px;font-size:13px;font-weight:800;background:#fce7f3;color:#9d174d">${escapeHtml(typeLabel)}</div>
    ${statusBadge}
    ${critical}
    <div style="margin-left:auto;font-size:12px;color:#64748b">Shift: <strong style="text-transform:capitalize">${escapeHtml(shift)}</strong> · ${noteDate}</div>
  </div>
  ${lateBanner}
  ${typeBody}
  ${remarks}
  ${sigHtml}
</div>`;
}

/**
 * R7gc — render & open a single nursing note in a print-ready window.
 */
export function printNurseNote(note, hospitalSettings = {}) {
  const fmtDate = (d) => d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) : "—";
  const noteDate = fmtDate(note.noteDate || note.createdAt);
  const shift = note.shift || "general";

  // Type label
  const TYPE_LABELS = {
    vitals: "Vital Signs", intake: "Intake / Output", iv: "IV Infusion",
    pain: "Pain Assessment", wound: "Wound / Dressing", skin: "Skin Assessment",
    fall: "Fall Risk", neuro: "Neurological Assessment", mews: "MEWS Score",
    blood: "Blood Transfusion", procedure: "Procedure Note",
    daily: "Daily Assessment", careplan: "Care Plan",
    nutrition: "Nutritional Assessment", education: "Patient Education",
    discharge: "Discharge Planning", initial: "Initial Assessment",
    general: "General Observation",
  };
  const typeLabel = TYPE_LABELS[note.noteType] || (note.noteType || "Nursing Note").toUpperCase();

  // Status pill row
  const isSigned = (note.status === "submitted" || note.status === "signed");
  const statusBadge = `<div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:${isSigned ? "#dcfce7" : "#fffbeb"};color:${isSigned ? "#16a34a" : "#d97706"}">${isSigned ? "✓ SIGNED" : "DRAFT"}</div>`;
  const critical = (note.isCriticalEvent || note.isCritical)
    ? '<div style="padding:4px 10px;border-radius:5px;font-size:11px;font-weight:700;background:#fef2f2;color:#dc2626">⚠ CRITICAL EVENT</div>'
    : "";

  // Late-entry banner (NABH HIC.6)
  const lateBanner = note.lateEntry
    ? `<div style="margin:8px 0 14px;padding:8px 12px;border:1px solid #fcd34d;background:#fffbeb;border-radius:6px;font-size:11px;color:#92400e;display:flex;gap:8px;align-items:flex-start">
  <strong style="white-space:nowrap">⚠ LATE ENTRY</strong>
  <div style="flex:1">${escapeHtml(note.lateEntryReason || "Retrospective entry — NABH HIC.6 backdated-documentation justification on file")}${note.lateEntryAt ? ` · Recorded: ${fmtDate(note.lateEntryAt)}` : ""}</div>
</div>` : "";

  // Body via per-type builder
  const builder = buildBuilder(note);
  const typeBody = builder();

  // Free-form remarks footer (if any in addition to structured body)
  const remarks = (note.remarks && note.noteType !== "general")
    ? `<div style="margin-top:8px;padding:6px 10px;background:#f8fafc;border-left:3px solid #94a3b8;font-size:11.5px;white-space:pre-wrap">${escapeHtml(note.remarks)}</div>` : "";

  // Signature footer
  // R7go — Surface employee ID alongside name on the standalone nurse-note
  // print too (same field precedence as buildNurseNoteCardHtml).
  // R7gu — Embed signature image on the standalone print as well.
  const nurseEmpIdShownStandalone = note.signedByEmpId || note.nurseEmployeeId || "";
  const nSigSrcStandalone = note.signature || note.signatureImage || "";
  const nSigImgStandalone = (isSigned && nSigSrcStandalone && typeof nSigSrcStandalone === "string"
                             && (nSigSrcStandalone.startsWith("data:image/")
                                 || nSigSrcStandalone.startsWith("/uploads/")
                                 || /^https?:\/\//.test(nSigSrcStandalone)))
    ? `<br/><img src="${escapeHtml(nSigSrcStandalone)}" alt="Signature" style="max-height:42px;max-width:220px;margin-top:6px;border:1px solid #e2e8f0;background:#fff;padding:2px;border-radius:3px"/>`
    : "";
  const sigHtml = isSigned
    ? `<div style="margin-top:20px;padding:10px 14px;border:1px solid #bbf7d0;border-radius:8px;background:#f0fdf4">
  <strong style="color:#15803d;font-size:12px">✓ SIGNED & SUBMITTED</strong><br/>
  <span style="font-size:11px;color:#166534">By: ${escapeHtml(note.nurseName || note.signedByName || "Nurse")}${nurseEmpIdShownStandalone ? ` · Emp ID: ${escapeHtml(nurseEmpIdShownStandalone)}` : ""}${note.signedAt ? ` · ${fmtDate(note.signedAt)}` : ` · ${noteDate}`}${nSigImgStandalone}</span>
</div>`
    : `<div style="margin-top:20px;padding:8px 12px;border:1px solid #fde68a;border-radius:8px;background:#fffbeb">
  <strong style="color:#d97706;font-size:12px">DRAFT — Not yet signed</strong>
</div>`;

  // Assembly
  const bodyHtml = COMPACT_GRID_CSS + `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #e2e8f0">
    <div style="padding:5px 14px;border-radius:6px;font-size:13px;font-weight:800;background:#fce7f3;color:#9d174d">${escapeHtml(typeLabel)}</div>
    ${statusBadge}
    ${critical}
    <div style="margin-left:auto;font-size:12px;color:#64748b">Shift: <strong style="text-transform:capitalize">${escapeHtml(shift)}</strong> · Recorded: ${noteDate}</div>
  </div>
  ${lateBanner}
  ${typeBody}
  ${remarks}
  ${sigHtml}`;

  // PrintShell hospital metadata
  const hs = {
    name: hospitalSettings?.hospitalName || hospitalSettings?.name || "Hospital",
    ...hospitalSettings,
  };

  const html = buildPrintShellHtml({
    hospital: hs,
    docTitle: `Nursing Note — ${typeLabel}`,
    docSubtitle: "Clinical Documentation",
    patient: {
      left: [
        { label: "Reg. No",      value: note.patientUHID || "—" },
        { label: "Patient Name", value: note.patientName || "—" },
      ],
      right: [
        { label: "IPD No",     value: note.ipdNo || "—" },
        { label: "Note Date",  value: noteDate },
        { label: "Shift",      value: shift },
      ],
    },
    signatures: {
      type: "single",
      centre: {
        name: note.nurseName || note.signedByName || "—",
        role: "Registered Nurse",
        reg: note.signedByReg || "",
      },
    },
    banners: { emergency24x7: false, homeCare: false },
    meta: {
      docNumber: note._id || note.ipdNo || "—",
      pageOf: "Page 1 of 1",
    },
    bodyHtml,
  });

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
