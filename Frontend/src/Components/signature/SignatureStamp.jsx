/**
 * SignatureStamp.jsx
 * Renders a user's digital signature block at the bottom of any submitted document/form.
 *
 * Props:
 *   signature   : base64 data URL | null
 *   userName    : string
 *   role        : string
 *   timestamp   : Date | string | null
 *   regNo       : string | null   — registration number (for doctors/nurses)
 *   onSetup     : () => void      — called when "Add Signature" is clicked
 */
import React from "react";

export default function SignatureStamp({ signature, userName, role, timestamp, regNo, onSetup }) {
  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleString("en-IN", {
        dateStyle: "medium", timeStyle: "short",
      })
    : null;

  const isPending = !signature;

  return (
    <div style={{
      border: `1.5px solid ${isPending ? "#fde68a" : "#bbf7d0"}`,
      borderRadius: 12,
      background: isPending ? "#fffbeb" : "#f0fdf4",
      padding: "14px 18px",
      display: "flex",
      alignItems: "flex-end",
      gap: 20,
      minWidth: 240,
    }}>
      {/* Signature image or placeholder */}
      <div style={{
        flex: 1, minWidth: 120, borderBottom: "1.5px solid #94a3b8",
        paddingBottom: 4, minHeight: 60, display: "flex", alignItems: "flex-end",
      }}>
        {signature ? (
          <img
            src={signature}
            alt="digital signature"
            style={{ maxHeight: 56, maxWidth: 180, objectFit: "contain" }}
          />
        ) : (
          <button
            type="button"
            onClick={onSetup}
            style={{
              background: "none", border: "1.5px dashed #d97706",
              borderRadius: 6, padding: "6px 14px", color: "#92400e",
              cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}
          >
            <i className="pi pi-pen-to-square" style={{ marginRight: 5 }} />
            Add Signature
          </button>
        )}
      </div>

      {/* User info */}
      <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 12 }}>{userName}</div>
        <div>{role}</div>
        {regNo && <div>Reg. No: {regNo}</div>}
        {formattedTime && <div style={{ color: "#64748b" }}>{formattedTime}</div>}
        {signature && (
          <div style={{ color: "#16a34a", fontWeight: 600, marginTop: 2 }}>
            <i className="pi pi-verified" style={{ marginRight: 3, fontSize: 10 }} />
            Digitally Signed
          </div>
        )}
      </div>
    </div>
  );
}
