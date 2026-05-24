const mongoose = require("mongoose");

/* ──────────────────────────────────────────────
   NABH High Alert Medication (HAM) auto-list
   Source: NABH MOM.9, WHO HAM list 2023
────────────────────────────────────────────── */
const HAM_KEYWORDS = [
  "insulin","heparin","enoxaparin","fondaparinux","warfarin","acenocoumarol",
  "digoxin","amiodarone","lidocaine","lignocaine",
  "kcl","potassium chloride","potassium phosphate",
  "nacl 3%","hypertonic saline","concentrated sodium",
  "magnesium sulphate","mgso4","calcium chloride","cacl",
  "dextrose 25%","dextrose 50%","d50","d25",
  "morphine","fentanyl","pethidine","hydromorphone","oxycodone","tramadol iv",
  "noradrenaline","norepinephrine","adrenaline","epinephrine",
  "dopamine","dobutamine","vasopressin","milrinone","levosimendan",
  "suxamethonium","succinylcholine","vecuronium","rocuronium","atracurium","cisatracurium",
  "streptokinase","alteplase","tenecteplase","reteplase",
  "methotrexate","cyclophosphamide","cisplatin","vincristine","doxorubicin",
  "oxytocin","ergometrine",
  "nitroprusside","nitroglycerine","glyceryl trinitrate",
  "ketamine","propofol","thiopentone","midazolam iv",
  "phenobarbitone","phenytoin iv","levetiracetam iv",
  "vancomycin iv","gentamicin iv","amikacin iv",
];
const isHAM = (name = "") => HAM_KEYWORDS.some(k => name.toLowerCase().includes(k));

/* ────────────── Sub-schemas ────────────── */

// Each scheduled dose administration event (NABH MAR)
const AdminRecordSchema = new mongoose.Schema({
  scheduledTime:  { type: String },          // "08:00", "14:00" etc.
  scheduledDate:  { type: Date },
  status: {
    type: String,
    // R7bq-J1 — "missed" added for the daily missed-dose cron + EOD sweep.
    // NABH MOM.4 distinction: "skipped" = nurse made a clinical decision to
    // skip (held/refused/clinical reason), "missed" = system observed that
    // the scheduled window passed with no record at all. Both close the
    // dose for completion-check purposes.
    enum: ["pending","given","hold","not_available","delayed","skipped","refused","partial","missed"],
    default: "pending",
  },
  givenAt:        { type: Date },
  givenBy:        { type: String },           // nurse name
  givenByRole:    { type: String, default: "Nurse" },
  doseGiven:      { type: String },           // actual dose if different from ordered
  routeUsed:      { type: String },
  siteUsed:       { type: String },           // injection site
  notes:          { type: String },
  // HAM two-nurse verification
  verifiedBy:     { type: String },           // second nurse (required for HAMs)
  verifiedAt:     { type: Date },
  fiveRightsChecked: { type: Boolean, default: false },
  // Hold / delay
  holdReason:     { type: String },
  holdUntil:      { type: String },
  delayedTo:      { type: String },
  delayReason:    { type: String },
  // PRN/SOS effectiveness
  prnEffect:      { type: String, enum: ["effective","partial","no_effect",""], default: "" },
  prnReassessTime:{ type: String },
  // Adverse event
  adverseEvent:   { type: Boolean, default: false },
  adverseDetails: { type: String },
  // STAT / Emergency dose (given outside the scheduled window)
  isStatDose:     { type: Boolean, default: false },
  statReason:     { type: String },
  nextDoseAdjustedAt: { type: String }, // "HH:MM" — recalculated from STAT givenAt
}, { _id: false, timestamps: false });

// Infusion rate change log
const RateChangeSchema = new mongoose.Schema({
  changedAt:   { type: Date, default: Date.now },
  changedBy:   { type: String, required: true },
  oldRate:     { type: String },
  newRate:     { type: String, required: true },
  reason: {
    type: String,
    enum: [
      "Clinical condition change","Doctor order","Haemodynamic instability",
      "Fluid overload","Renal impairment","Hypotension","Hypertension",
      "Infusion complete — rate reduced","Titration protocol","Patient complaint",
      "Extravasation — site changed","Pump malfunction","Other"
    ],
    default: "Doctor order",
  },
  reasonDetail:  { type: String },
  verifiedBy:    { type: String },          // second nurse for HAM infusions
  doctorInformed:{ type: Boolean, default: false },
  doctorName:    { type: String },
}, { _id: false });

