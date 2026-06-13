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
    // R7bi — denormalised ward name. Bed/ward lookups happen in many
    // hot read paths (patient header, charts, pharmacy slips) so we
    // mirror it on the admission at bed-assign / bed-transfer time.
    // The Ward collection remains the source of truth — this is just
    // a snapshot. Legacy admissions populated via wardId fallback in
    // the frontend, and a one-shot backfill on backend boot copies
    // wardName from Ward into Admission.wardName where missing.
    wardName: { type: String, default: "" },
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
    // R7u: expectedDischargeDate must be AFTER admissionDate. Without this
    // a copy-paste typo in the form (e.g. expected = 2026-01-01 vs admitted
    // 2026-05-19) lands in the DB silently and corrupts the LOS forecast.
    expectedDischargeDate: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          // `this.admissionDate` is set by default(Date.now) on new docs;
          // on updates `this` is the query, so fall back to a non-strict check.
          const adm = this.admissionDate || this.get?.("admissionDate") || Date.now();
          return new Date(v).getTime() >= new Date(adm).getTime();
        },
        message: "expectedDischargeDate must be on or after admissionDate",
      },
    },

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
    // R7bd-A-4 / A1-CRIT-5 — fix attendingDoctorId mismatch.
    // HISTORY: the IPD/OPD code base used `attendingDoctorId` as the
    // Doctor model `_id` (set by reception's doctor-picker), but the
    // schema's `ref: "User"` claimed it pointed at the User collection.
    // Most population call-sites compared/populated against Doctor, and
    // the role-based access-control middleware compared against
    // `doctorProfile._id` (the Doctor `_id`). That worked. But the
    // OPDService.createOPDVisit auto-admission path was setting
    // `attendingDoctorId` to `savedOPD.doctorId` (Doctor `_id`) while
    // other paths sometimes passed the login User `_id`, producing
    // intermittent mismatches when the consumer assumed one side or the
    // other. From R7bd-A on:
    //   • `attendingDoctorId`    ALWAYS = Doctor._id (the medical staff
    //     record) — kept for backward compat across all consumers; we
    //     keep the `ref: "User"` here ONLY because legacy data may still
    //     point at User._id (admissionService.createAdmission previously
    //     accepted either). Populate sites pick a target collection by
    //     context; do NOT add `.populate("attendingDoctorId")` without
    //     specifying the model.
    //   • `attendingDoctorUserId` = the linked login User._id (when the
    //     doctor has a User account). This is what termination /
    //     reassignment and JWT-driven access checks should compare
    //     against. Populated alongside `attendingDoctorId` at admission
    //     create time. Null is legitimate for ad-hoc doctors with no
    //     login account.
    attendingDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null },
    attendingDoctorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true },
    // R7bd-A-10 / A1-HIGH-11 — when the attending doctor (User account)
    // is terminated, the userService post-step sets this flag on every
    // Active admission that lost its doctor link. Reception sees a "needs
    // reassignment" banner and must pick a new attending before the next
    // billing cycle. We do NOT block clinical care — the existing
    // attending fields stay pointing at the (now-terminated) user so the
    // audit trail of "who was responsible at time T" is preserved.
    requiresReassignment:        { type: Boolean, default: false, index: true },
    requiresReassignmentReason:  { type: String, trim: true, default: "" },
    requiresReassignmentAt:      { type: Date, default: null },
    // R7bd-A-2 / A1-CRIT-2 — soft-delete trail for admissionService.deleteAdmission.
    // Hard delete of an Admission row is dangerous: billing triggers,
    // doctor orders, MAR rows, lab orders etc. all carry visitId/admissionId
    // refs that orphan silently — clinical history is lost and bills
    // stop reconciling. The service now flips status="Deleted" + stamps
    // these fields instead. The status enum is extended below to allow
    // "Deleted" so the state-machine guard permits the transition.
    deletedAt:    { type: Date, default: null },
    deletedById:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedByName:{ type: String, trim: true, default: "" },
    deleteReason: { type: String, trim: true, default: "" },
    // R7bb-FIX-E-4 / D3-CRIT-4: when the attending doctor is a Junior
    // Resident (designation flag on User.doctorDetails) the discharge
    // summary finalize MUST be co-signed by a Senior Resident /
    // Consultant. The flag is set at admission time by admissionService
    // based on the attendingDoctor's designation; the dischargeSummary
    // finalize endpoint reads it to decide whether to demand a
    // requireSeniorCosign: false explicit acknowledgement.
    mustCosign: { type: Boolean, default: false },
    // Department as ObjectId ref (alongside the string field)
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null },

    status: {
      type: String,
      // R7bd-A-2 / A1-CRIT-2: "Deleted" added as a terminal soft-delete
      // sentinel — replaces the unsafe hard-delete in admissionService.
      // The state-machine guard below treats Deleted as terminal (no
      // further transitions out), mirroring Discharged/Cancelled.
      enum: ["Active", "Discharged", "Transferred", "Cancelled", "Deleted"],
      default: "Active" },

    // ── Billing ──────────────────────────────────────────────
    estimatedCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    advancePaid: { type: Number, default: 0 },

    // ── Discharge workflow (NABH COP.20) ─────────────────────
    actualDischargeDate: Date,
    dischargeNotes: String,
    dischargeSummary: String,
    // R7ap-F37/D5-13: detected overpayment at discharge — Discharge Queue
    // surfaces this for cashier-confirmed refund (auto-write would race
    // with manual collections that haven't hit the DB yet).
    dischargeOverage: { type: Number, default: 0 },
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
      // R7hr-197 discharge rebuild — disposition is the doctor's clinical
      // choice on the discharge summary; the receptionist's bed-clear step
      // executes it. dischargeType drives which NABH register fires (LAMA vs
      // Mortality) and how the bed-clear bill gate behaves (Normal = balance
      // must be 0; LAMA/Death = waiver allowed with a recorded reason).
      dischargeType:       { type: String, enum: ["Routine", "LAMA", "DAMA", "Absconded", "Referral", "Death"], default: "Routine" },
      summaryId:           { type: mongoose.Schema.Types.ObjectId, ref: "DischargeSummary", default: null },
      summaryFinalizedAt:  Date,
      billWaiverReason:    String,   // mandatory reason when LAMA/Death clears with a balance
      dischargedBy:        String,   // JWT actor who issued the final bed-clear/gate-pass
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
    // R7bd-A-7 / A1-HIGH-8 — admissionNumber is now `unique:true sparse:true`.
    // Pre-R7bd OPDService.generateOPDAdmissionNumber used a non-atomic
    // findOne+regex sort which raced under concurrent OPD walk-ins, and
    // the only protection was a non-unique index — two visits could land
    // with the same admissionNumber and silently overwrite each other on
    // downstream lookups. Now the OPD path uses utils/counter
    // (atomic findOneAndUpdate $inc) AND the DB enforces uniqueness so a
    // race-survivor's E11000 surfaces immediately.
    admissionNumber: { type: String, trim: true, unique: true, sparse: true },  // R7ag: IPD-YY-NN continuous, e.g. IPD-26-01 (legacy rows may still use ADM26050001 / IPD-2026-000001)
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

    // R7bh-F1 / R7bg-7-CRIT-2: PrintAudit infrastructure $incs this on
    // every IPDFile / MARSheet print/reprint anchored to the admission.
    // Pre-R7bh Admission had no printCount field → $inc no-op'd, NABH
    // IMS.5 reprint trail incomplete.
    printCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// State-machine guard: delegate to shared registry (R7bf-I / R7bd-D-9
