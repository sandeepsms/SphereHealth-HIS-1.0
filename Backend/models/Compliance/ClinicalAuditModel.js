// models/Compliance/ClinicalAuditModel.js
// ════════════════════════════════════════════════════════════════════
// R7bn-1 / D9-fix: ClinicalAudit — single chronological audit log for
// EVERY PHI clinical state change in the HIS.
//
// Mirrors BillingAudit (financial side). NABH AAC.7 + IMS.2 + IT Rule
// 46 all require a complete, queryable chronological audit trail for
// clinical writes (doctor notes, MAR administration, initial assessment
// sign-off, discharge finalize, MLC finalize, consent sign/revoke, etc).
//
// Pre-R7bn audit data was scattered:
//   • ConsentForm.auditTrail[] (embedded — no cross-patient query)
//   • BloodTransfusionRegister.audit[] (embedded — same problem)
//   • Doctor notes / MAR / discharge had NO audit at all
//   • Initial assessment doctor/nurseCompleted flag flipped without trace
//
// Append-only — never updated, never deleted. Retention enforced by
// a separate archiver (mirrors the BillingAudit archiver pattern, F33).
// Default retention floor: 7y for SIGNED / FINALIZED / DELETED events
// (NABH IPSG.6 + MCI Indian Medical Records Act 1956 §3), 3y for
// CREATE / DRAFT_UPDATED events.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const ClinicalAuditSchema = new mongoose.Schema(
  {
    // ── What happened ────────────────────────────────────────────
    event: {
      type: String,
      required: true,
      enum: [
        // Doctor Notes
        "DOCTOR_NOTE_CREATED",
        "DOCTOR_NOTE_UPDATED",
        "DOCTOR_NOTE_SIGNED",
        "DOCTOR_NOTE_DELETED",
        "DOCTOR_NOTE_AMENDED",          // post-sign amendment (NABH IMS.2)

        // Nurse Notes (NABH MOM.1 — nursing records: long retention floor)
        "NURSE_NOTE_CREATED",
        "NURSE_NOTE_UPDATED",
        "NURSE_NOTE_SUBMITTED",
        "NURSE_NOTE_AMENDED",
        "NURSE_NOTE_DELETED",

        // Pharmacy (NABH MOM.4 + HAM drug trail — long retention floor)
        "PHARMACY_DISPENSED",
        "PHARMACY_SALE_CANCELLED",
        "PHARMACY_RETURNED",
        "PHARMACY_ITEMS_ADDED",
        "PHARMACY_CREDIT_COLLECTED",

        // Initial Assessment gate (NABH COP.1 / COP.2)
        "INITIAL_ASSESSMENT_DOCTOR_SIGNED",
        "INITIAL_ASSESSMENT_NURSE_SIGNED",
        "INITIAL_ASSESSMENT_DRAFT_SAVED",

        // Diagnosis (NABH HIC.5)
        "DIAGNOSIS_UPDATED",

        // MAR / Medication administration (NABH MOM.4 + IPSG.3)
        "MAR_DOSE_ADMINISTERED",
        "MAR_DOSE_HELD",
        "MAR_DOSE_REFUSED",
        "MAR_DOSE_MISSED",
        "MAR_MEDICATION_DISCONTINUED",

        // Doctor orders (NABH COP.2)
        "ORDER_CREATED",
        "ORDER_ACKNOWLEDGED",
        "ORDER_DISCONTINUED",
        "INFUSION_RATE_CHANGED",
        "INFUSION_STARTED",
        "INFUSION_STOPPED",

        // Consent (NABH PRE.4)
        "CONSENT_SIGNED",
        "CONSENT_REFUSED",
        "CONSENT_REVOKED",

        // MLC (medico-legal)
        "MLC_CREATED",
        "MLC_FINALIZED",
        "MLC_CLOSED",

        // Blood transfusion (NABH MOM.4)
        "TRANSFUSION_ORDERED",
        "TRANSFUSION_STARTED",
        "TRANSFUSION_COMPLETED",
        "TRANSFUSION_REACTION_LOGGED",

        // Discharge (NABH AAC.4)
        "DISCHARGE_SUMMARY_CREATED",
        "DISCHARGE_SUMMARY_FINALIZED",
        "DISCHARGE_WORKFLOW_ADVANCED",
        "ADMISSION_REACTIVATED",

        // Vitals / Assessment writes
        "VITALS_RECORDED",
        "NURSING_ASSESSMENT_RECORDED",
        "PAIN_REASSESSED",

        // R7eg — ICU Bundles of Care (NABH HIC.5 + COP.13)
        // Each shift save + finalize + bundle-specific non-compliance
        // signal feeds the Infection-Control register downstream.
        "ICU_BUNDLE_SAVED",
        "ICU_BUNDLE_SHIFT_FINALIZED",
        "ICU_BUNDLE_VAP_NON_COMPLIANT",
        "ICU_BUNDLE_CLABSI_NON_COMPLIANT",

        // B1-T03 — Medical Certificate forgery guard. Admins may issue
        // a certificate on behalf of a doctor with a written justification;
        // every such issuance is permanently logged on the long-retention
        // floor because the cert is a legal instrument (MCI + Indian
        // Medical Records Act 1956 §3).
        "MEDICAL_CERTIFICATE_OVERRIDE_ISSUED",
      ],
      index: true,
    },

    // ── Who did it ────────────────────────────────────────────────
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorName: { type: String, default: "" },
    actorRole: { type: String, default: "" },

    // ── On what patient / admission ──────────────────────────────
    UHID: { type: String, default: "", index: true },
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "IPDAdmission", default: null, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", default: null },
    patientName: { type: String, default: "" },

    // ── On what entity (note / MAR / consent / etc) ──────────────
    targetType: { type: String, default: "" },  // e.g. "DoctorNote" / "MAR" / "ConsentForm"
    targetId:   { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    // ── Before / After snapshots (sparse — only what changed) ────
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after:  { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Context ──────────────────────────────────────────────────
    reason:    { type: String, default: "" },   // free-text — e.g. amendment reason
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },

    // ── Retention floor ──────────────────────────────────────────
    // SIGNED / FINALIZED / DELETED events: +7 years from createdAt.
    // CREATE / DRAFT_UPDATED / VITAL recording: +3 years.
    // The archiver looks at retainUntil to ship rows to cold storage.
    retainUntil: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,            // createdAt is the chronological anchor
    collection: "clinical_audits",
    // R7bn — append-only. Mongoose strict mode rejects unknown fields
    // and there are no update hooks (we never update audit rows).
    strict: true,
  },
);

// Compound indexes for the most common queries
ClinicalAuditSchema.index({ admissionId: 1, createdAt: -1 });   // per-admission timeline
ClinicalAuditSchema.index({ UHID: 1, createdAt: -1 });          // per-patient timeline
ClinicalAuditSchema.index({ event: 1, createdAt: -1 });         // event-type analytics
ClinicalAuditSchema.index({ actorId: 1, createdAt: -1 });       // who-did-what-when

module.exports =
  mongoose.models.ClinicalAudit ||
  mongoose.model("ClinicalAudit", ClinicalAuditSchema);
