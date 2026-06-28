/**
 * PharmacyRegister.jsx — generic printable for all 6 statutory
 * pharmacy registers: Sales, Purchase, Stock (Form 35), Schedule
 * H/H1/X, Expiry, GST Summary.
 *
 * Header style is controlled by:
 *   receipt.headerStyle        (override per-print)        — wins first
 *   pharmacySettings.registerHeader (saved default 1-5)    — falls back to this
 *   1 by default                                             — finally to this
 *
 *   1. Classic Centred       formal, B&W, serif-y, "official" feel
 *   2. Modern Gradient       coloured masthead + logo (current default)
 *   3. Compact Strip         single inline row — name · address · GSTIN
 *   4. Government Stamp      bordered box, all-uppercase, courier
 *   5. Letterhead            centred name + accent rule + meta row
 *
 * Visual toggles also respected:
 *   registerShowLogo, registerShowGstin, registerShowDL,
 *   registerShowContact, registerSerialColumn, registerSignatures,
 *   registerOrientation (portrait | landscape).
 */
import React from "react";
import "../print.css";
import PrintWatermark from "../PrintWatermark";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

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
      color:       pharmacy.headerColor || "#1e293b",
      accent:      pharmacy.accentColor || "#475569",
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
    color:       hospital.printHeaderColor || "#1e293b",
    accent:      hospital.printAccentColor || "#4f46e5",
  };
}

