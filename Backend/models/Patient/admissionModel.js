// models/admission/admissionModel.js
const mongoose = require("mongoose");

const AdmissionSchema = new mongoose.Schema(
  {
    // Patient Info
    UHID: {
      type: String,
      required: [true, "UHID is required"],
      trim: true,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: [true, "Patient ID is required"],
    },
    patientName: {
      type: String,
      required: [true, "Patient name is required"],
      trim: true,
    },
    contactNumber: {
      type: String,
      required: [true, "Contact number is required"],
    },
    email: String,

    // Bed & Room Info
    bedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bed",
      required: [true, "Bed ID is required"],
    },
    bedNumber: String,
    roomNumber: String,

    // Optional - kuch beds room ke andar, kuch ward ke andar
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
    },
    wardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ward",
    },
    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Floor",
    },
    buildingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
    },

    // Department Reference
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
    },

    // Admission Details
    admissionDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    expectedDischargeDate: Date,
    reasonForAdmission: {
      type: String,
      required: [true, "Reason for admission is required"],
    },

    // Status
    status: {
      type: String,
      enum: ["Active", "Discharged", "Transferred", "Cancelled"],
      default: "Active",
    },

    // Billing Info
    estimatedCost: Number,
    totalCost: Number,
    advancePaid: Number,

    // Discharge Info
    actualDischargeDate: Date,
    dischargeNotes: String,
    dischargeSummary: String,
  },
  { timestamps: true }
);

// Indexes
AdmissionSchema.index({ UHID: 1 });
AdmissionSchema.index({ patientId: 1 });
AdmissionSchema.index({ bedId: 1 });
AdmissionSchema.index({ department: 1 });
AdmissionSchema.index({ status: 1 });
AdmissionSchema.index({ admissionDate: -1 });

module.exports =
  mongoose.models.Admission || mongoose.model("Admission", AdmissionSchema);
