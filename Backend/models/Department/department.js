const mongoose = require("mongoose");

const DepartmentSchema = new mongoose.Schema(
  {
    departmentName: {
      type: String,
      required: [true, "Department name is required"],
      unique: true,
      trim: true,
    },
    departmentCode: {
      type: String,
      required: [true, "Department code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        "Clinical",
        "Surgical",
        "Diagnostic",
        "Support Services",
        "Emergency",
        "Critical Care",
      ],
      default: "Clinical",
    },

    headOfDepartment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
    },
    hodContact: String,

    opdAvailable: {
      type: Boolean,
      default: true,
    },
    ipdAvailable: {
      type: Boolean,
      default: true,
    },
    emergencyAvailable: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 999,
    },
  },
  { timestamps: true }
);

DepartmentSchema.index({ departmentCode: 1 });
DepartmentSchema.index({ isActive: 1, displayOrder: 1 });

module.exports =
  mongoose.models.Department || mongoose.model("Department", DepartmentSchema);
