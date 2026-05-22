// services/Pharmacy/kitchenIndentService.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 — KitchenIndent close-loop service (R7bi-1-CRIT-13,
// R7bi-DK-CRIT-1/2/3, R7bi-KI-CRIT-2).
//
// Pre-R7bj there was no controller flipping PENDING→PREPARED→SERVED,
// every served meal was free (no BillingTrigger), and there was no
// Ward Boy delivery handover. This service is the single source of
// truth for those transitions. Every transition is an atomic
// findOneAndUpdate with the current-status precondition — so two
// kitchen clicks racing each other can never both win, and a 409
// surfaces to the second click. Each terminal transition stamps
// retainUntil at +90d so the TTL monitor reclaims the row.
//
// The SERVED transition also emits a per-meal BillingTrigger (the
// "DIET_MEAL" semantic) so the cashier's IPD ledger picks up the
// meal cost — closing R7bi-DK-CRIT-1 (kitchen never billed). Until
// F5 extends BillingTrigger.orderedByRole to include "Kitchen", we
// emit with role:"System" + free-text orderedBy:"Kitchen" + a notes
// trail so the role-coord update is purely additive.
// ════════════════════════════════════════════════════════════════════

"use strict";

const mongoose = require("mongoose");
const KitchenIndent  = require("../../models/Pharmacy/KitchenIndentModel");
const BillingTrigger = require("../../models/Billing/BillingTrigger");
const { toDec, toNum } = require("../../utils/money");

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;       // 90 days
const DIET_SERVICE_CODE = "IPD-SUP-003";              // "Meal Tray / Diet"

function _err(message, status, code) {
  const e = new Error(message);
  e.status = status; e.code = code;
  return e;
}

function _isValidId(id) {
  return id && mongoose.isValidObjectId(String(id));
}

function _actor(a = {}) {
  return {
    _id:      a._id || a.id || null,
    fullName: a.fullName || a.name || "",
    role:     a.role || "",
  };
}

// ── BillingTrigger emit helper ──────────────────────────────────────
// R7bi-DK-CRIT-1: every SERVED meal must emit a per-meal trigger so
// the patient is billed for the tray. orderedByRole/triggeredByRole
// are restricted enums on BillingTrigger; "Kitchen" / "Ward Boy" are
// not in the enum today (F5 to extend). We emit with "System" + put
// the canonical role string in the free-text orderedBy/triggeredBy
// fields and the notes payload so the cashier's audit still shows
// "Kitchen" as the emit origin.
async function _emitMealTrigger(indent, actor) {
  if (!indent || !indent.admissionId) return null;
  const unitPrice   = toNum(indent.unitPrice);
  const totalAmount = toNum(indent.totalAmount) || unitPrice;
  // dateKey on the indent is already IST-anchored at push time —
  // reuse it for the trigger dedup so two kitchens marking served
  // on the same indent on the same calendar day can't double-bill.
  const dateKey = indent.dateKey || new Date(indent.scheduledFor || Date.now())
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const a = _actor(actor);

  // R7bi-DK-CRIT-2: don't emit when admission is no longer Active —
  // pushing meals to a discharged admission and then billing them
  // would corrupt the closed bill. Soft-skip + console.warn.
  try {
    const Admission = require("../../models/Patient/admissionModel");
    const adm = await Admission.findById(indent.admissionId).select("status").lean();
    if (adm && adm.status !== "Active") {
      console.warn(`[kitchenIndent] _emitMealTrigger skipped — admission ${indent.admissionId} status=${adm.status}`);
      return null;
    }
  } catch (_) { /* non-fatal, fall through */ }

  try {
    const trig = await BillingTrigger.create({
      admissionId:  indent.admissionId,
      UHID:         indent.UHID,
      patientType:  "IPD",
      serviceCode:  DIET_SERVICE_CODE,
      serviceName:  `Diet Meal — ${indent.mealSlotLabel || indent.mealSlot}`,
      quantity:     1,
      unitPrice:    toDec(unitPrice),
      totalAmount:  toDec(totalAmount),
      originalUnitPrice: unitPrice,
      originalQuantity:  1,
      // R7bj-F2: BillingTrigger.sourceType enum currently lacks
      // "KitchenIndent" / "DIET_MEAL" (F5-coord task to add). Use
      // "AutoCharge" for now + carry the canonical kind in
      // sourceDocumentModel + notes so the audit still reads cleanly
      // and F5's enum migration is purely additive.
      sourceType:          "AutoCharge",
      sourceDocumentId:    indent._id,
      sourceDocumentModel: "KitchenIndent",
      orderedBy:    a.fullName || "Kitchen",
      orderedById:  a._id,
      // "Kitchen" / "Ward Boy" not in orderedByRole enum yet (F5 to
      // extend). Fall back to "System" + put canonical role in
      // notes/orderedBy/triggeredBy so attribution is preserved.
      orderedByRole:   "System",
      triggeredBy:     a.fullName || "Kitchen",
      triggeredById:   a._id,
      triggeredByRole: "System",
      status:       "pending",
      dateKey,
      autoCharged:  false,
      isDailyCharge: false,
      department:   "Dietetics",
      notes:        `DIET_MEAL kind — kitchen-served meal. Slot=${indent.mealSlot}; ActorRole=${a.role || "Kitchen"}; IndentId=${indent._id}`,
    });
    // R7bj-F2 — back-ref so the kitchen UI can flag "already billed"
    // and a void can walk back to the indent row.
    indent.billingTriggerId = trig._id;
    return trig;
  } catch (e) {
    console.error(`[kitchenIndent] _emitMealTrigger failed for indent ${indent._id}:`, e.message);
    return null;
  }
}