// Infusion nursing monitoring entry
const InfusionMonitorSchema = new mongoose.Schema({
  time:          { type: Date, default: Date.now },
  nurse:         { type: String, required: true },
  currentRate:   { type: String },
  bp:            { type: String },
  pulse:         { type: String },
  spo2:          { type: String },
  urineOutput:   { type: String },
  volumeInfused: { type: String },
  siteCondition: { type: String, enum: ["Patent","Swollen","Leaking","Phlebitis","Changed",""], default: "" },
  action:        { type: String, enum: ["No Change","Rate Increased","Rate Decreased","Infusion Stopped","Site Changed","Doctor Informed",""], default: "No Change" },
  remarks:       { type: String },
}, { _id: false });

/* ────────────── Main Schema ────────────── */
const DoctorOrderSchema = new mongoose.Schema({
  UHID:      { type: String, required: true, index: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
  patientName: String,
  visitId:   String,
  visitType: { type: String, enum: ["OPD","IPD","Emergency","DayCare"], default: "IPD" },

  // R7bv — Clinical linkage to the parent admission. Pre-R7bv these three
  // fields did NOT exist on the schema; strict-mode Mongoose silently
  // stripped them on every .create() / .insertMany(), even though every
  // POST /doctor-orders save path in the frontend was sending them. As a
  // result the patient-history aggregator (which filters DoctorOrder by
  // `{ $or: [{admissionId}, {ipdNo}] }`) could never see standalone
  // doctor orders for an active admission — the 16 orders for
  // ADM26050002 were unreachable until this round.
  //
  // We add the fields here, then doctorOrderRoutes.POST normalises them
  // from UHID + active Admission lookup so existing front-end payloads
  // (which may carry only UHID + visitId for the legacy OPD path) still
  // land on a fully-linked document.
  admissionId:     { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true, default: null },
  ipdNo:           { type: String, index: true, default: null },
  admissionNumber: { type: String, index: true, default: null }, // mirror of ipdNo for newer admissions

  orderType: {
    type: String,
    enum: [
      "Medication","IV_Fluid","Lab","Radiology","Investigation",
      "Procedure","BloodTransfusion","Diet","Oxygen","Physiotherapy",
      "Activity","Nursing","Consultation",
    ],
    required: true,
  },
  priority: { type: String, enum: ["Routine","Urgent","STAT"], default: "Routine" },

  /* ── NABH High Alert Medication flags ── */
  hamFlag:               { type: Boolean, default: false },       // auto-set on save
  concentratedElectrolyte:{ type: Boolean, default: false },
  twoNurseRequired:      { type: Boolean, default: false },       // derived from hamFlag
  highRisk:              { type: Boolean, default: false },

  orderDetails: {
    // Medication / IV Fluid / Blood fields
    // `dose` is `String` because real prescriptions write "500 mg", "1 unit",
    // "5 ml" etc. — but plain String accepted "", "abc", "-500mg" silently
    // (audit A-01). The validator below enforces the format
    // "<positive number><whitespace><unit>" with a known unit list. Empty /
    // negative / non-numeric values now fail Mongoose validation.
    medicineName: String,
    dose: {
      type: String,
      trim: true,
      validate: {
        // Empty allowed (some non-medication orders have no dose). Otherwise
        // require a STRICTLY POSITIVE amount followed by a known unit. The
        // post-unit anchor accepts either a word boundary OR a "/" so
        // weight-based ratios like "1.5 mg/kg/day" pass cleanly. "0 mg" is
        // rejected by the lookahead.
        validator: (v) => {
          if (v == null || v === "") return true;
          if (!/^\s*\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|kg|ml|l|iu|u|units?|drops?|tabs?|caps?|puffs?|sprays?|patch(?:es)?|tsp|tbsp|%)(?:[\s\/]|$)/i.test(v)) return false;
          // Lookahead-style zero rejection: extract the leading numeric and
          // ensure it's > 0. Catches "0 mg", "0.0 ml", "00 IU".
          const num = parseFloat(v);
          return Number.isFinite(num) && num > 0;
        },
        message: (props) => `dose "${props.value}" must be a positive amount + unit (e.g. "500 mg", "1.5 mg/kg/day")`,
      },
    },
    frequency: String, duration: String, route: String,
    rate: String, accessSite: String, additives: String,
    dilution: String, totalVolume: String, titrationGoal: String, startTime: String,
    // R7bq-1 / R7bq-3 — IV Medication dilution.
    //   dilutionVolume     = number of ml of diluent for each dose
    //   dilutionFluid      = which diluent (NS 0.9% / RL / D5W / etc.) — separate
    //                        from the legacy free-text `dilution` so we can
    //                        write a structured ml number to the I/O ledger
    //                        when the nurse marks a dose given.
    //   infuseOverMinutes  = how long to push/drip the diluted dose (min)
    dilutionVolume:    { type: Number, default: null, min: 0, max: 5000 },
    dilutionFluid:     { type: String, default: "" },
    infuseOverMinutes: { type: Number, default: null, min: 0, max: 720 },
    // Blood Transfusion
    bloodGroup: String, crossMatchDone: String, premeds: String, monitoring: String,
    // Investigation / Radiology fields
    testName: String, urgency: String, instructions: String,
    sampleType: String, fasting: String,
    region: String, contrast: String, sedation: String, laterality: String,
    // Procedure fields
    procedureName: String,
    procedureType: { type: String, enum: ["Minor","Major","Diagnostic","Therapeutic","Bedside"] },
    indication: String, estimatedDuration: String, anaesthesia: String, position: String,
    consentRequired: { type: Boolean, default: false },
    // R7bx — OT-bound procedure fields. Surface to the schema so the
    // NABH COP.10 OT-register emitter can read them off the persisted
    // order. Pre-R7bx Mongoose strict-mode stripped these silently and
    // the OT register stayed empty for every scheduled case.
    requiresOT:       { type: Boolean, default: false, index: true },
    otTheatre:        String,                  // OT-1 / OT-2 / Minor OT
    surgeryName:      String,                  // explicit surgery title (vs procedureName)
    surgicalSpeciality: String,
    surgeonName:      String,
    surgeonId:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    anaesthetistName: String,
    anaesthetistId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    anaesthesiaType:  { type: String, enum: ["", "General", "Spinal", "Epidural", "Regional", "Local", "MAC", "Sedation", "Combined"], default: "" },
    asaGrade:         { type: String, enum: ["", "I", "II", "III", "IV", "V", "VI"], default: "" },
    emergencyCase:    { type: Boolean, default: false },
    // Diet fields
    dietType: String, calories: String, protein: String, fluidRestriction: String, consistency: String,
    // Oxygen fields
    deliveryDevice: String, flowRate: String, fio2: String, targetSpo2: String, hfncFlow: String,
    // Physiotherapy fields
    ptType: String, goals: String, precautions: String,
    // Activity fields
    activityLevel: String, assistanceLevel: String, restrictions: String,
    // Nursing fields
    instruction: String, careCategory: String,
    // Consultation fields
    speciality: String, consultantName: String, reason: String, referredBy: String,
    // Common
    notes: String, displayName: String,
  },

  orderedBy:     String,
  orderedByRole: { type: String, default: "Doctor" },
  orderedAt:     { type: Date, default: Date.now },

  // R7bq-J1 — course window. Set at order creation by parsing
  // `orderDetails.duration` ("5 days", "1 week", etc). Used by the
  // completion check to refuse "Completed" until the course window has
  // actually closed (`endDate <= startOfToday`). Legacy orders without
  // endDate fall back to the pre-J1 behaviour (terminal-status-only check).
  courseDays:    { type: Number, default: null, min: 0, max: 90 },
  endDate:       { type: Date, default: null, index: true },

  // R7az-CRIT-4 / R7az-HIGH-6 / R7az-MED-1 (D6-CRIT-4, D6-HIGH-6, D6-MED-1):
  // Order status. "Active" is the canonical alias for "Pending+Acknowledged"
  // in the doctor-orders UI; we accept both for backward-compat with the
  // existing route handlers. "Held" was a dead duplicate of "OnHold" —
  // removed in R7az to keep the state-machine matrix unambiguous. Any
  // legacy doc still carrying status:"Held" will be coerced to "OnHold"
  // by the pre-save hook below before the state-machine guard runs.
  status: {
    type: String,
    enum: ["Pending","Acknowledged","Active","InProgress","Completed","Cancelled","OnHold","Stopped","Modified"],
    default: "Pending",
    index: true,
  },

  /* ── Nursing administration record (NABH MAR) ── */
  administrationRecord: [AdminRecordSchema],

  /* ── Infusion-specific nursing tracking ── */
  rateChanges:        [RateChangeSchema],
  infusionMonitoring: [InfusionMonitorSchema],
  currentRate:        { type: String },     // live rate (updated on rate change)
  infusionStarted:    { type: Date },
  infusionStopped:    { type: Date },
  stopReason:         { type: String },

  // R7bq-L — when an IV_Fluid order is restarted as a fresh bag (POST
  // /:id/restart), the new clone carries `parentOrderId` + `restartedFrom`
  // pointing back to the previous bag. Used to render a "continued from bag
  // #1" trail on the infusion card so the nurse can see lineage at a glance.
  parentOrderId:  { type: mongoose.Schema.Types.ObjectId, ref: "DoctorOrder", default: null, index: true },
  restartedFrom:  { type: mongoose.Schema.Types.ObjectId, ref: "DoctorOrder", default: null },

  acknowledgedBy: String,
  acknowledgedAt: Date,
  completedBy:    String,
  completedAt:    Date,
  nurseNotes:     String,

  // R7az-MED-3 (D10-MED-3): verbal-order scaffold. When the consultant
  // is unavailable (phone-order during a code, off-site weekend round),
  // a nurse can enter the order on the consultant's behalf with
  // `isVerbal:true` and `verbalEnteredBy` stamped to herself. The
  // consultant later co-signs (NABH ROM.7c requires within 24h) — that
  // flips `coSignedBy` + `coSignedAt`. Without co-sign within the
  // window, the order is flagged for governance review. The 24h cron
  // hasn't been wired yet — it's a feature, not a bug — but the schema
  // shape is ready for it.
  // TODO: enforce 24h cosign window via cron (R7az-MED-3)
  isVerbal:         { type: Boolean, default: false, index: true },
  verbalEnteredBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  verbalEnteredAt:  { type: Date },
  coSignedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  coSignedAt:       { type: Date },

  consentStatus: {
    type: String,
    enum: ["NotRequired","Pending","Obtained","Declined"],
    default: "NotRequired",
  },
  consentData: {
    obtainedAt: Date, obtainedBy: String,
    fingerprintHash: String, fingerprintVerified: { type: Boolean, default: false },
    webAuthnCredentialId: String,
    witnessName: String, guardianName: String, guardianRelation: String, notes: String,
  },

  // Step-based audit trail (matches NABH order workflow)
  auditLog: [{
    step:   { type: String, required: true },
    doneBy: { type: String, required: true },
    doneAt: { type: Date, default: Date.now },
    notes:  { type: String },
  }],
  currentStepIndex: { type: Number, default: -1 },

  // R7bh-F1 / R7bg-7-CRIT-2: PrintAudit infrastructure $incs this on
  // every doctor-order-sheet print/reprint. Pre-R7bh DoctorOrder had
  // no printCount field, so $inc no-op'd → no DUPLICATE watermark on
  // MAR / order-sheet reprints (NABH MOM.2 evidence gap).
  printCount: { type: Number, default: 0 },

}, { timestamps: true, collection: "doctor_orders" });

