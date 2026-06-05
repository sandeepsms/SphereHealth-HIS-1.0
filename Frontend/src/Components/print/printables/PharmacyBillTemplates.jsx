/**
 * PharmacyBillTemplates.jsx
 *
 * Ten distinct visual templates for the pharmacy GST tax invoice.
 * All ten receive the SAME bill-data props, so identity / items /
 * totals / HSN breakup compute once in the parent wrapper and only
 * the visual rendering differs. Paper-size compaction (A4 / Half-A4
 * / A5) is handled by the parent's <style> block — every template
 * uses the same `.pr-pharm-bill` class scope.
 *
 * Templates 1-5 target IN-HOUSE / hospital-branded styles (formal,
 * clinical, neutral). Templates 6-10 target OUTSOURCED / retail
 * pharmacy styles (vibrant, commercial, customer-facing).
 *
 * Each template exports a React component receiving:
 *   { id, items, hsnRows, totals, isInterState, receipt,
 *     COL, fmtINR, amountInWords, _fmtDate, hasControlled }
 */
import React from "react";
// R7hr-42: toNum is needed at every template render site because
// PharmacyBill.jsx pre-normalises items in its dispatcher path BUT
// external callers (Settings thumbnails, future print paths) may
// hand templates raw Mongoose Decimal128 wrappers. Defending in depth
// at the template render site means raw {$numberDecimal: "99"} never
// reaches a `Number()` call site again.
import { toNum, ESCPOS_FEED_CUT } from "../../../utils/printUtils";

