// Components/print/printables/EquipmentTransport.jsx
// Equipment chain-of-custody slip — used when a portable asset
// (wheelchair, monitor, infusion pump, ECG machine, etc.) moves
// between wards / departments. Carries:
//   - issued-from + issued-to + expected return
//   - condition snapshot at issue + at return
//   - both signatures (issuing nurse, ward-boy / receiving unit)
// Maps to NABH FMS.2 (medical equipment management) requirement
// of a movement register for shared assets.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const EquipmentTransport = ({ settings, receipt = {} }) => {
  const r = receipt;
  const isReturned = !!(r.returnedAt || r.returnedBy);

  return (
    <PrintShell
      settings={settings}
      documentTitle={isReturned ? "Equipment Transport / Return Slip" : "Equipment Transport Slip"}
      serialNo={r.transportNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Equipment",     value: r.equipmentName },
        { label: "Serial #",      value: r.serialNumber },
        { label: "Category",      value: r.category },
        { label: "Issued From",   value: r.issuedFrom },
        { label: "Issued To",     value: r.issuedTo },
        { label: "Expected Back", value: fmtDateTime(r.expectedReturnAt) },
      ]}
      showBank={false}
      signatureLabels={["Issuing Custodian", "Receiving / Returning Custodian"]}
    >
      {/* Asset summary card */}
      <div style={{
        border: "1.5px solid #93c5fd",
        background: "linear-gradient(135deg, #e0e7ff, #eef2ff)",
        borderRadius: 8, padding: "12px 16px", marginBottom: 12,
      }}>
        <div style={{ fontSize: 10, color: "#3730a3", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>
          Asset
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2, color: "#0f172a" }}>
          {r.equipmentName || "—"}
        </div>
        <div style={{ fontSize: 11, color: "#3730a3", marginTop: 4 }}>
          <strong>Serial #:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.serialNumber || "—"}</span>
          {r.assetTag && <> · <strong>Asset Tag:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.assetTag}</span></>}
          {r.category && <> · <strong>Category:</strong> {r.category}</>}
        </div>
      </div>

      {/* Issue block */}
      <div className="pr-section">
        <div className="pr-section__title">Issue</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          <div><strong>Issued At:</strong> {fmtDateTime(r.issuedAt)}</div>
          <div><strong>From:</strong> {r.issuedFrom || "—"}</div>
          <div><strong>To (custodian):</strong> {r.issuedTo || "—"}</div>
          <div><strong>Purpose:</strong> {r.purpose || "—"}</div>
          <div style={{ marginTop: 6 }}>
            <strong>Condition at Issue:</strong> {r.conditionAtIssue || "Working — no visible damage"}
          </div>
          {Array.isArray(r.accessories) && r.accessories.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <strong>Accessories handed over:</strong> {r.accessories.join(", ")}
            </div>
          )}
        </div>
      </div>

      {/* Return block (rendered only when returned) */}
      {isReturned ? (
        <div className="pr-section">
          <div className="pr-section__title">Return</div>
          <div className="pr-section__body" style={{ fontSize: 11.5 }}>
            <div><strong>Returned At:</strong> {fmtDateTime(r.returnedAt)}</div>
            <div><strong>Returned By:</strong> {r.returnedBy || "—"}</div>
            <div style={{ marginTop: 6 }}>
              <strong>Condition at Return:</strong> {r.conditionAtReturn || "—"}
            </div>
            {r.damageReported && (
              <div style={{
                marginTop: 6, padding: "6px 10px",
                background: "#fee2e2", border: "1px solid #fca5a5",
                borderRadius: 6, color: "#7f1d1d",
              }}>
                <strong>DAMAGE / FAULT REPORTED:</strong> {r.damageReported}
                {r.escalatedTo && <div style={{ marginTop: 2 }}>Escalated to: {r.escalatedTo}</div>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{
          padding: "10px 12px", border: "1px dashed #cbd5e1",
          borderRadius: 6, background: "#f8fafc",
          fontSize: 11, color: "#475569", marginBottom: 8,
        }}>
          <strong>Pending return.</strong> This slip must be re-printed and re-signed at the time of return; the
          receiving custodian is responsible for the asset until return is recorded in the FMS register.
        </div>
      )}

      <div style={{
        marginTop: 10, padding: "8px 12px", border: "1px dashed #cbd5e1",
        borderRadius: 6, background: "#f8fafc", fontSize: 10, color: "#475569",
      }}>
        <strong>NABH FMS.2 — Medical Equipment Management:</strong> Movement register
        must show condition at every transfer; any damage triggers a biomedical
        inspection before the asset is re-issued.
      </div>
    </PrintShell>
  );
};

export default EquipmentTransport;
