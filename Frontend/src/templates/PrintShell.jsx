/**
 * PrintShell.jsx — shared NABH-style print frame for the whole HIS.
 *
 * R7fq foundation.  All print templates (bills, advance receipts, refunds,
 * prescriptions, lab requisitions, discharge summaries, certificates…)
 * render through this shell so the visual identity stays consistent and
 * a single set of fields on HospitalSettings drives every page.
 *
 * Two exports — both honour the SAME `opts` contract:
 *   • default React component  <PrintShell {...opts}>{bodyJsx}</PrintShell>
 *   • named HTML helper        buildPrintShellHtml({...opts, bodyHtml})
 *                              → complete `<!doctype html>…` string
 *                                ready for `w.document.write(html)`.
 *
 * Visual references: scanned prints from Sir Ganga Ram, Max Saket,
 * Tirath Ram Shah hospitals.  Spec is encoded in printShell.css.
 */

import React from "react";
import "./printShell.css";
// Vite (>=4) supports `?inline` which returns the bundled stylesheet
// as a string — used so the HTML helper can embed the CSS in a
// standalone `<head>` for `window.open()` printing.
// eslint-disable-next-line import/no-unresolved
import printShellCssText from "./printShell.css?inline";

/* ============================================================
   Shared helpers (pure — used by both React + HTML branches)
   ============================================================ */

