// Components/print/Letterhead.jsx
//
// THE ONE canonical hospital letterhead for the whole HIS.
//
// A single identity band (logo · name · tagline · address · phone/email/web
// on the left–centre, GSTIN · Reg No · PAN · ROHINI · NABH/NABL on the right)
// plus an OPTIONAL accent document-title bar. Every print surface and every
// on-screen preview renders THIS component so the letterhead is byte-identical
// everywhere — "yahi wala letterhead sabhi jagah, internally bhi or prints pr bhi".
//
// Three entry points, ONE contract (`settings` = HospitalSettings shape,
// with legacy `hospital.name` / `hospital.phone` accepted defensively):
//   • <Letterhead settings={…} documentTitle="…" serialNo="…" />   (React)
//   • buildLetterheadHtml({ settings, documentTitle, … })          (HTML string)
//   • LETTERHEAD_CSS                                                (CSS text for
//                                                                    popup <head>)
//
// Colours come from settings.printHeaderColor / printAccentColor so a single
// admin change re-skins every document. Fields resolve from the canonical
// HospitalSettings schema (hospitalName, phone1/phone2, addressLine1/2, city,
// state, pincode, country, registrationNo, rohiniId, panNumber, gstin,
// nabhCertNumber, nabl, logo…). ROHINI + Reg No + PAN now appear on EVERY
// document, not just the pr- shell.

import React from "react";
import "./letterhead.css";
// Vite `?inline` returns the compiled stylesheet as a string so the pf- shell's
// buildPrintShellHtml() can embed it in a standalone window.open() <head>.
// eslint-disable-next-line import/no-unresolved
import letterheadCssText from "./letterhead.css?inline";
import { absoluteLogoUrl } from "../../utils/printUtils";

export const LETTERHEAD_CSS =
  typeof letterheadCssText === "string" ? letterheadCssText : "";

/* ── shared pure helpers (used by both React + HTML branches) ────────── */

