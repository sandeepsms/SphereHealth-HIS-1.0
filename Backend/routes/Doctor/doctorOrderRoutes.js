const router   = require("express").Router();
const DoctorOrder = require("../../models/Doctor/DoctorOrderModel");
// R7m: Apply role-based action gates to every write route. Reads stay
// open (any authenticated clinician can view orders). Writes are
// scoped to the appropriate role per Backend/config/permissions.js.
const { requireAction, adminOnly } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

/* ─────────────────────────────────────────────────────
   NABH High Alert Medication detection (shared util)
───────────────────────────────────────────────────── */
const HAM_KW = [
  "insulin","heparin","enoxaparin","warfarin","digoxin","amiodarone",
  "kcl","potassium chloride","magnesium sulphate","mgso4","calcium chloride",
  "dextrose 25%","dextrose 50%","hypertonic saline","nacl 3%",
  "morphine","fentanyl","pethidine","tramadol iv","oxycodone",
  "noradrenaline","norepinephrine","adrenaline","epinephrine",
  "dopamine","dobutamine","vasopressin","milrinone",
  "suxamethonium","succinylcholine","vecuronium","rocuronium","atracurium",
  "streptokinase","alteplase","tenecteplase",
  "methotrexate","cyclophosphamide","cisplatin","vincristine","doxorubicin",
  "oxytocin","nitroprusside","ketamine","propofol","midazolam iv",
  "phenytoin iv","vancomycin iv","gentamicin iv","amikacin iv",
];
const checkHAM = (name = "") => HAM_KW.some(k => (name || "").toLowerCase().includes(k));

/* ═══════════════════════════════════════════════════
   DOCTOR ROUTES
═══════════════════════════════════════════════════ */

