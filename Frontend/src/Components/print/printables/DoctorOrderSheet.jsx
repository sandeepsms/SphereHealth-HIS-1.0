// Components/print/printables/DoctorOrderSheet.jsx
// Daily doctor's order slip — what the consultant wrote during round.
// Includes medication orders, investigation orders, diet, restrictions,
// and any verbal/standing orders that the nurse must acknowledge.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const DoctorOrderSheet = ({ settings, receipt = {} }) => {
  const r = receipt;
  const orders     = Array.isArray(r.orders)     ? r.orders     : [];
  const investigations = Array.isArray(r.investigations) ? r.investigations : [];

  return (
    <PrintShell
      settings={settings}
      documentTitle="Doctor's Order Sheet"
      serialNo={r.orderNo || r.ipdNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Patient",      value: r.patientName },
        { label: "UHID",         value: r.uhid },
        { label: "IPD No",       value: r.ipdNo },
        { label: "Age / Sex",    value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Bed / Ward",   value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Round Date",   value: fmtDateTime(r.roundAt || new Date()) },
        { label: "Consultant",   value: r.consultantName },
        { label: "Allergies",    value: Array.isArray(r.allergies) ? r.allergies.join(", ") : r.allergies },
      ]}
      signatureLabels={["Consultant", "Nurse — Acknowledged"]}
    >
      {r.clinicalSummary && (
        <div className="pr-section">
          <div className="pr-section__title">Round Summary</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap" }}>{r.clinicalSummary}</div>
        </div>
      )}

      {/* Medications */}
      <div className="pr-section">
        <div className="pr-section__title">Medication Orders</div>
        <table className="pr-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Drug</th>
              <th style={{ width: 80 }}>Dose</th>
              <th style={{ width: 70 }}>Route</th>
              <th style={{ width: 100 }}>Frequency</th>
              <th style={{ width: 80 }}>Duration</th>
              <th className="center" style={{ width: 50 }}>STAT</th>
              <th>Indication / Notes</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={8} className="muted center" style={{ padding: 16 }}>No medication orders today.</td></tr>
            ) : orders.map((o, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><strong>{o.drug || o.name}</strong>
                  {o.generic && <div className="muted" style={{ fontSize: 9.5 }}>({o.generic})</div>}
                </td>
                <td>{o.dose || "—"}</td>
                <td>{o.route || "PO"}</td>
                <td>{o.frequency || o.freq || "—"}</td>
                <td>{o.duration || "—"}</td>
                <td className="center">
                  {o.stat ? <strong style={{ color: "#dc2626" }}>STAT</strong> : <span className="muted">—</span>}
                </td>
                <td style={{ fontSize: 10.5 }}>{o.indication || o.notes || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Investigations / labs */}
      {investigations.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Investigations Ordered</div>
          <ol style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 11.5 }}>
            {investigations.map((inv, i) => (
              <li key={i} style={{ marginBottom: 3 }}>
                <strong>{inv.name || inv.test || inv}</strong>
                {inv.urgent && <span style={{ color: "#dc2626", fontWeight: 700, marginLeft: 6 }}>(URGENT)</span>}
                {inv.notes && <span className="muted"> — {inv.notes}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Diet + restrictions */}
      {(r.diet || r.restrictions || r.standingOrders) && (
        <div className="pr-section">
          <div className="pr-section__title">Diet, Restrictions & Standing Orders</div>
          <div className="pr-section__body">
            {r.diet         && <div><strong>Diet:</strong> {r.diet}</div>}
            {r.restrictions && <div><strong>Restrictions:</strong> {r.restrictions}</div>}
            {r.standingOrders && (
              <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                <strong>Standing orders:</strong>{"\n"}{r.standingOrders}
              </div>
            )}
            {r.dvtProphylaxis && <div><strong>DVT prophylaxis:</strong> {r.dvtProphylaxis}</div>}
            {r.vitalsFrequency && <div><strong>Vitals q:</strong> {r.vitalsFrequency}</div>}
            {r.iOMonitor && <div><strong>Input / Output:</strong> {r.iOMonitor}</div>}
          </div>
        </div>
      )}

      {r.specialNote && (
        <div className="pr-section">
          <div className="pr-section__title">Special Note for Nursing</div>
          <div className="pr-section__body" style={{
            background: "#fef9c3", border: "1.5px dashed #facc15",
            borderRadius: 6, padding: "8px 12px",
            whiteSpace: "pre-wrap", color: "#713f12", fontWeight: 600,
          }}>
            {r.specialNote}
          </div>
        </div>
      )}
    </PrintShell>
  );
};

export default DoctorOrderSheet;