// META reship). Pre-R7bf this model rolled its own LEGAL_STATUS_TRANSITIONS
// table; the registry now lives at utils/statusTransitionGuard.js and the
// matrix here is the source of truth for the Admission collection.
//
// Backward compat: `validateStatusTransition(from, to)` is still exported
// as a function returning a string-or-null (legacy controller paths that
// mutate status via findOneAndUpdate use this). It's now a thin wrapper
// around the shared assertTransition().
//
// Force-bypass: callers can set doc.__forceTransition + doc.__forceAdminUserId
// on the in-memory doc before save() to bypass; the soft-delete path
// (admissionService.deleteAdmission) already does this.
const { assertTransition: _admAssert, LEGAL_TRANSITIONS: _LT } = require("../../utils/statusTransitionGuard");

// Legacy shape — Set-of-allowed-targets per state, including self-loop.
const LEGAL_STATUS_TRANSITIONS = Object.fromEntries(
  Object.entries(_LT.Admission || {}).map(([from, list]) => [from, new Set([from, ...list])]),
);

function validateStatusTransition(from, to) {
  if (!from || from === to) return null; // no-op move always allowed
  try {
    _admAssert("Admission", from, to);
    return null;
  } catch (e) {
    return e.message;
  }
}

AdmissionSchema.pre("save", function (next) {
  if (this.isNew) return next();
  if (!this.isModified("status")) return next();
  const prev = this.$__.originalStatus;
  if (!prev) return next();
  try {
    _admAssert("Admission", prev, this.status, {
      force: !!this.__forceTransition,
      adminUserId: this.__forceAdminUserId || null,
    });
    next();
  } catch (e) { next(e); }
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

// R7bo-Bug-A — UNIQUENESS GUARD: at most ONE Active admission per UHID.
// ─────────────────────────────────────────────────────────────────────
// Bug-A history: pre-R7bd-A-6 the admissionService.createAdmission guard
// only blocked bed-on-bed double-admit; OPDService.createOPDVisit and
// emergencyService (ER→IPD bridge) both call Admission.create() directly
// without the per-patient guard. Result: a patient could land in the DB
// with TWO `status:"Active"` rows (one OPD + one IPD, or two OPD on
// different days, or a legacy IPD + a new ER-bridge IPD) — and different
// frontend pages, querying with different filters, would each pick a
// different one as "the active admission". Doctor Notes and Nursing
// Notes would disagree on which admission the patient was on, orders
// placed against one wouldn't show in the other.
//
// The application-level guard at admissionService.createAdmission lines
// 82-97 catches the IPD path (R7bd-A-6). The schema-level guard here
// closes the OPD + emergencyService back doors AND every future
// admission-creation path that may be added — the DB itself refuses
// the second insert with E11000, no matter how it was reached.
//
// PARTIAL FILTER: only enforced when status==="Active" — discharged /
// cancelled / transferred / deleted history rows are unconstrained, so
// legitimate readmissions (after the prior admission is moved to
// Discharged/Cancelled) work as before. Multiple historical rows per
// UHID are exactly what the patient history modal needs.
//
// ROLLOUT: requires Mongoose syncIndexes() on boot to materialise the
// partial index on the existing collection. The pre-existing duplicates
// must be cleaned up first (see scripts/dedupeActiveAdmissions.js) —
// otherwise syncIndexes() will fail with E11000 on the duplicate keys
// and the boot will log a warning. Once dedupe runs, the index is built.
AdmissionSchema.index(
  { UHID: 1, status: 1 },
  {
    name: "uniq_active_admission_per_uhid",
    unique: true,
    partialFilterExpression: { status: "Active" },
  },
);

// R7bo-Bug-A — defense-in-depth pre("save") guard. The partial unique
// index above is the DB-level safety net; this hook catches the race
// BEFORE the insert hits the wire, so callers get a clean 409-style
// error with a clear message instead of a raw E11000. Two requests
// landing in the same millisecond can still both pass this hook and
// race to the DB — only the index catches that case — but in practice
// 99% of duplicate-create attempts come from sequential code paths
// (OPD then ER, or admission UI fast-clicked twice) and this hook
// gives them a helpful error.
AdmissionSchema.pre("save", async function (next) {
  if (!this.isNew) return next();
  if (this.status !== "Active") return next();
  if (!this.UHID) return next();
  try {
    const existing = await this.constructor.findOne({
      UHID: this.UHID,
      status: "Active",
      _id: { $ne: this._id },
    }).select("_id admissionNumber admissionType hasBed").lean();
    if (existing) {
      // R7en-OPD-BLOCKER-FIX (mirror of admissionService): if existing
      // is OPD bedless and the incoming admission is a hospitalising
      // one (IPD / Emergency / Daycare with bed), auto-close the OPD
      // and proceed. OPD visits are out-patient interactions, not
      // hospital admissions, and shouldn't block IPD/ER intake.
      const incomingType = this.admissionType || "IPD";
      const incomingHasBed = !!this.bedId || incomingType === "IPD"
        || incomingType === "Emergency" || incomingType === "Daycare";
      const isStaleOpdBlocker =
        existing.admissionType === "OPD" && !existing.hasBed
        && incomingType !== "OPD" && incomingHasBed;

      if (isStaleOpdBlocker) {
        await this.constructor.updateOne(
          { _id: existing._id, status: "Active" },
          {
            $set: {
              status: "Discharged",
              actualDischargeDate: new Date(),
              dischargeNotes: `Auto-closed by incoming ${incomingType} admission (R7en-OPD-BLOCKER-FIX)`,
            },
          },
        );
        return next();
      }

      const err = new Error(
        `Patient ${this.UHID} already has an active admission ` +
        `(${existing.admissionNumber}, ${existing.admissionType}${existing.hasBed ? ", bedded" : ", bedless"}). ` +
        `Discharge or cancel it before creating a new admission.`,
      );
      err.status = 409;
      err.code   = "PATIENT_HAS_ACTIVE_ADMISSION";
      return next(err);
    }
    next();
  } catch (e) {
    // Lookup failure shouldn't block creation outright — the index
    // catches the race; surface the read error so logs show it.
    console.warn("[Admission] uniqueness pre-save check failed:", e.message);
    next();
  }
});
// R7t: Discharge queue / "Discharged Today" tab + R7i MRD-page query
// (status=Discharged + dischargedSince) — without this compound, every
// page load scans the entire admissions collection.
AdmissionSchema.index({ status: 1, actualDischargeDate: -1 });
// Discharge workflow queue uses dischargeWorkflow.stage. Speeds up the
// /admissions/discharge-queue endpoint.
AdmissionSchema.index({ "dischargeWorkflow.stage": 1, "dischargeWorkflow.gatePassIssuedAt": -1 });

const AdmissionModel =
  mongoose.models.Admission || mongoose.model("Admission", AdmissionSchema);

// R7bd-A-13 — expose the status-transition validator for controllers that
// mutate status via findOneAndUpdate (which bypasses pre("save")).
// Default export remains the model so existing `require("./admissionModel")`
// keeps working. Named export `validateStatusTransition` available via
// `const { validateStatusTransition } = require("../models/Patient/admissionModel");`.
AdmissionModel.validateStatusTransition = validateStatusTransition;
AdmissionModel.LEGAL_STATUS_TRANSITIONS = LEGAL_STATUS_TRANSITIONS;
module.exports = AdmissionModel;
module.exports.validateStatusTransition = validateStatusTransition;
module.exports.LEGAL_STATUS_TRANSITIONS = LEGAL_STATUS_TRANSITIONS;
