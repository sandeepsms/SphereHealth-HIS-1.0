// Components/print/printables/MARSheet.jsx
// Standalone Medication Administration Record — a single day or
// shift's MAR with administration time slots, dose given, signed-by.
// Used at bedside / handover; A4 landscape-feel but rendered portrait.

import React from "react";
import PrintShell from "../PrintShell";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_CHAR = {
  Given:        { ch: "✓", color: "#15803d" },
  Refused:      { ch: "R", color: "#dc2626" },
  "Not Available": { ch: "NA", color: "#92400e" },
  Hold:         { ch: "H", color: "#475569" },
  Skipped:      { ch: "S", color: "#7c3aed" },
};

const MARSheet = ({ settings, receipt = {} }) => {
  const r = receipt;
  const meds = Array.isArray(r.medications) ? r.medications : [];
  const slots = Array.isArray(r.timeSlots) ? r.timeSlots
              : ["06:00", "10:00", "14:00", "18:00", "22:00"];

  return (
    <PrintShell
      settings={settings}
      documentTitle="Medication Administration Record (MAR)"
      serialNo={r.marNo || r.ipdNo}
      infoItems={[
        { label: "Patient",     value: r.patientName },
        { label: "UHID",        value: r.uhid },
        { label: "IPD No",      value: r.ipdNo },
        { label: "Age / Sex",   value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Bed / Ward",  value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Date",        value: fmtDate(r.date || new Date()) },
        { label: "Shift",       value: r.shift },
        { label: "Allergies",   value: Array.isArray(r.allergies) ? r.allergies.join(", ") : r.allergies },
      ]}
      signatureLabels={["Nurse-in-charge", "Doctor on Round"]}
    >
      <table className="pr-table" style={{ fontSize: 10.5 }}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Drug · Dose · Route · Freq</th>
            <th className="center" style={{ width: 70 }}>Start</th>
            <th className="center" style={{ width: 70 }}>Stop</th>
            {slots.map((s) => (
              <th key={s} className="center" style={{ width: 50 }}>{s}</th>
            ))}
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {meds.length === 0 ? (
            <tr><td colSpan={5 + slots.length} className="muted center" style={{ padding: 20 }}>
              No medications on the MAR for this period.
            </td></tr>
          ) : meds.map((m, i) => {
            const adm = m.administrations || {};
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <strong>{m.drug || m.name}</strong>
                  {m.generic && <span className="muted" style={{ fontSize: 9.5 }}> ({m.generic})</span>}
                  <div className="muted" style={{ fontSize: 9.5 }}>
                    {m.dose || "—"} · {m.route || "PO"} · {m.frequency || m.freq || "—"}
                    {m.indication && <> · {m.indication}</>}
                  </div>
                </td>
                <td className="center" style={{ fontSize: 10 }}>{fmtDate(m.startDate)}</td>
                <td className="center" style={{ fontSize: 10 }}>{fmtDate(m.endDate)}</td>
                {slots.map((s) => {
                  const a = adm[s];
                  const meta = STATUS_CHAR[a?.status] || null;
                  return (
                    <td key={s} className="center" style={{ fontSize: 10 }}>
                      {meta ? (
                        <div>
                          <div style={{ fontWeight: 800, color: meta.color, fontSize: 14, lineHeight: 1 }}>
                            {meta.ch}
                          </div>
                          {a.nurse && <div className="muted" style={{ fontSize: 8.5 }}>{a.nurse}</div>}
                        </div>
                      ) : (
                        <div style={{ color: "#cbd5e1" }}>—</div>
                      )}
                    </td>
                  );
                })}
                <td style={{ fontSize: 10 }}>{m.notes || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="pr-section">
        <div className="pr-section__title">Legend</div>
        <div className="bm-chip-row" style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 10.5 }}>
          {Object.entries(STATUS_CHAR).map(([k, v]) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{
                width: 22, height: 22, borderRadius: 5,
                background: v.color + "15", color: v.color,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, border: `1px solid ${v.color}`,
              }}>{v.ch}</span>
              <span>{k}</span>
            </span>
          ))}
        </div>
      </div>
    </PrintShell>
  );
};

export default MARSheet;
