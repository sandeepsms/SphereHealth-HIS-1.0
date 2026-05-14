/**
 * PharmacyBill.jsx
 *
 * Thin wrapper that prepares bill data (identity / items / HSN
 * breakup / totals) ONCE and routes to one of 10 visual templates
 * defined in PharmacyBillTemplates.jsx.
 *
 * Template selection cascade (first non-empty wins):
 *   1. receipt.template / receipt.billTemplate  — per-print override
 *   2. receipt.pharmacySettings.billTemplate    — pharmacy's saved choice
 *   3. fallback: 1 (Classic Modern)
 *
 * Paper-size compaction (A4 / Half-A4 / A5) hangs off the same
 * `html[data-paper]` attribute the PrintPreviewPage toolbar writes.
 * The <style> block below applies to every template because they
 * all carry the `.pr-pharm-bill` class on the root element.
 */
import React from "react";
import "../print.css";
import { fmtINR, amountInWords } from "../amountWords";
import TEMPLATES from "./PharmacyBillTemplates";

const _fmtDate = (d, opts) => d
  ? new Date(d).toLocaleDateString("en-IN", opts || { day: "2-digit", month: "short", year: "numeric" })
  : "—";
const _fmtAddr = (s = {}) => [
  s.addressLine1, s.addressLine2,
  [s.city, s.state, s.pincode].filter(Boolean).join(", "),
  s.country,
].filter(Boolean).join(", ");

