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
    roomName: String,
    roomCode: String,
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
    // ✅ ADDED: admissionService already does Bed.findByIdAndUpdate(..., { currentAdmission: admission._id })
    //           but the field was missing from schema — so it was silently dropped by MongoDB
    currentAdmission: {
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
  },
);

// Partial filter so soft-deleted beds (isActive=false) can be re-created.
BedSchema.index(
  { room: 1, bedNumber: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
BedSchema.index({ ward: 1, status: 1 });
BedSchema.index({ building: 1, floor: 1 });
BedSchema.index({ patient: 1 }, { sparse: true });
BedSchema.index({ status: 1, isActive: 1 });
BedSchema.index({ currentAdmission: 1 }, { sparse: true }); // ✅ fast lookup

BedSchema.virtual("daysOccupied").get(function () {
  if (!this.currentBooking?.admittedDate) return 0;
  const endDate = this.currentBooking.actualDischargeDate || new Date();
  const startDate = new Date(this.currentBooking.admittedDate);
  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  return days > 0 ? days : 1;
});

BedSchema.pre("save", function (next) {
  if (!this.ward || this.ward === null) {
    this.ward = undefined;
    this.wardName = null;
    this.wardCode = null;
  }
  next();
});

module.exports = mongoose.models.Beds || mongoose.model("Beds", BedSchema);