const esc = (v) => {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

// Accept BOTH the canonical HospitalSettings shape (hospitalName, phone1…) and
// the legacy `hospital.*` shape (name, phone, logoUrl) the pf- shell used to
// read, so any existing caller keeps working through the unified component.
const norm = (s = {}) => ({
  hospitalName: s.hospitalName || s.name || "Hospital",
  tagline: s.tagline || "",
  logo: s.logo || s.logoUrl || "",
  logoWidth: s.logoWidth || 0,
  showLogoInPrint: s.showLogoInPrint !== false,
  showTaglineInPrint: s.showTaglineInPrint !== false,
  addressLine1: s.addressLine1 || "",
  addressLine2: s.addressLine2 || "",
  city: s.city || "",
  state: s.state || "",
  pincode: s.pincode || "",
  country: s.country || "",
  phone1: s.phone1 || s.phone || "",
  phone2: s.phone2 || "",
  email: s.email || "",
  website: s.website || "",
  gstin: s.gstin || "",
  registrationNo: s.registrationNo || "",
  panNumber: s.panNumber || "",
  rohiniId: s.rohiniId || "",
  nabhCertNumber: s.nabhCertNumber || "",
  nabl: !!s.nabl,
  printHeaderColor: s.printHeaderColor || "#1e293b",
  printAccentColor: s.printAccentColor || "#4f46e5",
});

const fmtAddress = (s) =>
  [
    s.addressLine1,
    s.addressLine2,
    [s.city, s.state, s.pincode].filter(Boolean).join(", "),
    s.country,
  ]
    .filter(Boolean)
    .join(", ");

// Contact line pieces — omitted when empty so no "—" ever prints.
const contactParts = (s) =>
  [
    s.phone1 && `📞 ${s.phone1}`,
    s.phone2 || "",
    s.email && `✉ ${s.email}`,
    s.website && `🌐 ${s.website}`,
  ].filter(Boolean);

/* ── React component ─────────────────────────────────────────────────── */

export default function Letterhead({
  settings = {},
  documentTitle = "",
  documentSubtitle = "",
  serialNo = "",
  screen = false,
}) {
  const s = norm(settings);
  const addr = fmtAddress(s);
  const contact = contactParts(s);
  const showNabh = !!String(s.nabhCertNumber).trim();

  return (
    <div
      className={`lh${screen ? " lh--screen" : ""}`}
      style={{
        "--lh-header-color": s.printHeaderColor,
        "--lh-accent-color": s.printAccentColor,
      }}
    >
      <div className="lh-header">
        {s.showLogoInPrint ? (
          <img
            className="lh-logo"
            /* An UPLOADED logo is a backend /uploads path → absolutise it.
               The baked fallback lives in the FRONTEND /public, so keep it a
               plain relative URL (absoluteLogoUrl would wrongly point it at the
               API host and 404). */
            src={s.logo ? absoluteLogoUrl(s.logo) : "/bims-logo.png"}
            alt=""
            style={s.logoWidth ? { width: s.logoWidth, maxWidth: "30%", height: "auto" } : undefined}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : null}
        <div className="lh-body">
          <h1 className="lh-name">{s.hospitalName}</h1>
          {s.showTaglineInPrint && s.tagline ? (
            <div className="lh-tagline">{s.tagline}</div>
          ) : null}
          {addr ? <div className="lh-addr">{addr}</div> : null}
          {contact.length ? (
            <div className="lh-addr" style={{ marginTop: 3 }}>
              {contact.join("  ·  ")}
            </div>
          ) : null}
        </div>
        <div className="lh-meta">
          {s.gstin          ? <div><strong>GSTIN:</strong> {s.gstin}</div> : null}
          {s.registrationNo ? <div><strong>Reg No:</strong> {s.registrationNo}</div> : null}
          {s.panNumber      ? <div><strong>PAN:</strong> {s.panNumber}</div> : null}
          {s.rohiniId       ? <div><strong>ROHINI:</strong> {s.rohiniId}</div> : null}
          {(showNabh || s.nabl) ? (
            <div style={{ marginTop: 4 }}>
              {showNabh ? (
                <span
                  className="lh-accred lh-accred--nabh"
                  title={`NABH Accredited · Cert ${s.nabhCertNumber}`}
                >NABH</span>
              ) : null}
              {s.nabl ? <span className="lh-accred lh-accred--nabl">NABL</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      {documentTitle ? (
        <div className="lh-titlebar">
          <div>
            <div className="lh-titlebar__title">{documentTitle}</div>
            {documentSubtitle ? (
              <div className="lh-titlebar__sub">{documentSubtitle}</div>
            ) : null}
          </div>
          {serialNo ? <span className="lh-titlebar__no">{serialNo}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── HTML-string builder (for window.open() popups via the pf- shell) ─── */

export function buildLetterheadHtml({
  settings = {},
  documentTitle = "",
  documentSubtitle = "",
  serialNo = "",
} = {}) {
  const s = norm(settings);
  const addr = fmtAddress(s);
  const contact = contactParts(s);
  const showNabh = !!String(s.nabhCertNumber).trim();

  // Uploaded logo → absolutise to the API host; baked fallback lives in the
  // FRONTEND /public, so anchor it to the opener's origin for the popup window.
  const _origin = (typeof window !== "undefined" && window.location) ? window.location.origin : "";
  const logoSrc = s.logo ? absoluteLogoUrl(s.logo) : `${_origin}/bims-logo.png`;
  const logoHtml = s.showLogoInPrint
    ? `<img class="lh-logo" src="${esc(logoSrc)}" alt="" onerror="this.style.display='none'"${
        s.logoWidth ? ` style="width:${esc(s.logoWidth)}px;max-width:30%;height:auto;"` : ""
      } />`
    : "";

  const metaRows = [
    s.gstin          ? `<div><strong>GSTIN:</strong> ${esc(s.gstin)}</div>` : "",
    s.registrationNo ? `<div><strong>Reg No:</strong> ${esc(s.registrationNo)}</div>` : "",
    s.panNumber      ? `<div><strong>PAN:</strong> ${esc(s.panNumber)}</div>` : "",
    s.rohiniId       ? `<div><strong>ROHINI:</strong> ${esc(s.rohiniId)}</div>` : "",
    (showNabh || s.nabl)
      ? `<div style="margin-top:4px;">${
          showNabh ? `<span class="lh-accred lh-accred--nabh" title="NABH Accredited · Cert ${esc(s.nabhCertNumber)}">NABH</span>` : ""
        }${s.nabl ? `<span class="lh-accred lh-accred--nabl">NABL</span>` : ""}</div>`
      : "",
  ].join("");

  const titleBar = documentTitle
    ? `<div class="lh-titlebar">
        <div>
          <div class="lh-titlebar__title">${esc(documentTitle)}</div>
          ${documentSubtitle ? `<div class="lh-titlebar__sub">${esc(documentSubtitle)}</div>` : ""}
        </div>
        ${serialNo ? `<span class="lh-titlebar__no">${esc(serialNo)}</span>` : ""}
      </div>`
    : "";

  return `<div class="lh" style="--lh-header-color:${esc(s.printHeaderColor)};--lh-accent-color:${esc(s.printAccentColor)};">
    <div class="lh-header">
      ${logoHtml}
      <div class="lh-body">
        <h1 class="lh-name">${esc(s.hospitalName)}</h1>
        ${s.showTaglineInPrint && s.tagline ? `<div class="lh-tagline">${esc(s.tagline)}</div>` : ""}
        ${addr ? `<div class="lh-addr">${esc(addr)}</div>` : ""}
        ${contact.length ? `<div class="lh-addr" style="margin-top:3px;">${esc(contact.join("  ·  "))}</div>` : ""}
      </div>
      <div class="lh-meta">${metaRows}</div>
    </div>
    ${titleBar}
  </div>`;
}
