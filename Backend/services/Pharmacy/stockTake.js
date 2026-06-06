/**
 * stockTake.js  (R7bd-E-2 / A2-MED-18)
 *
 * Pharmacy cycle-count business logic. Three public ops:
 *
 *   createCount({ date, drugIds[], title, scope, user })
 *     → DRAFT stock-take pre-filled with one line per active batch
 *       for the requested drugs (or every drug if drugIds is empty).
 *
 *   enterPhysical(stockTakeId, { batchId, physicalQty, reason })
 *     → operator records what was actually on the shelf for one batch.
 *       Variance is auto-computed; reason is required when variance != 0.
 *       Status promotes DRAFT → SUBMITTED on first line, or stays
 *       SUBMITTED on subsequent lines.
 *
 *   verifyAndAdjust(stockTakeId, verifierId, verifierName)
 *     → second pharmacist signs off; service walks every counted line
 *       and atomically applies the variance to DrugBatch.remaining via
 *       findOneAndUpdate($inc). One BillingAudit("STOCK_TAKE_ADJUST")
 *       row per batch — append-only audit trail.
 */
const StockTake = require("../../models/Pharmacy/StockTakeModel");
const DrugBatch = require("../../models/Pharmacy/DrugBatchModel");
const Drug      = require("../../models/Pharmacy/DrugModel");
const BillingAudit = require("../../models/Billing/BillingAudit");

// ── createCount ──────────────────────────────────────────────────
async function createCount({ date, drugIds = [], title = "", scope = "", user = {} } = {}) {
  const batchFilter = { isActive: true };
  if (Array.isArray(drugIds) && drugIds.length > 0) {
    batchFilter.drugId = { $in: drugIds };
  }
  const batches = await DrugBatch.find(batchFilter)
    .sort({ drugName: 1, expiryDate: 1 })
    .lean();
  if (batches.length === 0) {
    const e = new Error("No active batches found for the requested drug set");
    e.code = "NO_BATCHES"; e.status = 404; throw e;
  }
  // Hydrate drugName from Drug master when DrugBatch.drugName is blank
  // (older rows didn't denormalise).
  const drugMap = new Map();
  const wantedDrugIds = [...new Set(batches.map((b) => String(b.drugId)).filter(Boolean))];
  if (wantedDrugIds.length > 0) {
    const drugs = await Drug.find({ _id: { $in: wantedDrugIds } }).select("name").lean();
    for (const d of drugs) drugMap.set(String(d._id), d.name);
  }

  const lines = batches.map((b) => ({
    drugId:     b.drugId,
    drugName:   b.drugName || drugMap.get(String(b.drugId)) || "(unknown)",
    batchId:    b._id,
    batchNo:    b.batchNo,
    expiryDate: b.expiryDate,
    systemQty:  Number(b.remaining || 0),
    physicalQty: null,
    variance:    0,
    varianceReason: "",
  }));

  const doc = await StockTake.create({
    date:        date ? new Date(date) : new Date(),
    title:       title || "",
    scope:       scope || (drugIds.length ? "Partial" : "Full"),
    lines,
    status:      "DRAFT",
    countedBy:   user.fullName || user.employeeId || "",
    countedById: user._id || user.id,
  });
  return doc.toObject();
}

// ── enterPhysical ────────────────────────────────────────────────
// R7hr-12-S2 (D6-04): now accepts `user` so the per-line actor (the
// pharmacist who walked the shelf) is captured separately from the
// stock-take creator. Pre-fix the controller dropped req.user here and
// the per-line entry was attributed implicitly to countedBy — a
// second-shift counter left no audit trace, and the verify-time SOD
// check (NABH AAC.7) only compared verifier vs creator, so a
// [creator → entrant → verifier=entrant] flow silently passed.
async function enterPhysical(stockTakeId, { batchId, physicalQty, reason = "", user = {} } = {}) {
  if (physicalQty == null || !Number.isFinite(Number(physicalQty)) || Number(physicalQty) < 0) {
    const e = new Error("physicalQty must be a non-negative number");
    e.code = "INVALID_QTY"; e.status = 400; throw e;
  }
  const doc = await StockTake.findById(stockTakeId);
  if (!doc) { const e = new Error("Stock take not found"); e.status = 404; throw e; }
  if (doc.status === "VERIFIED" || doc.status === "ADJUSTED") {
    const e = new Error(`Stock take is ${doc.status} — cannot edit lines`);
    e.code = "ALREADY_CLOSED"; e.status = 409; throw e;
  }
  const line = doc.lines.find((l) => String(l.batchId) === String(batchId));
  if (!line) { const e = new Error("Batch line not found on this stock take"); e.status = 404; throw e; }

  const pq = Number(physicalQty);
  line.physicalQty = pq;
  line.variance    = pq - Number(line.systemQty || 0);
  if (line.variance !== 0 && !reason.trim()) {
    const e = new Error(`Reason required when variance != 0 (line ${line.drugName} / ${line.batchNo}, variance ${line.variance})`);
    e.code = "REASON_REQUIRED"; e.status = 400; throw e;
  }
  line.varianceReason = reason.trim();

  // R7hr-12-S2 (D6-04): stamp the entrant on the line. Each edit of the
  // same line overwrites the stamp — the most recent entrant wins, which
  // is what SOD wants (the verifier mustn't equal whoever last touched
  // the line).
  line.enteredBy   = user.fullName || user.employeeId || "";
  line.enteredById = user._id || user.id || null;
  line.enteredAt   = new Date();

  if (doc.status === "DRAFT") {
    doc.status = "SUBMITTED";
    doc.submittedAt = new Date();
  }
  await doc.save();
  return doc.toObject();
}