// POST / — create single order (Doctor / Admin only)
router.post("/", requireAction("doctor-orders.write"), async (req, res) => {
  try {
    const body = req.body;
    // Auto-set HAM flags
    const name = body.orderDetails?.medicineName || body.orderDetails?.displayName || "";
    if (name) {
      body.hamFlag = checkHAM(name);
      body.twoNurseRequired = body.hamFlag;
      body.highRisk = body.hamFlag;
    }
    // Pre-populate today's pending doses from frequency/times
    if (body.scheduledTimes && Array.isArray(body.scheduledTimes) && !body.administrationRecord?.length) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      body.administrationRecord = body.scheduledTimes.map(t => ({
        scheduledTime: t,
        scheduledDate: today,
        status: "pending",
      }));
    }
    const order = await DoctorOrder.create(body);
    res.status(201).json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// POST /bulk — create multiple orders
// FIX (audit P14-B5): insertMany({ordered:false}) silently swallows
// per-document validation failures and the caller only sees the rows that
// made it in. The frontend would then re-render with "5 orders created"
// when only 3 actually inserted, and the missing 2 quietly disappeared.
// Now we report inserted + failed counts with reasons so the UI can flag
// the bad rows.
router.post("/bulk", requireAction("doctor-orders.write"), async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || !orders.length)
      return res.status(400).json({ ok: false, message: "orders[] required" });

    const enriched = orders.map(o => {
      const name = o.orderDetails?.medicineName || o.orderDetails?.displayName || "";
      o.hamFlag = checkHAM(name);
      o.twoNurseRequired = o.hamFlag;
      o.highRisk = o.hamFlag;
      // Pre-populate admin record
      if (o.scheduledTimes?.length && !o.administrationRecord?.length) {
        const today = new Date(); today.setHours(0,0,0,0);
        o.administrationRecord = o.scheduledTimes.map(t => ({ scheduledTime: t, scheduledDate: today, status: "pending" }));
      }
      return o;
    });

    let created = [];
    const failed = [];
    try {
      created = await DoctorOrder.insertMany(enriched, { ordered: false, rawResult: false });
    } catch (bulkErr) {
      // Mongoose 8 throws BulkWriteError with .insertedDocs + .writeErrors.
      created = bulkErr.insertedDocs || [];
      const writeErrors = bulkErr.writeErrors || bulkErr.result?.result?.writeErrors || [];
      for (const we of writeErrors) {
        failed.push({
          index: we.index ?? we.err?.index,
          message: we.errmsg || we.err?.errmsg || we.message,
          row: enriched[we.index ?? we.err?.index],
        });
      }
      // If insertMany threw but produced no clear writeErrors, fall back to
      // diff-by-length so we don't drop the failure on the floor.
      if (!writeErrors.length && enriched.length > created.length) {
        failed.push({ index: -1, message: bulkErr.message, count: enriched.length - created.length });
      }
    }

    res.status(failed.length ? 207 : 201).json({
      ok: failed.length === 0,
      data: created,
      count: created.length,
      failedCount: failed.length,
      failed,
    });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

// GET / — list orders. Query: UHID, visitId, status (comma-sep), orderType
// R7bb-B/D4-CRIT-S1: gated on `doctor-notes.read` (Admin / Doctor / Nurse /
// MRD). Pre-R7bb any authenticated role could pull every active doctor
// order (medication name + dose + HAM flag + administration record) for
// any patient.
router.get("/", requireAction("doctor-notes.read"), async (req, res) => {
  try {
    const { UHID, visitId, status, orderType } = req.query;
    const filter = {};
    if (UHID)      filter.UHID = UHID;
    if (visitId)   filter.visitId = visitId;
    if (status)    filter.status = { $in: status.split(",") };
    if (orderType) filter.orderType = orderType;
    const orders = await DoctorOrder.find(filter).sort({ orderedAt: -1, createdAt: -1 });
    res.json({ ok: true, data: orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /:id — single order
router.get("/:id", validateObjectIdParam("id"), requireAction("doctor-notes.read"), async (req, res) => {
  try {
    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// PATCH /:id — general update (status, consent, nurseNotes, stopReason, etc.)
//
// FIX (audit P14-B7): legacy PATCH was a wide-open `$set: req.body` —
// any caller could overwrite hamFlag / twoNurseRequired / orderedBy /
// administrationRecord / auditLog directly, bypassing every safeguard.
// Now whitelisted to fields the workflow genuinely needs to mutate from
// the generic PATCH path. Other changes go through dedicated endpoints
// (administer / rate-change / step / stop) that enforce business rules.
const PATCH_ALLOWED = new Set([
  "status", "stopReason", "stoppedAt", "stoppedBy",
  "nurseNotes", "consentObtained", "consentNotes",
  "currentRate", "rateUnit", "infusionStartedAt", "infusionEndedAt",
  "holdUntil", "holdReason", "delayReason",
  "remarks", "priority",
]);
router.patch("/:id", validateObjectIdParam("id"), requireAction("doctor-orders.write"), async (req, res) => {
  try {
    const safe = {};
    for (const [k, v] of Object.entries(req.body || {})) {
      if (PATCH_ALLOWED.has(k)) safe[k] = v;
    }
    if (Object.keys(safe).length === 0) {
      return res.status(400).json({ ok: false, message: "No allowed fields to update — use the dedicated /administer or /rate-change endpoints" });
    }
    const order = await DoctorOrder.findByIdAndUpdate(
      req.params.id, { $set: safe }, { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   NURSE — STEP COMPLETION
═══════════════════════════════════════════════════ */
// POST /:id/step — nurse completes a workflow step
router.post("/:id/step", validateObjectIdParam("id"), requireAction("order.acknowledge"), async (req, res) => {
  try {
    const { step, doneBy, notes, totalSteps } = req.body;
    if (!step || !doneBy) return res.status(400).json({ ok: false, message: "step and doneBy required" });

    const current = await DoctorOrder.findById(req.params.id);
    if (!current) return res.status(404).json({ ok: false, message: "Not found" });

    const nextIndex  = (current.currentStepIndex ?? -1) + 1;
    const isLastStep = totalSteps && nextIndex >= totalSteps - 1;

    const update = {
      $push: { auditLog: { step, doneBy, doneAt: new Date(), notes: notes || "" } },
      $set: {
        currentStepIndex: nextIndex,
        status: isLastStep ? "Completed" : "InProgress",
      },
    };
    if (isLastStep) {
      update.$set.completedBy = doneBy;
      update.$set.completedAt = new Date();
    }
    const order = await DoctorOrder.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   NURSE — MEDICATION ADMINISTRATION (NABH MAR)
═══════════════════════════════════════════════════ */
/**
 * POST /:id/administer
 * Body: {
 *   scheduledTime, scheduledDate?,
 *   status: "given"|"hold"|"not_available"|"delayed"|"skipped"|"refused"|"partial",
 *   givenAt?, givenBy, doseGiven?, routeUsed?, siteUsed?, notes?,
 *   verifiedBy?,                  // HAM 2nd nurse
 *   fiveRightsChecked?,
 *   holdReason?, holdUntil?,
 *   delayedTo?, delayReason?,
 *   prnEffect?, prnReassessTime?,
 *   adverseEvent?, adverseDetails?,
 * }
 */
router.post("/:id/administer", validateObjectIdParam("id"), requireAction("mar.write"), async (req, res) => {
  try {
    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });

    const {
      scheduledTime, status, givenAt, givenBy, doseGiven, routeUsed, siteUsed, notes,
      verifiedBy, fiveRightsChecked,
      holdReason, holdUntil, delayedTo, delayReason,
      prnEffect, prnReassessTime, adverseEvent, adverseDetails,
      isStatDose, statReason, nextDoseAdjustedAt,
    } = req.body;

    if (!scheduledTime || !givenBy || !status)
      return res.status(400).json({ ok: false, message: "scheduledTime, givenBy, status required" });

    // Validate HAM 2-nurse check
    if (order.twoNurseRequired && status === "given" && !verifiedBy)
      return res.status(422).json({ ok: false, message: "HAM order requires second nurse verification (verifiedBy)" });

    // Validate 5 Rights for given status
    if (status === "given" && !fiveRightsChecked)
      return res.status(422).json({ ok: false, message: "5 Rights must be confirmed before marking as given (fiveRightsChecked: true)" });

    // STAT dose: reason mandatory for audit trail
    if (isStatDose && status === "given" && !statReason)
      return res.status(422).json({ ok: false, message: "STAT dose requires a reason for NABH documentation (statReason)" });

    // Normalise today's date window (midnight → next midnight UTC)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(todayStart.getTime() + 86400000);

    const entry = {
      scheduledTime,
      scheduledDate: req.body.scheduledDate ? new Date(req.body.scheduledDate) : todayStart,
      status,
      givenAt:   givenAt ? new Date(givenAt) : (status === "given" ? new Date() : undefined),
      givenBy,   doseGiven, routeUsed, siteUsed, notes,
      verifiedBy, verifiedAt: verifiedBy ? new Date() : undefined,
      fiveRightsChecked: fiveRightsChecked || false,
      holdReason, holdUntil, delayedTo, delayReason,
      prnEffect, prnReassessTime,
      adverseEvent: adverseEvent || false, adverseDetails,
      isStatDose:  isStatDose  || false,
      statReason:  statReason  || undefined,
      nextDoseAdjustedAt: nextDoseAdjustedAt || undefined,
    };

    if (isStatDose) {
      // FIX (audit P14-B1): STAT idempotency — protect against a fat-fingered
      // double-click producing two STAT records 200ms apart with the same
      // nurse / drug. Window = 30 seconds, same nurse, same dose, same
      // status==given. Anything outside that we treat as a deliberate second
      // STAT (e.g. emergency repeat dose) and accept.
      if (status === "given") {
        const recentDuplicate = order.administrationRecord.find(r => {
          if (!r.isStatDose) return false;
          if (r.status !== "given") return false;
          if (r.givenBy !== givenBy) return false;
          if (!r.givenAt) return false;
          return (Date.now() - new Date(r.givenAt).getTime()) < 30_000;
        });
        if (recentDuplicate) {
          return res.status(409).json({
            ok: false,
            message: "Duplicate STAT dose ignored — same nurse already recorded one within 30 seconds",
            data: order,
          });
        }
      }
      // STAT doses are always NEW records — never overwrite a scheduled slot
      order.administrationRecord.push(entry);
    } else {
      // Regular: find existing entry for this scheduledTime AND today
      const existing = order.administrationRecord.find(r => {
        if (r.isStatDose) return false; // never overwrite a STAT record as a regular slot
        if (r.scheduledTime !== scheduledTime) return false;
        if (!r.scheduledDate) return false;
        const d = new Date(r.scheduledDate);
        return d >= todayStart && d < todayEnd;
      });
      if (existing) Object.assign(existing, entry);
      else order.administrationRecord.push(entry);
    }

    // Update order-level status
    if (status === "hold") order.status = "OnHold";
    if (status === "given") {
      // For status: count only non-STAT regular records (STAT doses are extras, not part of the course)
      const regularRecords = order.administrationRecord.filter(r => !r.isStatDose);
      // FIX (audit P14-B2): if administrationRecord has zero non-STAT entries
      // (e.g. SOS/PRN order with no scheduled course, or an order created
      // before scheduledTimes was set), .every() returns TRUE on an empty
      // array, which would flip the whole order to "Completed" the moment
      // the first STAT or PRN dose was given. Require at least one regular
      // slot before considering the course done.
      const regularDone = regularRecords.length > 0
        && regularRecords.every(r => ["given","skipped","refused"].includes(r.status));
      if (regularDone && order.orderDetails?.frequency !== "Continuous") order.status = "Completed";
      else order.status = "InProgress";
    }

    // STAT audit log
    if (isStatDose && status === "given") {
      order.auditLog.push({
        step: "STAT Dose Administered",
        doneBy: givenBy,
        doneAt: new Date(),
        notes: `STAT reason: ${statReason}${nextDoseAdjustedAt ? ` | Next dose adjusted to ${nextDoseAdjustedAt}` : ""}`,
      });
    }

    // Log adverse event
    if (adverseEvent) {
      order.auditLog.push({ step: "Adverse Event Reported", doneBy: givenBy, doneAt: new Date(), notes: adverseDetails || "Adverse drug reaction noted" });
    }

    await order.save();
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   NURSE — INFUSION RATE CHANGE (NABH)
═══════════════════════════════════════════════════ */
/**
 * POST /:id/infusion-rate
 * Body: { changedBy, oldRate, newRate, reason, reasonDetail?, verifiedBy?, doctorInformed?, doctorName? }
 */
router.post("/:id/infusion-rate", validateObjectIdParam("id"), requireAction("mar.write"), async (req, res) => {
  try {
    const { changedBy, oldRate, newRate, reason, reasonDetail, verifiedBy, doctorInformed, doctorName } = req.body;
    if (!changedBy || !newRate || !reason)
      return res.status(400).json({ ok: false, message: "changedBy, newRate, reason required" });

    // FIX (audit P14-B3): rate values were accepted as raw strings —
    // "abc", "-5", "0" all sailed through. Strip units, coerce to number,
    // reject anything that isn't a positive finite value.
    const parseRate = (v) => {
      if (v === null || v === undefined) return NaN;
      const s = String(v).replace(/[^\d.\-]/g, "");
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    };
    const newRateNum = parseRate(newRate);
    if (!Number.isFinite(newRateNum) || newRateNum <= 0) {
      return res.status(400).json({ ok: false, message: `Invalid newRate: '${newRate}' — must be a positive number (ml/hr)` });
    }

    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });

    if (order.twoNurseRequired && !verifiedBy)
      return res.status(422).json({ ok: false, message: "HAM infusion rate change requires second nurse verification" });

    const entry = { changedAt: new Date(), changedBy, oldRate: oldRate || order.currentRate, newRate, reason, reasonDetail, verifiedBy, doctorInformed: !!doctorInformed, doctorName };
    order.rateChanges.push(entry);
    order.currentRate = newRate;
    order.auditLog.push({ step: `Rate changed: ${oldRate || "—"} → ${newRate} ml/hr`, doneBy: changedBy, doneAt: new Date(), notes: `Reason: ${reason}${reasonDetail ? ` — ${reasonDetail}` : ""}` });

    await order.save();
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   NURSE — INFUSION MONITORING ENTRY (NABH)
═══════════════════════════════════════════════════ */
/**
 * POST /:id/infusion-monitor
 * Body: { nurse, currentRate?, bp?, pulse?, spo2?, urineOutput?, volumeInfused?, siteCondition?, action?, remarks? }
 */
router.post("/:id/infusion-monitor", validateObjectIdParam("id"), requireAction("mar.write"), async (req, res) => {
  try {
    const { nurse, currentRate, bp, pulse, spo2, urineOutput, volumeInfused, siteCondition, action, remarks } = req.body;
    if (!nurse) return res.status(400).json({ ok: false, message: "nurse required" });

    const entry = { time: new Date(), nurse, currentRate, bp, pulse, spo2, urineOutput, volumeInfused, siteCondition: siteCondition || "", action: action || "No Change", remarks };

    const order = await DoctorOrder.findByIdAndUpdate(
      req.params.id,
      { $push: { infusionMonitoring: entry } },
      { new: true }
    );
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });
    res.json({ ok: true, data: order });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   DOCTOR — ORDER ACTIONS (Stop / Hold / Resume / Modify / Substitute)
═══════════════════════════════════════════════════ */
/**
 * POST /:id/doctor-action
 * Body: {
 *   type: "stop"|"hold"|"resume"|"modify"|"substitute",
 *   doneBy: String,                  // doctor name
 *   reason?: String,
 *   reasonDetail?: String,
 *   holdUntil?: String,              // for hold
 *   orderDetails?: Object,           // for modify — merged with existing
 *   substituteWith?: {               // for substitute
 *     medicineName, dose, route, frequency, duration, indication, notes
 *   }
 * }
 */
router.post("/:id/doctor-action", validateObjectIdParam("id"), requireAction("order.stop"), async (req, res) => {
  try {
    const { type, doneBy, reason, reasonDetail, holdUntil, orderDetails, substituteWith } = req.body;
    if (!type || !doneBy)
      return res.status(400).json({ ok: false, message: "type and doneBy required" });

    const order = await DoctorOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ ok: false, message: "Not found" });

    let auditNote = reason || "";
    let newOrder  = null;

    switch (type) {
      case "stop":
        if (!reason)
          return res.status(400).json({ ok: false, message: "reason required to stop/discontinue an order" });
        order.status         = "Stopped";
        order.stopReason     = reason;
        order.completedBy    = doneBy;
        order.completedAt    = new Date();
        auditNote = `Discontinued: ${reason}${reasonDetail ? ` — ${reasonDetail}` : ""}`;
        break;

      case "hold":
        if (!reason)
          return res.status(400).json({ ok: false, message: "reason required to hold an order" });
        order.status     = "OnHold";
        order.nurseNotes = `HOLD by Dr. ${doneBy}: ${reason}${holdUntil ? ` — hold until ${holdUntil}` : ""}`;
        auditNote = `Order held: ${reason}${holdUntil ? ` (until ${holdUntil})` : ""}`;
        break;

      case "resume":
        order.status = "InProgress";
        auditNote = `Order resumed by doctor${reason ? `: ${reason}` : ""}`;
        break;

      case "modify": {
        if (!orderDetails)
          return res.status(400).json({ ok: false, message: "orderDetails required for modify" });
        // Merge new fields into existing orderDetails
        const existing = order.orderDetails.toObject ? order.orderDetails.toObject() : { ...order.orderDetails };
        order.orderDetails = { ...existing, ...orderDetails };
        // Re-evaluate HAM flag if drug name changed
        const name = orderDetails.medicineName || orderDetails.displayName || existing.medicineName || "";
        if (name) {
          order.hamFlag         = checkHAM(name);
          order.twoNurseRequired = order.hamFlag;
          order.highRisk        = order.hamFlag;
        }
        const changedFields = Object.keys(orderDetails).join(", ");
        auditNote = `Order modified [${changedFields}]: ${reason || "Doctor order"}${reasonDetail ? ` — ${reasonDetail}` : ""}`;
        break;
      }

      case "substitute": {
        // Step 1: Stop current order
        order.status      = "Stopped";
        order.stopReason  = `Substituted by: ${substituteWith?.medicineName || "new drug"}. ${reason || ""}`.trim();
        order.completedBy = doneBy;
        order.completedAt = new Date();
        auditNote = `Substituted — replaced by ${substituteWith?.medicineName || "new drug"}`;

        // Step 2: Create replacement order
        if (substituteWith?.medicineName) {
          const today = new Date(); today.setHours(0,0,0,0);
          const newName = substituteWith.medicineName;
          const hamNew  = checkHAM(newName);
          const FREQ_TIMES_MAP = {
            "OD":["08:00"],"BD":["08:00","20:00"],"TDS":["08:00","14:00","20:00"],
            "QID":["06:00","12:00","18:00","00:00"],"Q8H":["06:00","14:00","22:00"],
            "Q12H":["08:00","20:00"],"STAT":["Immediate"],"SOS":["As Needed"],
            "HS":["22:00"],"Continuous":["Continuous"],
          };
          const times = FREQ_TIMES_MAP[substituteWith.frequency] || ["08:00"];
          newOrder = await DoctorOrder.create({
            UHID: order.UHID, patientName: order.patientName, visitId: order.visitId,
            visitType: order.visitType,
            orderType: order.orderType,
            priority: substituteWith.priority || "Routine",
            hamFlag: hamNew, twoNurseRequired: hamNew, highRisk: hamNew,
            orderDetails: { ...substituteWith, notes: (substituteWith.notes || "") + ` [Substituted for: ${order.orderDetails?.medicineName || "previous order"}]` },
            orderedBy: doneBy, orderedByRole: "Doctor",
            status: "Pending",
            administrationRecord: times.filter(t => t !== "Immediate" && t !== "As Needed" && t !== "Continuous")
              .map(t => ({ scheduledTime: t, scheduledDate: today, status: "pending" })),
            auditLog: [{ step: "Order created (substitution)", doneBy, doneAt: new Date(), notes: `Substituted for order ${order._id}` }],
          });
        }
        break;
      }

      default:
        return res.status(400).json({ ok: false, message: `Unknown action type: ${type}` });
    }

    order.auditLog.push({ step: `doctor:${type}`, doneBy, doneAt: new Date(), notes: auditNote });
    await order.save();

    res.json({ ok: true, data: order, newOrder: newOrder || undefined });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
});

/* ═══════════════════════════════════════════════════
   SEED DEMO DATA — for testing NABH compliance
═══════════════════════════════════════════════════ */
/**
 * POST /seed-demo
 * Body: { UHID, patientName, visitId, createdBy }
 * Creates a realistic set of medication + infusion orders for demo
 */
// R7m: Demo seeder is intentionally gated to Admin so a logged-in
// receptionist or nurse can't inject fake orders into the system in
// production.
router.post("/seed-demo", adminOnly, async (req, res) => {
  try {
    const { UHID, patientName, visitId, createdBy = "Dr. Demo" } = req.body;
    if (!UHID) return res.status(400).json({ ok: false, message: "UHID required" });

    const today = new Date(); today.setHours(0,0,0,0);
    const now   = new Date();

    const DEMO_ORDERS = [
      // ── Medications ──
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 6),
        orderDetails: { medicineName: "Tab. Amoxicillin + Clavulanate", dose: "625mg", route: "PO", frequency: "BD", duration: "5 days", indication: "Community acquired pneumonia — prophylaxis", notes: "Give after food" },
        scheduledTimes: ["08:00","20:00"],
        administrationRecord: [
          { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8*3600000 + 5*60000), givenBy: "Sr. Priya Sharma", fiveRightsChecked: true, notes: "Patient tolerated well" },
          { scheduledTime: "20:00", scheduledDate: today, status: "pending" },
        ],
        status: "InProgress",
      },
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 6),
        orderDetails: { medicineName: "Tab. Paracetamol", dose: "500mg", route: "PO", frequency: "TDS", duration: "3 days", indication: "Fever and pain", notes: "SOS if temp > 100°F" },
        scheduledTimes: ["08:00","14:00","20:00"],
        administrationRecord: [
          { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8*3600000), givenBy: "Sr. Priya Sharma", fiveRightsChecked: true },
          { scheduledTime: "14:00", scheduledDate: today, status: "hold", holdReason: "Patient afebrile — temp 98.4°F, not required", givenBy: "Sr. Meena Devi" },
          { scheduledTime: "20:00", scheduledDate: today, status: "pending" },
        ],
        status: "InProgress",
      },
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "STAT",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 2),
        orderDetails: { medicineName: "Inj. Pantoprazole", dose: "40mg", route: "IV", frequency: "OD", duration: "5 days", indication: "GI prophylaxis", dilution: "NS 0.9%", totalVolume: "100", notes: "Dilute in 100ml NS, give over 15 min" },
        scheduledTimes: ["08:00"],
        administrationRecord: [
          { scheduledTime: "08:00", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 8*3600000), givenBy: "Sr. Kavita R.", verifiedBy: "Sr. Meena Devi", fiveRightsChecked: true, notes: "Diluted in 100ml NS, infused over 15 min" },
        ],
        status: "InProgress",
      },
      {
        // HAM — Insulin
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 6),
        hamFlag: true, twoNurseRequired: true, highRisk: true,
        orderDetails: { medicineName: "Inj. Insulin (Regular)", dose: "10 Units", route: "SC", frequency: "OD", duration: "Daily — sliding scale", indication: "T2DM — fasting hyperglycaemia", notes: "Give 30 min before breakfast. BSL check mandatory before administration" },
        scheduledTimes: ["07:30"],
        administrationRecord: [
          { scheduledTime: "07:30", scheduledDate: today, status: "given", givenAt: new Date(today.getTime() + 7.5*3600000), givenBy: "Sr. Priya Sharma", verifiedBy: "Sr. Meena Devi", fiveRightsChecked: true, notes: "BSL: 186 mg/dL pre-dose. Patient cooperative" },
        ],
        status: "InProgress",
      },
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 6),
        orderDetails: { medicineName: "Tab. Atorvastatin", dose: "40mg", route: "PO", frequency: "HS", duration: "Continue", indication: "Dyslipidaemia — on long-term therapy", notes: "Give at bedtime with water" },
        scheduledTimes: ["22:00"],
        administrationRecord: [{ scheduledTime: "22:00", scheduledDate: today, status: "pending" }],
        status: "Pending",
      },
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "Medication", priority: "Urgent",
        orderedBy: createdBy, orderedAt: new Date(now - 1800000),
        orderDetails: { medicineName: "Inj. Ondansetron", dose: "4mg", route: "IV", frequency: "TDS", duration: "2 days", indication: "Post-operative nausea/vomiting", notes: "Slow IV push over 5 min" },
        scheduledTimes: ["08:00","14:00","20:00"],
        administrationRecord: [
          { scheduledTime: "08:00", scheduledDate: today, status: "not_available", holdReason: "Out of stock — pharmacy indent placed. ETA 2 hours", givenBy: "Sr. Kavita R." },
          { scheduledTime: "14:00", scheduledDate: today, status: "pending" },
          { scheduledTime: "20:00", scheduledDate: today, status: "pending" },
        ],
        status: "InProgress",
      },
      // ── IV Fluids / Infusions ──
      {
        UHID, patientName, visitId, visitType: "IPD", orderType: "IV_Fluid", priority: "Routine",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 8),
        orderDetails: { medicineName: "NS 0.9%", displayName: "NS 0.9% 500ml", dose: "500ml", route: "IV Infusion", frequency: "Q8H", duration: "24 hours", rate: "62", totalVolume: "500", titrationGoal: "Adequate hydration — urine output > 30 ml/hr", notes: "Through 18G cannula — right forearm" },
        scheduledTimes: ["06:00","14:00","22:00"],
        currentRate: "62",
        rateChanges: [
          { changedAt: new Date(now - 3600000 * 4), changedBy: "Sr. Priya Sharma", oldRate: "62", newRate: "50", reason: "Fluid overload", reasonDetail: "Pedal oedema noted — rate reduced per protocol", doctorInformed: true, doctorName: createdBy },
          { changedAt: new Date(now - 3600000 * 1), changedBy: "Sr. Meena Devi", oldRate: "50", newRate: "62", reason: "Doctor order", reasonDetail: "Oedema resolved — resumed standard rate", doctorInformed: false },
        ],
        infusionMonitoring: [
          { time: new Date(now - 3600000 * 6), nurse: "Sr. Priya Sharma", currentRate: "62", bp: "124/80", pulse: "86", spo2: "97", urineOutput: "35", siteCondition: "Patent", action: "No Change", remarks: "Infusion running well" },
          { time: new Date(now - 3600000 * 4), nurse: "Sr. Priya Sharma", currentRate: "50", bp: "128/84", pulse: "88", spo2: "96", urineOutput: "20", siteCondition: "Patent", action: "Rate Decreased", remarks: "Bilateral pedal oedema +1 noted. Rate reduced to 50 ml/hr. Dr. notified" },
          { time: new Date(now - 3600000 * 2), nurse: "Sr. Meena Devi", currentRate: "62", bp: "122/78", pulse: "82", spo2: "98", urineOutput: "40", siteCondition: "Patent", action: "Rate Increased", remarks: "Oedema resolved. Rate restored per doctor order" },
        ],
        status: "InProgress",
      },
      {
        // HAM — Noradrenaline infusion
        UHID, patientName, visitId, visitType: "IPD", orderType: "IV_Fluid", priority: "Urgent",
        orderedBy: createdBy, orderedAt: new Date(now - 3600000 * 5),
        hamFlag: true, twoNurseRequired: true, highRisk: true,
        orderDetails: { medicineName: "Noradrenaline", displayName: "Inj. Noradrenaline (HAM ⚠)", dose: "4mg", route: "IV Infusion", dilution: "4mg in 50ml NS (80 mcg/ml)", frequency: "Continuous", rate: "3", totalVolume: "50", titrationGoal: "Target MAP > 65 mmHg", notes: "Titrate 0.5–1 ml/hr every 5–10 min. Mandatory vitals Q30 min. MUST run through central line only" },
        currentRate: "3",
        rateChanges: [
          { changedAt: new Date(now - 3600000 * 4), changedBy: "Sr. Meena Devi", oldRate: "2", newRate: "3", reason: "Haemodynamic instability", reasonDetail: "MAP dropped to 58 — increased per titration protocol. Dr. informed", verifiedBy: "Sr. Priya Sharma", doctorInformed: true, doctorName: createdBy },
        ],
        infusionMonitoring: [
          { time: new Date(now - 3600000 * 4.5), nurse: "Sr. Meena Devi", currentRate: "2", bp: "86/52", pulse: "104", spo2: "95", urineOutput: "12", siteCondition: "Patent", action: "Rate Increased", remarks: "MAP 55 — rate increased to 3ml/hr. Dr. notified. Patient semi-conscious" },
          { time: new Date(now - 3600000 * 3.5), nurse: "Sr. Priya Sharma", currentRate: "3", bp: "94/60", pulse: "98", spo2: "96", urineOutput: "18", siteCondition: "Patent", action: "No Change", remarks: "MAP improving. Continue monitoring Q30 min" },
          { time: new Date(now - 3600000 * 2.5), nurse: "Sr. Meena Devi", currentRate: "3", bp: "102/68", pulse: "92", spo2: "97", urineOutput: "28", siteCondition: "Patent", action: "No Change", remarks: "MAP 79 — target achieved. Continue current rate" },
        ],
        status: "InProgress",
      },
    ];

    // Clear existing demo data
    await DoctorOrder.deleteMany({ UHID, orderedBy: "Dr. Demo" });
    const created = await DoctorOrder.insertMany(DEMO_ORDERS, { ordered: false });
    res.status(201).json({ ok: true, message: `${created.length} demo orders created`, data: created });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// DELETE /:id — cancel order
router.delete("/:id", validateObjectIdParam("id"), requireAction("doctor-orders.write"), async (req, res) => {
  try {
    await DoctorOrder.findByIdAndUpdate(req.params.id, { status: "Cancelled" });
    res.json({ ok: true, message: "Order cancelled" });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
