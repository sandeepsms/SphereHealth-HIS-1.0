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

    // ── Infection Prevention & Control (NABH IPC.6) ──
    // Multiple flags can co-exist on a single bed (e.g. MRSA + Contact).
    // Visual layout surfaces these as colored rings; admission flow
    // warns the receptionist when an isolation bed is being assigned.
    isolationFlags: {
      type: [String],
      default: [],
      enum: [
        "Contact",
        "Droplet",
        "Airborne",
        "Neutropenic",
        "MRSA",
        "COVID",
        "TB",
        "VRE",
        "CRE",
        "C.diff",
        "Reverse",
      ],
    },
    // Optional summary level used for at-a-glance filtering
    precautionLevel: {
      type: String,
      enum: ["Standard", "Enhanced", "Strict"],
      default: "Standard",
    },
    isolationStartedAt: { type: Date, default: null },
    isolationEndsAt:    { type: Date, default: null },
    isolationNotes:     { type: String, default: "" },

    // ── Housekeeping sub-status (NABH IPC.6 turnover audit) ──
    // status: "Maintenance" stays the primary bucket; this finer-grained
    // state lets the dashboard show cleaning queue + SLA timer.
    housekeeping: {
      state: {
        type: String,
        enum: ["Idle", "CleaningPending", "CleaningInProgress", "CleaningDone", "Inspected"],
        default: "Idle",
      },
      startedAt:  { type: Date, default: null },
      finishedAt: { type: Date, default: null },
      assignedTo: { type: String, default: "" },
    },

    // ── Reservation auto-expiry (P2 #10) ──
    // When set, a stale Reserved bed auto-flips back to Available
    // either via the /bedss/reservations/expire-stale endpoint
    // (cron-callable) or a manual sweep from the dashboard.
    reservedUntil: { type: Date, default: null },
    reservedBy:    { type: String, default: "" },
    reservationReason: { type: String, default: "" },

    // ── Equipment manifest (P2 #12) ──
    // Tracks fixed equipment attached to this bed. Drives both bed
    // pricing (per-day surcharges) and audit ("kahan kaunsa ventilator
    // hai"). Free-form for now; later we'll link to a typed Asset model.
    equipment: {
      type: [
        new mongoose.Schema(
          {
            type:        { type: String, required: true },   // e.g. "Ventilator"
            label:       { type: String, default: "" },      // user-visible name
            serialNo:    { type: String, default: "" },
            lastService: { type: Date,   default: null },
            dailyCharge: { type: Number, default: 0 },
            notes:       { type: String, default: "" },
          },
          { _id: true, timestamps: false },
        ),
      ],
      default: [],
    },
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
