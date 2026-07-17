/**
 * scheduleXRegister.js  (R7bd-E-1 / A2-MED-16)
 *
 * Business logic for the statutory Schedule-X register. Three public ops:
 *
 *   recordDispense({drugId, batchId, qty, rx, doctorName, uhid,
 *                   witnessName, witnessId, dispensedBy, dispensedById})
 *     → append a DISPENSE row with two-person witness enforcement.
 *
 *   dailyBalance(date)
 *     → returns opening + received + dispensed + closing per
 *       Schedule-X drug for the given calendar day (IST).
 *
 *   verifyBalance(date, { verifierId, verifierName })
 *     → pharmacist locks the daily entry — emits a VERIFY row per drug
 *       and stamps balanceVerified* on every row of that day.
 *
 * All rows are persisted into ScheduleXEntryModel which is schema-level
 * append-only (see model header).
 *
 * NDPS audit hardening:
 *   • Refuses dispense if witness == dispenser.
 *   • Refuses dispense if drug is not Schedule X.
 *   • Refuses dispense if qty <= 0 or batch not found.
 *   • Refuses verify if any dispense in the day already verified.
 */
const ScheduleXEntry   = require("../../models/Pharmacy/ScheduleXEntryModel");
const ScheduleXBalance = require("../../models/Pharmacy/ScheduleXBalanceModel");
const Drug             = require("../../models/Pharmacy/DrugModel");
const DrugBatch        = require("../../models/Pharmacy/DrugBatchModel");

const { istStartOfToday } = require("../../utils/queryGuards");

// Convert any Date to IST midnight of that calendar day. dailyBalance + verify
// query on "the day" — we anchor every per-day operation here.
function _istMidnight(d) {
  // Reuse the existing IST midnight helper if d is "today" — otherwise
  // compute via the same trick (en-CA formatter gives a YYYY-MM-DD that
  // can be parsed as IST midnight with the +05:30 suffix).
  if (!d) return istStartOfToday();
  const TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
  const istParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(d));
  const y = istParts.find((p) => p.type === "year")?.value;
  const m = istParts.find((p) => p.type === "month")?.value;
  const day = istParts.find((p) => p.type === "day")?.value;
  return new Date(`${y}-${m}-${day}T00:00:00+05:30`);
}

