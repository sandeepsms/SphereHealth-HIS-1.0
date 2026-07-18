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
// R9-FIX(R9-009): MongoDB REJECTS $nin inside partialFilterExpression
// (only $eq/$gt/$gte/$lt/$lte/$type/$and/$exists/$in are permitted), so the
// index above silently failed to build — leaving the slot-conflict race wide
// open again. Express the same predicate positively with $in over the
// blocking statuses (everything except Cancelled/NoShow).
AppointmentSchema.index(
  { doctorId: 1, appointmentDate: 1, slotTime: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["Booked", "Confirmed", "CheckedIn", "Completed"] } },
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

// R7bf-I / A7-HIGH-4 — Appointment state-machine guard delegated to
// the shared registry. Pre-R7bf the pre-save hook here only blocked
// "terminal → Booked" and "Completed → anything"; SCHEDULED → COMPLETED
// (skipping CheckedIn) was silently accepted, which broke OPD billing
// (a no-show was being marked Completed by a faulty close-day cron and
// then billed as a consultation). The registry now requires the
// CheckedIn step before Completed. Business audit F-06 (terminal re-book)
// is preserved by the registry's empty arrays on Cancelled / NoShow.
const { attachStatusGuard } = require("../../utils/statusTransitionGuard");
attachStatusGuard(AppointmentSchema, { modelName: "Appointment", field: "status" });

module.exports =
  mongoose.models.Appointment ||
  mongoose.model("Appointment", AppointmentSchema);
