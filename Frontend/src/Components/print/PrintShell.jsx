// Components/print/PrintShell.jsx
// Wraps any printable document body with a consistent
//   - hospital header (logo + name + tagline + address + GSTIN + accred)
//   - title bar (document title + serial no)
//   - patient/info strip (optional)
//   - body slot
//   - footer (bank details + signature row + terms + thank-you note)
//
// All header/footer content comes from /api/hospital-settings so a
// single admin change updates every printable.

import React from "react";
import "./print.css";
import PrintWatermark from "./PrintWatermark";
import { absoluteLogoUrl } from "../../utils/printUtils";

const fmtAddress = (s) => {
  const bits = [
    s.addressLine1, s.addressLine2,
    [s.city, s.state, s.pincode].filter(Boolean).join(", "),
    s.country,
  ].filter(Boolean);
  return bits.join(", ");
};

const PrintShell = ({
  settings = {},
  documentTitle = "Document",
  serialNo,
  infoItems = [],     // [{ label, value }] for the strip under title
  showBank = true,
  showSignatures = true,
  signatureLabels = ["Authorised Signatory", "Patient / Attendant"],
  showTerms = true,
  // R7bf-F / A4-CRIT-5: full-page DUPLICATE watermark when this is a
  // reprint. printCount=0/1 → original, no watermark. Caller passes the
  // value returned by recordPrintAudit() (utils/printUtils.js).
  printCount = 0,
  watermarkLabel,
  watermarkRecipient,
  // R7bf-F / A4-MED-3: per-printable font size override. Lab reports
  // default to 14pt (elderly-patient readability), bills stay 12pt.
  fontSize,
  children,
}) => {
  return (
    <div
      className="pr-page"
      style={{
        "--pr-header-color": settings.printHeaderColor || "#1e293b",
        "--pr-accent-color": settings.printAccentColor || "#1d4ed8",
        // Font-size knob — falls through to the global pr-page CSS rule
        // when not set, so legacy printables behave exactly as before.
        ...(fontSize ? { fontSize } : {}),
      }}
    >
      {/* R7bf-F / A4-CRIT-5: DUPLICATE / TRIPLICATE watermark.
          Renders nothing on first prints. */}
      <PrintWatermark
        printCount={printCount}
        label={watermarkLabel}
        recipient={watermarkRecipient}
      />

      {/* ── Header ── */}
      <div className="pr-header">
        {settings.showLogoInPrint && settings.logo ? (
          <img
            className="pr-header__logo"
            /* R7bf-F / A4-MED-2: rewrite relative logo to absolute URL
               so staging deploys don't 404 the asset. */
            src={absoluteLogoUrl(settings.logo)}
            alt="logo"
            style={{ width: settings.logoWidth || 120, maxWidth: "30%" }}
          />
        ) : null}
        <div className="pr-header__body">
          <h1 className="pr-header__name">{settings.hospitalName}</h1>
          {settings.showTaglineInPrint && settings.tagline ? (
            <div className="pr-header__tagline">{settings.tagline}</div>
          ) : null}
          <div className="pr-header__addr">
            {fmtAddress(settings) || "—"}
          </div>
          <div className="pr-header__addr" style={{ marginTop: 3 }}>
            {settings.phone1 && <>📞 {settings.phone1}</>}
            {settings.phone2 && <> · {settings.phone2}</>}
            {settings.email   && <> · ✉ {settings.email}</>}
            {settings.website && <> · 🌐 {settings.website}</>}
          </div>
        </div>
        <div className="pr-header__meta">
          {settings.gstin          && <div><strong>GSTIN:</strong> {settings.gstin}</div>}
          {settings.registrationNo && <div><strong>Reg No:</strong> {settings.registrationNo}</div>}
          {settings.panNumber      && <div><strong>PAN:</strong> {settings.panNumber}</div>}
          {settings.rohiniId       && <div><strong>ROHINI:</strong> {settings.rohiniId}</div>}
          <div style={{ marginTop: 4 }}>
            {settings.nabh && <span className="pr-accred pr-accred--nabh">NABH</span>}
            {settings.nabl && <span className="pr-accred pr-accred--nabl">NABL</span>}
          </div>
        </div>
      </div>

      {/* ── Title bar ── */}
      <div className="pr-title-bar">
        <span className="pr-title-bar__title">{documentTitle}</span>
        {serialNo && <span className="pr-title-bar__no">{serialNo}</span>}
      </div>

      {/* ── Info strip ── */}
      {infoItems.length > 0 && (
        <div className="pr-info-grid">
          {infoItems.map((it, i) => (
            <div key={i} className="pr-info-grid__item">
              <div className="pr-info-grid__lbl">{it.label}</div>
              <div className="pr-info-grid__val">{it.value || "—"}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Body slot ── */}
      <div style={{ flex: 1 }}>
        {children}
      </div>

      {/* ── Footer ── */}
      <div className="pr-footer">
        {showBank && (settings.bankName || settings.accountNo || settings.ifscCode) && (
          <div className="pr-bank">
            <strong>Bank:</strong> {settings.bankName || "—"}
            {settings.accountNo  && <> · <strong>A/C:</strong> {settings.accountNo}</>}
            {settings.ifscCode   && <> · <strong>IFSC:</strong> {settings.ifscCode}</>}
            {settings.bankBranch && <> · <strong>Branch:</strong> {settings.bankBranch}</>}
          </div>
        )}

        {showSignatures && (
          <div className="pr-signatures">
            {signatureLabels.map((label, i) => (
              <div key={i} className="pr-sig">
                <div className="pr-sig__line">{label}</div>
              </div>
            ))}
          </div>
        )}

        {settings.billFooterNote && (
          <div className="pr-footer__note">{settings.billFooterNote}</div>
        )}

        {showTerms && (
          <div className="pr-terms">
            {settings.termsLine1 && <div>{settings.termsLine1}</div>}
            {settings.termsLine2 && <div>{settings.termsLine2}</div>}
            {settings.termsLine3 && <div>{settings.termsLine3}</div>}
            <div style={{ marginTop: 4, opacity: .7 }}>
              Generated on {new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              {" "}· Powered by SphereHealth HIS
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrintShell;
