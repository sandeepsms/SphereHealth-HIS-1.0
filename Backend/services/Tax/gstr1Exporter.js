/**
 * services/Tax/gstr1Exporter.js  (R7bh-F6 / R7bg CRIT-A1 / GST §37)
 *
 * Build the GSTR-1 portal JSON for a given YYYY-MM period.
 *
 * Pre-R7bh the HIS had NO GSTR-1 export endpoint — every month the
 * accountant manually keyed totals into the GSTN portal. The frozen
 * GstMonthlySnapshot (R7ar) captures the per-month aggregate but the
 * portal needs **line-level rows** grouped into:
 *
 *   b2c   — small invoices grouped by state + rate (no customer GSTIN)
 *   b2cl  — large invoices (> ₹2.5L per invoice, intra-or-inter-state,
 *           still no customer GSTIN)
 *   b2b   — invoices where customer GSTIN is known (ITC eligible)
 *   cdnr  — credit/debit notes registered (refunds / cancellations)
 *   hsn   — Line 12, HSN-wise summary (qty + value + tax per HSN+rate+UQC)
 *   nil   — nil-rated / exempt / non-GST outward supplies
 *
 * The shape below tracks GSTN GSTR-1 v2.1 schema as published 2025-09.
 * Any deviations flagged inline. Downstream the accountant either:
 *   (a) uploads the JSON to the GSTN offline tool which generates the
 *       JSON-as-Excel payload to import on the portal, or
 *   (b) uses an API gateway (Tally/Cleartax/...) that consumes this JSON.
 *
 * The shape is a best-effort skeleton — real portal validation happens
 * downstream and a missing field there will surface as a NoticeOf
 * Mismatch the accountant can fix in the next regen cycle.
 */
"use strict";

const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const PharmacySale = require("../../models/Pharmacy/PharmacySaleModel");
const CreditNote = require("../../models/Billing/CreditNote");
const { toNum } = require("../../utils/money");

// State code → fallback to env. GSTN uses 2-digit state codes; if the
// hospital hasn't configured one, default to "29" (Karnataka) — keeps the
// JSON valid; accountant can correct in the next regen.
const HOSPITAL_STATE_CODE_RAW = process.env.HOSPITAL_STATE_CODE || "29";
const HOSPITAL_GSTIN = process.env.HOSPITAL_GSTIN || "";

// ─────────────────────────────────────────────────────────────────────
// R7bm-F7 — GST state-code normalisation.
//
// Inter-state vs intra-state determination drives whether the invoice
// carries CGST+SGST (intra) or IGST (inter). Getting it wrong corrupts
// GSTR-1 *and* shifts ITC eligibility for the customer downstream.
//
// Pre-R7bm both `hospitalStateCode` and `placeOfSupply` were compared
// as raw strings — so "29" vs "29 " vs "29-KA" vs "Karnataka" all
// looked different and would mis-classify the supply. The helpers
// below normalise both sides through the same pipeline + cross-check
// against the official GSTN 2-digit state-code map.
//
// Reference: GST State Code List as notified by GSTN (1..38, with 99
// reserved for "Other Territory" / OIDAR).
// ─────────────────────────────────────────────────────────────────────
const GST_STATE_CODE_MAP = {
  "JAMMU AND KASHMIR": "01", "JAMMU & KASHMIR": "01", "J&K": "01",
  "HIMACHAL PRADESH": "02", "HP": "02",
  "PUNJAB": "03",
  "CHANDIGARH": "04",
  "UTTARAKHAND": "05", "UTTRAKHAND": "05",
  "HARYANA": "06",
  "DELHI": "07",
  "RAJASTHAN": "08",
  "UTTAR PRADESH": "09", "UP": "09",
  "BIHAR": "10",
  "SIKKIM": "11",
  "ARUNACHAL PRADESH": "12",
  "NAGALAND": "13",
  "MANIPUR": "14",
  "MIZORAM": "15",
  "TRIPURA": "16",
  "MEGHALAYA": "17",
  "ASSAM": "18",
  "WEST BENGAL": "19", "WB": "19",
  "JHARKHAND": "20",
  "ODISHA": "21", "ORISSA": "21",
  "CHATTISGARH": "22", "CHHATTISGARH": "22",
  "MADHYA PRADESH": "23", "MP": "23",
  "GUJARAT": "24",
  "DAMAN AND DIU": "25", "DAMAN & DIU": "25",
  "DADRA AND NAGAR HAVELI": "26", "DADRA & NAGAR HAVELI": "26",
  "MAHARASHTRA": "27",
  "ANDHRA PRADESH (BEFORE)": "28",
  "KARNATAKA": "29", "KA": "29",
  "GOA": "30",
  "LAKSHADWEEP": "31",
  "KERALA": "32",
  "TAMIL NADU": "33", "TN": "33",
  "PUDUCHERRY": "34", "PONDICHERRY": "34",
  "ANDAMAN AND NICOBAR ISLANDS": "35", "ANDAMAN & NICOBAR": "35",
  "TELANGANA": "36",
  "ANDHRA PRADESH": "37", "AP": "37",
  "LADAKH": "38",
  "OTHER TERRITORY": "97", "FOREIGN COUNTRY": "96", "OIDAR": "99",
};

