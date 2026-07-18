const mongoose = require("mongoose");

const PatientSchema = new mongoose.Schema(
  {
    // sparse so newly-created Patients (before patientId/UHID is assigned by
    // the pre-save hook) don't collide on the unique index with each other.
    patientId: { type: String, unique: true, sparse: true },
    UHID:      { type: String, unique: true, sparse: true },

    registrationType: {
      type: String,
      required: true,
      enum: ["OPD", "Emergency", "IPD", "Daycare", "Services"],
      default: "OPD",
    },

    fullName: { type: String, required: true, trim: true },
    title: {
      type: String,
      enum: ["Mr.", "Mrs.", "Ms.", "Miss", "Master", "Baby", "Dr."],
      default: "Mr.",
    },
    gender: {
      type: String,
      required: true,
      enum: ["Male", "Female", "Other"],
    },
    // DOB is required for clinical history but the receptionist may only have
    // age at intake; we compute one from the other in the pre-save hook.
    dateOfBirth: { type: Date },
    // Bounds catch typos (250-yr-old patient, negative age) at validation time
    // rather than silently letting pediatric-only rules / dosing checks misfire.
    age: { type: Number, min: 0, max: 150 },
    maritalStatus: {
      type: String,
      enum: ["Single", "Married", "Divorced", "Widowed", "Other", ""],
    },

    contactNumber: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },

    address: {
      completeAddress: String,
      pincode: { type: String },
      city: String,
      state: String,
      district: String,
    },

    // ── ABDM / ABHA (Ayushman Bharat Health Account) ──────────────
    // Populated when the patient links their ABHA (health ID). `abhaId`
    // is the exact field the FHIR exporter already reads to stamp the
    // https://abdm.gov.in/abha identifier on the Patient resource.
    abhaNumber:   { type: String, default: "", trim: true },  // 14-digit ABHA no.; unique partial index below (R9-004)
    abhaAddress:  { type: String, default: "", trim: true },  // ABHA address; unique partial index below (R9-004)
    abhaId:       { type: String, default: "", trim: true },               // canonical id emitted in FHIR (= abhaNumber)
    abhaLinked:   { type: Boolean, default: false },
    abhaKycVerified: { type: Boolean, default: false },                    // KYC/eKYC done via ABDM
    abhaLinkedAt: { type: Date, default: null },

    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Not Known", "Unknown", ""],
      default: "Unknown",
    },
    // Receptionist enters as either a comma string or a list of allergens;
    // we accept both — stored as String for backward-compat with old reports.
    //
    // R7az-CRIT-2 (D7-CRIT-2): `knownAllergies` is DEPRECATED in favour
    // of the typed `allergyList[]` below. Keep accepting the legacy
    // string so old reports / imports don't break, but new code should
    // read `patient.allergies` (the virtual) which prefers the typed
    // list and falls back to parsing the legacy string. The drug-allergy
    // gate (utils/allergyCheck.js) consumes the virtual.
    knownAllergies: { type: mongoose.Schema.Types.Mixed, default: "" },

    // R7az-CRIT-2 (D7-CRIT-2): typed allergy ledger. Each row is a
    // discrete allergen with severity + type so the clinician UI can
    // group DRUG vs FOOD vs OTHER and so the dispense gate matches only
    // on DRUG-typed entries when callers narrow the list (default: all
    // types are checked — safer baseline).
    allergyList: [
      {
        allergen: { type: String, required: true, trim: true },
        severity: {
          type: String,
          enum: ["MILD", "MODERATE", "SEVERE", "ANAPHYLAXIS", "UNKNOWN", ""],
          default: "UNKNOWN",
        },
        type: {
          type: String,
          enum: ["DRUG", "FOOD", "OTHER"],
          default: "DRUG",
        },
        recordedAt: { type: Date, default: Date.now },
        recordedBy: { type: String, default: "" },
        notes:      { type: String, default: "" },
      },
    ],

    // Department / doctor are picked at registration for OPD/IPD but are
    // optional for walk-in Emergency and lab Services.
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
    },

    // GENERAL/TPA/CORPORATE was the legacy enum; the UI uses Cash/TPA/Insurance/Corporate.
    // Accept both so the existing receptionist console keeps working.
    paymentType: {
      type: String,
      // Both legacy upper-case and the receptionist UI's title-case labels
      // are accepted to avoid breaking either side.
      enum: ["GENERAL", "TPA", "CORPORATE", "Cash", "Insurance", "Corporate"],
      default: "Cash",
    },
    tpa: { type: mongoose.Schema.Types.ObjectId, ref: "TPA" },
    // R7hr(CLAIM-P4.1) — the INSURER that issued the policy (Star Health,
    // HDFC Ergo…), distinct from the `tpa` administrator above. Drives which
    // company's claim form the PDF engine fills. Code maps to config/insurers.
    insurerCode: { type: String, trim: true, uppercase: true, default: "" },
    insurerName: { type: String, trim: true, default: "" },
    policyNumber: String,
    policyHolderName: String,
    sumInsured: Number,

    // R7hr(CLAIM-P1.1) — payer scheme drives which claim form(s) apply +
    // which scheme IDs to capture. paymentType above is the coarse cash-vs-
    // TPA split kept for legacy billing; payerScheme is the finer axis the
    // claim-form builder keys on (RETAIL_TPA/CORPORATE → IRDAI Part A/B;
    // CGHS → MRC; ESIC → ESIC claim; PMJAY/STATE → cashless docket).
    payerScheme: {
      type: String,
      enum: ["CASH", "RETAIL_TPA", "CORPORATE", "CGHS", "ESIC", "ECHS", "PMJAY", "STATE", "OTHER"],
      default: "CASH",
    },
    schemeIds: {
      cghsCardNo:      { type: String, trim: true },
      cghsWardEntitlement: { type: String, trim: true },   // General / Semi-Private / Private
      ppoNo:           { type: String, trim: true },        // pension payment order (CGHS/ECHS pensioners)
      esicIpNo:        { type: String, trim: true },        // ESIC insurance number
      esicEmployer:    { type: String, trim: true },
      esicDispensary:  { type: String, trim: true },
      pmjayId:         { type: String, trim: true },        // Ayushman / PMJAY card no
      echsCardNo:      { type: String, trim: true },
      stateSchemeName: { type: String, trim: true },        // e.g. MJPJAY / Aarogyasri
      stateSchemeId:   { type: String, trim: true },
    },

    isMLC: { type: Boolean, default: false },
    mlcNumber: String,

    companionName: String,
    companionRelationship: String,
    companionContact: String,

    hasAppointment: { type: Boolean, default: false },
    appointmentDate: Date,
    appointmentTime: String,

    registrationDate: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },

    // ── Visit counters ──────────────────────────────────
    totalOPDVisits: { type: Number, default: 0 },
    totalEmergencyVisits: { type: Number, default: 0 },
    totalIPDVisits: { type: Number, default: 0 },
    totalDaycareVisits: { type: Number, default: 0 }, // ✅ NEW
    totalServicesVisits: { type: Number, default: 0 }, // ✅ NEW

    lastVisitDate: Date,

    // R7gw-B8-T09 — per-patient vital range overrides.
    // When a clinician sets a baseline (e.g. COPD SpO2 88-92, beta-blocker
    // resting pulse 50-90), the Frontend vitalRanges.bandFor() reads from
    // here and falls back to the age-banded default only when min/max are
    // not present. `reason` records the clinical rationale for audit.
    vitalOverrides: {
      spo2:    { min: Number, max: Number, reason: String },
      pulse:   { min: Number, max: Number, reason: String },
      bp_sys:  { min: Number, max: Number, reason: String },
      bp_dia:  { min: Number, max: Number, reason: String },
      rr:      { min: Number, max: Number, reason: String },
      temp:    { min: Number, max: Number, reason: String },
      bsl:     { min: Number, max: Number, reason: String },
      comments: String,
      setAt:   Date,
      setByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
  },
  { timestamps: true },
);

