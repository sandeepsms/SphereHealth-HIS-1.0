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
// /uploads signatures are JWT-gated — inlined to data: URLs before the
// print window's document is written (see printNurseNote below).
import { inlineUploadsInHtml } from "../../utils/secureUploads";
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
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;"); // R7hr-251 (audit) — single-quoted attribute contexts

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
  .nfx-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 18px;font-size:11.5px;margin:6px 0 11px}
  .nfx-grid .lbl{font-weight:800;color:#334155;font-size:10px;text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:2px}
  .nfx-grid .val{color:#0f172a;font-size:11.5px;white-space:pre-wrap}
  .nfx-grid .full{grid-column:1 / -1}
  .nfx-h{margin:13px 0 6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:5px 10px;border-radius:5px}
  .nfx-tbl{width:100%;border-collapse:collapse;font-size:11px;margin:5px 0 10px;page-break-inside:avoid;break-inside:avoid}
  .nfx-tbl th{padding:5px 8px;border:1px solid #e7edf3;background:#f6f8fb;font-size:10px;font-weight:800;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.3px}
  .nfx-tbl td{padding:5px 8px;border:1px solid #eef2f6;color:#0f172a}
  .nfx-narr{margin:6px 0 11px;padding:9px 13px;background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:0 6px 6px 0;font-size:11.5px;white-space:pre-wrap;line-height:1.45}
</style>`;

// R7hu — a value that is only a placeholder dash (— / – / - / -- ) or N/A /
// null / undefined must NOT print as a field: the standing rule is that "—"
// never appears where a value should. Live forms sometimes save "—" for an
// untouched field (e.g. a procedure note's Urine Colour / Initial Drainage),
// so the row rendered "Urine Colour: —". Treat those as empty and omit the
// row. Real clinical negatives ("None", "Nil") are kept — they're meaningful.
const _isPlaceholderDash = (s) =>
  /^[\s—–-]+$/.test(String(s)) || /^(n\/?a|null|undefined)$/i.test(String(s).trim());
const _kv = (label, value, isFull = false) => {
  const v = fmtVal(value);
  if (!v || _isPlaceholderDash(v)) return "";
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
  // R7hr-122 — DoctorNotes-shaped Nurse IA stores the structured payload
  // under `noteDetails` (not `noteData`, which is the NurseNotes-collection
  // shape). After R26 split, the Nurse Initial Assessment is a DoctorNotes
  // doc with section="nursing" + noteDetails.nursing + noteDetails.nursingNabh.
  // Pre-fix the BUILDERS.initial saw nd === {} so the card body rendered
  // only the signature footer — every NABH sub-block (vitals, allergies,
  // PMH, pain, ADL, Morse/Braden/MUST, contacts, PROM/PREM, nursing
  // problems/goals) silently disappeared from the patient panel. Falling
  // back to noteDetails preserves both shapes — legacy NurseNotes (noteData)
  // still wins when present.
  const nd = note.noteData || note.noteDetails || {};
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
      // R7hu — user requirement: nurses enter vitals in the HOURLY Vital Chart
      // (VitalSheet grid), so a "Vital Signs" note must show that whole day's
      // grid — one day's readings together — not a single snapshot. When the
      // day's sheet is attached as `note.vitalSheet = {activeVitals, tableData,
      // date}` (done by the Complete File print, the nurse timeline and the
      // patient panel), render the full hourly table; otherwise fall back to
      // the single reading (legacy single-snapshot note) so nothing regresses.
      const sheet = note.vitalSheet || nd.vitalSheet;
      const rows = Array.isArray(sheet?.tableData) ? sheet.tableData.filter((r) => r && r.time) : [];
      const cellOf = (r, c) => {
        const raw = r.values instanceof Map ? r.values.get(c) : r.values?.[c];
        const val = raw && typeof raw === "object" ? raw.value : raw;
        return val === 0 || val ? String(val) : "";
      };
      const cols = rows.length
        ? (Array.isArray(sheet.activeVitals) && sheet.activeVitals.length
            ? sheet.activeVitals.map((a) => a.name || a)
            : [...new Set(rows.flatMap((r) => (r.values instanceof Map ? [...r.values.keys()] : Object.keys(r.values || {}))))])
        : [];
      const filled = rows.filter((r) => cols.some((c) => cellOf(r, c) !== "") || (r.notes && String(r.notes).trim()));
      if (filled.length) {
        const showNurse = filled.some((r) => r.nurseName);
        const showNotes = filled.some((r) => r.notes && String(r.notes).trim());
        const head = `<tr><th>Time</th>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}${showNotes ? "<th>Remarks</th>" : ""}${showNurse ? "<th>By</th>" : ""}</tr>`;
        const body = filled.map((r) =>
          `<tr><td><strong>${escapeHtml(r.time)}</strong></td>${cols.map((c) => `<td>${escapeHtml(cellOf(r, c))}</td>`).join("")}${showNotes ? `<td>${escapeHtml(r.notes || "")}</td>` : ""}${showNurse ? `<td>${escapeHtml(r.nurseName || "")}</td>` : ""}</tr>`
        ).join("");
        // R7hu — a fully-configured VitalSheet can have 10+ columns; table-
        // layout:fixed + a compact font keeps the grid inside the A4 print
        // width, and the wrapper lets it scroll on screen.
        return _section(`Vital Signs — Hourly Chart${sheet.date ? ` · ${sheet.date}` : ""}`, "#dc2626",
          `<div style="overflow-x:auto"><table class="nfx-tbl" style="table-layout:fixed;font-size:${cols.length > 7 ? "9px" : "11px"}">${head}${body}</table></div>`);
      }
      // Fallback — single reading (legacy single-snapshot vitals note).
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
      // R7hr-161-FIX — the live NursingNotes Pain form (saveNote L1091,
      // state L572) saves `score / location / character / type / scale /
      // analgesicGiven / analgesic / nonPharm` etc. Renderer was reading
      // the legacy `painScore / painLocation / painCharacter / intervention`
      // shape only, so every freshly-submitted pain card showed "—".
      // Fallback chain reads BOTH shapes — legacy data stays correct,
      // new data finally surfaces.
      const score    = p.painScore ?? p.score;
      const location = p.painLocation ?? p.location;
      const character= p.painCharacter ?? p.character;
      const intervention = p.intervention
        ?? p.nonPharm
        ?? (p.analgesicGiven && p.analgesic
              ? `${p.analgesic}${p.analgesicRoute ? ` (${p.analgesicRoute})` : ""}${p.analgesicTime ? ` @ ${p.analgesicTime}` : ""}`
              : null);
      return _section("Pain Assessment", "#f59e0b", _grid([
        _kv("Pain Score", score != null && score !== "" ? `${score}/10` : null),
        _kv("Scale", p.scale),
        _kv("Type", p.type),
        _kv("Location", location),
        _kv("Character", character),
        _kv("Onset", p.onset),
        _kv("Duration", p.duration),
        _kv("Frequency", p.frequency),
        _kv("Aggravating", p.aggravating),
        _kv("Relieving", p.relieving),
        _kv("Intervention", intervention, true),
        _kv("Reassess Score", p.reassessScore != null && p.reassessScore !== "" ? `${p.reassessScore}/10` : null),
      ]));
    },

    // ─── WOUND CARE ──────────────────────────────────────────────────
    wound: () => {
      const w = get("woundCare");
      // R7hr-161-FIX — the live form (state L573) saves
      // `type / site / healingStage / exudateAmt / exudateType / odour(bool)
      //  / surroundingSkin / dressing / painDuring / nextDressingDate /
      //  length / width / depth / tunneling / undermining / swabSent`.
      // Renderer was reading legacy `woundType / siteLocation / woundStage
      // / drainage / nextDressing` only — every new wound card showed 5
      // blank fields. Fallback chain reads BOTH; odour boolean → "Present"/"None".
      const site    = w.siteLocation ?? w.site;
      const wType   = w.woundType ?? w.type;
      const stage   = w.woundStage ?? w.healingStage;
      const nextDx  = w.nextDressing ?? w.nextDressingDate;
      const odourTxt = typeof w.odour === "boolean"
        ? (w.odour ? "Present" : "None")
        : (w.odour || "");
      // Drainage: explicit field if set, else compose from exudateAmt+Type
      const drainage = w.drainage
        || (w.exudateAmt || w.exudateType
              ? [w.exudateAmt, w.exudateType].filter(Boolean).join(" · ")
              : null);
      const dimensions = (w.length || w.width || w.depth)
        ? `${w.length || "?"} × ${w.width || "?"} × ${w.depth || "?"} cm`
        : null;
      return _section("Wound / Dressing", "#dc2626", _grid([
        _kv("Site Location", site, true),
        _kv("Wound Type", wType),
        _kv("Wound Stage", stage),
        _kv("Dimensions", dimensions),
        _kv("Dressing", w.dressing, true),
        _kv("Drainage", drainage),
        _kv("Odour", odourTxt),
        _kv("Surrounding Skin", w.surroundingSkin, true),
        _kv("Tunneling", w.tunneling ? "Yes" : null),
        _kv("Undermining", w.undermining ? "Yes" : null),
        _kv("Pain During Dressing", w.painDuring),
        _kv("Swab Sent", w.swabSent ? "Yes" : null),
        _kv("Next Dressing", nextDx),
      ]));
    },

    // ─── SKIN / BRADEN ───────────────────────────────────────────────
    skin: () => {
      const s = get("skinAssessment");
      // R7hu — live form saves the six Braden sub-scores as b1..b6 (+ stage /
      // intervention / repositioned / repositionFreq / area), not the
      // bradenSensoryPerception…/bradenTotal/riskBand/actions the old builder
      // read — so every sub-scale + the total printed "—". Read both shapes,
      // auto-sum the total, and derive the risk band from it.
      const rows = [
        ["Sensory Perception", s.b1 ?? s.bradenSensoryPerception],
        ["Moisture",           s.b2 ?? s.bradenMoisture],
        ["Activity",           s.b3 ?? s.bradenActivity],
        ["Mobility",           s.b4 ?? s.bradenMobility],
        ["Nutrition",          s.b5 ?? s.bradenNutrition],
        ["Friction & Shear",   s.b6 ?? s.bradenFrictionShear],
      ].filter((r) => fmtVal(r[1]));
      const nums = rows.map((r) => Number(r[1])).filter((n) => Number.isFinite(n));
      const total = s.bradenTotal ?? (nums.length === 6 ? nums.reduce((a, b) => a + b, 0) : null);
      const band = s.riskBand || (total == null ? "" :
        total <= 9 ? "Very High Risk" : total <= 12 ? "High Risk" :
        total <= 14 ? "Moderate Risk" : total <= 18 ? "Mild Risk" : "No Risk");
      const bradenTbl = rows.length
        ? `<table class="nfx-tbl"><tr><th>Braden Sub-scale</th><th style="width:30%">Score</th></tr>${rows.map((r) => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(fmtVal(r[1]))}</td></tr>`).join("")}${total != null ? `<tr style="background:#f0fdf4"><td><strong>Total</strong></td><td><strong>${escapeHtml(String(total))} / 23</strong></td></tr>` : ""}</table>`
        : "";
      return _section("Skin Assessment (Braden)", "#475569", bradenTbl + _grid([
        _kv("Body Area", s.area),
        _kv("Risk Band", band, true),
        _kv("Pressure-ulcer Stage", s.stage),
        _kv("Repositioned", s.repositioned === true ? `Yes${s.repositionFreq ? ` · ${s.repositionFreq}` : ""}` : (s.repositioned === false ? "No" : null)),
        _kv("Intervention / Actions", s.intervention || s.actions, true),
      ]));
    },

    // ─── FALL RISK / MORSE ───────────────────────────────────────────
    // R7hr-148 — Live nurse Fall Risk form saves under m1..m6 keys
    // (with intBedRails/intCallBell/etc. for precautions). Pre-fix the
    // builder only knew the seeded shape (historyOfFall/...) so all
    // patient-panel Fall Risk cards rendered an empty Morse table.
    // Now: read both shapes, auto-sum the Morse total when m1..m6 are
    // present, derive risk band, and surface the intervention checklist.
    fall: () => {
      const f = get("fallRisk");
      // Live form rows take precedence; seeded labels remain fallback.
      const rows = [
        ["History of Fall (Yes 25 / No 0)",    f.m1 ?? f.historyOfFall],
        ["Secondary Diagnosis (Yes 15 / No 0)",f.m2 ?? f.secondaryDiagnosis],
        ["Ambulatory Aid (0 / 15 / 30)",       f.m3 ?? f.ambulatoryAid],
        ["IV Therapy / Saline Lock (0 / 20)",  f.m4 ?? f.ivTherapy],
        ["Gait (0 / 10 / 20)",                 f.m5 ?? f.gait],
        ["Mental Status (0 / 15)",             f.m6 ?? f.mentalStatus],
      ];
      // Auto-sum when numeric m1..m6 supplied (live form), otherwise
      // honour pre-computed `total` on seeded shapes.
      const liveTotal = ["m1","m2","m3","m4","m5","m6"]
        .map(k => Number(f[k]))
        .filter(n => Number.isFinite(n))
        .reduce((s, n) => s + n, 0);
      const totalDisplay = f.total ?? (liveTotal > 0 || ["m1","m2","m3","m4","m5","m6"].some(k => f[k] != null) ? liveTotal : null);
      const derivedBand = f.riskBand
        || (totalDisplay == null ? null
            : totalDisplay >= 45 ? "HIGH risk (≥45)"
            : totalDisplay >= 25 ? "MODERATE risk (25–44)"
            : "LOW risk (0–24)");
      const tbl = `<table class="nfx-tbl"><tr><th>Morse Fall Scale Item</th><th style="width:30%">Score</th></tr>${rows.map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${fmtVal(r[1]) || "—"}</td></tr>`).join("")}<tr style="background:#fef2f2"><td><strong>Total</strong></td><td><strong>${totalDisplay != null ? totalDisplay : "—"}</strong></td></tr></table>`;
      // Precaution chips from intervention booleans (live form).
      const precautionChips = [
        f.intBedLowest    && "Bed in lowest position",
        f.intBedRails     && "Bed rails up",
        f.intCallBell     && "Call bell within reach",
        f.intNonSlip      && "Non-slip footwear",
        f.intSupervision  && "Supervised ambulation",
        f.intPatientEd    && "Patient educated",
        f.intFamilyEd     && "Family educated",
      ].filter(Boolean);
      const precautionHtml = precautionChips.length
        ? `<div style="margin:6px 0 0;font-size:11px;color:#475569"><strong>Precautions in place:</strong> ${precautionChips.map(p => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#fef3c7;border-radius:9999px;color:#92400e">${escapeHtml(p)}</span>`).join("")}</div>`
        : "";
      return _section("Fall Risk (Morse)", "#b45309", tbl + _grid([
        _kv("Risk Band", derivedBand, true),
        _kv("Precautions (free text)", f.precautions, true),
      ]) + precautionHtml);
    },

    // ─── NEURO ASSESSMENT ────────────────────────────────────────────
    neuro: () => {
      const n = get("neuroAssessment");
      // R7hr-161-FIX — live form (state L571) saves `gcse / gcsv / gcsm /
      // pupils / pupilSizeL / pupilSizeR / lightReflex / seizure /
      // orientation / limbUL / limbUR / limbLL / limbLR`. Renderer was
      // reading `gcsEye / gcsVerbal / gcsMotor / pupilsLeft / pupilsRight
      // / motorLeft / motorRight / sensory` only — every new neuro card
      // showed "—" for all GCS components. Fallback chain reads both.
      const eye    = n.gcsEye    ?? n.gcse;
      const verbal = n.gcsVerbal ?? n.gcsv;
      const motor  = n.gcsMotor  ?? n.gcsm;
      const totalCalc = Number(eye || 0) + Number(verbal || 0) + Number(motor || 0);
      const gcsTotal = n.gcsTotal ?? (totalCalc > 0 ? totalCalc : null);
      const gcs = [["Eye", eye], ["Verbal", verbal], ["Motor", motor]];
      const gcsTbl = `<table class="nfx-tbl"><tr><th>GCS</th>${gcs.map(g => `<th>${g[0]}</th>`).join("")}<th>Total</th></tr><tr><td>Score</td>${gcs.map(g => `<td>${fmtVal(g[1]) || "—"}</td>`).join("")}<td><strong>${gcsTotal ?? "—"}</strong></td></tr></table>`;
      // Pupils: legacy n.pupilsLeft/Right OR live form's pupils + sizeL/sizeR
      const pupilsLeft  = n.pupilsLeft  || (n.pupils && n.pupilSizeL ? `${n.pupils} · ${n.pupilSizeL} mm` : n.pupils);
      const pupilsRight = n.pupilsRight || (n.pupils && n.pupilSizeR ? `${n.pupils} · ${n.pupilSizeR} mm` : n.pupils);
      // Motor: legacy n.motorLeft/Right OR live form's limbUL/UR/LL/LR
      const motorLeft  = n.motorLeft  || [n.limbUL, n.limbLL].filter(Boolean).join(" / ") || null;
      const motorRight = n.motorRight || [n.limbUR, n.limbLR].filter(Boolean).join(" / ") || null;
      return _section("Neurological Assessment", "#7c3aed", gcsTbl + _grid([
        _kv("Orientation", n.orientation, true),
        _kv("Pupils Left",  pupilsLeft),
        _kv("Pupils Right", pupilsRight),
        _kv("Light Reflex", n.lightReflex),
        _kv("Motor Left (UL/LL)",  motorLeft),
        _kv("Motor Right (UR/LR)", motorRight),
        _kv("Sensory", n.sensory, true),
        _kv("Seizure Activity", n.seizure ? "Yes" : null),
      ]));
    },

    // ─── MEWS SCORE ──────────────────────────────────────────────────
    mews: () => {
      const m = get("mewsScore");
      // R7hr-183: the live MEWS form saves SHORT keys (rr / spo2 / temp /
      // sbp / dbp / hr / avpu) while seeded notes carry the scored shape
      // (respRate / heartRate / systolicBP / …). Read both additively —
      // scored-shape notes have no short keys so their output is unchanged.
      // dbp is documented but NOT scored (MEWS scores systolic only).
      const _sys = m.systolicBP ?? m.sysBP ?? m.sbp;
      const _bp  = (_sys !== undefined && _sys !== null && _sys !== "")
        ? (m.dbp ? `${_sys}/${m.dbp}` : _sys)
        : undefined;
      const rows = [
        ["Respiratory Rate", m.respRate ?? m.rr],
        ["Heart Rate", m.heartRate ?? m.hr],
        ...(m.spo2 !== undefined && m.spo2 !== null && m.spo2 !== "" ? [["SpO₂", m.spo2]] : []),
        [m.dbp ? "Blood Pressure" : "Systolic BP", _bp],
        ["Temperature", m.temperature ?? m.temp],
        ["Consciousness", m.consciousness ?? m.avpu],
      ];
      const tbl = `<table class="nfx-tbl"><tr><th>MEWS Parameter</th><th style="width:30%">Score</th></tr>${rows.map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${fmtVal(r[1]) || "—"}</td></tr>`).join("")}<tr style="background:#fffbeb"><td><strong>Total</strong></td><td><strong>${m.total ?? "—"}</strong></td></tr></table>`;
      return _section("MEWS Score (Modified Early Warning)", "#d97706", tbl + _grid([
        _kv("Band / Interpretation", m.band, true),
      ]));
    },

    // ─── BLOOD TRANSFUSION ───────────────────────────────────────────
    // R7hr-148 — Live form saves under product / bagNo / crossMatchNo /
    // volume / preBP_sys / preBP_dia / prePulse / preTemp / postBP_sys /
    // postBP_dia / postPulse / reactionType / secondNurse / groupVerified
    // / status. Pre-fix the builder only knew the seeded shape (component
    // / bagNumber / preVitalsBP / ...) so every patient-panel blood card
    // showed an empty body. Now read both shapes additively.
    blood: () => {
      const b = get("bloodTransfusion");
      const preVitals  = b.preBP_sys || b.preBP_dia || b.prePulse || b.preTemp
        ? `BP ${b.preBP_sys || "—"}/${b.preBP_dia || "—"}, Pulse ${b.prePulse || "—"}, Temp ${b.preTemp || "—"}`
        : (b.preVitalsBP ? `BP ${b.preVitalsBP}, Pulse ${b.preVitalsPulse}, Temp ${b.preVitalsTemp}` : null);
      const postVitals = b.postBP_sys || b.postBP_dia || b.postPulse
        ? `BP ${b.postBP_sys || "—"}/${b.postBP_dia || "—"}, Pulse ${b.postPulse || "—"}`
        : (b.postVitalsBP ? `BP ${b.postVitalsBP}, Pulse ${b.postVitalsPulse}, Temp ${b.postVitalsTemp}` : null);
      const vol = b.volume || b.volumeMl;
      return _section("Blood Transfusion", "#b91c1c", _grid([
        _kv("Component / Product", b.product || b.component),
        _kv("Blood Group", b.bloodGroup),
        _kv("Bag Number", b.bagNo || b.bagNumber),
        _kv("Cross-match No.", b.crossMatchNo),
        _kv("Volume", vol != null && vol !== "" ? `${vol} ml` : null),
        _kv("Start Time", b.startTime),
        _kv("End Time", b.endTime),
        _kv("Status", b.status),
        _kv("Pre-vitals", preVitals, true),
        _kv("Post-vitals", postVitals, true),
        _kv("Group Verified (2-nurse)", b.groupVerified === true ? "Yes" : (b.groupVerified === false ? "No" : null)),
        _kv("Reaction", b.reactionType || b.reaction),
        _kv("Given By", b.givenBy),
        _kv("Witness / 2nd Nurse", b.secondNurse || b.witnessedBy),
      ]));
    },

    // ─── PROCEDURE (nurse-side) ──────────────────────────────────────
    procedure: () => {
      // R7hu — the nurse procedure form saves site/laterality/performedBy/
      // designation/assistant/sterile/position/outcome/specimen*/followUp; the
      // old builder read ghost fields (urineColour/initialDrainage the form
      // never saves) and dropped every real one. Read the actual keys.
      const p = get("procedure");
      return _section(`Procedure — ${p.procedureName || "—"}`, "#ea580c", _grid([
        _kv("Indication", p.indication, true),
        _kv("Site", p.laterality ? `${p.site || ""} (${p.laterality})`.trim() : p.site),
        _kv("Performed By", [p.performedBy, p.designation].filter(Boolean).join(" · ") || null),
        _kv("Assistant", p.assistant),
        _kv("Time", p.time),
        _kv("Consent", typeof p.consentObtained === "boolean" ? (p.consentObtained ? "Obtained" : "Not obtained") : p.consentObtained),
        _kv("Aseptic / Sterile", typeof p.sterile === "boolean" ? (p.sterile ? "Yes" : "No") : (p.sterile || p.asepsisMaintained)),
        _kv("Position", p.position),
        _kv("Outcome", p.outcome, true),
        _kv("Complications", p.complications, true),
        _kv("Specimen", typeof p.specimenSent === "boolean" ? (p.specimenSent ? (p.specimenType || "Sent") : "") : (p.specimenType || null)),
        _kv("Post-procedure Vitals", p.postProcVitals, true),
        _kv("Follow-up", p.followUp, true),
      ]));
    },

    // ─── DAILY ASSESSMENT ────────────────────────────────────────────
    // R7hr-148 — Live form saves a rich head-to-toe assessment under
    // bp_sys/bp_dia/pulse/rr/temp/spo2/gcs/bsl, system-status fields
    // (neuroStatus/respiratoryStatus/cardiovascularStatus/giStatus/
    // guStatus/musculoskeletalStatus/skinStatus) plus an intervention
    // checklist (intCallBell, intDoctorNotified, ...). Pre-fix the
    // builder only read generalCondition/appetiteHydration/mobility/...
    // so every patient-panel Daily Assessment card body was blank.
    // Keep the legacy keys as fallback.
    daily: () => {
      const d = get("dailyAssessment");
      const bp = (d.bp_sys || d.bp_dia) ? `${d.bp_sys || "—"}/${d.bp_dia || "—"} mmHg` : null;
      // Vitals strip — render only when at least one value is present.
      const vitals = [
        bp && _kv("BP", bp),
        d.pulse && _kv("Pulse", `${d.pulse} /min`),
        d.rr    && _kv("RR", `${d.rr} /min`),
        d.temp  && _kv("Temp", `${d.temp} °C`),
        d.spo2  && _kv("SpO₂", `${d.spo2}%`),
        d.gcs   && _kv("GCS", d.gcs),
        d.bsl   && _kv("BSL", `${d.bsl} mg/dL`),
      ].filter(Boolean);
      const vitalsHtml = vitals.length
        ? `<div style="margin:4px 0 6px"><div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Vitals</div><div class="nfx-grid">${vitals.join("")}</div></div>`
        : "";
      // Per-system status (head-to-toe) — only render when populated.
      const systems = _grid([
        _kv("Neuro", d.neuroStatus),
        _kv("Respiratory", d.respiratoryStatus),
        _kv("Cardiovascular", d.cardiovascularStatus),
        _kv("GI", d.giStatus),
        _kv("GU", d.guStatus),
        _kv("Musculoskeletal", d.musculoskeletalStatus),
        _kv("Skin", d.skinStatus),
      ]);
      // Intervention checklist (chips). Live form ships these as booleans.
      const intChips = [
        d.intCallBell          && "Call bell in reach",
        d.intDoctorNotified    && "Doctor notified",
        d.intDocumented        && "Documented",
        d.intFallPrecautions   && "Fall precautions",
        d.intFamilyUpdate      && "Family updated",
        d.intFoleyCheck        && "Foley checked",
        d.intIVCheck           && "IV checked",
        d.intMedAdministered   && "Meds administered",
        d.intNGTCheck          && "NGT checked",
        d.intOralCare          && "Oral care",
        d.intOxygenCheck       && "Oxygen checked",
        d.intPatientEducation  && "Patient educated",
        d.intPressureRelief    && "Pressure relief",
        d.intRangeOfMotion     && "Range of motion",
        d.intReposition        && "Repositioned",
        d.intWoundCare         && "Wound care",
      ].filter(Boolean);
      const intHtml = intChips.length
        ? `<div style="margin:6px 0 0;font-size:11px;color:#475569"><strong>Interventions completed:</strong> ${intChips.map(p => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#e0e7ff;border-radius:9999px;color:#4f46e5">${escapeHtml(p)}</span>`).join("")}</div>`
        : "";
      // Legacy narrative fields — surface only if present.
      const legacy = _grid([
        _kv("General Condition", d.generalCondition, true),
        _kv("Appetite / Hydration", d.appetiteHydration, true),
        _kv("Mobility", d.mobility),
        _kv("Elimination", d.elimination),
        _kv("Sleep", d.sleep),
        _kv("Psychosocial", d.psychosocial),
        _kv("Shift Summary", d.shiftSummary, true),
      ]);
      return _section("Daily Assessment", "#4f46e5", vitalsHtml + systems + legacy + intHtml);
    },

    // ─── CARE PLAN ───────────────────────────────────────────────────
    careplan: () => {
      const c = get("carePlan");
      // R7hu — live form saves carePlan.problems[] (NANDA rows: statement /
      // relatedTo / evidencedBy / priority / goals / targetDate / interventions
      // / evaluation / status). The old builder read flat c.problem/c.goal, so
      // the whole plan was blank. Render every problem; keep the flat shape as
      // a fallback for any legacy note.
      const probs = Array.isArray(c.problems) ? c.problems.filter(Boolean)
        : (c.problem || c.goal || c.interventions)
          ? [{ statement: c.problem, goals: c.goal, interventions: c.interventions, evaluation: c.expectedOutcome, targetDate: c.evaluationDate }]
          : [];
      if (!probs.length) return "";
      const body = probs.map((p, i) => _grid([
        _kv(`Problem${probs.length > 1 ? ` ${i + 1}` : ""}`, p.statement || p.problem, true),
        _kv("Related To", p.relatedTo),
        _kv("Evidenced By", p.evidencedBy),
        _kv("Priority", p.priority),
        _kv("Goals", p.goals || p.goal, true),
        _kv("Target Date", p.targetDate),
        _kv("Interventions", p.interventions, true),
        _kv("Evaluation", p.evaluation || p.expectedOutcome, true),
        _kv("Status", p.status),
      ])).join('<div style="height:4px"></div>');
      return _section("Nursing Care Plan", "#16a34a", body);
    },

    // ─── NUTRITIONAL (NRS-2002) ──────────────────────────────────────
    nutrition: () => {
      const n = get("nutritionalAssessment");
      // R7hu — render the fields the NRS-2002 form actually saves (BMI, diet
      // type/consistency, appetite, swallowing, feeding mode, dietitian
      // referral…). The old builder read riskBand/weightChange/recommendations
      // (never saved → always blank) and printed the boolean ageScore as a raw
      // "true".
      const yn = (v) => v === true ? "Yes" : v === false ? "No" : v;
      return _section("Nutritional Assessment (NRS-2002)", "#65a30d", _grid([
        _kv("NRS Total", n.nrsTotal),
        _kv("Nutrition Score", n.nutritionScore),
        _kv("Disease Score", n.diseaseScore),
        _kv("BMI", n.bmi),
        _kv("Weight", n.weight != null && n.weight !== "" ? `${n.weight} kg` : null),
        _kv("Appetite", n.appetite),
        _kv("Swallowing", n.swallowing),
        _kv("Diet Type", n.dietType),
        _kv("Consistency", n.consistency),
        _kv("Feeding Mode", n.feedingMode),
        _kv("NGT Present", yn(n.ngtPresent)),
        _kv("Fluid Restriction", n.fluidRestriction ? (n.fluidLimit ? `Yes · ${n.fluidLimit}` : "Yes") : null),
        _kv("Dietitian Referral", n.dietitianReferral ? (n.referralReason ? `Yes · ${n.referralReason}` : "Yes") : null),
      ]));
    },

    // ─── PATIENT EDUCATION ───────────────────────────────────────────
    // R7hr-148 — Live form saves topics/methods/barriers as arrays, plus
    // language, response, understanding, sessionNotes, educator, date,
    // nextSessionDate. Pre-fix the builder only read the singular legacy
    // fields (topic/method/comprehensionLevel) so newer saves blanked.
    // Keep legacy keys as fallback.
    education: () => {
      const e = get("patientEducation");
      const arr = (v) => Array.isArray(v) ? v.join(", ") : v;
      return _section("Patient Education", "#7c3aed", _grid([
        _kv("Topics", arr(e.topics) || e.topic, true),
        _kv("Methods", arr(e.methods) || e.method, true),
        _kv("Language", e.language),
        _kv("Understanding", e.understanding || e.comprehensionLevel),
        _kv("Response", e.response),
        _kv("Barriers", arr(e.barriers), true),
        _kv("Session Notes", e.sessionNotes, true),
        _kv("Educator", e.educator),
        _kv("Session Date", e.date),
        _kv("Next Session", e.nextSessionDate),
        _kv("Follow-up Education", e.followUpEducation, true),
      ]));
    },

    // ─── DVT / VTE RISK (Caprini) ────────────────────────────────────
    // R7hr-148 — No builder existed for the DVT noteType; cards fell
    // through to `general` which only rendered the narrative chip strip,
    // making the body look empty when the nurse filled the dedicated
    // Caprini form. The Caprini score lives on the separate
    // nursing-assessments record (not on the NurseNote noteData), so
    // this builder reads from any DVT keys we DO have on the note
    // (dvtAssessment / dvt / caprini) and surfaces the IV-line +
    // intake/output + tags context the form always stamps.
    dvt: () => {
      const d = nd.dvtAssessment || nd.dvt || nd.caprini || note.dvtAssessment || note.dvt || note.caprini || {};
      const total = d.capriniTotal ?? d.total;
      const tier  = d.riskTier ?? d.tier;
      const bleed = d.bleedTier ?? d.improveBleedTier;
      const proph = d.prophylaxis ?? d.recommendation;
      const hasStruct = total != null || tier || bleed || proph;
      const structHtml = hasStruct
        ? _grid([
            _kv("Caprini Total", total),
            _kv("Risk Tier", tier),
            _kv("Bleed Tier (IMPROVE)", bleed),
            _kv("Prophylaxis", proph, true),
          ])
        : `<div style="padding:6px 10px;background:#fef3c7;color:#92400e;border-radius:4px;font-size:11px">Caprini DVT assessment signed (full score detail in NABH DVT Register).</div>`;
      // The NurseNote also stamps IV-line + intake-output + tags — surface
      // any populated context so the card has body even on minimal saves.
      const ivCond = note.ivLine?.condition;
      const tags = (note.tags || []).filter(Boolean);
      const extras = _grid([
        _kv("IV Line", ivCond && ivCond !== "Patent" ? ivCond : null),
      ]);
      const tagHtml = tags.length
        ? `<div style="margin:6px 0 0;font-size:11px;color:#475569"><strong>Confirmations:</strong> ${tags.map(p => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#dcfce7;border-radius:9999px;color:#166534">${escapeHtml(p)}</span>`).join("")}</div>`
        : "";
      return _section("DVT / VTE Risk (Caprini)", "#0e7490", structHtml + extras + tagHtml);
    },

    // ─── DISCHARGE PLANNING ──────────────────────────────────────────
    discharge: () => {
      const d = get("discharge");
      // R7hu — the nurse "Discharge / Handover" note is an SBAR SHIFT HANDOVER
      // (situation / background / assessment / recommendation + incoming nurse),
      // NOT discharge-planning. The old builder read homeSupport/primaryCaregiver
      // /… so every handover card printed an empty body. Render the SBAR block;
      // fall back to the discharge-planning keys for any legacy note.
      const isSbar = d.situation || d.background || d.assessment || d.recommendation || d.incomingNurse;
      if (isSbar) {
        const yn = (v) => v === true ? "Yes" : v === false ? "No" : v;
        return _section(`Shift Handover${d.type ? ` — ${d.type}` : " (SBAR)"}`, "#0891b2", _grid([
          _kv("S — Situation", d.situation, true),
          _kv("B — Background", d.background, true),
          _kv("A — Assessment", d.assessment, true),
          _kv("R — Recommendation", d.recommendation, true),
          _kv("Patient Status", d.patientStatus),
          _kv("Incoming Nurse", d.incomingNurse),
          _kv("Education Given", d.educationGiven ? (d.educationTopics ? `Yes · ${d.educationTopics}` : "Yes") : null),
          _kv("Follow-up Date", d.followUpDate),
          _kv("Valuables Handed Over", yn(d.valuablesHandedOver)),
        ]));
      }
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
      // R7hu — the NursingNotes.jsx "Initial Assessment" modal saves a FLAT
      // shape under noteData.initialAssessment (not the nd.nursing/nursingNabh
      // shape the canonical IA form writes), so those notes rendered a blank
      // body. When that flat shape is the only one present, render a compact
      // flat card and return.
      const flat = nd.initialAssessment;
      if (flat && typeof flat === "object" && Object.keys(nrs).length === 0 && Object.keys(nNabh).length === 0) {
        const yn = (x) => x === true ? "Yes" : x === false ? "No" : x;
        const sum = (keys) => { const ns = keys.map((k) => Number(flat[k])).filter(Number.isFinite); return ns.length === 6 ? ns.reduce((a, b) => a + b, 0) : null; };
        const braden = sum(["b1", "b2", "b3", "b4", "b5", "b6"]);
        const morse  = sum(["m1", "m2", "m3", "m4", "m5", "m6"]);
        const bp = (flat.bp_sys || flat.bp_dia) ? `${flat.bp_sys || "—"}/${flat.bp_dia || "—"} mmHg` : null;
        return [
          _section("Chief Complaint & History", "#0d9488", _grid([
            _kv("Admission Mode", flat.admissionMode),
            _kv("Chief Complaint", flat.chiefComplaint, true),
            _kv("Duration", flat.duration),
            _kv("History of Illness", flat.historyOfIllness, true),
            _kv("Past Medical", flat.pastMedical, true),
            _kv("Past Surgical", flat.pastSurgical, true),
            _kv("Home Medications", flat.medications, true),
            _kv("Allergies", flat.allergies, true),
            _kv("Family History", flat.familyHistory, true),
          ])),
          _section("Admission Vitals", "#dc2626", _grid([
            _kv("BP", bp), _kv("Pulse", flat.pulse), _kv("Temp", flat.temp),
            _kv("SpO₂", flat.spo2), _kv("RR", flat.rr),
            _kv("Weight", flat.weight ? `${flat.weight} kg` : null), _kv("Height", flat.height ? `${flat.height} cm` : null),
          ])),
          _section("Systems Review", "#475569", _grid([
            _kv("Respiratory", flat.respiratory), _kv("Cardiovascular", flat.cardiovascular),
            _kv("Gastrointestinal", flat.gastrointestinal), _kv("Genitourinary", flat.genitourinary),
            _kv("Musculoskeletal", flat.musculoskeletal), _kv("Neurological", flat.neurological),
          ])),
          _section("Risk Screens", "#d97706", _grid([
            _kv("Braden Total", braden != null ? `${braden} / 23` : null),
            _kv("Morse Total", morse != null ? String(morse) : null),
            _kv("Pain Level", flat.painLevel),
          ])),
          _section("Psychosocial & Needs", "#7c3aed", _grid([
            _kv("Anxiety", flat.anxiety), _kv("Depression", flat.depression),
            _kv("Sleep Pattern", flat.sleepPattern), _kv("Cognition", flat.cognition),
            _kv("Communication", flat.communication), _kv("Religion", flat.religion),
            _kv("Language Barrier", yn(flat.languageBarrier)),
            _kv("Nutrition Status", flat.nutritionStatus), _kv("Appetite", flat.appetiteStatus),
            _kv("Swallowing", flat.swallowing), _kv("Special Needs", flat.specialNeeds, true),
          ])),
          _section("Discharge Planning & IV Access", "#0891b2", _grid([
            _kv("Discharge Plan", flat.dischargePlan, true),
            _kv("Caregiver Available", yn(flat.caregiverAvailable)),
            _kv("Caregiver Name", flat.caregiverName),
            _kv("IV Site", flat.ivSite), _kv("IV Type", flat.ivType),
            _kv("IV Date", flat.ivDate), _kv("IV Condition", flat.ivCondition),
          ])),
        ].join("");
      }
      const v = nrs.vitals || {};
      const anthro = nNabh.anthropometry || {};

      // Admission identity strip
      const admit = _section("Admission Identity", "#4f46e5", _grid([
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
    daily: "Daily Assessment", careplan: "Care Plan", dvt: "DVT / VTE Risk",
    nutrition: "Nutritional Assessment", education: "Patient Education",
    discharge: "Discharge / Handover", initial: "Initial Assessment",
    general: "General Observation",
  };
  const typeLabel = TYPE_LABELS[note.noteType] || (note.noteType || "Nursing Note").toUpperCase();

  const isSigned = (note.status === "submitted" || note.status === "signed");
  const statusBadge = isSigned
    ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;background:#dcfce7;color:#15803d;border:1px solid #bbf7d0">● Signed</span>'
    : '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;background:#fef3c7;color:#b45309;border:1px solid #fde68a">● Draft</span>';
  const critical = (note.isCriticalEvent || note.isCritical)
    ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;background:#fee2e2;color:#b91c1c;border:1px solid #fecaca">⚠ Critical</span>'
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
    ? `<div style="margin-left:auto;text-align:center;flex:none"><img src="${escapeHtml(nSigSrc)}" alt="Signature" style="max-height:38px;max-width:170px;border:1px solid #e2e8f0;background:#fff;padding:2px 8px;border-radius:5px"/><div style="font-size:8px;color:#94a3b8;letter-spacing:.5px;text-transform:uppercase;margin-top:2px">e-signature</div></div>`
    : "";
  // R7hr-222 — formal "authenticated" panel (presentation only; same fields:
  // signer name, emp id, signed timestamp, signature image).
  const sigHtml = isSigned
    ? `<div style="margin-top:14px;display:flex;align-items:center;gap:12px;padding:10px 13px;border:1px solid #bbf7d0;border-radius:9px;background:#f3fcf6">
  <div style="width:30px;height:30px;border-radius:50%;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex:none">✓</div>
  <div style="min-width:0;line-height:1.45;flex:1">
    <div style="font-size:10.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#15803d">Digitally signed &amp; submitted</div>
    <div style="font-size:12px;color:#0f172a"><strong>${escapeHtml(note.nurseName || note.signedByName || "Nurse")}</strong><span style="color:#64748b">${nurseEmpIdShown ? ` · Emp ${escapeHtml(nurseEmpIdShown)}` : ""}${note.signedAt ? ` · ${fmtDate(note.signedAt)}` : ` · ${noteDate}`}</span></div>
  </div>
  ${nSigImgHtml}
