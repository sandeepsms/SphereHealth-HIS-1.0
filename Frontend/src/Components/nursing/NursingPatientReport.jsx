/**
 * NursingPatientReport.jsx
 * Full printable / PDF-ready nursing record for a patient.
 * Used for insurance claims, NABH audits, discharge file printing.
 */

import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
// R7cb-C: settings-driven hospital name in printed nursing record header / footer.
import useHospitalSettings from "../print/useHospitalSettings";

const API = API_ENDPOINTS.BASE;

const MODULE_LABELS = {
  vitals:             "Vital Signs",
  neuroAssessment:    "Neurological / GCS",
  bloodTransfusion:   "Blood Transfusion",
  ivInfusion:         "IV Infusion",
  intakeOutput:       "Intake / Output",
  painAssessment:     "Pain Assessment",
  woundCare:          "Wound / Dressing Care",
  skinAssessment:     "Skin / Pressure Assessment",
  fallRisk:           "Fall Risk (Morse Scale)",
  procedure:          "Procedure / Intervention",
  discharge:          "Discharge / Handover",
  mewsScore:          "MEWS Score",
  dailyAssessment:    "Daily Assessment",
  initialAssessment:  "Initial Assessment",
  carePlan:           "Care Plan",
  nutritionalAssessment: "Nutritional Assessment",
  patientEducation:   "Patient Education",
};

function formatVal(val) {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "object" && !Array.isArray(val)) {
    return Object.entries(val)
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false)
      .map(([k, v]) => `${k}: ${formatVal(v)}`)
      .join("  |  ") || "—";
  }
  if (Array.isArray(val)) return val.length ? val.join(", ") : "—";
  return String(val);
}

function ModuleBlock({ label, data }) {
  if (!data) return null;
  const entries = typeof data === "object" && !Array.isArray(data)
    ? Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false)
    : [["value", data]];
  if (!entries.length) return null;
  return (
    <div style={{ marginBottom: 8, breakInside: "avoid" }}>
      <div style={{ fontWeight: 700, fontSize: 11, color: "#0f766e", textTransform: "uppercase",
        letterSpacing: ".5px", marginBottom: 4, paddingBottom: 2, borderBottom: "1px solid #e2e8f0" }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 20px", fontSize: 11, color: "#334155" }}>
        {entries.map(([k, v]) => (
          <span key={k}>
            <b style={{ color: "#64748b", fontWeight: 600 }}>{k.replace(/([A-Z])/g, " $1").trim()}: </b>
            {formatVal(v)}
          </span>
        ))}
      </div>
    </div>
  );
}