// ── recordDispense ───────────────────────────────────────────────
async function recordDispense({
  drugId,
  batchId,
  qty,
  rx = "",
  doctorName = "",
  uhid = "",
  witnessName = "",
  witnessId = null,
  dispensedBy = "",
  dispensedById = null,
  remarks = "",
} = {}) {
  if (!drugId) {
    const e = new Error("drugId required"); e.code = "ARG_MISSING"; throw e;
  }
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    const e = new Error("qty must be > 0"); e.code = "INVALID_QTY"; throw e;
  }
  if (!witnessName || !witnessId) {
    const e = new Error("witnessName and witnessId required for Schedule-X dispense (NDPS two-person rule)");
    e.code = "WITNESS_REQUIRED"; e.status = 400; throw e;
  }
  if (!dispensedById) {
    const e = new Error("dispensedById required"); e.code = "ARG_MISSING"; throw e;
  }
  if (String(witnessId) === String(dispensedById)) {
    const e = new Error("Witness must be a different person from the dispenser (NDPS two-person rule)");
    e.code = "WITNESS_SELF"; e.status = 409; throw e;
  }

  const drug = await Drug.findById(drugId).lean();
  if (!drug) { const e = new Error("Drug not found"); e.status = 404; throw e; }
  if (drug.schedule !== "X") {
    const e = new Error(`Drug "${drug.name}" is Schedule "${drug.schedule || '—'}" — not Schedule X`);
    e.code = "NOT_SCHEDULE_X"; e.status = 409; throw e;
  }

  let batch = null;
  if (batchId) {
    batch = await DrugBatch.findById(batchId).lean();
    if (!batch) { const e = new Error("Batch not found"); e.status = 404; throw e; }
  }

  const today = _istMidnight(new Date());
  // Refuse if the day has already been verified — append after verify is
  // a back-date attempt which would invalidate the signed daily total.
  // R9-FIX(R9-041): verify is per-DRUG per-DAY (verifyBalance writes one VERIFY
  // row per drug with NO batchId). The old check matched on batchId, so a
  // batch-based dispense never found the batch-less VERIFY row and post-verify
  // narcotic dispenses slipped through the day-lock. Match drug + day only.
  const verified = await ScheduleXEntry.findOne({
    drugId, date: today, rowType: "VERIFY",
  }).lean();
  if (verified) {
    const e = new Error(`Day ${today.toISOString().slice(0,10)} already verified — cannot append new dispense`);
    e.code = "DAY_LOCKED"; e.status = 409; throw e;
  }

  // ── R7bh-F4 / R7bg-10-CRIT-2: TOCTOU-safe atomic CAS decrement.
  // Previously the balance was computed by reading every prior row +
  // subtracting today's dispenses — two concurrent dispensers both seeing
  // "balance = 10, requesting 7" would both insert and leave the register
  // at -4 (illegal under NDPS). The ScheduleXBalance.findOneAndUpdate
  // below is atomic at the Mongo level: only one writer wins the
  // predicate `balance >= n`, the other gets null → 409.
  const balanceDoc = await ScheduleXBalance.findOneAndUpdate(
    { drugId, balance: { $gte: n } },
    {
      $inc: { balance: -n },
      $set: {
        lastUpdatedBy:   dispensedBy || "",
        lastUpdatedById: dispensedById || null,
        lastUpdatedAt:   new Date(),
      },
    },
    { new: true },
  );
  if (!balanceDoc) {
    // Read current balance for a helpful error (best-effort; not critical).
    const current = await ScheduleXBalance.findOne({ drugId }).lean();
    const have = current ? Number(current.balance || 0) : 0;
    const e = new Error(
      `Insufficient Schedule-X balance for ${drug.name} — register shows ${have}, dispense requested ${n}`,
    );
    e.code = "INSUFFICIENT_REGISTER_BALANCE"; e.status = 409; throw e;
  }

  // For row metadata we still report opening = balanceBefore (= balance + n
  // because we just deducted) and closing = balance (post-deduction). This
  // keeps the printed register row internally consistent without a re-read.
  const closing = Number(balanceDoc.balance || 0);
  const opening = closing + n;

  try {
    const row = await ScheduleXEntry.create({
      date: today,
      drugId, drugName: drug.name,
      batchId: batchId || undefined,
      batchNo: batch?.batchNo || "",
      openingBalance: opening,
      received: 0,
      dispensed: n,
      closingBalance: closing,
      prescriptionRef: rx || "",
      doctorName,
      patientUHID: uhid || "",
      dispensedBy, dispensedById,
      witnessName, witnessId,
      rowType: "DISPENSE",
      remarks,
    });
    return row.toObject();
  } catch (createErr) {
    // Compensation: restore the balance if the entry-row create failed
    // (validation error, network blip, etc.). Best-effort — log and re-throw.
    try {
      await ScheduleXBalance.findOneAndUpdate(
        { drugId },
        { $inc: { balance: n } },
      );
    } catch (compErr) {
      console.error(
        "[ScheduleX] compensation restore failed for drugId",
        String(drugId), "qty", n, ":", compErr.message,
      );
    }
    throw createErr;
  }
}