/**
 * Normalise a state value (string) into the canonical 2-digit GST
 * state code. Accepts:
 *   - "29", "29 ", "29-KA", "29-Karnataka", "29|KA" → "29"
 *   - "Karnataka", "karnataka", "KA"               → "29"
 *   - anything that already matches \d{2}          → kept verbatim
 * Returns "" when the input cannot be resolved — caller asserts.
 */
function normalizeGstStateCode(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().toUpperCase();
  if (!s) return "";
  // Prefix-digit form: "29-KA", "29|KA", "29 KA", "29Karnataka"
  const prefixMatch = s.match(/^(\d{2})\b/);
  if (prefixMatch) {
    const code = prefixMatch[1];
    if (Number(code) >= 1 && Number(code) <= 99) return code;
  }
  // Pure name lookup (with separators removed): "WEST BENGAL", "TAMIL_NADU"
  const nameKey = s.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (GST_STATE_CODE_MAP[nameKey]) return GST_STATE_CODE_MAP[nameKey];
  // Strip non-letters and retry
  const lettersKey = s.replace(/[^A-Z]/g, "");
  for (const [k, v] of Object.entries(GST_STATE_CODE_MAP)) {
    if (k.replace(/[^A-Z]/g, "") === lettersKey) return v;
  }
  // Fall-through: numeric-only string of arbitrary length — keep last
  // two digits if they look like a valid code, otherwise unresolved.
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 2) {
    const code = digits.slice(0, 2);
    if (Number(code) >= 1 && Number(code) <= 99) return code;
  }
  return "";
}

const HOSPITAL_STATE_CODE = normalizeGstStateCode(HOSPITAL_STATE_CODE_RAW) || "29";

/**
 * Compare two state codes for intra-state supply. Returns true only
 * when both sides resolve to the same canonical 2-digit code. Throws
 * a helpful error if either side is empty after normalisation — this
 * forces the operator to correct config before a corrupted GSTR-1 is
 * generated rather than silently mis-classifying.
 */
function isIntraStateSupply(hospitalRaw, posRaw, { invoiceRef = "<unknown>" } = {}) {
  const hospital = normalizeGstStateCode(hospitalRaw);
  const pos      = normalizeGstStateCode(posRaw);
  if (!hospital) {
    const e = new Error(
      `GSTR-1: hospital state code is empty / unresolved (raw="${hospitalRaw}"). ` +
      `Set process.env.HOSPITAL_STATE_CODE to a 2-digit GSTN state code (e.g. "29" for Karnataka).`,
    );
    e.code = "GSTR1_HOSPITAL_STATE_EMPTY";
    throw e;
  }
  if (!pos) {
    const e = new Error(
      `GSTR-1: placeOfSupply.state is empty / unresolved (raw="${posRaw}") for invoice ${invoiceRef}. ` +
      `Each invoice must carry a 2-digit GSTN state code in placeOfSupply.`,
    );
    e.code = "GSTR1_POS_STATE_EMPTY";
    throw e;
  }
  return { intraState: hospital === pos, hospital, pos };
}

// B2CL threshold per GSTN portal rules — invoices > ₹2.5L without GSTIN
// must be listed individually rather than aggregated under b2c.
const B2CL_THRESHOLD = 250000;

/**
 * Parse a YYYY-MM period to a IST-anchored [start, end) UTC range.
 */
function _parsePeriodToRange(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error(`Invalid period '${period}' — expected YYYY-MM`);
  }
  const [yyyy, mm] = period.split("-").map(Number);
  const nextY = mm === 12 ? yyyy + 1 : yyyy;
  const nextM = mm === 12 ? 1 : mm + 1;
  const periodStart = new Date(
    `${yyyy}-${String(mm).padStart(2, "0")}-01T00:00:00+05:30`,
  );
  const periodEnd = new Date(
    `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00+05:30`,
  );
  return { periodStart, periodEnd };
}

function _emptySummary() {
  return {
    totalTaxable: 0,
    totalCgst: 0,
    totalSgst: 0,
    totalIgst: 0,
    hsnCount: 0,
    lineCount: 0,
  };
}

/**
 * Internal: walk PatientBill rows in the period and bucket into b2b/b2cl/b2c.
 */
