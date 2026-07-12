/**
 * FullDischargeSection.jsx — R7hr(DOCS-FULL, owner 2026-07-12)
 * ─────────────────────────────────────────────────────────────
 * The Complete Patient File prints the FULL discharge summary — the same
 * detail level as the standalone `discharge-summary` printable — instead of
 * the old 5-field digest (summary/advice/meds/follow-up/condition).
 *
 * Data source: `file.discharge.full` = the raw DischargeSummaryModel doc
 * (passed through buildPrintReceipt → normalizeData untouched). Field reads
 * carry fallback chains covering BOTH the model keys and the standalone
 * printable's receipt aliases (registerRows.js precedent: mapping lives in
 * ONE place so the file and the standalone can't drift apart).
 *
 * Used by Narrative (default theme); other themes can embed it the same way
 * SharedRegisterSections is embedded. Renders nothing when no discharge
 * summary exists; falls back to compact `file.discharge` fields when only a
 * legacy payload is present (old reprints stay byte-identical via the
 * caller's `file.discharge.full` guard).
 */
import React from "react";

const S = {
  h: { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".6px", color: "#334155", margin: "10px 0 3px", borderBottom: "1px solid #e2e8f0", paddingBottom: 2 },
  p: { fontSize: 10.5, color: "#0f172a", margin: "2px 0", lineHeight: 1.5, whiteSpace: "pre-wrap" },
  chip: { display: "inline-block", padding: "1px 8px", borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: ".4px", marginRight: 6, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#334155" },
  tbl: { width: "100%", borderCollapse: "collapse", fontSize: 9.5, margin: "3px 0 6px" },
  th: { border: "1px solid #e7edf3", background: "#f6f8fb", padding: "3px 6px", textAlign: "left", fontWeight: 800, textTransform: "uppercase", fontSize: 8.5, color: "#475569" },
  td: { border: "1px solid #eef2f6", padding: "3px 6px", verticalAlign: "top", color: "#0f172a" },
  warn: { border: "1.5px solid #fca5a5", background: "#fef2f2", borderRadius: 6, padding: "6px 10px", margin: "6px 0", fontSize: 10.5, color: "#991b1b", whiteSpace: "pre-wrap" },
};

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const has = (v) => Array.isArray(v) ? v.length > 0 : !!str(v);
const fmtD = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? str(v) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); };

function Sec({ title, children }) {
  return <><div style={S.h}>{title}</div>{children}</>;
}
function Para({ v }) { return has(v) ? <div style={S.p}>{str(v)}</div> : null; }