// Indexes — patientId and UHID already get unique indexes via
// `unique: true` on the field definitions above, no need to re-declare.
PatientSchema.index({ contactNumber: 1 });
PatientSchema.index({ paymentType: 1 });
PatientSchema.index({ tpa: 1 });
// R9-FIX(R9-004): enforce uniqueness of ABHA number / address so two patients
// can't share one linked ABHA (which would make ABDM demographic discovery
// resolve to the wrong UHID). Partial filter excludes the "" default so
// non-ABDM patients (the vast majority) are not forced unique.
PatientSchema.index({ abhaNumber: 1 }, { unique: true, partialFilterExpression: { abhaNumber: { $type: "string", $gt: "" } } });
PatientSchema.index({ abhaAddress: 1 }, { unique: true, partialFilterExpression: { abhaAddress: { $type: "string", $gt: "" } } });

// R7bf-J/A8-CRIT-1: Mongo text index for the patient-search bar. Pre-R7bf,
// `searchPatients` ran an OR of five regex queries against `fullName`,
// `UHID`, `contactNumber`, `patientId`, `email` — a guaranteed COLLSCAN at
// 30 k+ records (p95 8.4 s). Text index lets the same query plan a
// $text-stage with weights favouring UHID/mobile (exact-shape hits) over
// name (fuzzier). The service layer still falls back to exact
// `contactNumber`/`UHID`/`patientId` regex for partial digit/UHID
// queries which $text does not tokenise.
PatientSchema.index(
  {
    fullName:      "text",
    UHID:          "text",
    contactNumber: "text",
    patientId:     "text",
    email:         "text",
  },
  {
    weights: { UHID: 10, contactNumber: 8, patientId: 8, fullName: 4, email: 2 },
    name:    "patient_text_search",
    default_language: "none", // names/ids aren't language-tokenisable
  },
);

