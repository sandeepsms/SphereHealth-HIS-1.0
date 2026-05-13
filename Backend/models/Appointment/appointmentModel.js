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

AppointmentSchema.index({ doctorId: 1, appointmentDate: 1, slotTime: 1 });
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

module.exports =
  mongoose.models.Appointment ||
  mongoose.model("Appointment", AppointmentSchema);
