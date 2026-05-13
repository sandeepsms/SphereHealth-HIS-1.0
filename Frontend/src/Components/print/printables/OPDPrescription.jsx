// Components/print/printables/OPDPrescription.jsx
// OPD doctor's prescription pad — vitals, chief complaints, diagnosis,
// the Rx drug list with frequency / duration / instructions, plus
// advice / lab orders / follow-up. A4 portrait by default.

import React from "react";
import PrintShell from "../PrintShell";

const VitalCell = ({ label, value, unit }) => (
  <div style={{
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 11,
    flex: 1,
    minWidth: 90,
  }}>
    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", fontWeight: 700, letterSpacing: ".5px" }}>
      {label}
    </div>
    <div style={{ fontWeight: 800, color: "#0f172a" }}>
      {value || "—"}{value && unit ? <span style={{ fontSize: 10, color: "#64748b", fontWeight: 500 }}> {unit}</span> : null}
    </div>
  </div>
);

const OPDPrescription = ({ settings, receipt = {} }) => {
  const vitals = receipt.vitals || {};
  const drugs  = Array.isArray(receipt.drugs)        ? receipt.drugs        : [];
  const labs   = Array.isArray(receipt.investigations) ? receipt.investigations : [];
  const advice = Array.isArray(receipt.advice)
    ? receipt.advice
    : (receipt.advice ? String(receipt.advice).split("\n").filter(Boolean) : []);

  return (
    <PrintShell
      settings={settings}
      documentTitle="OPD Prescription · Rx"
      serialNo={receipt.rxNo || receipt.visitNo}
      infoItems={[
        { label: "Patient",    value: receipt.patientName },
        { label: "UHID",       value: receipt.uhid },
        { label: "Age / Sex",  value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Mobile",     value: receipt.mobile },
        { label: "Doctor",     value: receipt.doctorName },
        { label: "Reg. No",    value: receipt.doctorReg },
        { label: "Department", value: receipt.department },
        { label: "Visit Date", value: receipt.visitDate
            ? new Date(receipt.visitDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
      ]}
      signatureLabels={["Doctor's Signature & Stamp", "Patient / Attendant"]}
    >
      {/* ── Vitals strip ── */}
      {(vitals.bp || vitals.pulse || vitals.temp || vitals.spo2 || vitals.weight || vitals.height) && (
        <div className="pr-section">
          <div className="pr-section__title">Vitals on Examination</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <VitalCell label="BP"      value={vitals.bp}      unit="mmHg" />
            <VitalCell label="Pulse"   value={vitals.pulse}   unit="bpm"  />
            <VitalCell label="Temp"    value={vitals.temp}    unit="°F"   />
            <VitalCell label="SpO₂"    value={vitals.spo2}    unit="%"    />
            <VitalCell label="RR"      value={vitals.rr}      unit="/min" />
            <VitalCell label="Weight"  value={vitals.weight}  unit="kg"   />
            <VitalCell label="Height"  value={vitals.height}  unit="cm"   />
            <VitalCell label="BMI"     value={vitals.bmi}                 />
          </div>
        </div>
      )}

      {/* ── Complaints + history ── */}
      {(receipt.chiefComplaints || receipt.history) && (
        <div className="pr-section">
          <div className="pr-section__title">Chief Complaints &amp; History</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap" }}>
            {receipt.chiefComplaints || ""}
            {receipt.history && (
              <>
                {"\n"}
                <strong>History: </strong>{receipt.history}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Diagnosis ── */}
      {(receipt.provisionalDx || receipt.diagnosis || receipt.icd10) && (
        <div className="pr-section">
          <div className="pr-section__title">Diagnosis</div>
          <div className="pr-section__body">
            {receipt.provisionalDx && (
              <div><strong>Provisional:</strong> {receipt.provisionalDx}</div>
            )}
            {receipt.diagnosis && (
              <div><strong>Diagnosis:</strong> {receipt.diagnosis}</div>
            )}
            {receipt.icd10 && (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                ICD-10: <strong style={{ color: "#0f172a" }}>{receipt.icd10}</strong>
                {receipt.icd10Desc && <> — {receipt.icd10Desc}</>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Rx block (the actual prescription) ── */}
      <div className="pr-section" style={{ marginTop: 14 }}>
        <div className="pr-section__title" style={{
          display: "flex", alignItems: "center", gap: 8, fontSize: 13,
        }}>
          <span style={{
            background: "var(--pr-accent-color, #1d4ed8)", color: "white",
            width: 26, height: 26, borderRadius: 6,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 800, fontStyle: "italic",
          }}>R<small style={{ fontSize: 10, marginLeft: -3 }}>x</small></span>
          Prescription
        </div>
        <table className="pr-table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Medication</th>
              <th style={{ width: 100 }}>Dose / Form</th>
              <th className="center" style={{ width: 110 }}>Frequency</th>
              <th className="center" style={{ width: 90 }}>Duration</th>
              <th style={{ width: 180 }}>Instructions</th>
            </tr>
          </thead>
          <tbody>
            {drugs.length === 0 ? (
              <tr><td colSpan={6} className="muted center" style={{ padding: 20, fontStyle: "italic" }}>
                No medications prescribed.
              </td></tr>
            ) : drugs.map((d, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 700 }}>{d.name || d.drug || "—"}</div>
                  {d.generic && <div className="muted" style={{ fontSize: 10 }}>({d.generic})</div>}
                </td>
                <td>{d.dose || d.strength || "—"}</td>
                <td className="center">{d.frequency || d.freq || "—"}</td>
                <td className="center">{d.duration || "—"}</td>
                <td>{d.instructions || d.notes || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Investigations / labs ── */}
      {labs.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Investigations / Tests Advised</div>
          <ol style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 11.5 }}>
            {labs.map((l, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                <strong>{l.name || l.test || l}</strong>
                {l.urgent && <span style={{ color: "#dc2626", fontWeight: 700, marginLeft: 6 }}>(URGENT)</span>}
                {l.notes && <span className="muted"> — {l.notes}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Advice ── */}
      {advice.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">General Advice</div>
          <ul style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 11.5 }}>
            {advice.map((a, i) => <li key={i} style={{ marginBottom: 2 }}>{a}</li>)}
          </ul>
        </div>
      )}

      {/* ── Follow-up ── */}
      {(receipt.followUpDate || receipt.followUpNotes) && (
        <div className="pr-section">
          <div className="pr-section__title">Follow-up</div>
          <div className="pr-section__body">
            {receipt.followUpDate && (
              <div><strong>Next visit:</strong> {new Date(receipt.followUpDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "long" })}</div>
            )}
            {receipt.followUpNotes && <div>{receipt.followUpNotes}</div>}
          </div>
        </div>
      )}
    </PrintShell>
  );
};

export default OPDPrescription;
