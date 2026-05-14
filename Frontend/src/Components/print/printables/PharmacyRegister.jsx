/**
 * PharmacyRegister.jsx — generic printable for all 6 statutory
 * pharmacy registers: Sales, Purchase, Stock (Form 35), Schedule
 * H/H1/X, Expiry, GST Summary.
 *
 * Receipt payload shape (passed via openPrint):
 *   {
 *     type: "sales" | "purchase" | "stock" | "schedule-h" | "expiry" | "gst",
 *     title: "Sales Register",
 *     subtitle: "01 May 2026 → 14 May 2026",
 *     color: "#16a34a",              // accent
 *     columns: [{ key, label, align, w }]  // header definitions
 *     rows: [{ key1: v, key2: v, ... }]   // already-formatted strings or numbers
 *     totals: { ... arbitrary k:v summary }
 *     pharmacySettings: { ... }       // for outsourced-mode header override
 *   }
 *
 * Renders landscape A4 by default — registers are wide; many columns.
 * Half-A4 still works via the paper toolbar (5-6 columns max).
 */
import React from "react";
import "../print.css";

const _fmtAddr = (s = {}) => [
  s.addressLine1, s.addressLine2,
  [s.city, s.state, s.pincode].filter(Boolean).join(", "),
  s.country,
].filter(Boolean).join(", ");

function resolveIdentity(hospital, pharmacy) {
  const isOut = pharmacy?.mode === "outsourced";
  if (isOut) {
    return {
      name:        pharmacy.pharmacyName || "Pharmacy",
      tagline:     pharmacy.tagline || "",
      logo:        pharmacy.showLogoInPrint === false ? null : pharmacy.logo,
      address:     _fmtAddr(pharmacy) || _fmtAddr(hospital),
      phone:       pharmacy.phone1,
      email:       pharmacy.email,
      gstin:       pharmacy.gstin,
      drugLicense: pharmacy.drugLicenseNo,
    };
  }
  return {
    name:        hospital.hospitalName || "Hospital Pharmacy",
    tagline:     hospital.tagline,
    logo:        hospital.showLogoInPrint && hospital.logo,
    address:     _fmtAddr(hospital),
    phone:       hospital.phone1,
    email:       hospital.email,
    gstin:       hospital.gstin,
    drugLicense: hospital.drugLicenseNo || hospital.drugLicenseNumber,
  };
}