</div>`
    : `<div style="margin-top:14px;padding:8px 13px;border:1px dashed #fcd34d;border-radius:9px;background:#fffbeb;font-size:11px;color:#b45309;display:flex;align-items:center;gap:8px"><span style="font-size:14px">✎</span><strong>Draft — not yet signed</strong></div>`;

  // R7hr-222 — NABH note-card visual polish (presentation only; no data,
  // section, field, gate or page-break change). Nursing brand accent is pink;
  // critical events override to red. NABH chapter tags only where the
  // codebase already asserts them — plain category labels otherwise.
  const _accent = (note.isCriticalEvent || note.isCritical) ? "#dc2626" : "#be185d";
  // Sub-label classifies the record under the type title (adds info, never
  // repeats it). NABH chapter tags only on the assessment surfaces the
  // codebase already maps to IPSG.6; all others → the generic discipline tag.
  const _sub = ({ initial: "Nursing Assessment · NABH IPSG.6",
    fall: "Fall Risk · NABH IPSG.6" }[note.noteType] || "Nursing Record");
  const _icon = ({ initial: "🩺", vitals: "❤", intake: "💧", iv: "💉", pain: "😣",
    wound: "🩹", skin: "🔲", fall: "🚶", neuro: "🧠", mews: "⚠", blood: "🩸",
    procedure: "🔧", daily: "📋", careplan: "📌", dvt: "🦵", nutrition: "🥗",
    education: "📚", discharge: "📤" }[note.noteType] || "📝");

  return COMPACT_GRID_CSS + `
<div class="nfx-card" style="border:1px solid #e2e8f0;border-left:4px solid ${_accent};border-radius:10px;margin:10px 0;background:#fff;overflow:hidden">
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
    ${typeBody}
    ${remarks}
    ${sigHtml}
  </div>
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
    daily: "Daily Assessment", careplan: "Care Plan", dvt: "DVT / VTE Risk",
    nutrition: "Nutritional Assessment", education: "Patient Education",
    discharge: "Discharge / Handover", initial: "Initial Assessment",
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
  // /uploads signature images are JWT-gated — a print window's <img> can't
  // send the Authorization header, so resolve them to self-contained data:
  // URLs first (fetched HERE, in the authenticated tab). window.open stays
  // synchronous above (popup blockers require the user gesture), only the
  // document write waits. inlineUploadsInHtml never rejects — on a fetch
  // failure the src is left as-is and the img degrades gracefully.
  inlineUploadsInHtml(html).then((finalHtml) => {
    w.document.write(finalHtml);
    w.document.close();
  });
  return true;
}
