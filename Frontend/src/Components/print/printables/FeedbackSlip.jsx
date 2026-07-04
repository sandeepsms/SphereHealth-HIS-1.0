// Components/print/printables/FeedbackSlip.jsx
// ════════════════════════════════════════════════════════════════════
// Patient Feedback Slip (NABH PRE.3). A small slip reception / the
// discharge desk prints and hands to the patient: hospital header +
// a QR code and short link to the no-login feedback form the patient
// fills on their phone. Routes via the shared print shell + paper
// toolbar like every other printable.
//
// Payload (openPrint("feedback-slip", …)) — { url, qr?, patientName,
// UHID, visitType, department, date, validUntil, printCount }. The QR
// is generated client-side from `url` so the access token never leaves
// the browser to a third-party QR service; a pre-rendered `qr` data
// URL in the payload is used as-is when present.
// ════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDate = (d) => d
  ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  : "—";

export default function FeedbackSlip({ settings = {}, receipt = {} }) {
  const r = receipt || {};
  const url = r.url || "";
  const [qr, setQr] = useState(r.qr || "");

  useEffect(() => {
    let alive = true;
    if (!qr && url) {
      QRCode.toDataURL(url, { width: 360, margin: 1, color: { dark: "#1e293b", light: "#ffffff" } })
        .then((d) => { if (alive) setQr(d); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [url, qr]);

  return (
    <PrintShell
      settings={settings}
      documentTitle="Patient Feedback"
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Patient",    value: r.patientName || "—" },
        { label: "UHID",       value: r.UHID || r.uhid || "—" },
        { label: "Visit",      value: r.visitType || "—" },
        { label: "Department", value: r.department || "—" },
        { label: "Date",       value: fmtDate(r.date || Date.now()) },
      ]}
    >
      <div style={{ textAlign: "center", padding: "6px 0 2px" }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: "#3730a3" }}>We value your feedback</div>
        <div style={{ fontSize: 12.5, color: "#475569", margin: "7px auto 16px", maxWidth: 430, lineHeight: 1.5 }}>
          Please scan the QR code below — or open the link — to rate your experience with us.
          It takes less than a minute and helps us serve you better.
        </div>

        {qr ? (
          <img src={qr} alt="Feedback QR code"
            style={{ width: 220, height: 220, border: "1px solid #e2e8f0", borderRadius: 12, padding: 6, background: "#fff" }} />
        ) : (
          <div style={{ width: 220, height: 220, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", border: "1px dashed #cbd5e1", borderRadius: 12 }}>
            {url ? "Generating QR…" : "No link provided"}
          </div>
        )}

        {url ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Or visit</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", wordBreak: "break-all", marginTop: 2 }}>{url}</div>
          </div>
        ) : null}

        {r.validUntil ? (
          <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>Link valid until {fmtDate(r.validUntil)}</div>
        ) : null}
      </div>

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1.5px dashed #cbd5e1", textAlign: "center", fontSize: 11, color: "#64748b" }}>
        <i className="pi pi-lock" style={{ fontSize: 10 }} /> Your responses are confidential. Thank you for helping us improve.
      </div>
    </PrintShell>
  );
}