/* ── Auto-set hamFlag before save ── */
DoctorOrderSchema.pre("save", function (next) {
  const name = this.orderDetails?.medicineName || this.orderDetails?.displayName || "";
  if (name && !this.hamFlag) {
    this.hamFlag = isHAM(name);
    this.twoNurseRequired = this.hamFlag;
    this.highRisk = this.hamFlag;
  }
  next();
});

/* ── R7az-CRIT-4 / D6-CRIT-4 + D6-HIGH-6 + D6-MED-1 ──────────────────
   State-machine guard. Pre-R7az nothing prevented a route handler from
   moving a Cancelled order back to Active, or flipping a Stopped order
   to InProgress and quietly re-administering — a CRITICAL governance
   gap. This hook captures the prior status on init and rejects any
   transition that isn't in the allowed matrix below. Admin override
   path uses `this._stateOverride = "admin"` (the route handler sets
   this when an Admin user explicitly requests a terminal-reopen).

   The matrix lives here (not in the controller) so every write path —
   route handler, service method, cron, migration — gets the same
   guarantee. Modified means "the doctor edited the order details
   in-flight" — kept reachable from Active and InProgress.

   Legacy doc cleanup: status:"Held" → coerced to "OnHold" before
   matrix check, so old data doesn't break post-deploy.
─────────────────────────────────────────────────────────────────────── */
// R7bf-I / A7-HIGH-5 — DoctorOrder state-machine matrix is now sourced
// from the shared registry (utils/statusTransitionGuard.js). The local
// copy here is kept as a fallback (only used if the require fails — e.g.
// circular-load in some unit-test bootstrap) so the model still self-
// contains a sane matrix. The shared registry tightens Completed → []
// (was previously [Modified]) — pre-R7bf a nurse / lab path could
// "amend" an executed medication order which re-fired MAR scheduling
// and was a documented re-administration risk. Now Completed is
// terminal; amendments require the admin force flag + audit row.
let SHARED = null;
try { SHARED = require("../../utils/statusTransitionGuard"); } catch (_) { /* fallback */ }
const ALLOWED_TRANSITIONS = (SHARED && SHARED.LEGAL_TRANSITIONS.DoctorOrder) || {
  Pending:     ["Acknowledged","Active","InProgress","OnHold","Stopped","Cancelled","Completed","Modified"],
  Acknowledged:["Active","InProgress","OnHold","Stopped","Cancelled","Completed","Modified"],
  Active:      ["InProgress","OnHold","Stopped","Cancelled","Completed","Modified"],
  InProgress:  ["Completed","OnHold","Stopped","Cancelled","Modified"],
  OnHold:      ["Active","InProgress","Stopped","Cancelled"],
  Stopped:     [],
  Cancelled:   [],
  Completed:   [],
  Modified:    ["Active","InProgress","Stopped","Cancelled","Completed"],
};

