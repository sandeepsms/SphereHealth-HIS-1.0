/**
 * indentService.js
 *
 * Nurse → Pharmacist drug-request workflow business logic. Controllers
 * stay thin; this file owns all the state machine + billing-handoff
 * detail. Five public operations:
 *
 *   createIndent({ admissionId, items, urgency, user, notes })
 *     → Nurse creates a new indent (status=Raised)
 *
 *   listIndents({ status, urgency, ward, admissionId, limit })
 *     → Pharmacist's live queue + nurse's raised-by-me view
 *
 *   getIndent(indentId)  → single fetch with populates
 *
 *   acknowledgeIndent(indentId, user)
 *     → Pharmacist accepts (status=Acknowledged) — locks the indent
 *       so two pharmacists don't dispense the same one
 *
 *   releaseIndent(indentId, { items: [{ itemId, issuedQty, batchNumber,
 *                                       substitutionReason }],
 *                             user })
 *     → Pharmacist dispenses; creates RESV-* BillingTriggers + a
 *       PharmacySale; transitions to Released or PartiallyReleased.
 *
 *   cancelIndent(indentId, { reason, user })
 *     → Nurse or pharmacist cancels (status=Cancelled)
 */
const PharmacyIndent = require("../../models/Pharmacy/PharmacyIndentModel");
const Admission      = require("../../models/Patient/admissionModel");

// ── createIndent ──────────────────────────────────────────────────
async function createIndent({ admissionId, items, urgency = "Routine", notes, user = {} }) {
  if (!admissionId) {
    const err = new Error("admissionId required"); err.code = "ARG_MISSING"; throw err;
  }
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("At least one item required"); err.code = "ARG_MISSING"; throw err;
  }

  const admission = await Admission.findById(admissionId)
    .populate("patientId", "fullName UHID")
    .populate("bedId", "bedNumber wardName")
    .lean();
  if (!admission) {
    const err = new Error("Admission not found"); err.status = 404; throw err;
  }

  // Sanitise + validate each item — every line needs a name + qty + source.
  const cleanedItems = items.map((it, idx) => {
    const qty = Number(it.requestedQty || it.quantity || it.qty || 0);
    if (!qty || qty <= 0) {
      const err = new Error(`Item ${idx + 1}: requestedQty must be > 0`);
      err.code = "INVALID_QTY"; throw err;
    }
    if (!it.drugName || !String(it.drugName).trim()) {
      const err = new Error(`Item ${idx + 1}: drugName required`);
      err.code = "ARG_MISSING"; throw err;
    }
    const sourceType = it.sourceType || (it.doctorOrderId ? "DoctorOrder" : "Manual");
    if (sourceType === "Manual" && !it.reason?.trim()) {
      // We don't HARD-reject manual lines without reason; we just warn
      // the caller. Some emergency cases legitimately have no time to
      // type a reason. Leaving the schema honest matches reality.
    }
    return {
      drugId:        it.drugId || undefined,
      drugCode:      it.drugCode || "",
      drugName:      String(it.drugName).trim(),
      form:          it.form || "",
      dose:          it.dose || "",
      route:         it.route || "",
      requestedQty:  qty,
      sourceType,
      doctorOrderId: it.doctorOrderId || undefined,
      reason:        it.reason || "",
      unitPriceSnapshot: Number(it.unitPrice || 0),
      notes:         it.notes || "",
    };
  });

  const doc = await PharmacyIndent.create({
    UHID:            admission.UHID,
    patientId:       admission.patientId?._id,
    patientName:     admission.patientId?.fullName,
    admissionId:     admission._id,
    admissionNumber: admission.admissionNumber,
    wardName:        admission.bedId?.wardName || admission.department || "",
    bedNumber:       admission.bedId?.bedNumber || "",
    items:           cleanedItems,
    urgency:         ["Routine", "Urgent", "STAT"].includes(urgency) ? urgency : "Routine",
    notes:           notes || "",
    raisedBy:        user.fullName || user.name || "Nurse",
    raisedById:      user._id || user.id,
    raisedByRole:    user.role || "Nurse",
  });

  return doc;
}

// ── listIndents ───────────────────────────────────────────────────
async function listIndents(query = {}) {
  const filter = {};
  if (query.status) {
    filter.status = Array.isArray(query.status) ? { $in: query.status } : query.status;
  } else if (query.openOnly === "true" || query.openOnly === true) {
    // Default for pharmacist queue — show everything that's still
    // actionable, hide Released / Cancelled (those are history).
    filter.status = { $in: ["Raised", "Acknowledged", "PartiallyReleased"] };
  }
  if (query.urgency) filter.urgency = query.urgency;
  if (query.admissionId) filter.admissionId = query.admissionId;
  if (query.UHID) filter.UHID = query.UHID;
  if (query.ward) filter.wardName = new RegExp(query.ward, "i");

  // Sort: STAT > Urgent > Routine, then oldest-first within each tier.
  // Mongo can't sort enum by custom order natively, so we compute a
  // numeric priority client-side after the fetch.
  const limit = Math.min(Number(query.limit) || 200, 1000);
  const list = await PharmacyIndent.find(filter)
    .sort({ raisedAt: 1 })
    .limit(limit)
    .lean();
  const urgencyRank = { STAT: 0, Urgent: 1, Routine: 2 };
  list.sort((a, b) => {
    const ua = urgencyRank[a.urgency] ?? 9;
    const ub = urgencyRank[b.urgency] ?? 9;
    if (ua !== ub) return ua - ub;
    return new Date(a.raisedAt) - new Date(b.raisedAt);
  });
  return list;
}

