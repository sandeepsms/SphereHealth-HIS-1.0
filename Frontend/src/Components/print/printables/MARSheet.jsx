// Components/print/printables/MARSheet.jsx
// Standalone Medication Administration Record — a single day or
// shift's MAR with administration time slots, dose given, signed-by.
// Used at bedside / handover; A4 landscape-feel but rendered portrait.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

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

  // R7bf-F / A4-HIGH-2: when the MAR window is > 1 day (multi-day
  // tile), pre-R7bf rendering dropped the nurse-signature mini-cell
  // under each slot because each slot key was treated as a single
  // admin event. Now we explicitly render the nurse initials inside
  // the same cell AND we add a dedicated trailing "Nurse Signature"
  // column on every row so the auditor has a per-row attestation
  // anchor regardless of slot density.
  const isMultiDay = !!r.multiDay || (Array.isArray(r.dates) && r.dates.length > 1);
  const printCount = toNum(r.printCount);

  // R7eo-C — Pattern C patient-safety fix (NABH AAC.4/COP.6)
  // Allergy banner — IV compat / bedside MAR critical.
  const allergiesText = Array.isArray(r.allergies)
    ? r.allergies.filter(Boolean).join(", ")
    : String(r.allergies || "").trim();
  const hasAllergies = !!allergiesText;

  // R7eo-C — tfoot totals: count Given / Refused / Missed / Held
  // across all medication rows and slots.
  const totals = { Given: 0, Refused: 0, Missed: 0, Held: 0 };
  meds.forEach((m) => {
    const adm = m.administrations || {};
    slots.forEach((s) => {
      const a = adm[s];
      if (!a || !a.status) return;
      const st = String(a.status);
      if (st === "Given") totals.Given += 1;
      else if (st === "Refused") totals.Refused += 1;
      else if (st === "Hold") totals.Held += 1;
      else if (st === "Skipped" || st === "Missed" || st === "Not Available") totals.Missed += 1;
    });
  });

  return (
    <PrintShell
      settings={settings}
      documentTitle={`Medication Administration Record (MAR)${isMultiDay ? " — multi-day" : ""}`}
      serialNo={r.marNo || r.ipdNo}
      printCount={printCount}
      infoItems={[
        { label: "Patient",     value: r.patientName },
        { label: "UHID",        value: r.uhid },
        { label: "IPD No",      value: r.ipdNo },
        { label: "Age / Sex",   value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Bed / Ward",  value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") || "—" },
        { label: "Blood Group", value: r.bloodGroup || "—" },
        { label: "Date",        value: fmtDate(r.date || new Date()) },
        { label: "Shift",       value: r.shift },
        { label: "Window",      value: isMultiDay ? `${r.dates?.length || "?"} days` : "1 day" },
      ]}
      signatureLabels={["Nurse-in-charge", "Doctor on Round"]}
    >
      {/* R7eo-C — Pattern C patient-safety fix (NABH AAC.4/COP.6)
          Bedside MAR allergy banner — IV compatibility critical. */}
      {hasAllergies ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "#fee2e2", border: "1.5px solid #dc2626",
          borderLeft: "5px solid #b91c1c",
          padding: "8px 12px", borderRadius: 6,
          marginBottom: 12,
          color: "#7f1d1d",
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <div>
            <div style={{
              fontSize: 9.5, fontWeight: 800,
              textTransform: "uppercase", letterSpacing: ".5px",
              color: "#7f1d1d",
            }}>
              Allergies
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "#7f1d1d" }}>
              {allergiesText}
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "#dcfce7", border: "1px solid #15803d",
          padding: "3px 10px", borderRadius: 999,
          marginBottom: 12,
          fontSize: 9.5, fontWeight: 800,
          color: "#14532d", textTransform: "uppercase", letterSpacing: ".4px",
        }}>
          <span style={{ fontSize: 11 }}>✓</span> NKDA — No Known Drug Allergies
        </div>
      )}
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
            {/* R7bf-F / A4-HIGH-2: dedicated nurse-signature column.
                Even on multi-day prints (where per-slot rows can get
                cramped) the auditor has a clear per-med signature
                anchor at the right edge. */}
            <th className="center" style={{ width: 80 }}>Nurse Signature</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {meds.length === 0 ? (
            <tr><td colSpan={6 + slots.length} className="muted center" style={{ padding: 20 }}>
              No medications on the MAR for this period.
            </td></tr>
          ) : meds.map((m, i) => {
            const adm = m.administrations || {};
            // Last-touched nurse across all slots for this med — used
            // for the dedicated signature column when the window
            // spans multiple days (most-recent admin attestation).
            const allNurses = Array.from(new Set(
              Object.values(adm).map((a) => a?.nurse).filter(Boolean),
            ));
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
                {/* R7bf-F / A4-HIGH-2: dedicated signature cell.
                    Renders comma-joined nurses or a blank line for
                    on-paper sign-off when no admin has fired yet. */}
                <td className="center" style={{ fontSize: 9.5, color: "#475569" }}>
                  {allNurses.length > 0
                    ? allNurses.join(", ")
                    : <span style={{ color: "#cbd5e1", borderBottom: "1px solid #94a3b8", display: "inline-block", minWidth: 50 }}>&nbsp;</span>}
                </td>
                <td style={{ fontSize: 10 }}>{m.notes || ""}</td>
              </tr>
            );
          })}
        </tbody>
        {/* R7eo-C — Pattern C patient-safety fix (NABH AAC.4/COP.6):
            tfoot totals row — counts Given / Refused / Missed / Held
            across the time slots so the auditor sees admin coverage
            at a glance. */}
        {meds.length > 0 && (
          <tfoot>
            <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
              <td colSpan={4} style={{ textAlign: "right", padding: "6px 8px" }}>
                Totals (across all slots):
              </td>
              <td colSpan={slots.length + 2} style={{ padding: "6px 8px" }}>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 10.5 }}>
                  <span style={{ color: "#15803d" }}>Given: <strong>{totals.Given}</strong></span>
                  <span style={{ color: "#dc2626" }}>Refused: <strong>{totals.Refused}</strong></span>
                  <span style={{ color: "#7c3aed" }}>Missed: <strong>{totals.Missed}</strong></span>
                  <span style={{ color: "#475569" }}>Held: <strong>{totals.Held}</strong></span>
                </div>
              </td>
            </tr>
          </tfoot>
        )}
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