async function _bucketPatientBills(periodStart, periodEnd) {
  const bills = await PatientBill.find({
    billGeneratedAt: { $gte: periodStart, $lt: periodEnd },
    billStatus: { $nin: ["DRAFT", "CANCELLED"] },
  })
    .select(
      "billNumber billDate billGeneratedAt visitType " +
        "grossAmount netAmount taxAmount cgstAmount sgstAmount igstAmount " +
        "customerGstin customerLegalName customerAddress placeOfSupply " +
        "billItems",
    )
    .lean();

  const b2b = [];
  const b2cl = [];
  // b2c is keyed by `${stateCode}-${rate}`
  const b2cMap = new Map();
  // hsn keyed by `${hsn}-${rate}-${uqc}`
  const hsnMap = new Map();

  for (const b of bills) {
    const netAmount = toNum(b.netAmount);
    const taxAmount = toNum(b.taxAmount);
    const cgst = toNum(b.cgstAmount);
    const sgst = toNum(b.sgstAmount);
    const igst = toNum(b.igstAmount);
    // R7bm-F7 — normalise both sides through the canonical GSTN code map
    // so "29" / "29-KA" / "Karnataka" all resolve identically. The helper
    // throws if either side is empty so the accountant catches a config
    // hole BEFORE a wrong GSTR-1 lands on the portal.
    const posRaw = (b.placeOfSupply && (b.placeOfSupply.state || b.placeOfSupply.stateCode || b.placeOfSupply))
      || HOSPITAL_STATE_CODE;
    const { intraState, pos: placeOfSupply } = isIntraStateSupply(
      HOSPITAL_STATE_CODE,
      posRaw,
      { invoiceRef: b.billNumber || String(b._id) },
    );
    const taxable = netAmount; // netAmount is post-discount + pre-tax in this model
    // R7bh-F6: invoice-level rate derived from the dominant taxPercent in
    // billItems (or 0 if no taxable items). Simpler than GSTN's per-line
    // schedule, but the HSN section below carries the per-rate granular
    // detail the portal cross-checks.
    let dominantRate = 0;
    let dominantTaxable = -1;
    const ratesByItem = {};
    for (const it of b.billItems || []) {
      if (!it || it.excludedByPackage) continue;
      const r = Number(it.taxPercent) || 0;
      const v = toNum(it.netAmount);
      ratesByItem[r] = (ratesByItem[r] || 0) + v;
      if (v > dominantTaxable) {
        dominantTaxable = v;
        dominantRate = r;
      }
      // HSN aggregation
      const hsn = it.hsnSacCode || "9993"; // SAC for human-health services
      const uqc = it.billingType === "PER_UNIT" ? "NOS" : "OTH";
      const key = `${hsn}-${r}-${uqc}`;
      const cur = hsnMap.get(key) || {
        hsnSac: hsn,
        rate: r,
        uqc,
        totalQuantity: 0,
        totalValue: 0,
        taxableValue: 0,
        igstAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        cessAmount: 0,
      };
      cur.totalQuantity += Number(it.quantity || 1);
      cur.totalValue += toNum(it.grossAmount);
      cur.taxableValue += v;
      cur.cgstAmount += toNum(it.cgstAmount);
      cur.sgstAmount += toNum(it.sgstAmount);
      cur.igstAmount += toNum(it.igstAmount);
      hsnMap.set(key, cur);
    }

    const invoice = {
      invoiceNumber: b.billNumber || `BILL-${b._id}`,
      invoiceDate: (b.billGeneratedAt || b.billDate || new Date()).toISOString().slice(0, 10),
      invoiceValue: Number((netAmount + taxAmount).toFixed(2)),
      placeOfSupply,
      reverseCharge: "N",
      invoiceType: "Regular",
      etin: "",
      // line item granularity
      items: Object.entries(ratesByItem).map(([rate, taxableValue]) => ({
        rate: Number(rate),
        taxableValue: Number(taxableValue.toFixed(2)),
        // For intra-state half-split; inter-state full igst.
        cgstAmount: intraState
          ? Number(((taxableValue * Number(rate)) / 200).toFixed(2))
          : 0,
        sgstAmount: intraState
          ? Number(((taxableValue * Number(rate)) / 200).toFixed(2))
          : 0,
        igstAmount: !intraState
          ? Number(((taxableValue * Number(rate)) / 100).toFixed(2))
          : 0,
        cessAmount: 0,
      })),
    };

    if (b.customerGstin && /^\d{2}[A-Z0-9]{10}\d[A-Z][A-Z0-9]$/.test(b.customerGstin)) {
      // B2B — customer GSTIN present and structurally valid
      b2b.push({
        customerGstin: b.customerGstin,
        customerLegalName: b.customerLegalName || "",
        customerAddress: b.customerAddress || "",
        ...invoice,
      });
    } else if (invoice.invoiceValue > B2CL_THRESHOLD && !intraState) {
      // B2CL — large inter-state invoice without customer GSTIN
      b2cl.push(invoice);
    } else {
      // B2C aggregation by state + rate (GSTN allows one row per
      // place-of-supply/rate combo).
      const k = `${placeOfSupply}-${dominantRate}`;
      const cur = b2cMap.get(k) || {
        placeOfSupply,
        rate: dominantRate,
        taxableValue: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 0,
        cessAmount: 0,
        invoiceCount: 0,
      };
      cur.taxableValue += taxable;
      cur.cgstAmount += cgst;
      cur.sgstAmount += sgst;
      cur.igstAmount += igst;
      cur.invoiceCount += 1;
      b2cMap.set(k, cur);
    }
  }
  return { b2b, b2cl, b2c: [...b2cMap.values()], hsn: [...hsnMap.values()] };
}

