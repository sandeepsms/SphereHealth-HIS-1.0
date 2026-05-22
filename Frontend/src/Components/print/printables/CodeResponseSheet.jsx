// Components/print/printables/CodeResponseSheet.jsx
// Code-response event sheet — used by the medical-emergency
// response team for hospital codes (Blue / Pink / Red / Black /
// Brown etc.). Records the alert → arrival → resolution timeline
// and the named first-arrival member of the Medical Response Team.
//
// Maps to NABH COP.10 (resuscitation) and FMS.6 (emergency
// response) for evacuation / fire codes.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const CODE_BADGE = {
  blue:   { color: "#1e3a8a", bg: "#dbeafe", border: "#3b82f6", label: "CODE BLUE",   purpose: "Cardiac arrest / adult code" },
  pink:   { color: "#831843", bg: "#fce7f3", border: "#ec4899", label: "CODE PINK",   purpose: "Paediatric / infant emergency" },
  red:    { color: "#7f1d1d", bg: "#fee2e2", border: "#ef4444", label: "CODE RED",    purpose: "Fire / evacuation" },
  black:  { color: "#0f172a", bg: "#e2e8f0", border: "#0f172a", label: "CODE BLACK",  purpose: "Bomb threat / security" },
  brown:  { color: "#78350f", bg: "#fef3c7", border: "#d97706", label: "CODE BROWN",  purpose: "External disaster / mass casualty" },
  yellow: { color: "#713f12", bg: "#fef9c3", border: "#eab308", label: "CODE YELLOW", purpose: "Hazmat / chemical spill" },
  white:  { color: "#374151", bg: "#f3f4f6", border: "#6b7280", label: "CODE WHITE",  purpose: "Violent person / restraint" },
  green:  { color: "#14532d", bg: "#dcfce7", border: "#22c55e", label: "CODE GREEN",  purpose: "Evacuation" },
  purple: { color: "#581c87", bg: "#ede9fe", border: "#8b5cf6", label: "CODE PURPLE", purpose: "Hostage / abduction" },
  silver: { color: "#475569", bg: "#e2e8f0", border: "#94a3b8", label: "CODE SILVER", purpose: "Active shooter / armed" },
};

const CodeResponseSheet = ({ settings, receipt = {} }) => {
  const r = receipt;
  const codeKey = (r.code || r.codeColor || "blue").toLowerCase();
  const badge = CODE_BADGE[codeKey] || CODE_BADGE.blue;
  const responders = Array.isArray(r.responders) ? r.responders : [];
  const interventions = Array.isArray(r.interventions) ? r.interventions : [];

  return (
    <PrintShell
      settings={settings}
      documentTitle="Code Response Event Sheet"
      serialNo={r.eventNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Event #",     value: r.eventNo },
        { label: "Code",        value: badge.label },
        { label: "Location",    value: r.location },
        { label: "Alerted At",  value: fmtDateTime(r.alertedAt) },
        { label: "Resolved At", value: fmtDateTime(r.resolvedAt) },
        { label: "Duration",    value: r.durationMin != null ? `${r.durationMin} min` : "—" },
      ]}
      signatureLabels={["Team Lead (MRT)", "Hospital Witness"]}
    >
      {/* Code chip (large) */}
      <div style={{
        background: badge.bg, border: `2.5px solid ${badge.border}`,
        borderRadius: 8, padding: "12px 16px", marginBottom: 14,
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 900, color: badge.color, lineHeight: 1, letterSpacing: ".5px" }}>
            {badge.label}
          </div>
          <div style={{ fontSize: 11, color: badge.color, marginTop: 3 }}>{badge.purpose}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 10, color: badge.color, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>Event #</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: badge.color, fontFamily: "'DM Mono', monospace" }}>{r.eventNo || "—"}</div>
        </div>
      </div>

      {/* Timeline */}
      <div className="pr-section">
        <div className="pr-section__title">Response Timeline</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "30%", fontWeight: 700 }}>Alerted</td>
              <td>{fmtDateTime(r.alertedAt)} — by {r.alertedBy || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700, color: "#1d4ed8" }}>First MRT On-Scene</td>
              <td>
                <strong>{r.firstResponderName || "—"}</strong> {r.firstResponderRole && <>({r.firstResponderRole})</>}
                {r.firstResponderAt && <> · arrived {fmtDateTime(r.firstResponderAt)}</>}
                {r.firstResponderEta != null && <> · ETA {r.firstResponderEta}s</>}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Full Team Assembled</td>
              <td>{fmtDateTime(r.teamAssembledAt)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Resolved</td>
              <td>{fmtDateTime(r.resolvedAt)} — {r.resolvedBy || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Outcome</td>
              <td>{r.outcome || "—"}</td>
            </tr>
            {codeKey === "red" && (
              <tr>
                <td style={{ fontWeight: 700 }}>Evacuation Count</td>
                <td>{r.evacuationCount ?? "—"} persons evacuated</td>
              </tr>
            )}
            {codeKey === "blue" && (r.uhid || r.patientName) && (
              <tr>
                <td style={{ fontWeight: 700 }}>Linked Patient</td>
                <td>{r.patientName || "—"} (UHID: {r.uhid || "—"}) {r.bedNumber && <> · Bed {r.bedNumber}</>}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Responders */}
      {responders.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Responders Roster</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th>Name</th>
                <th style={{ width: 130 }}>Role</th>
                <th style={{ width: 110 }}>Arrived</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {responders.map((p, i) => (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  <td>{i + 1}</td>
                  <td><strong>{p.name || "—"}</strong></td>
                  <td>{p.role || "—"}</td>
                  <td>{fmtDateTime(p.arrivedAt)}</td>
                  <td style={{ fontSize: 10 }}>{p.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Interventions / CPR record (BLUE) */}
      {interventions.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Interventions</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Time</th>
                <th>Intervention</th>
                <th style={{ width: 110 }}>Performed By</th>
                <th>Result / Notes</th>
              </tr>
            </thead>
            <tbody>
              {interventions.map((it, i) => (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  <td>{fmtDateTime(it.at)}</td>
                  <td><strong>{it.action || it.intervention || "—"}</strong>
                    {it.dose && <span className="muted"> · {it.dose}</span>}
                  </td>
                  <td>{it.by || "—"}</td>
                  <td style={{ fontSize: 10 }}>{it.result || it.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Debrief */}
      {(r.debrief || r.lessonsLearned) && (
        <div className="pr-section">
          <div className="pr-section__title">Post-event Debrief</div>
          <div className="pr-section__body" style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>
            {r.debrief || r.lessonsLearned}
          </div>
        </div>
      )}

      <div style={{
        marginTop: 8, padding: "8px 12px", border: "1px dashed #cbd5e1",
        borderRadius: 6, background: "#f8fafc", fontSize: 10, color: "#475569",
      }}>
        <strong>NABH COP.10 / FMS.6:</strong> Code-response sheet must be filed
        within 24 hours of the event. The Quality Cell reviews response times
        monthly; chronic delays trigger a CME / drill recommendation.
      </div>
    </PrintShell>
  );
};

export default CodeResponseSheet;
