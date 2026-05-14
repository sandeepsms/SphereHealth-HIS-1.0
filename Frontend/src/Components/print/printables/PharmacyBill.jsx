/**
 * PharmacyBill.jsx — Modern GST tax-invoice for pharmacy dispense.
 *
 * Identity overrides:
 *   receipt.pharmacySettings.mode === "outsourced"
 *     → use that doc's pharmacyName / address / gstin / logo / colours
 *       in place of the hospital's header & footer (drug-license is
 *       held by the outsourced operator, not the hospital).
 *   else → fall back to the hospital `settings` prop wired by
 *     PrintRouterPage (so an in-house pharmacy stays branded as the
 *     hospital).
 *
 * Compliant with: Indian GST law (CGST/SGST split for intra-state,
 * IGST for inter-state) + Drugs & Cosmetics Rules (batch + expiry +
 * drug-license + GSTIN on every dispense).
 *
 * Design (May 2026 refresh): the previous version was a thin
 * info-strip + dense table + flat totals row. Now uses a true
 * tax-invoice layout with a coloured masthead, two-column "from /
 * billed to" block, structured item rows, HSN-wise tax summary
 * card, totals card with amount-in-words, and footer that honours
 * the pharmacy's bank / signature / terms.
 */
import React from "react";
import "../print.css";
import { fmtINR, amountInWords } from "../amountWords";

const _fmtDate = (d, opts) => d
  ? new Date(d).toLocaleDateString("en-IN", opts || { day: "2-digit", month: "short", year: "numeric" })
  : "—";
const _fmtAddr = (s = {}) => [
  s.addressLine1, s.addressLine2,
  [s.city, s.state, s.pincode].filter(Boolean).join(", "),
  s.country,
].filter(Boolean).join(", ");

/** Build a unified "identity" object — pharmacy-outsourced overrides
 *  hospital. Returns { name, tagline, logo, address, phone, email,
 *  gstin, drugLicense, fssai, pan, bank, terms, color, accent }. */
function resolveIdentity(hospital = {}, pharmacy = null) {
  const isOut = pharmacy?.mode === "outsourced";
  if (isOut) {
    return {
      isOutsourced: true,
      name:        pharmacy.pharmacyName || "Pharmacy",
      tagline:     pharmacy.tagline || "",
      logo:        pharmacy.showLogoInPrint === false ? null : pharmacy.logo || null,
      addressStr:  _fmtAddr(pharmacy) || _fmtAddr(hospital),
      state:       pharmacy.state || hospital.state,
      phone:       [pharmacy.phone1, pharmacy.phone2].filter(Boolean).join(" · "),
      email:       pharmacy.email,
      website:     pharmacy.website,
      gstin:       pharmacy.gstin,
      drugLicense: pharmacy.drugLicenseNo,
      fssai:       pharmacy.fssaiNumber,
      pan:         pharmacy.panNumber,
      bank: {
        name: pharmacy.bankName, account: pharmacy.bankAccount,
        ifsc: pharmacy.ifscCode, branch: pharmacy.bankBranch,
        upi:  pharmacy.upiId,
      },
      footerNote:  pharmacy.footerNote,
      terms: [pharmacy.termsLine1, pharmacy.termsLine2, pharmacy.termsLine3].filter(Boolean),
      color:  pharmacy.headerColor || "#ea580c",
      accent: pharmacy.accentColor || "#c2410c",
    };
  }
  return {
    isOutsourced: false,
    name:        hospital.hospitalName || "Hospital Pharmacy",
    tagline:     hospital.tagline,
    logo:        hospital.showLogoInPrint && hospital.logo,
    addressStr:  _fmtAddr(hospital),
    state:       hospital.state,
    phone:       [hospital.phone1, hospital.phone2].filter(Boolean).join(" · "),
    email:       hospital.email,
    website:     hospital.website,
    gstin:       hospital.gstin,
    drugLicense: hospital.drugLicenseNo || hospital.drugLicenseNumber,
    fssai:       hospital.fssaiNumber,
    pan:         hospital.panNumber,
    bank: {
      name: hospital.bankName, account: hospital.accountNo,
      ifsc: hospital.ifscCode, branch: hospital.bankBranch,
    },
    footerNote: hospital.billFooterNote,
    terms: [hospital.termsLine1, hospital.termsLine2, hospital.termsLine3].filter(Boolean),
    color:  hospital.printHeaderColor || "#1e293b",
    accent: hospital.printAccentColor || "#1d4ed8",
  };
}