// ── Mark PREPARED ───────────────────────────────────────────────────
async function markPrepared(id, actor) {
  if (!_isValidId(id)) throw _err("Invalid indent id", 400, "INVALID_ID");
  const a = _actor(actor);
  const updated = await KitchenIndent.findOneAndUpdate(
    { _id: id, status: "PENDING" },
    {
      $set: {
        status:          "PREPARED",
        preparedById:    a._id,
        preparedByName:  a.fullName,
        preparedByRole:  a.role,
        preparedAt:      new Date(),
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await KitchenIndent.findById(id).lean();
    if (!existing) throw _err("Kitchen indent not found", 404, "NOT_FOUND");
    throw _err(
      `Cannot mark prepared — indent is currently ${existing.status}, expected PENDING`,
      409,
      "ILLEGAL_TRANSITION",
    );
  }
  return updated;
}

// ── Mark SERVED (emits BillingTrigger) ──────────────────────────────
async function markServed(id, actor) {
  if (!_isValidId(id)) throw _err("Invalid indent id", 400, "INVALID_ID");
  const a = _actor(actor);
  const now = new Date();
  const retainUntil = new Date(now.getTime() + RETENTION_MS);
  const updated = await KitchenIndent.findOneAndUpdate(
    { _id: id, status: "PREPARED" },
    {
      $set: {
        status:        "SERVED",
        servedById:    a._id,
        servedByName:  a.fullName,
        servedByRole:  a.role,
        servedAt:      now,
        retainUntil,
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await KitchenIndent.findById(id).lean();
    if (!existing) throw _err("Kitchen indent not found", 404, "NOT_FOUND");
    throw _err(
      `Cannot mark served — indent is currently ${existing.status}, expected PREPARED`,
      409,
      "ILLEGAL_TRANSITION",
    );
  }
  // R7bi-DK-CRIT-1 — fire the per-meal BillingTrigger. We deliberately
  // emit AFTER the SERVED flip is committed so a trigger failure can't
  // strand the kitchen UI in PREPARED.
  if (!updated.billingTriggerId) {
    await _emitMealTrigger(updated, a);
    if (updated.billingTriggerId) await updated.save();
  }
  return updated;
}

// ── Mark DELIVERED (Ward Boy / Nurse handover at the bed) ───────────
async function markDelivered(id, actor) {
  if (!_isValidId(id)) throw _err("Invalid indent id", 400, "INVALID_ID");
  const a = _actor(actor);
  // R7bj-F2: if the caller's role is "Ward Boy" we enforce that the
  // trio is captured exactly as "Ward Boy" (NABH chain-of-custody
  // expects the specific handover role on the row, not the umbrella
  // role of whoever fulfilled it). Other allowed roles fall back to
  // their own role string; the route-level permission gate
  // (kitchen.delivery.write) is the broader authorisation.
  const now = new Date();
  const retainUntil = new Date(now.getTime() + RETENTION_MS);
  const updated = await KitchenIndent.findOneAndUpdate(
    { _id: id, status: "SERVED" },
    {
      $set: {
        status:           "DELIVERED",
        deliveredById:    a._id,
        deliveredByName:  a.fullName,
        deliveredByRole:  a.role,
        deliveredAt:      now,
        retainUntil,
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await KitchenIndent.findById(id).lean();
    if (!existing) throw _err("Kitchen indent not found", 404, "NOT_FOUND");
    throw _err(
      `Cannot mark delivered — indent is currently ${existing.status}, expected SERVED`,
      409,
      "ILLEGAL_TRANSITION",
    );
  }
  return updated;
}

// ── Cancel (only PENDING / PREPARED can cancel) ─────────────────────
async function cancelIndent(id, actor, reason = "") {
  if (!_isValidId(id)) throw _err("Invalid indent id", 400, "INVALID_ID");
  const a = _actor(actor);
  const now = new Date();
  const retainUntil = new Date(now.getTime() + RETENTION_MS);
  const updated = await KitchenIndent.findOneAndUpdate(
    { _id: id, status: { $in: ["PENDING", "PREPARED"] } },
    {
      $set: {
        status:          "CANCELLED",
        cancelledAt:     now,
        cancelledById:   a._id,
        cancelledByName: a.fullName,
        cancelReason:    String(reason || "").slice(0, 500),
        retainUntil,
      },
    },
    { new: true },
  );
  if (!updated) {
    const existing = await KitchenIndent.findById(id).lean();
    if (!existing) throw _err("Kitchen indent not found", 404, "NOT_FOUND");
    throw _err(
      `Cannot cancel — indent is currently ${existing.status} (only PENDING / PREPARED can cancel)`,
      409,
      "ILLEGAL_TRANSITION",
    );
  }
  // Soft audit hook — wardOpsModels / activityLogger picks up the
  // mutation via the middleware, no extra row required here.
  return updated;
}

// ── Kitchen worklist (today's indents) ──────────────────────────────
async function listForKitchen({ date, status, mealSlot, limit = 200 } = {}) {
  const q = {};
  if (status)   q.status   = String(status).toUpperCase();
  if (mealSlot) q.mealSlot = String(mealSlot).toUpperCase();
  // R7bj-F2: kitchen worklist is "today" by default — the cook does
  // not need to scroll yesterday's served trays. Caller can override
  // with `?date=YYYY-MM-DD` for a back-fill view.
  let from, to;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    from = new Date(`${date}T00:00:00+05:30`);
    to   = new Date(from.getTime() + 86400000);
  } else {
    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    from = new Date(`${todayKey}T00:00:00+05:30`);
    to   = new Date(from.getTime() + 86400000);
  }
  q.scheduledFor = { $gte: from, $lt: to };

  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  return KitchenIndent.find(q)
    .sort({ scheduledFor: 1, mealSlot: 1 })
    .limit(cap)
    .lean();
}

// ── Ward Boy delivery queue (SERVED, not yet DELIVERED) ─────────────
async function listForWardBoy({ wardId, limit = 200 } = {}) {
  const q = { status: "SERVED" };
  if (wardId) q.ward = String(wardId);    // ward name match (denormalised on indent)
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  return KitchenIndent.find(q)
    .sort({ servedAt: 1 })
    .limit(cap)
    .lean();
}

async function getById(id) {
  if (!_isValidId(id)) return null;
  return KitchenIndent.findById(id).lean();
}

module.exports = {
  markPrepared,
  markServed,
  markDelivered,
  cancelIndent,
  listForKitchen,
  listForWardBoy,
  getById,
  // Exposed for testability — not for general controller use.
  _emitMealTrigger,
};
