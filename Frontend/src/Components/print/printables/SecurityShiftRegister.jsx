// Components/print/printables/SecurityShiftRegister.jsx
// End-of-shift register for the security officer on duty. Captures:
//   - shift envelope (date, officer, supervisor)
//   - aggregate counts for the shift (gate entries / exits, incidents,
//     code-response events)
//   - per-incident table with timestamps
//   - officer + supervisor signatures
//
// Used by Security Lead / Head; supports NABH FMS.7 audit.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", {
  day: "2-digit", month: "short", year: "numeric",
}) : "—";

const SecurityShiftRegister = ({ settings, receipt = {} }) => {
  const r = receipt;
  const incidents = Array.isArray(r.incidents) ? r.incidents : [];
  const codeEvents = Array.isArray(r.codeEvents) ? r.codeEvents : [];
  const gateSummary = r.gateSummary || {};

  return (
    <PrintShell
      settings={settings}
      documentTitle="Security Shift Register"
      serialNo={r.shiftNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Shift #",         value: r.shiftNo },
        { label: "Date",            value: fmtDate(r.shiftDate || new Date()) },
        { label: "Shift",           value: r.shift || "—" },
        { label: "Officer on Duty", value: r.officerName },
        { label: "Shift In",        value: fmtDateTime(r.shiftIn) },
        { label: "Shift Out",       value: fmtDateTime(r.shiftOut) },
      ]}
      showBank={false}
      signatureLabels={["Security Officer", "Security Supervisor"]}
    >
      {/* Aggregate counters */}
      <div className="pr-section">
        <div className="pr-section__title">Shift Summary</div>
        <div className="pr-section__body" style={{ fontSize: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, textAlign: "center", background: "#f8fafc" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Entries</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{gateSummary.entries ?? "—"}</div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, textAlign: "center", background: "#f8fafc" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Exits</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{gateSummary.exits ?? "—"}</div>
            </div>
            <div style={{ border: "1px solid #fca5a5", borderRadius: 6, padding: 10, textAlign: "center", background: "#fee2e2" }}>
              <div style={{ fontSize: 10, color: "#7f1d1d", textTransform: "uppercase" }}>Incidents</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#7f1d1d" }}>{incidents.length}</div>
            </div>
            <div style={{ border: "1px solid #fde68a", borderRadius: 6, padding: 10, textAlign: "center", background: "#fef3c7" }}>
              <div style={{ fontSize: 10, color: "#78350f", textTransform: "uppercase" }}>Code Events</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#78350f" }}>{codeEvents.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Hand-over notes */}
      {r.handoverNotes && (
        <div className="pr-section">
          <div className="pr-section__title">Hand-over Notes</div>
          <div className="pr-section__body" style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>
            {r.handoverNotes}
          </div>
        </div>
      )}

      {/* Incidents table */}
      {incidents.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Incidents During Shift</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Time</th>
                <th style={{ width: 90 }}>Incident #</th>
                <th style={{ width: 100 }}>Type</th>
                <th style={{ width: 110 }}>Location</th>
                <th>Description</th>
                <th style={{ width: 80 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((it, i) => (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  <td>{fmtDateTime(it.occurredAt)}</td>
                  <td style={{ fontFamily: "'DM Mono', monospace" }}>{it.incidentNo || "—"}</td>
                  <td>{it.incidentType || "—"}</td>
                  <td>{it.location || "—"}</td>
                  <td style={{ fontSize: 10 }}>{it.description || ""}</td>
                  <td>{it.status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Code events table */}
      {codeEvents.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Code-Response Events</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Alerted</th>
                <th style={{ width: 80 }}>Code</th>
                <th style={{ width: 110 }}>Location</th>
                <th style={{ width: 80 }}>Resolved</th>
                <th style={{ width: 70 }}>Duration</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {codeEvents.map((c, i) => (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  <td>{fmtDateTime(c.alertedAt)}</td>
                  <td><strong>{c.code || c.codeType || "—"}</strong></td>
                  <td>{c.location || "—"}</td>
                  <td>{fmtDateTime(c.resolvedAt)}</td>
                  <td>{c.durationMin ? `${c.durationMin} min` : "—"}</td>
                  <td style={{ fontSize: 10 }}>{c.outcome || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Patrol rounds */}
      {Array.isArray(r.patrolRounds) && r.patrolRounds.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Patrol Rounds</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {r.patrolRounds.map((p, i) => (
              <div key={i}>
                <strong>Round {i + 1}:</strong> {fmtDateTime(p.at)} — {p.zones || p.notes || "OK"}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{
        marginTop: 8, padding: "8px 12px", border: "1px dashed #cbd5e1",
        borderRadius: 6, background: "#f8fafc", fontSize: 10, color: "#475569",
      }}>
        <strong>NABH FMS.7:</strong> Security shift register retained for not
        less than 12 months. Discrepancies between this register and the gate
        log are flagged to the supervisor before the next shift hand-over.
      </div>
    </PrintShell>
  );
};

export default SecurityShiftRegister;