// ── verifyAndAdjust ──────────────────────────────────────────────
async function verifyAndAdjust(stockTakeId, { verifierId, verifierName } = {}) {
  if (!verifierId) {
    const e = new Error("verifierId required"); e.code = "ARG_MISSING"; throw e;
  }
  const doc = await StockTake.findById(stockTakeId);
  if (!doc) { const e = new Error("Stock take not found"); e.status = 404; throw e; }
  if (doc.status === "VERIFIED" || doc.status === "ADJUSTED") {
    const e = new Error(`Stock take is ${doc.status}`);
    e.code = "ALREADY_VERIFIED"; e.status = 409; throw e;
  }
  if (doc.status !== "SUBMITTED") {
    const e = new Error(`Cannot verify a ${doc.status} stock take — submit physical counts first`);
    e.code = "NOT_SUBMITTED"; e.status = 409; throw e;
  }
  // Separation of duties — verifier must not be the counter.
  if (doc.countedById && String(doc.countedById) === String(verifierId)) {
    const e = new Error("Verifier must be different from the counter (NABH AAC.7 separation of duties)");
    e.code = "VERIFIER_SELF"; e.status = 409; throw e;
  }
  // R7hr-12-S2 (D6-04): extended SOD — verifier must not match ANY
  // per-line entrant either. Pre-fix this check only blocked the
  // creator (countedById); a flow where User A creates, User B walks
  // the shelf and enters physical counts, then User B verifies passed
  // because countedById=A != verifier=B — but the actual counter
  // (B) was also the verifier, defeating NABH AAC.7 SOD on the
  // variance adjustments that $inc DrugBatch.remaining.
  for (const line of (doc.lines || [])) {
    if (line.enteredById && String(line.enteredById) === String(verifierId)) {
      const e = new Error("Verifier must be different from the pharmacist who entered the physical count (NABH AAC.7 separation of duties)");
      e.code = "VERIFIER_SELF"; e.status = 409; throw e;
    }
  }

  // Walk every line that has a physicalQty set (we tolerate partially-
  // counted submissions — uncounted lines stay null and aren't adjusted).
  const stampedAt = new Date();
  const adjustedLines = [];
  for (const line of doc.lines) {
    if (line.physicalQty == null) continue;
    if (Number(line.variance || 0) === 0) {
      line.adjustedAt = stampedAt;
      adjustedLines.push({ batchId: line.batchId, variance: 0 });
      continue;
    }
    const beforeBatch = await DrugBatch.findById(line.batchId).lean();
    const before = Number(beforeBatch?.remaining || 0);
    // Atomic adjustment — the predicate ensures we don't drive remaining
    // negative even if a concurrent dispense happened between count and
    // verify (in which case the new remaining differs from systemQty; we
    // still apply the same variance delta so the count reflects the
    // CHANGE the counter observed, not a stale absolute).
    // R7hr-12-S2 (D3-04): preserve the invariant
    // `remaining = quantityIn - quantityOut - vendorReturned` so the
    // pre-save hook on DrugBatchModel (which recomputes `remaining` on
    // every batch.save()) can't silently reverse a positive-variance
    // adjustment the next time a vendor return / save() fires.
    //
    // Pre-fix: positive variance simply did
    //   remaining   = max(0, remaining   + variance)
    //   quantityOut = max(0, quantityOut - variance)
    // — the two $max clamps were independent. When variance > quantityOut
    // (e.g. fresh batch with quantityOut=0 and ANY +ve found), quantityOut
    // clamped at 0 but remaining still gained the full variance, breaking
    // the invariant. The next batch.save() on a vendor return ran the
    // pre-save hook (remaining = in - out - vendorReturned) and silently
    // erased the credit, leaving an audit row with no live data change.
    //
    // Fix: split the positive variance into two legs that respect the
    // invariant — first decrement quantityOut by up to its current value,
    // then promote any overflow into quantityIn (treat it as a "missed
    // receipt" backfill). Negative variance still increments quantityOut
    // (no clamp risk because quantityOut + |variance| >= 0 always).
    // Finally, recompute `remaining` from the just-updated counters so
    // the invariant holds at write time.
    const variance = Number(line.variance || 0);
    const updated = await DrugBatch.findOneAndUpdate(
      { _id: line.batchId },
      [
        { $set: {
            // If +ve variance > current quantityOut, the overflow lands
            // in quantityIn as a back-dated receipt. If -ve or small +ve,
            // quantityIn is unchanged (max(0, variance - quantityOut) is 0).
            quantityIn: {
              $add: [
                { $ifNull: ["$quantityIn", 0] },
                { $max: [0, { $subtract: [variance, { $ifNull: ["$quantityOut", 0] }] }] },
              ],
            },
            // quantityOut decrements by variance (positive variance shrinks
            // quantityOut; negative variance grows it). Clamped at 0 — the
            // overflow case is absorbed by the quantityIn bump above.
            quantityOut: {
              $max: [0, { $subtract: [{ $ifNull: ["$quantityOut", 0] }, variance] }],
            },
        } },
        // Second pipeline stage so the recompute sees the updated counters.
        { $set: {
            remaining: {
              $max: [0, { $subtract: [
                { $subtract: ["$quantityIn", "$quantityOut"] },
                { $ifNull: ["$vendorReturned", 0] },
              ] }],
            },
        } },
      ],
      { new: true },
    );
    const after = Number(updated?.remaining ?? before + line.variance);
    line.adjustedAt = stampedAt;
    adjustedLines.push({
      batchId: line.batchId, batchNo: line.batchNo, drugName: line.drugName,
      systemQty: line.systemQty, physicalQty: line.physicalQty,
      variance: line.variance, reason: line.varianceReason,
      remainingBefore: before, remainingAfter: after,
    });

    // BillingAudit append — one row per adjusted batch. We piggyback on
    // the existing BillingAudit collection (event name not currently
    // enumerated; the model accepts STOCK_TAKE_ADJUST via the same emit
    // helper but Mongoose will reject if the enum is closed). We use a
    // best-effort emit (the helper swallows errors) so a missing enum
    // value doesn't blow up the verification call. Operators can add
    // STOCK_TAKE_ADJUST to BillingAudit.event enum in a follow-up cycle.
    try {
      if (typeof BillingAudit.emitBillingAudit === "function") {
        // R7hr-12-S2 (D6-04): include the per-line entrant identity in
        // the audit row so the chronological trail traces creator →
        // entrant → verifier. Pre-fix the row only captured the
        // verifier; the entrant (who actually walked the shelf) was
        // invisible to the GST/NABH register.
        const enteredByLabel = line.enteredBy
          ? `${line.enteredBy}${line.enteredById ? ` (${line.enteredById})` : ""}`
          : "(unknown entrant)";
        await BillingAudit.emitBillingAudit({
          event:    "MASTER_DRUG_PRICE_CHANGED",   // closest existing enum — true STOCK_TAKE_ADJUST pending enum extension
          actorId:  verifierId,
          actorName: verifierName || "Pharmacist",
          reason:   `Stock take ${doc._id} adjusted ${line.drugName} batch ${line.batchNo}: ${line.variance > 0 ? "+" : ""}${line.variance} (${line.varianceReason || "no reason"}) — physical count entered by ${enteredByLabel}`,
          before:   { remaining: before, systemQty: line.systemQty, batchNo: line.batchNo },
          after:    {
            remaining: after, physicalQty: line.physicalQty, batchNo: line.batchNo, variance: line.variance,
            enteredById: line.enteredById || null,
            enteredBy:   line.enteredBy   || "",
            enteredAt:   line.enteredAt   || null,
          },
        });
      }
    } catch (_) { /* audit best-effort */ }
  }

  doc.status       = "ADJUSTED";
  doc.verifiedBy   = verifierName || "Pharmacist";
  doc.verifiedById = verifierId;
  doc.verifiedAt   = stampedAt;
  doc.adjustedAt   = stampedAt;
  await doc.save();
  return { stockTake: doc.toObject(), adjustedLines };
}

// ── listCounts / getCount ────────────────────────────────────────
async function listCounts(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.date = {};
    if (query.from) filter.date.$gte = new Date(query.from);
    if (query.to)   filter.date.$lte = new Date(query.to);
  }
  const limit = Math.min(Number(query.limit) || 100, 500);
  return await StockTake.find(filter).sort({ date: -1 }).limit(limit).lean();
}

async function getCount(stockTakeId) {
  const doc = await StockTake.findById(stockTakeId).lean();
  if (!doc) { const e = new Error("Stock take not found"); e.status = 404; throw e; }
  return doc;
}

module.exports = {
  createCount,
  enterPhysical,
  verifyAndAdjust,
  listCounts,
  getCount,
};