const PharmacyRegister = ({ settings = {}, receipt = {} }) => {
  const id = resolveIdentity(settings, receipt.pharmacySettings);
  const cols   = receipt.columns || [];
  const rows   = receipt.rows || [];
  const totals = receipt.totals || {};
  const accent = receipt.color || "#475569";

  const COL = { ink: "#0f172a", mute: "#64748b", line: "#e2e8f0", soft: "#f8fafc" };

  return (
    <>
      <style>{`
        .pr-pharm-reg { font-size: 10px; }
        html[data-paper="half-a4"] .pr-pharm-reg { font-size: 8.5px; }
        html[data-paper="a5"]      .pr-pharm-reg { font-size: 8.5px; }
        .pr-pharm-reg .reg-mast    { padding: 14px 22px; }
        .pr-pharm-reg .reg-mast-logo { width: 50px; height: 50px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-mast      { padding: 8px 16px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-mast-logo { width: 34px; height: 34px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-mast-name { font-size: 13px !important; }
        .pr-pharm-reg .reg-title { padding: 10px 22px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-title { padding: 6px 16px; }
        .pr-pharm-reg .reg-table-wrap { padding: 0 22px 12px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-table-wrap { padding: 0 16px 6px; }
        .pr-pharm-reg .reg-table th { padding: 7px 9px; font-size: 9px; }
        .pr-pharm-reg .reg-table td { padding: 6px 9px; font-size: 9.5px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-table th { padding: 4px 6px; font-size: 7.5px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-table td { padding: 3px 6px; font-size: 8.2px; line-height: 1.25; }
        .pr-pharm-reg .reg-foot { padding: 10px 22px; font-size: 9px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-foot { padding: 6px 16px; font-size: 7.5px; }
        @media print {
          .pr-pharm-reg thead tr { background: ${accent} !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="pr-page pr-pharm-reg" style={{ padding: 0, fontFamily: "'DM Sans', system-ui, sans-serif", color: COL.ink }}>
        {/* MASTHEAD */}
        <div className="reg-mast" style={{
          background: `linear-gradient(135deg, ${accent} 0%, ${accent}dd 100%)`,
          color: "#fff", display: "flex", alignItems: "center", gap: 14,
        }}>
          {id.logo && <img src={id.logo} alt="" className="reg-mast-logo" style={{ objectFit: "contain", background: "#fff", padding: 4, borderRadius: 8 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="reg-mast-name" style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.2px" }}>{id.name}</div>
            {id.tagline && <div style={{ fontSize: 10.5, opacity: .9, marginTop: 1 }}>{id.tagline}</div>}
            <div style={{ fontSize: 10, opacity: .85, marginTop: 3 }}>
              {id.address}
              {(id.phone || id.email) && (<><br/>{id.phone && <>📞 {id.phone}</>}{id.phone && id.email && " · "}{id.email && <>✉ {id.email}</>}</>)}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 9.5, opacity: .92, background: "rgba(0,0,0,.18)", padding: "8px 12px", borderRadius: 6 }}>
            {id.gstin       && <div>GSTIN · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.gstin}</b></div>}
            {id.drugLicense && <div style={{ marginTop: 2 }}>D.L. · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.drugLicense}</b></div>}
          </div>
        </div>

        {/* TITLE BAND */}
        <div className="reg-title" style={{
          background: COL.soft, borderBottom: `1.5px solid ${COL.line}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: COL.mute, letterSpacing: ".8px", textTransform: "uppercase" }}>Statutory Register</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: accent, marginTop: 2 }}>{receipt.title || "Register"}</div>
            {receipt.subtitle && <div style={{ fontSize: 10, color: COL.mute, marginTop: 2 }}>{receipt.subtitle}</div>}
          </div>
          <div style={{ textAlign: "right", fontSize: 9.5, color: COL.mute }}>
            <div>Generated <b>{new Date().toLocaleString("en-IN")}</b></div>
            <div>Rows: <b>{rows.length}</b></div>
          </div>
        </div>

        {/* TOTALS SUMMARY (if any) */}
        {totals && Object.keys(totals).length > 0 && (
          <div style={{ padding: "8px 22px", borderBottom: `1px solid ${COL.line}`, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 10.5 }}>
            {Object.entries(totals).map(([k, v]) => (
              <div key={k} style={{
                display: "flex", flexDirection: "column", gap: 1,
                padding: "4px 12px", background: COL.soft,
                borderRadius: 5, border: `1px solid ${COL.line}`,
              }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, color: COL.mute, textTransform: "uppercase", letterSpacing: ".5px" }}>{k}</span>
                <span style={{ fontWeight: 800, color: accent }}>{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {/* TABLE */}
        <div className="reg-table-wrap">
          <table className="reg-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: accent, color: "#fff" }}>
                {cols.map(c => (
                  <th key={c.key} style={{
                    textAlign: c.align || "left", fontSize: 9, fontWeight: 800,
                    letterSpacing: ".3px", whiteSpace: "nowrap",
                    width: c.w || "auto",
                  }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={cols.length} style={{ padding: 24, textAlign: "center", color: COL.mute, fontStyle: "italic", border: `1px solid ${COL.line}` }}>No records.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COL.line}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                  {cols.map(c => (
                    <td key={c.key} style={{
                      textAlign: c.align || "left",
                      fontFamily: c.mono ? "DM Mono, monospace" : undefined,
                      color: c.muted ? COL.mute : COL.ink,
                      whiteSpace: c.nowrap ? "nowrap" : undefined,
                      fontWeight: c.bold ? 700 : undefined,
                    }}>{r[c.key] != null ? String(r[c.key]) : "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* FOOTER */}
        <div className="reg-foot" style={{ borderTop: `2px solid ${accent}`, background: COL.soft, color: COL.mute, display: "flex", justifyContent: "space-between" }}>
          <span>This is an auto-generated register from the pharmacy module. Retain as per Drugs &amp; Cosmetics Rules + GST audit.</span>
          <span style={{ marginLeft: 12 }}>{id.name} · {id.address}</span>
        </div>
      </div>
    </>
  );
};

export default PharmacyRegister;