/**
 * Internal: bucket PharmacySale rows. Pharmacy sales mostly fall in the
 * b2c bucket (walk-in retail), but the few that carry customerGstin land
 * in b2b. HSN aggregation merges with PatientBill HSN.
 */
async function _bucketPharmacySales(periodStart, periodEnd, hsnMap) {
  const sales = await PharmacySale.find({
    createdAt: { $gte: periodStart, $lt: periodEnd },
    status: { $nin: ["Cancelled"] },
  })
    .select(
      "invoiceNumber saleDate createdAt grandTotal totalGst customerGstin " +
        "customerName customerAddress placeOfSupply items",
    )
    .lean();

  const b2b = [];
  const b2cl = [];
  const b2cMap = new Map();

  for (const s of sales) {
    const grandTotal = toNum(s.grandTotal);
    const totalGst = toNum(s.totalGst);
    const taxable = grandTotal - totalGst;
    // R7bm-F7 — normalise + assert state codes for pharmacy invoices too.
    const posRaw = (s.placeOfSupply && (s.placeOfSupply.state || s.placeOfSupply.stateCode || s.placeOfSupply))
      || HOSPITAL_STATE_CODE;
    const { intraState, pos: placeOfSupply } = isIntraStateSupply(
      HOSPITAL_STATE_CODE,
      posRaw,
      { invoiceRef: s.invoiceNumber || String(s._id) },
    );

    // dominant rate from items
    let dominantRate = 0;
    let dominantTax = -1;
    const ratesByItem = {};
    for (const it of s.items || []) {
      // R8-CRIT — pharmacy SALE_ITEM stores the rate as `gstRate` and the
      // pre-tax base as `taxableAmount` (netAmount is tax-INCLUSIVE). Reading
      // the non-existent gstPercent/taxableValue made every pharmacy line
      // resolve to rate 0 and an inflated (tax-inclusive) base — zeroing all
      // pharmacy output GST on GSTR-1 and mislabelling taxable supplies exempt.
      const r = Number(it.gstRate ?? it.gstPercent ?? it.taxPercent ?? 0);
      const v = toNum(it.taxableAmount ?? it.taxableValue ?? it.grossAmount ?? it.sellingPrice);
      ratesByItem[r] = (ratesByItem[r] || 0) + v;
      if (v > dominantTax) {
        dominantTax = v;
        dominantRate = r;
      }
      const hsn = it.hsnCode || it.hsnSacCode || "3004"; // medicines default
      const uqc = it.unitOfMeasure || "NOS";
      const key = `${hsn}-${r}-${uqc}`;
      const cur = hsnMap.get(key) || {
        hsnSac: hsn,
        rate: r,
        uqc,
        totalQuantity: 0,
        totalValue: 0,
        taxableValue: 0,
        igstAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        cessAmount: 0,
      };
      cur.totalQuantity += Number(it.qty || it.quantity || 1);
      cur.totalValue += toNum(it.grossAmount ?? it.sellingPrice);
      cur.taxableValue += v;
      const itemGst = (v * Number(r)) / 100;
      if (intraState) {
        cur.cgstAmount += itemGst / 2;
        cur.sgstAmount += itemGst / 2;
      } else {
        cur.igstAmount += itemGst;
      }
      hsnMap.set(key, cur);
    }

    const invoice = {
      invoiceNumber: s.invoiceNumber || `PHAR-${s._id}`,
      invoiceDate: (s.saleDate || s.createdAt).toISOString().slice(0, 10),
      invoiceValue: Number(grandTotal.toFixed(2)),
      placeOfSupply,
      reverseCharge: "N",
      invoiceType: "Regular",
      etin: "",
      items: Object.entries(ratesByItem).map(([rate, taxableValue]) => {
        const taxAtRate = (taxableValue * Number(rate)) / 100;
        return {
          rate: Number(rate),
          taxableValue: Number(taxableValue.toFixed(2)),
          cgstAmount: intraState ? Number((taxAtRate / 2).toFixed(2)) : 0,
          sgstAmount: intraState ? Number((taxAtRate / 2).toFixed(2)) : 0,
          igstAmount: !intraState ? Number(taxAtRate.toFixed(2)) : 0,
          cessAmount: 0,
        };
      }),
    };

    if (s.customerGstin && /^\d{2}[A-Z0-9]{10}\d[A-Z][A-Z0-9]$/.test(s.customerGstin)) {
      b2b.push({
        customerGstin: s.customerGstin,
        customerLegalName: s.customerName || "",
        customerAddress: s.customerAddress || "",
        ...invoice,
      });
    } else if (invoice.invoiceValue > B2CL_THRESHOLD && !intraState) {
      b2cl.push(invoice);
    } else {
      // R8-CRIT — emit one B2C(S) row PER GST rate. The previous code keyed the
      // whole sale on a single `dominantRate` applied to the sale-level taxable,
      // so a mixed-rate basket (e.g. 5% + 18%) was declared entirely at one rate
      // — understating (or, when the largest line was exempt, zeroing) output tax.
      let counted = false;
      for (const [rate, rTaxable] of Object.entries(ratesByItem)) {
        const rr = Number(rate);
        const k = `${placeOfSupply}-${rr}`;
        const cur = b2cMap.get(k) || {
          placeOfSupply,
          rate: rr,
          taxableValue: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          cessAmount: 0,
          invoiceCount: 0,
        };
        cur.taxableValue += rTaxable;
        const gstAtRate = (rTaxable * rr) / 100;
        if (intraState) {
          cur.cgstAmount += gstAtRate / 2;
          cur.sgstAmount += gstAtRate / 2;
        } else {
          cur.igstAmount += gstAtRate;
        }
        if (!counted) { cur.invoiceCount += 1; counted = true; }
        b2cMap.set(k, cur);
      }
    }
  }
  return { b2b, b2cl, b2c: [...b2cMap.values()] };
}