const PharmacyBill = ({ settings = {}, receipt = {} }) => {
  const id = resolveIdentity(settings, receipt.pharmacySettings);
  const r = receipt;
  const items = Array.isArray(r.items) ? r.items : [];

  /* ── Tax calculation + HSN grouping ──────────────────────────── */
  const customerState = String(r.customerState || id.state || "").trim().toLowerCase();
  const hospState     = String(id.state || "").trim().toLowerCase();
  const isInterState  = !!customerState && !!hospState && customerState !== hospState;

  const hsnMap = new Map();
  let subTotal = 0, totalDisc = 0, totalTaxable = 0, totalTax = 0;
  for (const it of items) {
    const qty   = Number(it.quantity || it.qty || 0);
    const rate  = Number(it.unitPrice || it.rate || 0);
    const gst   = Number(it.gstRate ?? 12);
    const gross = qty * rate;
    const disc  = Number(it.discountAmount != null ? it.discountAmount : gross * (Number(it.discountPercent || 0) / 100));
    const taxable = Number(it.taxableAmount != null ? it.taxableAmount : gross - disc);
    const tax     = Number(it.gstAmount != null ? it.gstAmount : taxable * (gst / 100));
    subTotal += gross; totalDisc += disc; totalTaxable += taxable; totalTax += tax;
    const hsn = it.hsnCode || "30049099";
    const key = `${hsn}__${gst}`;
    if (!hsnMap.has(key)) hsnMap.set(key, { hsn, gstRate: gst, taxable: 0, tax: 0, qty: 0 });
    const row = hsnMap.get(key);
    row.taxable += taxable; row.tax += tax; row.qty += qty;
  }
  const hsnRows = [...hsnMap.values()];
  const grandRaw   = totalTaxable + totalTax;
  const grandTotal = Number(r.grandTotal != null ? r.grandTotal : Math.round(grandRaw));
  const roundOff   = Number(r.roundOff != null ? r.roundOff : grandTotal - grandRaw);
  const paid       = Number(r.amountPaid != null ? r.amountPaid : grandTotal);
  const balance    = Math.max(0, grandTotal - paid);
  const hasControlled = items.some(it => it.schedule && /^(H|H1|X)$/i.test(it.schedule));

  // Reusable styles (kept inline so the print-window picks them up — no
  // dependency on external CSS class names).
  const COL = { ink: "#0f172a", mute: "#64748b", line: "#e2e8f0", soft: "#f8fafc" };
  const SHEET = { fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif", color: COL.ink, fontSize: 11 };

  return (
    <>
      {/* Paper-size-scoped compaction. The PrintPreviewPage toolbar sets
          html[data-paper] when the user picks a size; we use that selector
          to reflow without re-rendering. Half-A4 (210×148.5mm landscape)
          is the default — fits exactly ~10 medicine rows + footer totals
          + header. A5 (148×210mm portrait) is a tighter variant for
          billing printers. A4 keeps the full A4 layout. */}
      <style>{`
        .pr-pharm-bill { font-size: 10.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill { font-size: 9px; }
        html[data-paper="a5"]      .pr-pharm-bill { font-size: 8.8px; }

        /* Masthead */
        .pr-pharm-bill .pb-mast       { padding: 18px 22px; gap: 16px; }
        .pr-pharm-bill .pb-mast-logo  { width: 64px; height: 64px; padding: 6px; }
        .pr-pharm-bill .pb-mast-name  { font-size: 20px; }
        .pr-pharm-bill .pb-mast-line  { font-size: 10.5px; }
        .pr-pharm-bill .pb-mast-chip  { font-size: 10px; padding: 10px 14px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-mast       { padding: 9px 16px; gap: 10px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-mast-logo  { width: 38px; height: 38px; padding: 3px; border-radius: 6px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-mast-name  { font-size: 13.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-mast-line  { font-size: 8.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-mast-chip  { font-size: 8.5px; padding: 5px 8px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-mast       { padding: 9px 14px; gap: 10px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-mast-logo  { width: 36px; height: 36px; padding: 3px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-mast-name  { font-size: 13px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-mast-line  { font-size: 8.5px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-mast-chip  { font-size: 8.5px; padding: 5px 8px; }

        /* Title band */
        .pr-pharm-bill .pb-title { padding: 12px 22px; }
        .pr-pharm-bill .pb-title-no { font-size: 16px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-title    { padding: 6px 16px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-title-no { font-size: 13px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-title    { padding: 6px 14px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-title-no { font-size: 12.5px; }

        /* Billed-to */
        .pr-pharm-bill .pb-billto { padding: 14px 22px; gap: 18px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-billto { padding: 7px 16px 5px; gap: 10px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-billto { padding: 7px 14px 5px; gap: 10px; }

        /* Sch-H banner */
        .pr-pharm-bill .pb-schh { margin: 0 22px 12px; padding: 8px 12px; font-size: 10.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-schh { margin: 0 16px 6px; padding: 4px 10px; font-size: 8.5px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-schh { margin: 0 14px 6px; padding: 4px 10px; font-size: 8.5px; }

        /* Item table */
        .pr-pharm-bill .pb-tableWrap { padding: 0 22px; }
        .pr-pharm-bill .pb-table th  { padding: 9px 10px; font-size: 9.5px; }
        .pr-pharm-bill .pb-table td  { padding: 8px 10px; font-size: 10.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-tableWrap { padding: 0 16px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-table th  { padding: 4px 7px; font-size: 8px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-table td  { padding: 3px 7px; font-size: 8.6px; line-height: 1.2; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-table .pb-cell-mono { font-size: 8px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-table .pb-cell-sub  { font-size: 7.5px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-tableWrap { padding: 0 14px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-table th  { padding: 4px 6px; font-size: 7.8px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-table td  { padding: 3px 6px; font-size: 8.4px; line-height: 1.2; }

        /* HSN + Totals split */
        .pr-pharm-bill .pb-twocol { padding: 0 22px 14px; gap: 14px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-twocol { padding: 0 16px 6px; gap: 8px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-twocol { padding: 0 14px 6px; gap: 8px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-hsn-section-title,
        html[data-paper="a5"]      .pr-pharm-bill .pb-hsn-section-title { padding: 4px 9px !important; font-size: 8px !important; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-hsn-table th,
        html[data-paper="a5"]      .pr-pharm-bill .pb-hsn-table th { padding: 3px 7px !important; font-size: 7.5px !important; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-hsn-table td,
        html[data-paper="a5"]      .pr-pharm-bill .pb-hsn-table td { padding: 3px 7px !important; font-size: 8.3px !important; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-totals-card-body,
        html[data-paper="a5"]      .pr-pharm-bill .pb-totals-card-body { padding: 6px 10px !important; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-totals-row,
        html[data-paper="a5"]      .pr-pharm-bill .pb-totals-row { padding: 2px 0 !important; font-size: 9px !important; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-grand,
        html[data-paper="a5"]      .pr-pharm-bill .pb-grand { margin-top: 6px !important; padding: 6px 10px !important; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-grand-num,
        html[data-paper="a5"]      .pr-pharm-bill .pb-grand-num { font-size: 14px !important; }

        /* Amount in words */
        .pr-pharm-bill .pb-words { margin: 0 22px 14px; padding: 10px 14px; font-size: 10.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-words { margin: 0 16px 5px; padding: 4px 10px; font-size: 8.5px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-words { margin: 0 14px 5px; padding: 4px 10px; font-size: 8.5px; }

        /* Footer */
        .pr-pharm-bill .pb-foot { padding: 0 22px 22px; gap: 18px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-foot { padding: 0 16px 6px; gap: 10px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-foot { padding: 0 14px 6px; gap: 10px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-foot,
        html[data-paper="half-a4"] .pr-pharm-bill .pb-foot * { font-size: 8.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-sign-line { height: 20px !important; }

        /* Terms */
        .pr-pharm-bill .pb-terms { padding: 12px 22px; font-size: 9px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-terms { padding: 4px 16px; font-size: 7.5px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-terms { padding: 4px 14px; font-size: 7.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-terms ol,
        html[data-paper="a5"]      .pr-pharm-bill .pb-terms ol { padding-left: 14px; margin: 0; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-terms li,
        html[data-paper="a5"]      .pr-pharm-bill .pb-terms li { line-height: 1.35; }

        /* Print page — never paginate the bill across pages */
        @media print {
          .pr-pharm-bill { page-break-inside: avoid; }
        }
      `}</style>

    <div className="pr-page pr-pharm-bill" style={{
      ...SHEET,
      "--pr-header-color": id.color,
      "--pr-accent-color": id.accent,
      padding: 0,
    }}>
      {/* ════ MASTHEAD ════ */}
      <div className="pb-mast" style={{
        background: `linear-gradient(135deg, ${id.color} 0%, ${id.accent} 100%)`,
        color: "#fff",
        display: "flex", alignItems: "center",
      }}>
        {id.logo && (
          <img src={id.logo} alt="" className="pb-mast-logo" style={{
            objectFit: "contain",
            background: "#fff", borderRadius: 10,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pb-mast-name" style={{ fontWeight: 800, letterSpacing: "-.3px", lineHeight: 1.15 }}>
            {id.name}
            {id.isOutsourced && (
              <span style={{
                marginLeft: 10, fontSize: 8.5, fontWeight: 800,
                padding: "2px 7px", borderRadius: 3,
                background: "rgba(255,255,255,.22)", border: "1px solid rgba(255,255,255,.35)",
                verticalAlign: "middle", letterSpacing: ".5px",
              }}>OUTSOURCED PHARMACY</span>
            )}
          </div>
          {id.tagline && <div className="pb-mast-line" style={{ opacity: .9, marginTop: 2 }}>{id.tagline}</div>}
          <div className="pb-mast-line" style={{ opacity: .85, marginTop: 4, lineHeight: 1.35 }}>
            {id.addressStr}
            {(id.phone || id.email) && (
              <div style={{ marginTop: 1 }}>
                {id.phone && <>📞 {id.phone}</>}
                {id.phone && id.email && " · "}
                {id.email && <>✉ {id.email}</>}
              </div>
            )}
          </div>
        </div>
        <div className="pb-mast-chip" style={{
          textAlign: "right", opacity: .92,
          background: "rgba(0,0,0,.18)", borderRadius: 7,
        }}>
          {id.gstin       && <div><span style={{ opacity: .75 }}>GSTIN</span> · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.gstin}</b></div>}
          {id.drugLicense && <div style={{ marginTop: 3 }}><span style={{ opacity: .75 }}>D.L.</span> · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.drugLicense}</b></div>}
          {id.fssai       && <div style={{ marginTop: 3 }}><span style={{ opacity: .75 }}>FSSAI</span> · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.fssai}</b></div>}
        </div>
      </div>

      {/* ════ INVOICE TITLE BAND ════ */}
      <div className="pb-title" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1.5px solid ${COL.line}`,
        background: COL.soft,
      }}>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 800, color: COL.mute, letterSpacing: ".8px", textTransform: "uppercase" }}>Tax Invoice</div>
          <div className="pb-title-no" style={{ fontWeight: 800, color: id.accent, fontFamily: "DM Mono, monospace", marginTop: 1 }}>
            {r.billNumber || "PHM-NEW"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 8.5, color: COL.mute, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase" }}>Issued on</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 1 }}>
            {r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : new Date().toLocaleString("en-IN")}
          </div>
        </div>
      </div>

      {/* ════ BILLED-TO + INVOICE META ════ */}
      <div className="pb-billto" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr" }}>
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: COL.mute, letterSpacing: ".8px", textTransform: "uppercase", marginBottom: 6 }}>Billed to</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: COL.ink }}>{r.patientName || "Walk-in customer"}</div>
          <div style={{ fontSize: 11, color: COL.mute, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {r.patientUHID && <span><b>UHID</b> · {r.patientUHID}</span>}
            {(r.age || r.gender) && <span><b>Age/Sex</b> · {[r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ")}</span>}
            {r.contactNumber && <span><b>Phone</b> · {r.contactNumber}</span>}
          </div>
          {r.admissionNumber && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <span style={{ background: id.accent + "15", color: id.accent, padding: "2px 8px", borderRadius: 4, fontWeight: 800, fontSize: 9.5, marginRight: 6 }}>IPD</span>
              <span><b>{r.admissionNumber}</b> · attending {r.doctorName || "—"}</span>
            </div>
          )}
        </div>
        <div style={{
          fontSize: 11, lineHeight: 1.65,
          background: COL.soft, border: `1px solid ${COL.line}`,
          borderRadius: 8, padding: "10px 12px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: COL.mute }}>Sale type</span><b>{r.saleType || "Walk-in"}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: COL.mute }}>Doctor</span><b>{r.doctorName || "—"}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: COL.mute }}>Payment mode</span><b>{r.paymentMode || "Cash"}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: COL.mute }}>Cashier</span><b>{r.createdBy || "—"}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: COL.mute }}>Place of supply</span><b>{isInterState ? "Inter-state" : "Intra-state"}</b></div>
        </div>
      </div>

      {/* ════ SCHEDULE-H BANNER (if any controlled drug) ════ */}
      {hasControlled && (
        <div className="pb-schh" style={{
          background: "#fef2f2", border: "1.5px solid #fecaca", borderLeft: "4px solid #dc2626",
          borderRadius: 5, color: "#7f1d1d",
        }}>
          <b>⚠ Schedule H / H1 / X medicines dispensed.</b> Sold only on a registered medical practitioner's prescription. Retained for record per Drugs &amp; Cosmetics Rules.
        </div>
      )}

      {/* ════ ITEM TABLE ════ */}
      <div className="pb-tableWrap">
        <table className="pb-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
          <thead>
            <tr style={{ background: id.color, color: "#fff" }}>
              <th style={{ padding: "9px 10px", textAlign: "left",   fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", borderTopLeftRadius: 8 }}>#</th>
              <th style={{ padding: "9px 10px", textAlign: "left",   fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px" }}>Medicine</th>
              <th style={{ padding: "9px 10px", textAlign: "left",   fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px" }}>HSN</th>
              <th style={{ padding: "9px 10px", textAlign: "left",   fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px" }}>Batch / Exp</th>
              <th style={{ padding: "9px 10px", textAlign: "right",  fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px" }}>Qty</th>
              <th style={{ padding: "9px 10px", textAlign: "right",  fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px" }}>Rate</th>
              <th style={{ padding: "9px 10px", textAlign: "right",  fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px" }}>Disc</th>
              <th style={{ padding: "9px 10px", textAlign: "right",  fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px" }}>Taxable</th>
              <th style={{ padding: "9px 10px", textAlign: "right",  fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px" }}>GST</th>
              <th style={{ padding: "9px 10px", textAlign: "right",  fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", borderTopRightRadius: 8 }}>Net ₹</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 22, textAlign: "center", color: COL.mute, fontStyle: "italic", border: `1px solid ${COL.line}` }}>No items.</td></tr>
            ) : items.map((it, i) => {
              const qty = Number(it.quantity || it.qty || 0);
              const rate = Number(it.unitPrice || it.rate || 0);
              const gst = Number(it.gstRate ?? 12);
              const gross = qty * rate;
              const disc = Number(it.discountAmount != null ? it.discountAmount : gross * (Number(it.discountPercent || 0) / 100));
              const taxable = Number(it.taxableAmount != null ? it.taxableAmount : gross - disc);
              const net = Number(it.netAmount != null ? it.netAmount : taxable + taxable * gst / 100);
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${COL.line}` }}>
                  <td style={{ padding: "8px 10px", color: COL.mute }}>{i + 1}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ fontWeight: 700 }}>{it.drugName || it.name}</div>
                    {(it.strength || it.form) && (
                      <div style={{ fontSize: 9, color: COL.mute, marginTop: 1 }}>{[it.form, it.strength].filter(Boolean).join(" · ")}</div>
                    )}
                    {it.schedule && /^(H|H1|X)$/i.test(it.schedule) && (
                      <span style={{ display: "inline-block", marginTop: 2, padding: "1px 6px", borderRadius: 3, fontSize: 8.5, fontWeight: 800, background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }}>Sch {it.schedule}</span>
                    )}
                  </td>
                  <td className="pb-cell-mono" style={{ color: COL.mute, fontFamily: "DM Mono, monospace" }}>{it.hsnCode || "30049099"}</td>
                  <td className="pb-cell-mono" style={{ fontFamily: "DM Mono, monospace" }}>
                    <div>{it.batchNo || "—"}</div>
                    <div className="pb-cell-sub" style={{ color: COL.mute }}>{it.expiryDate ? _fmtDate(it.expiryDate, { month: "short", year: "2-digit" }) : "—"}</div>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{qty}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{rate.toFixed(2)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: disc > 0 ? "#dc2626" : COL.mute }}>{disc > 0 ? `−${disc.toFixed(2)}` : "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{taxable.toFixed(2)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: COL.mute, fontSize: 10 }}>{gst}%</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, color: id.accent }}>{net.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ════ HSN-WISE TAX + TOTALS ════ */}
      <div className="pb-twocol" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr" }}>

        {/* HSN summary */}
        <div style={{ border: `1px solid ${COL.line}`, borderRadius: 8, overflow: "hidden" }}>
          <div className="pb-hsn-section-title" style={{ padding: "7px 11px", background: COL.soft, borderBottom: `1px solid ${COL.line}`,
            fontSize: 9, fontWeight: 800, color: COL.mute, letterSpacing: ".5px", textTransform: "uppercase" }}>
            HSN-wise tax summary
          </div>
          <table className="pb-hsn-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff", borderBottom: `1px solid ${COL.line}` }}>
                <th style={{ padding: "6px 10px", textAlign: "left", color: COL.mute, fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>HSN</th>
                <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>Taxable</th>
                {isInterState ? (
                  <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>IGST</th>
                ) : (
                  <>
                    <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>CGST</th>
                    <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>SGST</th>
                  </>
                )}
                <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800, letterSpacing: ".3px" }}>Total tax</th>
              </tr>
            </thead>
            <tbody>
              {hsnRows.map((h, i) => {
                const half = h.tax / 2;
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${COL.line}` }}>
                    <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace" }}>{h.hsn}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{h.taxable.toFixed(2)}</td>
                    {isInterState ? (
                      <td style={{ padding: "6px 10px", textAlign: "right" }}>
                        <span style={{ fontSize: 9, color: COL.mute, marginRight: 3 }}>@{h.gstRate}%</span>{h.tax.toFixed(2)}
                      </td>
                    ) : (
                      <>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}>
                          <span style={{ fontSize: 9, color: COL.mute, marginRight: 3 }}>@{(h.gstRate/2)}%</span>{half.toFixed(2)}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}>
                          <span style={{ fontSize: 9, color: COL.mute, marginRight: 3 }}>@{(h.gstRate/2)}%</span>{half.toFixed(2)}
                        </td>
                      </>
                    )}
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{h.tax.toFixed(2)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: COL.soft }}>
                <td style={{ padding: "7px 10px", fontWeight: 800 }}>Total</td>
                <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{totalTaxable.toFixed(2)}</td>
                {isInterState ? (
                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{totalTax.toFixed(2)}</td>
                ) : (
                  <>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{(totalTax/2).toFixed(2)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{(totalTax/2).toFixed(2)}</td>
                  </>
                )}
                <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, color: id.accent }}>{totalTax.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Totals card */}
        <div style={{ border: `1px solid ${COL.line}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
          <div className="pb-hsn-section-title" style={{ padding: "7px 11px", background: COL.soft, borderBottom: `1px solid ${COL.line}`,
            fontSize: 9, fontWeight: 800, color: COL.mute, letterSpacing: ".5px", textTransform: "uppercase" }}>
            Payment summary
          </div>
          <div className="pb-totals-card-body" style={{ padding: "9px 13px" }}>
            {[
              ["Sub-total",     fmtINR(subTotal),       null],
              ...(totalDisc > 0 ? [["Discount",   `− ${fmtINR(totalDisc)}`, "#dc2626"]] : []),
              ["Taxable value", fmtINR(totalTaxable),   null],
              ...(isInterState
                ? [["IGST", `+ ${fmtINR(totalTax)}`, null]]
                : [["CGST", `+ ${fmtINR(totalTax/2)}`, null], ["SGST", `+ ${fmtINR(totalTax/2)}`, null]]),
              ...(Math.abs(roundOff) >= 0.01 ? [["Round-off", `${roundOff > 0 ? "+ " : "− "}${fmtINR(Math.abs(roundOff))}`, null]] : []),
            ].map(([k, v, c], i) => (
              <div key={i} className="pb-totals-row" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 10.5, color: c || COL.ink }}>
                <span style={{ color: COL.mute }}>{k}</span>
                <span style={{ fontFamily: "DM Mono, monospace" }}>{v}</span>
              </div>
            ))}

            {/* Grand total */}
            <div className="pb-grand" style={{
              marginTop: 8, padding: "9px 12px",
              background: `linear-gradient(135deg, ${id.color}, ${id.accent})`,
              color: "#fff", borderRadius: 6,
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
            }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", opacity: .9 }}>Grand total</span>
              <span className="pb-grand-num" style={{ fontSize: 17, fontWeight: 800, fontFamily: "DM Mono, monospace" }}>{fmtINR(grandTotal)}</span>
            </div>

            {/* Paid / balance */}
            <div style={{ marginTop: 7, paddingTop: 6, borderTop: `1px dashed ${COL.line}` }}>
              <div className="pb-totals-row" style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 10.5 }}>
                <span style={{ color: COL.mute }}>Paid ({r.paymentMode || "Cash"})</span>
                <b style={{ color: "#16a34a", fontFamily: "DM Mono, monospace" }}>{fmtINR(paid)}</b>
              </div>
              {balance > 0 && (
                <div className="pb-totals-row" style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 10.5 }}>
                  <span style={{ color: COL.mute }}>Balance due</span>
                  <b style={{ color: "#dc2626", fontFamily: "DM Mono, monospace" }}>{fmtINR(balance)}</b>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ════ AMOUNT IN WORDS ════ */}
      <div className="pb-words" style={{
        background: COL.soft, border: `1px dashed ${id.accent}50`, borderRadius: 6,
      }}>
        <span style={{ fontWeight: 800, color: id.accent, marginRight: 6, letterSpacing: ".3px", textTransform: "uppercase", fontSize: 8.5 }}>
          Amount in words
        </span>
        <span style={{ fontWeight: 700 }}>{amountInWords(grandTotal)}</span>
      </div>

      {/* ════ FOOTER: bank + signatures + terms ════ */}
      <div className="pb-foot" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        {/* Bank + UPI */}
        {(id.bank?.name || id.bank?.account || id.bank?.upi) && (
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: COL.mute, letterSpacing: ".5px", textTransform: "uppercase", marginBottom: 6 }}>
              Payment details
            </div>
            <div style={{ fontSize: 10.5, lineHeight: 1.6 }}>
              {id.bank.name &&    <div><b>Bank</b> · {id.bank.name}{id.bank.branch ? ` (${id.bank.branch})` : ""}</div>}
              {id.bank.account && <div><b>A/c</b> · <span style={{ fontFamily: "DM Mono, monospace" }}>{id.bank.account}</span></div>}
              {id.bank.ifsc    && <div><b>IFSC</b> · <span style={{ fontFamily: "DM Mono, monospace" }}>{id.bank.ifsc}</span></div>}
              {id.bank.upi     && <div><b>UPI</b> · <span style={{ fontFamily: "DM Mono, monospace" }}>{id.bank.upi}</span></div>}
            </div>
          </div>
        )}

        {/* Signatures */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div>
              <div className="pb-sign-line" style={{ height: 30, borderBottom: `1.5px solid ${COL.ink}` }} />
              <div style={{ fontSize: 8.5, color: COL.mute, marginTop: 3, textAlign: "center", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>
                Pharmacist signature
              </div>
            </div>
            <div>
              <div className="pb-sign-line" style={{ height: 30, borderBottom: `1.5px solid ${COL.ink}` }} />
              <div style={{ fontSize: 8.5, color: COL.mute, marginTop: 3, textAlign: "center", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>
                Receiver signature
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ════ TERMS + FOOTER NOTE ════ */}
      <div className="pb-terms" style={{ borderTop: `2px solid ${id.color}`, background: COL.soft, color: COL.mute, lineHeight: 1.45 }}>
        {id.terms.length > 0 && (
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {id.terms.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        )}
        {id.footerNote && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "#fff", border: `1px solid ${COL.line}`, borderRadius: 5, fontStyle: "italic", color: COL.ink, fontSize: 10 }}>
            {id.footerNote}
          </div>
        )}
        <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>This is a computer-generated tax invoice.</span>
          <span>Generated · {new Date().toLocaleString("en-IN")}</span>
        </div>
      </div>
    </div>
    </>
  );
};

export default PharmacyBill;
