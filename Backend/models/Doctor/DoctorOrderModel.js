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
    enum: ["pending","given","hold","not_available","delayed","skipped","refused","partial"],
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

  status: {
    type: String,
    enum: ["Pending","Acknowledged","InProgress","Completed","Cancelled","OnHold","Stopped","Held"],
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

  acknowledgedBy: String,
  acknowledgedAt: Date,
  completedBy:    String,
  completedAt:    Date,
  nurseNotes:     String,

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

DoctorOrderSchema.index({ UHID: 1, status: 1 });
DoctorOrderSchema.index({ visitId: 1, status: 1 });
DoctorOrderSchema.index({ UHID: 1, orderType: 1 });

module.exports = mongoose.models.DoctorOrder || mongoose.model("DoctorOrder", DoctorOrderSchema);