/**
 * Build the credit-note (cdnr) section. Credit notes affect a previous
 * period's outward supply — we still include them under the period in
 * which they were ISSUED (creditNoteDate). The portal reconciles via
 * originalBillNumber + originalBillDate.
 */
async function _bucketCreditNotes(periodStart, periodEnd) {
  const cns = await CreditNote.find({
    creditNoteDate: { $gte: periodStart, $lt: periodEnd },
  }).lean();
  return cns.map((c) => ({
    creditNoteNumber: c.creditNoteNumber || c.cnNumber || `CN-${c._id}`,
    creditNoteDate: (c.creditNoteDate || c.createdAt).toISOString().slice(0, 10),
    originalInvoiceNumber: c.originalBillNumber || "",
    originalInvoiceDate: c.originalBillDate
      ? new Date(c.originalBillDate).toISOString().slice(0, 10)
      : "",
    taxableValue: toNum(c.taxableValue),
    cgstAmount: toNum(c.cgstAmount),
    sgstAmount: toNum(c.sgstAmount),
    igstAmount: toNum(c.igstAmount),
    cessAmount: 0,
    // R7bm-F7 — normalise CN place-of-supply so the portal validator
    // doesn't reject the row over a raw state name.
    placeOfSupply: normalizeGstStateCode(
      (c.placeOfSupply && (c.placeOfSupply.state || c.placeOfSupply.stateCode || c.placeOfSupply))
        || HOSPITAL_STATE_CODE,
    ) || HOSPITAL_STATE_CODE,
    customerGstin: c.customerGstin || "",
    reason: c.reason || "",
    // R7hr-12: hospital-bill credit notes always carry credit-side semantics
    // (the CreditNote collection has no debit-note path). Tag explicitly so
    // the downstream cdnr consumer can distinguish from pharmacy debit notes.
    noteType: "C",
  }));
}

