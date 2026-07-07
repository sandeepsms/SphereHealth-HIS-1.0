// buildInitialAssessmentHtml — ONE shared, comprehensive PROSE renderer for
// the IPD Initial Assessment, used by BOTH surfaces so the IA looks identical:
//
//   1. The individual IA print popup
//      (src/pages/clinical/IPDInitialAssessmentPage.jsx → handlePrintAssessment)
//      passes a canonical `ia` assembled from its live useState form vars and
//      embeds this string directly into the print-shell body.
//
//   2. The Complete Patient File — Narrative theme
//      (src/Components/print/printables/patientFileThemes/Narrative.jsx)
//      passes a canonical `ia` adapted from f.ia.doctor + f.ia.nursing +
//      f.history/f.exam/f.vitals/f.alerts and embeds it via
//      dangerouslySetInnerHTML.
//
// Design mirrors the note builders' PROSE mode (buildDoctorNoteCardHtml.js):
//   * bold-label prose lines  <strong>Label:</strong> value
//   * UPPERCASE section sub-titles
//   * TABLES only for genuinely tabular data (allergy list, med reconciliation,
//     prescription, IV/infusions, referrals, immunisation, Barthel ADL, and the
//     risk-score rows: Morse / Braden / Nutrition / Pain / DVT / VTE / GCS)
//   * page-break-safe, clean, self-contained <style> in an `.ia-*` namespace
//   * OMIT every empty/blank field — never print "—", "-", "N/A" or a blank.
//
// Pure function. No React / CSS imports. Safe to bundle for node.

/* ── local HTML escaper ─────────────────────────────────────────────── */
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/* ── value helpers ──────────────────────────────────────────────────── */
// A value counts as "empty" (and is dropped) when it is null / undefined /
// blank OR only a placeholder dash / N-A. Real clinical negatives such as
// "None" / "Nil" / "No" are kept — those are meaningful answers.
const _isEmpty = (v) => {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (/^[—–\-.\s]+$/.test(s)) return true; // only dashes / dots / spaces
  if (/^(n\/?a|null|undefined)$/i.test(s)) return true;
  return false;
};

const yn = (b) => (b ? "Yes" : "No");

const fmtDateTime = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

/* ── prose primitives ───────────────────────────────────────────────── */
// A bold-label prose line. Returns "" when the value is empty (so the caller
// can .join("") without leaving blank rows).
const line = (label, value) => {
  if (_isEmpty(value)) return "";
  return `<div class="ia-line"><strong>${esc(label)}:</strong> ${esc(value)}</div>`;
};

// Standalone prose sentence / free-text block (no label).
const para = (text) => {
  if (_isEmpty(text)) return "";
  return `<div class="ia-line">${esc(text)}</div>`;
};

// A section wraps a sub-title + body. Renders nothing when the body is empty,
// so whole sections collapse when the user captured nothing in them.
const section = (title, body) => {
  const inner = (Array.isArray(body) ? body.filter(Boolean).join("") : body) || "";
  if (!inner.trim()) return "";
  return `<div class="ia-sec"><div class="ia-h">${esc(title)}</div>${inner}</div>`;
};

