/**
 * wardOpsModels.js — supporting models for the Ward Boy operations
 * suite (Phase B + C scope expansion, 13 May 2026).
 *
 * Five sibling schemas living in one file so the surrounding routes /
 * controllers don't have to reach into five separate paths. Each
 * collection is independent — no cross-references except UHID/user.
 *
 *   • WardShift        clock-in / clock-out + break tracking
 *   • EquipmentLog     equipment issue / return register
 *   • WardSupplyLog    daily linen + BMW counts per ward
 *   • CodeBlueEvent    code-blue alert + response log (NABH IPSG.6)
 *   • MortuaryRecord   death + body-shift + family-handover register
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ── 1. SHIFT ATTENDANCE ─────────────────────────────────────── */
const BreakSchema = new Schema({
  startedAt: { type: Date, default: Date.now },
  endedAt:   { type: Date, default: null },
  reason:    { type: String, default: "" },     // lunch / tea / personal
}, { _id: false });

const WardShiftSchema = new Schema({
  user:           { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  userName:       { type: String, default: "" },
  ward:           { type: String, default: "" },             // text — assigned ward / "All"
  startedAt:      { type: Date, default: Date.now, index: true },
  endedAt:        { type: Date, default: null },
  breaks:         { type: [BreakSchema], default: [] },
  shiftNotes:     { type: String, default: "" },             // end-of-shift narrative
  handoverNotes:  { type: String, default: "" },             // pending tasks for next shift
  totalActiveMin: { type: Number, default: null },           // computed at close
}, { timestamps: true });

WardShiftSchema.pre("save", function (next) {
  // Auto-compute total active minutes when shift closes.
  if (this.endedAt && !this.totalActiveMin) {
    const totalMs = this.endedAt - this.startedAt;
    const breakMs = (this.breaks || []).reduce((s, b) => {
      if (b.endedAt) return s + (new Date(b.endedAt) - new Date(b.startedAt));
      return s;
    }, 0);
    this.totalActiveMin = Math.max(0, Math.round((totalMs - breakMs) / 60000));
  }
  next();
});

/* ── 2. EQUIPMENT ISSUE / RETURN ────────────────────────────── */
const EquipmentLogSchema = new Schema({
  equipmentName:    { type: String, required: true, trim: true },  // free-text
  category:         { type: String, default: "" },                  // BP / ECG / Oxygen / Suction / Wheelchair / Stretcher / Other
  serialNumber:     { type: String, default: "" },
  // Issue
  issuedTo:         { type: Schema.Types.ObjectId, ref: "User" },
  issuedToName:     { type: String, default: "" },
  issuedToWard:     { type: String, default: "" },
  issuedBy:         { type: Schema.Types.ObjectId, ref: "User" },
  issuedByName:     { type: String, default: "" },
  issuedAt:         { type: Date, default: Date.now, index: true },
  expectedReturnAt: { type: Date, default: null },
  // Return
  returnedAt:       { type: Date, default: null, index: true },
  returnedToBy:     { type: Schema.Types.ObjectId, ref: "User" },
  returnedToName:   { type: String, default: "" },
  conditionOnReturn:{ type: String, enum: ["OK", "Damaged", "Lost", "Pending"], default: "Pending" },
  // Status — derived but stored for query speed
  status:           { type: String, enum: ["issued", "returned", "lost"], default: "issued", index: true },
  notes:            { type: String, default: "" },
}, { timestamps: true });

EquipmentLogSchema.index({ status: 1, issuedAt: -1 });

/* ── 3. WARD SUPPLY LOG (linen + BMW) ───────────────────────── */
const WardSupplyLogSchema = new Schema({
  // Day this log covers (00:00 of the day in local time). One row per
  // ward per day — upserts to avoid duplicates.
  date:           { type: Date, required: true, index: true },
  ward:           { type: String, default: "Main", index: true },
  recordedBy:     { type: Schema.Types.ObjectId, ref: "User" },
  recordedByName: { type: String, default: "" },
  // Linen counts (sets)
  linen: {
    issued:   { type: Number, default: 0 },
    returned: { type: Number, default: 0 },
    soiled:   { type: Number, default: 0 },
    lost:     { type: Number, default: 0 },
  },
  // BMW (bio-medical waste) by colour-coded bag, in kilograms
  bmw: {
    yellow:   { type: Number, default: 0 },   // anatomical / soiled
    red:      { type: Number, default: 0 },   // contaminated plastic
    blue:     { type: Number, default: 0 },   // glass / metallic
    white:    { type: Number, default: 0 },   // sharps (translucent)
    black:    { type: Number, default: 0 },   // general
  },
  notes:          { type: String, default: "" },
}, { timestamps: true });

WardSupplyLogSchema.index({ date: 1, ward: 1 }, { unique: true });

/* ── 4. CODE BLUE EVENT ─────────────────────────────────────── */
const ResponderSchema = new Schema({
  user:      { type: Schema.Types.ObjectId, ref: "User" },
  name:      { type: String, default: "" },
  role:      { type: String, default: "" },
  arrivedAt: { type: Date, default: Date.now },
}, { _id: false });

const CodeBlueEventSchema = new Schema({
  alertedAt:        { type: Date, required: true, default: Date.now, index: true },
  alertedBy:        { type: Schema.Types.ObjectId, ref: "User" },
  alertedByName:    { type: String, default: "" },
  location:         { type: String, required: true },        // ward / room / bed
  bedNumber:        { type: String, default: "" },
  UHID:             { type: String, default: "", index: true },
  patientName:      { type: String, default: "" },
  responders:       { type: [ResponderSchema], default: [] },
  arrivalDelaySec:  { type: Number, default: null },         // first responder time
  outcome: {
    type: String,
    enum: ["resuscitated", "shifted-to-icu", "pronounced-dead", "false-alarm", "ongoing"],
    default: "ongoing",
    index: true,
  },
  closedAt:         { type: Date, default: null },
  notes:            { type: String, default: "" },
}, { timestamps: true });

/* ── 5. MORTUARY REGISTER ───────────────────────────────────── */
const MortuaryRecordSchema = new Schema({
  UHID:                  { type: String, required: true, index: true },
  patientName:           { type: String, required: true },
  admissionId:           { type: Schema.Types.ObjectId, ref: "Admission" },
  age:                   { type: Number, default: null },
  gender:                { type: String, default: "" },
  // Death event
  deathDeclaredAt:       { type: Date, required: true, index: true },
  deathDeclaredBy:       { type: Schema.Types.ObjectId, ref: "User" },
  deathDeclaredByName:   { type: String, default: "" },
  causeOfDeath:          { type: String, default: "" },
  isMLC:                 { type: Boolean, default: false },
  mlcNumber:             { type: String, default: "" },
  // Body shift (Ward → Mortuary)
  shiftedToMortuaryAt:   { type: Date, default: null },
  shiftedBy:             { type: Schema.Types.ObjectId, ref: "User" },
  shiftedByName:         { type: String, default: "" },
  bodyTagId:             { type: String, default: "" },      // hospital body tag
  // Handover to family (Mortuary → Outside)
  handoverAt:            { type: Date, default: null },
  handoverBy:            { type: Schema.Types.ObjectId, ref: "User" },
  handoverByName:        { type: String, default: "" },
  receivedBy:            { type: String, default: "" },      // family member name
  relationship:          { type: String, default: "" },
  receiverPhone:         { type: String, default: "" },
  receiverIdProof:       { type: String, default: "" },      // Aadhaar/PAN/etc.
  receiverIdNumber:      { type: String, default: "" },
  vehicleDetails:        { type: String, default: "" },
  status: {
    type: String,
    enum: ["declared", "in-mortuary", "handed-over"],
    default: "declared",
    index: true,
  },
  notes:                 { type: String, default: "" },
}, { timestamps: true });

module.exports = {
  WardShift:        mongoose.model("WardShift",        WardShiftSchema),
  EquipmentLog:     mongoose.model("EquipmentLog",     EquipmentLogSchema),
  WardSupplyLog:    mongoose.model("WardSupplyLog",    WardSupplyLogSchema),
  CodeBlueEvent:    mongoose.model("CodeBlueEvent",    CodeBlueEventSchema),
  MortuaryRecord:   mongoose.model("MortuaryRecord",   MortuaryRecordSchema),
};
