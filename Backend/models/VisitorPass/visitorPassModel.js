/**
 * VisitorPass — NABH visitor management (FMS.7)
 *
 * Each pass:
 *   - belongs to an admission
 *   - records the attendant's identity + relation + ID proof
 *   - has a visit window (validFrom → validUntil)
 *   - can be Active / Expired / Returned / Lost
 *
 * Hospital policy enforced at issue:
 *   - Max 2 active passes per admission (configurable per ward later)
 *   - ICU/NICU exceptions handled in the controller
 */
const mongoose = require("mongoose");

const VisitorPassSchema = new mongoose.Schema(
  {
    passNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      required: true,
      index: true,
    },
    patientName:    { type: String, required: true },
    patientUHID:    { type: String, index: true },
    bedNumber:      String,
    wardName:       String,

    // Attendant identity
    attendantName:     { type: String, required: true },
    attendantRelation: { type: String, required: true }, // "Son", "Spouse", "Mother", "Friend", "Other"
    attendantPhone:    { type: String },
    idProofType:       { type: String, enum: ["Aadhaar", "PAN", "Voter ID", "Driving License", "Passport", "Other", null], default: null },
    idProofNumber:     { type: String, default: "" },

    // Validity window
    validFrom:  { type: Date, default: Date.now },
    validUntil: { type: Date, required: true },

    // Status
    status: {
      type: String,
      enum: ["Active", "Returned", "Expired", "Lost", "Revoked"],
      default: "Active",
      index: true,
    },
    returnedAt: Date,
    revokedAt:  Date,
    revokedReason: String,

    // Audit
    issuedBy:   { type: String, required: true },  // receptionist name / id
    issuedByRole: { type: String, default: "Receptionist" },

    notes: String,

    // R7bh-F1 / R7bg-7-CRIT-2: PrintAudit infrastructure $incs this on
    // every pass print/reprint. VisitorPass entityType added to the
    // PrintAudit enum in R7bh-F1 so security gate-trail (FMS.7)
    // captures reprints.
    printCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

VisitorPassSchema.index({ admissionId: 1, status: 1 });
VisitorPassSchema.index({ status: 1, validUntil: 1 });

module.exports =
  mongoose.models.VisitorPass ||
  mongoose.model("VisitorPass", VisitorPassSchema);
