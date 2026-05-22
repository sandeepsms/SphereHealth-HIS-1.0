// Components/print/printables/GateLogSlip.jsx
// Security gate-log entry slip — half-A4 receipt printed at the
// security desk when a non-staff person (visitor, vendor, ambulance
// crew, contractor) enters or exits the premises. Acts as a tear-off
// gate pass + a register copy for the security file.
//
// Maps to NABH FMS.7 (security of patients and visitors) — every
// entry / exit must be logged and the log retained for review.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const PERSON_BADGE = {
  visitor:    { color: "#1e3a8a", bg: "#dbeafe", border: "#93c5fd" },
  vendor:     { color: "#14532d", bg: "#dcfce7", border: "#86efac" },
  ambulance:  { color: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5" },
  staff:      { color: "#475569", bg: "#e2e8f0", border: "#94a3b8" },
  contractor: { color: "#78350f", bg: "#fef3c7", border: "#fde68a" },
};

const GateLogSlip = ({ settings, receipt = {} }) => {
  const r = receipt;
  const direction = (r.direction || "in").toLowerCase();
  const personType = (r.personType || "visitor").toLowerCase();
  const badge = PERSON_BADGE[personType] || PERSON_BADGE.visitor;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Security Gate Log Entry"
      serialNo={r.entryNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Entry #",       value: r.entryNo },
        { label: "Direction",     value: direction.toUpperCase() },
        { label: "Person Type",   value: personType.toUpperCase() },
        { label: "Time In",       value: fmtDateTime(r.timeIn) },
        { label: "Time Out",      value: fmtDateTime(r.timeOut) },
        { label: "Recorded By",   value: r.recordedBy },
      ]}
      showBank={false}
      signatureLabels={["Security Officer", "Person Entering / Exiting"]}
    >
      {/* Direction + type chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <span style={{
          padding: "4px 14px", borderRadius: 999,
          background: direction === "in" ? "#dcfce7" : "#fee2e2",
          color: direction === "in" ? "#14532d" : "#7f1d1d",
          border: `1.5px solid ${direction === "in" ? "#86efac" : "#fca5a5"}`,
          fontSize: 12, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: ".5px",
        }}>
          {direction === "in" ? "→ ENTRY" : "← EXIT"}
        </span>
        <span style={{
          padding: "4px 12px", borderRadius: 999,
          background: badge.bg, color: badge.color,
          border: `1.5px solid ${badge.border}`,
          fontSize: 11, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: ".5px",
        }}>{personType}</span>
      </div>

      {/* Person details */}
      <div className="pr-section">
        <div className="pr-section__title">Person Details</div>
        <div className="pr-section__body" style={{ fontSize: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{r.personName || "—"}</div>
          <div className="muted" style={{ marginTop: 3, fontSize: 11 }}>
            {r.idProof && <>{r.idProof}: {r.idNumber || "—"}</>}
            {r.contact && <> · 📞 {r.contact}</>}
            {r.organisation && <> · {r.organisation}</>}
          </div>
          {r.purpose && <div style={{ marginTop: 6 }}><strong>Purpose:</strong> {r.purpose}</div>}
          {r.meetingPerson && <div><strong>Meeting:</strong> {r.meetingPerson} ({r.meetingDept || "—"})</div>}
        </div>
      </div>

      {/* Vehicle */}
      {(r.vehicle || r.vehicleType) && (
        <div className="pr-section">
          <div className="pr-section__title">Vehicle</div>
          <div className="pr-section__body" style={{ fontSize: 11.5 }}>
            <div><strong>Type:</strong> {r.vehicleType || "—"}</div>
            <div><strong>Registration #:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.vehicle || "—"}</span></div>
            {r.driverName && <div><strong>Driver:</strong> {r.driverName}</div>}
            {personType === "ambulance" && (
              <div><strong>Patient / Case:</strong> {r.patientName || "—"} (UHID: {r.uhid || "—"})</div>
            )}
          </div>
        </div>
      )}

      {/* Linked records */}
      {(r.linkedVisitorPass || r.linkedVendor || r.itemsCarried) && (
        <div className="pr-section">
          <div className="pr-section__title">Linked Records</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {r.linkedVisitorPass && <div><strong>Visitor Pass #:</strong> {r.linkedVisitorPass}</div>}
            {r.linkedVendor && <div><strong>Vendor PO / Schedule:</strong> {r.linkedVendor}</div>}
            {r.itemsCarried && <div><strong>Items carried:</strong> {r.itemsCarried}</div>}
          </div>
        </div>
      )}

      <div style={{
        marginTop: 10, padding: "8px 12px", border: "1px dashed #cbd5e1",
        borderRadius: 6, background: "#f8fafc", fontSize: 10, color: "#475569",
      }}>
        <strong>NABH FMS.7:</strong> Hospital security log entry — retained for
        not less than 12 months per facility security policy. Re-entry / re-exit
        requires a fresh slip. ID-proof was verified at the time of entry.
      </div>
    </PrintShell>
  );
};

export default GateLogSlip;
