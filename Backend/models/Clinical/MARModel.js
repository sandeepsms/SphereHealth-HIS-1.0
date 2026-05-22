// models/Clinical/MARModel.js
// NABH Standard: MOM.4 — Medication Administration Record

const mongoose = require("mongoose");

const AdministrationEntrySchema = new mongoose.Schema(
  {
    scheduledTime: { type: String, trim: true },
    actualTime: { type: Date },
    status: {
      type: String,
      enum: ["GIVEN", "HELD", "REFUSED", "NOT_AVAILABLE", "MISSED"],
      required: true },
    administeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NurseStaff" },
    nurseName: { type: String, trim: true },
    nurseStaffId: { type: String },
    batchNumber: { type: String, trim: true },
    reason: { type: String, trim: true },
    remarks: { type: String },
    // R7az-D7-HIGH-4: per-administration signature (capped 150KB) so the
    // MAR row carries the authoritative actor signature, not just a name.
    // Pulled server-side from req.user.signature in marController.
    signatureUrl: { type: String, maxlength: [200000, "signatureUrl too large (max 200,000 chars ≈ 150KB)"] },
    // R7bb-FIX-E-19/D3-HIGH-4: High-Alert Medication dual-witness. When
    // the parent med has isHighAlert:true, recordAdministration demands
    // a SECOND nurse identifier; both must hold mar.write and must be
    // different users. Controller enforces — these fields are only
    // populated for HAM doses, NULL otherwise (preserving prior shape).
    administeredByUser1Id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    administeredByUser2Id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    nurse2Name:            { type: String, trim: true, default: "" },
    nurse2StaffId:         { type: String, trim: true, default: "" },
    isHamDose:             { type: Boolean, default: false } },
  { _id: true }
);

const MARMedicationSchema = new mongoose.Schema(
  {
    medicineName: { type: String, required: true, trim: true },
    genericName: { type: String, trim: true },
    dose: { type: String, trim: true },
    unit: { type: String, trim: true },
    route: {
      type: String,
      enum: ["Oral", "IV", "IM", "SC", "SL", "Topical", "Inhalation", "Rectal", "Other"],
      default: "Oral" },
    frequency: { type: String, trim: true },
    scheduledTimes: [{ type: String, trim: true }],
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    prescribedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    prescribedByName: { type: String, trim: true },
    doctorNoteId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorNotes" },
    isHighAlert: { type: Boolean, default: false },
    isLASA: { type: Boolean, default: false },
    specialInstructions: { type: String },
    isActive: { type: Boolean, default: true },
    discontinuedAt: { type: Date },
    discontinuedBy: { type: String },
    discontinueReason: { type: String },
    administrations: [AdministrationEntrySchema] },
  { _id: true }
);

const MARSchema = new mongoose.Schema(
  {
    // ── Patient & Admission ──────────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true },
    UHID: { type: String, required: true, trim: true },
    patientName: { type: String, trim: true },
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission" },
    ipdNo: { type: String, required: true },

    // ── MAR Date ─────────────────────────────────────────────
    date: { type: Date, required: true, index: true },

    // ── Medications ──────────────────────────────────────────
    medications: [MARMedicationSchema],

    // ── Allergy Alert ────────────────────────────────────────
    allergies: [{ type: String, trim: true }],
    allergyAlertAcknowledged: { type: Boolean, default: false },

    // ── Status ───────────────────────────────────────────────
    status: {
      type: String,
      enum: ["ACTIVE", "CLOSED"],
      default: "ACTIVE" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" } },
  { timestamps: true, collection: "medication_administration_records" }
);

MARSchema.index({ UHID: 1, date: -1 });
MARSchema.index({ ipdNo: 1, date: -1 });
MARSchema.index({ admissionId: 1, date: -1 });

// ──────────────────────────────────────────────────────────────
// R7r: Append-only guard for administration entries (NABH MOM.4).
// Once an administration is charted (status=GIVEN / HELD / REFUSED
// etc.), it cannot be edited or removed by the application layer
// — only NEW entries can be appended. This prevents post-hoc
// falsification of dose timing or status. Corrections must be
// recorded as a NEW administration with status + reason; the
// original entry stays in the record.
//
// The hook fires on .save() paths only. findByIdAndUpdate /
// updateMany bypass it — controllers that legitimately need to
// edit an admin entry (e.g. to add `remarks` later) should use
// $push to append a NEW entry instead of mutating existing ones.
// ──────────────────────────────────────────────────────────────
MARSchema.post("init", function () {
  // Snapshot existing administration ids per medication so the
  // pre-save hook can detect mutations vs pure appends.
  this.$__.priorAdmins = {};
  for (const med of (this.medications || [])) {
    if (med?._id && Array.isArray(med.administrations)) {
      this.$__.priorAdmins[String(med._id)] = med.administrations
        .filter(a => a?._id)
        .map(a => ({
          id: String(a._id),
          status: a.status,
          actualTime: a.actualTime ? new Date(a.actualTime).getTime() : null,
          nurseName: a.nurseName,
        }));
    }
  }
});

MARSchema.pre("save", function (next) {
  if (this.isNew) return next();
  const prior = this.$__.priorAdmins || {};
  for (const med of (this.medications || [])) {
    if (!med?._id) continue;
    const existing = prior[String(med._id)];
    if (!existing || !existing.length) continue;
    // For each previously-recorded administration, verify it still
    // exists and its key fields are unchanged.
    for (const oldRec of existing) {
      const live = (med.administrations || []).find(a => String(a?._id) === oldRec.id);
      if (!live) {
        return next(new Error(
          `MAR: cannot remove existing administration ${oldRec.id} — NABH MOM.4 requires append-only audit trail. ` +
          `Record a new administration with a correction status instead.`,
        ));
      }
      const liveTime = live.actualTime ? new Date(live.actualTime).getTime() : null;
      if (live.status !== oldRec.status || liveTime !== oldRec.actualTime || (live.nurseName || "") !== (oldRec.nurseName || "")) {
        return next(new Error(
          `MAR: cannot edit existing administration ${oldRec.id} (status / actualTime / nurseName immutable). ` +
          `NABH MOM.4 — record a new administration row to amend.`,
        ));
      }
    }
  }
  next();
});

module.exports =
  mongoose.models.MAR || mongoose.model("MAR", MARSchema);
