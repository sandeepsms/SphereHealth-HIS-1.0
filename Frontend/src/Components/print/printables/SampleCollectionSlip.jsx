// Components/print/printables/SampleCollectionSlip.jsx
// Lab-sample collection slip — printed at the bedside when blood /
// urine / culture / pathology samples are drawn. The slip travels
// with the sample to the lab; the lab-side hand-signed receiving
// stamp closes the chain-of-custody loop.
//
// Maps to NABH AAC.3 / pathology pre-analytic chain requirements.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const URGENCY_STYLE = {
  STAT:    { bg: "#fee2e2", color: "#7f1d1d", border: "#fca5a5" },
  Urgent:  { bg: "#fef3c7", color: "#78350f", border: "#fde68a" },
  Routine: { bg: "#dcfce7", color: "#14532d", border: "#86efac" },
};

const SampleCollectionSlip = ({ settings, receipt = {} }) => {
  const r = receipt;
  const urgency = r.urgency || "Routine";
  const uStyle = URGENCY_STYLE[urgency] || URGENCY_STYLE.Routine;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Sample Collection Slip"
      serialNo={r.sampleNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Sample #",      value: r.sampleNo },
        { label: "Patient",       value: r.patientName },
        { label: "UHID",          value: r.uhid },
        { label: "Age / Sex",     value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Collected At",  value: fmtDateTime(r.collectedAt) },
        { label: "Collected By",  value: r.collectedBy },
      ]}
      showBank={false}
      signatureLabels={["Phlebotomist / Nurse", "Lab Receiving Counter"]}
    >
      {/* Urgency chip + barcode block */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <span style={{
            display: "inline-block",
            padding: "4px 12px", borderRadius: 999,
            background: uStyle.bg, color: uStyle.color,
            border: `1.5px solid ${uStyle.border}`,
            fontSize: 11, fontWeight: 800,
            textTransform: "uppercase", letterSpacing: ".5px",
          }}>
            {urgency}
          </span>
        </div>
        <div style={{
          border: "1px dashed #cbd5e1", borderRadius: 6,
          padding: "6px 8px", background: "#f8fafc",
          fontFamily: "'DM Mono', monospace", fontSize: 12,
          textAlign: "center", fontWeight: 700,
        }}>
          {r.barcode || r.sampleNo || "—"}
        </div>
      </div>

      {/* Sample details */}
      <div className="pr-section">
        <div className="pr-section__title">Sample Details</div>
        <table className="pr-table" style={{ fontSize: 11.5 }}>
          <tbody>
            <tr>
              <td style={{ width: "30%", fontWeight: 700 }}>Type</td>
              <td>{r.sampleType || "—"}</td>
              <td style={{ width: "20%", fontWeight: 700 }}>Quantity</td>
              <td>{r.quantity || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Container</td>
              <td>{r.container || "—"}</td>
              <td style={{ fontWeight: 700 }}>Preservative</td>
              <td>{r.preservative || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Destination Lab</td>
              <td>{r.destinationLab || "In-house Pathology"}</td>
              <td style={{ fontWeight: 700 }}>Tests Requested</td>
              <td>{Array.isArray(r.tests) ? r.tests.join(", ") : (r.tests || "—")}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Fasting Status</td>
              <td>{r.fastingStatus || "—"}</td>
              <td style={{ fontWeight: 700 }}>Ref. Doctor</td>
              <td>{r.referringDoctor || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Patient sticker block */}
      <div style={{
        border: "2px solid #1e293b", borderRadius: 6,
        padding: "8px 12px", marginBottom: 10,
        background: "#fff",
      }}>
        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>
          Patient Sticker / Identifier
        </div>
        <div style={{ marginTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11.5 }}>
          <div><strong>{r.patientName || "—"}</strong></div>
          <div style={{ textAlign: "right" }}>UHID: <strong>{r.uhid || "—"}</strong></div>
          <div>{[r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ")}</div>
          <div style={{ textAlign: "right" }}>Bed: {r.bedNumber || "—"} · Ward: {r.wardName || "—"}</div>
        </div>
      </div>

      {/* Two-witness verification */}
      <div className="pr-section">
        <div className="pr-section__title">Three-Point Verification</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          <div>(1) Name confirmed: <span style={{ fontFamily: "'DM Mono', monospace" }}>__________________</span></div>
          <div>(2) UHID confirmed: <span style={{ fontFamily: "'DM Mono', monospace" }}>__________________</span></div>
          <div>(3) DOB / Age confirmed: <span style={{ fontFamily: "'DM Mono', monospace" }}>__________________</span></div>
        </div>
      </div>

      <div style={{
        marginTop: 8, padding: "8px 12px", border: "1px dashed #cbd5e1",
        borderRadius: 6, background: "#f8fafc", fontSize: 10, color: "#475569",
      }}>
        <strong>NABH AAC.3:</strong> Pre-analytic chain — sample collected, labelled and
        transported per SOP. Hemolysis / clot / mislabel triggers a re-draw under
        the laboratory rejection policy.
      </div>
    </PrintShell>
  );
};

export default SampleCollectionSlip;
