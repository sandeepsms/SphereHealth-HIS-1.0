// Components/print/printables/VisitorPass.jsx
// Visitor / attendant pass — half-A4 with a tear-off photo strip + barcode.
// Receptionist hands this to family members so they can enter wards.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const VisitorPass = ({ settings, receipt = {} }) => {
  const r = receipt;
  return (
    <PrintShell
      settings={settings}
      documentTitle="Visitor / Attendant Pass"
      serialNo={r.passNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Patient",   value: r.patientName },
        { label: "UHID",      value: r.uhid },
        { label: "Bed / Ward",value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Issued",    value: fmtDateTime(r.issuedAt) },
        { label: "Valid Till",value: fmtDateTime(r.validTill) },
      ]}
      showBank={false}
      signatureLabels={["Reception", "Security"]}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 16, marginBottom: 14 }}>
        <div>
          <div className="pr-section">
            <div className="pr-section__title">Visitor Details</div>
            <div className="pr-section__body" style={{ fontSize: 13 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                {r.visitorName || "—"}
              </div>
              <div className="muted" style={{ marginTop: 3, fontSize: 11 }}>
                {r.relation || "Attendant"}
                {r.mobile && <> · 📞 {r.mobile}</>}
                {r.idType && <> · {r.idType}: {r.idNumber || "—"}</>}
              </div>
            </div>
          </div>

          <div className="pr-section">
            <div className="pr-section__title">Visiting</div>
            <div className="pr-section__body" style={{ fontSize: 13 }}>
              <div><strong>Patient:</strong> {r.patientName || "—"}</div>
              <div><strong>Bed:</strong> {r.bedNumber || "—"} · <strong>Ward:</strong> {r.wardName || "—"}</div>
              <div><strong>Floor:</strong> {r.floorNumber || "—"} · <strong>Building:</strong> {r.buildingName || "—"}</div>
            </div>
          </div>
        </div>

        {/* Photo / ID box */}
        <div style={{
          border: "1px dashed #cbd5e1",
          borderRadius: 6,
          height: 110,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
          fontSize: 10,
          textAlign: "center",
          background: "#f8fafc",
          padding: 6,
        }}>
          PHOTO<br/>OR<br/>ID PROOF
        </div>
      </div>

      <div style={{
        background: "linear-gradient(135deg, #fef9c3, #fde68a)",
        border: "1.5px solid #facc15",
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, color: "#92400e",
          textTransform: "uppercase", letterSpacing: ".5px",
        }}>
          Visiting Rules
        </div>
        <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 11, color: "#713f12" }}>
          <li>Only ONE attendant per patient at a time inside the ward.</li>
          <li>Visiting hours: <strong>{r.visitingHours || "5:00 PM – 7:00 PM (daily)"}</strong>; ICU visiting is at the discretion of the treating doctor.</li>
          <li>Children below 12 are not allowed inside the ward area.</li>
          <li>This pass is non-transferable and must be returned at the security desk on exit.</li>
          <li>Carry a valid government photo ID along with this pass at all times inside the hospital.</li>
        </ul>
      </div>
    </PrintShell>
  );
};

export default VisitorPass;
