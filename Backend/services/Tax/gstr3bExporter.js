/**
 * services/Tax/gstr3bExporter.js  (R7bh-F6 / R7bg CRIT-A1 / GST §39)
 *
 * Build the GSTR-3B portal JSON for a given YYYY-MM period. GSTR-3B is
 * the monthly summary return — far simpler than GSTR-1's invoice-level
 * detail. It only needs:
 *
 *   3.1   Outward + RCM inward (taxable + tax)
 *   3.2   Inter-state supplies (POS-wise to unregistered + composition + UIN)
 *   4     ITC details (eligible / ineligible)  — left as 0 today; hospital
 *         currently doesn't track procurement-side ITC in HIS
 *   5     Exempt / nil-rated / non-GST inward
 *   6.1   Net tax payable
 *
 * Pulls the aggregated numbers from gstService.aggregateGSTForMonth so
 * the hospital + pharmacy total is consistent with GSTR-1 and the
 * frozen monthly snapshot.
 */
"use strict";

const gstService = require("../Reports/gstService");
const CreditNote = require("../../models/Billing/CreditNote");
const { toNum } = require("../../utils/money");
// R7hr-12 (D2-04): the underlying aggregateGSTForMonth (gstService) now
// nets pharmacy refunds and supplements directly into its grossTotals via
// $unionWith streams keyed on returns.refundedAt / supplements.addedAt.
// We therefore do NOT subtract them again here — only the hospital
// CreditNote stream (PatientBill refunds) is missing from gstService's
// merge and still needs an explicit subtraction below. The end result
// keeps GSTR-3B section 3.1 in lock-step with GSTR-1 cdnr + b2c/b2b/b2cl.
// (No direct import of _bucketPharmacyReturnsAndSupplements is needed
// — the netting happens inside aggregateGSTForMonth.)

const HOSPITAL_GSTIN = process.env.HOSPITAL_GSTIN || "";
const HOSPITAL_STATE_CODE = process.env.HOSPITAL_STATE_CODE || "29";

function _parsePeriodToRange(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error(`Invalid period '${period}' — expected YYYY-MM`);
  }
  const [yyyy, mm] = period.split("-").map(Number);
  const nextY = mm === 12 ? yyyy + 1 : yyyy;
  const nextM = mm === 12 ? 1 : mm + 1;
  return {
    periodStart: new Date(`${yyyy}-${String(mm).padStart(2, "0")}-01T00:00:00+05:30`),
    periodEnd: new Date(`${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00+05:30`),
  };
}

/**
 * Build the GSTR-3B JSON. The shape mirrors GSTN's GSTR-3B v1 schema.
 */
async function buildGSTR3BJSON(period) {
  const { periodStart, periodEnd } = _parsePeriodToRange(period);

  const agg = await gstService.aggregateGSTForMonth(periodStart, periodEnd);
  const gross = agg.grossTotals || {};
  const taxableValue = toNum(gross.taxableValue);
  const cgstOut = toNum(gross.cgst);
  const sgstOut = toNum(gross.sgst);
  const igstOut = toNum(gross.igst);

  // Credit notes within period — subtract from outward.
  const cnAgg = await CreditNote.aggregate([
    { $match: { creditNoteDate: { $gte: periodStart, $lt: periodEnd } } },
    {
      $group: {
        _id: null,
        taxableValue: { $sum: "$taxableValue" },
        cgst: { $sum: "$cgstAmount" },
        sgst: { $sum: "$sgstAmount" },
        igst: { $sum: "$igstAmount" },
      },
    },
  ]);
  const cn = cnAgg[0] || { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
  const cnTaxable = toNum(cn.taxableValue);
  const cnCgst = toNum(cn.cgst);
  const cnSgst = toNum(cn.sgst);
  const cnIgst = toNum(cn.igst);

  // R7hr-12 (D2-04): pharmacy refunds (credit notes) and supplements
  // (debit notes) used to be silently dropped from GSTR-3B because they
  // live as embedded sub-docs on PharmacySale (returns[] / supplements[])
  // and never reach the CreditNote collection. The fix lives upstream
  // in gstService.aggregateGSTForMonth — that pipeline now $unionWith's
  // PharmacySale.returns (negative-signed) and PharmacySale.supplements
  // (positive-signed) so `grossTotals.taxableValue/cgst/sgst/igst` above
  // ALREADY net them. The only remaining subtraction here is the
  // hospital-bill CreditNote stream (which gstService doesn't touch).
  const netTaxable = Number((taxableValue - cnTaxable).toFixed(2));
  const netCgst    = Number((cgstOut      - cnCgst   ).toFixed(2));
  const netSgst    = Number((sgstOut      - cnSgst   ).toFixed(2));
  const netIgst    = Number((igstOut      - cnIgst   ).toFixed(2));

  const json = {
    gstin: HOSPITAL_GSTIN,
    fp: period.replace("-", ""),
    filingPeriod: period,
    schemaVersion: "GSTR3B-v1",
    generatedAt: new Date().toISOString(),

    // 3.1 — outward supplies + reverse charge (RCM) — RCM is 0 for HIS
    section_3_1: {
      outwardTaxable: {
        taxableValue: netTaxable,
        igst: netIgst,
        cgst: netCgst,
        sgst: netSgst,
        cess: 0,
      },
      outwardZeroRated: { taxableValue: 0, igst: 0, cess: 0 },
      outwardNilRated: { taxableValue: 0 },
      inwardReverseCharge: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 },
      nonGSTOutward: { taxableValue: 0 },
    },

    // 3.2 — inter-state supplies to unregistered persons (POS-wise)
    // Pulled from inter-state slice; HIS aggregator gives us totals only
    // so this is a placeholder.
    section_3_2: {
      supplyToUnregistered: [],
      supplyToComposition: [],
      supplyToUIN: [],
    },

    // 4 — ITC — placeholder; not tracked in HIS
    section_4: {
      itcAvailable: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      itcReversed: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      netItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      ineligibleItc: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
    },

    // 5 — exempt / nil-rated / non-GST inward
    section_5: {
      exemptInward: { interState: 0, intraState: 0 },
      nonGSTInward: { interState: 0, intraState: 0 },
    },

    // 6.1 — tax payable
    section_6_1: {
      taxPayable: {
        igst: netIgst,
        cgst: netCgst,
        sgst: netSgst,
        cess: 0,
      },
      taxPaidThruITC: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      taxPaidInCash: {
        igst: netIgst,
        cgst: netCgst,
        sgst: netSgst,
        cess: 0,
      },
      interest: 0,
      lateFee: 0,
    },

    summary: {
      totalTaxable: netTaxable,
      totalCgst: netCgst,
      totalSgst: netSgst,
      totalIgst: netIgst,
      hsnCount: (agg.byHsn || []).length,
      lineCount: 0,
    },
  };

  return json;
}

async function previewGSTR3B(period) {
  return buildGSTR3BJSON(period);
}

module.exports = { buildGSTR3BJSON, previewGSTR3B };