// R7hr-12 (D2-04) — Pharmacy refunds + supplements are stored as embedded
// sub-docs on PharmacySale (returns[].refundedItems[] and
// supplements[].addedItems[]) and never create a CreditNote row, so the
// pre-R7hr-12 GSTR-1 cdnr section was empty for the entire pharmacy stream.
// Per GST §34 / Rule 53 every refund (credit note) and supplementary
// invoice (debit note) must be filed as a SEPARATE document with its own
// number/date — option (a) in the audit suggestedFix. We bucket both
// sources here, key each row off the sub-doc's own timestamp
// (refundedAt / addedAt) so cross-period refunds land in the correct GSTR-1
// month, and tag each row noteType "C" (credit) / "D" (debit) so the
// portal exporter and gstr3bExporter.js can net them correctly.
async function _bucketPharmacyReturnsAndSupplements(periodStart, periodEnd) {
  const rows = [];

  // ── Returns / refunds → credit notes ──────────────────────────────
  // Match on $unwound returns.refundedAt (sub-doc timestamp) so a refund
  // issued in month M+1 against a sale created in M lands in M+1 (per
  // §34, the CN month is the issuance month, NOT the original supply
  // month — original supply stays where it was).
  const returnsAgg = await PharmacySale.aggregate([
    { $match: { "returns.0": { $exists: true } } },
    { $unwind: "$returns" },
    {
      $match: {
        "returns.refundedAt": { $gte: periodStart, $lt: periodEnd },
      },
    },
    {
      $project: {
        _id: 0,
        invoiceNumber: 1,
        saleId: "$_id",
        saleCreatedAt: "$createdAt",
        placeOfSupply: 1,
        customerGstin: 1,
        customerName: 1,
        returnRecord: "$returns",
      },
    },
  ]).option({ allowDiskUse: true, maxTimeMS: 30_000 });

  for (const r of returnsAgg) {
    const rec = r.returnRecord || {};
    const refundedAt = rec.refundedAt || rec.createdAt || new Date();
    const refundTaxable = toNum(rec.refundTaxable);
    const refundGst = toNum(rec.refundGst);
    const posRaw = (r.placeOfSupply && (r.placeOfSupply.state || r.placeOfSupply.stateCode || r.placeOfSupply))
      || HOSPITAL_STATE_CODE;
    let placeOfSupply;
    let intraState;
    try {
      const decision = isIntraStateSupply(
        HOSPITAL_STATE_CODE, posRaw,
        { invoiceRef: rec.refundSlipNumber || r.invoiceNumber || String(r.saleId) },
      );
      intraState = decision.intraState;
      placeOfSupply = decision.pos;
    } catch (_e) {
      // Legacy pharmacy sale missing placeOfSupply — fall back to hospital
      // state (intra). The accountant can correct in the next regen.
      intraState = true;
      placeOfSupply = HOSPITAL_STATE_CODE;
    }
    // Per-item CGST/SGST/IGST split — sum across refundedItems[] so the
    // CDNR row matches the original invoice's intra/inter-state nature.
    let cgst = 0, sgst = 0, igst = 0;
    for (const it of (rec.refundedItems || [])) {
      const gstAmt = toNum(it.gstAmount);
      // Refund line may carry its own split if a future writer adds it,
      // otherwise derive from intra/inter.
      const lineCgst = toNum(it.cgstAmount);
      const lineSgst = toNum(it.sgstAmount);
      const lineIgst = toNum(it.igstAmount);
      if (lineCgst + lineSgst + lineIgst > 0) {
        cgst += lineCgst;
        sgst += lineSgst;
        igst += lineIgst;
      } else if (intraState) {
        cgst += gstAmt / 2;
        sgst += gstAmt / 2;
      } else {
        igst += gstAmt;
      }
    }
    // Fall back to the aggregate refundGst if items[] didn't yield a split
    // (legacy rows where refundedItems[] is sparse).
    if (cgst + sgst + igst === 0 && refundGst > 0) {
      if (intraState) {
        cgst = refundGst / 2;
        sgst = refundGst / 2;
      } else {
        igst = refundGst;
      }
    }
    rows.push({
      creditNoteNumber: rec.refundSlipNumber || `REF-${r.saleId}-${rec._id || ""}`,
      creditNoteDate: new Date(refundedAt).toISOString().slice(0, 10),
      originalInvoiceNumber: r.invoiceNumber || "",
      originalInvoiceDate: r.saleCreatedAt
        ? new Date(r.saleCreatedAt).toISOString().slice(0, 10)
        : "",
      taxableValue: Number(refundTaxable.toFixed(2)),
      cgstAmount: Number(cgst.toFixed(2)),
      sgstAmount: Number(sgst.toFixed(2)),
      igstAmount: Number(igst.toFixed(2)),
      cessAmount: 0,
      placeOfSupply: normalizeGstStateCode(placeOfSupply) || HOSPITAL_STATE_CODE,
      customerGstin: r.customerGstin || "",
      reason: rec.reason || "Sales return",
      // GSTR-1 CDNR schema: "C" = credit note, "D" = debit note.
      noteType: "C",
      // GSTN reason codes — 01 Sales return is the canonical fit.
      reasonCode: "01",
      source: "pharmacy",
    });
  }

  // ── Supplements → debit notes ─────────────────────────────────────
  // Per the auditor's refinement, supplements live ONLY in
  // supplements[].addedItems[] — original items[] is NEVER mutated — so
  // pre-R7hr-12 the added taxable value was MISSING from GSTR-1 entirely
  // (not double-counted). Emit each supplement as a debit-note CDNR row.
  const supplementsAgg = await PharmacySale.aggregate([
    { $match: { "supplements.0": { $exists: true } } },
    { $unwind: "$supplements" },
    {
      $match: {
        "supplements.addedAt": { $gte: periodStart, $lt: periodEnd },
      },
    },
    {
      $project: {
        _id: 0,
        invoiceNumber: 1,
        saleId: "$_id",
        saleCreatedAt: "$createdAt",
        placeOfSupply: 1,
        customerGstin: 1,
        customerName: 1,
        supplementRecord: "$supplements",
      },
    },
  ]).option({ allowDiskUse: true, maxTimeMS: 30_000 });

  for (const r of supplementsAgg) {
    const rec = r.supplementRecord || {};
    const addedAt = rec.addedAt || rec.createdAt || new Date();
    const addedTaxable = toNum(rec.addedTaxable);
    const addedGst = toNum(rec.addedGst);
    const posRaw = (r.placeOfSupply && (r.placeOfSupply.state || r.placeOfSupply.stateCode || r.placeOfSupply))
      || HOSPITAL_STATE_CODE;
    let placeOfSupply;
    let intraState;
    try {
      const decision = isIntraStateSupply(
        HOSPITAL_STATE_CODE, posRaw,
        { invoiceRef: rec.supplementSlipNumber || r.invoiceNumber || String(r.saleId) },
      );
      intraState = decision.intraState;
      placeOfSupply = decision.pos;
    } catch (_e) {
      intraState = true;
      placeOfSupply = HOSPITAL_STATE_CODE;
    }
    let cgst = 0, sgst = 0, igst = 0;
    for (const it of (rec.addedItems || [])) {
      const gstAmt = toNum(it.gstAmount);
      const lineCgst = toNum(it.cgstAmount);
      const lineSgst = toNum(it.sgstAmount);
      const lineIgst = toNum(it.igstAmount);
      if (lineCgst + lineSgst + lineIgst > 0) {
        cgst += lineCgst;
        sgst += lineSgst;
        igst += lineIgst;
      } else if (intraState) {
        cgst += gstAmt / 2;
        sgst += gstAmt / 2;
      } else {
        igst += gstAmt;
      }
    }
    if (cgst + sgst + igst === 0 && addedGst > 0) {
      if (intraState) {
        cgst = addedGst / 2;
        sgst = addedGst / 2;
      } else {
        igst = addedGst;
      }
    }
    rows.push({
      creditNoteNumber: rec.supplementSlipNumber || `SUP-${r.saleId}-${rec._id || ""}`,
      creditNoteDate: new Date(addedAt).toISOString().slice(0, 10),
      originalInvoiceNumber: r.invoiceNumber || "",
      originalInvoiceDate: r.saleCreatedAt
        ? new Date(r.saleCreatedAt).toISOString().slice(0, 10)
        : "",
      taxableValue: Number(addedTaxable.toFixed(2)),
      cgstAmount: Number(cgst.toFixed(2)),
      sgstAmount: Number(sgst.toFixed(2)),
      igstAmount: Number(igst.toFixed(2)),
      cessAmount: 0,
      placeOfSupply: normalizeGstStateCode(placeOfSupply) || HOSPITAL_STATE_CODE,
      customerGstin: r.customerGstin || "",
      reason: rec.reason || "Supplementary invoice",
      noteType: "D",
      // 04 Correction in invoice is the canonical fit for a missed-item
      // debit note; accountant can refine in the next regen.
      reasonCode: "04",
      source: "pharmacy",
    });
  }

  return rows;
}

