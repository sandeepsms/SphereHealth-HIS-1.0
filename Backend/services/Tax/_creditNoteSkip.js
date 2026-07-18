/**
 * services/Tax/_creditNoteSkip.js — R9-FIX(R9-031)
 *
 * Shared "open-period cancel-CN" skip logic for BOTH GST exporters (GSTR-1
 * CDNR + GSTR-3B outward-reversal). Extracted so the two returns can never
 * drift again (R8-FIX(#2) originally landed on GSTR-1 only → GSTR-3B kept
 * double-reversing a cancelled invoice, so the two disagreed for the month).
 *
 * A CANCELLED numbered bill is already reversed by EXCLUSION from outward
 * supply (both exporters drop billStatus CANCELLED). Its cancel-time credit
 * note (reasonCode "07") would then reverse the SAME tax a second time. We
 * drop such cancel-CNs when the original bill's GST period is still OPEN
 * (the exclusion is the single, complete reversal); we KEEP them once the
 * period is LOCKED/filed (a frozen outward can only be reversed via a
 * current-month CDNR). Refund/write-off CNs (bill NOT cancelled) are never dropped.
 *
 * @param cns  array of lean CreditNote docs (need _id, reasonCode, billId)
 * @returns Set<string> of CreditNote._id (stringified) to EXCLUDE
 */
async function openPeriodCancelCnSkipSet(cns) {
  const skip = new Set();
  const cancelCnBillIds = (cns || [])
    .filter((c) => String(c.reasonCode) === "07" && c.billId)
    .map((c) => c.billId);
  if (!cancelCnBillIds.length) return skip;

  const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
  const GstMonthlySnapshot = require("../../models/Billing/GstMonthlySnapshot");
  const cancelledBills = await PatientBill.find({
    _id: { $in: cancelCnBillIds }, billStatus: "CANCELLED",
  }).select("_id billGeneratedAt billDate createdAt").lean();
  const byId = new Map(cancelledBills.map((b) => [String(b._id), b]));
  const TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
  const lockByPeriod = new Map();

  for (const c of cns) {
    if (String(c.reasonCode) !== "07" || !c.billId) continue;
    const b = byId.get(String(c.billId));
    if (!b) continue; // original bill not CANCELLED → genuine refund/writeoff CN, keep
    const d = b.billGeneratedAt || b.billDate || b.createdAt;
    if (!d) continue;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit",
    }).formatToParts(new Date(d));
    const period = `${parts.find((x) => x.type === "year")?.value}-${parts.find((x) => x.type === "month")?.value}`;
    let locked = lockByPeriod.get(period);
    if (locked === undefined) {
      const snap = await GstMonthlySnapshot.findOne({ period, lockedAt: { $ne: null } }).select("_id").lean();
      locked = !!snap;
      lockByPeriod.set(period, locked);
    }
    if (!locked) skip.add(String(c._id)); // open period → drop the double reversal
  }
  return skip;
}

module.exports = { openPeriodCancelCnSkipSet };