// Generic table. `rows` is an array of arrays of already-safe-or-raw cells.
// Cells are escaped here. Returns "" when there are no data rows.
const table = (headers, rows) => {
  const body = (rows || []).filter((r) => Array.isArray(r) && r.length);
  if (!body.length) return "";
  const thead = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const tbody = body
    .map((r) => `<tr>${r.map((c) => `<td>${c == null ? "" : esc(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="ia-tbl"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
};

// Join non-empty flag summaries: turns { a:true, b:false } + label map into
// "Diabetes, Hypertension"; supports "(since N yr)" suffixes via valueFn.
const flagList = (obj, entries) => {
  if (!obj || typeof obj !== "object") return "";
  const parts = entries
    .map(([key, label, suffix]) => {
      if (!obj[key]) return "";
      return suffix ? `${label}${suffix}` : label;
    })
    .filter(Boolean);
  return parts.join(", ");
};

// Title-case a camelCase / snake key for a fallback label.
const humanize = (k) =>
  String(k)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

// Generic object → humanized bold-label lines, for free-shape blocks whose
// inner keys vary by source (e.g. the admission-backfilled nursing IA's
// head-to-toe systemAssessment / nutritionHydration). Rules: false flags are
// noise → skipped; true → "Yes"; arrays join; one level of nested object
// flattens to "Label: value; Label2: value2". Empty values never print.
const objLines = (obj, skip = []) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  return Object.entries(obj)
    .map(([k, v]) => {
      if (skip.includes(k) || v == null || v === false) return "";
      if (v === true) return line(humanize(k), "Yes");
      if (Array.isArray(v)) {
        return line(humanize(k), v.filter((x) => x != null && String(x).trim()).join(", "));
      }
      if (typeof v === "object") {
        const inner = Object.entries(v)
          .filter(([, iv]) => iv != null && iv !== false && typeof iv !== "object" && String(iv).trim() !== "")
          .map(([ik, iv]) => `${humanize(ik)}: ${iv === true ? "Yes" : iv}`);
        return inner.length ? line(humanize(k), inner.join("; ")) : "";
      }
      return line(humanize(k), v);
    })
    .join("");
};

/* ── the self-contained <style> block (.ia-* namespace) ──────────────── */
const IA_STYLE = `<style>
  .ia-root{font-size:11px;color:#1e293b;line-height:1.45}
  .ia-role-title{font-size:12.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#334155;margin:2px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
  .ia-sec{margin:0 0 9px;break-inside:avoid;page-break-inside:avoid}
  .ia-h{margin:11px 0 3px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#3730a3}
  .ia-line{margin:2px 0;font-size:11px;line-height:1.45;color:#1e293b;white-space:pre-wrap;overflow-wrap:anywhere}
  .ia-line strong{color:#0f172a;font-weight:700}
  .ia-tbl{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5px;margin:5px 0 8px;page-break-inside:avoid;break-inside:avoid}
  .ia-tbl th{padding:4px 7px;border:1px solid #e2e8f0;background:#f1f5f9;font-size:9.5px;font-weight:800;text-align:left;color:#475569;text-transform:uppercase;letter-spacing:.3px;word-break:break-word}
  .ia-tbl td{padding:4px 7px;border:1px solid #eef2f6;color:#0f172a;font-size:10.5px;word-break:break-word;overflow-wrap:anywhere;vertical-align:top}
  .ia-sign{margin-top:14px;padding-top:8px;border-top:1.5px solid #cbd5e1;font-size:10.5px;color:#334155;break-inside:avoid;page-break-inside:avoid}
  .ia-sign strong{color:#0f172a}
  @media print{.ia-sec,.ia-tbl,.ia-sign{page-break-inside:avoid}}
</style>`;

/* ── DOCTOR renderer ────────────────────────────────────────────────── */
function renderDoctor(d) {
  if (!d || typeof d !== "object") return "";
  const out = [];

  // Doctor & Assessment Info — only surfaces when the caller actually provides
  // one of these fields, so an empty doctor object collapses entirely (no
  // unconditional "now" timestamp injected).
  out.push(
    section("Doctor & Assessment Info", [
      line("Doctor", d.doctorName),
      line("Registration No.", d.regNo),
      line("Assessment date/time", fmtDateTime(d.assessedAt)),
    ])
  );

  // Chief Complaint
  out.push(
    section("Chief Complaint", [
      line("Chief complaint", d.chiefComplaints),
      line("Duration / onset", d.ccDuration),
    ])
  );

  // History
  out.push(
    section("History", [
      d.hopi ? para(`History of present illness: ${d.hopi}`) : "",
      line("Past medical history", d.pastMedical),
      line("Past surgical history", d.pastSurgical),
      line("Family history", d.familyHistory),
      line("Social history", d.socialHistory),
    ])
  );

  // Co-morbidities
  const como = d.comorbidities || {};
  const comoFlags = flagList(
    como,
    [
      ["diabetes", "Diabetes", como.diabetesYears ? ` (since ${como.diabetesYears} yr)` : ""],
      ["hypertension", "Hypertension", como.hypertensionYears ? ` (since ${como.hypertensionYears} yr)` : ""],
      ["cad", "Coronary artery disease", como.cadYears ? ` (since ${como.cadYears} yr)` : ""],
      ["ckd", "Chronic kidney disease", como.ckdYears ? ` (since ${como.ckdYears} yr)` : ""],
      ["copd", "COPD", como.copdYears ? ` (since ${como.copdYears} yr)` : ""],
      ["asthma", "Asthma", como.asthmaYears ? ` (since ${como.asthmaYears} yr)` : ""],
      ["liverDx", "Chronic liver disease", ""],
      ["cancer", "Active malignancy", ""],
      ["stroke", "Prior CVA / stroke", ""],
      ["mentalHealth", "Mental health disorder", ""],
      ["hypothyroid", "Hypothyroidism", ""],
      ["hiv", "HIV", ""],
      ["hepB", "Hepatitis B", ""],
      ["hepC", "Hepatitis C", ""],
    ]
  );
  out.push(
    section("Co-morbidities", [
      comoFlags ? line("Significant comorbidities", comoFlags) : "",
      line("Other", como.other),
    ])
  );

  // Allergies (Doctor)
  const al = d.allergies || {};
  const alList = Array.isArray(al.list) ? al.list.filter((a) => a && (a.name || a.agent || a.reaction)) : [];
  let allergyBody = "";
  if (al.noKnown) {
    allergyBody = para("NKDA (No Known Drug Allergies)");
  } else if (alList.length) {
    allergyBody = table(
      ["Type", "Agent", "Severity", "Reaction"],
      alList.map((a) => [a.type, a.agent || a.name, a.severity, a.reaction])
    );
  }
  out.push(section("Allergies", allergyBody));

  // Medication Reconciliation
  const medRecon = Array.isArray(d.medReconciliation) ? d.medReconciliation.filter((m) => m && (m.drug || m.name)) : [];
  out.push(
    section(
      "Medication Reconciliation",
      table(
        ["Drug", "Dose", "Frequency", "Last taken", "Decision", "Source"],
        medRecon.map((m) => [
          m.drug || m.name, m.dose, m.frequency, m.lastTaken, m.continueOnAdmit || m.decision, m.source || (m._fromNursing ? "Nursing" : "Doctor"),
        ])
      )
    )
  );

  // Clinical Examination
  const ce = d.clinicalExamination || {};
  const rosObj = ce.ros || {};
  const rosLine = Object.entries(rosObj)
    .filter(([, v]) => !_isEmpty(v) && String(v).trim().toUpperCase() !== "NAD")
    .map(([k, v]) => `${humanize(k)}: ${String(v).trim()}`)
    .join("; ");
  out.push(
    section("Clinical Examination", [
      line("General examination", ce.general),
      line("Systemic examination", ce.systemic),
      line("CVS", ce.cvs),
      line("Respiratory", ce.rs),
      line("Abdomen", ce.abdomen || ce.git),
      line("CNS", ce.cns),
      rosLine ? line("Review of systems", rosLine) : "",
      line("Local examination", d.localExam),
    ])
  );

  // Diagnosis (3-tier)
  out.push(
    section("Diagnosis", [
      line("Provisional", d.provisionalDiagnosis),
      line("Working", d.workingDiagnosis),
      line("Final / confirmed", d.finalDiagnosis),
      line("ICD-10 code", d.icd10),
      line("ICD-10 description", d.icd10Description),
      line("Patient status", d.patientStatus),
      line("Differential diagnosis", d.differentialDiagnosis),
    ])
  );

  // Anthropometry (doctor confirms)
  const an = d.anthropometry || {};
  out.push(
    section("Anthropometry", [
      line("Height (cm)", an.heightCm),
      line("Weight (kg)", an.weightKg),
      line("BMI", an.bmi),
      line("IBW (Devine)", an.idealBodyWeightKg),
    ])
  );

  // Investigations Ordered
  const invs = Array.isArray(d.investigations) ? d.investigations : [];
  const invStructured = invs.filter((i) => i && (i.name || typeof i === "string"));
  let invBody = "";
  if (invStructured.length) {
    invBody = invStructured
      .map((i) => {
        if (typeof i === "string") return line("Test", i);
        const urgency = i.urgency && i.urgency !== "ROUTINE" ? ` [${i.urgency}]` : "";
        const instr = i.instructions ? ` (${i.instructions})` : "";
        return _isEmpty(i.name) ? "" : para(`${i.name}${urgency}${instr}`);
      })
      .join("");
  } else if (!_isEmpty(d.investigationsText)) {
    invBody = line("Tests ordered", d.investigationsText);
  }
  out.push(section("Investigations Ordered", invBody));

  // Treatment Plan
  out.push(section("Treatment Plan", line("Plan", d.treatmentPlan)));

  // Prescription
  const rx = Array.isArray(d.prescription) ? d.prescription.filter((r) => r && (r.drug || r.name)) : [];
  out.push(
    section(
      "Prescription",
      table(
        ["Drug", "Dose", "Route", "Frequency", "Duration", "Instructions"],
        rx.map((m) => {
          const dv = Number(m.dilutionVolume);
          const ov = Number(m.infuseOverMinutes);
          let drug = m.drug || m.name || "";
          if (Number.isFinite(dv) && dv > 0) {
            drug += ` (in ${dv} mL ${m.dilutionFluid || "NS 0.9%"}${Number.isFinite(ov) && ov > 0 ? ` over ${ov} min` : ""})`;
          }
          return [drug, m.dose, m.route, m.frequency, m.duration, m.instructions];
        })
      )
    )
  );

  // Infusion / IV Fluids
  const inf = Array.isArray(d.infusions) ? d.infusions.filter((f) => f && f.name) : [];
  out.push(
    section(
      "Infusion / IV Fluids",
      table(
        ["Fluid", "Volume", "Rate", "Additives"],
        inf.map((f) => [f.name, f.totalVolume, f.rate, f.additives])
      )
    )
  );

  // Care Decisions
  const riskAck = d.riskAcknowledgement || {};
  const riskRows = ["fall", "dvt", "ulcer", "pain"]
    .filter((k) => riskAck[k] && (riskAck[k].acknowledged || riskAck[k].plan))
    .map((k) => {
      const r = riskAck[k] || {};
      let planCell = r.plan || "";
      if (k === "dvt" && r.score) planCell = `${planCell}${planCell ? " " : ""}(Caprini ${r.score})`;
      return [humanize(k), yn(r.acknowledged), planCell];
    });
  out.push(
    section("Care Decisions", [
      line("Code status", d.codeStatus ? String(d.codeStatus).replace(/_/g, " ") : ""),
      line("Discussed with", d.codeStatusDiscussedWith),
      line("Limitations", d.codeStatusLimitations),
      line("Estimated length of stay (days)", d.elosDays),
      line("Goal of care", d.goalOfCare),
      riskRows.length ? table(["Risk", "Acknowledged", "Plan"], riskRows) : "",
    ])
  );

  // Cross-Consultation / Referrals
  const refs = Array.isArray(d.referrals) ? d.referrals.filter((r) => r && (r.specialty || r.reason)) : [];
  out.push(
    section(
      "Cross-Consultation / Referrals",
      table(
        ["Specialty", "Reason", "Urgency", "Status"],
        refs.map((r) => [r.specialty, r.reason, r.urgency, r.status])
      )
    )
  );

  // Prognosis Discussion
  const prog = d.prognosis || {};
  out.push(
    section("Prognosis Discussion", [
      line("Discussed with", prog.discussedWith),
      line("Language used", prog.languageUsed),
      line("Summary", prog.summary),
      line("Questions addressed", prog.questionsAddressed),
    ])
  );

  // Consents Required
  const consents = d.consentNeeded || {};
  const consentFlags = Object.entries(consents)
    .filter(([, v]) => v === true)
    .map(([k]) => humanize(k))
    .join(", ");
  out.push(section("Consents Required", consentFlags ? line("Consents to obtain", consentFlags) : ""));

  // Menstrual / Obstetric
  const ob = d.obGyn || {};
  if (ob.isApplicable) {
    const gpal =
      ob.gravida || ob.para || ob.abortions || ob.livingChildren
        ? `${ob.gravida || 0} / ${ob.para || 0} / ${ob.abortions || 0} / ${ob.livingChildren || 0}`
        : "";
    out.push(
      section("Menstrual / Obstetric", [
        line("LMP", ob.lmp),
        line("Cycle days", ob.cycleDays),
        line("Cycle regular", ob.cycleRegular ? "Yes" : ob.cycleRegular === false ? "No" : ""),
        gpal ? line("G / P / A / L", gpal) : "",
        line("Contraception", ob.contraception),
        line("Last pregnancy outcome", ob.lastPregnancyOutcome),
        line("β-hCG", ob.pregnancyTestResult),
        line("Notes", ob.notes),
      ])
    );
  }

  // Immunisation
  const imm = d.immunisation || {};
  const immRows = ["tetanus", "hepB", "covid", "influenza", "pneumococcal"]
    .filter((k) => imm[k] && (imm[k].vaccinated || imm[k].lastDate))
    .map((k) => {
      const v = imm[k] || {};
      let last = v.lastDate || "";
      if (k === "covid" && v.doses) last = `${last}${last ? " · " : ""}${v.doses} doses`;
      return [humanize(k), yn(v.vaccinated), last];
    });
  out.push(
    section("Immunisation", [
      line("Up-to-date for age", imm.upToDateForAge === true ? "Yes" : imm.upToDateForAge === false ? "No" : ""),
      immRows.length ? table(["Vaccine", "Status", "Last date"], immRows) : "",
      line("Other", imm.other),
    ])
  );

  // Functional / ECOG
  const ecog = d.ecog || {};
  out.push(
    section("Functional / ECOG", [
      line("ECOG score", ecog.score),
      line("Disabilities", ecog.disabilities),
      line("Aids required", ecog.aidsRequired),
    ])
  );

  // Spiritual / Existential
  const sp = d.spiritual || {};
  out.push(
    section("Spiritual / Existential", [
      line("Distress noted", sp.distressNoted === true ? "Yes" : sp.distressNoted === false ? "No" : ""),
      line("Concerns", sp.concerns),
      line("Chaplain referral requested", sp.chaplainReferralRequested === true ? "Yes" : sp.chaplainReferralRequested === false ? "No" : ""),
    ])
  );

  // Diet, Activity & Follow-up
  out.push(
    section("Diet, Activity & Follow-up", [
      line("Diet advice", d.dietAdvice),
      line("Activity advice", d.activityAdvice),
      line("Follow-up", d.followupNotes),
    ])
  );

  // Signature
  const sb = d.signedBy || {};
  const signBits = [];
  if (!_isEmpty(sb.name)) signBits.push(`By: <strong>${esc(sb.name)}</strong>`);
  if (!_isEmpty(sb.empId)) signBits.push(`Emp ID: <strong>${esc(sb.empId)}</strong>`);
  if (!_isEmpty(sb.reg)) signBits.push(`Reg: <strong>${esc(sb.reg)}</strong>`);
  const signAt = fmtDateTime(sb.at);
  if (signAt) signBits.push(esc(signAt));
  if (signBits.length) {
    out.push(`<div class="ia-sign"><strong>Doctor Initial Assessment signed</strong> · ${signBits.join(" · ")}</div>`);
  }

  const body = out.filter(Boolean).join("");
  if (!body.trim()) return "";
  return `<div class="ia-role-title">Doctor Initial Assessment</div>${body}`;
}

/* ── NURSING renderer ───────────────────────────────────────────────── */
function renderNursing(n) {
  if (!n || typeof n !== "object") return "";
  const out = [];

  // Admission
  const adm = n.admission || {};
  out.push(
    section("Admission", [
      line("Admit date", adm.date),
      line("Admit time", adm.time),
      line("IPD #", adm.ipdNo),
      line("Mode", adm.mode),
      line("Ward", adm.ward),
      line("Bed", adm.bed),
      line("Consciousness", adm.consciousness),
      line("Mobility", adm.mobility),
    ])
  );

  // Patient Identification
  const idb = n.identification || {};
  out.push(
    section("Patient Identification", [
      line("ID band attached", idb.bandAttached != null ? yn(idb.bandAttached) : ""),
      line("Name verified", idb.nameVerified != null ? yn(idb.nameVerified) : ""),
      line("UHID verified", idb.uhidVerified != null ? yn(idb.uhidVerified) : ""),
      line("DOB verified", idb.dobVerified != null ? yn(idb.dobVerified) : ""),
      line("Verified by", idb.verifiedBy),
    ])
  );

  // Vitals on Admission
  const v = n.vitals || {};
  const bp = v.bpSys && v.bpDia ? `${v.bpSys}/${v.bpDia} mmHg` : "";
  out.push(
    section("Vitals on Admission", [
      bp ? line("BP", bp) : "",
      line("Pulse", v.pulse),
      line("RR", v.rr),
      line("Temp", v.temp),
      line("SpO₂", v.spo2),
      line("Weight", v.weight ? `${v.weight} kg` : ""),
    ])
  );

  // System / Head-to-Toe Assessment — free-shape object keyed per system
  // (neuro / respiratory / cardiac / GI / GU / skin …) carried by the
  // admission-backfilled nursing IA. Rendered generically so no captured
  // system is ever silently dropped.
  out.push(section("System / Head-to-Toe Assessment", objLines(n.systemAssessment)));

  // Anthropometry — the nurse-IA note saves {height, weight, bmi}; the IPD
  // form's live state uses {heightCm, weightKg}. Accept both.
  const an = n.anthropometry || {};
  out.push(
    section("Anthropometry", [
      line("Height (cm)", an.heightCm ?? an.height),
      line("Weight (kg)", an.weightKg ?? an.weight),
      line("BMI", an.bmi),
    ])
  );

  // Allergies (Nursing)
  const al = n.allergies || {};
  const alList = Array.isArray(al.list) ? al.list.filter((a) => a && (a.agent || a.name || a.reaction)) : [];
  let allergyBody = "";
  if (al.noKnown) {
    allergyBody = para("NKDA (No Known Drug Allergies) declared");
  } else if (alList.length) {
    allergyBody = table(
      ["Type", "Agent", "Severity", "Reaction"],
      alList.map((a) => [a.type, a.agent || a.name, a.severity, a.reaction])
    );
  }
  out.push(section("Allergies (Nursing)", allergyBody));

  // Brief History & Home Medications
  const homeMeds = Array.isArray(n.homeMeds) ? n.homeMeds.filter((m) => m && (m.drug || m.name || typeof m === "string")) : [];
  out.push(
    section("Brief History & Home Medications", [
      line("Brief PMH", n.briefHistory),
      table(
        ["Drug", "Dose", "Frequency", "Last taken"],
        homeMeds.map((m) => (typeof m === "string" ? [m, "", "", ""] : [m.drug || m.name, m.dose, m.frequency, m.lastTaken || m.duration])),
      ),
    ])
  );

  // Pain Assessment
  const pain = n.pain || {};
  out.push(
    section("Pain Assessment", [
      line("Pain present", pain.present != null ? yn(pain.present) : ""),
      line("Score (0-10)", pain.score),
      line("Location", pain.location),
      line("Character", pain.character),
    ])
  );

  // Risk scores — each score gets its own compact table (total + risk band).
  const scoreRows = [];
  const pushScore = (label, obj) => {
    if (!obj) return;
    const total = obj.total ?? obj.score;
    const risk = obj.meta?.label || obj.risk || obj.band;
    if (_isEmpty(total) && _isEmpty(risk)) return;
    scoreRows.push([label, _isEmpty(total) ? "" : String(total), risk || ""]);
  };
  pushScore("Fall risk (Morse)", n.morse);
  pushScore("Pressure ulcer (Braden)", n.braden);
  pushScore("Nutrition (NRS-2002)", n.nutrition);
  pushScore("Pain (0-10)", pain.score != null || pain.risk ? { total: pain.score, risk: pain.risk } : null);
  pushScore("DVT / VTE (Caprini)", n.vte || n.dvt);
  pushScore("Glasgow Coma Scale", n.gcs);
  out.push(section("Risk Scores", scoreRows.length ? table(["Assessment", "Score", "Risk / band"], scoreRows) : ""));

  // Nutrition quick-screen (NRS-2002) extras
  const nutri = n.nutrition || {};
  const nrsQuick = nutri.quick || {};
  const nrsBody = [
    line("BMI < 20.5", nrsQuick.bmiUnder20 != null ? yn(nrsQuick.bmiUnder20) : ""),
    line("Weight loss in 3 mo", nrsQuick.weightLossLast3Months != null ? yn(nrsQuick.weightLossLast3Months) : ""),
    line("Reduced intake in 1 wk", nrsQuick.reducedIntakeLastWeek != null ? yn(nrsQuick.reducedIntakeLastWeek) : ""),
    line("Severely ill", nrsQuick.severelyIll != null ? yn(nrsQuick.severelyIll) : ""),
    nrsQuick.dietitianReferralTriggered ? para("Dietitian referral triggered") : "",
  ].join("");
  out.push(section("Nutrition Quick-Screen", nrsBody));

  // Nutrition & Hydration — free-shape detail block (admission-backfilled
  // nursing IA's nutritionHydration). Generic so no field is dropped.
  out.push(section("Nutrition & Hydration", objLines(n.nutritionDetail)));

  // Psychosocial — known keys first, then a generic tail so source shapes
  // with different inner keys (admission copy) still render fully.
  const ps = n.psychosocial || {};
  out.push(
    section("Psychosocial", [
      line("Emotional state", ps.emotionalState),
      line("Mood / affect", ps.moodAffect),
      line("Family support", ps.familySupport),
      line("Preferred language", ps.languagePreferred),
      line("Notes", ps.notes),
      objLines(ps, ["emotionalState", "moodAffect", "familySupport", "languagePreferred", "notes"]),
    ])
  );

  // Functional / Barthel ADL
  const bar = n.barthel || {};
  const barKeys = ["feeding", "bathing", "grooming", "dressing", "bowels", "bladder", "toilet", "transfer", "mobility", "stairs"];
  const barRows = barKeys.filter((k) => bar[k] != null && bar[k] !== "").map((k) => [humanize(k), String(bar[k])]);
  if (barRows.length) {
    const total = barKeys.reduce((s, k) => s + Number(bar[k] || 0), 0);
    barRows.push(["Total", `${total} / 100`]);
  }
  out.push(section("Functional / Barthel ADL", barRows.length ? table(["Item", "Score"], barRows) : ""));

  // Body Chart
  const bc = n.bodyChart || {};
  out.push(
    section("Body Chart", [
      line("Head / neck", bc.headNeck),
      line("Chest / back", bc.chestBack),
      line("Abdomen / groin", bc.abdomenGroin),
      line("Upper limbs", bc.upperLimbs),
      line("Lower limbs", bc.lowerLimbs),
      line("Existing wounds", bc.existingWounds),
      line("Bruises / scars", bc.existingBruises),
    ])
  );

  // Special Precautions
  const pre = n.precautions || {};
  const iso = pre.isolation || {};
  const res = pre.restraints || {};
  out.push(
    section("Special Precautions", [
      iso.required ? line("Isolation", iso.type || "Yes") : "",
      res.required ? line("Restraints", `${res.type || "Yes"}${res.reason ? ` · ${res.reason}` : ""}`) : "",
      pre.suicide ? line("Suicide precaution", "Yes") : "",
      pre.fallPrecaution ? line("Fall precaution", "Yes") : "",
      pre.aspiration ? line("Aspiration precaution", "Yes") : "",
      pre.bleed ? line("Bleeding precaution", "Yes") : "",
      pre.seizure ? line("Seizure precaution", "Yes") : "",
      pre.mri ? line("MRI safety", "Yes") : "",
      pre.latex ? line("Latex-free", "Yes") : "",
    ])
  );

  // Education Needs
  const edu = n.education || {};
  out.push(
    section("Education Needs", [
      line("Preferred language", edu.preferredLanguage),
      line("Learning style", edu.learningStyle),
      line("Target audience", edu.targetAudience),
      line("Can read", edu.canRead != null ? yn(edu.canRead) : ""),
      line("Can write", edu.canWrite != null ? yn(edu.canWrite) : ""),
      line("Barriers to learning", edu.barriersToLearning),
    ])
  );

  // Discharge Planning (Day 1) — known keys first + generic tail (the
  // admission copy carries extras like followUpPlan / medicationsToContinue).
  const dp = n.dischargePlanning || {};
  out.push(
    section("Discharge Planning (Day 1)", [
      line("Home support", dp.homeSupport),
      line("Primary caregiver", dp.primaryCaregiver),
      line("Transport", dp.transportNeed),
      line("Anticipated barriers", dp.anticipatedBarriers),
      line("Equipment needed", Array.isArray(dp.equipmentNeeded) ? dp.equipmentNeeded.join(", ") : dp.equipmentNeeded),
      objLines(dp, ["homeSupport", "primaryCaregiver", "transportNeed", "anticipatedBarriers", "equipmentNeeded"]),
    ])
  );

  // Cognitive & Communication
  const cog = n.cognitive || {};
  out.push(
    section("Cognitive & Communication", [
      line("Oriented to person", cog.orientationPerson != null ? yn(cog.orientationPerson) : ""),
      line("Oriented to place", cog.orientationPlace != null ? yn(cog.orientationPlace) : ""),
      line("Oriented to time", cog.orientationTime != null ? yn(cog.orientationTime) : ""),
      cog.visionDeficit ? line("Vision deficit", "Yes") : "",
      cog.hearingDeficit ? line("Hearing deficit", "Yes") : "",
      cog.speechDeficit ? line("Speech deficit", "Yes") : "",
      line("Aids used", cog.aidsUsed),
      line("GCS", cog.gcs),
      line("Notes", cog.notes),
    ])
  );

  // Cultural & Spiritual
  const cul = n.cultural || {};
  out.push(
    section("Cultural & Spiritual", [
      line("Religion", cul.religion),
      line("Dietary restrictions", cul.dietaryRestrictions),
      line("Spiritual needs", cul.spiritualNeeds),
      line("Customs", cul.customs),
    ])
  );

  // Bowel / Bladder
  const el = n.elimination || {};
  out.push(
    section("Bowel / Bladder", [
      line("Bowel continence", el.bowelContinence),
      line("Last BM", el.bowelLastBM),
      line("Bowel frequency", el.bowelFrequency),
      line("Bladder continence", el.bladderContinence),
      line("Catheterised", el.bladderCatheterised != null ? yn(el.bladderCatheterised) : ""),
      line("24h urine output (mL)", el.bladderOutput24h),
      line("Notes", el.notes),
    ])
  );

  // Sleep Pattern
  const sl = n.sleep || {};
  out.push(
    section("Sleep Pattern", [
      line("Hours per night", sl.hoursPerNight),
      line("Quality", sl.quality),
      line("Sleep aids", sl.sleepAids),
      sl.snoring ? line("Snoring", "Yes") : "",
      sl.apneaDx ? line("Apnea diagnosis", "Yes") : "",
    ])
  );

  // Valuables & Belongings
  const val = n.valuables || {};
  out.push(
    section("Valuables & Belongings", [
      line("Status", val.status),
      line("Handed to", val.handedTo),
      line("Items", val.items),
      line("Receipt issued", val.receiptIssued != null ? yn(val.receiptIssued) : ""),
    ])
  );

  // Family & Caregiver
  const cg = n.caregiver || {};
  out.push(
    section("Family & Caregiver", [
      line("Primary name", cg.primaryName),
      line("Primary relation", cg.primaryRelation),
      line("Primary contact", cg.primaryContact),
      line("Lives with patient", cg.lives_with_patient != null ? yn(cg.lives_with_patient) : ""),
      line("Escalation name", cg.escalationName),
      line("Escalation relation", cg.escalationRelation),
      line("Escalation contact", cg.escalationContact),
    ])
  );

  // High-Risk Flags
  const hr = n.highRisk || {};
  const hrFlags = flagList(hr, [
    ["pediatric", "Pediatric", ""],
    ["geriatric", "Geriatric", ""],
    ["pregnant", "Pregnant", ""],
    ["immunocompromised", "Immunocompromised", ""],
    ["mentalHealth", "Mental health", ""],
    ["bariatric", "Bariatric", ""],
    ["polyTrauma", "Polytrauma", ""],
    ["severeMalnutrition", "Severe malnutrition", ""],
  ]);
  out.push(
    section("High-Risk Flags", [
      hrFlags ? line("Flags", hrFlags) : "",
      line("Notes", hr.notes),
    ])
  );

  // Mobility & Gait
  const mob = n.mobility || {};
  if (typeof mob === "object") {
    out.push(
      section("Mobility & Gait", [
        line("Independent", mob.independent != null ? yn(mob.independent) : ""),
        line("Aid used", mob.usesAid),
        line("Gait normal", mob.gaitNormal != null ? yn(mob.gaitNormal) : ""),
        mob.fallRisk ? line("Fall risk observed", "Yes") : "",
        line("Notes", mob.notes),
      ])
    );
  } else {
    out.push(section("Mobility & Gait", line("Mobility", mob)));
  }

  // Pre-Anaesthesia
  const pa = n.preAnaesthesia || {};
  out.push(
    section("Pre-Anaesthesia (if elective surgery)", [
      line("Planned surgery", pa.plannedSurgery != null ? yn(pa.plannedSurgery) : ""),
      line("NPO since", pa.npoSince),
      pa.looseTooth ? line("Loose tooth", "Yes") : "",
      pa.crowns ? line("Crowns / bridges", "Yes") : "",
      pa.dentures ? line("Dentures", "Yes") : "",
      pa.difficulIntubationHistory ? line("Difficult intubation Hx", "Yes") : "",
      line("Previous anaesthesia", pa.anaesthesiaHistory),
      line("PAC scheduled", pa.pacScheduled != null ? yn(pa.pacScheduled) : ""),
      line("PAC date", pa.pacDate),
    ])
  );

  // PROM / PREM Triggers
  const prom = n.prom || {};
  out.push(
    section("PROM / PREM Triggers", [
      line("PROM planned", prom.promPlanned != null ? yn(prom.promPlanned) : ""),
      line("PROM survey", prom.promSurvey),
      line("PREM planned", prom.premPlanned != null ? yn(prom.premPlanned) : ""),
      line("PREM survey", prom.premSurvey),
      line("Notes", prom.notes),
    ])
  );

  // Nursing Plan
  const plan = n.plan || {};
  out.push(
    section("Nursing Plan", [
      line("Problems", plan.problems),
      line("Goals", plan.goals),
      line("Notes", plan.notes),
    ])
  );

  // Signature
  const sb = n.signedBy || {};
  const signBits = [];
  if (!_isEmpty(sb.name)) signBits.push(`By: <strong>${esc(sb.name)}</strong>`);
  if (!_isEmpty(sb.empId)) signBits.push(`Emp ID: <strong>${esc(sb.empId)}</strong>`);
  if (!_isEmpty(sb.reg)) signBits.push(`Reg: <strong>${esc(sb.reg)}</strong>`);
  const signAt = fmtDateTime(sb.at);
  if (signAt) signBits.push(esc(signAt));
  if (signBits.length) {
    out.push(`<div class="ia-sign"><strong>Nursing Initial Assessment signed</strong> · ${signBits.join(" · ")}</div>`);
  }

  const body = out.filter(Boolean).join("");
  if (!body.trim()) return "";
  return `<div class="ia-role-title">Nursing Initial Assessment</div>${body}`;
}

/**
 * buildInitialAssessmentHtml — render the canonical Initial Assessment as a
 * self-contained prose HTML string (with its own <style>).
 *
 * @param {Object} ia   Canonical nested shape:
 *   { role: "doctor" | "nurse" | "both", doctor: {...}, nursing: {...} }
 *   Doctor sections render when role is "doctor" | "both";
 *   Nursing sections render when role is "nurse" | "both".
 * @param {Object} [opts]  Reserved (e.g. { prose: true }); this builder is
 *   always prose, so opts is currently accepted for call-site symmetry.
 * @returns {string} HTML string (style + content). "" if nothing to render.
 */
export function buildInitialAssessmentHtml(ia, opts = {}) {
  const src = ia || {};
  const role = String(src.role || "both").toLowerCase();
  const wantDoctor = role === "doctor" || role === "both";
  const wantNursing = role === "nurse" || role === "nursing" || role === "both";

  const parts = [];
  if (wantDoctor) parts.push(renderDoctor(src.doctor));
  if (wantNursing) parts.push(renderNursing(src.nursing));

  const content = parts.filter(Boolean).join("");
  if (!content.trim()) return "";
  return `${IA_STYLE}<div class="ia-root">${content}</div>`;
}

export default buildInitialAssessmentHtml;
