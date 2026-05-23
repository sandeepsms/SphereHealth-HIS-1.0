// Components/print/printables/SharpsInjuryPrint.jsx
// R7bm-F7 — Needle-stick / sharps-injury incident form.
// Backs NABH HIC.6 + IPC §269 + ICMR HIV-PEP follow-up cadence.
// Captures worker exposure, device, source-patient serology, PEP
// regimen, and the scheduled 6w / 3m / 6m follow-up serology grid.
//
// The doc is part of the 5-year retention pack mandated under
// BMW Rules 2016 §13 — the watermark + footer reinforce that.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", {
  day: "2-digit", month: "short", year: "numeric",
}) : "—";

const DEVICE_LABEL = {
  HOLLOW_BORE_NEEDLE: "Hollow-bore needle",
  SOLID_NEEDLE:       "Solid needle",
  SCALPEL:            "Scalpel",
  LANCET:             "Lancet",
  GLASS:              "Glass",
  OTHER:              "Other sharp",
};

const STATUS_TONE = {
  OPEN:           { color: "#9a3412", bg: "#ffedd5", border: "#fdba74" },
  UNDER_FOLLOWUP: { color: "#1e3a8a", bg: "#dbeafe", border: "#93c5fd" },
  CLOSED:         { color: "#14532d", bg: "#dcfce7", border: "#86efac" },
};

const SerologyBadge = ({ value }) => {
  const v = String(value || "").toUpperCase();
  const tones = {
    NEGATIVE: { bg: "#dcfce7", color: "#14532d", border: "#86efac" },
    POSITIVE: { bg: "#fee2e2", color: "#7f1d1d", border: "#fca5a5" },
    PENDING:  { bg: "#fef3c7", color: "#78350f", border: "#fde68a" },
    INDETERMINATE: { bg: "#fef9c3", color: "#713f12", border: "#facc15" },
    UNKNOWN:  { bg: "#f1f5f9", color: "#475569", border: "#cbd5e1" },
  };
  const t = tones[v] || tones.UNKNOWN;
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: 4,
      background: t.bg, color: t.color, border: `1px solid ${t.border}`,
      fontSize: 9, fontWeight: 800, textTransform: "uppercase",
    }}>{v || "—"}</span>
  );
};