/* ─────────────────────────────────────────────────────────────────
   1. CLASSIC MODERN — gradient masthead + side-by-side HSN/totals
       Best for: in-house hospital pharmacy, professional default
──────────────────────────────────────────────────────────────────── */
export function T1_ClassicModern(p) {
  const { id, items, hsnRows, totals, isInterState, receipt: r, COL, fmtINR, amountInWords, _fmtDate, hasControlled } = p;
  return (
    <>
      {/* Gradient masthead */}
      <div className="pb-mast" style={{
        background: `linear-gradient(135deg, ${id.color} 0%, ${id.accent} 100%)`,
        color: "#fff", display: "flex", alignItems: "center",
      }}>
        {id.logo && <img src={id.logo} alt="" className="pb-mast-logo" style={{ objectFit: "contain", background: "#fff", borderRadius: 10, maxHeight: 56, maxWidth: 72, marginRight: 10 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pb-mast-name" style={{ fontWeight: 800, letterSpacing: "-.3px", lineHeight: 1.15 }}>{id.name}</div>
          {id.tagline && <div className="pb-mast-line" style={{ opacity: .9, marginTop: 2 }}>{id.tagline}</div>}
          <div className="pb-mast-line" style={{ opacity: .85, marginTop: 4 }}>
            {id.addressStr}
            {(id.phone || id.email) && <div style={{ marginTop: 1 }}>{id.phone}{id.phone && id.email && " · "}{id.email}</div>}
          </div>
        </div>
        <div className="pb-mast-chip" style={{ textAlign: "right", opacity: .92, background: "rgba(0,0,0,.18)", borderRadius: 7 }}>
          {id.gstin       && <div>GSTIN · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.gstin}</b></div>}
          {id.drugLicense && <div style={{ marginTop: 2 }}>D.L. · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.drugLicense}</b></div>}
        </div>
      </div>
      <BilledTo {...p} />
      {hasControlled && <SchHBanner />}
      <ItemsTable {...p} headerStyle={{ background: id.color, color: "#fff" }} />
      <HsnTotalsSplit {...p} />
      <AmountWords {...p} />
      <FooterFull {...p} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SHARED SUB-COMPONENTS
═══════════════════════════════════════════════════════════════════ */
function Row({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
      <span style={{ color: "#64748b" }}>{k}</span>
      <span style={{ fontWeight: 700 }}>{v}</span>
    </div>
  );
}

/* R7hr-39 — variant-aware Billed-To block.
 *
 * PharmacyBill.jsx dispatcher computes patientLeft + patientRight
 * already (R7hr-15→21 work — IPD merges UHID/IPD on left + adds
 * Ward/Bed/Department/Admission Date/Diagnosis; OPD adds Rx Ref;
 * Walk-in collapses to anonymous customer when no identity). Those
 * arrays now flow through tplProps and we render them here so every
 * visual template (Classic, Premium Dark, Heritage, etc.) inherits
 * the same variant intelligence — same wiring, different skin.
 *
 * Mode selector — templates pass `mode` to get a layout that fits
 * their overall design language:
 *   • "kv"        (default) — 2-col KV grid, used by T1-T6 + T9
 *   • "narrow"    — single-column Rx-style strip, used by T7
 *                   (thermal receipt narrow strip)
 *   • "bilingual" — Hindi + English labels, used by T8
 *   • "compact"   — one-line inline, used by T10 lite
 *
 * Falls back to the original generic block when no patientLeft is
 * passed — preserves behaviour for any future caller that doesn't
 * use the dispatcher flow (none today).
 */
function BilledTo(p) {
  const {
    receipt: r, id, COL,
    flat, noPadding, mode = "kv",
    patientLeft, patientRight,
    docTitle, isOPD, isIPD, isWalkIn,
  } = p;

  // Legacy generic block — only used if dispatcher didn't pass
  // variant-aware patientLeft. Real callers always pass it.
  if (!Array.isArray(patientLeft)) {
    return (
      <div className={noPadding ? "" : "pb-billto"} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", padding: noPadding ? 0 : undefined, gap: flat ? 12 : undefined }}>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 800, color: COL.mute, letterSpacing: ".5px", textTransform: "uppercase" }}>Billed to</div>
          <div style={{ fontSize: 13.5, fontWeight: 800, marginTop: 2 }}>{r.patientName || "Walk-in customer"}</div>
          <div style={{ fontSize: 10, color: COL.mute, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {r.patientUHID && <span>UHID · {r.patientUHID}</span>}
            {(r.age || r.gender) && <span>{[r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ")}</span>}
            {r.contactNumber && <span>📞 {r.contactNumber}</span>}
          </div>
          {r.admissionNumber && <div style={{ marginTop: 4, fontSize: 10 }}><b>IPD · {r.admissionNumber}</b> · {r.doctorName || "—"}</div>}
        </div>
        <div style={{ fontSize: 10, lineHeight: 1.55, background: flat ? "transparent" : COL.soft, border: flat ? "none" : `1px solid ${COL.line}`, borderRadius: 6, padding: flat ? 0 : "8px 10px" }}>
          <Row k="Sale type"    v={r.saleType || "Walk-in"} />
          <Row k="Doctor"       v={r.doctorName || "—"} />
          <Row k="Payment"      v={r.paymentMode || "Cash"} />
          <Row k="Cashier"      v={r.createdBy || "—"} />
        </div>
      </div>
    );
  }

  // R7hr-18 variant title — already prefixed in docTitle (e.g.
  // "IPD PHARMACY BILL"); pull the tag back out for a thin chip.
  const variantTag = isWalkIn ? "WALK-IN"
                    : isIPD   ? "IPD"
                    : isOPD   ? "OPD"
                    : "";
  const variantColor = isWalkIn ? "#15803d"
                      : isIPD   ? "#1e3a8a"
                      : isOPD   ? "#9a3412"
                      : COL.mute;
  const variantBg    = isWalkIn ? "#f0fdf4"
                      : isIPD   ? "#eff6ff"
                      : isOPD   ? "#fff7ed"
                      : COL.soft;

  // ── Compact (T10) ──
  if (mode === "compact") {
    const oneLine = [...patientLeft, ...patientRight]
      .filter((kv) => kv && kv.value && kv.value !== "—")
      .slice(0, 6)
      .map((kv) => `${kv.label}: ${kv.value}`)
      .join("  ·  ");
    return (
      <div style={{ padding: "6px 0", fontSize: 10.5, borderBottom: `1px dashed ${COL.line}` }}>
        {variantTag && (
          <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 4, background: variantBg, color: variantColor, fontSize: 9, fontWeight: 800, letterSpacing: ".5px", marginRight: 8 }}>{variantTag}</span>
        )}
        {oneLine}
      </div>
    );
  }

  // ── Narrow (T7 thermal strip) ──
  if (mode === "narrow") {
    const both = [...patientLeft, ...patientRight].filter(Boolean);
    return (
      <div style={{ borderBottom: `1px dashed ${COL.mute}`, paddingBottom: 4 }}>
        {variantTag && (
          <div style={{ textAlign: "center", padding: "3px 0", fontSize: 9.5, fontWeight: 800, color: variantColor, letterSpacing: ".8px" }}>
            ·· {docTitle || `${variantTag} BILL`} ··
          </div>
        )}
        {both.map((kv, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
            <span style={{ color: COL.mute }}>{kv.label}</span>
            <span style={{ fontWeight: 700, fontFamily: kv.value && /[A-Z]+-\d/.test(String(kv.value)) ? "DM Mono, monospace" : undefined }}>
              {kv.value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // ── Bilingual (T8) ──
  if (mode === "bilingual") {
    const HI = {
      "Bill No": "बिल नं.",
      "UHID": "यूएच आईडी",
      "UHID / IPD": "यूएच / आईपीडी",
      "Patient": "रोगी",
      "Customer": "ग्राहक",
      "Age/Sex": "आयु / लिंग",
      "Contact": "संपर्क",
      "Address": "पता",
      "Ward": "वार्ड",
      "Bed": "बिस्तर",
      "Bill Date": "दिनांक",
      "Department": "विभाग",
      "Doctor": "डॉक्टर",
      "Counter": "काउंटर",
      "Payer": "भुगतानकर्ता",
      "GSTIN": "जीएसटी",
      "Admission Date": "भर्ती दिनांक",
      "Diagnosis": "निदान",
      "Rx Ref": "नुस्खा संदर्भ",
    };
    const Both = (col) => col.map((kv, i) => (
      <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", padding: "2px 0", fontSize: 10 }}>
        <span style={{ color: COL.mute }}>{HI[kv.label] ? `${HI[kv.label]} · ${kv.label}` : kv.label}</span>
        <span style={{ fontWeight: 700 }}>{kv.value}</span>
      </div>
    ));
    return (
      <div className={noPadding ? "" : "pb-billto"} style={{ padding: noPadding ? 0 : undefined }}>
        {variantTag && (
          <div style={{ padding: "5px 11px", background: variantBg, color: variantColor, fontSize: 9.5, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", borderRadius: 4, marginBottom: 6 }}>
            {docTitle || `${variantTag} फार्मेसी बिल · ${variantTag} PHARMACY BILL`}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>{Both(patientLeft)}</div>
          <div>{Both(patientRight)}</div>
        </div>
      </div>
    );
  }

  // ── KV (default) — T1-T6, T9 ──
  // Mono-format any value that looks like a code (e.g. PHM-26-0014,
  // UH01 / IPD-26-02) so it stands out the way the user already sees
  // on the PrintShell fallback.
  const KV = (kv, i) => {
    // R7hr-42 P2-40: regex tightened to require an explicit hyphen + digit
    // (e.g. "PHM-26-0014", "IPD-26-02") so plain words like "UH01" don't
    // trip the monospace-accent treatment. Composite values like
    // "UH01 / IPD-26-02" still render normally because the test is anchored
    // at start-of-string.
    const isMono = kv.value && /^[A-Z]+-\d/.test(String(kv.value));
    return (
      <div key={i} style={{ display: "grid", gridTemplateColumns: "0.9fr 1.3fr", padding: "2px 0", fontSize: 10, alignItems: "baseline" }}>
        <span style={{ color: COL.mute, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>{kv.label}</span>
        <span style={{
          fontWeight: 700,
          fontFamily: isMono ? "DM Mono, monospace" : undefined,
          color: isMono ? id.accent || id.color : undefined,
          wordBreak: "break-word",
        }}>{kv.value}</span>
      </div>
    );
  };
  return (
    // R7hr-42 P1-18: BilledTo wraps a 2-col KV grid that must stay
    // together — patient context (UHID/Bed) shouldn't split from doc
    // meta (Bill Date/Doctor).
    <div className={noPadding ? "" : "pb-billto"} style={{ padding: noPadding ? 0 : undefined, pageBreakInside: "avoid" }}>
      {variantTag && (
        <div style={{ padding: "5px 12px", marginBottom: 6, background: variantBg, color: variantColor, fontSize: 10, fontWeight: 800, letterSpacing: ".6px", textTransform: "uppercase", borderLeft: `3px solid ${variantColor}`, display: "flex", justifyContent: "space-between", alignItems: "center", pageBreakAfter: "avoid" }}>
          <span>{docTitle || `${variantTag} PHARMACY BILL`}</span>
          {r.billNumber && <span style={{ fontFamily: "DM Mono, monospace", letterSpacing: 0, fontSize: 10, fontWeight: 700, opacity: .8 }}>{r.billNumber}</span>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: flat ? 0 : "0 4px" }}>
        <div style={{ background: flat ? "transparent" : COL.soft, border: flat ? "none" : `1px solid ${COL.line}`, borderRadius: 6, padding: flat ? 0 : "7px 10px" }}>
          {patientLeft.map(KV)}
        </div>
        <div style={{ background: flat ? "transparent" : COL.soft, border: flat ? "none" : `1px solid ${COL.line}`, borderRadius: 6, padding: flat ? 0 : "7px 10px" }}>
          {patientRight.map(KV)}
        </div>
      </div>
    </div>
  );
}

function SchHBanner() {
  // R7hr-42 P1-22 + P2-48: page-break-inside avoid so the regulatory
  // warning doesn't get sliced across pages, plus inline padding so the
  // text isn't flush against the coloured border (pb-schh class has no
  // padding rule defined).
  return (
    <div className="pb-schh" style={{
      background: "#fef2f2", border: "1.5px solid #fecaca", borderLeft: "4px solid #dc2626",
      borderRadius: 5, color: "#7f1d1d",
      padding: "8px 12px", margin: "6px 0",
      pageBreakInside: "avoid",
    }}>
      <b>⚠ Schedule H / H1 / X medicines dispensed.</b> Sold only on a registered medical practitioner's prescription. Retained for record per Drugs &amp; Cosmetics Rules.
    </div>
  );
}

function ItemsTable(p) {
  const { items, COL, id, _fmtDate, headerStyle = {}, bordered, fullBorders, striped, noPadding } = p;
  return (
    <div className={noPadding ? "" : "pb-tableWrap"} style={{ padding: noPadding ? 0 : undefined }}>
      <table className="pb-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
        <thead>
          <tr style={headerStyle}>
            {["#","Medicine","HSN","Batch / Exp","Qty","Rate","Disc","Taxable","GST","Net ₹"].map((h, i) => (
              <th key={i} style={{ padding: "9px 10px", textAlign: i >= 4 ? "right" : "left", fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* R7hr-42 P1-12: empty-items placeholder so refund-only / void
              bills don't render a hollow <tbody>. */}
          {items.length === 0 && (
            <tr><td colSpan={10} style={{ padding: 18, textAlign: "center", color: COL.mute, fontStyle: "italic" }}>No items on this bill</td></tr>
          )}
          {items.map((it, i) => {
            // R7hr-42 P0-1/2/3: every Number() call here is a NaN landmine
            // when Mongoose .lean() ships Decimal128 wrappers. toNum() handles
            // both raw numbers, strings, and {$numberDecimal: "..."} shapes.
            const qty = toNum(it.quantity ?? it.qty);
            const rate = toNum(it.unitPrice ?? it.rate);
            const gst = toNum(it.gstRate ?? 12);
            const gross = qty * rate;
            const disc = toNum(it.discountAmount) > 0
              ? toNum(it.discountAmount)
              : gross * (toNum(it.discountPercent) / 100);
            const taxable = toNum(it.taxableAmount) > 0
              ? toNum(it.taxableAmount)
              : Math.max(0, gross - disc);
            const net = toNum(it.netAmount) > 0
              ? toNum(it.netAmount)
              : taxable + taxable * gst / 100;
            const bg = striped ? (i % 2 ? "#fafbfc" : "#fff") : (bordered ? "#fff" : undefined);
            // R7bf-F / A4-HIGH-10: Schedule-H / H1 / X dispenses must
            // carry the prescriber's name on the bill (Drugs & Cosmetics
            // Rules § 65.9). Prefer the per-line prescriberName, fall
            // back to the bill-level doctorName so legacy data still
            // renders something useful. Plain "—" when neither exists,
            // which is a red flag for the pharmacist.
            const isScheduleH = !!(it.schedule && /^(H|H1|X)$/i.test(it.schedule));
            const prescriber  = it.prescriberName || it.prescriber || p.receipt?.doctorName;
            return (
              <tr key={i} className="bill-line-row" style={{ borderBottom: `1px solid ${COL.line}`, background: bg, pageBreakInside: "avoid" }}>
                <td style={{ padding: "8px 10px", color: COL.mute, border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{i + 1}</td>
                <td style={{ padding: "8px 10px", border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>
                  <div style={{ fontWeight: 700 }}>{it.drugName || it.name}</div>
                  {(it.strength || it.form) && <div style={{ fontSize: 9, color: COL.mute, marginTop: 1 }}>{[it.form, it.strength].filter(Boolean).join(" · ")}</div>}
                  {isScheduleH && <span style={{ display: "inline-block", marginTop: 2, padding: "1px 6px", borderRadius: 3, fontSize: 8.5, fontWeight: 800, background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }}>Sch {it.schedule}</span>}
                  {isScheduleH && (
                    <div style={{ marginTop: 2, fontSize: 9, color: "#7f1d1d" }}>
                      Rx by: <strong>{prescriber || "— (PRESCRIBER MISSING)"}</strong>
                    </div>
                  )}
                </td>
                <td className="pb-cell-mono" style={{ color: COL.mute, fontFamily: "DM Mono, monospace", border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{it.hsnCode || "30049099"}</td>
                <td className="pb-cell-mono" style={{ fontFamily: "DM Mono, monospace", border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>
                  <div>{it.batchNo || "—"}</div>
                  <div className="pb-cell-sub" style={{ color: COL.mute }}>{it.expiryDate ? _fmtDate(it.expiryDate, { month: "short", year: "2-digit" }) : "—"}</div>
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{qty}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{rate.toFixed(2)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: disc > 0 ? "#dc2626" : COL.mute, border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{disc > 0 ? `−${disc.toFixed(2)}` : "—"}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{taxable.toFixed(2)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: COL.mute, fontSize: 10, border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{gst}%</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, color: id.accent, border: fullBorders ? `1px solid ${COL.ink}` : undefined }}>{net.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HsnTotalsSplit(p) {
  const { id, hsnRows, totals, isInterState, receipt: r, COL, fmtINR, flat, noPadding, grandColor } = p;
  return (
    <div className={noPadding ? "" : "pb-twocol"} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", padding: noPadding ? 0 : undefined }}>
      <div style={{ border: flat ? "none" : `1px solid ${COL.line}`, borderRadius: 8, overflow: "hidden" }}>
        <div className="pb-hsn-section-title" style={{ padding: "7px 11px", background: flat ? "transparent" : COL.soft, borderBottom: flat ? `1px solid ${COL.line}` : `1px solid ${COL.line}`, fontSize: 9, fontWeight: 800, color: COL.mute, letterSpacing: ".5px", textTransform: "uppercase" }}>
          HSN-wise tax summary
        </div>
        <table className="pb-hsn-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#fff", borderBottom: `1px solid ${COL.line}` }}>
              <th style={{ padding: "6px 10px", textAlign: "left", color: COL.mute, fontSize: 9, fontWeight: 800 }}>HSN</th>
              <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800 }}>Taxable</th>
              {isInterState
                ? <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800 }}>IGST</th>
                : <>
                    <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800 }}>CGST</th>
                    <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800 }}>SGST</th>
                  </>}
              <th style={{ padding: "6px 10px", textAlign: "right", color: COL.mute, fontSize: 9, fontWeight: 800 }}>Total tax</th>
            </tr>
          </thead>
          <tbody>
            {hsnRows.map((h, i) => {
              const half = h.tax / 2;
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${COL.line}` }}>
                  <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace" }}>{h.hsn}</td>
                  <td style={{ padding: "6px 10px", textAlign: "right" }}>{h.taxable.toFixed(2)}</td>
                  {isInterState
                    ? <td style={{ padding: "6px 10px", textAlign: "right" }}><span style={{ fontSize: 9, color: COL.mute, marginRight: 3 }}>@{h.gstRate}%</span>{h.tax.toFixed(2)}</td>
                    : <>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}><span style={{ fontSize: 9, color: COL.mute, marginRight: 3 }}>@{h.gstRate/2}%</span>{half.toFixed(2)}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}><span style={{ fontSize: 9, color: COL.mute, marginRight: 3 }}>@{h.gstRate/2}%</span>{half.toFixed(2)}</td>
                      </>}
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{h.tax.toFixed(2)}</td>
                </tr>
              );
            })}
            <tr style={{ background: COL.soft }}>
              <td style={{ padding: "7px 10px", fontWeight: 800 }}>Total</td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{totals.totalTaxable.toFixed(2)}</td>
              {isInterState
                ? <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{totals.totalTax.toFixed(2)}</td>
                : <>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{(totals.totalTax/2).toFixed(2)}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800 }}>{(totals.totalTax/2).toFixed(2)}</td>
                  </>}
              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, color: id.accent }}>{totals.totalTax.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ border: flat ? "none" : `1px solid ${COL.line}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        <div className="pb-hsn-section-title" style={{ padding: "7px 11px", background: flat ? "transparent" : COL.soft, borderBottom: `1px solid ${COL.line}`, fontSize: 9, fontWeight: 800, color: COL.mute, letterSpacing: ".5px", textTransform: "uppercase" }}>
          Payment summary
        </div>
        <div className="pb-totals-card-body" style={{ padding: "9px 13px" }}>
          {[
            ["Sub-total",      fmtINR(totals.subTotal)],
            ...(totals.totalDisc > 0 ? [["Discount", `− ${fmtINR(totals.totalDisc)}`]] : []),
            ["Taxable value",  fmtINR(totals.totalTaxable)],
            ...(isInterState
              ? [["IGST", `+ ${fmtINR(totals.totalTax)}`]]
              : [["CGST", `+ ${fmtINR(totals.totalTax/2)}`], ["SGST", `+ ${fmtINR(totals.totalTax/2)}`]]),
          ].map(([k, v], i) => <div key={i} className="pb-totals-row" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 10.5 }}><span style={{ color: COL.mute }}>{k}</span><span style={{ fontFamily: "DM Mono, monospace" }}>{v}</span></div>)}
          <div className="pb-grand" style={{
            marginTop: 8, padding: "9px 12px",
            background: `linear-gradient(135deg, ${(grandColor?.from) || id.color}, ${(grandColor?.to) || id.accent})`,
            color: "#fff", borderRadius: 6,
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
          }}>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", opacity: .9 }}>Grand total</span>
            <span className="pb-grand-num" style={{ fontSize: 17, fontWeight: 800, fontFamily: "DM Mono, monospace" }}>{fmtINR(totals.grandTotal)}</span>
          </div>
          <div style={{ marginTop: 7, paddingTop: 6, borderTop: `1px dashed ${COL.line}` }}>
            <div className="pb-totals-row" style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 10.5 }}>
              <span style={{ color: COL.mute }}>Paid ({r.paymentMode || "Cash"})</span>
              <b style={{ color: "#16a34a", fontFamily: "DM Mono, monospace" }}>{fmtINR(totals.paid)}</b>
            </div>
            {totals.balance > 0 && <div className="pb-totals-row" style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 10.5 }}><span style={{ color: COL.mute }}>Balance due</span><b style={{ color: "#dc2626", fontFamily: "DM Mono, monospace" }}>{fmtINR(totals.balance)}</b></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function AmountWords({ id, totals, amountInWords, COL, flat, noPadding, bilingual }) {
  return (
    <div className={noPadding ? "" : "pb-words"} style={{ background: flat ? "transparent" : COL.soft, border: flat ? "none" : `1px dashed ${id.accent}50`, borderRadius: 6 }}>
      <span style={{ fontWeight: 800, color: id.accent, marginRight: 6, letterSpacing: ".3px", textTransform: "uppercase", fontSize: 8.5 }}>
        {bilingual ? "शब्दों में · Amount in words" : "Amount in words"}
      </span>
      <span style={{ fontWeight: 700 }}>{amountInWords(totals.grandTotal)}</span>
    </div>
  );
}

function FooterFull({ id, COL, noPadding, bilingual }) {
  return (
    <>
      <div className={noPadding ? "" : "pb-foot"} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", padding: noPadding ? 0 : undefined }}>
        {(id.bank?.name || id.bank?.account || id.bank?.upi) && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: COL.mute, letterSpacing: ".5px", textTransform: "uppercase", marginBottom: 4 }}>
              {bilingual ? "भुगतान विवरण · Payment details" : "Payment details"}
            </div>
            <div style={{ fontSize: 9.5, lineHeight: 1.6 }}>
              {id.bank.name &&    <div><b>Bank</b> · {id.bank.name}{id.bank.branch ? ` (${id.bank.branch})` : ""}</div>}
              {id.bank.account && <div><b>A/c</b> · <span style={{ fontFamily: "DM Mono, monospace" }}>{id.bank.account}</span></div>}
              {id.bank.ifsc    && <div><b>IFSC</b> · <span style={{ fontFamily: "DM Mono, monospace" }}>{id.bank.ifsc}</span></div>}
              {id.bank.upi     && <div><b>UPI</b> · <span style={{ fontFamily: "DM Mono, monospace" }}>{id.bank.upi}</span></div>}
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div>
              <div className="pb-sign-line" style={{ height: 30, borderBottom: `1.5px solid ${COL.ink}` }} />
              <div style={{ fontSize: 8.5, color: COL.mute, marginTop: 3, textAlign: "center", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>
                {bilingual ? "फार्मासिस्ट · Pharmacist" : "Pharmacist signature"}
              </div>
            </div>
            <div>
              <div className="pb-sign-line" style={{ height: 30, borderBottom: `1.5px solid ${COL.ink}` }} />
              <div style={{ fontSize: 8.5, color: COL.mute, marginTop: 3, textAlign: "center", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>
                {bilingual ? "प्राप्तकर्ता · Receiver" : "Receiver signature"}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="pb-terms" style={{ borderTop: `2px solid ${id.color}`, background: COL.soft, color: COL.mute, lineHeight: 1.45 }}>
        {id.terms.length > 0 && (
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {id.terms.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        )}
        {id.footerNote && <div style={{ marginTop: 6, padding: "5px 9px", background: "#fff", border: `1px solid ${COL.line}`, borderRadius: 4, fontStyle: "italic", color: COL.ink, fontSize: 9.5 }}>{id.footerNote}</div>}
        <div style={{ marginTop: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>This is a computer-generated tax invoice.</span>
          <span>Generated · {new Date().toLocaleString("en-IN")}</span>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TEMPLATE REGISTRY
═══════════════════════════════════════════════════════════════════ */
// R7hr-46: pharmacy is now single-template (Classic Modern). T2-T10
// render functions were removed; this registry now exposes T1 only so
// the dispatcher in PharmacyBill.jsx and the Settings picker in
// PharmacyHomePage.jsx both surface a single locked layout.
export const TEMPLATES = [
  { id: 1, key: "classic", label: "Classic Modern", audience: "in-house", sub: "Gradient masthead · clinical", Render: T1_ClassicModern },
];

export default TEMPLATES;
