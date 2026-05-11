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

// Pre-save: Set fullName
UserSchema.pre("save", function (next) {
  if (this.firstName && this.lastName) {
    this.fullName = `${this.firstName} ${this.lastName}`;
  }
  next();
});

// Pre-save: Generate employeeId
UserSchema.pre("save", async function (next) {
  if (this.isNew && !this.employeeId) {
    const count = await mongoose.model("User").countDocuments();
    const year = new Date().getFullYear();
    let prefix = "EMP";

    switch (this.role) {
      case "Doctor":
        prefix = "DOC";
        break;
      case "Nurse":
        prefix = "NUR";
        break;
      case "Pharmacist":
        prefix = "PHR";
        break;
      case "Lab Technician":
        prefix = "LAB";
        break;
      case "Receptionist":
        prefix = "REC";
        break;
      case "Admin":
        prefix = "ADM";
        break;
      default:
        prefix = "EMP";
    }

    this.employeeId = `${prefix}-${year}-${String(count + 1).padStart(5, "0")}`;
  }
  next();
});

// Pre-save: Hash password
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

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