// R7ab: use atomic Counter for UHID + patientId. The previous
// implementation used `countDocuments` inside pre-save which races
// catastrophically — two receptionists registering at the same instant
// computed the same count, produced the same UHID, and the loser saw a
// 11000 duplicate-key error at the desk. The codebase already has
// `utils/counter.js` (atomic findOneAndUpdate $inc) used by billNumber,
// admissionNumber, mlcNumber. Patient was just never migrated.
//
// We seed the Counter from the existing collection count the FIRST time
// the key is touched (via $setOnInsert), so existing UHIDs aren't
// re-issued. Subsequent calls ignore the seed and just $inc.
const { nextSequence: nextSeqPatient } = require("../../utils/counter");
const CounterModel = require("../CounterModel");

async function ensureSeed(key, seedFn) {
  const existing = await CounterModel.findOne({ _id: key }).lean();
  if (existing) return null;
  return await seedFn();
}

// Pre-save middleware
PatientSchema.pre("save", async function (next) {
  if (this.isNew) {
    try {
      const Patient = this.constructor;
      const year = new Date().getFullYear();
      const prefix =
        this.registrationType === "OPD"
          ? "OPD"
          : this.registrationType === "Emergency"
            ? "EMG"
            : this.registrationType === "Daycare"
              ? "DAY"
              : this.registrationType === "Services"
                ? "SVC"
                : "IPD";
      if (!this.patientId) {
        const idKey = `patientId:${prefix}:${year}`;
        const seed  = await ensureSeed(idKey, async () =>
          Patient.countDocuments({ registrationType: this.registrationType }),
        );
        const seq = await nextSeqPatient(idKey, seed);
        this.patientId = `${prefix}-${year}-${String(seq).padStart(6, "0")}`;
      }
      if (!this.UHID) {
        const uhidKey = "uhid:global";
        const seed    = await ensureSeed(uhidKey, async () =>
          Patient.countDocuments(),
        );
        const seq = await nextSeqPatient(uhidKey, seed);
        // R7ha — UHID format: UH01, UH02, ..., UH99, UH100, UH101 (auto-grows).
        // Previously zero-padded to 8 digits (UH00000001) — admin readability
        // was poor. The 2-digit minimum keeps the early IDs neat; once we
        // cross 100 the prefix naturally widens.
        this.UHID = `UH${String(seq).padStart(2, "0")}`;
      }
    } catch (error) {
      return next(error);
    }
  }

  // Calculate age from DOB
  if (this.dateOfBirth) {
    const today = new Date();
    const birthDate = new Date(this.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    this.age = age;
  }

  // Auto-set gender from title
  if (this.title && !this.gender) {
    if (["Mr.", "Master"].includes(this.title)) this.gender = "Male";
    else if (["Mrs.", "Miss"].includes(this.title)) this.gender = "Female";
    else if (this.title === "Baby") this.gender = "Other";
  }

  next();
});

// R7az-CRIT-2 (D7-CRIT-2): unified `allergies` virtual. Prefers the
// new typed `allergyList[]` when present; falls back to parsing the
// legacy `knownAllergies` string (comma/semicolon/newline-delimited)
// so that records imported before the migration still flow through the
// drug-allergy gate. utils/allergyCheck.js consumes this virtual.
//
// Returns: Array<{ allergen, severity, type }>
PatientSchema.virtual("allergies").get(function () {
  if (Array.isArray(this.allergyList) && this.allergyList.length > 0) {
    return this.allergyList.map((row) => ({
      allergen: row.allergen,
      severity: row.severity || "UNKNOWN",
      type:     row.type     || "DRUG",
    }));
  }
  const legacy = this.knownAllergies;
  if (legacy == null || legacy === "") return [];
  // Mixed → coerce. Array preserved as-is; string split on separators.
  let tokens = [];
  if (Array.isArray(legacy)) {
    tokens = legacy.map((x) => (typeof x === "string" ? x : x?.allergen || "")).filter(Boolean);
  } else if (typeof legacy === "string") {
    tokens = legacy.split(/[,;\n|/]/).map((s) => s.trim()).filter(Boolean);
  } else if (typeof legacy === "object" && legacy.allergen) {
    tokens = [String(legacy.allergen)];
  }
  // Filter NKA/none/nil sentinel rows so the gate doesn't false-positive.
  const NEG = /^\s*(none|nil|nka|no known|n\/a|na)\s*$/i;
  return tokens
    .filter((t) => !NEG.test(t))
    .map((t) => ({ allergen: t, severity: "UNKNOWN", type: "DRUG" }));
});

// Ensure virtuals serialise when the patient doc is JSON-ified for the
// dispense gate (some call sites use .lean() — those need to read the
// raw allergyList/knownAllergies and call normaliseAllergies themselves).
PatientSchema.set("toJSON",   { virtuals: true });
PatientSchema.set("toObject", { virtuals: true });

module.exports =
  mongoose.models.Patient || mongoose.model("Patient", PatientSchema);
