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
import { buildPrintIssuer } from "./printIssuer";

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
  // R7cf: empty signature lines replaced with a real digital-signature
  // stamp. `signatureLabels` is retained as a prop but no longer
  // rendered — every printable now stamps the issuing user identity
  // instead of leaving lines for handwritten signatures. Callers that
  // need a specific issuer (doctor sign-and-submit, original cashier
  // on reprint) pass `signedBy` to override the stored user.
  signatureLabels = ["Authorised Signatory", "Patient / Attendant"], // eslint-disable-line no-unused-vars
  signedBy,
  // OPD-PRINT-AUDIT Item 2 + 12: data URL of doctor's signature stamp.
  // When present, rendered above the digital-signature name as <img>.
  signatureImage,
  // OPD-PRINT-AUDIT Item 12 / R7cf: ISO timestamp of e-sign — used for
  // the "Signed at" line of the stamp. Falls back to "now" if omitted.
  signedAt,
  showTerms = true,
  // OPD-PRINT-AUDIT Item 20: caller-provided header extra (e.g. QR code).
  // Rendered top-right inside the patient info strip.
  headerExtra,
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
          {/* R7cg: NABH pill on the print header now gates on
              `nabhCertNumber` instead of the legacy `nabh` boolean
              (which defaults true in the schema and was misleading on
              fresh installs). Once admin enters the cert# in
              Hospital Configuration → NABH tab, the pill renders and
              carries the actual cert# in a tooltip for surveyor visits.
              NABL stays on its boolean — that one defaults false, so
              it only surfaces when admin explicitly turns it on. */}
          {(() => {
            const _cert = String(settings.nabhCertNumber || "").trim();
            const _showNabh = !!_cert;
            return (
              <div style={{ marginTop: 4 }}>
                {_showNabh && (
                  <span
                    className="pr-accred pr-accred--nabh"
                    title={`NABH Accredited · Cert ${_cert}`}
                  >NABH</span>
                )}
                {settings.nabl && <span className="pr-accred pr-accred--nabl">NABL</span>}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Title bar ── */}
      <div className="pr-title-bar">
        <span className="pr-title-bar__title">{documentTitle}</span>
        {serialNo && <span className="pr-title-bar__no">{serialNo}</span>}
      </div>

      {/* ── Info strip ──
           OPD-PRINT-AUDIT Item 20: when `headerExtra` is passed (QR code
           on Rx) the strip becomes a flex row — grid of info items on the
           left, extra slot on the right. */}
      {(infoItems.length > 0 || headerExtra) && (
        <div
          className={headerExtra ? "pr-info-grid pr-info-grid--with-extra" : "pr-info-grid"}
          style={headerExtra ? { display: "flex", alignItems: "center", gap: 14 } : undefined}
        >
          {infoItems.length > 0 && (
            /* R7ch: 2-column column-major flow keeps the strip balanced
               regardless of item count (Patient/UHID/Age on left,
               Doctor/Dept/Visit Date on right). headerExtra case (QR
               code beside the strip) uses the same column-count
               approach via inline style. */
            <div
              style={headerExtra ? {
                flex: 1,
                columnCount: 2,
                columnGap: "24px",
              } : undefined}
            >
              {infoItems.map((it, i) => (
                <div key={i} className="pr-info-grid__item">
                  <div className="pr-info-grid__lbl">{it.label}</div>
                  <div className="pr-info-grid__val">{it.value || "—"}</div>
                </div>
              ))}
            </div>
          )}
          {headerExtra && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
              {headerExtra}
            </div>
          )}
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

        {/* R7cf — Empty signature lines replaced with a real digital-
            signature stamp. Every document now carries proof of WHO
            issued / signed it (name, employee ID, role / designation,
            department, timestamp). Reads the per-tab user mirror
            sessionStorage['his_user'] set by AuthContext on login;
            print windows opened via window.open() inherit it, so the
            stamp lands on first paint. Callers may override via the
            `issuer` prop (e.g. a doctor's sign-and-submit stamps the
            doctor of record, not the receptionist who reprinted later)
            and `signedAt` (so reprints preserve the ORIGINAL sign time
            instead of "now"). */}
        {showSignatures && (() => {
          const issuer = buildPrintIssuer({ issuer: signedBy, signedAt });
          const metaLine = [
            issuer.designation || issuer.role,
            issuer.department,
            issuer.employeeId && `ID: ${issuer.employeeId}`,
          ].filter(Boolean).join(" · ");
          return (
            <div className="pr-digsig-row">
              <div className="pr-digsig">
                <div className="pr-digsig__badge">
                  <span aria-hidden="true">✓</span> DIGITALLY ISSUED
                </div>
                {signatureImage ? (
                  <img
                    src={signatureImage}
                    alt="signature"
                    className="pr-digsig__img"
                  />
                ) : null}
                <div className="pr-digsig__name">{issuer.name}</div>
                {metaLine ? <div className="pr-digsig__meta">{metaLine}</div> : null}
                <div className="pr-digsig__time">Signed {issuer.when}</div>
              </div>
            </div>
          );
        })()}

        {settings.billFooterNote && (
          <div className="pr-footer__note">{settings.billFooterNote}</div>
        )}

        {showTerms && (
          <div className="pr-terms">
            {settings.termsLine1 && <div>{settings.termsLine1}</div>}
            {settings.termsLine2 && <div>{settings.termsLine2}</div>}
            {settings.termsLine3 && <div>{settings.termsLine3}</div>}
            {/* R7cb-C: settings-driven "computer-generated" disclosure.
                Previously hardcoded "Powered by SphereHealth HIS" — now
                renders "Generated by <hospitalName> HIS" so a deployed
                tenant (e.g. "Apollo XYZ") sees their own brand. The
                disclosure itself is preserved for NABH AAC.7 traceability. */}
            <div style={{ marginTop: 4, opacity: .7 }}>
              Generated on {new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              {" "}· Generated by {settings.hospitalName || "Hospital"} HIS
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrintShell;
