// models/Patient/admissionModel.js
// ✅ CHANGES:
//   - bedId is now OPTIONAL (Emergency/OPD can register without bed)
//   - department is now optional (String or ObjectId ref)
//   - reasonForAdmission is now optional
//   - admissionType includes "OPD" and "Services" types
//   - hasBed flag added for quick filtering
//   - treatmentTeam added for multi-doctor consultation (NABH COP.1)

const mongoose = require("mongoose");

/* ── Treatment Team Member (NABH COP.1 — Multi-disciplinary care) ── */
const TreatmentTeamMemberSchema = new mongoose.Schema(
  {
    doctorId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    doctorName:  { type: String, required: true, trim: true },
    department:  { type: String, trim: true, default: "" },
    departmentId:{ type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    specialization: { type: String, trim: true, default: "" },

    role: {
      type: String,
      enum: ["Primary Consultant", "Co-Consultant", "Consulting Specialist",
             "Physiotherapist", "Dietician", "Other"],
      default: "Consulting Specialist" },

    // Who added this consultant and when
    addedBy:     { type: String, trim: true, default: "" },   // Primary doctor name
    addedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    addedAt:     { type: Date, default: Date.now },

    // Reason for requesting consultation
    reason:      { type: String, trim: true, default: "" },
    urgency:     { type: String, enum: ["Routine", "Urgent", "Emergent"], default: "Routine" },

    // Consulting doctor's response / notes
    consultationNotes: { type: String, trim: true, default: "" },
    notesUpdatedAt:    { type: Date },
    notesUpdatedBy:    { type: String, trim: true, default: "" },

    status: {
      type: String,
      enum: ["Pending", "Active", "Completed", "Declined"],
      default: "Active" } },
  { timestamps: true },
);

const TransferHistorySchema = new mongoose.Schema(
  {
    fromBed: { type: mongoose.Schema.Types.ObjectId, ref: "Beds" },
    toBed: { type: mongoose.Schema.Types.ObjectId, ref: "Beds" },
    reason: String,
    date: { type: Date, default: Date.now } },
  { _id: false },
);

const AdmissionSchema = new mongoose.Schema(
  {
    // ── Patient Info ─────────────────────────────────────────
    UHID: {
      type: String,
      required: [true, "UHID is required"],
      trim: true },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: [true, "Patient ID is required"] },
    patientName: {
      type: String,
      required: [true, "Patient name is required"],
      trim: true },
    contactNumber: {
      type: String,
      required: [true, "Contact number is required"] },
    email: String,

    // ── Bed Info (OPTIONAL — Emergency/OPD may not have bed) ──
    bedId: { type: mongoose.Schema.Types.ObjectId, ref: "Beds", default: null },
    bedNumber: { type: String, default: "" },
    roomNumber: { type: String, default: "" },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null },
    wardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ward",
      default: null },
    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Floor",
      default: null },
    buildingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
      default: null },

    // ✅ Flag: does this admission have a bed allocated?
    hasBed: { type: Boolean, default: false },

    // ── Clinical Info ────────────────────────────────────────
    // department can be ObjectId or plain string
    department: { type: String, trim: true, default: "" },

    admissionDate: {
      type: Date,
      default: Date.now,
      required: true },
    expectedDischargeDate: Date,

    reasonForAdmission: { type: String, default: "" }, // ✅ No longer required
    // Free-text clinical context captured at admission
    provisionalDiagnosis: { type: String, default: "" },
    specialInstructions:  { type: String, default: "" },
    expectedStayDays:     { type: Number, default: 0 },
    // ER-specific intake fields (only set when admissionType === Emergency)
    isMLC:         { type: Boolean, default: false },
    mlcNumber:     { type: String, default: "" },
    triageLevel:   { type: String, default: "" },
    erType:        { type: String, default: "" },
    modeOfArrival: { type: String, default: "" },
    broughtBy:     { type: String, default: "" },

    admissionType: {
      type: String,
      // ✅ Added OPD, Daycare, Services
      enum: [
        "Emergency",
        "Planned",
        "Transfer",
        "Day Care",
        "OPD",
        "Daycare",
        "Services",
      ],
      default: "Emergency" },

    attendingDoctor: { type: String, trim: true, default: "" },
    // ObjectId ref to the User (role=Doctor) who is the attending doctor
    // Used for strict IPD file access control
    attendingDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null },
    // Department as ObjectId ref (alongside the string field)
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null },

    status: {
      type: String,
      enum: ["Active", "Discharged", "Transferred", "Cancelled"],
      default: "Active" },

    // ── Billing ──────────────────────────────────────────────
    estimatedCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    advancePaid: { type: Number, default: 0 },

    // ── Discharge workflow (NABH COP.20) ─────────────────────
    actualDischargeDate: Date,
    dischargeNotes: String,
    dischargeSummary: String,
    conditionOnDischarge: {
      type: String,
      enum: ["Stable", "Improved", "Critical", "LAMA", null],
      default: null },
    followUpInstructions: String,
    // Receptionist-controlled clearance flow
    dischargeWorkflow: {
      // doctor → bill clearance → gate pass → discharged
      stage: { type: String, enum: ["NotRequested", "DoctorApproved", "BillCleared", "GatePassIssued", "Completed"], default: "NotRequested" },
      doctorApprovedAt:    Date,
      doctorApprovedBy:    String,
      billClearedAt:       Date,
      billClearedBy:       String,
      finalBillNumber:     String,
      finalBillAmount:     { type: Number, default: 0 },
      gatePassNumber:      String,
      gatePassIssuedAt:    Date,
      gatePassIssuedBy:    String,
      // R7i: Same-day discharge undo (Admin override). Populated by
      // POST /admissions/:id/reactivate when an admin re-activates a
      // patient within 24h of discharge. The audit trail travels with
      // the admission so MRD / NABH auditors can see exactly why a
      // closed discharge was reopened, by whom, and when.
      reactivatedAt:       Date,
      reactivatedBy:       String,
      reactivationReason:  String,
    },

    // ── Cancel ───────────────────────────────────────────────
    cancelReason: String,
    cancelledAt: Date,

    // ── Transfer history ─────────────────────────────────────
    transferHistory: [TransferHistorySchema],

    // ── Admission / Visit Number ──────────────────────────────
    admissionNumber: { type: String, trim: true, index: true },  // e.g. ADM-20240417-0001
    visitNumber:     { type: String, trim: true, index: true },  // OPD visitNumber link
    paymentType:     { type: String, enum: ["GENERAL","TPA","CORPORATE","CASH"], default: "GENERAL" },

    // ── Treatment Team (NABH COP.1 — Multi-disciplinary consultation) ──
    // Primary consultant is attendingDoctor/attendingDoctorId.
    // Additional consultants are tracked here.
    treatmentTeam: { type: [TreatmentTeamMemberSchema], default: [] },

    // ── Initial Assessment Gate (NABH COP.2) ─────────────────────────
    // Both doctor AND nurse must complete initial assessment before
    // accessing other patient records. Set to true after sign-off.
    initialAssessment: {
      doctorCompleted:   { type: Boolean, default: false },
      nurseCompleted:    { type: Boolean, default: false },
      doctorCompletedAt: { type: Date, default: null },
      nurseCompletedAt:  { type: Date, default: null },
      doctorName:        { type: String, default: "" },
      nurseName:         { type: String, default: "" } },

    // Full nurse initial-assessment payload (vitals, history, sign-off).
    // Stored as Mixed so the NABH-required free-text + structured fields
    // both round-trip without a deep schema declaration.
    nurseInitialAssessment: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── ANH PACKAGE BINDING ───────────────────────────────────────────
    // When an admission's diagnosis matches a ServiceMaster PACKAGE row
    // (via diagnosisTags), the matcher snaps that package onto the
    // admission so:
    //   * onAdmissionCreated fires a single PKG-* trigger immediately
    //     (one-time charge for surgical packages, day-1 charge for MMP).
    //   * runDailyBedChargeAccrual fires the package PER_DAY rate
    //     instead of separate BED-/NURSING-/INVESTIGATION- triggers
    //     while day-N ≤ maxLOSDays.
    //   * After maxLOSDays the admission falls back to non-package
    //     room + nursing + per-investigation billing.
    // Empty when no package matched (default flow continues).
    package: {
      serviceCode:        { type: String, trim: true, default: null },   // e.g. "PKG-MED-MMP-2"
      serviceId:          { type: mongoose.Schema.Types.ObjectId, ref: "ServiceMaster", default: null },
      packageName:        { type: String, trim: true, default: null },
      packageType:        { type: String, enum: ["PER_DAY", "PER_PROCEDURE", null], default: null },
      tierUsed:           { type: String, enum: ["generalWard", "semiPrivate", "private", null], default: null },
      unitPrice:          { type: Number, default: 0, min: 0 },          // snap-at-attach price for audit
      maxLOSDays:         { type: Number, default: 0, min: 0 },          // 0 = uncapped
      attachedAt:         { type: Date,   default: null },
      attachedBy:         { type: String, default: null },
      matchedDiagnosis:   { type: String, default: null },               // diagnosis text that triggered match
      matchScore:         { type: Number, default: 0 },                  // for debugging / audit
      autoAttached:       { type: Boolean, default: false },             // true = matcher fired; false = manual
    },
  },
  { timestamps: true },
);