const esc = (v) => {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const fmtPrintedAt = (iso) => {
  try {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
};

const composeAddress = (h) => {
  const parts = [h.addressLine1, h.addressLine2, [h.city, h.pincode].filter(Boolean).join("-")]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  return parts.join(", ");
};

const composeContactLine = (h) => {
  const bits = [];
  if (h.phone) bits.push(`Phone: ${h.phone}`);
  if (h.email) bits.push(`Email: ${h.email}`);
  if (h.website) bits.push(`Web: ${h.website}`);
  return bits.join("  ·  ");
};

const composeGstinLine = (h) => {
  const bits = [];
  if (h.gstin) bits.push(`GSTIN: ${h.gstin}`);
  if (h.nabhCertNumber) bits.push(`NABH Cert: ${h.nabhCertNumber}`);
  return bits.join("  ·  ");
};

const safe = (o, k, d = "") => (o && o[k] != null ? o[k] : d);

const normalizeOpts = (opts = {}) => {
  const hospital = opts.hospital || {};
  const docTitle = opts.docTitle || "Document";
  const docSubtitle = opts.docSubtitle || "";
  const patient = {
    left:  Array.isArray(opts.patient?.left)  ? opts.patient.left  : [],
    right: Array.isArray(opts.patient?.right) ? opts.patient.right : [],
  };
  const sigInput = opts.signatures || {};
  const signatures = {
    type: sigInput.type || "prepared-by",
    preparedBy: sigInput.preparedBy || null,
    left: sigInput.left || null,
    right: sigInput.right || null,
    centre: sigInput.centre || sigInput.center || null,
    showAttestedStamp: !!sigInput.showAttestedStamp,
  };
  const banners = {
    emergency24x7: !!opts.banners?.emergency24x7,
    homeCare:      !!opts.banners?.homeCare,
    custom:        opts.banners?.custom || "",
  };
  const meta = {
    docNumber: opts.meta?.docNumber || "",
    pageOf:    opts.meta?.pageOf    || "",
    printedAt: opts.meta?.printedAt || new Date().toISOString(),
  };
  const showDisclaimer = opts.showDisclaimer !== false;
  return { hospital, docTitle, docSubtitle, patient, signatures, banners, meta, showDisclaimer };
};

/* ============================================================
   REACT COMPONENT
   ============================================================ */

export default function PrintShell(props) {
  const opts = normalizeOpts(props);
  const { hospital, docTitle, docSubtitle, patient, signatures, banners, meta, showDisclaimer } = opts;

  const headerColor = hospital.printHeaderColor || "#1e3a8a";
  const styleVars = { "--pf-header-color": headerColor };

  /* R7gb P0-13 — running-header source strings for CSS Paged Media.
     The @page rules in printShell.css read these via `string-set` so
     every printed sheet carries hospital + patient + UHID. Hooks pull
     from opts.patient.runningHeader when caller pre-computed canonical
     values; otherwise fall back to scanning the patient strip. */
  const rh = opts.patient?.runningHeader || {};
  const findKV = (lbl) => {
    const all = [...(patient.left || []), ...(patient.right || [])];
    const hit = all.find((kv) => String(kv.label || "").toLowerCase().includes(lbl));
    return hit ? String(hit.value || "") : "";
  };
  const rhHospital = rh.hospital || hospital.name || hospital.hospitalName || "Hospital";
  const rhPatient  = rh.patient  || findKV("patient") || "";
  const rhUhid     = rh.uhid     || findKV("uhid")    || "";
  const rhDocTitle = rh.docTitle || docTitle || "";

  return (
    <div className="pf-page" style={styleVars}>
      {/* R7gb P0-13 — hidden source strings the @page running headers
          read via CSS `string-set`. Must render BEFORE visible content
          so the first page gets correct values too. */}
      <div className="pf-page-strings" aria-hidden="true">
        <span className="pf-page-string-hospital">{rhHospital}</span>
        <span className="pf-page-string-patient">{rhPatient}</span>
        <span className="pf-page-string-uhid">{rhUhid}</span>
        <span className="pf-page-string-doctitle">{rhDocTitle}</span>
      </div>
      {/* 1. Triple-zone header */}
      <header className="pf-header">
        <div className="pf-header-left">
          {hospital.logo ? (
            <img src={hospital.logo} alt="" className="pf-logo" />
          ) : null}
          {hospital.taglineLeft ? (
            <div className="pf-tagline-side">{hospital.taglineLeft}</div>
          ) : null}
        </div>
        <div className="pf-header-center">
          <h1 className="pf-hospital-name" style={{ color: headerColor }}>
            {hospital.name || hospital.hospitalName || "Hospital"}
          </h1>
          {hospital.tagline ? (
            <div className="pf-tagline-main">{hospital.tagline}</div>
          ) : null}
        </div>
        <div className="pf-header-right">
          {hospital.nabhLogo ? (
            <img src={hospital.nabhLogo} alt="" className="pf-nabh-logo" />
          ) : null}
          {hospital.nabhSinceDate ? (
            <div className="pf-nabh-caption">ACCREDITED {hospital.nabhSinceDate}</div>
          ) : null}
          {hospital.nabhCertNumber ? (
            <div className="pf-nabh-cert">Cert No: {hospital.nabhCertNumber}</div>
          ) : null}
          {hospital.taglineRight ? (
            <div className="pf-tagline-side">{hospital.taglineRight}</div>
          ) : null}
        </div>
      </header>

      <div className="pf-header-divider" />

      {/* 3. Title bar */}
      <div className="pf-title-bar">
        <div className="pf-title">{docTitle}</div>
        {docSubtitle ? <div className="pf-subtitle">{docSubtitle}</div> : null}
      </div>

      {/* 4. Patient demographics strip */}
      {(patient.left.length > 0 || patient.right.length > 0) ? (
        <div className="pf-patient">
          <div>
            {patient.left.map((kv, i) => (
              <div className="pf-kv" key={`pL-${i}`}>
                <div className="pf-kv-label">{kv.label}</div>
                <div className="pf-kv-value">{kv.value}</div>
              </div>
            ))}
          </div>
          <div>
            {patient.right.map((kv, i) => (
              <div className="pf-kv" key={`pR-${i}`}>
                <div className="pf-kv-label">{kv.label}</div>
                <div className="pf-kv-value">{kv.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 5. Body — children */}
      <div className="pf-body">{props.children}</div>

      {/* 6. Signature zone */}
      <SignatureZone signatures={signatures} preparedByDefault={hospital.preparedByDefault} />

      {/* 7. Banners */}
      <BannerStack banners={banners} hospital={hospital} />

      {/* 8. Disclaimer */}
      {showDisclaimer && (hospital.printDisclaimer !== "") ? (
        <div className="pf-disclaimer">
          {hospital.printDisclaimer || "This is a computer generated document and does not require any signature."}
        </div>
      ) : null}

      {/* 9. Print metadata strip */}
      <div className="pf-meta-strip">
        <div>Printed: {fmtPrintedAt(meta.printedAt)}</div>
        <div>{meta.docNumber ? `Doc#: ${meta.docNumber}` : ""}</div>
        <div>{meta.pageOf ? `Page ${meta.pageOf}` : ""}</div>
      </div>

      {/* 10. Footer */}
      <Footer hospital={hospital} />
    </div>
  );
}

function SignatureZone({ signatures, preparedByDefault }) {
  const type = signatures.type || "prepared-by";
  if (type === "double") {
    return (
      <div className="pf-sig-zone">
        <div className="pf-sig-double">
          <div className="pf-sig-block left">
            {signatures.left?.name ? <div className="pf-sig-name">{signatures.left.name}</div> : null}
            {signatures.left?.role ? <div className="pf-sig-role">{signatures.left.role}</div> : <div className="pf-sig-role">Resident Doctor</div>}
            {signatures.left?.reg  ? <div className="pf-sig-reg">{signatures.left.reg}</div>  : null}
          </div>
          <div className="pf-sig-block right">
            {signatures.right?.name ? <div className="pf-sig-name">{signatures.right.name}</div> : null}
            {signatures.right?.role ? <div className="pf-sig-role">{signatures.right.role}</div> : <div className="pf-sig-role">Consultant</div>}
            {signatures.right?.reg  ? <div className="pf-sig-reg">{signatures.right.reg}</div>  : null}
          </div>
        </div>
        {signatures.showAttestedStamp ? <div className="pf-attested">Attested</div> : null}
      </div>
    );
  }
  if (type === "single") {
    const blk = signatures.centre || signatures.left || signatures.right || {};
    return (
      <div className="pf-sig-zone">
        <div className="pf-sig-single">
          <div className="pf-sig-block centre">
            {blk.name ? <div className="pf-sig-name">{blk.name}</div> : null}
            {blk.role ? <div className="pf-sig-role">{blk.role}</div> : null}
            {blk.reg  ? <div className="pf-sig-reg">{blk.reg}</div>  : null}
          </div>
        </div>
        {signatures.showAttestedStamp ? <div className="pf-attested">Attested</div> : null}
      </div>
    );
  }
  // prepared-by (default)
  const pb = signatures.preparedBy || {};
  const pbName = pb.name || preparedByDefault || "";
  const pbRole = pb.role || "Cashier";
  return (
    <div className="pf-sig-zone">
      <div className="pf-sig-prepared">
        <div className="pf-sig-block">
          <div className="pf-sig-prepared-label">Prepared By</div>
          {pbName ? <div className="pf-sig-name">{pbName}</div> : <div className="pf-sig-name">&nbsp;</div>}
          {pbRole ? <div className="pf-sig-role">{pbRole}</div> : null}
        </div>
      </div>
      {signatures.showAttestedStamp ? <div className="pf-attested">Attested</div> : null}
    </div>
  );
}

function BannerStack({ banners, hospital }) {
  const out = [];
  if (banners.emergency24x7 && hospital.helpline24x7) {
    out.push(
      <div className="pf-banner pf-banner-emergency" key="b-em">
        In case of any emergency please contact: {hospital.helpline24x7} (24×7)
      </div>
    );
  }
  if (banners.homeCare && hospital.homeCareBrand) {
    out.push(
      <div className="pf-banner pf-banner-home" key="b-hc">
        For post-hospital care at home, call {hospital.homeCareBrand}
        {hospital.homeCarePhone ? ` at ${hospital.homeCarePhone}` : ""} (24×7)
      </div>
    );
  }
  if (banners.custom) {
    out.push(
      <div className="pf-banner pf-banner-custom" key="b-cu">{banners.custom}</div>
    );
  }
  if (!out.length) return null;
  return <div className="pf-banners">{out}</div>;
}

function Footer({ hospital }) {
  const addr = composeAddress(hospital);
  const contact = composeContactLine(hospital);
  const gstLine = composeGstinLine(hospital);
  return (
    <footer className="pf-footer">
      {addr ? <div className="pf-footer-address">{addr}</div> : null}
      {contact ? <div className="pf-footer-line">{contact}</div> : null}
      {gstLine ? <div className="pf-footer-line">{gstLine}</div> : null}
    </footer>
  );
}

/* ============================================================
   HTML HELPER — sibling agents will use this from window.open()
   ============================================================ */

export function buildPrintShellHtml(opts = {}) {
  const { hospital, docTitle, docSubtitle, patient, signatures, banners, meta, showDisclaimer } = normalizeOpts(opts);
  const headerColor = hospital.printHeaderColor || "#1e3a8a";
  const bodyHtml = opts.bodyHtml || "";

  /* R7gb P0-13 — running-header source strings for the HTML helper.
     Same contract as the React component above. */
  const rh = opts.patient?.runningHeader || {};
  const findKV = (lbl) => {
    const all = [...(patient.left || []), ...(patient.right || [])];
    const hit = all.find((kv) => String(kv.label || "").toLowerCase().includes(lbl));
    return hit ? String(hit.value || "") : "";
  };
  const rhHospital = rh.hospital || hospital.name || hospital.hospitalName || "Hospital";
  const rhPatient  = rh.patient  || findKV("patient") || "";
  const rhUhid     = rh.uhid     || findKV("uhid")    || "";
  const rhDocTitle = rh.docTitle || docTitle || "";
  const pageStrings = `
    <div class="pf-page-strings" aria-hidden="true">
      <span class="pf-page-string-hospital">${esc(rhHospital)}</span>
      <span class="pf-page-string-patient">${esc(rhPatient)}</span>
      <span class="pf-page-string-uhid">${esc(rhUhid)}</span>
      <span class="pf-page-string-doctitle">${esc(rhDocTitle)}</span>
    </div>`;

  const headerLeft = `
    <div class="pf-header-left">
      ${hospital.logo ? `<img src="${esc(hospital.logo)}" alt="" class="pf-logo" />` : ""}
      ${hospital.taglineLeft ? `<div class="pf-tagline-side">${esc(hospital.taglineLeft)}</div>` : ""}
    </div>`;

  const headerCenter = `
    <div class="pf-header-center">
      <h1 class="pf-hospital-name" style="color:${esc(headerColor)};">${esc(hospital.name || hospital.hospitalName || "Hospital")}</h1>
      ${hospital.tagline ? `<div class="pf-tagline-main">${esc(hospital.tagline)}</div>` : ""}
    </div>`;

  const headerRight = `
    <div class="pf-header-right">
      ${hospital.nabhLogo ? `<img src="${esc(hospital.nabhLogo)}" alt="" class="pf-nabh-logo" />` : ""}
      ${hospital.nabhSinceDate ? `<div class="pf-nabh-caption">ACCREDITED ${esc(hospital.nabhSinceDate)}</div>` : ""}
      ${hospital.nabhCertNumber ? `<div class="pf-nabh-cert">Cert No: ${esc(hospital.nabhCertNumber)}</div>` : ""}
      ${hospital.taglineRight ? `<div class="pf-tagline-side">${esc(hospital.taglineRight)}</div>` : ""}
    </div>`;

  const titleBar = `
    <div class="pf-title-bar">
      <div class="pf-title">${esc(docTitle)}</div>
      ${docSubtitle ? `<div class="pf-subtitle">${esc(docSubtitle)}</div>` : ""}
    </div>`;

  const kvHtml = (kv) => `
      <div class="pf-kv">
        <div class="pf-kv-label">${esc(kv.label)}</div>
        <div class="pf-kv-value">${esc(kv.value)}</div>
      </div>`;

  const patientStrip = (patient.left.length || patient.right.length) ? `
    <div class="pf-patient">
      <div>${patient.left.map(kvHtml).join("")}</div>
      <div>${patient.right.map(kvHtml).join("")}</div>
    </div>` : "";

  const sigHtml = (() => {
    const stamp = signatures.showAttestedStamp ? `<div class="pf-attested">Attested</div>` : "";
    if (signatures.type === "double") {
      const L = signatures.left || {}, R = signatures.right || {};
      return `
        <div class="pf-sig-zone">
          <div class="pf-sig-double">
            <div class="pf-sig-block left">
              ${L.name ? `<div class="pf-sig-name">${esc(L.name)}</div>` : ""}
              <div class="pf-sig-role">${esc(L.role || "Resident Doctor")}</div>
              ${L.reg ? `<div class="pf-sig-reg">${esc(L.reg)}</div>` : ""}
            </div>
            <div class="pf-sig-block right">
              ${R.name ? `<div class="pf-sig-name">${esc(R.name)}</div>` : ""}
              <div class="pf-sig-role">${esc(R.role || "Consultant")}</div>
              ${R.reg ? `<div class="pf-sig-reg">${esc(R.reg)}</div>` : ""}
            </div>
          </div>
          ${stamp}
        </div>`;
    }
    if (signatures.type === "single") {
      const B = signatures.centre || signatures.left || signatures.right || {};
      return `
        <div class="pf-sig-zone">
          <div class="pf-sig-single">
            <div class="pf-sig-block centre">
              ${B.name ? `<div class="pf-sig-name">${esc(B.name)}</div>` : ""}
              ${B.role ? `<div class="pf-sig-role">${esc(B.role)}</div>` : ""}
              ${B.reg ? `<div class="pf-sig-reg">${esc(B.reg)}</div>` : ""}
            </div>
          </div>
          ${stamp}
        </div>`;
    }
    // prepared-by
    const pb = signatures.preparedBy || {};
    const pbName = pb.name || hospital.preparedByDefault || "";
    const pbRole = pb.role || "Cashier";
    return `
      <div class="pf-sig-zone">
        <div class="pf-sig-prepared">
          <div class="pf-sig-block">
            <div class="pf-sig-prepared-label">Prepared By</div>
            <div class="pf-sig-name">${pbName ? esc(pbName) : "&nbsp;"}</div>
            ${pbRole ? `<div class="pf-sig-role">${esc(pbRole)}</div>` : ""}
          </div>
        </div>
        ${stamp}
      </div>`;
  })();

  const bannerHtml = (() => {
    const lines = [];
    if (banners.emergency24x7 && hospital.helpline24x7) {
      lines.push(`<div class="pf-banner pf-banner-emergency">In case of any emergency please contact: ${esc(hospital.helpline24x7)} (24×7)</div>`);
    }
    if (banners.homeCare && hospital.homeCareBrand) {
      const tail = hospital.homeCarePhone ? ` at ${esc(hospital.homeCarePhone)}` : "";
      lines.push(`<div class="pf-banner pf-banner-home">For post-hospital care at home, call ${esc(hospital.homeCareBrand)}${tail} (24×7)</div>`);
    }
    if (banners.custom) {
      lines.push(`<div class="pf-banner pf-banner-custom">${esc(banners.custom)}</div>`);
    }
    if (!lines.length) return "";
    return `<div class="pf-banners">${lines.join("")}</div>`;
  })();

  const disclaimerHtml = (showDisclaimer && (hospital.printDisclaimer !== ""))
    ? `<div class="pf-disclaimer">${esc(hospital.printDisclaimer || "This is a computer generated document and does not require any signature.")}</div>`
    : "";

  const metaStrip = `
    <div class="pf-meta-strip">
      <div>Printed: ${esc(fmtPrintedAt(meta.printedAt))}</div>
      <div>${meta.docNumber ? `Doc#: ${esc(meta.docNumber)}` : ""}</div>
      <div>${meta.pageOf ? `Page ${esc(meta.pageOf)}` : ""}</div>
    </div>`;

  const addr = composeAddress(hospital);
  const contact = composeContactLine(hospital);
  const gstLine = composeGstinLine(hospital);
  const footer = `
    <footer class="pf-footer">
      ${addr ? `<div class="pf-footer-address">${esc(addr)}</div>` : ""}
      ${contact ? `<div class="pf-footer-line">${esc(contact)}</div>` : ""}
      ${gstLine ? `<div class="pf-footer-line">${esc(gstLine)}</div>` : ""}
    </footer>`;

  const page = `
    <div class="pf-page" style="--pf-header-color:${esc(headerColor)};">
      ${pageStrings}
      <header class="pf-header">
        ${headerLeft}
        ${headerCenter}
        ${headerRight}
      </header>
      <div class="pf-header-divider"></div>
      ${titleBar}
      ${patientStrip}
      <div class="pf-body">${bodyHtml}</div>
      ${sigHtml}
      ${bannerHtml}
      ${disclaimerHtml}
      ${metaStrip}
      ${footer}
    </div>`;

  // Embedded CSS — `?inline` returns the stylesheet text at build time.
  // Falls back to "" in non-Vite contexts so the helper still runs (the
  // page just renders unstyled — sibling templates may inject their own).
  const css = typeof printShellCssText === "string" ? printShellCssText : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(docTitle)}${meta.docNumber ? ` — ${esc(meta.docNumber)}` : ""}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${css}</style>
</head>
<body>
${page}
<script>
window.addEventListener('load', function () {
  setTimeout(function () { try { window.print(); } catch (e) {} }, 300);
});
</script>
</body>
</html>`;
}
