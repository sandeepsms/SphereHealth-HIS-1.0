/**
 * Appointment — pre-booked OPD slot
 *
 * Used for telephonic / walk-in advance bookings before the patient arrives.
 * When the patient actually arrives, the receptionist clicks "Convert to
 * OPD Visit" and the appointment is marked CheckedIn. The OPD visit
 * inherits the doctor + chiefComplaint context.
 */
const mongoose = require("mongoose");

const AppointmentSchema = new mongoose.Schema(
  {
    appointmentNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    patientId:   { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
    UHID:        { type: String, index: true },
    patientName: { type: String, required: true },
    patientPhone:{ type: String, required: true },

    doctorId:        { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    doctorName:      { type: String },
    departmentId:    { type: mongoose.Schema.Types.ObjectId, ref: "Department" },

    appointmentDate: { type: Date, required: true, index: true }, // YYYY-MM-DD@00:00
    slotTime:        { type: String, required: true },             // "HH:MM" 24-hr
    durationMinutes: { type: Number, default: 15 },

    chiefComplaint:  { type: String, default: "" },
    notes:           { type: String, default: "" },

    status: {
      type: String,
      enum: ["Booked", "Confirmed", "CheckedIn", "Completed", "NoShow", "Cancelled"],
      default: "Booked",
      index: true,
    },
    bookedBy:    { type: String, default: "" },
    bookedAt:    { type: Date,   default: Date.now },
    checkedInAt: Date,
    cancelledAt: Date,
    cancelReason: String,

    // Link to OPD visit (filled when checked-in)
    opdVisitId:     { type: mongoose.Schema.Types.ObjectId, ref: "OPDRegistration" },
    opdVisitNumber: { type: String }, // denormalised visit number for navigation
  },
  { timestamps: true }
);

// FIX (audit P9-B2): slot conflict race — the old index was non-unique,
// so two concurrent bookings for the same (doctor, date, time) both
// succeeded. Partial unique index now lets DB enforce one booking per
// slot, EXCEPT when the prior appointment is Cancelled or NoShow (those
// don't block re-booking).
AppointmentSchema.index(
  { doctorId: 1, appointmentDate: 1, slotTime: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $nin: ["Cancelled", "NoShow"] } },
  },
);
AppointmentSchema.index({ appointmentDate: 1, status: 1 });

// Use `pre("validate")` (not `pre("save")`) so the auto-generated number is
// populated BEFORE Mongoose runs validation. With `appointmentNumber` marked
// `required: true`, a `pre("save")` hook fires too late — Mongoose validates
// FIRST, sees the empty path, and rejects the doc with
// "Appointment validation failed: appointmentNumber: Path `appointmentNumber`
// is required." which broke every appointment booking.
// Atomic sequence via shared Counter — replaces the countDocuments race
// that was producing duplicate APT numbers under concurrent bookings.
const { nextSequence: nextSeqApt } = require("../../utils/counter");

AppointmentSchema.pre("validate", async function (next) {
  if (this.isNew && !this.appointmentNumber) {
    try {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const seq  = await nextSeqApt(`appointment:${date}`);
      this.appointmentNumber = `APT-${date}-${String(seq).padStart(4, "0")}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Snapshot the prior status on every load so the state-machine guard
// below can detect illegal transitions. Business audit F-06: the partial
// unique index excludes Cancelled / NoShow from the doctor-slot-time
// uniqueness check, so flipping a NoShow appointment back to Booked
// could land two active appointments on the same slot (the first slot
// "ghosted" out via NoShow, then re-Booked, while a concurrent caller
// already booked the now-vacant slot). Force re-booking to go through
// the regular Booking flow (a new appointment row), which hits the
// unique index cleanly.
AppointmentSchema.post("init", function () {
  this._priorStatus = this.status;
});

AppointmentSchema.pre("save", function (next) {
  if (!this.isNew && this._priorStatus) {
    const prior = this._priorStatus;
    const next$ = this.status;
    const TERMINAL = new Set(["Cancelled", "NoShow", "Completed"]);
    if (TERMINAL.has(prior) && next$ === "Booked") {
      return next(new Error(
        `Cannot re-book an appointment from terminal status "${prior}". ` +
        `Create a new appointment for the patient instead.`,
      ));
    }
    if (prior === "Completed" && next$ !== "Completed") {
      return next(new Error(
        `Cannot transition a Completed appointment to "${next$}".`,
      ));
    }
  }
  next();
});

module.exports =
  mongoose.models.Appointment ||
  mongoose.model("Appointment", AppointmentSchema);
