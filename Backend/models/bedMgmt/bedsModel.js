// models/bedMgmt/bedModel.js
const mongoose = require("mongoose");

const BedSchema = new mongoose.Schema(
  {
    bedNumber: {
      type: String,
      required: [true, "Bed number is required"],
      uppercase: true,
      trim: true,
    },

    building: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
      required: true,
    },
    buildingName: String,

    floor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Floor",
      required: true,
    },
    floorNumber: String,

    ward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ward",
      default: undefined,
    },
    wardName: String,
    wardCode: String,

    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
    },
    roomNumber: String,
    roomCode: String,

    pricing: {
      perBedDailyRate: {
        type: Number,
        default: 0,
        min: 0,
      },
      nursingCharges: {
        type: Number,
        default: 0,
        min: 0,
      },
      equipmentCharges: {
        type: Number,
        default: 0,
        min: 0,
      },
      securityDeposit: {
        type: Number,
        default: 0,
        min: 0,
      },
      currency: {
        type: String,
        default: "INR",
        uppercase: true,
      },
    },

    services: [
      {
        service: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ServiceMaster",
        },
        serviceName: String,
        price: {
          type: Number,
          default: 0,
          min: 0,
        },
        isIncluded: {
          type: Boolean,
          default: false,
        },
      },
    ],

    status: {
      type: String,
      enum: ["Available", "Occupied", "Maintenance", "Blocked", "Reserved"],
      default: "Available",
    },

    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      default: null,
    },

    admission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      default: null,
    },

    currentBooking: {
      admittedDate: Date,
      expectedDischargeDate: Date,
      actualDischargeDate: Date,
      totalDays: Number,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    notes: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

BedSchema.index({ room: 1, bedNumber: 1 }, { unique: true });
BedSchema.index({ ward: 1, status: 1 });
BedSchema.index({ building: 1, floor: 1 });
BedSchema.index({ patient: 1 }, { sparse: true });
BedSchema.index({ status: 1, isActive: 1 });

BedSchema.virtual("dailyBaseCharges").get(function () {
  const room = this.pricing.perBedDailyRate || 0;
  const nursing = this.pricing.nursingCharges || 0;
  const equipment = this.pricing.equipmentCharges || 0;
  return room + nursing + equipment;
});

BedSchema.virtual("includedServicesTotal").get(function () {
  if (!this.services || this.services.length === 0) return 0;
  return this.services
    .filter((s) => s.isIncluded)
    .reduce((sum, s) => sum + (s.price || 0), 0);
});

BedSchema.virtual("totalDailyRate").get(function () {
  return this.dailyBaseCharges + this.includedServicesTotal;
});

BedSchema.virtual("daysOccupied").get(function () {
  if (!this.currentBooking?.admittedDate) return 0;

  const endDate = this.currentBooking.actualDischargeDate || new Date();
  const startDate = new Date(this.currentBooking.admittedDate);
  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

  return days > 0 ? days : 1;
});

BedSchema.virtual("estimatedCharges").get(function () {
  return this.totalDailyRate * this.daysOccupied;
});

BedSchema.pre("save", function (next) {
  if (!this.ward || this.ward === null) {
    this.ward = undefined;
    this.wardName = null;
    this.wardCode = null;
  }
  next();
});

module.exports = mongoose.model("Beds", BedSchema);
