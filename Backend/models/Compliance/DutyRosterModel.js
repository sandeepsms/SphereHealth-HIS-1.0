/**
 * DutyRosterModel.js — NABH HRM.1 / FMS staffing
 *
 * Dated staff duty roster — who is on duty, in which department, on which
 * shift. Surveyors check that the roster is planned, published, and matches
 * the staff actually present (and that skill-mix / nurse-patient ratios are
 * met). One document per (rosterDate, department, shift); entries[] lists the
 * assigned staff.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const RosterEntrySchema = new Schema({
  _id: false,
  userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  staffName: { type: String, required: true, trim: true },
  role: { type: String, default: "" },            // Nurse / Doctor / Ward Boy / …
  designation: { type: String, default: "" },
  inTime: { type: String, default: "" },           // "08:00"
  outTime: { type: String, default: "" },          // "20:00"
  onCall: { type: Boolean, default: false },
  isCharge: { type: Boolean, default: false },      // shift in-charge
  remarks: { type: String, default: "" },
});

const DutyRosterSchema = new Schema(
  {
    rosterDate: { type: Date, required: true, index: true },
    department: { type: String, required: true, trim: true, index: true }, // ICU / Ward-1 / OT / ER
    shift: { type: String, enum: ["Morning", "Evening", "Night", "General"], required: true, index: true },

    entries: { type: [RosterEntrySchema], default: [] },

    // Skill-mix snapshot (for the nurse-patient ratio check).
    plannedNurses: { type: Number, default: null },
    plannedDoctors: { type: Number, default: null },
    bedStrength: { type: Number, default: null },

    status: { type: String, enum: ["Draft", "Published"], default: "Draft", index: true },
    publishedAt: { type: Date, default: null },

    preparedByName: { type: String, default: "" },
    preparedById: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedByName: { type: String, default: "" },
    notes: { type: String, default: "" },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "duty_rosters" },
);

// One roster per (date, department, shift) — re-publishing updates in place.
DutyRosterSchema.index({ rosterDate: 1, department: 1, shift: 1 }, { unique: true });

module.exports =
  mongoose.models.DutyRoster || mongoose.model("DutyRoster", DutyRosterSchema);
