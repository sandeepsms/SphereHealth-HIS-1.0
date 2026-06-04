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
const DrugBatch      = require("../../models/Pharmacy/DrugBatchModel");
const Patient        = require("../../models/Patient/patientModel");
const { istStartOfToday } = require("../../utils/queryGuards");
const retryVersionError   = require("../../utils/retryVersionError");
const { assertDrugSafeOrOverride } = require("../../utils/allergyCheck");

// ── R7az-CRIT-1 (D7-CRIT-1): allergy gate helper ─────────────────
// Fetch patient allergies once per indent call (avoid N+1) and run the
// gate over every drug line. Honours per-line `_allergyOverrideReason`
// (passed through from the UI / API) so a senior clinician can knowingly
// dispense against a known allergy with a documented reason.
async function _runAllergyGate(uhid, items, label) {
  if (!uhid || !Array.isArray(items) || items.length === 0) return;
  // Read the patient with virtuals — `allergies` virtual unifies the
  // legacy knownAllergies string and the typed allergyList[].
  const pat = await Patient.findOne({ UHID: uhid }).select("knownAllergies allergyList").lean({ virtuals: true });
  if (!pat) return; // walk-in or orphan UHID — fall through (no patient to gate against)
  const allergyPool = pat.allergies || pat.allergyList || pat.knownAllergies || [];
  for (const it of items) {
    assertDrugSafeOrOverride(
      { drugName: it.drugName, genericName: it.genericName, brandName: it.brandName },
      allergyPool,
      { overrideReason: it._allergyOverrideReason, label },
    );
  }
}

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

  // R7az-CRIT-1 (D7-CRIT-1): allergy gate runs BEFORE any persistence so
  // a collision throws 409 and the indent never lands in Mongo. Pre-R7az
  // only the Prescription model had a gate — Manual indent lines (no
  // prescription) sailed past every check.
  await _runAllergyGate(admission.UHID, items, "indent-create");

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
// R7bh-F4 / R7bg-1-CRIT-4: atomic CAS on the status transition.
// Pre-R7bh this was a load-then-modify-then-save sequence — two
// pharmacists clicking "Acknowledge" concurrently would both pass the
// `doc.status === "Raised"` check and both try to set themselves as the
// acknowledger. The findOneAndUpdate predicate below guarantees only one
// wins. If the predicate misses (already acked / cancelled / released)
// we fall back to a read so the caller gets a deterministic 409 with the
// current status surfaced in the message.
async function acknowledgeIndent(indentId, user = {}) {
  const updated = await PharmacyIndent.findOneAndUpdate(
    { _id: indentId, status: "Raised" },
    {
      $set: {
        status:           "Acknowledged",
        acknowledgedBy:   user.fullName || user.name || "Pharmacist",
        acknowledgedById: user._id || user.id || null,
        acknowledgedAt:   new Date(),
      },
    },
    { new: true, runValidators: true },
  );
  if (updated) return updated;
  // Predicate missed — read current state to give a useful error.
  const cur = await PharmacyIndent.findById(indentId).lean();
  if (!cur) { const err = new Error("Indent not found"); err.status = 404; throw err; }
  if (cur.status === "Acknowledged") {
    // Idempotent — already acked (possibly by us on a network-flapped retry).
    return cur;
  }
  const err = new Error(`Indent is ${cur.status} — cannot acknowledge`);
  err.code = "ALREADY_ACKED";
  err.status = 409;
  throw err;
}

