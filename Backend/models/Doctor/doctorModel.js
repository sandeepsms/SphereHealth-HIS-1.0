// Backend: models/Doctor.js
const mongoose = require("mongoose");

const DoctorSchema = new mongoose.Schema(
  {
    doctorId: {
      type: String,
      unique: true,
      uppercase: true,
      // ⭐ Remove required, will be auto-generated
    },

    personalInfo: {
      firstName: { type: String, required: true, trim: true },
      lastName: { type: String, required: true, trim: true },
      fullName: String,
      gender: {
        type: String,
        enum: ["Male", "Female", "Other"],
        required: true,
      },
    },

    contact: {
      mobileNumber: {
        type: String,
        required: true,
        validate: {
          validator: function (v) {
            return /^[0-9]{10}$/.test(v);
          },
          message: "Invalid mobile number format",
        },
      },
      email: {
        type: String,
        required: true,
        lowercase: true,
        validate: {
          validator: function (v) {
            return /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(v);
          },
          message: "Invalid email format",
        },
      },
    },

    professional: {
      specialization: {
        type: String,
        required: true,
        enum: [
          "General Physician",
          "Cardiologist",
          "Neurologist",
          "Orthopedic",
          "Pediatrician",
          "Gynecologist",
          "Dermatologist",
          "ENT Specialist",
          "Ophthalmologist",
          "Psychiatrist",
          "Surgeon",
          "Anesthesiologist",
          "Radiologist",
          "Pathologist",
          "Emergency Medicine",
          "Other",
        ],
      },
      qualifications: [String],
      experience: { type: Number, default: 0 },
      registrationNumber: {
        type: String,
        required: true,
        unique: true,
      },
    },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },

    // R7dp — Per-doctor charges sheet with 5 visit types.
    //
    //   opdFirst        — First-time OPD consultation with this doctor.
    //                     Receptionist sees this when patient has NEVER
    //                     met this specific doctor before (cross-doctor
    //                     lookup, not cross-department).
    //   opdFollowup     — Follow-up rate — applies when patient has seen
    //                     this SAME doctor previously (any time in the past).
    //                     Per business rule: "agar Dr Sandeep ko pahle
    //                     dikhaya hai to agli baar followup, lakin agar
    //                     duser dr ko dikhana hai to first visit count hoga".
    //   emergency       — ER consultation fee (any first/repeat ER visit).
    //   mlc             — Medico-Legal Case consultation fee (police case,
    //                     accident, assault) — usually higher because of
    //                     paperwork + court appearance liability.
    //   ipdCrossConsult — When this doctor is called in to consult on
    //                     an IPD patient admitted under ANOTHER doctor
    //                     (or another department) — billed per visit
    //                     per day per consulting doctor.
    //
    // Legacy `opd` field preserved (migration source for opdFirst).
    consultationFee: {
      opd:             { type: Number, default: 0, min: 0 }, // legacy — use opdFirst
      opdFirst:        { type: Number, default: 0, min: 0 },
      opdFollowup:     { type: Number, default: 0, min: 0 },
      emergency:       { type: Number, default: 0, min: 0 },
      mlc:             { type: Number, default: 0, min: 0 },
      ipdCrossConsult: { type: Number, default: 0, min: 0 },
    },

    /* ── Live availability (manually set by the doctor) ── */
    availability: {
      status: {
        type: String,
        enum: ["Available", "InConsultation", "OnBreak", "OnLeave", "Offline"],
        default: "Offline",
      },
      note: { type: String, default: "" },         // e.g. "Back by 2 PM"
      currentlyServing: { type: Number, default: 0 }, // current OPD token #
      updatedAt: { type: Date, default: Date.now },
    },

    isActive: { type: Boolean, default: true },

    // Link to the User account that this doctor logs in with.
    // Set by the doctor-seed script so role-based filtering on OPD / IPD /
    // ER / Daycare can use `req.user.id` → Doctor → patients.
    loginUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },

    // ── MLC (Medico-Legal Case) — per-doctor MLR series ──────────
    // 2-letter prefix derived from the doctor's name (e.g. "Rajesh Kumar"→"RK",
    // single name "Sandeep"→"SP"). Assigned lazily on first MLC creation and
    // pinned for life so MLR numbers stay stable. Globally unique so the
    // first two letters of any MLR number identify exactly one doctor.
    mlcPrefix: { type: String, uppercase: true, sparse: true, unique: true },
    // Per-doctor running counter for MLR numbers (RK0001, RK0002, …).
    mlcSeq:    { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ⭐ Pre-save hook - Generate doctorId
DoctorSchema.pre("save", async function (next) {
  try {
    // Generate full name
    const { firstName, lastName } = this.personalInfo;
    this.personalInfo.fullName = `${firstName} ${lastName}`;

    // Generate unique doctorId if not exists
    if (!this.doctorId) {
      // Find last doctor to get sequential number
      const lastDoctor = await mongoose.models.Doctor.findOne(
        {},
        { doctorId: 1 }
      )
        .sort({ createdAt: -1 })
        .lean();

      let nextNumber = 1000;
      if (lastDoctor && lastDoctor.doctorId) {
        const lastNumber = parseInt(lastDoctor.doctorId.replace("DOC-", ""));
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }

      this.doctorId = `DOC-${nextNumber}`;
    }

    next();
  } catch (error) {
    console.error("Error in pre-save hook:", error);
    next(error);
  }
});

// Indexes
DoctorSchema.index({ "professional.specialization": 1 });
DoctorSchema.index({ department: 1 });
DoctorSchema.index({ isActive: 1 });

module.exports =
  mongoose.models.Doctor || mongoose.model("Doctor", DoctorSchema);
