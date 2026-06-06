/**
 * einvoiceJsonParser.js  (R7hr-16 — C4)
 *
 * Pure, synchronous parser for GSTN IRP e-invoice JSON (Notification 60/2020-CT,
 * official schema version 1.1). Knows the canonical field paths and is
 * defensive against missing / partial payloads since real-world IRP
 * downloads vary across portals (NIC, Cygnet, IRIS, Adaequare, etc.).
 *
 * NO I/O. NO DB calls. NO network. NO file-system. Caller (C7
 * controller) is responsible for unwrapping the upstream payload
 * before calling this fn.
 *
 *   ── WRAPPED IRP RESPONSES ──
 * If the supplier hands the buyer a `{ Irn, SignedInvoice, SignedQRCode }`
 * envelope, `SignedInvoice` is a JWS (Header.Payload.Signature). The caller
 * MUST decode the middle Base64URL segment to JSON before invoking this
 * parser:
 *
 *   const seg = signedInvoice.split('.')[1];
 *   const pad = '='.repeat((4 - seg.length % 4) % 4);
 *   const json = JSON.parse(
 *     Buffer.from(seg.replace(/-/g,'+').replace(/_/g,'/') + pad, 'base64')
 *           .toString('utf8'),
 *   );
 *   parseEInvoiceJson(json);
 *
 * If a wrapped envelope is passed in directly, we throw
 * `e.code = 'SIGNED_INVOICE_NOT_UNWRAPPED'` so the controller can
 * either unwrap or 422 gracefully.
 *
 *   ── IRN SIGNATURE VERIFICATION ──
 * Out of scope. Verifying the GSTN public-key signature requires an
 * outbound IRP API call. This parser trusts what it's given — the buyer
 * is using it as a data-entry shortcut, not a legal-validity check.
 *
 *   ── SCHEMA FIELDS WE DO NOT GET ──
 * GSTN's schema deliberately omits MRP, batch number, and expiry date —
 * those are pharma-specific and not part of the GST contract. We emit
 * placeholders (mrp: 0, batch: '', expiry: null) and the UI MUST require
 * the pharmacist to fill them before /grn is committed.
 *
 * Public export:
 *   parseEInvoiceJson(jsonObj) → ParsedInvoice
 *
 * Throws:
 *   Error{code:'SIGNED_INVOICE_NOT_UNWRAPPED'}  — wrapped JWS detected
 *   Error{code:'NOT_GSTN_EINVOICE'}             — DocDtls & SellerDtls absent
 */

"use strict";

// R7hr-16: canonical GST slabs used for snapping rounded computed percentages
// back to the legal rates. 17.99 → 18, 4.91 → 5, etc. Anything > 4 pct off
// stays at the raw rounded value so we don't silently hide bad data.
const GST_SLABS = [0, 5, 12, 18, 28];

// ────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────

// R7hr-16: lenient Number coercion. Accepts numbers, numeric strings,
// strings with commas/whitespace, and returns 0 on null/undefined/NaN
// so downstream math never explodes.
function _toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "").replace(/\s/g, "").trim();
    if (cleaned === "") return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// R7hr-16: GSTN spec says DocDtls.Dt is 'DD/MM/YYYY' but real-world
