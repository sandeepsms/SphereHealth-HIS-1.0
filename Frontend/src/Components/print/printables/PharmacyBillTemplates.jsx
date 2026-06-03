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
import { ESCPOS_FEED_CUT } from "../../../utils/printUtils";

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
        {id.logo && <img src={id.logo} alt="" className="pb-mast-logo" style={{ objectFit: "contain", background: "#fff", borderRadius: 10 }} />}
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

/* ─────────────────────────────────────────────────────────────────
   2. MINIMALIST LINES — pure typography, thin rules, no colour panels
──────────────────────────────────────────────────────────────────── */
export function T2_Minimalist(p) {
  const { id, COL, receipt: r, hasControlled } = p;
  return (
    <>
      <div style={{ padding: "20px 22px 12px", borderBottom: `2px solid ${COL.ink}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.5px" }}>{id.name}</div>
            {id.tagline && <div style={{ fontSize: 11, color: COL.mute, marginTop: 2 }}>{id.tagline}</div>}
            <div style={{ fontSize: 10, color: COL.mute, marginTop: 6, lineHeight: 1.5 }}>{id.addressStr}</div>
            <div style={{ fontSize: 10, color: COL.mute, marginTop: 2 }}>{id.phone} {id.email && `· ${id.email}`}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10, fontFamily: "DM Mono, monospace" }}>
            <div><span style={{ color: COL.mute }}>GSTIN</span> {id.gstin || "—"}</div>
            <div><span style={{ color: COL.mute }}>D.L.</span> {id.drugLicense || "—"}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "10px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: COL.mute }}>
          TAX INVOICE · <b style={{ color: COL.ink, fontFamily: "DM Mono, monospace" }}>{r.billNumber}</b>
        </div>
        <div style={{ fontSize: 10, color: COL.mute }}>
          {r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : new Date().toLocaleString("en-IN")}
        </div>
      </div>
      <BilledTo {...p} flat />
      {hasControlled && <SchHBanner />}
      <ItemsTable {...p} headerStyle={{ background: COL.soft, color: COL.ink, borderTop: `1.5px solid ${COL.ink}`, borderBottom: `1.5px solid ${COL.ink}` }} bordered={false} />
      <HsnTotalsSplit {...p} flat />
      <AmountWords {...p} flat />
      <FooterFull {...p} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   3. BORDERED HERITAGE — decorative double-line frame, centred header
──────────────────────────────────────────────────────────────────── */
export function T3_Heritage(p) {
  const { id, receipt: r, COL, hasControlled } = p;
  return (
    <div style={{ margin: 8, border: `3px double ${id.color}`, padding: 6 }}>
      <div style={{ border: `1px solid ${id.color}40`, padding: "14px 20px" }}>
        <div style={{ textAlign: "center" }}>
          {id.logo && <img src={id.logo} alt="" style={{ height: 50, marginBottom: 6 }} />}
          <div style={{ fontSize: 22, fontWeight: 800, color: id.color, letterSpacing: "1px" }}>{id.name.toUpperCase()}</div>
          {id.tagline && <div style={{ fontSize: 10, color: COL.mute, marginTop: 2, fontStyle: "italic" }}>{id.tagline}</div>}
          <div style={{ fontSize: 10, color: COL.mute, marginTop: 6 }}>{id.addressStr}</div>
          <div style={{ fontSize: 10, color: COL.mute, marginTop: 2 }}>📞 {id.phone || "—"} · ✉ {id.email || "—"}</div>
          <div style={{ fontSize: 9.5, color: COL.ink, marginTop: 6, fontFamily: "DM Mono, monospace" }}>
            GSTIN: <b>{id.gstin || "—"}</b> · D.L.: <b>{id.drugLicense || "—"}</b>
          </div>
        </div>
        <div style={{ borderTop: `1px dashed ${id.color}80`, margin: "10px -20px", padding: "8px 20px 0", display: "flex", justifyContent: "space-between" }}>
          {/* R7eo-A — honour billLabel override (Cash Memo / Credit Note / ...) */}
          <div style={{ fontSize: 11 }}><b>{p.billLabel || "Tax Invoice"} No:</b> <span style={{ fontFamily: "DM Mono, monospace", color: id.accent, fontWeight: 800 }}>{r.billNumber}</span></div>
          <div style={{ fontSize: 10, color: COL.mute }}>{new Date(r.createdAt || Date.now()).toLocaleString("en-IN")}</div>
        </div>
        <div style={{ padding: "8px 0", borderBottom: `1px dashed ${id.color}80`, marginBottom: 8 }}>
          <BilledTo {...p} flat noPadding />
        </div>
        {hasControlled && <SchHBanner />}
        <ItemsTable {...p} headerStyle={{ background: id.color + "12", color: id.color, borderTop: `1px solid ${id.color}`, borderBottom: `1px solid ${id.color}` }} bordered noPadding />
        <HsnTotalsSplit {...p} flat noPadding />
        <AmountWords {...p} flat noPadding />
        <FooterFull {...p} noPadding />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   4. PREMIUM DARK — dark navy header, white body, gold accents
──────────────────────────────────────────────────────────────────── */
export function T4_PremiumDark(p) {
  const { id, receipt: r, COL, hasControlled } = p;
  const dark = "#0f172a", gold = "#d4af37";
  return (
    <>
      <div style={{ background: dark, color: "#fff", padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {id.logo && <img src={id.logo} alt="" className="pb-mast-logo" style={{ objectFit: "contain", background: "#fff", borderRadius: 6 }} />}
          <div style={{ flex: 1 }}>
            <div className="pb-mast-name" style={{ fontWeight: 800, color: gold, letterSpacing: ".3px" }}>{id.name}</div>
            {id.tagline && <div className="pb-mast-line" style={{ opacity: .85, marginTop: 1 }}>{id.tagline}</div>}
          </div>
          <div style={{ textAlign: "right", borderLeft: `2px solid ${gold}`, paddingLeft: 14, fontSize: 9.5 }}>
            {/* R7eo-A — billLabel override falls through to "Tax Invoice" */}
            <div style={{ color: gold, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase" }}>{p.billLabel || "Tax Invoice"}</div>
            <div style={{ fontFamily: "DM Mono, monospace", fontWeight: 800, fontSize: 13, marginTop: 2 }}>{r.billNumber}</div>
            <div style={{ opacity: .8, marginTop: 2 }}>{new Date(r.createdAt || Date.now()).toLocaleDateString("en-IN")}</div>
          </div>
        </div>
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${gold}30`, fontSize: 9.5, opacity: .9, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>{id.addressStr}</span>
          {id.phone && <span>📞 {id.phone}</span>}
          {id.gstin       && <span style={{ marginLeft: "auto" }}>GSTIN · <b style={{ fontFamily: "DM Mono, monospace", color: gold }}>{id.gstin}</b></span>}
          {id.drugLicense && <span>D.L. · <b style={{ fontFamily: "DM Mono, monospace", color: gold }}>{id.drugLicense}</b></span>}
        </div>
      </div>
      <BilledTo {...p} />
      {hasControlled && <SchHBanner />}
      <ItemsTable {...p} headerStyle={{ background: dark, color: gold }} />
      <HsnTotalsSplit {...p} grandColor={{ from: dark, to: "#1e293b" }} />
      <AmountWords {...p} />
      <FooterFull {...p} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   5. CARD GRID — every section in its own bordered card
──────────────────────────────────────────────────────────────────── */
export function T5_CardGrid(p) {
  const { id, receipt: r, COL, hasControlled } = p;
  const card = { border: `1px solid ${COL.line}`, borderRadius: 8, background: "#fff", boxShadow: "0 1px 2px rgba(15,23,42,.04)" };
  return (
    <div style={{ padding: 8, background: "#f8fafc" }}>
      <div style={{ ...card, padding: "12px 16px", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {id.logo && <img src={id.logo} alt="" style={{ width: 44, height: 44, objectFit: "contain" }} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: id.color }}>{id.name}</div>
            <div style={{ fontSize: 10, color: COL.mute }}>{id.addressStr}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 9.5 }}>
            <div style={{ fontFamily: "DM Mono, monospace", fontWeight: 800, fontSize: 12 }}>{r.billNumber}</div>
            <div style={{ color: COL.mute, marginTop: 2 }}>{new Date(r.createdAt || Date.now()).toLocaleDateString("en-IN")}</div>
            {id.gstin && <div style={{ marginTop: 4, fontSize: 9 }}>GSTIN · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.gstin}</b></div>}
          </div>
        </div>
      </div>
      <div style={{ ...card, marginBottom: 8 }}><BilledTo {...p} flat /></div>
      {hasControlled && <SchHBanner />}
      <div style={{ ...card, marginBottom: 8, overflow: "hidden" }}>
        <ItemsTable {...p} headerStyle={{ background: id.color + "10", color: id.color }} noPadding />
      </div>
      <div style={{ ...card, marginBottom: 8 }}><HsnTotalsSplit {...p} flat noPadding /></div>
      <div style={{ ...card, marginBottom: 8 }}><AmountWords {...p} flat noPadding /></div>
      <div style={{ ...card }}><FooterFull {...p} noPadding /></div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   6. RETAIL EXPRESS — vibrant chips, customer-facing, outsourced
──────────────────────────────────────────────────────────────────── */
export function T6_RetailExpress(p) {
  const { id, receipt: r, COL, hasControlled } = p;
  return (
    <>
      <div style={{ background: id.color, color: "#fff", padding: "16px 22px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -40, top: -40, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,.15)" }} />
        <div style={{ position: "absolute", right: -60, bottom: -60, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,.08)" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
          {id.logo && <img src={id.logo} alt="" className="pb-mast-logo" style={{ objectFit: "contain", background: "#fff", borderRadius: "50%", padding: 5 }} />}
          <div style={{ flex: 1 }}>
            <div className="pb-mast-name" style={{ fontWeight: 800 }}>{id.name}</div>
            {id.tagline && <div className="pb-mast-line" style={{ opacity: .9, marginTop: 1 }}>★ {id.tagline}</div>}
          </div>
        </div>
        <div style={{ position: "relative", marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[id.addressStr, id.phone, id.gstin && `GSTIN · ${id.gstin}`, id.drugLicense && `D.L. · ${id.drugLicense}`].filter(Boolean).map((s, i) => (
            <span key={i} style={{ background: "rgba(255,255,255,.22)", padding: "3px 9px", borderRadius: 12, fontSize: 9.5 }}>{s}</span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "10px 22px", background: id.accent + "08", borderBottom: `1.5px dashed ${id.color}40` }}>
        <div style={{ textAlign: "center" }}>
          {/* R7eo-A — billLabel override; defaults to "Cash Memo · Tax Invoice" */}
          <div style={{ fontSize: 9, color: COL.mute, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>{p.billLabel || "Cash Memo · Tax Invoice"}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: id.color, fontFamily: "DM Mono, monospace", marginTop: 2 }}>{r.billNumber}</div>
        </div>
      </div>
      <BilledTo {...p} />
      {hasControlled && <SchHBanner />}
      <ItemsTable {...p} headerStyle={{ background: `linear-gradient(135deg, ${id.color}, ${id.accent})`, color: "#fff" }} striped />
      <HsnTotalsSplit {...p} />
      <AmountWords {...p} />
      <FooterFull {...p} />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   7. RECEIPT STRIP — narrow column layout, thermal-style aesthetic
──────────────────────────────────────────────────────────────────── */
export function T7_ReceiptStrip(p) {
  const { id, items, totals, hsnRows, isInterState, receipt: r, COL, fmtINR, amountInWords, _fmtDate, hasControlled } = p;
  return (
    <div style={{ maxWidth: 380, margin: "0 auto", padding: "12px 14px", fontFamily: "DM Mono, monospace", fontSize: 10.5 }}>
      <div style={{ textAlign: "center", borderBottom: `1.5px dashed ${COL.ink}`, paddingBottom: 8 }}>
        {id.logo && <img src={id.logo} alt="" style={{ height: 36, marginBottom: 4 }} />}
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: ".5px" }}>{id.name.toUpperCase()}</div>
        {id.tagline && <div style={{ fontSize: 9, marginTop: 1 }}>{id.tagline}</div>}
        <div style={{ fontSize: 9, color: COL.mute, marginTop: 4, lineHeight: 1.35 }}>{id.addressStr}</div>
        <div style={{ fontSize: 9, marginTop: 1 }}>{id.phone}</div>
        <div style={{ fontSize: 9, marginTop: 4 }}>GSTIN: {id.gstin || "—"}</div>
        <div style={{ fontSize: 9 }}>D.L.: {id.drugLicense || "—"}</div>
      </div>
      <div style={{ padding: "6px 0", textAlign: "center", fontSize: 11, fontWeight: 800 }}>·· TAX INVOICE ··</div>
      <div style={{ borderBottom: `1px dashed ${COL.mute}`, paddingBottom: 4 }}>
        <Row k="Bill #" v={r.billNumber} />
        <Row k="Date"   v={new Date(r.createdAt || Date.now()).toLocaleString("en-IN")} />
        <Row k="Patient" v={r.patientName || "Walk-in"} />
        {r.patientUHID && <Row k="UHID" v={r.patientUHID} />}
        {r.doctorName  && <Row k="Doctor" v={r.doctorName} />}
        <Row k="Type" v={r.saleType || "Walk-in"} />
      </div>
      {hasControlled && <div style={{ padding: "4px 0", fontSize: 9, fontWeight: 800, color: "#dc2626", textAlign: "center" }}>⚠ Schedule H — Rx retained</div>}
      <div style={{ padding: "6px 0", borderBottom: `1px dashed ${COL.mute}` }}>
        {items.map((it, i) => {
          const qty = Number(it.quantity || it.qty || 0);
          const rate = Number(it.unitPrice || it.rate || 0);
          const gst = Number(it.gstRate ?? 12);
          const net = Number(it.netAmount != null ? it.netAmount : qty * rate * (1 + gst/100));
          return (
            <div key={i} style={{ marginBottom: 4, fontSize: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700 }}>{it.drugName || it.name}</span>
                <span>{fmtINR(net)}</span>
              </div>
              <div style={{ fontSize: 8.5, color: COL.mute, display: "flex", justifyContent: "space-between" }}>
                <span>{qty} × {rate.toFixed(2)} · GST {gst}%</span>
                <span>B:{it.batchNo || "—"} · Exp {it.expiryDate ? _fmtDate(it.expiryDate, { month: "short", year: "2-digit" }) : "—"}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: "6px 0", borderBottom: `1px dashed ${COL.mute}` }}>
        <Row k="Sub-total"     v={fmtINR(totals.subTotal)} />
        {totals.totalDisc > 0 && <Row k="Discount" v={`− ${fmtINR(totals.totalDisc)}`} />}
        <Row k="Taxable"        v={fmtINR(totals.totalTaxable)} />
        {isInterState
          ? <Row k="IGST" v={`+ ${fmtINR(totals.totalTax)}`} />
          : <><Row k="CGST" v={`+ ${fmtINR(totals.totalTax/2)}`} /><Row k="SGST" v={`+ ${fmtINR(totals.totalTax/2)}`} /></>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800, marginTop: 4 }}>
          <span>GRAND TOTAL</span>
          <span>{fmtINR(totals.grandTotal)}</span>
        </div>
        <Row k={`Paid (${r.paymentMode || "Cash"})`} v={fmtINR(totals.paid)} />
        {totals.balance > 0 && <Row k="Balance" v={fmtINR(totals.balance)} />}
      </div>
      <div style={{ padding: "6px 0", fontSize: 9, fontStyle: "italic", textAlign: "center" }}>
        {amountInWords(totals.grandTotal)}
      </div>
      <div style={{ padding: "6px 0", borderTop: `1.5px dashed ${COL.ink}`, textAlign: "center", fontSize: 8.5 }}>
        {id.footerNote || "Thank you for visiting"}<br/>
        Generated · {new Date().toLocaleString("en-IN")}
      </div>
      {/* R7bh-F7 / R7bg-7-HIGH-2: ESC/POS feed + cut trailer for thermal
          printers. T7 ("Receipt Strip") is the only template designed for
          thermal kiosk hardware. The bytes are emitted invisibly so the
          browser-side preview never shows them; the kiosk-mode print
          wrapper hands the document to a service worker that POSTs the
          full HTML to the local print daemon, which extracts these bytes
          from `data-escpos-trailer` and appends them after the rendered
          receipt body to feed past the cut bar + slice the paper. */}
      <span
        aria-hidden="true"
        data-escpos-trailer={ESCPOS_FEED_CUT}
        style={{ display: "none" }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   8. BILINGUAL — English + Hindi labels side-by-side
──────────────────────────────────────────────────────────────────── */
export function T8_Bilingual(p) {
  const { id, receipt: r, COL, hasControlled } = p;
  return (
    <>
      <div className="pb-mast" style={{
        background: `linear-gradient(135deg, ${id.color} 0%, ${id.accent} 100%)`,
        color: "#fff", display: "flex", alignItems: "center",
      }}>
        {id.logo && <img src={id.logo} alt="" className="pb-mast-logo" style={{ objectFit: "contain", background: "#fff", borderRadius: 10 }} />}
        <div style={{ flex: 1 }}>
          <div className="pb-mast-name" style={{ fontWeight: 800 }}>{id.name}</div>
          <div className="pb-mast-line" style={{ opacity: .9, marginTop: 1 }}>कर बिल · TAX INVOICE</div>
          <div className="pb-mast-line" style={{ opacity: .85, marginTop: 3 }}>{id.addressStr}</div>
        </div>
        <div className="pb-mast-chip" style={{ background: "rgba(0,0,0,.18)", borderRadius: 7, textAlign: "right" }}>
          {id.gstin       && <div>GSTIN · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.gstin}</b></div>}
          {id.drugLicense && <div style={{ marginTop: 2 }}>औषधि लाइसेंस · <b style={{ fontFamily: "DM Mono, monospace" }}>{id.drugLicense}</b></div>}
        </div>
      </div>
      <div className="pb-title" style={{ display: "flex", justifyContent: "space-between", background: COL.soft, borderBottom: `1px solid ${COL.line}` }}>
        <div>
          <div style={{ fontSize: 8.5, color: COL.mute, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>बिल नं · Bill No</div>
          <div className="pb-title-no" style={{ fontWeight: 800, color: id.accent, fontFamily: "DM Mono, monospace" }}>{r.billNumber}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 8.5, color: COL.mute, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px" }}>दिनांक · Date</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 1 }}>{new Date(r.createdAt || Date.now()).toLocaleString("en-IN")}</div>
        </div>
      </div>
      <div className="pb-billto" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr" }}>
        <div>
          <div style={{ fontSize: 8.5, fontWeight: 800, color: COL.mute, letterSpacing: ".5px", textTransform: "uppercase" }}>रोगी का नाम · Patient</div>
          <div style={{ fontSize: 14, fontWeight: 800, marginTop: 1 }}>{r.patientName || "Walk-in customer"}</div>
          <div style={{ fontSize: 10, color: COL.mute, marginTop: 1 }}>
            UHID {r.patientUHID || "—"}{r.age && ` · आयु ${r.age}`}{r.gender && ` · ${r.gender}`}
            {r.doctorName && <div>डॉक्टर · {r.doctorName}</div>}
          </div>
        </div>
        <div style={{ fontSize: 10, lineHeight: 1.5, background: COL.soft, border: `1px solid ${COL.line}`, borderRadius: 6, padding: "6px 9px" }}>
          <Row k="भुगतान · Payment" v={r.paymentMode || "Cash"} />
          <Row k="प्रकार · Type"    v={r.saleType || "Walk-in"} />
          <Row k="कैशियर · Cashier" v={r.createdBy || "—"} />
        </div>
      </div>
      {hasControlled && <SchHBanner />}
      <ItemsTable {...p} headerStyle={{ background: id.color, color: "#fff" }} />
      <HsnTotalsSplit {...p} />
      <AmountWords {...p} bilingual />
      <FooterFull {...p} bilingual />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
   9. GOVERNMENT GRID — formal grid lines everywhere, monospaced
──────────────────────────────────────────────────────────────────── */
export function T9_GovernmentGrid(p) {
  const { id, receipt: r, COL, hasControlled } = p;
  const border = `1px solid ${COL.ink}`;
  return (
    <div style={{ padding: 10, fontFamily: "'Courier New', monospace" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", border }}>
        <tbody>
          <tr>
            <td style={{ border, padding: 10, textAlign: "center" }} colSpan={2}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "1px" }}>{id.name.toUpperCase()}</div>
              <div style={{ fontSize: 9, marginTop: 2 }}>{id.addressStr}</div>
              <div style={{ fontSize: 9 }}>{id.phone} {id.email && `· ${id.email}`}</div>
              <div style={{ fontSize: 9, marginTop: 3, fontWeight: 700 }}>GSTIN: {id.gstin || "—"} · D.L.: {id.drugLicense || "—"}</div>
            </td>
          </tr>
          <tr>
            <td style={{ border, padding: "6px 10px", width: "50%" }}>
              <b>Bill No:</b> {r.billNumber}<br/>
              <b>Date:</b> {new Date(r.createdAt || Date.now()).toLocaleString("en-IN")}
            </td>
            <td style={{ border, padding: "6px 10px" }}>
              <b>Patient:</b> {r.patientName || "Walk-in"}<br/>
              <b>UHID:</b> {r.patientUHID || "—"} <b>Doctor:</b> {r.doctorName || "—"}
            </td>
          </tr>
        </tbody>
      </table>
      {hasControlled && <SchHBanner />}
      <ItemsTable {...p} headerStyle={{ background: "#fff", color: COL.ink, borderTop: border, borderBottom: border }} bordered fullBorders />
      <HsnTotalsSplit {...p} flat />
      <AmountWords {...p} flat />
      <FooterFull {...p} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   10. LITE QUICK — bare-minimum, fastest layout, no decorations
──────────────────────────────────────────────────────────────────── */
export function T10_LiteQuick(p) {
  const { id, items, totals, isInterState, receipt: r, COL, fmtINR, amountInWords, _fmtDate, hasControlled } = p;
  return (
    <div style={{ padding: "16px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `2px solid ${COL.ink}`, paddingBottom: 6 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{id.name}</div>
          <div style={{ fontSize: 9, color: COL.mute }}>{id.addressStr}</div>
          <div style={{ fontSize: 9 }}>GSTIN {id.gstin || "—"} · D.L. {id.drugLicense || "—"}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 9.5 }}>
          <div style={{ fontFamily: "DM Mono, monospace", fontSize: 12, fontWeight: 800 }}>{r.billNumber}</div>
          <div style={{ color: COL.mute }}>{new Date(r.createdAt || Date.now()).toLocaleString("en-IN")}</div>
        </div>
      </div>
      <div style={{ padding: "8px 0", fontSize: 10.5 }}>
        <b>{r.patientName || "Walk-in"}</b> · UHID {r.patientUHID || "—"}{r.age && ` · ${r.age}Y`}{r.gender && ` ${r.gender}`}
        {r.doctorName && <> · Dr {r.doctorName}</>}
      </div>
      {hasControlled && <SchHBanner />}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${COL.ink}`, borderTop: `1px solid ${COL.ink}` }}>
            <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 8.5, fontWeight: 800 }}>#</th>
            <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 8.5, fontWeight: 800 }}>Medicine</th>
            <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 8.5, fontWeight: 800 }}>Batch · Exp</th>
            <th style={{ padding: "4px 6px", textAlign: "right", fontSize: 8.5, fontWeight: 800 }}>Qty</th>
            <th style={{ padding: "4px 6px", textAlign: "right", fontSize: 8.5, fontWeight: 800 }}>Rate</th>
            <th style={{ padding: "4px 6px", textAlign: "right", fontSize: 8.5, fontWeight: 800 }}>GST</th>
            <th style={{ padding: "4px 6px", textAlign: "right", fontSize: 8.5, fontWeight: 800 }}>Net</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const qty = Number(it.quantity || it.qty || 0);
            const rate = Number(it.unitPrice || it.rate || 0);
            const gst = Number(it.gstRate ?? 12);
            const net = Number(it.netAmount != null ? it.netAmount : qty * rate * (1 + gst/100));
            return (
              <tr key={i} style={{ borderBottom: `1px dotted ${COL.line}` }}>
                <td style={{ padding: "4px 6px", fontSize: 9 }}>{i + 1}</td>
                <td style={{ padding: "4px 6px", fontSize: 9 }}>{it.drugName || it.name}</td>
                <td style={{ padding: "4px 6px", fontSize: 8.5, fontFamily: "DM Mono, monospace" }}>{it.batchNo || "—"}{it.expiryDate && ` · ${_fmtDate(it.expiryDate, { month: "short", year: "2-digit" })}`}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 9 }}>{qty}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 9 }}>{rate.toFixed(2)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 8.5 }}>{gst}%</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontSize: 9, fontWeight: 700 }}>{net.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
        <div style={{ minWidth: 220, fontSize: 10 }}>
          <Row k="Sub-total"      v={fmtINR(totals.subTotal)} />
          {totals.totalDisc > 0 && <Row k="Discount" v={`− ${fmtINR(totals.totalDisc)}`} />}
          <Row k="Taxable" v={fmtINR(totals.totalTaxable)} />
          {isInterState
            ? <Row k="IGST" v={`+ ${fmtINR(totals.totalTax)}`} />
            : <><Row k="CGST" v={`+ ${fmtINR(totals.totalTax/2)}`} /><Row k="SGST" v={`+ ${fmtINR(totals.totalTax/2)}`} /></>}
          <div style={{ borderTop: `2px solid ${COL.ink}`, marginTop: 4, paddingTop: 4, display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}>
            <span>TOTAL</span><span>{fmtINR(totals.grandTotal)}</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 9, fontStyle: "italic" }}>{amountInWords(totals.grandTotal)}</div>
      <div style={{ marginTop: 12, paddingTop: 6, borderTop: `1px solid ${COL.line}`, display: "flex", justifyContent: "space-between", fontSize: 8.5, color: COL.mute }}>
        <span>Cashier: {r.createdBy || "—"}</span>
        <span>Generated {new Date().toLocaleString("en-IN")}</span>
      </div>
    </div>
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

function BilledTo(p) {
  const { receipt: r, id, COL, flat, noPadding } = p;
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

function SchHBanner() {
  return (
    <div className="pb-schh" style={{ background: "#fef2f2", border: "1.5px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: 5, color: "#7f1d1d" }}>
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
          {items.map((it, i) => {
            const qty = Number(it.quantity || it.qty || 0);
            const rate = Number(it.unitPrice || it.rate || 0);
            const gst = Number(it.gstRate ?? 12);
            const gross = qty * rate;
            const disc = Number(it.discountAmount != null ? it.discountAmount : gross * (Number(it.discountPercent || 0) / 100));
            const taxable = Number(it.taxableAmount != null ? it.taxableAmount : gross - disc);
            const net = Number(it.netAmount != null ? it.netAmount : taxable + taxable * gst / 100);
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
              <tr key={i} className="bill-line-row" style={{ borderBottom: `1px solid ${COL.line}`, background: bg }}>
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
export const TEMPLATES = [
  { id: 1,  key: "classic",   label: "Classic Modern",   audience: "in-house",   sub: "Gradient masthead · clinical",       Render: T1_ClassicModern },
  { id: 2,  key: "minimal",   label: "Minimalist Lines", audience: "in-house",   sub: "Mono typography · no colours",        Render: T2_Minimalist },
  { id: 3,  key: "heritage",  label: "Bordered Heritage",audience: "in-house",   sub: "Decorative frame · centred header",   Render: T3_Heritage },
  { id: 4,  key: "premium",   label: "Premium Dark",     audience: "in-house",   sub: "Dark navy · gold accents",            Render: T4_PremiumDark },
  { id: 5,  key: "cards",     label: "Card Grid",        audience: "in-house",   sub: "Section cards with shadows",          Render: T5_CardGrid },
  { id: 6,  key: "retail",    label: "Retail Express",   audience: "outsourced", sub: "Vibrant chips · cash-memo style",     Render: T6_RetailExpress },
  { id: 7,  key: "receipt",   label: "Receipt Strip",    audience: "outsourced", sub: "Thermal-style narrow column",         Render: T7_ReceiptStrip },
  { id: 8,  key: "bilingual", label: "Bilingual",        audience: "outsourced", sub: "English + Hindi labels",              Render: T8_Bilingual },
  { id: 9,  key: "gov",       label: "Government Grid",  audience: "outsourced", sub: "Formal grid · Courier mono",          Render: T9_GovernmentGrid },
  { id: 10, key: "lite",      label: "Lite Quick",       audience: "outsourced", sub: "Bare-minimum · fastest layout",       Render: T10_LiteQuick },
];

export default TEMPLATES;
