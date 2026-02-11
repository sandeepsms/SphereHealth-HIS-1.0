// models/prescriptionModel.js
const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    UHID: {
      type: String,
      required: true,
      uppercase: true,
    },
    // Patient details (auto-populated from Patient)
    patientName: String,
    age: Number,
    gender: String,
    contactNumber: String,
    fatherName: String,

    department: String,
    date: {
      type: Date,
      default: Date.now,
    },

    // Doctor who wrote prescription (can be different from registration doctor)
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    doctorName: String, // Auto-populated

    referredBy: String,
    registrationType: {
      type: String,
      enum: ["OPD", "IPD", "Emergency"],
      default: "OPD",
    },

    clinicalDetails: {
      historyOfAllergy: String,
      historyOfPresentIllness: String,
      physicalExamination: String,
    },

    vitals: {
      weight: Number,
      temperature: Number,
      bloodPressure: String,
      pulse: Number,
      respiratoryRate: Number,
      spo2: Number,
    },

    provisionalDiagnosis: {
      type: String,
      required: true,
    },

    medicines: [
      {
        medicineName: {
          type: String,
          required: true,
        },
        schedule: String,
        instruction: String,
        route: {
          type: String,
          default: "Oral",
        },
        days: {
          type: Number,
          default: 1,
        },
      },
    ],

    selectedServices: [
      {
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "TPAServices",
        },
        serviceName: {
          type: String,
          required: true,
        },
        serviceType: {
          type: String,
          enum: ["fixed", "quantity", "hourly"],
          required: true,
        },
        baseAmount: {
          type: Number,
          required: true,
          min: 0,
        },
        discount: {
          type: Number,
          default: 0,
          min: 0,
          max: 20,
        },
        quantity: {
          type: Number,
          default: 1,
          min: 1,
        },
        hours: {
          type: Number,
          default: 0,
          min: 0,
        },
        totalAmount: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    investigations: [
      {
        investigationName: String,
        investigationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "TPAServices",
        },
      },
    ],

    advice: String,

    // Summary fields
    totalServicesAmount: {
      type: Number,
      default: 0,
    },

    prescriptionDate: {
      type: Date,
      default: Date.now,
    },

    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled"],
      default: "Active",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Indexes
prescriptionSchema.index({ patient: 1, createdAt: -1 });
prescriptionSchema.index({ UHID: 1 });
prescriptionSchema.index({ doctor: 1 });
prescriptionSchema.index({ prescriptionDate: -1 });

// Calculate total service amount before save
prescriptionSchema.pre("save", function (next) {
  // Calculate individual service totals
  if (this.selectedServices && this.selectedServices.length > 0) {
    let totalAmount = 0;

    this.selectedServices.forEach((service) => {
      let discountedPrice =
        service.baseAmount - (service.baseAmount * service.discount) / 100;

      if (service.serviceType === "quantity") {
        service.totalAmount = discountedPrice * service.quantity;
      } else if (service.serviceType === "hourly") {
        service.totalAmount = discountedPrice * service.hours;
      } else {
        service.totalAmount = discountedPrice;
      }

      totalAmount += service.totalAmount;
    });

    this.totalServicesAmount = totalAmount;
  }
  next();
});

module.exports = mongoose.model("Prescription", prescriptionSchema);