const SharpsInjuryPrint = ({ settings, receipt = {} }) => {
  const r = receipt;
  const source = r.source || {};
  const pep = r.pepStatus || {};
  const followUps = Array.isArray(r.followUpSerology) ? r.followUpSerology : [];
  const statusTone = STATUS_TONE[r.status] || STATUS_TONE.OPEN;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Sharps / Needle-stick Injury Incident Report"
      serialNo={r.incidentNumber}
      printCount={toNum(r.printCount)}
      watermarkLabel="HIC.6 — CONFIDENTIAL"
      infoItems={[
        { label: "Incident #",   value: r.incidentNumber },
        { label: "Injury Date",  value: fmtDateTime(r.injuryDate) },
        { label: "Injured Staff",value: r.injuredByName },
        { label: "Role",         value: r.injuredByRole },
        { label: "Location",     value: r.injuryLocation },
        { label: "Device",       value: DEVICE_LABEL[r.device] || r.device },
        { label: "Status",       value: r.status },
      ]}
      signatureLabels={["Infection Control Nurse", "Reporting Officer / HOD"]}
    >
      {/* Status / incident banner */}
      <div style={{
        background: statusTone.bg, border: `2px solid ${statusTone.border}`,
        borderRadius: 8, padding: "12px 16px", marginBottom: 14,
      }}>
        <div style={{ fontSize: 10, color: statusTone.color, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>
          Sharps-Injury Incident
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, color: statusTone.color, lineHeight: 1, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>
          {r.incidentNumber || "—"}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: statusTone.color }}>
          Status: {r.status || "OPEN"} · Reported by {r.injuredByName || "—"} on {fmtDate(r.injuryDate)}
        </div>
      </div>

      {/* Exposure description */}
      <div className="pr-section">
        <div className="pr-section__title">Injury / Exposure Description</div>
        <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", lineHeight: 1.5, textAlign: "justify" }}>
          {r.injuryDescription || "Description not recorded."}
        </div>
      </div>

      {/* Source patient block */}
      <div className="pr-section">
        <div className="pr-section__title">Source Patient (Exposure Source)</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "25%", fontWeight: 700 }}>Source Status</td>
              <td>{source.type === "KNOWN" ? "Known source" : "Source unknown"}</td>
              <td style={{ width: "25%", fontWeight: 700 }}>Source UHID</td>
              <td style={{ fontFamily: "'DM Mono', monospace" }}>{source.patientUHID || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Consent for Serology</td>
              <td>{source.consentForSerology ? "Yes" : "No"}</td>
              <td style={{ fontWeight: 700 }}>Consent Date</td>
              <td>{fmtDate(source.serologyConsent_date)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Source HIV</td>
              <td><SerologyBadge value={source.hiv} /></td>
              <td style={{ fontWeight: 700 }}>Source HBsAg</td>
              <td><SerologyBadge value={source.hbsag} /></td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Source HCV</td>
              <td colSpan={3}><SerologyBadge value={source.hcv} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* PEP block */}
      <div className="pr-section">
        <div className="pr-section__title">Post-Exposure Prophylaxis (PEP)</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "25%", fontWeight: 700 }}>PEP Offered</td>
              <td>{pep.offered ? "Yes" : "No"}</td>
              <td style={{ width: "25%", fontWeight: 700 }}>Offered At</td>
              <td>{fmtDateTime(pep.offeredAt)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>PEP Started</td>
              <td>{pep.started ? "Yes" : "No"}</td>
              <td style={{ fontWeight: 700 }}>Started At</td>
              <td>{fmtDateTime(pep.startedAt)}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Regimen</td>
              <td colSpan={3}>{pep.regimen || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Completed</td>
              <td>{pep.completed ? "Yes" : "No"}</td>
              <td style={{ fontWeight: 700 }}>Completed At</td>
              <td>{fmtDateTime(pep.completedAt)}</td>
            </tr>
            {pep.declinedReason && (
              <tr>
                <td style={{ fontWeight: 700 }}>Decline Reason</td>
                <td colSpan={3} style={{ fontSize: 10.5, fontStyle: "italic" }}>{pep.declinedReason}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Follow-up serology schedule */}
      <div className="pr-section">
        <div className="pr-section__title">Follow-up Serology Schedule (ICMR HIV-PEP: 6w / 3m / 6m)</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th style={{ width: 70 }}>Test</th>
              <th style={{ width: 100 }}>Due At</th>
              <th style={{ width: 100 }}>Completed At</th>
              <th style={{ width: 100 }}>Result</th>
              <th>Notes / Reported By</th>
            </tr>
          </thead>
          <tbody>
            {followUps.length === 0 ? (
              <tr><td colSpan={6} className="muted center" style={{ padding: 12 }}>No follow-up schedule recorded.</td></tr>
            ) : followUps.map((f, i) => (
              <tr key={f._id || `${f.test}-${f.dueAt || i}`} style={{ pageBreakInside: "avoid" }}>
                <td>{i + 1}</td>
                <td><strong>{f.test}</strong></td>
                <td>{fmtDate(f.dueAt)}</td>
                <td>{fmtDate(f.completedAt)}</td>
                <td><SerologyBadge value={f.result} /></td>
                <td style={{ fontSize: 9.5 }}>
                  {f.reportedByName ? <span>{f.reportedByName} · </span> : null}
                  {f.notes || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reporting / closure */}
      {(r.reportedToICAN || r.closedAt) && (
        <div className="pr-section">
          <div className="pr-section__title">Reporting / Closure</div>
          <table className="pr-table" style={{ fontSize: 11 }}>
            <tbody>
              <tr>
                <td style={{ width: "25%", fontWeight: 700 }}>Reported to ICAN</td>
                <td>{r.reportedToICAN ? `Yes · ${fmtDateTime(r.reportedToICANAt)}` : "No"}</td>
                <td style={{ width: "25%", fontWeight: 700 }}>Closed</td>
                <td>{r.closedAt ? `${fmtDateTime(r.closedAt)} by ${r.closedByName || "—"}` : "—"}</td>
              </tr>
              {r.closureNotes && (
                <tr>
                  <td style={{ fontWeight: 700 }}>Closure Notes</td>
                  <td colSpan={3} style={{ fontSize: 10.5, whiteSpace: "pre-wrap" }}>{r.closureNotes}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{
        marginTop: 8, padding: "10px 12px",
        background: "#fef2f2", border: "1.5px solid #fca5a5",
        borderRadius: 8, fontSize: 10.5, color: "#7f1d1d",
      }}>
        <strong>CONFIDENTIAL — NABH HIC.6 + ICMR HIV-PEP:</strong> This sharps-injury
        record forms part of the hospital&apos;s Infection Control register. Retention
        period <strong>5 years</strong> from the date of injury per BMW Rules 2016 §13.
        Any disclosure requires authorisation from the Infection Control Officer.
      </div>
    </PrintShell>
  );
};

export default SharpsInjuryPrint;