/* ────────────────────────────────────────────────────────────────
   HEADER STYLES — 5 visual variants
──────────────────────────────────────────────────────────────── */
function HeaderClassic({ id, opts, accent }) {
  return (
    <div style={{ textAlign: "center", padding: "16px 22px 12px", borderBottom: `2px solid #000`, fontFamily: "'Times New Roman', serif" }}>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "3px", textTransform: "uppercase" }}>{id.name}</div>
      {id.tagline && <div style={{ fontSize: 9.5, fontStyle: "italic", color: "#475569", marginTop: 2 }}>{id.tagline}</div>}
      <div style={{ fontSize: 10, marginTop: 6, fontFamily: "'DM Mono', monospace" }}>{id.address}</div>
      {opts.showContact && (id.phone || id.email) && (
        <div style={{ fontSize: 10, marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
          {id.phone && <>{id.phone}</>}
          {id.phone && id.email && " · "}
          {id.email && <>{id.email}</>}
        </div>
      )}
      {(opts.showGstin || opts.showDL) && (
        <div style={{ fontSize: 10, marginTop: 4, fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>
          {opts.showGstin && id.gstin       && <>GSTIN: {id.gstin}</>}
          {opts.showGstin && opts.showDL && id.gstin && id.drugLicense && " · "}
          {opts.showDL    && id.drugLicense && <>D.L.: {id.drugLicense}</>}
        </div>
      )}
    </div>
  );
}

function HeaderGradient({ id, opts, accent }) {
  return (
    <div className="reg-mast" style={{
      padding: "14px 22px",
      background: `linear-gradient(135deg, ${id.color || accent} 0%, ${id.accent || accent}dd 100%)`,
      color: "#fff", display: "flex", alignItems: "center", gap: 14,
    }}>
      {opts.showLogo && id.logo && <img src={id.logo} alt="" style={{ width: 50, height: 50, objectFit: "contain", background: "#fff", padding: 4, borderRadius: 8 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.2px" }}>{id.name}</div>
        {id.tagline && <div style={{ fontSize: 10.5, opacity: .9, marginTop: 1 }}>{id.tagline}</div>}
        <div style={{ fontSize: 10, opacity: .85, marginTop: 3 }}>
          {id.address}
          {opts.showContact && (id.phone || id.email) && (<><br/>{id.phone && <>📞 {id.phone}</>}{id.phone && id.email && " · "}{id.email && <>✉ {id.email}</>}</>)}
        </div>
      </div>
      {(opts.showGstin || opts.showDL) && (
        <div style={{ textAlign: "right", fontSize: 9.5, opacity: .92, background: "rgba(0,0,0,.18)", padding: "8px 12px", borderRadius: 6 }}>
          {opts.showGstin && id.gstin       && <div>GSTIN · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.gstin}</b></div>}
          {opts.showDL    && id.drugLicense && <div style={{ marginTop: 2 }}>D.L. · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.drugLicense}</b></div>}
        </div>
      )}
    </div>
  );
}

function HeaderStrip({ id, opts, accent }) {
  return (
    <div style={{ padding: "10px 22px", borderBottom: `2px solid ${accent}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {opts.showLogo && id.logo && <img src={id.logo} alt="" style={{ width: 38, height: 38, objectFit: "contain" }} />}
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: accent }}>{id.name}</div>
        <div style={{ fontSize: 9.5, color: "#475569", marginTop: 1 }}>
          {id.address}
          {opts.showContact && (id.phone || id.email) && <> · {id.phone}{id.phone && id.email && " · "}{id.email}</>}
        </div>
      </div>
      {(opts.showGstin || opts.showDL) && (
        <div style={{ fontSize: 9.5, color: "#475569", fontFamily: "DM Mono, monospace", textAlign: "right" }}>
          {opts.showGstin && id.gstin       && <div>GSTIN · <b>{id.gstin}</b></div>}
          {opts.showDL    && id.drugLicense && <div>D.L. · <b>{id.drugLicense}</b></div>}
        </div>
      )}
    </div>
  );
}

function HeaderStamp({ id, opts, accent }) {
  return (
    <div style={{ margin: "12px 18px", border: "3px double #000", padding: 6, fontFamily: "'Courier New', monospace" }}>
      <div style={{ border: "1px solid #000", padding: "12px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase" }}>{id.name}</div>
        <div style={{ fontSize: 10, marginTop: 4 }}>{id.address}</div>
        {opts.showContact && (id.phone || id.email) && (
          <div style={{ fontSize: 9.5, marginTop: 1 }}>{id.phone}{id.phone && id.email && " · "}{id.email}</div>
        )}
        {(opts.showGstin || opts.showDL) && (
          <div style={{ fontSize: 9.5, marginTop: 4, fontWeight: 700, paddingTop: 4, borderTop: "1px dashed #000" }}>
            {opts.showGstin && id.gstin       && <>GSTIN: {id.gstin}</>}
            {opts.showGstin && opts.showDL && id.gstin && id.drugLicense && " · "}
            {opts.showDL    && id.drugLicense && <>D.L.: {id.drugLicense}</>}
          </div>
        )}
      </div>
    </div>
  );
}

function HeaderLetterhead({ id, opts, accent }) {
  return (
    <div style={{ padding: "16px 22px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {opts.showLogo && id.logo && <img src={id.logo} alt="" style={{ width: 56, height: 56, objectFit: "contain" }} />}
        <div style={{ flex: 1, textAlign: opts.showLogo && id.logo ? "left" : "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: accent, letterSpacing: "-.3px" }}>{id.name}</div>
          {id.tagline && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, fontStyle: "italic" }}>{id.tagline}</div>}
          <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>{id.address}</div>
        </div>
      </div>
      <div style={{ marginTop: 8, paddingTop: 6, borderTop: `2px solid ${accent}`, display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "#475569" }}>
        {opts.showContact && <span>{id.phone} {id.email && `· ${id.email}`}</span>}
        <span>
          {opts.showGstin && id.gstin       && <>GSTIN · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.gstin}</b></>}
          {opts.showGstin && opts.showDL && id.gstin && id.drugLicense && " · "}
          {opts.showDL    && id.drugLicense && <>D.L. · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.drugLicense}</b></>}
        </span>
      </div>
    </div>
  );
}

const HEADER_RENDERERS = { 1: HeaderClassic, 2: HeaderGradient, 3: HeaderStrip, 4: HeaderStamp, 5: HeaderLetterhead };

// R7hr-49: register print is now single-template. The picker (and the
// HEADER_RENDERERS dispatch) both surface only Compact Strip. The other
// renderer functions (HeaderClassic/Gradient/Stamp/Letterhead) remain in
// this file as dead code so revert is a one-line registry restore.
export const REGISTER_HEADERS = [
  { id: 3, label: "Compact Strip", sub: "Single-row inline · saves space" },
];

/* ────────────────────────────────────────────────────────────────
   MAIN REGISTER COMPONENT
──────────────────────────────────────────────────────────────── */
const PharmacyRegister = ({ settings = {}, receipt = {} }) => {
  const id = resolveIdentity(settings, receipt.pharmacySettings);
  const ph = receipt.pharmacySettings || {};
  const cols   = receipt.columns || [];
  const rows   = receipt.rows || [];
  const totals = receipt.totals || {};
  const accent = receipt.color || id.accent || "#475569";
  // R7bh-F7 / R7bg-7-CRIT-3: watermark + amount-in-words wiring on
  // statutory pharmacy register reprints. Total value (sales / purchase
  // / closing stock) renders in words at the foot per GST §46 idiom +
  // NABH AAC.7 financial-trail standard.
  const printCount = toNum(receipt.printCount);
  const totalForWords = toNum(
    totals.grandTotal ?? totals["Grand Total"] ??
    totals.totalValue ?? totals["Total Value"] ??
    totals.totalAmount ?? totals.total ??
    receipt.totalForWords
  );

  // R7hr-49: register print is now single-template (Compact Strip · #3).
  // Force the dispatcher to id=3 regardless of saved settings so legacy
  // PUTs / old payloads with headerStyle=1/2/4/5 still print as Compact
  // Strip. Other header renderers (Classic/Gradient/Stamp/Letterhead) are
  // retired but kept in the codebase as dead exports for clean revert.
  const headerStyleId = 3;
  const Header = HEADER_RENDERERS[headerStyleId] || HeaderStrip;

  const opts = {
    showLogo:    ph.registerShowLogo    !== false,
    showGstin:   ph.registerShowGstin   !== false,
    showDL:      ph.registerShowDL      !== false,
    showContact: ph.registerShowContact !== false,
    serial:      ph.registerSerialColumn !== false,
    signatures:  ph.registerSignatures  !== false,
    orientation: ph.registerOrientation || "landscape",
  };

  // Auto-prepend a S.No. column if requested
  const displayCols = opts.serial
    ? [{ key: "_sno", label: "S.No.", align: "right", w: 36, muted: true }, ...cols]
    : cols;

  const COL = { ink: "#0f172a", mute: "#64748b", line: "#e2e8f0", soft: "#f8fafc" };

  // Header style 4 (Government Stamp) flips the whole register into a
  // Courier-mono, grid-lined, B&W aesthetic — masthead + title band +
  // totals strip + table + signatures + footer ALL match. Toggled
  // via the `reg-gov` class on the root.
  const isGov = headerStyleId === 4;

  return (
    <>
      <style>{`
        .pr-pharm-reg { font-size: 10px; }
        html[data-paper="half-a4"] .pr-pharm-reg { font-size: 8.5px; }
        html[data-paper="a5"]      .pr-pharm-reg { font-size: 8.5px; }
        .pr-pharm-reg .reg-mast    { padding: 14px 22px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-mast { padding: 8px 16px; }
        .pr-pharm-reg .reg-title { padding: 10px 22px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-title { padding: 6px 16px; }
        .pr-pharm-reg .reg-table-wrap { padding: 0 22px 12px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-table-wrap { padding: 0 16px 6px; }
        .pr-pharm-reg .reg-table th { padding: 7px 9px; font-size: 9px; }
        .pr-pharm-reg .reg-table td { padding: 6px 9px; font-size: 9.5px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-table th { padding: 4px 6px; font-size: 7.5px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-table td { padding: 3px 6px; font-size: 8.2px; line-height: 1.25; }
        .pr-pharm-reg .reg-table tbody tr { page-break-inside: avoid; }
        .pr-pharm-reg .reg-table thead   { display: table-header-group; }
        .pr-pharm-reg .reg-table tfoot   { display: table-footer-group; }
        .pr-pharm-reg .reg-foot { padding: 10px 22px; font-size: 9px; }
        html[data-paper="half-a4"] .pr-pharm-reg .reg-foot { padding: 6px 16px; font-size: 7.5px; }
        /* Belt-and-braces: kill any forced height / page-break that the
           generic .pr-page rules might leave behind. Without this, a
           register that fits on one page still produces a phantom 2nd. */
        @media print {
          .pr-pharm-reg { min-height: 0 !important; height: auto !important;
                          page-break-after: avoid !important; break-after: avoid-page !important; }
          .pr-pharm-reg > *:last-child { page-break-after: avoid !important; }
        }
        @media print {
          /* @page rules live in print.css, driven by html[data-paper] + html[data-orient].
             The toolbar's portrait/landscape pill + paper-size dropdown set those attributes.
             Don't override here — let the user's toolbar choice win. */
          .pr-pharm-reg:not(.reg-gov) thead tr { background: ${accent} !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }

        /* ── Government-style overrides — applied when headerStyle = 4.
           Whole register switches to Courier mono, grid borders, B&W. ── */
        .pr-pharm-reg.reg-gov,
        .pr-pharm-reg.reg-gov * { font-family: 'Courier New', monospace !important; }
        .pr-pharm-reg.reg-gov                       { color: #000; }
        .pr-pharm-reg.reg-gov .reg-title            { background: #fff !important; border-bottom: 2px solid #000 !important; }
        .pr-pharm-reg.reg-gov .reg-title-eyebrow    { color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-title-name       { color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-title-meta       { color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-totals-strip     { background: #fff !important; border-bottom: 1.5px solid #000 !important; }
        .pr-pharm-reg.reg-gov .reg-totals-chip      { background: #fff !important; border: 1.5px solid #000 !important; color: #000 !important; border-radius: 0 !important; }
        .pr-pharm-reg.reg-gov .reg-totals-chip .reg-totals-k { color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-totals-chip .reg-totals-v { color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-table            { border: 2px solid #000; }
        .pr-pharm-reg.reg-gov .reg-table thead tr   { background: #fff !important; color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-table th,
        .pr-pharm-reg.reg-gov .reg-table td         { border: 1px solid #000 !important; color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-table tbody tr   { background: #fff !important; }
        .pr-pharm-reg.reg-gov .reg-sign-line        { border-color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-sign-label       { color: #000 !important; }
        .pr-pharm-reg.reg-gov .reg-foot             { background: #fff !important; border-top: 2px solid #000 !important; color: #000 !important; }

        @media print {
          .pr-pharm-reg.reg-gov thead tr { background: #fff !important; color: #000 !important; }
        }
      `}</style>

      <div className={`pr-page pr-pharm-reg ${isGov ? "reg-gov" : ""}`} style={{ padding: 0, fontFamily: isGov ? "'Courier New', monospace" : "'DM Sans', system-ui, sans-serif", color: COL.ink, position: "relative" }}>
        {/* R7bh-F7 / R7bg-7-CRIT-3: DUPLICATE watermark on register reprints
            so an auditor / inspector can spot a reissued copy at a glance.
            Hidden on first print (printCount<=1). */}
        <PrintWatermark printCount={printCount} />

        {/* HEADER — picked from the 5 styles */}
        <Header id={id} opts={opts} accent={accent} />

        {/* TITLE BAND */}
        <div className="reg-title" style={{
          background: COL.soft, borderBottom: `1.5px solid ${COL.line}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div className="reg-title-eyebrow" style={{ fontSize: 9, fontWeight: 800, color: COL.mute, letterSpacing: ".8px", textTransform: "uppercase" }}>Statutory Register</div>
            <div className="reg-title-name" style={{ fontSize: 15, fontWeight: 800, color: accent, marginTop: 2 }}>{receipt.title || "Register"}</div>
            {receipt.subtitle && <div className="reg-title-meta" style={{ fontSize: 10, color: COL.mute, marginTop: 2 }}>{receipt.subtitle}</div>}
          </div>
          <div className="reg-title-meta" style={{ textAlign: "right", fontSize: 9.5, color: COL.mute }}>
            <div>Generated <b>{new Date().toLocaleString("en-IN")}</b></div>
            <div>Rows: <b>{rows.length}</b></div>
          </div>
        </div>

        {/* TOTALS SUMMARY */}
        {totals && Object.keys(totals).length > 0 && (
          <div className="reg-totals-strip" style={{ padding: "8px 22px", borderBottom: `1px solid ${COL.line}`, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 10.5 }}>
            {Object.entries(totals).map(([k, v]) => (
              <div key={k} className="reg-totals-chip" style={{
                display: "flex", flexDirection: "column", gap: 1,
                padding: "4px 12px", background: COL.soft,
                borderRadius: 5, border: `1px solid ${COL.line}`,
              }}>
                <span className="reg-totals-k" style={{ fontSize: 8.5, fontWeight: 800, color: COL.mute, textTransform: "uppercase", letterSpacing: ".5px" }}>{k}</span>
                <span className="reg-totals-v" style={{ fontWeight: 800, color: accent }}>{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {/* TABLE */}
        <div className="reg-table-wrap">
          <table className="reg-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: accent, color: "#fff" }}>
                {displayCols.map(c => (
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
                <tr><td colSpan={displayCols.length} style={{ padding: 24, textAlign: "center", color: COL.mute, fontStyle: "italic", border: `1px solid ${COL.line}` }}>No records.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COL.line}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                  {opts.serial && <td style={{ padding: "6px 9px", textAlign: "right", color: COL.mute, fontFamily: "DM Mono, monospace" }}>{i + 1}</td>}
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

        {/* R7bh-F7 / R7bg-7-CRIT-4: total in words. GST §46 idiom — every
            statutory register that carries a money total renders the
            total in words at the foot so a tampered numeric cell can be
            spotted on inspection. Only shown if a meaningful total is
            present in receipt.totals or as receipt.totalForWords. */}
        {totalForWords > 0 && (
          <div style={{ padding: "10px 22px 0", fontSize: 10.5 }}>
            <strong style={{ color: accent }}>Total in words:</strong>{" "}
            <span style={{ fontWeight: 600 }}>{numberToIndianWords(totalForWords)}</span>
          </div>
        )}

        {/* SIGNATURES */}
        {opts.signatures && rows.length > 0 && (
          <div style={{ padding: "18px 22px 8px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {["Prepared by", "Checked by", "Authorised by"].map(role => (
              <div key={role} style={{ textAlign: "center" }}>
                <div className="reg-sign-line" style={{ height: 36, borderBottom: `1.5px solid ${COL.ink}` }} />
                <div className="reg-sign-label" style={{ fontSize: 9, color: COL.mute, marginTop: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>{role}</div>
              </div>
            ))}
          </div>
        )}

        {/* FOOTER */}
        <div className="reg-foot" style={{ borderTop: `2px solid ${accent}`, background: COL.soft, color: COL.mute, display: "flex", justifyContent: "space-between" }}>
          <span>Auto-generated · retain per Drugs &amp; Cosmetics Rules + GST audit.</span>
          <span style={{ marginLeft: 12 }}>{id.name}</span>
        </div>
      </div>
    </>
  );
};

export default PharmacyRegister;
