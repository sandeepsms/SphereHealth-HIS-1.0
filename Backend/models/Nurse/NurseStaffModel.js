// Nurse/models/nurseStaffModel.js
// Parallel to Doctor/doctorModel.js — same pattern
// staffId auto-generated: NSE-1001, NSE-1002...

const mongoose = require("mongoose");

const NurseStaffSchema = new mongoose.Schema(
  {
    staffId: { type: String, unique: true, uppercase: true },

    personalInfo: {
      firstName: { type: String, required: true, trim: true },
      lastName: { type: String, required: true, trim: true },
      fullName: { type: String },
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
          validator: (v) => /^[0-9]{10}$/.test(v),
          message: "Invalid mobile number",
        },
      },
      email: {
        type: String,
        lowercase: true,
        trim: true,
        validate: {
          validator: (v) => /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(v),
          message: "Invalid email",
        },
      },
    },

    professional: {
      designation: {
        type: String,
        required: true,
        enum: [
          "GNM",
          "ANM",
          "BSc Nursing",
          "MSc Nursing",
          "Post Basic BSc",
          "Other",
        ],
      },
      registrationNumber: { type: String, required: true, unique: true },
      experience: { type: Number, default: 0 },
      qualifications: [String],
    },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },
    ward: { type: String },
    shift: {
      type: String,
      enum: ["morning", "evening", "night", "rotating"],
      default: "rotating",
    },

    username: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, select: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

NurseStaffSchema.pre("save", async function (next) {
  try {
    const { firstName, lastName } = this.personalInfo;
    this.personalInfo.fullName = `${firstName} ${lastName}`;

    if (!this.staffId) {
      const last = await mongoose.models.NurseStaff.findOne({}, { staffId: 1 })
        .sort({ createdAt: -1 })
        .lean();
      let nextNum = 1000;
      if (last?.staffId) {
        const n = parseInt(last.staffId.replace("NSE-", ""));
        if (!isNaN(n)) nextNum = n + 1;
      }
      this.staffId = `NSE-${nextNum}`;
    }
    next();
  } catch (error) {
    next(error);
  }
});

NurseStaffSchema.index({ department: 1 });
NurseStaffSchema.index({ isActive: 1 });
NurseStaffSchema.index({ "professional.designation": 1 });

module.exports =
  mongoose.models.NurseStaff || mongoose.model("NurseStaff", NurseStaffSchema);