// ── R7az-CRIT-5/D7-CRIT-3: FEFO atomic stock decrement ────────────
// For a given drug + qty, walk earliest-expiry batches first and
// atomically decrement `remaining`. Returns the list of picks for
// audit ([{batchId, batchNo, qty, expiryDate}]). Rolls back its own
// reservations if it can't satisfy the demand. Rejects expired batches
// at pick time (the GRN endpoint rejects on receipt but a previously-
// receivable batch may have expired between receipt and release).
//
// Strategy mirrors the pharmacy counter's fifoConsume in
// controllers/Pharmacy/pharmacyController.js so FEFO behaviour is
// identical across both dispense paths. Re-queries each pass to see
// live `remaining` after concurrent races.
// R7hr-2: optional drugName param so the INSUFFICIENT_STOCK message
// shows the human-readable name ("Salbutamol Inhaler") instead of the
// raw ObjectId. Resolves lazily at the throw site if the caller didn't
// pass one, so existing callers stay correct.
async function _fefoPickAndDecrement(drugId, qty, drugName = "") {
  if (!drugId) {
    const err = new Error("drugId required for FEFO pick");
    err.code = "ARG_MISSING"; throw err;
  }
  const need0 = Number(qty);
  if (!Number.isFinite(need0) || need0 <= 0) {
    const err = new Error("qty must be > 0 for FEFO pick");
    err.code = "INVALID_QTY"; throw err;
  }

  let need = need0;
  const used = [];
  const triedBatchIds = new Set();
  const MAX_PASSES = 32;

  for (let pass = 0; pass < MAX_PASSES && need > 0; pass++) {
    // Earliest-expiry first (FEFO). Block expired batches.
    const where = {
      drugId,
      isActive: true,
      remaining: { $gt: 0 },
      expiryDate: { $gte: istStartOfToday() },
    };
    if (triedBatchIds.size > 0) where._id = { $nin: [...triedBatchIds] };

    const batches = await DrugBatch.find(where).sort({ expiryDate: 1 }).limit(8).lean();
    if (batches.length === 0) break;

    let madeProgress = false;
    for (const b of batches) {
      if (need <= 0) break;
      const take = Math.min(b.remaining, need);
      const updated = await DrugBatch.findOneAndUpdate(
        { _id: b._id, isActive: true, remaining: { $gte: take } },
        { $inc: { quantityOut: take, remaining: -take } },
        { new: true },
      );
      if (!updated) {
        triedBatchIds.add(String(b._id));
        continue;
      }
      used.push({
        batchId:    updated._id,
        batchNo:    updated.batchNo,
        qty:        take,
        expiryDate: updated.expiryDate,
      });
      need -= take;
      madeProgress = true;
    }
    if (!madeProgress) break;
  }

  if (need > 0) {
    // Insufficient stock — roll back any reservations we did make so
    // batch counts stay accurate, then throw 409 with a hint of which
    // batches were tried (for the pharmacist's queue debugging).
    for (const u of used) {
      await DrugBatch.findByIdAndUpdate(u.batchId, {
        $inc: { quantityOut: -u.qty, remaining: u.qty },
      }).catch(() => { /* best-effort rollback */ });
    }
    // R7hr-2: prefer human-readable drug name in the message. Lazy
    // lookup when the caller didn't pass one (release/dispense path).
    let label = drugName;
    if (!label) {
      try {
        const Drug = require("../../models/Pharmacy/DrugModel");
        const d = await Drug.findById(drugId).select("name brandName").lean();
        label = d ? (d.brandName ? `${d.name} (${d.brandName})` : d.name) : `drug ${drugId}`;
      } catch { label = `drug ${drugId}`; }
    }
    const err = new Error(
      `${label} is out of stock — short by ${need} unit(s).` +
      (triedBatchIds.size > 0
        ? ` (${triedBatchIds.size} expired/locked batch${triedBatchIds.size === 1 ? "" : "es"} skipped.)`
        : " No usable batch found — raise a GRN or type a manual batch + price to override."),
    );
    err.code = "INSUFFICIENT_STOCK";
    err.status = 409;
    err.shortBy = need;
    err.drugName = label;
    err.triedBatchIds = [...triedBatchIds];
    throw err;
  }

  return used;
}

