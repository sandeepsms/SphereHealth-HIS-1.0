// controllers/Print/printAuditController.js
// ════════════════════════════════════════════════════════════════════
// R7bf-F / A4-CRIT-4: writes a PrintAudit row + atomically bumps the
// printCount on the source entity. The frontend calls POST /api/print-audit
// IMMEDIATELY BEFORE `window.print()`, so the response's printCount tells
// the printable whether to render the DUPLICATE watermark (A4-CRIT-5).
//
// Design choices:
//   • Best-effort behaviour. A print should NEVER be blocked by an
//     audit-write failure. If the entity model has no `printCount`
//     field, the bump is silently skipped and the audit row still
//     lands. Frontend treats a non-200 as printCount=1.
//   • `$inc` is atomic — two simultaneous reprints can't double-count.
//   • Decimal128 unwrap is irrelevant here (no money fields), so the
//     wire shape is plain JSON.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const PrintAudit = require("../../models/Billing/PrintAuditModel");

// Map entityType → mongoose model name. New entity types: add a row
// here AND to the PrintAudit enum. Missing types still record an audit
// row (we don't reject), just skip the $inc.
const ENTITY_MODEL = {
  Bill:               "PatientBill",
  Receipt:            "PatientBill", // payment receipt prints off the bill
  PharmacyBill:       "PharmacySale",
  // R7hr-12-S2 (D7-05): consolidated interim/final pharmacy bill spans
  // multiple PharmacySale rows. There is no single backing doc, so
  // mapping to null forces the fallback PrintAudit row-count path
  // (entityType + entityId) — admissionId is used as the entityId
  // anchor, with the consolidated billNumber as entityNumber. This way
  // INT-PHM-2602 reprints get their own duplicate counter without
  // polluting Admission.printCount (used by IPDFile/MARSheet).
  PharmacyConsolidatedBill: null,
  RefundReceipt:      "PatientBill", // refund is also a bill payment row
  AdvanceReceipt:     "PatientAdvance",
  // R7bh-F1: model is registered as "LabReport" in labRecordsModels.js,
  // not "LabRecord" — pre-R7bh the $inc no-op'd because Model lookup
  // by name failed. Same key on both sides now.
  LabReport:          "LabReport",
  DischargeSummary:   "DischargeSummary",
  // R7bh-F1: model is registered as "Prescription" in
  // models/Doctor/prescription.js — no model named "OPDPrescription"
  // exists, so pre-R7bh the Model lookup failed and printCount
  // never incremented.
  Prescription:       "Prescription",
  ConsentForm:        "ConsentForm",
  MedicalCertificate: "MedicalCertificate",
  TPAAuthorization:   "PatientBill",
  MARSheet:           "Admission",
  DoctorOrderSheet:   "DoctorOrder",
  IPDFile:            "Admission",
  // R7bh-F1 / META-1: openPrint() sweep introduced these — frontend
  // emits printAudit:{entityType:"VisitorPass"} and "DoctorOrder" so
  // the $inc lands on the right collection. PrintAudit enum updated
  // in PrintAuditModel.js to accept both.
  VisitorPass:        "VisitorPass",
  DoctorOrder:        "DoctorOrder",
  // R7bm-F1 / META-4: 18 R7bj-F7 entity types — Ward-Boy, Housekeeping,
  // Security, Dietary, Mortuary, BMW, Code-Response, Physio + Kitchen
  // printables. Pre-R7bm the PrintAudit enum accepted these but
  // ENTITY_MODEL had zero of them → $inc no-op'd → printCount returned
  // 1 forever → DUPLICATE watermark never fired on reprints.
  //
  // `null` here means "no entity-level printCount field" — the audit
  // row still lands and the count fallback below queries PrintAudit
  // itself so the watermark still works. Use null for collections
  // whose models don't carry a `printCount` (transient slips with
  // no Mongoose model yet, or schemas where adding the field would
  // bloat hot-path writes).
  WardTask:              "WardTask",
  EquipmentTransport:    null,
  SampleCollection:      null,
  CleaningTask:          "CleaningTask",
  SpillageReport:        "SpillageIncident",
  PestControl:           "PestControlSchedule",
  AreaChecklist:         "AreaCleaningLog",
  GateLog:               "GateLog",
  IncidentReport:        "IncidentReport",
  SecurityShiftRegister: null,
  DietPlan:              "PatientDietPlan",
  MortuaryHandover:      "MortuaryRecord",
  BmwManifest:           "BmwTransportManifest",
  CodeResponse:          "CodeResponseEvent",
  PhysioSession:         "PhysioSession",
  PhysioPlan:            "PhysioPlan",
  KitchenIndent:         "KitchenIndent",
  AdverseFoodReaction:   "AdverseFoodReaction",
};

/**
 * POST /api/print-audit
 * Body:
 *   {
 *     entityType:   "Bill" | "Receipt" | "LabReport" | ...
 *     entityId:     "<ObjectId of the underlying doc>"
 *     entityNumber: "BILL-2026-00234"  (denormalised label)
 *     printSource:  "client"           (default if omitted)
 *     UHID:         "UH00000099"
 *     patientName:  "..."
 *   }
 * Response:
 *   { success: true, printCount: <int>, isDuplicate: <bool> }
 */
