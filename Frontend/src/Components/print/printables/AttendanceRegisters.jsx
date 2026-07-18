// Components/print/printables/AttendanceRegisters.jsx
// R7hr(ER-P3/DC-P3) — statutory attendance registers, printable form.
// ErRegister: chronological ER attendance log (NABH ER register).
// DcRegister: NABH Day Care register (DayCareRegister rows the daycare
// workflow emits). Both take { from, to, rows } from the /reports
// endpoints and print landscape tables on the canonical letterhead.
import React from "react";
import PrintShell from "../PrintShell";

const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDT = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const Range = ({ from, to, count }) => (
  <div style={{ fontSize: 11, color: "#475569", margin: "2px 0 8px" }}>
    Period: <b>{fmtD(from)}</b> – <b>{fmtD(to)}</b> · {count} entr{count === 1 ? "y" : "ies"}
  </div>
);

export const ErRegister = ({ settings = {}, receipt = {} }) => {
  const rows = receipt.rows || [];
  return (
    <PrintShell settings={settings} documentTitle="Emergency Attendance Register"
      signatureLabels={["ER In-charge", "Medical Superintendent"]}>
      <Range from={receipt.from} to={receipt.to} count={rows.length} />
      <table className="pr-table" style={{ fontSize: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 24 }}>#</th><th>ER No</th><th>Arrival</th><th>Mode</th>
            <th>Patient</th><th style={{ width: 52 }}>Age/Sex</th><th>Triage</th>
            <th>Presenting Complaint</th><th>Doctor</th><th>MLC</th><th>Disposition</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={11} className="muted center" style={{ padding: 16, fontStyle: "italic" }}>No ER attendances in this period.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td style={{ fontFamily: "'DM Mono', monospace" }}>{r.erNumber || r.emergencyNumber || "—"}</td>
              <td>{fmtDT(r.arrivalAt)}</td>
              <td>{r.modeOfArrival || "—"}</td>
              <td><strong>{r.patientName || "—"}</strong><div className="muted" style={{ fontSize: 9 }}>{r.UHID}</div></td>
              <td>{[r.age && `${r.age}Y`, (r.sex || "").charAt(0)].filter(Boolean).join("/") || "—"}</td>
              <td>{r.triageCategory || "—"}</td>
              <td>{r.presentingComplaint || "—"}</td>
              <td>{r.consultantIncharge || "—"}</td>
              <td>{r.isMLC ? (r.mlcNumber || "Yes") : "No"}</td>
              <td>
                {r.disposition || "In ER"}
                {r.dispositionAt && <div className="muted" style={{ fontSize: 9 }}>{fmtDT(r.dispositionAt)}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintShell>
  );
};

export const DcRegister = ({ settings = {}, receipt = {} }) => {
  const rows = receipt.rows || [];
  return (
    <PrintShell settings={settings} documentTitle="Day Care Register"
      signatureLabels={["Day Care In-charge", "Medical Superintendent"]}>
      <Range from={receipt.from} to={receipt.to} count={rows.length} />
      <table className="pr-table" style={{ fontSize: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 24 }}>#</th><th>DCR No</th><th>Patient</th><th style={{ width: 52 }}>Age/Sex</th>
            <th>Adm No</th><th>Procedure</th><th>Doctor</th><th>In</th><th>Out</th>
            <th>Checklist</th><th>Score</th><th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={12} className="muted center" style={{ padding: 16, fontStyle: "italic" }}>No day-care cases in this period.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td style={{ fontFamily: "'DM Mono', monospace" }}>{r.dcNumber || "—"}</td>
              <td><strong>{r.patientName || "—"}</strong><div className="muted" style={{ fontSize: 9 }}>{r.UHID}</div></td>
              <td>{[r.age && `${r.age}Y`, (r.sex || "").charAt(0)].filter(Boolean).join("/") || "—"}</td>
              <td>{r.admissionNumber || "—"}</td>
              <td>{r.procedure || "—"}</td>
              <td>{r.doctor || "—"}</td>
              <td>{fmtDT(r.admittedAt)}</td>
              <td>{fmtDT(r.dischargedAt)}</td>
              <td>{r.checklistComplete ? "✓" : "✗"}</td>
              <td>{r.readinessScore != null ? `${r.readinessScore}/10` : "—"}</td>
              <td>{r.outcome || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintShell>
  );
};