// ── recordReceipt ────────────────────────────────────────────────
// Called when Schedule-X stock comes IN (GRN of a Schedule-X drug).
// Atomic upsert that bumps the running balance.
async function recordReceipt({ drugId, qty, receivedBy = "", receivedById = null } = {}) {
  if (!drugId) {
    const e = new Error("drugId required"); e.code = "ARG_MISSING"; throw e;
  }
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    const e = new Error("qty must be > 0"); e.code = "INVALID_QTY"; throw e;
  }
  const updated = await ScheduleXBalance.findOneAndUpdate(
    { drugId },
    {
      $inc: { balance: n },
      $set: {
        lastUpdatedBy:   receivedBy,
        lastUpdatedById: receivedById,
        lastUpdatedAt:   new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return updated.toObject();
}

// ── recordReversal ───────────────────────────────────────────────
// Adjust the running Schedule-X balance by a SIGNED delta. Used by the
// reversal paths that move controlled stock back through the register:
//   • sale return / cancel → +qty  (narcotic came back into the cabinet)
//   • vendor return         → -qty  (narcotic left to the supplier)
//
// A decrement (delta < 0) is gated on `balance >= |delta|`, re-checked at
// write time, so a concurrent dispense that crossed the threshold makes us
// fail gracefully (null) rather than driving the register negative — which
// is illegal under NDPS. An increment does NOT upsert: with no existing
// balance doc there was never a receipt/dispense behind this drug, and
// minting one here would fabricate controlled-substance stock. Absent /
// under-balance doc → returns null so the caller can log the anomaly.
//
// This is the balance-only sibling of recordDispense/recordReceipt; it does
// NOT append a ScheduleXEntry row — the caller owns the paper trail (returns
// and cancels already ride their PHARMACY_RETURNED / cancel audit rows, and
// vendor returns their PharmacyVendorReturn + audit emit).
async function recordReversal({ drugId, signedQty, actorName = "", actorById = null } = {}) {
  if (!drugId) {
    const e = new Error("drugId required"); e.code = "ARG_MISSING"; throw e;
  }
  const delta = Number(signedQty);
  if (!Number.isFinite(delta) || delta === 0) {
    const e = new Error("signedQty must be a non-zero number"); e.code = "INVALID_QTY"; throw e;
  }
  const filter = { drugId };
  if (delta < 0) filter.balance = { $gte: -delta };
  const updated = await ScheduleXBalance.findOneAndUpdate(
    filter,
    {
      $inc: { balance: delta },
      $set: {
        lastUpdatedBy:   actorName || "",
        lastUpdatedById: actorById || null,
        lastUpdatedAt:   new Date(),
      },
    },
    { new: true }, // no upsert — never mint a balance doc on a reversal
  );
  return updated ? updated.toObject() : null;
}

// ── dailyBalance ─────────────────────────────────────────────────
// Returns one summary object per Schedule-X drug for the given day:
// { drugId, drugName, opening, received, dispensed, closing, rows[] }
async function dailyBalance(date) {
  const day = _istMidnight(date);
  const next = new Date(day.getTime() + 86400000);

  // Pull every Schedule-X row whose `date` field equals the IST midnight
  // (the recordDispense path stamps it that way), plus any prior row for
  // these drugs whose `closingBalance` we need for "opening".
  const todayRows = await ScheduleXEntry.find({ date: { $gte: day, $lt: next } })
    .sort({ createdAt: 1 }).lean();

  // Group by drugId.
  const byDrug = new Map();
  for (const r of todayRows) {
    const key = String(r.drugId);
    if (!byDrug.has(key)) {
      byDrug.set(key, {
        drugId: r.drugId, drugName: r.drugName,
        opening: 0, received: 0, dispensed: 0, closing: 0,
        rows: [], verified: false, verifiedBy: "", verifiedAt: null,
      });
    }
    const g = byDrug.get(key);
    g.received  += r.received  || 0;
    g.dispensed += r.dispensed || 0;
    g.rows.push(r);
    if (r.rowType === "VERIFY") {
      g.verified   = true;
      g.verifiedBy = r.balanceVerifiedBy || "";
      g.verifiedAt = r.balanceVerifiedAt || null;
    }
  }

  // Backfill opening from the most-recent prior row per drug. For drugs
  // with no activity today this also surfaces a row showing today's
  // opening = yesterday's closing (so the register UI can show a flat
  // line for inactive drugs).
  const allDrugIds = new Set(byDrug.keys());
  // Also include drugs with priors today none of which were OPENING.
  for (const r of todayRows) allDrugIds.add(String(r.drugId));
  for (const drugId of allDrugIds) {
    const last = await ScheduleXEntry.findOne({
      drugId, createdAt: { $lt: day },
    }).sort({ createdAt: -1 }).lean();
    const opening = Number(last?.closingBalance || 0);
    const g = byDrug.get(drugId);
    if (g) {
      g.opening = opening;
      g.closing = opening + g.received - g.dispensed;
    }
  }

  return [...byDrug.values()];
}

// ── verifyBalance ────────────────────────────────────────────────
async function verifyBalance(date, { verifierId, verifierName } = {}) {
  if (!verifierId) {
    const e = new Error("verifierId required"); e.code = "ARG_MISSING"; throw e;
  }
  const day = _istMidnight(date);
  const next = new Date(day.getTime() + 86400000);

  const todayRows = await ScheduleXEntry.find({ date: { $gte: day, $lt: next } });
  if (todayRows.length === 0) {
    const e = new Error(`No Schedule-X activity on ${day.toISOString().slice(0,10)} — nothing to verify`);
    e.code = "NO_ACTIVITY"; e.status = 404; throw e;
  }
  const already = todayRows.find((r) => r.rowType === "VERIFY");
  if (already) {
    const e = new Error(`Day ${day.toISOString().slice(0,10)} already verified`);
    e.code = "ALREADY_VERIFIED"; e.status = 409; throw e;
  }

  const summary = await dailyBalance(day);
  const stampedAt = new Date();
  // Append one VERIFY row per drug carrying the verifier's identity and
  // the day's closing balance. The pre-save guard on the model allows the
  // verify columns to be set on newly created rows.
  const verifyRows = [];
  for (const s of summary) {
    const v = await ScheduleXEntry.create({
      date: day,
      drugId: s.drugId, drugName: s.drugName,
      openingBalance: s.opening,
      received:       s.received,
      dispensed:      s.dispensed,
      closingBalance: s.closing,
      rowType: "VERIFY",
      balanceVerifiedBy:   verifierName || "Pharmacist",
      balanceVerifiedById: verifierId,
      balanceVerifiedAt:   stampedAt,
      remarks: `Daily balance verified by ${verifierName || verifierId}`,
    });
    verifyRows.push(v.toObject());
  }
  return { day, verifyRows, summary };
}

module.exports = {
  recordDispense,
  recordReceipt,
  recordReversal,
  dailyBalance,
  verifyBalance,
};
