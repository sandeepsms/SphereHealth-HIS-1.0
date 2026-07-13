/**
 * BirthRegisterModel.js — NABH IMS / statutory birth register (RBD Act 1969)
 *
 * Running register of every delivery — the maternity ward's legal record and
 * the source for the statutory birth-notification to the local registrar.
 * Distinct from the birth-notification *certificate* (one of the medical-
 * certificate types): this is the cumulative REGISTER surveyors inspect.
 *
 * Number: BR-YY-N (FY-keyed, gap-less via the shared counter).
 */
"use strict";

const mongoose = require("mongoose");
const { nextSequence } = require("../../utils/counter");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "UPDATED", "NOTIFIED", "CANCELLED"], default: "CREATED" },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const BirthRegisterSchema = new Schema(
  {
    birthNumber: { type: String, unique: true, sparse: true, index: true }, // BR-YY-N

    // ── Mother ──
    motherUHID: { type: String, uppercase: true, trim: true, default: "", index: true },
    motherName: { type: String, required: true, trim: true },
    motherAge: { type: Number, default: null },
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    admissionNumber: { type: String, default: "" },

    // ── Delivery ──
    deliveryDateTime: { type: Date, required: true, index: true },
    deliveryType: { type: String, enum: ["Normal", "LSCS", "Assisted-Vaginal", "Instrumental", "Other"], default: "Normal" },
    placeOfBirth: { type: String, default: "" }, // ward / OT / labour room
    attendingDoctor: { type: String, default: "" },
    attendingMidwife: { type: String, default: "" },

    // ── Baby ──
    babySex: { type: String, enum: ["Male", "Female", "Ambiguous"], required: true },
    birthWeightGrams: { type: Number, default: null, min: 0, max: 8000 },
    gestationalAgeWeeks: { type: Number, default: null, min: 20, max: 45 },
    liveOrStill: { type: String, enum: ["Live", "Stillbirth"], default: "Live", index: true },
    apgar1Min: { type: Number, default: null, min: 0, max: 10 },
    apgar5Min: { type: Number, default: null, min: 0, max: 10 },
    birthOrder: { type: String, enum: ["Single", "Twin-A", "Twin-B", "Triplet", "Other"], default: "Single" },
    congenitalAnomaly: { type: String, default: "" },
    babyUHID: { type: String, uppercase: true, trim: true, default: "" }, // if the neonate is registered

    // ── Statutory notification ──
    notifiedToRegistrar: { type: Boolean, default: false, index: true },
    notifiedAt: { type: Date, default: null },
    notificationReference: { type: String, default: "" },

    status: { type: String, enum: ["Active", "Cancelled"], default: "Active", index: true },
    remarks: { type: String, default: "" },

    auditTrail: { type: [AuditSchema], default: [] },
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true, collection: "birth_registers" },
);

BirthRegisterSchema.index({ deliveryDateTime: -1 });
BirthRegisterSchema.index({ notifiedToRegistrar: 1, deliveryDateTime: -1 });

BirthRegisterSchema.pre("save", async function (next) {
  if (this.birthNumber) return next();
  try {
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yy = String(fyStartYear).slice(-2);
    const seq = await nextSequence(`birthregister:${yy}`);
    this.birthNumber = `BR-${yy}-${seq}`;
    next();
  } catch (e) { next(e); }
});

module.exports =
  mongoose.models.BirthRegister || mongoose.model("BirthRegister", BirthRegisterSchema);