exports.recordPrint = async (req, res) => {
  try {
    const {
      entityType,
      entityId,
      entityNumber,
      printSource,
      UHID,
      patientName,
    } = req.body || {};

    if (!entityType || !entityId) {
      return res.status(400).json({
        success: false,
        message: "entityType and entityId are required",
      });
    }
    if (!PrintAudit.schema.path("entityType").enumValues.includes(entityType)) {
      return res.status(400).json({
        success: false,
        message: `Unknown entityType "${entityType}".`,
        accepted: PrintAudit.schema.path("entityType").enumValues,
      });
    }
    if (!mongoose.Types.ObjectId.isValid(entityId)) {
      return res.status(400).json({
        success: false,
        message: "entityId must be a valid ObjectId",
      });
    }

    // ── Atomic bump on source entity (best-effort) ────────────────
    // Use findOneAndUpdate with $inc so two simultaneous prints can't
    // both observe a stale count and overwrite. The new value comes
    // back via { new: true } so we know the post-bump count.
    //
    // R7bm-F1 / META-4: ENTITY_MODEL may legitimately map to `null`
    // for entity types that don't carry a printCount field (transient
    // slips). In that case we still need a stable copy number for the
    // DUPLICATE watermark, so we fall back to counting prior PrintAudit
    // rows for the same entityType+entityId pair and add 1 for the row
    // we're about to write.
    let printCount = 1;
    const hasMapping = Object.prototype.hasOwnProperty.call(ENTITY_MODEL, entityType);
    const modelName = ENTITY_MODEL[entityType];
    if (modelName) {
      try {
        const Model = mongoose.model(modelName);
        const updated = await Model.findByIdAndUpdate(
          entityId,
          { $inc: { printCount: 1 } },
          { new: true, upsert: false, projection: { printCount: 1 } },
        ).lean();
        // If the entity didn't carry printCount before, the $inc creates
        // it at value 1 (first print). Otherwise we get count = N+1.
        if (updated && typeof updated.printCount === "number") {
          printCount = updated.printCount;
        }
      } catch (_e) {
        // Model missing / collection unindexed / entity already deleted —
        // never block the print. The audit row still lands below.
      }
    } else if (hasMapping || !modelName) {
      // modelName === null (no entity-level printCount field) OR no
      // ENTITY_MODEL entry at all → fall back to PrintAudit-collection
      // count so reprints still fire the DUPLICATE watermark.
      try {
        const prior = await PrintAudit.countDocuments({ entityType, entityId });
        printCount = prior + 1;
      } catch (_e) {
        // PrintAudit unreachable — keep printCount at 1 so the print
        // still proceeds; isDuplicate will be false this once.
      }
    }

    // ── Write audit row ───────────────────────────────────────────
    await PrintAudit.create({
      entityType,
      entityId,
      entityNumber: entityNumber || undefined,
      printCount,
      printSource: printSource || "client",
      printedBy:     req.user?._id || req.user?.id || undefined,
      printedByName: req.user?.fullName || req.user?.employeeId || "Unknown",
      printedByRole: req.user?.role || undefined,
      UHID:        UHID || undefined,
      patientName: patientName || undefined,
      ipAddress:   req.ip,
      userAgent:   req.get?.("user-agent") || undefined,
    });

    return res.json({
      success: true,
      printCount,
      isDuplicate: printCount > 1,
    });
  } catch (err) {
    console.warn("[printAudit] recordPrint failed:", err?.message);
    // Never break the print. Tell the caller it's a first print.
    return res.status(200).json({
      success: false,
      printCount: 1,
      isDuplicate: false,
      message: err?.message,
    });
  }
};

/**
 * GET /api/print-audit/count?entityType=Bill&entityId=...
 * Lightweight count probe (used to decide DUPLICATE watermark before
 * the user even hits print again — e.g. opening a reprint preview).
 */
exports.getPrintCount = async (req, res) => {
  try {
    const { entityType, entityId } = req.query || {};
    if (!entityType || !entityId || !mongoose.Types.ObjectId.isValid(entityId)) {
      return res.status(400).json({ success: false, message: "entityType and entityId required" });
    }
    const count = await PrintAudit.countDocuments({ entityType, entityId });
    return res.json({ success: true, printCount: count, isDuplicate: count >= 1 });
  } catch (err) {
    return res.status(200).json({ success: false, printCount: 0, isDuplicate: false });
  }
};

/**
 * GET /api/print-audit?entityType=Bill&entityId=...&limit=50
 * Detailed audit list — who printed which copy when.
 */
exports.listPrintAudit = async (req, res) => {
  try {
    const { entityType, entityId, UHID, from, to } = req.query || {};
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const q = {};
    if (entityType) q.entityType = entityType;
    if (entityId && mongoose.Types.ObjectId.isValid(entityId)) q.entityId = entityId;
    if (UHID) q.UHID = String(UHID).toUpperCase();
    if (from || to) {
      q.printedAt = {};
      if (from) q.printedAt.$gte = new Date(from);
      if (to)   q.printedAt.$lte = new Date(to);
    }
    const rows = await PrintAudit.find(q).sort({ printedAt: -1 }).limit(limit).lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message });
  }
};
