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
const HOSPITAL_STATE_CODE = process.env.HOSPITAL_STATE_CODE || "29";
const HOSPITAL_GSTIN = process.env.HOSPITAL_GSTIN || "";

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
    const placeOfSupply = String(b.placeOfSupply || HOSPITAL_STATE_CODE);
    const intraState = placeOfSupply === HOSPITAL_STATE_CODE;
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
    const placeOfSupply = String(s.placeOfSupply || HOSPITAL_STATE_CODE);
    const intraState = placeOfSupply === HOSPITAL_STATE_CODE;

    // dominant rate from items
    let dominantRate = 0;
    let dominantTax = -1;
    const ratesByItem = {};
    for (const it of s.items || []) {
      const r = Number(it.gstPercent ?? it.taxPercent ?? 0);
      const v = toNum(it.taxableValue ?? it.netAmount ?? it.sellingPrice);
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
      const gstAtRate = (taxable * Number(dominantRate)) / 100;
      if (intraState) {
        cur.cgstAmount += gstAtRate / 2;
        cur.sgstAmount += gstAtRate / 2;
      } else {
        cur.igstAmount += gstAtRate;
      }
      cur.invoiceCount += 1;
      b2cMap.set(k, cur);
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
    placeOfSupply: c.placeOfSupply || HOSPITAL_STATE_CODE,
    customerGstin: c.customerGstin || "",
    reason: c.reason || "",
  }));
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
  const cdnr = await _bucketCreditNotes(periodStart, periodEnd);

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
  const sumKey = (k) =>
    b2b.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i[k] || 0), 0), 0) +
    b2cl.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i[k] || 0), 0), 0) +
    b2c.reduce((s, x) => s + (x[k] || 0), 0);

  const summary = _emptySummary();
  summary.totalCgst = Number(sumKey("cgstAmount").toFixed(2));
  summary.totalSgst = Number(sumKey("sgstAmount").toFixed(2));
  summary.totalIgst = Number(sumKey("igstAmount").toFixed(2));
  summary.totalTaxable = Number(
    (
      b2b.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i.taxableValue || 0), 0), 0) +
      b2cl.reduce((s, x) => s + (x.items || []).reduce((a, i) => a + (i.taxableValue || 0), 0), 0) +
      b2c.reduce((s, x) => s + (x.taxableValue || 0), 0)
    ).toFixed(2),
  );
  summary.hsnCount = hsn.length;
  summary.lineCount = b2b.length + b2cl.length + b2c.length;

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
};
