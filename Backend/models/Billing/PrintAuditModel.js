// models/Billing/PrintAuditModel.js
// ════════════════════════════════════════════════════════════════════
// R7bf-F / A4-CRIT-4: PrintAudit collection — one row per print/reprint
// of any patient-facing document (bills, receipts, lab reports,
// discharge summaries, prescriptions). Pre-R7bf, reprints were silent;
// GST Rules §35 / NABH IMS.5 require a traceable "who printed what,
// when, and which copy number". This collection underpins the
// DUPLICATE watermark (A4-CRIT-5) as well — the watermark fires when
// the count returned here is > 1.
//
// One row PER print event. The atomic `$inc` on the source entity
// (bill / receipt / report) gives a fast count without scanning this
// collection; this collection holds the audit trail.
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");

const PrintAuditSchema = new mongoose.Schema(
  {
    // ── What was printed ──────────────────────────────────────────
    entityType: {
      type: String,
      required: true,
      enum: [
        "Bill",
        "Receipt",
        "LabReport",
        "RefundReceipt",
        "AdvanceReceipt",
        "DischargeSummary",
        "Prescription",
        "PharmacyBill",
        "ConsentForm",
        "MedicalCertificate",
        "TPAAuthorization",
        "MARSheet",
        "DoctorOrderSheet",
        "IPDFile",
        // R7bh-F1 / META-1: additional entity types covered by the
        // openPrint() callsite sweep. VisitorPass + DoctorOrder were
        // missing from the enum, so PrintAudit POSTs from those flows
        // returned 400 → no audit row, no printCount bump.
        "VisitorPass",
        "DoctorOrder",
        // R7bj-F7: ward-boy / housekeeping / security / dietary /
        // mortuary / BMW / code-response printables. Pre-R7bj these
        // flows had no entityType registered, so PrintAudit returned
        // 400 (validation) and the reprint counter never advanced —
        // making the R7bf-F DUPLICATE watermark and GST/NABH audit
        // trail effectively missing for these roles. Also includes
        // F1 (Physio) + F2 (Kitchen / Dietary) sibling printables.
        "WardTask",
        "EquipmentTransport",
        "SampleCollection",
        "CleaningTask",
        "SpillageReport",
        "PestControl",
        "AreaChecklist",
        "GateLog",
        "IncidentReport",
        "SecurityShiftRegister",
        "DietPlan",
        "MortuaryHandover",
        "BmwManifest",
        "CodeResponse",
        "PhysioSession",
        "PhysioPlan",
        "KitchenIndent",
        "AdverseFoodReaction",
      ],
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    entityNumber: { type: String, trim: true, index: true }, // billNumber / receiptNo / reportNo

    // ── Print metadata ─────────────────────────────────────────────
    // Copy number AFTER this print fires (1 = first print, 2+ = duplicate).
    // Stored snapshot so an audit row remains meaningful even if the
    // entity's printCount is later reset or the entity is deleted.
    printCount: { type: Number, default: 1, min: 1 },
    // R7bf-A4-CRIT-1: source of truth for the rendering pipeline. If a
    // server-side puppeteer endpoint is ever brought back, it would
    // write "server" here and the canonical client React print writes
    // "client". Allows the GST/NABH audit to flag divergence.
    printSource: { type: String, enum: ["client", "server"], default: "client" },

    // ── Who, when (IST) ────────────────────────────────────────────
    printedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    printedByName: { type: String, trim: true },
    printedByRole: { type: String, trim: true },
    // Stored UTC (Mongoose default). The frontend converts to IST when
    // it renders. Matches the rest of the audit collections — single
    // wire format, single display layer.
    printedAt: { type: Date, default: Date.now, index: true },

    // ── Multi-tenancy hook (deferred but kept for forward-compat) ──
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", default: null },

    // ── Reference patient context (denormalised — convenient for UI) ─
    UHID:       { type: String, uppercase: true, trim: true, index: true },
    patientName:{ type: String, trim: true },

    // ── IP + UA for forensic chain-of-custody ──────────────────────
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Most queries are by-entity ("how many times has this bill been printed?")
// or by-date for the audit register. Both compound indexes below cover
// the hot read paths without bloating writes.
PrintAuditSchema.index({ entityType: 1, entityId: 1, printedAt: -1 });
PrintAuditSchema.index({ printedAt: -1 });
PrintAuditSchema.index({ printedBy: 1, printedAt: -1 });

const PrintAudit =
  mongoose.models.PrintAudit ||
  mongoose.model("PrintAudit", PrintAuditSchema);

module.exports = PrintAudit;
