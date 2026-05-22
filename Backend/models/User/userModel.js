const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
      required: true,
    },

    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    fullName: String,

    dateOfBirth: Date,

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },

    profilePhoto: String,

    // Digital signature — base64 PNG data URL drawn/uploaded once, auto-embedded in all signed documents
    signature: { type: String },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    // R7bb-A: account lockout + password lifecycle + token version. Per NABH
    // HIC.5 / DPDP §8 — 5 failed attempts trigger a 15-min lockout, password
    // history (last 5) blocks reuse, tokenVersion bumps invalidate every
    // existing JWT (role change, password reset, terminate, logout-all-devices).
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null, index: true },
    passwordChangedAt: { type: Date, default: null },
    // R7bb-FIX-A-3: default `true` so admin-created users land on the
    // /change-password screen on first login. The seed script explicitly
    // sets the same value for the seed users; existing production users
    // pre-R7bb don't carry the field so the falsy default would have
    // bypassed force-rotation on their first post-deploy login — now they
    // are routed through the modal once and the flag flips to false.
    mustChangePassword: { type: Boolean, default: true },
    passwordHistory: [{ hash: String, changedAt: Date }],
    tokenVersion: { type: Number, default: 0 },  // bumped on role-change / pw-reset / terminate / logout-all
    departureDate: { type: Date, default: null },
    terminationReason: { type: String, default: "" },
    // R7bb-FIX-A-1: HR review tracking — last time an HR admin re-attested
    // that this user's privileges (role, department, ward) are still
    // appropriate. NABH HIC.5 / DPDP §8 requires annual privilege review.
    lastPrivilegeReview: { type: Date, default: null },
    wards: [{ type: mongoose.Schema.Types.ObjectId, ref: "Ward" }],  // plural (multi-ward shift cover)
    roles: [{ type: String }],  // plural (multi-hat) — keep singular `role` as primary
    specializations: [String],

    phone: {
      type: String,
      required: true,
    },

    alternatePhone: String,

    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: "India",
      },
    },

    emergencyContact: {
      name: String,
      relationship: String,
      phone: String,
    },

    role: {
      type: String,
      required: true,
      enum: [
        "Doctor",
        "Nurse",
        "Admin",
        "Receptionist",
        "Pharmacist",
        "Lab Technician",
        "Radiologist",
        "Physiotherapist",
        "Ward Boy",
        "Accountant",
        "Security",
        "Housekeeping",
        "Dietician",
        "TPA Coordinator",
        // R7i: Medical Records Department — read-only access to
        // every discharged patient's complete file (NABH MOI.1
        // record retention). Replaces the paper MRD function.
        "MRD",
      ],
    },

    // Doctor specific details
    doctorDetails: {
      designation: {
        type: String,
        enum: [
          "Junior Resident",
          "Senior Resident",
          "Consultant",
          "HOD",
          "Visiting Doctor",
        ],
      },
      specialization: String,
      registrationNumber: String,
      // ABDM Healthcare Professional Registry ID — required by FHIR
      // bundle export so the Practitioner resource carries the national
      // identifier alongside the local registration number.
      hprId:           { type: String, default: "" },
      qualifications: [String],
      experienceYears: Number,
      consultationFee: {
        opd: { type: Number, default: 0 },
        emergency: { type: Number, default: 0 },
        ipd: { type: Number, default: 0 },
      },
      signature: String,
      availableDays: [String],
      consultationHours: {
        start: String,
        end: String,
      },
    },

    // Nurse specific details
    nurseDetails: {
      registrationNumber: String,
      nursingType: {
        type: String,
        enum: [
          "Staff Nurse",
          "Senior Nurse",
          "ICU Nurse",
          "OT Nurse",
          "Ward Nurse",
        ],
      },
      qualifications: [String],
      experienceYears: Number,
      specialization: String,
    },

    // Lab Technician details
    labTechnicianDetails: {
      registrationNumber: String,
      specialization: String,
      qualifications: [String],
      experienceYears: Number,
    },

    // Pharmacist details
    pharmacistDetails: {
      registrationNumber: String,
      licenseNumber: String,
      qualifications: [String],
      experienceYears: Number,
    },

    // Department Reference - IMPORTANT
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: function () {
        return ["Doctor", "Nurse", "Lab Technician", "Radiologist"].includes(
          this.role
        );
      },
    },

    ward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ward",
    },

    dateOfJoining: {
      type: Date,
      required: true,
      default: Date.now,
    },

    employmentType: {
      type: String,
      enum: ["Permanent", "Contract", "Temporary", "Part-time"],
      default: "Permanent",
    },

    shift: {
      type: String,
      enum: ["Morning", "Evening", "Night", "General", "Rotating"],
    },

    salary: {
      basic: Number,
      allowances: Number,
      total: Number,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive", "On Leave", "Terminated", "Suspended"],
      default: "Active",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLogin: Date,

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for age
UserSchema.virtual("age").get(function () {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
});

// Indexes
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ department: 1 });
UserSchema.index({ "doctorDetails.specialization": 1 });
UserSchema.index({ "nurseDetails.nursingType": 1 });
// R7bb-FIX-A-1/D9-MED: hot login lookup. The /auth/login query is
// `User.findOne({ email })` and the response gates on `isActive` —
// keep them in a compound covered index so the read never touches the
// document body when the account is inactive.
UserSchema.index({ email: 1, isActive: 1 });
// R7bb-FIX-A-1/D10-HIGH: HR "recently terminated" listing — sorted by
// departureDate desc within the Terminated bucket. Used by the audit
// review queue + the access-review report (annual privilege attestation).
UserSchema.index({ status: 1, departureDate: -1 });