function NoteCard({ note, index, hospitalName }) {
  const date   = new Date(note.noteDate || note.createdAt);
  const shift  = note.shift || "—";
  const mod    = MODULE_LABELS[note.noteType] || note.noteType || "General Observation";
  const isCrit = note.isCriticalEvent || note.isCritical;
  const mData  = note.moduleData || {};

  return (
    <div style={{
      border: `1.5px solid ${isCrit ? "#fca5a5" : "#e2e8f0"}`,
      borderRadius: 8, padding: "12px 16px", marginBottom: 12,
      breakInside: "avoid", background: isCrit ? "#fff5f5" : "#fff",
    }}>
      {/* Note header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <span style={{ fontWeight: 800, fontSize: 13, color: "#0f172a" }}>
            #{index + 1} — {mod}
          </span>
          {isCrit && (
            <span style={{ marginLeft: 8, background: "#fca5a5", color: "#991b1b", fontSize: 10,
              fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>⚠ CRITICAL EVENT</span>
          )}
          {note.tags?.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: 10, color: "#64748b" }}>
              [{note.tags.join(", ")}]
            </span>
          )}
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: "#64748b" }}>
          <div>{date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            {" "}{date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
          <div style={{ textTransform: "capitalize" }}>Shift: <b>{shift}</b></div>
        </div>
      </div>

      {/* Module data */}
      {Object.entries(mData).map(([k, v]) => (
        <ModuleBlock key={k} label={MODULE_LABELS[k] || k} data={v} />
      ))}

      {/* Legacy vitals (direct on note) */}
      {note.vitals && Object.values(note.vitals).some(Boolean) && (
        <ModuleBlock label="Vital Signs" data={note.vitals} />
      )}
      {note.intakeOutput && Object.values(note.intakeOutput).some(v => v > 0) && (
        <ModuleBlock label="Intake / Output" data={note.intakeOutput} />
      )}
      {note.generalCondition && Object.values(note.generalCondition).some(Boolean) && (
        <ModuleBlock label="General Condition" data={note.generalCondition} />
      )}

      {/* Remarks */}
      {note.remarks && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#334155" }}>
          <b>Remarks: </b>{note.remarks}
        </div>
      )}

      {/* Nurse sign-off */}
      <div style={{ marginTop: 10, paddingTop: 6, borderTop: "1px dashed #e2e8f0",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "#64748b" }}>
          <b>Recorded by: </b>
          {note.nurseName || "—"}
          {note.nurseEmployeeId ? ` (${note.nurseEmployeeId})` : ""}
          {note.nurseDesignation ? `, ${note.nurseDesignation}` : ""}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {note.nurseSignature && (
            <img src={note.nurseSignature} alt="Nurse Sig"
              style={{ height: 32, maxWidth: 90, border: "1px solid #e2e8f0", borderRadius: 4, padding: 2 }} />
          )}
          {note.signature && (
            <img src={note.signature} alt="Signature"
              style={{ height: 32, maxWidth: 90, border: "1px solid #e2e8f0", borderRadius: 4, padding: 2 }} />
          )}
          {!note.nurseSignature && !note.signature && (
            <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>No digital signature</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NursingPatientReport({ ipdNo, patientName, patientUHID, patientInfo, hospitalName, onClose }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const printRef = useRef();
  // R7cb-C: use centralized settings; caller-passed `hospitalName` prop
  // remains a valid override so existing callers don't break.
  const { settings } = useHospitalSettings();

  useEffect(() => {
    if (!ipdNo) return;
    setLoading(true);
    axios.get(`${API}/nurse-notes/report/${ipdNo}`)
      .then(r => setNotes(r.data.notes || []))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  }, [ipdNo]);

  const filtered = filter === "all" ? notes
    : notes.filter(n => n.noteType === filter || n.shift === filter);

  const grouped = filtered.reduce((acc, n) => {
    const day = new Date(n.noteDate || n.createdAt).toISOString().slice(0, 10);
    (acc[day] = acc[day] || []).push(n);
    return acc;
  }, {});

  const handlePrint = () => {
    const w = window.open("", "_blank", "width=900,height=700");
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Nursing Record — ${patientName || "Patient"} | ${ipdNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; background: #fff; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px; }
    .hospital { font-size: 16px; font-weight: 800; color: #0f766e; }
    .doc-title { font-size: 13px; font-weight: 700; margin-top: 4px; }
    .patient-bar { display: flex; gap: 24px; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; font-size: 11px; }
    .patient-bar b { color: #0f766e; }
    .day-heading { font-size: 12px; font-weight: 800; color: #0f172a; background: #f1f5f9; padding: 6px 10px; border-radius: 4px; margin: 12px 0 6px; border-left: 4px solid #0f766e; }
    .note-card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; page-break-inside: avoid; }
    .note-card.critical { border-color: #fca5a5; background: #fff5f5; }
    .note-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .note-type { font-weight: 800; font-size: 12px; }
    .note-meta { font-size: 10px; color: #64748b; text-align: right; }
    .module-label { font-weight: 700; font-size: 10px; color: #0f766e; text-transform: uppercase; letter-spacing: .5px; margin: 6px 0 2px; padding-bottom: 1px; border-bottom: 1px solid #e2e8f0; }
    .module-data { font-size: 10px; color: #334155; line-height: 1.7; }
    .remarks { font-size: 10px; color: #334155; margin-top: 4px; }
    .signoff { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 5px; border-top: 1px dashed #e2e8f0; font-size: 10px; color: #64748b; }
    .sig-img { height: 28px; border: 1px solid #e2e8f0; border-radius: 3px; }
    .crit-badge { background: #fca5a5; color: #991b1b; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 3px; margin-left: 6px; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; text-align: center; }
    .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; display: flex; gap: 20px; }
    .summary-box .stat { text-align: center; }
    .summary-box .stat-num { font-size: 18px; font-weight: 800; color: #0f766e; }
    .summary-box .stat-lbl { font-size: 9px; color: #64748b; }
    @media print {
      body { padding: 10px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="hospital">${settings.hospitalName || hospitalName || "Hospital"}</div>
    <div class="doc-title">NURSING CARE RECORD</div>
    <div style="font-size:9px;color:#64748b;margin-top:2px">NABH Compliant — Confidential Medical Document</div>
  </div>

  <div class="patient-bar">
    <span><b>Patient:</b> ${patientName || "—"}</span>
    <span><b>UHID:</b> ${patientUHID || "—"}</span>
    <span><b>IPD No:</b> ${ipdNo || "—"}</span>
    ${patientInfo?.age ? `<span><b>Age:</b> ${patientInfo.age}</span>` : ""}
    ${patientInfo?.gender ? `<span><b>Gender:</b> ${patientInfo.gender}</span>` : ""}
    ${patientInfo?.ward ? `<span><b>Ward/Bed:</b> ${patientInfo.ward}</span>` : ""}
    <span><b>Print Date:</b> ${new Date().toLocaleString("en-IN")}</span>
  </div>

  <div class="summary-box">
    <div class="stat"><div class="stat-num">${notes.length}</div><div class="stat-lbl">Total Records</div></div>
    <div class="stat"><div class="stat-num">${notes.filter(n=>n.isCriticalEvent).length}</div><div class="stat-lbl">Critical Events</div></div>
    <div class="stat"><div class="stat-num">${Object.keys(grouped).length}</div><div class="stat-lbl">Days Covered</div></div>
    <div class="stat"><div class="stat-num">${[...new Set(notes.map(n=>n.nurseName).filter(Boolean))].length}</div><div class="stat-lbl">Nurses Involved</div></div>
  </div>

  ${Object.entries(grouped).sort(([a],[b])=>a<b?1:-1).map(([day, dayNotes]) => `
    <div class="day-heading">
      ${new Date(day).toLocaleDateString("en-IN",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}
      <span style="font-weight:400;font-size:11px;color:#64748b"> — ${dayNotes.length} record(s)</span>
    </div>
    ${dayNotes.map((note, i) => {
      const mData = note.moduleData || {};
      const mod = MODULE_LABELS[note.noteType] || note.noteType || "General Observation";
      const isCrit = note.isCriticalEvent;
      const dt = new Date(note.noteDate || note.createdAt);
      const moduleHtml = Object.entries(mData).filter(([,v])=>v).map(([k,v]) => {
        const lbl = MODULE_LABELS[k] || k;
        const entries = typeof v === "object" && !Array.isArray(v)
          ? Object.entries(v).filter(([,val])=>val!==null&&val!==undefined&&val!=="").map(([fk,fv])=>`<b>${fk.replace(/([A-Z])/g," $1").trim()}:</b> ${Array.isArray(fv)?fv.join(", "):typeof fv==="boolean"?fv?"Yes":"No":String(fv)}`).join("  |  ")
          : String(v);
        return entries ? `<div class="module-label">${lbl}</div><div class="module-data">${entries}</div>` : "";
      }).join("");
      return `
        <div class="note-card${isCrit?" critical":""}">
          <div class="note-header">
            <div class="note-type">${mod}${isCrit?'<span class="crit-badge">⚠ CRITICAL</span>':""}</div>
            <div class="note-meta">${dt.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})} | Shift: ${note.shift||"—"}</div>
          </div>
          ${moduleHtml}
          ${note.vitals&&Object.values(note.vitals).some(Boolean)?`<div class="module-label">Vital Signs</div><div class="module-data">${Object.entries(note.vitals).filter(([,v])=>v).map(([k,v])=>`<b>${k}:</b> ${v}`).join("  |  ")}</div>`:""}
          ${note.remarks?`<div class="remarks"><b>Remarks:</b> ${note.remarks}</div>`:""}
          <div class="signoff">
            <span>Recorded by: <b>${note.nurseName||"—"}</b>${note.nurseEmployeeId?` (${note.nurseEmployeeId})`:""}${note.nurseDesignation?`, ${note.nurseDesignation}`:""}</span>
            ${note.nurseSignature||note.signature?`<img class="sig-img" src="${note.nurseSignature||note.signature}" alt="Signature"/>`:
            `<span style="font-style:italic;color:#94a3b8">No signature</span>`}
          </div>
        </div>`;
    }).join("")}
  `).join("")}

  <div class="footer">
    This document was generated from ${settings.hospitalName || "Hospital"} on ${new Date().toLocaleString("en-IN")} &nbsp;|&nbsp;
    IPD No: ${ipdNo} &nbsp;|&nbsp; Total Records: ${notes.length} &nbsp;|&nbsp;
    NABH Compliant Nursing Record
  </div>
</body>
</html>`;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  };

  const C = {
    bg: "#f8fafc", card: "#fff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
    primary: "#0f766e", primaryL: "#f0fdfa", green: "#16a34a", red: "#dc2626",
    amber: "#d97706", amberL: "#fffbeb",
  };

  const shiftColors = { morning: "#d97706", afternoon: "#7c3aed", evening: "#1d4ed8", night: "#334155" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.7)", backdropFilter:"blur(4px)", zIndex:2000, display:"flex", flexDirection:"column" }}>
      {/* Toolbar */}
      <div style={{ background:"#0f172a", padding:"12px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:"#0f766e", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <i className="pi pi-file-pdf" style={{ color:"#fff", fontSize:16 }} />
          </div>
          <div>
            <div style={{ color:"#fff", fontWeight:800, fontSize:15 }}>Nursing Patient Record</div>
            <div style={{ color:"rgba(255,255,255,.55)", fontSize:11 }}>
              {patientName || "Patient"} &nbsp;|&nbsp; UHID: {patientUHID || "—"} &nbsp;|&nbsp; IPD: {ipdNo}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {/* Filter */}
          <select value={filter} onChange={e=>setFilter(e.target.value)}
            style={{ padding:"6px 10px", borderRadius:6, border:"1.5px solid #334155", background:"#1e293b", color:"#fff", fontSize:11, fontWeight:600, cursor:"pointer" }}>
            <option value="all">All Records</option>
            <option value="vitals">Vitals</option>
            <option value="neuro">Neuro/GCS</option>
            <option value="pain">Pain</option>
            <option value="wound">Wound Care</option>
            <option value="fall">Fall Risk</option>
            <option value="daily">Daily Assessment</option>
            <option value="general">General Obs</option>
            <option value="morning">Morning Shift</option>
            <option value="afternoon">Afternoon Shift</option>
            <option value="evening">Evening Shift</option>
            <option value="night">Night Shift</option>
          </select>
          <button onClick={handlePrint}
            style={{ padding:"8px 18px", borderRadius:8, border:"none", background:"#0f766e", color:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}>
            <i className="pi pi-print" style={{ fontSize:13 }} /> Print / Save PDF
          </button>
          <button onClick={onClose}
            style={{ padding:"8px 14px", borderRadius:8, border:"1.5px solid #334155", background:"transparent", color:"#94a3b8", fontWeight:700, fontSize:12, cursor:"pointer" }}>
            &times; Close
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ background:"#1e293b", padding:"10px 20px", display:"flex", gap:24, flexShrink:0 }}>
        {[
          { label:"Total Records", val: notes.length, color:"#0d9488" },
          { label:"Critical Events", val: notes.filter(n=>n.isCriticalEvent).length, color:"#dc2626" },
          { label:"Days Covered",   val: Object.keys(grouped).length, color:"#7c3aed" },
          { label:"Nurses",         val: [...new Set(notes.map(n=>n.nurseName).filter(Boolean))].length, color:"#1d4ed8" },
        ].map(s=>(
          <div key={s.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:20, fontWeight:900, color:s.color }}>{s.val}</span>
            <span style={{ fontSize:11, color:"#94a3b8" }}>{s.label}</span>
          </div>
        ))}
        <div style={{ marginLeft:"auto", fontSize:11, color:"#64748b", display:"flex", alignItems:"center", gap:6 }}>
          <i className="pi pi-info-circle" style={{ fontSize:11 }} />
          Click "Print / Save PDF" → browser print dialog → Save as PDF
        </div>
      </div>

      {/* Report body */}
      <div ref={printRef} style={{ flex:1, overflowY:"auto", background:"#f1f5f9", padding:20 }}>
        {loading ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, color:C.muted, gap:12 }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize:24, color:C.primary }} />
            <span>Loading nursing records…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:300, color:C.muted }}>
            <i className="pi pi-inbox" style={{ fontSize:40, opacity:.3, marginBottom:12 }} />
            <div style={{ fontSize:14, fontWeight:600 }}>No nursing records found</div>
            <div style={{ fontSize:12, marginTop:6 }}>Records will appear here after nurses save notes for this patient</div>
          </div>
        ) : (
          <div style={{ maxWidth:860, margin:"0 auto" }}>
            {/* Patient header card */}
            <div style={{ background:"#fff", border:"1.5px solid #e2e8f0", borderRadius:12, padding:"16px 20px", marginBottom:20, boxShadow:"0 2px 8px rgba(0,0,0,.06)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:800, color:C.text }}>{patientName || "—"}</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
                    UHID: {patientUHID || "—"} &nbsp;·&nbsp; IPD: {ipdNo}
                    {patientInfo?.age && ` · Age: ${patientInfo.age}`}
                    {patientInfo?.gender && ` · ${patientInfo.gender}`}
                    {patientInfo?.ward && ` · Ward/Bed: ${patientInfo.ward}`}
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:11, color:C.muted }}>Report generated</div>
                  <div style={{ fontSize:12, fontWeight:700, color:C.primary }}>{new Date().toLocaleString("en-IN")}</div>
                </div>
              </div>
            </div>

            {/* Notes grouped by day */}
            {Object.entries(grouped).sort(([a],[b])=>a<b?1:-1).map(([day, dayNotes]) => (
              <div key={day}>
                <div style={{ background:C.primary, color:"#fff", borderRadius:8, padding:"8px 14px", marginBottom:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontWeight:800, fontSize:13 }}>
                    {new Date(day).toLocaleDateString("en-IN",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}
                  </span>
                  <span style={{ fontSize:11, opacity:.8 }}>{dayNotes.length} record(s)</span>
                </div>
                {dayNotes.map((note, i) => {
                  const mData = note.moduleData || {};
                  const mod = MODULE_LABELS[note.noteType] || note.noteType || "General Observation";
                  const isCrit = note.isCriticalEvent;
                  const dt = new Date(note.noteDate || note.createdAt);
                  const shiftC = shiftColors[note.shift] || C.muted;
                  return (
                    <div key={note._id || i} style={{
                      background:"#fff", border:`1.5px solid ${isCrit?"#fca5a5":C.border}`,
                      borderLeft:`4px solid ${isCrit?"#dc2626":shiftC}`,
                      borderRadius:8, padding:"12px 16px", marginBottom:10,
                      boxShadow:"0 1px 4px rgba(0,0,0,.05)",
                    }}>
                      {/* Card header */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontWeight:800, fontSize:13, color:C.text }}>{mod}</span>
                          {isCrit && <span style={{ background:"#fca5a5", color:"#991b1b", fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:4 }}>⚠ CRITICAL</span>}
                          {note.tags?.map(t=>(
                            <span key={t} style={{ background:C.primaryL, color:C.primary, fontSize:10, fontWeight:600, padding:"1px 6px", borderRadius:4 }}>{t}</span>
                          ))}
                        </div>
                        <div style={{ textAlign:"right", fontSize:11, color:C.muted }}>
                          <div>{dt.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
                          <div style={{ color:shiftC, fontWeight:700, textTransform:"capitalize" }}>{note.shift} shift</div>
                        </div>
                      </div>

                      {/* Module data */}
                      {Object.entries(mData).filter(([,v])=>v).map(([k,v]) => (
                        <ModuleBlock key={k} label={MODULE_LABELS[k] || k} data={v} />
                      ))}

                      {/* Legacy direct fields */}
                      {note.vitals && Object.values(note.vitals).some(Boolean) && (
                        <ModuleBlock label="Vital Signs" data={note.vitals} />
                      )}
                      {note.intakeOutput && Object.values(note.intakeOutput).some(v=>v>0) && (
                        <ModuleBlock label="Intake / Output" data={note.intakeOutput} />
                      )}
                      {note.generalCondition && Object.values(note.generalCondition).some(Boolean) && (
                        <ModuleBlock label="General Condition" data={note.generalCondition} />
                      )}
                      {note.remarks && (
                        <div style={{ marginTop:6, fontSize:11, color:C.text }}>
                          <b>Remarks: </b>{note.remarks}
                        </div>
                      )}

                      {/* Nurse sign-off */}
                      <div style={{ marginTop:10, paddingTop:7, borderTop:"1px dashed #e2e8f0",
                        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ fontSize:11, color:C.muted }}>
                          <i className="pi pi-user" style={{ fontSize:10, marginRight:4 }} />
                          <b>{note.nurseName || "—"}</b>
                          {note.nurseEmployeeId && <span style={{ color:C.primary }}> ({note.nurseEmployeeId})</span>}
                          {note.nurseDesignation && <span>, {note.nurseDesignation}</span>}
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          {note.nurseSignature && (
                            <img src={note.nurseSignature} alt="sig"
                              style={{ height:32, maxWidth:90, border:"1px solid #e2e8f0", borderRadius:4, background:"#fff", padding:2 }} />
                          )}
                          {note.signature && (
                            <img src={note.signature} alt="sig"
                              style={{ height:32, maxWidth:90, border:"1px solid #e2e8f0", borderRadius:4, background:"#fff", padding:2 }} />
                          )}
                          {!note.nurseSignature && !note.signature && (
                            <span style={{ fontSize:10, color:"#94a3b8", fontStyle:"italic" }}>No digital signature</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Footer */}
            <div style={{ textAlign:"center", fontSize:11, color:C.muted, marginTop:20, paddingTop:14, borderTop:"1px solid #e2e8f0" }}>
              <i className="pi pi-shield" style={{ marginRight:6, color:C.primary }} />
              NABH Compliant Nursing Record &nbsp;·&nbsp; Generated: {new Date().toLocaleString("en-IN")} &nbsp;·&nbsp; Total: {notes.length} records
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
