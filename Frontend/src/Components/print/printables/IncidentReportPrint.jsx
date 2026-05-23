// Components/print/printables/IncidentReportPrint.jsx
// Incident report printable — NABH IMS.5 / legal-grade. Used for
// patient safety events, security incidents, near-misses, sentinel
// events, etc. Carries the description, persons involved, action-
// taken and signed-off witnesses; the DUPLICATE watermark renders
// automatically for reprints (R7bf-F printCount).
//
// Used by Security, Nursing, HIC, and Quality leads.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const SEVERITY = {
  critical: { color: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5", label: "CRITICAL" },
  high:     { color: "#9a3412", bg: "#ffedd5", border: "#fdba74", label: "HIGH" },
  moderate: { color: "#78350f", bg: "#fef3c7", border: "#fde68a", label: "MODERATE" },
  low:      { color: "#14532d", bg: "#dcfce7", border: "#86efac", label: "LOW" },
  sentinel: { color: "#450a0a", bg: "#fecaca", border: "#dc2626", label: "SENTINEL" },
};

const IncidentReportPrint = ({ settings, receipt = {} }) => {
  const r = receipt;
  const sev = (r.severity || "moderate").toLowerCase();
  const sevBadge = SEVERITY[sev] || SEVERITY.moderate;
  const persons = Array.isArray(r.personsInvolved) ? r.personsInvolved : [];
  const attachments = Array.isArray(r.attachments) ? r.attachments : [];
  const timeline = Array.isArray(r.statusHistory) ? r.statusHistory : [];

  return (
    <PrintShell
      settings={settings}
      documentTitle="Incident Report"
      serialNo={r.incidentNo}
      printCount={toNum(r.printCount)}
      watermarkLabel="INCIDENT REPORT — CONFIDENTIAL"
      infoItems={[
        { label: "Incident #",   value: r.incidentNo },
        { label: "Type",         value: r.incidentType },
        { label: "Severity",     value: sevBadge.label },
        { label: "Location",     value: r.location },
        { label: "Occurred At",  value: fmtDateTime(r.occurredAt) },
        { label: "Recorded At",  value: fmtDateTime(r.recordedAt) },
        { label: "Recorded By",  value: r.recordedBy },
        { label: "Status",       value: r.status },
      ]}
      signatureLabels={["Witness 1", "Witness 2"]}
    >
      {/* Incident # banner + severity */}
      <div style={{
        background: sevBadge.bg, border: `2px solid ${sevBadge.border}`,
        borderRadius: 8, padding: "12px 16px", marginBottom: 14,
      }}>
        <div style={{ fontSize: 10, color: sevBadge.color, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>
          Incident Number
        </div>
        <div style={{ fontSize: 28, fontWeight: 900, color: sevBadge.color, lineHeight: 1, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>
          {r.incidentNo || "—"}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: sevBadge.color }}>
          Severity: {sevBadge.label}
          {r.incidentType && <> · Type: {r.incidentType}</>}
        </div>
      </div>

      {/* Description */}
      <div className="pr-section">
        <div className="pr-section__title">Description of Incident</div>
        <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", lineHeight: 1.5, textAlign: "justify" }}>
          {r.description || "No description provided."}
        </div>
      </div>

      {/* Patient involved (if any) */}
      {(r.patientName || r.uhid) && (
        <div className="pr-section">
          <div className="pr-section__title">Patient Involved</div>
          <div className="pr-section__body" style={{ fontSize: 11.5 }}>
            <div><strong>Name:</strong> {r.patientName || "—"} · <strong>UHID:</strong> {r.uhid || "—"}</div>
            {r.bedNumber && <div><strong>Bed / Ward:</strong> {[r.bedNumber, r.wardName].filter(Boolean).join(" · ")}</div>}
            {r.diagnosis && <div><strong>Diagnosis:</strong> {r.diagnosis}</div>}
            {r.injuryDescription && <div><strong>Injury / Harm:</strong> {r.injuryDescription}</div>}
          </div>
        </div>
      )}

      {/* Persons involved */}
      {persons.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Persons Involved</div>
          <table className="pr-table" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th>Name</th>
                <th style={{ width: 110 }}>Role</th>
                <th style={{ width: 110 }}>Department</th>
                <th>Involvement</th>
              </tr>
            </thead>
            <tbody>
              {persons.map((p, i) => (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  <td>{i + 1}</td>
                  <td><strong>{p.name || "—"}</strong></td>
                  <td>{p.role || "—"}</td>
                  <td>{p.department || "—"}</td>
                  <td style={{ fontSize: 10.5 }}>{p.involvement || p.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Action taken */}
      <div className="pr-section">
        <div className="pr-section__title">Immediate Action Taken</div>
        <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>
          {r.actionTaken || "—"}
        </div>
      </div>

      {/* Timeline */}
      {timeline.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Status Timeline</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ width: 140 }}>Timestamp</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 120 }}>By</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((t, i) => (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  <td>{fmtDateTime(t.at)}</td>
                  <td><strong>{t.status || "—"}</strong></td>
                  <td>{t.by || "—"}</td>
                  <td style={{ fontSize: 10 }}>{t.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Attachments / Evidence</div>
          <ul style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 11 }}>
            {attachments.map((a, i) => (
              <li key={i}>{typeof a === "string" ? a : (a.fileName || a.name || "—")}
                {typeof a === "object" && a.uploadedAt && (
                  <span className="muted"> · {fmtDateTime(a.uploadedAt)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Investigator signature */}
      <div className="pr-section">
        <div className="pr-section__title">Investigation Sign-off</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          <div><strong>Investigator:</strong> {r.investigatorName || "—"}</div>
          <div><strong>Designation:</strong> {r.investigatorRole || "—"}</div>
          <div style={{ marginTop: 8, borderTop: "1px dotted #cbd5e1", paddingTop: 6 }}>
            Signature: __________________________ &nbsp;&nbsp; Date: {fmtDateTime(r.signedOffAt) || "__________________"}
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 8, padding: "10px 12px",
        background: "#fef2f2", border: "1.5px solid #fca5a5",
        borderRadius: 8, fontSize: 10.5, color: "#7f1d1d",
      }}>
        <strong>CONFIDENTIAL — NABH IMS.5:</strong> This incident report is part
        of the hospital&apos;s quality and patient-safety record. It is privileged
        and must not be released without authorisation from the Medical
        Superintendent or counsel. Tampering with this document attracts
        disciplinary action under the HR policy.
      </div>
    </PrintShell>
  );
};

export default IncidentReportPrint;