export default function FullDischargeSection({ file }) {
  const f = file || {};
  const d = f.discharge || {};
  const r = d.full || null;
  if (!r && !has(d.summary) && !has(d.advice) && !(d.medications || []).length) return null;

  // Fallback chains: model keys first, standalone-receipt aliases second,
  // compact normalized digest last.
  const x = r || {};
  const finalDx   = str(x.finalDiagnosis) || str(f.admission?.finalDiagnosis);
  const icd       = str(x.icd10Code || x.icd || x.icdCode) || str(f.admission?.icd10);
  const icdDesc   = str(x.icd10Description || x.icdDescription);
  const secondary = Array.isArray(x.secondaryDiagnoses) ? x.secondaryDiagnoses : (Array.isArray(x.codedDiagnoses) ? x.codedDiagnoses.slice(1) : []);
  // Model key first (DischargeSummaryModel: medicationsOnDischarge[].medicineName),
  // then the standalone-receipt aliases, then the compact digest.
  const meds      = (Array.isArray(x.medicationsOnDischarge) && x.medicationsOnDischarge.length ? x.medicationsOnDischarge
                    : Array.isArray(x.dischargeMeds) && x.dischargeMeds.length ? x.dischargeMeds
                    : Array.isArray(x.dischargeMedications) && x.dischargeMedications.length ? x.dischargeMedications
                    : d.medications || []);
  const advice    = x.advice || x.finalAdvice || x.restrictionsAndPrecautions || d.advice;
  const adviceArr = Array.isArray(advice) ? advice : str(advice).split("\n").map((s) => s.trim()).filter(Boolean);
  const warnings  = x.emergencyWarnings || x.warningSigns;
  const warnArr   = Array.isArray(warnings) ? warnings : str(warnings).split("\n").map((s) => s.trim()).filter(Boolean);
  const deptRows  = [
    ["Echo EF", x.echoEF], ["ECG at discharge", x.ecgOnDischarge], ["Tumor stage", x.tumorStage],
    ["Next chemo", fmtD(x.nextChemoDate)], ["Stroke type", x.strokeType], ["NIHSS at discharge", x.nihssOnDischarge],
    ["Delivery type", x.deliveryType], ["Baby details", x.babyDetails], ["Implant details", x.implantDetails],
    ["Growth percentile", x.growthPercentile], ["Immunisation given", x.immunisationGiven],
  ].filter(([, v]) => has(v));

  return (
    <div className="pf-avoid-break-inside" style={{ fontSize: 10.5 }}>
      <div style={{ margin: "2px 0 6px" }}>
        {has(x.dischargeType) && <span style={S.chip}>{str(x.dischargeType).toUpperCase()}</span>}
        {has(x.totalDaysAdmitted || x.totalDays) && <span style={S.chip}>LOS {x.totalDaysAdmitted || x.totalDays} day{Number(x.totalDaysAdmitted || x.totalDays) === 1 ? "" : "s"}</span>}
        {has(x.bloodGroup) && <span style={S.chip}>Blood {x.bloodGroup}</span>}
        {has(x.mlcNumber) && <span style={{ ...S.chip, borderColor: "#fca5a5", background: "#fef2f2", color: "#991b1b" }}>MLC {x.mlcNumber}</span>}
        {has(x.conditionOnDischarge || d.condition) && <span style={{ ...S.chip, borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534" }}>Condition: {str(x.conditionOnDischarge || d.condition)}</span>}
      </div>

      {(has(finalDx) || has(icd)) && (
        <Sec title="Final Diagnosis">
          <div style={S.p}><strong>{finalDx || "—"}</strong>{icd ? ` · ICD-10: ${icd}${icdDesc ? ` — ${icdDesc}` : ""}` : ""}</div>
          {secondary.length > 0 && (
            <div style={S.p}>Secondary: {secondary.map((sd) => typeof sd === "string" ? sd : [sd.code || sd.icdCode, sd.description || sd.diagnosis].filter(Boolean).join(" — ")).filter(Boolean).join("; ")}</div>
          )}
        </Sec>
      )}
      {has(x.historyOfPresentIllness || x.chiefComplaints) && <Sec title="Presenting History"><Para v={x.historyOfPresentIllness || x.chiefComplaints} /></Sec>}
      {(has(x.significantFindings || x.summary) || has(d.summary)) && <Sec title="Clinical Summary / Significant Findings"><Para v={x.significantFindings || x.summary || d.summary} /></Sec>}
      {has(x.courseInHospital || x.courseOfStay) && <Sec title="Course in Hospital"><Para v={x.courseInHospital || x.courseOfStay} /></Sec>}
      {has(x.proceduresDone) && (
        <Sec title="Procedures Performed">
          {Array.isArray(x.proceduresDone)
            ? x.proceduresDone.map((p, i) => <div key={i} style={S.p}>• {typeof p === "string" ? p : [p.procedureName || p.name || p.procedure, fmtD(p.date), p.performedBy, p.notes].filter(Boolean).join(" · ")}</div>)
            : <Para v={x.proceduresDone} />}
        </Sec>
      )}
      {has(x.investigationsSummary || x.keyInvestigationsText) && <Sec title="Key / Pending Investigations"><Para v={x.investigationsSummary || x.keyInvestigationsText} /></Sec>}
      {has(x.bloodTransfusionsText || x.bloodTransfusions) && <Sec title="Blood Transfusions"><Para v={x.bloodTransfusionsText || x.bloodTransfusions} /></Sec>}
      {(has(x.operativeProcedure) || has(x.operativeFindings) || has(x.anaesthesiaType)) && (
        <Sec title="Operative Details">
          {has(x.operativeProcedure) && <div style={S.p}><strong>Procedure:</strong> {str(x.operativeProcedure)}</div>}
          {has(x.anaesthesiaType) && <div style={S.p}><strong>Anaesthesia:</strong> {str(x.anaesthesiaType)}</div>}
          {has(x.operativeFindings) && <div style={S.p}><strong>Findings:</strong> {str(x.operativeFindings)}</div>}
        </Sec>
      )}
      {has(x.vitalsOnDischarge) && <Sec title="Vitals at Discharge"><Para v={typeof x.vitalsOnDischarge === "object" ? Object.entries(x.vitalsOnDischarge).filter(([, v]) => has(v)).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(" · ") : x.vitalsOnDischarge} /></Sec>}

      {meds.length > 0 && (
        <Sec title="Medications on Discharge">
          <table style={S.tbl}><thead><tr>{["Drug", "Dose", "Route", "Frequency", "Duration", "Instructions"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{meds.map((m, i) => (
              <tr key={i}>
                <td style={S.td}><strong>{str(m.medicineName || m.name || m.drug || m.medicationName) || "—"}</strong>{has(m.generic) ? <div style={{ fontSize: 8.5, color: "#64748b" }}>{str(m.generic)}</div> : null}</td>
                <td style={S.td}>{str(m.dose || m.strength) || "—"}</td>
                <td style={S.td}>{str(m.route) || "—"}</td>
                <td style={S.td}>{str(m.frequency || m.freq) || "—"}</td>
                <td style={S.td}>{str(m.duration) || "—"}</td>
                <td style={S.td}>{str(m.instructions || m.remarks || m.notes) || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </Sec>
      )}

      {adviceArr.length > 0 && (
        <Sec title="Discharge Advice">
          <ol style={{ margin: "2px 0 4px 16px", padding: 0 }}>{adviceArr.map((a, i) => <li key={i} style={S.p}>{str(typeof a === "string" ? a : a.text || a.advice)}</li>)}</ol>
        </Sec>
      )}
      {has(x.dietAdvice) && <Sec title="Dietary Advice"><Para v={x.dietAdvice} /></Sec>}
      {has(x.activityAdvice) && <Sec title="Activity Advice"><Para v={x.activityAdvice} /></Sec>}
      {has(x.woundCareInstructions || x.woundCare) && <Sec title="Wound Care"><Para v={x.woundCareInstructions || x.woundCare} /></Sec>}
      {has(x.causeOfDeath) && <Sec title="Cause of Death"><Para v={[x.causeOfDeath, x.immediateCauseOfDeath && `Immediate: ${x.immediateCauseOfDeath}`, x.antecedentCauseOfDeath && `Antecedent: ${x.antecedentCauseOfDeath}`].filter(Boolean).join("\n")} /></Sec>}
      {deptRows.length > 0 && (
        <Sec title="Department-Specific Findings">
          {deptRows.map(([k, v]) => <div key={k} style={S.p}><strong>{k}:</strong> {str(v)}</div>)}
        </Sec>
      )}
      {has(x.specialInstructions || x.dischargeNotes) && <Sec title="Special Instructions"><Para v={x.specialInstructions || x.dischargeNotes} /></Sec>}

      {warnArr.length > 0 && (
        <div style={S.warn}><strong>⚠ RETURN IMMEDIATELY IF:</strong> {warnArr.join(" · ")}</div>
      )}

      {(has(x.followUpDate || d.followUpDate) || has(x.followUpInstructions)) && (
        <Sec title="Follow-up">
          <div style={S.p}>{[x.followUpDate || d.followUpDate ? `Review on ${fmtD(x.followUpDate || d.followUpDate)}` : "", str(x.followUpInstructions)].filter(Boolean).join(" — ")}</div>
        </Sec>
      )}

      {(has(x.doctorName || x.residentDoctor || x.resident) || has(x.finalizedByName || x.consultant || x.consultantName)) && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginTop: 10, paddingTop: 6, borderTop: "1px solid #e2e8f0", fontSize: 9.5, color: "#475569" }}>
          <div>{has(x.doctorName || x.residentDoctor || x.resident) ? <><strong>Attending:</strong> {str(x.doctorName || x.residentDoctor || x.resident)}{has(x.doctorRegNo) ? ` · Reg ${str(x.doctorRegNo)}` : ""}</> : null}</div>
          <div>{has(x.finalizedByName || x.consultant || x.consultantName) ? <><strong>Finalized by:</strong> {str(x.finalizedByName || x.consultant || x.consultantName)}{has(x.cosignedByName) ? ` · Co-signed: ${str(x.cosignedByName)}` : ""}{has(x.consultantDmc || x.consultantReg) ? ` · Reg ${str(x.consultantDmc || x.consultantReg)}` : ""}</> : null}</div>
        </div>
      )}
    </div>
  );
}
