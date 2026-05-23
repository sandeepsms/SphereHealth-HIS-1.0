/**
 * services/Tax/form16aGenerator.js  (R7bh-F6 / R7bg CRIT-A2 / IT §194J)
 *
 * Quarterly TDS certificate (Form 16A) generator.
 *
 * Pre-R7bh the HIS recorded TDS deduction per payment row but had no
 * aggregation into the quarterly Form 16A artefact that the hospital is
 * statutorily required to issue to each deductee (TPA / corporate party).
 *
 * Workflow:
 *   1. Caller asks for { quarter, financialYear } → service aggregates
 *      every PatientBill.payments row where:
 *        - paymentMode === "TPA_CLAIM"
 *        - tdsAmount > 0
 *        - paidAt falls inside the quarter's IST date range
 *      …grouped by the bill's tpaParty (looked up via Tpa model + the
 *      bill's `tpaName`).
 *   2. For each tpa-party group, build a TdsCertificate snapshot row
 *      with paymentRows + totalAmountPaid + totalTdsDeducted.
 *
 * The generator returns a "preview" array of candidate certificates;
 * the controller decides which ones to persist.
 */
"use strict";

const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const Tpa = require("../../models/tpa/tpaModel");
const TdsCertificate = require("../../models/Tax/TdsCertificateModel");
const { nextSequence, formatId } = require("../../utils/counter");
const { toNum } = require("../../utils/money");

// Map a quarter label to its IST date range. Indian financial year runs
// April–March; Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar.
function _quarterRange(quarter, financialYear) {
  if (!/^Q[1-4]$/.test(quarter)) throw new Error(`Invalid quarter '${quarter}'`);
  if (!/^\d{4}-\d{2}$/.test(financialYear)) {
    throw new Error(`Invalid financialYear '${financialYear}' — expected "2026-27"`);
  }
  const [yyyy] = financialYear.split("-").map(Number);
  let startMonth, startYear, endMonth, endYear;
  if (quarter === "Q1") {
    startYear = yyyy;
    startMonth = 4;
    endYear = yyyy;
    endMonth = 7; // exclusive
  } else if (quarter === "Q2") {
    startYear = yyyy;
    startMonth = 7;
    endYear = yyyy;
    endMonth = 10;
  } else if (quarter === "Q3") {
    startYear = yyyy;
    startMonth = 10;
    endYear = yyyy + 1;
    endMonth = 1;
  } else {
    startYear = yyyy + 1;
    startMonth = 1;
    endYear = yyyy + 1;
    endMonth = 4;
  }
  const start = new Date(
    `${startYear}-${String(startMonth).padStart(2, "0")}-01T00:00:00+05:30`,
  );
  const end = new Date(
    `${endYear}-${String(endMonth).padStart(2, "0")}-01T00:00:00+05:30`,
  );
  return { start, end };
}

/**
 * Build candidate Form 16A certificates for the given quarter.
 *
 * @returns {Promise<Array>} array of { tpaParty, paymentRows, totalAmountPaid, totalTdsDeducted }
 */
async function previewForm16A(quarter, financialYear) {
  const { start, end } = _quarterRange(quarter, financialYear);

  // Find all bills with TPA_CLAIM payments + tdsAmount > 0 in window.
  const bills = await PatientBill.find({
    "payments.paidAt": { $gte: start, $lt: end },
    "payments.paymentMode": "TPA_CLAIM",
    "payments.tdsAmount": { $exists: true },
  })
    .select("billNumber tpaName tpa payments")
    .populate({ path: "tpa", model: "TPA" })
    .lean();

  // Aggregate per TPA party.
  const byParty = new Map();
  for (const b of bills) {
    for (const p of b.payments || []) {
      if (p.paymentMode !== "TPA_CLAIM") continue;
      if (p.voidedAt) continue; // skip voided rows
      const tds = toNum(p.tdsAmount);
      if (!(tds > 0)) continue;
      const paidAt = p.paidAt ? new Date(p.paidAt) : null;
      if (!paidAt || paidAt < start || paidAt >= end) continue;

      // Key by tpa._id when available, else by lower-cased tpaName.
      const partyKey =
        (b.tpa && b.tpa._id ? String(b.tpa._id) : null) ||
        (b.tpaName || "UNKNOWN").trim().toLowerCase();

      const entry = byParty.get(partyKey) || {
        tpaParty: {
          name: b.tpa?.tpaName || b.tpaName || "Unknown TPA",
          address: b.tpa?.address || "",
          pan: b.tpa?.pan || "",
          gstin: b.tpa?.gstin || "",
        },
        paymentRows: [],
        totalAmountPaid: 0,
        totalTdsDeducted: 0,
      };
      entry.paymentRows.push({
        date: paidAt,
        paymentRef: p.transactionId || String(p._id || ""),
        billNumber: b.billNumber || "",
        amount: toNum(p.amount),
        tds,
      });
      entry.totalAmountPaid += toNum(p.amount);
      entry.totalTdsDeducted += tds;
      byParty.set(partyKey, entry);
    }
  }
  return [...byParty.values()];
}

/**
 * Persist a single Form 16A certificate. Returns the created doc.
 */
async function persistForm16A(payload, actor = {}) {
  const { tpaParty, paymentRows, totalAmountPaid, totalTdsDeducted, quarter, financialYear } =
    payload || {};
  if (!tpaParty || !tpaParty.name) throw new Error("tpaParty.name is required");
  if (!Array.isArray(paymentRows)) throw new Error("paymentRows must be an array");
  if (!/^Q[1-4]$/.test(quarter)) throw new Error("quarter must be Q1..Q4");

  // Idempotency — refuse duplicate for the same (FY, Quarter, party name).
  const dup = await TdsCertificate.findOne({
    financialYear,
    quarter,
    "tpaParty.name": tpaParty.name,
  });
  if (dup) {
    const e = new Error(
      `Form 16A already exists for ${financialYear} ${quarter} ${tpaParty.name}`,
    );
    e.code = "ALREADY_EXISTS";
    e.status = 409;
    throw e;
  }

  // Auto-generate certificate number.
  const [yy] = financialYear.split("-");
  const seq = await nextSequence(`form16a:${yy}`);
  const certificateNumber = formatId(`F16A-${yy}`, seq, 6);

  const doc = await TdsCertificate.create({
    certificateNumber,
    quarter,
    financialYear,
    tpaParty,
    totalAmountPaid,
    totalTdsDeducted,
    paymentRows,
    generatedAt: new Date(),
    generatedBy: actor._id || null,
    generatedByName: actor.fullName || "",
    status: "DRAFT",
    hospitalId: actor.hospitalId || null,
  });
  return doc;
}

module.exports = { previewForm16A, persistForm16A, _quarterRange };