/**
 * Build the full GSTR-1 JSON for the given period.
 *
 * @param {string} period — YYYY-MM
 * @returns {Promise<object>} portal-shaped JSON + summary
 */
async function buildGSTR1JSON(period) {
  const { periodStart, periodEnd } = _parsePeriodToRange(period);

  // Start with an empty HSN map; both PatientBill + PharmacySale append into it
  const hsnMap = new Map();
  const hospital = await _bucketPatientBills(periodStart, periodEnd);
  // Pass the existing hsnMap reference so pharmacy can merge
  // (we created the bills hsnMap inside _bucketPatientBills — re-extract
  // it from there). To keep things simple, we re-key into a unified map.
  for (const h of hospital.hsn || []) {
    const key = `${h.hsnSac}-${h.rate}-${h.uqc}`;
    hsnMap.set(key, { ...h });
  }
  const pharmacy = await _bucketPharmacySales(periodStart, periodEnd, hsnMap);
  // R7hr-12 (D2-04): cdnr now combines hospital-bill CreditNotes with
  // pharmacy refunds (credit notes) AND pharmacy supplements (debit notes).
  // Pre-R7hr-12 the pharmacy stream was silently dropped from cdnr, so
  // every monthly GSTR-1 over-stated outward supply by the refund total
  // and under-stated by the supplement total.
  const hospitalCNs = await _bucketCreditNotes(periodStart, periodEnd);
  const pharmacyNotes = await _bucketPharmacyReturnsAndSupplements(periodStart, periodEnd);
  const cdnr = [...hospitalCNs, ...pharmacyNotes];

  // Merge buckets across sources
  const b2b = [...hospital.b2b, ...pharmacy.b2b];
  const b2cl = [...hospital.b2cl, ...pharmacy.b2cl];
  // b2c — merge on same placeOfSupply+rate key
  const b2cMap = new Map();
  for (const r of [...hospital.b2c, ...pharmacy.b2c]) {
    const k = `${r.placeOfSupply}-${r.rate}`;
    const cur = b2cMap.get(k);
    if (cur) {
      cur.taxableValue += r.taxableValue;
      cur.cgstAmount += r.cgstAmount;
      cur.sgstAmount += r.sgstAmount;
      cur.igstAmount += r.igstAmount;
      cur.invoiceCount += r.invoiceCount;
    } else {
      b2cMap.set(k, { ...r });
    }
  }
  const b2c = [...b2cMap.values()].map((r) => ({
    placeOfSupply: r.placeOfSupply,
    rate: r.rate,
    taxableValue: Number(r.taxableValue.toFixed(2)),
    cgstAmount: Number(r.cgstAmount.toFixed(2)),
    sgstAmount: Number(r.sgstAmount.toFixed(2)),
    igstAmount: Number(r.igstAmount.toFixed(2)),
    cessAmount: 0,
    invoiceCount: r.invoiceCount,
  }));

  const hsn = [...hsnMap.values()]
    .map((h) => ({
      hsnSac: h.hsnSac,
      uqc: h.uqc,
      totalQuantity: Number(h.totalQuantity.toFixed(2)),
      totalValue: Number(h.totalValue.toFixed(2)),
      taxableValue: Number(h.taxableValue.toFixed(2)),
      rate: h.rate,
      igstAmount: Number(h.igstAmount.toFixed(2)),
      cgstAmount: Number(h.cgstAmount.toFixed(2)),
      sgstAmount: Number(h.sgstAmount.toFixed(2)),
      cessAmount: 0,
    }))
    .sort((a, b) => a.hsnSac.localeCompare(b.hsnSac) || a.rate - b.rate);

  // Computed totals (across buckets) for fast review.
  // R7hr-12 (D2-04): also net cdnr — credit notes ("C") reduce outward
  // supply and debit notes ("D") increase it, so the summary reflects
  // the same number the portal will compute after reconcile.
  const sumKey = (k) =>
    b2b.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i[k] || 0), 0), 0) +
    b2cl.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i[k] || 0), 0), 0) +
    b2c.reduce((s, x) => s + (x[k] || 0), 0);
  const cdnrSign = (row) => (row.noteType === "D" ? 1 : -1);
  const cdnrSumKey = (k) =>
    cdnr.reduce((s, x) => s + cdnrSign(x) * (x[k] || 0), 0);

  const summary = _emptySummary();
  summary.totalCgst = Number((sumKey("cgstAmount") + cdnrSumKey("cgstAmount")).toFixed(2));
  summary.totalSgst = Number((sumKey("sgstAmount") + cdnrSumKey("sgstAmount")).toFixed(2));
  summary.totalIgst = Number((sumKey("igstAmount") + cdnrSumKey("igstAmount")).toFixed(2));
  summary.totalTaxable = Number(
    (
      b2b.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i.taxableValue || 0), 0), 0) +
      b2cl.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i.taxableValue || 0), 0), 0) +
      b2c.reduce((s, x) => s + (x.taxableValue || 0), 0) +
      cdnrSumKey("taxableValue")
    ).toFixed(2),
  );
  summary.hsnCount = hsn.length;
  summary.lineCount = b2b.length + b2cl.length + b2c.length + cdnr.length;

  return {
    // GSTN portal preamble
    gstin: HOSPITAL_GSTIN,
    fp: period.replace("-", ""), // GSTN expects "MMYYYY" — derived below
    filingPeriod: period,
    schemaVersion: "GSTR1-v2.1",
    generatedAt: new Date().toISOString(),
    // Sections
    b2b,
    b2cl,
    b2c,
    cdnr,
    hsn,
    nil: [], // no nil-rated rows in the HIS today — placeholder for future
    // Cross-period reconciliation hint
    summary,
  };
}

/**
 * Preview helper — alias for buildGSTR1JSON (the spec lists previewGSTR1
 * as the helper that returns JSON without persisting; persistence is the
 * controller's job).
 */
async function previewGSTR1(period) {
  return buildGSTR1JSON(period);
}

module.exports = {
  buildGSTR1JSON,
  previewGSTR1,
  _parsePeriodToRange, // exported for tests / controller validation
  // R7bm-F7 — exported for tests + reuse by other Tax/* exporters
  // (GSTR-3B does the same intra/inter decision; sharing the helper
  // keeps the two reports in lock-step).
  normalizeGstStateCode,
  isIntraStateSupply,
  // R7hr-12 (D2-04) — exported so gstr3bExporter.js can reuse the same
  // pharmacy CN/DN aggregation and keep the two reports in lock-step.
  _bucketPharmacyReturnsAndSupplements,
};