// ── releaseIndent ─────────────────────────────────────────────────
async function releaseIndent(indentId, { items = [], user = {}, adminOverride = false } = {}) {
  // R7az-HIGH-5/D6-HIGH-5: ack ownership + state preflight (cheap reads
  // outside the retry loop). We re-verify inside the retry loop too in
  // case status changes mid-flight.
  const preflight = await PharmacyIndent.findById(indentId).lean();
  if (!preflight) { const err = new Error("Indent not found"); err.status = 404; throw err; }
  if (preflight.status === "Cancelled") {
    const err = new Error("Indent is Cancelled — cannot release");
    err.code = "ALREADY_CLOSED"; throw err;
  }
  if (preflight.status === "Released") {
    const err = new Error("Indent already fully released");
    err.code = "ALREADY_RELEASED"; throw err;
  }
  if (preflight.status === "Raised") {
    // Must acknowledge before release so the live queue can show
    // "Pharmacist X is working on it" and so the ack ownership check
    // below has something to lock against.
    const err = new Error("Indent must be Acknowledged before release");
    err.code = "NOT_ACKNOWLEDGED"; err.status = 409; throw err;
  }
  // R7az-HIGH-5/D6-HIGH-5: only the acknowledging pharmacist can
  // release (unless Admin override). Stops a second pharmacist
  // shoulder-surfing the same indent and double-dispensing the same
  // patient's drugs while the first is still picking them.
  const ackId       = preflight.acknowledgedById && String(preflight.acknowledgedById);
  const releaserId  = String(user._id || user.id || "");
  if (ackId && releaserId && ackId !== releaserId && !adminOverride && user.role !== "Admin") {
    const err = new Error(
      `Acknowledged by ${preflight.acknowledgedBy || "another pharmacist"} — only they (or an Admin) can release.`,
    );
    err.code   = "ACK_OWNERSHIP_MISMATCH";
    err.status = 409;
    throw err;
  }

  // R7az-CRIT-1 (D7-CRIT-1): re-run the allergy gate at release. The
  // pre-create gate at indent time may have passed because the allergy
  // was added between then and now — release is the last chance before
  // the drug physically leaves the pharmacy.
  await _runAllergyGate(
    preflight.UHID,
    preflight.items.filter((it) => {
      const r = items.find((x) => String(x.itemId) === String(it._id));
      return r && Number(r.issuedQty) > 0;
    }),
    "indent-release",
  );

  // R7az-CRIT-5/D7-CRIT-3: FEFO pick + atomic decrement, OUTSIDE the
  // version-retry loop. Stock movements are themselves atomic via
  // findOneAndUpdate predicates; doing them outside the loop avoids
  // double-decrementing on a VersionError retry.
  //
  // R7bh-F4 / R7bg-9-HIGH-1: parallelise the per-item FEFO pick. Pre-R7bh
  // each item awaited sequentially — a 10-item indent ran 10 round-trips
  // serially. Promise.all collapses to one round-trip per item in parallel.
  // Each iteration touches a distinct (drugId, batches) namespace AND the
  // findOneAndUpdate inside _fefoPickAndDecrement is itself atomic, so no
  // shared mutable accumulator races between iterations.
  const releaseMap = new Map(items.map((r) => [String(r.itemId), r]));
  const allPicks = new Map(); // itemId → [{batchId, batchNo, qty, expiryDate}]
  // Track everything we decrement so we can roll back on overall failure.
  const allReservations = [];

  // Build the per-item task list first (synchronous validation), then
  // fire FEFO in parallel.
  const fefoTasks = []; // [{ itemId, drugId, qty }]
  for (const item of preflight.items) {
    const r = releaseMap.get(String(item._id));
    if (!r) continue;
    const issueNow = Number(r.issuedQty) || 0;
    if (issueNow <= 0) continue;
    const remainingRequested = Math.max(0, item.requestedQty - item.issuedQty);
    const issuedClamped = Math.min(issueNow, remainingRequested);
    if (issuedClamped <= 0) continue;

    // No drugId on the item → legacy/manual entry without a Drug
    // master. Skip FEFO + record only the legacy batchNumber the
    // pharmacist typed. Audit trail loses a batchId in this case
    // but the workflow still progresses.
    if (!item.drugId) {
      allPicks.set(String(item._id), []);
      continue;
    }
    fefoTasks.push({ itemId: String(item._id), drugId: item.drugId, qty: issuedClamped, drugName: item.drugName });
  }

  // Use Promise.allSettled so even if one task rejects, the others'
  // successful reservations are still tracked and rolled back. With
  // plain Promise.all we'd lose track of in-flight successes when one
  // task threw — stock would silently leak.
  // R7hr-2: pass drugName so the INSUFFICIENT_STOCK error shows the
  // human-readable name instead of an ObjectId.
  const settled = await Promise.allSettled(
    fefoTasks.map((t) => _fefoPickAndDecrement(t.drugId, t.qty, t.drugName)
      .then((picks) => ({ itemId: t.itemId, picks }))),
  );
  const firstReject = settled.find((s) => s.status === "rejected");
  // Collect reservations from successful tasks (regardless of whether
  // any task failed) so we can roll back if needed.
  for (const s of settled) {
    if (s.status === "fulfilled") {
      allPicks.set(s.value.itemId, s.value.picks);
      for (const p of s.value.picks) allReservations.push(p);
    }
  }
  if (firstReject) {
    // Roll back every reservation that succeeded before we surface the
    // failure — release is all-or-nothing.
    for (const p of allReservations) {
      await DrugBatch.findByIdAndUpdate(p.batchId, {
        $inc: { quantityOut: -p.qty, remaining: p.qty },
      }).catch(() => { /* best-effort */ });
    }
    throw firstReject.reason;
  }

  // R7az-HIGH-4/D6-HIGH-4: wrap the mutate-save block in a
  // VersionError retry loop so concurrent ack/release/cancel races
  // don't 500 the pharmacist's queue. The stock decrement above is
  // outside this loop because it's already atomic.
  let savedDoc;
  try {
    savedDoc = await retryVersionError(async () => {
      const doc = await PharmacyIndent.findById(indentId);
      if (!doc) { const err = new Error("Indent not found"); err.status = 404; throw err; }
      if (doc.status === "Cancelled" || doc.status === "Released") {
        // Status changed under us — roll back stock and bail.
        const err = new Error(`Indent is ${doc.status} — cannot release`);
        err.code = doc.status === "Released" ? "ALREADY_RELEASED" : "ALREADY_CLOSED";
        throw err;
      }

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
          // Persist substitution + price snapshots
          if (r.substitutedFrom) {
            item.substitutedFrom     = r.substitutedFrom;
            item.substitutedFromCode = r.substitutedFromCode || "";
            item.substitutionReason  = r.substitutionReason  || "";
          }
          if (r.unitPrice != null) item.unitPriceSnapshot = Number(r.unitPrice) || item.unitPriceSnapshot;

          // R7az-CRIT-5/D7-CRIT-3 + MED-6: stamp FEFO picks + typed
          // batchId mirror (first pick is the canonical "primary" batch
          // for display; full picks[] is the audit trail).
          const picks = allPicks.get(String(item._id)) || [];
          if (picks.length > 0) {
            item.picked = (item.picked || []).concat(picks.map((p) => ({
              batchId:    p.batchId,
              batchNo:    p.batchNo,
              qty:        p.qty,
              expiryDate: p.expiryDate,
              pickedAt:   new Date(),
            })));
            item.batchId     = picks[0].batchId;
            item.batchNumber = picks.map((p) => p.batchNo).filter(Boolean).join(",");
          } else if (r.batchNumber) {
            // Legacy / manual fallback — pharmacist typed a batchNumber
            // for an item without a drugId master. Keep it as a string
            // mirror so the receipt still prints something.
            item.batchNumber = r.batchNumber;
          }
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
      return doc;
    }, { label: "releaseIndent" });
  } catch (saveErr) {
    // Save failed for a non-retryable reason — roll back the FEFO
    // decrements so stock counts don't drift away from truth.
    for (const p of allReservations) {
      await DrugBatch.findByIdAndUpdate(p.batchId, {
        $inc: { quantityOut: -p.qty, remaining: p.qty },
      }).catch(() => { /* best-effort */ });
    }
    throw saveErr;
  }

  // Reservation billing — fire RESV-* BillingTriggers for each item
  // that just got dispensed. Done after save so the indent record is
  // durable even if billing hiccups.
  //
  // R7bh-F4 / R7bg-5-HIGH-1: pending-review fallback. Pre-R7bh a failure
  // here logged silently and the indent moved on Released — the
  // pharmacist's drugs were gone but no charge ever materialised on the
  // patient's bill (revenue leak). Now we emit a pending-review row on
  // BillingTrigger so the IPD Live Ledger's Stuck Triggers panel surfaces
  // the gap and the operator can retry/clear it.
  try {
    const autoBilling = require("../Billing/autoBillingService");
    if (typeof autoBilling.onIndentReleased === "function") {
      await autoBilling.onIndentReleased(savedDoc, items);
    }
  } catch (e) {
    console.error("[Indent] reservation-billing error:", e.message);
    try {
      const BillingTrigger = require("../../models/Billing/BillingTrigger");
      await BillingTrigger.create({
        admissionId: savedDoc.admissionId,
        patientId:   savedDoc.patientId,
        UHID:        savedDoc.UHID,
        patientType: "IPD",
        serviceName: `Indent ${savedDoc.indentNumber || savedDoc._id} — reservation-billing failed`,
        quantity:    1,
        sourceType:  "MAR_RESERVATION",
        sourceDocumentId:    savedDoc._id,
        sourceDocumentModel: "PharmacyIndent",
        orderedBy:    savedDoc.releasedBy || "Pharmacist",
        orderedById:  savedDoc.releasedById || null,
        orderedByRole:"Pharmacist",
        triggeredBy:  "indent-release",
        triggeredByRole: "System",
        status:       "pending-review",
        reviewReason: `indent-release-trigger-emit-failed: ${e.message}`,
        orderDetails: `Indent ${savedDoc._id} released — autoBilling.onIndentReleased threw. Operator must reconcile manually.`,
      });
    } catch (logErr) {
      console.error("[Indent] could not log pending-review trigger:", logErr.message);
    }
  }

  return savedDoc;
}