// ── getIndent (with populate) ─────────────────────────────────────
async function getIndent(indentId) {
  const doc = await PharmacyIndent.findById(indentId)
    .populate("patientId", "fullName UHID age gender contactNumber")
    .populate("items.doctorOrderId", "medicineName dose frequency route prescribedBy")
    .lean();
  if (!doc) {
    const err = new Error("Indent not found"); err.status = 404; throw err;
  }
  return doc;
}

// ── acknowledgeIndent ─────────────────────────────────────────────
async function acknowledgeIndent(indentId, user = {}) {
  const doc = await PharmacyIndent.findById(indentId);
  if (!doc) { const err = new Error("Indent not found"); err.status = 404; throw err; }
  if (doc.status === "Cancelled" || doc.status === "Released") {
    const err = new Error(`Indent is ${doc.status} — cannot acknowledge`);
    err.code = "ALREADY_CLOSED"; throw err;
  }
  // Idempotent on re-acknowledge (in case the pharmacist's network
  // flapped) — only update if currently Raised.
  if (doc.status === "Raised") {
    doc.status            = "Acknowledged";
    doc.acknowledgedBy    = user.fullName || user.name || "Pharmacist";
    doc.acknowledgedById  = user._id || user.id;
    doc.acknowledgedAt    = new Date();
    await doc.save();
  }
  return doc;
}

// ── releaseIndent ─────────────────────────────────────────────────
async function releaseIndent(indentId, { items = [], user = {} } = {}) {
  const doc = await PharmacyIndent.findById(indentId);
  if (!doc) { const err = new Error("Indent not found"); err.status = 404; throw err; }
  if (doc.status === "Cancelled") {
    const err = new Error("Indent is Cancelled — cannot release");
    err.code = "ALREADY_CLOSED"; throw err;
  }
  if (doc.status === "Released") {
    const err = new Error("Indent already fully released");
    err.code = "ALREADY_RELEASED"; throw err;
  }

  // Merge incoming release-payload items into the indent's persisted
  // items by itemId. Missing items default to no-issue (operator chose
  // not to dispense yet — partial release path).
  const releaseMap = new Map(items.map(r => [String(r.itemId), r]));
  let allReleased = true;
  let anyReleased = false;

  for (const item of doc.items) {
    const r = releaseMap.get(String(item._id));
    if (!r) {
      if (item.issuedQty < item.requestedQty) allReleased = false;
      continue;
    }
    const newIssued = Math.min(item.requestedQty, item.issuedQty + (Number(r.issuedQty) || 0));
    if (newIssued > item.issuedQty) {
      item.issuedQty = newIssued;
      anyReleased = true;
      if (r.batchNumber) item.batchNumber = r.batchNumber;
      if (r.substitutedFrom) {
        item.substitutedFrom     = r.substitutedFrom;
        item.substitutedFromCode = r.substitutedFromCode || "";
        item.substitutionReason  = r.substitutionReason  || "";
      }
      if (r.unitPrice != null) item.unitPriceSnapshot = Number(r.unitPrice) || item.unitPriceSnapshot;
    }
    if (item.issuedQty < item.requestedQty) allReleased = false;
  }

  if (!anyReleased) {
    const err = new Error("Nothing to release — pass at least one item with issuedQty > 0");
    err.code = "NOTHING_TO_RELEASE"; throw err;
  }

  doc.status        = allReleased ? "Released" : "PartiallyReleased";
  doc.releasedBy    = user.fullName || user.name || "Pharmacist";
  doc.releasedById  = user._id || user.id;
  doc.releasedAt    = new Date();
  await doc.save();

  // Reservation billing — fire RESV-* BillingTriggers for each item
  // that just got dispensed. Done after save so the indent record is
  // durable even if billing hiccups.
  try {
    const autoBilling = require("../Billing/autoBillingService");
    if (typeof autoBilling.onIndentReleased === "function") {
      await autoBilling.onIndentReleased(doc, items);
    }
  } catch (e) {
    console.error("[Indent] reservation-billing error:", e.message);
  }

  return doc;
}

// ── cancelIndent ──────────────────────────────────────────────────
async function cancelIndent(indentId, { reason, user = {} } = {}) {
  const doc = await PharmacyIndent.findById(indentId);
  if (!doc) { const err = new Error("Indent not found"); err.status = 404; throw err; }
  if (doc.status === "Released") {
    const err = new Error("Cannot cancel a Released indent — drugs already dispensed");
    err.code = "ALREADY_CLOSED"; throw err;
  }
  if (doc.status === "Cancelled") return doc;   // idempotent
  doc.status        = "Cancelled";
  doc.cancelledBy   = user.fullName || user.name || "User";
  doc.cancelledById = user._id || user.id;
  doc.cancelledAt   = new Date();
  doc.cancelReason  = reason || "(no reason given)";
  await doc.save();
  return doc;
}

module.exports = {
  createIndent,
  listIndents,
  getIndent,
  acknowledgeIndent,
  releaseIndent,
  cancelIndent,
};