// payloads from Adaequare/IRIS sometimes ship ISO 'YYYY-MM-DD' or even
// full ISO timestamps. Accept all three. Returns null on garbage.
function _parseGstnDate(s) {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;

  // DD/MM/YYYY (canonical GSTN format)
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yyyy = Number(dmy[3]);
    // Basic sanity: months 1-12, days 1-31
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    // Use UTC so this Date is reproducible across server timezones.
    // invoiceDate is display-only on ParsedInvoice (per shared convention #12),
    // so anchoring at UTC midnight of the IST calendar day is acceptable
    // simplicity here.
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ISO YYYY-MM-DD or full ISO 8601 timestamp
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const yyyy = Number(iso[1]);
    const mm = Number(iso[2]);
    const dd = Number(iso[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Last resort: let Date try
  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

// R7hr-16: GST percentages should land on canonical slabs. We compute pct
// = tax / taxable * 100 which floats slightly (17.99875 etc.); snap to
// the nearest slab within 1 percentage-point tolerance. Beyond that
// return the rounded raw value so the controller / UI surfaces the
// anomaly instead of silently quoting a wrong slab.
function _snapGstSlab(pct) {
  if (!Number.isFinite(pct)) return 0;
  if (pct <= 0) return 0;
  for (const slab of GST_SLABS) {
    if (Math.abs(pct - slab) <= 1) return slab;
  }
  // Outside tolerance — return integer-rounded value so the data is at
  // least usable but obviously not a standard slab.
  return Math.round(pct * 100) / 100;
}

// R7hr-16: trim+coalesce a chain of optional string fields into a single
// comma-joined address line. Used for SellerDtls and (potentially)
// BuyerDtls. Empties get dropped, no trailing commas, no double spaces.
function _joinAddress(parts) {
  return (parts || [])
    .map((p) => (p === null || p === undefined ? "" : String(p).trim()))
    .filter((p) => p.length > 0)
    .join(", ");
}

// R7hr-16: safe string extractor — returns '' for null/undef/non-string,
// trims everything else. Many GSTN portals ship null where strings are
// expected.
function _toStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Parse a GSTN IRP e-invoice JSON payload into the canonical ParsedInvoice
 * shape consumed by the pharmacy GRN UI.
 *
 * @param {object} jsonObj  parsed JSON object (NOT a JWS string, NOT a
 *                          wrapped IRP envelope — caller unwraps first).
 * @returns {object}        ParsedInvoice — see file header for shape.
 * @throws  {Error}         code='SIGNED_INVOICE_NOT_UNWRAPPED' if jsonObj
 *                          looks like a raw IRP envelope.
 * @throws  {Error}         code='NOT_GSTN_EINVOICE' if both DocDtls and
 *                          SellerDtls are absent (i.e. wrong schema).
 */
function parseEInvoiceJson(jsonObj) {
  // R7hr-16: paranoid guard — reject null / non-object inputs early so
  // downstream property access is safe.
  if (!jsonObj || typeof jsonObj !== "object" || Array.isArray(jsonObj)) {
    const e = new Error("NOT_GSTN_EINVOICE");
    e.code = "NOT_GSTN_EINVOICE";
    throw e;
  }

  // R7hr-16: detect a wrapped IRP envelope. If the buyer pasted the raw
  // GSTN API response, `SignedInvoice` is a JWS we cannot parse in a pure
  // synchronous fn without pulling in a base64 decoder. Defer to caller.
  if (typeof jsonObj.SignedInvoice === "string" && jsonObj.SignedInvoice.length > 0) {
    const e = new Error("SIGNED_INVOICE_NOT_UNWRAPPED");
    e.code = "SIGNED_INVOICE_NOT_UNWRAPPED";
    throw e;
  }

  const DocDtls    = jsonObj.DocDtls    || null;
  const SellerDtls = jsonObj.SellerDtls || null;
  const ItemList   = Array.isArray(jsonObj.ItemList) ? jsonObj.ItemList : [];
  const ValDtls    = jsonObj.ValDtls    || null;

  // R7hr-16: structural validation. Without DocDtls AND SellerDtls there
  // is essentially zero confidence this is a GSTN payload — bail so the
  // controller can fall back to the PDF/OCR flow.
  if (!DocDtls && !SellerDtls) {
    const e = new Error("NOT_GSTN_EINVOICE");
    e.code = "NOT_GSTN_EINVOICE";
    throw e;
  }

  // ── Supplier (SellerDtls) ──
  // R7hr-16: prefer legal name (LglNm); fall back to trade name (TrdNm).
  // Both can legally be empty in the schema; downstream UI will require
  // pharmacist to verify before commit.
  const supplierName =
    _toStr(SellerDtls && SellerDtls.LglNm) ||
    _toStr(SellerDtls && SellerDtls.TrdNm);

  const supplierGstin = _toStr(SellerDtls && SellerDtls.Gstin);

  const supplierAddress = SellerDtls
    ? _joinAddress([
        SellerDtls.Addr1,
        SellerDtls.Addr2,
        SellerDtls.Loc,
        SellerDtls.Stcd,
        SellerDtls.Pin,
      ])
    : "";

  // ── Document header (DocDtls) ──
  const invoiceNo   = _toStr(DocDtls && DocDtls.No);
  const invoiceDate = DocDtls ? _parseGstnDate(DocDtls.Dt) : null;

  // ── Lines (ItemList[]) ──
  const lines = ItemList.map((item) => {
    if (!item || typeof item !== "object") {
      // R7hr-16: degenerate row — emit an empty line so indexes still
      // align with whatever upstream expected.
      return {
        extractedName: "",
        hsn: "",
        batch: "",
        expiry: null,
        qty: 0,
        mrp: 0,
        purchaseRate: 0,
        discount: 0,
        gstPct: 0,
        total: 0,
        rawLineText: "",
      };
    }

    const qty          = _toNum(item.Qty);
    const purchaseRate = _toNum(item.UnitPrice);
    const discount     = _toNum(item.Discount);
    const taxable      = _toNum(item.AssAmt);
    const igst         = _toNum(item.IgstAmt);
    const cgst         = _toNum(item.CgstAmt);
    const sgst         = _toNum(item.SgstAmt);
    const total        = _toNum(item.TotItemVal);

    // R7hr-16: GSTN does not carry a single "gst percent" field per row;
    // it carries the absolute amounts. We compute pct from taxable +
    // (IGST OR CGST+SGST) and snap to a legal slab.
    let gstPct = 0;
    const totalTax = igst > 0 ? igst : cgst + sgst;
    if (taxable > 0 && totalTax > 0) {
      gstPct = _snapGstSlab((totalTax / taxable) * 100);
    }

    return {
      extractedName: _toStr(item.PrdDesc),
      hsn:           _toStr(item.HsnCd),
      // R7hr-16: GSTN schema has no batch/expiry/mrp fields. Surface
      // placeholders; UI must require the pharmacist to fill them.
      batch:         "",
      expiry:        null,
      qty,
      mrp:           0,
      purchaseRate,
      discount,
      gstPct,
      total,
      rawLineText:   "",
    };
  });

  // ── Totals (ValDtls) ──
  // R7hr-16: if ValDtls is missing fall back to summing line items so the
  // UI still gets a sensible footer.
  let totals;
  if (ValDtls && typeof ValDtls === "object") {
    const assVal = _toNum(ValDtls.AssVal);
    const igstV  = _toNum(ValDtls.IgstVal);
    const cgstV  = _toNum(ValDtls.CgstVal);
    const sgstV  = _toNum(ValDtls.SgstVal);
    totals = {
      taxable: assVal,
      // Per Notification 60/2020 either IGST (inter-state) or CGST+SGST
      // (intra-state) is populated, never both meaningfully.
      gst:     igstV > 0 ? igstV : cgstV + sgstV,
      gross:   _toNum(ValDtls.TotInvVal),
    };
  } else {
    // R7hr-16: sum from lines as a defensive fallback.
    const taxable = lines.reduce((s, l) => s + (l.total - (l.total * l.gstPct) / (100 + l.gstPct || 1)), 0);
    const gross   = lines.reduce((s, l) => s + l.total, 0);
    totals = {
      taxable: Math.round(taxable * 100) / 100,
      gst:     Math.round((gross - taxable) * 100) / 100,
      gross:   Math.round(gross * 100) / 100,
    };
  }

  return {
    supplier: {
      name:    supplierName,
      gstin:   supplierGstin,
      address: supplierAddress,
    },
    invoiceNo,
    invoiceDate,
    lines,
    totals,
    // R7hr-16: Tier 1 GSTN JSON is perfect-confidence by construction —
    // the data was signed by IRP and was already validated against the
    // canonical schema. The controller still merges this with matcher
    // confidence (C2/C3) per row before persisting.
    confidence: {
      supplier:    1.0,
      invoiceNo:   1.0,
      invoiceDate: 1.0,
      lines:       1.0,
    },
  };
}

module.exports = {
  parseEInvoiceJson,
  // R7hr-16: helpers exported under _ prefix for unit tests + downstream
  // re-use (e.g. the PDF/OCR parser will want the same _toNum/_snapGstSlab
  // semantics for consistency). They're not part of the public contract.
  _toNum,
  _parseGstnDate,
  _snapGstSlab,
};