// State-machine guard: enforce legal status transitions. Without this any
// caller can flip status from a terminal state back to Active (silently
// reopening a Discharged or Cancelled admission), or skip the discharge
// workflow entirely.
//   ──> Active is the only non-terminal state.
//   ──> Discharged / Cancelled are TERMINAL — no exit.
//   ──> Transferred can return to Active (resumed care on a new bed).
const LEGAL_STATUS_TRANSITIONS = {
  Active:      new Set(["Active", "Discharged", "Transferred", "Cancelled"]),
  Transferred: new Set(["Transferred", "Active", "Discharged", "Cancelled"]),
  Discharged:  new Set(["Discharged"]),
  Cancelled:   new Set(["Cancelled"]),
};
AdmissionSchema.pre("save", function (next) {
  if (this.isNew) return next();
  if (!this.isModified("status")) return next();
  const prev = this.$__.originalStatus;
  // We stored the original status in post('init'); if missing (manual
  // construct), skip the check — there's no baseline to compare to.
  if (!prev) return next();
  const allowed = LEGAL_STATUS_TRANSITIONS[prev];
  if (allowed && !allowed.has(this.status)) {
    return next(
      new Error(
        `Illegal admission status transition: ${prev} → ${this.status}. ` +
          `From "${prev}", allowed states are: ${[...allowed].join(", ")}.`,
      ),
    );
  }
  next();
});
AdmissionSchema.post("init", function () {
  // Snapshot the loaded status so pre('save') can detect mutations.
  this.$__.originalStatus = this.status;
});

// Indexes
AdmissionSchema.index({ UHID: 1 });
AdmissionSchema.index({ patientId: 1 });
AdmissionSchema.index({ bedId: 1 });
AdmissionSchema.index({ department: 1 });
AdmissionSchema.index({ status: 1 });
AdmissionSchema.index({ admissionDate: -1 });
AdmissionSchema.index({ admissionType: 1 });
AdmissionSchema.index({ attendingDoctor: 1 });
AdmissionSchema.index({ hasBed: 1 });

module.exports =
  mongoose.models.Admission || mongoose.model("Admission", AdmissionSchema);
