// Components/print/printables/AreaCleaningChecklist.jsx
// Shift / daily area-cleaning checklist — generic checklist with
// free-form items[] (each: { item, frequency, status, remarks,
// signedBy }). Used for ward / OPD / OT / lab daily routines.
// Maps to NABH HIC.6 + FMS.4 environmental hygiene routines.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", {
  day: "2-digit", month: "short", year: "numeric",
}) : "—";

const STATUS_ICON = {
  done:        { ch: "✓", color: "#15803d", bg: "#dcfce7" },
  pending:     { ch: "⌛", color: "#a16207", bg: "#fef3c7" },
  "not-applicable": { ch: "NA", color: "#475569", bg: "#e2e8f0" },
  skipped:     { ch: "×", color: "#dc2626", bg: "#fee2e2" },
};

const AreaCleaningChecklist = ({ settings, receipt = {} }) => {
  const r = receipt;
  const items = Array.isArray(r.items) ? r.items : [];

  return (
    <PrintShell
      settings={settings}
      documentTitle={r.checklistTitle || "Area Cleaning Checklist"}
      serialNo={r.checklistNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Area",        value: r.area },
        { label: "Date",        value: fmtDate(r.date || new Date()) },
        { label: "Shift",       value: r.shift },
        { label: "Frequency",   value: r.frequency || "Daily" },
        { label: "Supervisor",  value: r.supervisor },
        { label: "Cleaner(s)",  value: Array.isArray(r.cleaners) ? r.cleaners.join(", ") : r.cleaners },
      ]}
      showBank={false}
      signatureLabels={["Housekeeper", "Supervisor"]}
    >
      <table className="pr-table" style={{ fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Cleaning Check</th>
            <th className="center" style={{ width: 80 }}>Frequency</th>
            <th className="center" style={{ width: 70 }}>Status</th>
            <th style={{ width: 130 }}>Signed By</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={6} className="muted center" style={{ padding: 16 }}>
              No checklist items defined.
            </td></tr>
          ) : items.map((it, i) => {
            const status = (it.status || "pending").toLowerCase();
            const icon = STATUS_ICON[status] || STATUS_ICON.pending;
            return (
              <tr key={i} style={{ pageBreakInside: "avoid" }}>
                <td>{i + 1}</td>
                <td>
                  <strong>{it.item || it.task || "—"}</strong>
                  {it.notes && <div className="muted" style={{ fontSize: 10 }}>{it.notes}</div>}
                </td>
                <td className="center">{it.frequency || "—"}</td>
                <td className="center">
                  <span style={{
                    display: "inline-block",
                    padding: "2px 8px", borderRadius: 999,
                    background: icon.bg, color: icon.color,
                    fontSize: 11, fontWeight: 800,
                  }}>{icon.ch}</span>
                </td>
                <td style={{ fontSize: 10.5 }}>{it.signedBy || "—"}</td>
                <td style={{ fontSize: 10.5 }}>{it.remarks || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="pr-section">
          <div className="pr-section__title">Supplies Used</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {Array.isArray(r.supplies) ? r.supplies.join(", ") : (r.supplies || "—")}
          </div>
        </div>
        <div className="pr-section">
          <div className="pr-section__title">PPE</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {Array.isArray(r.ppe) ? r.ppe.join(", ") : (r.ppe || "Gloves, mask, apron")}
          </div>
        </div>
      </div>

      {r.notes && (
        <div className="pr-section">
          <div className="pr-section__title">Shift Notes</div>
          <div className="pr-section__body" style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>
            {r.notes}
          </div>
        </div>
      )}

      <div style={{
        marginTop: 8, padding: "8px 12px", border: "1px dashed #cbd5e1",
        borderRadius: 6, background: "#f8fafc", fontSize: 10, color: "#475569",
      }}>
        <strong>HIC.6:</strong> Daily cleaning verification retained in the area
        register for not less than 90 days. Missed / skipped items must be
        explained in remarks and escalated to the supervisor.
      </div>
    </PrintShell>
  );
};

export default AreaCleaningChecklist;