// ── cancelIndent ──────────────────────────────────────────────────
//
// R7bf-I / A7-CRIT-7 — A Released or PartiallyReleased indent has
// already moved stock out of the pharmacy AND fired (or partially
// fired) the BillingTrigger pipeline. Cancelling at that point creates
// an inventory ghost (stock gone, bill never raised) and a billing
// hole (trigger marked done, but the canceller doesn't know to refund).
// The correct downstream flow is a return-indent / void-sale, not a
// cancel. Pre-R7bf only `Released` was guarded.
async function cancelIndent(indentId, { reason, user = {} } = {}) {
  const doc = await PharmacyIndent.findById(indentId);
  if (!doc) { const err = new Error("Indent not found"); err.status = 404; throw err; }
  if (doc.status === "Cancelled") return doc;   // idempotent
  if (doc.status === "Released" || doc.status === "PartiallyReleased") {
    const err = new Error(
      `Cannot cancel a ${doc.status} indent — drugs already dispensed. ` +
      `Use the returnIndent / void-sale flow to reverse stock + billing instead.`,
    );
    err.code = "ALREADY_CLOSED";
    err.status = 409;
    err.statusCode = 409;
    throw err;
  }
  doc.status        = "Cancelled";
  doc.cancelledBy   = user.fullName || user.name || "User";
  doc.cancelledById = user._id || user.id;
  doc.cancelledAt   = new Date();
  doc.cancelReason  = reason || "(no reason given)";
  await doc.save();   // pre-save state-machine guard will double-check the transition
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
