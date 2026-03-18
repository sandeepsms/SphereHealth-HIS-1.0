const mongoose = require("mongoose");

const PatientSchema = new mongoose.Schema(
  {
    patientId: { type: String, unique: true },
    UHID: { type: String, unique: true },

    registrationType: {
      type: String,
      required: true,
      enum: ["OPD", "Emergency", "IPD", "Daycare", "Services"],
      default: "OPD",
    },

    fullName: { type: String, required: true, trim: true },
    title: {
      type: String,
      required: true,
      enum: ["Mr.", "Mrs.", "Miss", "Master", "Baby", "Dr."],
    },
    gender: {
      type: String,
      required: true,
      enum: ["Male", "Female", "Other"],
    },
    dateOfBirth: { type: Date, required: true },
    age: { type: Number },
    maritalStatus: {
      type: String,
      enum: ["Single", "Married", "Divorced", "Widowed", "Other"],
    },

    contactNumber: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },

    address: {
      completeAddress: String,
      pincode: { type: String, required: true },
      city: String,
      state: String,
      district: String,
    },

    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Not Known"],
    },
    knownAllergies: { type: String, default: "" },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    paymentType: {
      type: String,
      enum: ["GENERAL", "TPA", "CORPORATE"],
      default: "GENERAL",
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

// Indexes
PatientSchema.index({ patientId: 1 });
PatientSchema.index({ UHID: 1 });
PatientSchema.index({ contactNumber: 1 });
PatientSchema.index({ paymentType: 1 });
PatientSchema.index({ tpa: 1 });

// Pre-save middleware
PatientSchema.pre("save", async function (next) {
  if (this.isNew) {
    try {
      const Patient = this.constructor;

      // Generate patientId
      if (!this.patientId) {
        const count = await Patient.countDocuments({
          registrationType: this.registrationType,
        });
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
        this.patientId = `${prefix}-${year}-${String(count + 1).padStart(6, "0")}`;
      }

      // Generate UHID
      if (!this.UHID) {
        const count = await Patient.countDocuments();
        this.UHID = `UH${String(count + 1).padStart(8, "0")}`;
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