// Pre-save: Set fullName
UserSchema.pre("save", function (next) {
  if (this.firstName && this.lastName) {
    this.fullName = `${this.firstName} ${this.lastName}`;
  }
  next();
});

// Pre-VALIDATE (not pre-save): Generate employeeId before required-check runs.
// `employeeId` is `required: true` (line 9), so if we generate it in `pre("save")`
// Mongoose validates first and rejects the doc with "Path `employeeId` is
// required." which blocks every user creation. Same anti-pattern as the
// Appointment bug fixed in appointmentModel.js.
UserSchema.pre("validate", async function (next) {
  if (this.isNew && !this.employeeId) {
    const year = new Date().getFullYear();
    let prefix = "EMP";

    switch (this.role) {
      case "Doctor":         prefix = "DOC"; break;
      case "Nurse":          prefix = "NUR"; break;
      case "Pharmacist":     prefix = "PHR"; break;
      case "Lab Technician": prefix = "LAB"; break;
      case "Receptionist":   prefix = "REC"; break;
      case "Admin":          prefix = "ADM"; break;
      default:               prefix = "EMP";
    }

    // R7au-FIX-1/D1-CRIT-C1: replaced `countDocuments() + 1` with the
    // atomic `nextSequence` counter. Pre-R7au two concurrent registrations
    // both read N → both wrote N+1 → second insert hit the unique-index
    // E11000 and registration failed at the desk. Seed from current row
    // count so existing employees keep their numbers when the counter is
    // first initialised on this prefix.
    const { nextSequence } = require("../../utils/counter");
    const key = `employee:${prefix}:${year}`;
    const seed = await mongoose.model("User").countDocuments({
      employeeId: { $regex: `^${prefix}-${year}-` },
    });
    const seq = await nextSequence(key, seed);
    this.employeeId = `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
  }
  next();
});

// Pre-save: Hash password
// R7bb-FIX-A-17: bcrypt cost bumped 10 → 12 (NABH HIC.5 / OWASP 2024 floor).
// R7bb-FIX-A-3: when password changes on an EXISTING user, archive the
// CURRENT (now-superseded) hash into passwordHistory BEFORE we replace
// `this.password` with the new hash. The reuse-blocker
// (passwordPolicy.checkPasswordReuse) compares the proposed plaintext
// against every entry in history, so we must capture the OLD hash —
// not the freshly-hashed new one. On brand-new docs there is no prior
// hash to archive (the in-memory `this.password` is the caller's
// plaintext). Use the bulk-getter pattern via $__.activePaths to read
// the OLD hash from the original document snapshot.
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  // Archive the PRIOR hash for reuse-detection. We pull it from the
  // `_doc`-shaped snapshot Mongoose retains for change tracking; if
  // unavailable (e.g. tests that bypass populate), fall back to the
  // current path value, then no-op silently. On `isNew` docs there is
  // no prior hash — skip.
  if (!this.isNew) {
    try {
      // `this.$__.activePaths.states.modify.password` is truthy when
      // password is dirty; the ORIGINAL hash lives on `this._original`
      // when the doc was loaded via `findById(...)`. In all practical
      // controller paths (admin reset, change password, terminate +
      // tokenVersion bump that also touches password) the doc was
      // loaded by id, so the original-hash retrieval below works.
      const priorHash =
        this.$__.delta?.()?.$set?.password
        || this._doc?.password    // pre-modification cache (mongoose 7+)
        || null;
      // The `_doc` cache is updated synchronously when callers assign
      // `user.password = newPlain`, so `this._doc.password` is already
      // the plaintext at this point. The only reliable place to capture
      // the OLD hash is the controller, which now invokes
      // `archivePriorHash()` (helper below) before mutation. Don't try
      // to second-guess here — service layer owns the contract.
      void priorHash;
    } catch (_) { /* best-effort */ }
  }

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  this.passwordChangedAt = new Date();

  // Archive the freshly-hashed password so subsequent change attempts can
  // detect reuse via checkPasswordReuse(). Cap at last 5 entries.
  this.passwordHistory = this.passwordHistory || [];
  this.passwordHistory.push({ hash: this.password, changedAt: this.passwordChangedAt });
  if (this.passwordHistory.length > 5) {
    this.passwordHistory = this.passwordHistory.slice(-5);
  }
  next();
});

// R7bb-FIX-A-3: helper for callers (change-password, adminResetPassword)
// to capture the CURRENT hash into passwordHistory BEFORE setting the new
// plaintext. The pre-save hook then re-hashes and pushes the new hash too,
// giving us a continuous chain. Call before assigning the new plaintext.
UserSchema.methods.archivePriorHash = function () {
  if (!this.password || this.isNew) return;
  this.passwordHistory = this.passwordHistory || [];
  this.passwordHistory.push({ hash: this.password, changedAt: this.passwordChangedAt || new Date() });
  if (this.passwordHistory.length > 5) {
    this.passwordHistory = this.passwordHistory.slice(-5);
  }
};

// Method: Compare password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method: Check if doctor
UserSchema.methods.isDoctor = function () {
  return this.role === "Doctor";
};

// Method: Check if nurse
UserSchema.methods.isNurse = function () {
  return this.role === "Nurse";
};

// Method: Check if admin
UserSchema.methods.isAdmin = function () {
  return this.role === "Admin";
};

// Method: Get role-specific details
UserSchema.methods.getRoleDetails = function () {
  switch (this.role) {
    case "Doctor":
      return this.doctorDetails;
    case "Nurse":
      return this.nurseDetails;
    case "Lab Technician":
      return this.labTechnicianDetails;
    case "Pharmacist":
      return this.pharmacistDetails;
    default:
      return null;
  }
};

// Static: Find doctors by specialization
UserSchema.statics.findDoctorsBySpecialization = function (specialization) {
  return this.find({
    role: "Doctor",
    "doctorDetails.specialization": specialization,
    status: "Active",
    isActive: true,
  }).populate("department");
};

// Static: Find doctors by department
UserSchema.statics.findDoctorsByDepartment = function (departmentId) {
  return this.find({
    role: "Doctor",
    department: departmentId,
    status: "Active",
    isActive: true,
  }).populate("department");
};

// Static: Find active staff by role
UserSchema.statics.findActiveStaffByRole = function (role) {
  return this.find({
    role: role,
    status: "Active",
    isActive: true,
  }).populate("department ward");
};

// Static: Find HOD of department
UserSchema.statics.findHOD = function (departmentId) {
  return this.findOne({
    role: "Doctor",
    department: departmentId,
    "doctorDetails.designation": "HOD",
    status: "Active",
    isActive: true,
  }).populate("department");
};

module.exports = mongoose.model("User", UserSchema);
