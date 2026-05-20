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

    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Not Known", "Unknown", ""],
      default: "Unknown",
    },
    // Receptionist enters as either a comma string or a list of allergens;
    // we accept both — stored as String for backward-compat with old reports.
    knownAllergies: { type: mongoose.Schema.Types.Mixed, default: "" },

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
    policyNumber: String,
    policyHolderName: String,
    sumInsured: Number,

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
  },
  { timestamps: true },
);

// Indexes — patientId and UHID already get unique indexes via
// `unique: true` on the field definitions above, no need to re-declare.
PatientSchema.index({ contactNumber: 1 });
PatientSchema.index({ paymentType: 1 });
PatientSchema.index({ tpa: 1 });

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
        this.UHID = `UH${String(seq).padStart(8, "0")}`;
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

module.exports =
  mongoose.models.Patient || mongoose.model("Patient", PatientSchema);