/** Pharmacy settings (when mode=outsourced) override hospital. */
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

  /* Tax + HSN ─────────────────────────────────────────────────── */
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
  const totals = { subTotal, totalDisc, totalTaxable, totalTax, grandTotal, roundOff, paid, balance };
  const hasControlled = items.some(it => it.schedule && /^(H|H1|X)$/i.test(it.schedule));

  /* Returns / revised-bill state ───────────────────────────────────
     If the sale has been partially or fully returned, surface that on
     the print so the customer copy is unambiguous about what's owed
     and what's been refunded. The original items[] block is preserved
     untouched — legal requirement, the original tax invoice must
     remain reprintable as-is — and the refunds section is appended
     after the totals.  */
  const returns       = Array.isArray(r.returns) ? r.returns : [];
  const isRevised     = ["Partial-Return", "Refunded", "Cancelled"].includes(r.status);
  const refundTotal   = returns.reduce((s, x) => s + Number(x.refundAmount || 0), 0);
  const netAfter      = Math.max(0, Number(r.grandTotal || 0) - refundTotal);
  const patientCred   = Number(r.patientCredit || 0);

  /* Template choice — per-print override > pharmacy default > 1 */
  const tplId   = Number(r.template || r.billTemplate || r.pharmacySettings?.billTemplate || 1);
  const Chosen  = (TEMPLATES.find(t => t.id === tplId) || TEMPLATES[0]).Render;

  const COL = { ink: "#0f172a", mute: "#64748b", line: "#e2e8f0", soft: "#f8fafc" };
  const SHEET = { fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif", color: COL.ink, fontSize: 11 };

  const renderProps = {
    id, items, hsnRows, totals, isInterState, receipt: r,
    COL, fmtINR, amountInWords, _fmtDate, hasControlled,
  };

  return (
    <>
      {/* Shared paper-size-scoped CSS — applies to every template
          because they all set className="pr-pharm-bill" on their root
          via the wrapper div below. */}
      <style>{`
        .pr-pharm-bill { font-size: 10.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill { font-size: 9px; }
        html[data-paper="a5"]      .pr-pharm-bill { font-size: 8.8px; }

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

        .pr-pharm-bill .pb-title    { padding: 12px 22px; }
        .pr-pharm-bill .pb-title-no { font-size: 16px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-title    { padding: 6px 16px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-title-no { font-size: 13px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-title    { padding: 6px 14px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-title-no { font-size: 12.5px; }

        .pr-pharm-bill .pb-billto { padding: 14px 22px; gap: 18px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-billto { padding: 7px 16px 5px; gap: 10px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-billto { padding: 7px 14px 5px; gap: 10px; }

        .pr-pharm-bill .pb-schh { margin: 0 22px 12px; padding: 8px 12px; font-size: 10.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-schh { margin: 0 16px 6px; padding: 4px 10px; font-size: 8.5px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-schh { margin: 0 14px 6px; padding: 4px 10px; font-size: 8.5px; }

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

        .pr-pharm-bill .pb-words { margin: 0 22px 14px; padding: 10px 14px; font-size: 10.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-words { margin: 0 16px 5px; padding: 4px 10px; font-size: 8.5px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-words { margin: 0 14px 5px; padding: 4px 10px; font-size: 8.5px; }

        .pr-pharm-bill .pb-foot { padding: 0 22px 22px; gap: 18px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-foot { padding: 0 16px 6px; gap: 10px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-foot { padding: 0 14px 6px; gap: 10px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-foot,
        html[data-paper="half-a4"] .pr-pharm-bill .pb-foot * { font-size: 8.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-sign-line { height: 20px !important; }

        .pr-pharm-bill .pb-terms { padding: 12px 22px; font-size: 9px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-terms { padding: 4px 16px; font-size: 7.5px; }
        html[data-paper="a5"]      .pr-pharm-bill .pb-terms { padding: 4px 14px; font-size: 7.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-terms ol,
        html[data-paper="a5"]      .pr-pharm-bill .pb-terms ol { padding-left: 14px; margin: 0; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-terms li,
        html[data-paper="a5"]      .pr-pharm-bill .pb-terms li { line-height: 1.35; }

        @media print { .pr-pharm-bill { page-break-inside: avoid; } }

        /* ── Revised-bill watermark (Partial-Return / Refunded / Cancelled)
             Sits as a semi-transparent diagonal stamp across the centre of
             the page so it's unambiguous from any angle but never covers
             critical fields like GSTIN, totals, or signatures. Rendered
             behind content via z-index + transparent fill colour.        */
        .pr-pharm-bill .pb-revised-watermark {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%) rotate(-22deg);
          font-size: 92px; font-weight: 900; letter-spacing: 14px;
          color: ${r.status === "Cancelled" ? "rgba(185,28,28,.10)" : "rgba(180,83,9,.10)"};
          border: 8px solid ${r.status === "Cancelled" ? "rgba(185,28,28,.18)" : "rgba(180,83,9,.18)"};
          border-radius: 12px;
          padding: 14px 38px;
          white-space: nowrap;
          pointer-events: none;
          z-index: 1;
          text-transform: uppercase;
        }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-revised-watermark,
        html[data-paper="a5"]      .pr-pharm-bill .pb-revised-watermark {
          font-size: 62px; letter-spacing: 10px; padding: 10px 26px; border-width: 6px;
        }
        @media print {
          .pr-pharm-bill .pb-revised-watermark {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
        .pr-pharm-bill .pb-revised-banner {
          margin: 0 22px 8px; padding: 7px 12px;
          background: ${r.status === "Cancelled" ? "#fef2f2" : "#fffbeb"};
          border: 1.5px solid ${r.status === "Cancelled" ? "#fecaca" : "#fcd34d"};
          border-radius: 6px; font-size: 10px; color: ${r.status === "Cancelled" ? "#7f1d1d" : "#92400e"};
          display: flex; justify-content: space-between; align-items: center;
        }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-revised-banner,
        html[data-paper="a5"]      .pr-pharm-bill .pb-revised-banner { margin: 0 16px 5px; padding: 4px 10px; font-size: 8.5px; }

        /* ── Returns section block (one per refund slip) */
        .pr-pharm-bill .pb-returns { margin: 8px 22px 12px; border: 1.5px dashed #f59e0b; border-radius: 8px; overflow: hidden; }
        .pr-pharm-bill .pb-returns-head { padding: 7px 12px; background: #fffbeb; border-bottom: 1px solid #fde68a; font-size: 10px; color: #92400e; display: flex; justify-content: space-between; }
        .pr-pharm-bill .pb-returns-table { width: 100%; border-collapse: collapse; font-size: 10px; }
        .pr-pharm-bill .pb-returns-table th { padding: 5px 9px; text-align: left; background: #fef3c7; color: #78350f; font-size: 8.5px; letter-spacing: .4px; text-transform: uppercase; border-bottom: 1px solid #fcd34d; }
        .pr-pharm-bill .pb-returns-table td { padding: 5px 9px; border-bottom: 1px solid #fef3c7; }
        .pr-pharm-bill .pb-returns-foot { display: flex; justify-content: flex-end; gap: 12px; padding: 6px 12px; background: #fffbeb; font-size: 10px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-returns,
        html[data-paper="a5"]      .pr-pharm-bill .pb-returns { margin: 4px 16px 6px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-returns-head,
        html[data-paper="a5"]      .pr-pharm-bill .pb-returns-head { padding: 4px 10px; font-size: 8.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-returns-table th,
        html[data-paper="a5"]      .pr-pharm-bill .pb-returns-table th { padding: 3px 7px; font-size: 7.5px; }
        html[data-paper="half-a4"] .pr-pharm-bill .pb-returns-table td,
        html[data-paper="a5"]      .pr-pharm-bill .pb-returns-table td { padding: 3px 7px; font-size: 8.4px; }
      `}</style>

      <div className="pr-page pr-pharm-bill" style={{
        ...SHEET,
        "--pr-header-color": id.color,
        "--pr-accent-color": id.accent,
        padding: 0,
        position: "relative",
        overflow: "hidden",
      }}>
        {isRevised && (
          <div className="pb-revised-watermark">
            {r.status === "Cancelled" ? "CANCELLED" : "REVISED"}
          </div>
        )}

        <Chosen {...renderProps} />

        {isRevised && (
          <div className="pb-revised-banner">
            <span>
              <b>{r.status === "Cancelled" ? "CANCELLED BILL" : "REVISED BILL"}</b>
              {" · "}
              {r.status === "Refunded"      && "All items returned"}
              {r.status === "Partial-Return"&& "One or more items returned"}
              {r.status === "Cancelled"     && "Sale cancelled — invoice retained for audit"}
            </span>
            <span>
              Original&nbsp;{fmtINR(Number(r.grandTotal || 0))}
              {refundTotal > 0 && <> · Refund&nbsp;<b>− {fmtINR(refundTotal)}</b> · Net&nbsp;<b>{fmtINR(netAfter)}</b></>}
            </span>
          </div>
        )}

        {returns.length > 0 && (
          <div className="pb-returns">
            <div className="pb-returns-head">
              <b>RETURNS &amp; REFUNDS — {returns.length} slip(s)</b>
              <span>Net of returns: <b>{fmtINR(netAfter)}</b></span>
            </div>
            {returns.map((ret, ri) => (
              <div key={ri} style={{ borderTop: ri > 0 ? "1px solid #fde68a" : "none" }}>
                <div className="pb-returns-head" style={{ background: "#fffdf5", borderBottom: "1px dashed #fcd34d", fontSize: 9.5 }}>
                  <span>
                    <b style={{ fontFamily: "DM Mono, monospace" }}>{ret.refundSlipNumber || `Refund #${ri+1}`}</b>
                    {ret.refundedAt && <> · {_fmtDate(ret.refundedAt, { day: "2-digit", month: "short", year: "numeric" })}</>}
                    {ret.refundMode && <> · {ret.refundMode}</>}
                    {ret.reason && <> · <i>{ret.reason}</i></>}
                  </span>
                  <span>Refund: <b>{fmtINR(Number(ret.refundAmount || 0))}</b></span>
                </div>
                <table className="pb-returns-table">
                  <thead>
                    <tr>
                      <th style={{ width: "5%" }}>#</th>
                      <th style={{ width: "45%" }}>Drug</th>
                      <th style={{ width: "12%" }}>Batch</th>
                      <th style={{ width: "8%", textAlign: "right" }}>Qty</th>
                      <th style={{ width: "10%", textAlign: "right" }}>Rate</th>
                      <th style={{ width: "10%", textAlign: "right" }}>GST</th>
                      <th style={{ width: "10%", textAlign: "right" }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ret.refundedItems || []).map((it, ii) => (
                      <tr key={ii}>
                        <td>{ii + 1}</td>
                        <td>{it.drugName}</td>
                        <td style={{ fontFamily: "DM Mono, monospace", fontSize: 9 }}>{it.batchNo || "—"}</td>
                        <td style={{ textAlign: "right" }}>{it.quantity}</td>
                        <td style={{ textAlign: "right" }}>{fmtINR(Number(it.unitPrice || 0))}</td>
                        <td style={{ textAlign: "right" }}>{fmtINR(Number(it.gstAmount || 0))}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtINR(Number(it.netAmount || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="pb-returns-foot">
              <span>Total refunded: <b style={{ color: "#b45309" }}>{fmtINR(refundTotal)}</b></span>
              {patientCred > 0 && <span>Credit held: <b style={{ color: "#0369a1" }}>{fmtINR(patientCred)}</b></span>}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default PharmacyBill;