// Snapshot prior status at load time so the next save can validate the
// transition. We can't read `this.status` post-mutation to know what it
// _was_ — Mongoose only knows the current value.
DoctorOrderSchema.post("init", function () {
  this._priorStatus = this.status;
});

DoctorOrderSchema.pre("save", function (next) {
  // Legacy "Held" coercion — old data wrote "Held"; new enum says "OnHold".
  if (this.status === "Held") this.status = "OnHold";
  if (this._priorStatus === "Held") this._priorStatus = "OnHold";

  // First-save / no prior — anything goes (creation).
  if (this.isNew || !this._priorStatus) return next();
  if (this._priorStatus === this.status) return next(); // unchanged
  if (this._stateOverride === "admin") {
    // Admin explicitly bypassed the matrix. Log so the audit trail
    // shows _why_ a terminal state was re-opened.
    console.warn(`[DoctorOrder] ADMIN state override ${this._priorStatus} → ${this.status} for order ${this._id}`);
    return next();
  }
  const allowed = ALLOWED_TRANSITIONS[this._priorStatus];
  if (!Array.isArray(allowed)) {
    // Unknown prior state — be conservative, allow the transition but
    // shout in the logs so we notice and fix the matrix.
    console.warn(`[DoctorOrder] Unknown prior state "${this._priorStatus}" — allowing transition to "${this.status}" without matrix check`);
    return next();
  }
  if (!allowed.includes(this.status)) {
    const err = new Error(
      `Illegal status transition: ${this._priorStatus} → ${this.status} ` +
      `(allowed: ${allowed.join(", ") || "<terminal>"}). ` +
      `Set this._stateOverride = "admin" with an Admin actor to bypass.`,
    );
    err.code   = "ILLEGAL_STATE_TRANSITION";
    err.status = 409;
    return next(err);
  }
  next();
});

DoctorOrderSchema.index({ UHID: 1, status: 1 });
DoctorOrderSchema.index({ visitId: 1, status: 1 });
DoctorOrderSchema.index({ UHID: 1, orderType: 1 });

module.exports = mongoose.models.DoctorOrder || mongoose.model("DoctorOrder", DoctorOrderSchema);
