/**
 * wardOpsModels.js — supporting models for the Ward Boy operations
 * suite (Phase B + C scope expansion, 13 May 2026).
 *
 * Five sibling schemas living in one file so the surrounding routes /
 * controllers don't have to reach into five separate paths. Each
 * collection is independent — no cross-references except UHID/user.
 *
 *   • WardShift        clock-in / clock-out + break tracking + transition log
 *   • EquipmentLog     equipment issue / return register
 *   • WardSupplyLog    daily linen + BMW counts per ward
 *   • CodeBlueEvent    code-blue alert + response log (NABH IPSG.6)
 *   • MortuaryRecord   death + body-shift + family-handover register
 *
 * R7bj-F3:
 *   • MortuaryRecord — append-only on body identity + status enum expanded
 *     to include cremated/buried; 2-signatory witness required on
 *     handed-over; terminal status (handed-over/cremated/buried) frozen
 *     unless Admin force-override.  Auth 2-WB-CRIT-1.
 *   • WardShift — transition history append on every status change.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/* ── 1. SHIFT ATTENDANCE ─────────────────────────────────────── */
const BreakSchema = new Schema({
  startedAt: { type: Date, default: Date.now },
  endedAt:   { type: Date, default: null },
  reason:    { type: String, default: "" },     // lunch / tea / personal
}, { _id: false });

// R7bj-F3: shift state transitions (Active → OnBreak → Active → Closed).
const ShiftTransitionSchema = new Schema({
  from:     { type: String, default: "" },
  to:       { type: String, required: true },
  at:       { type: Date,   default: Date.now },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  byName:   { type: String, default: "" },
  reason:   { type: String, default: "" },
}, { _id: true });

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
  // R7bj-F3: append-only ledger of state moves.
  transitions:    { type: [ShiftTransitionSchema], default: [] },
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
  // R7bj-F6 / NABH WB-CRIT-1 / BMW Rules 2016: link each daily supply
  // log to the consolidated transport manifest that ultimately moved
  // those bags off-site to the CBWTF. Null until the daily collection
  // is sealed into a manifest; set by bmwManifestService.createManifest
  // (downstream wiring) so the ward-day bag totals reconcile with the
  // monthly state Pollution Control Board (Form IV) return.
  bmwManifestId:  { type: Schema.Types.ObjectId, ref: "BmwTransportManifest", default: null, index: true },
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
  // R7bj-F3 / Auth 2-WB-CRIT-1: 2-sig witness on handover.
  // Required when transitioning to `handed-over` (custom validator below).
  witnessId:             { type: Schema.Types.ObjectId, ref: "User", default: null },
  witnessName:           { type: String, default: "" },
  witnessRole:           { type: String, default: "" },
  witnessSignedAt:       { type: Date, default: null },
  // R7bm-F10 / R7bl-MR-CRIT-1 (NABH ROM 3-sig): security guard is the third
  // signatory on body handover. Hospital witness + family receiver alone
  // can be a forged pair if both come from the family side; the security
  // guard at the mortuary gate provides an independent attestation.
  // Required when status transitions to `handed-over` (validators below).
  guardId:               { type: Schema.Types.ObjectId, ref: "User", default: null },
  guardName:             { type: String, default: "" },
  guardBadgeNo:          { type: String, default: "" },
  guardSignedAt:         { type: Date, default: null },
  status: {
    type: String,
    // R7bj-F3: expanded enum to track post-handover disposal terminal states.
    enum: ["declared", "in-cold-storage", "in-mortuary", "handed-over", "cremated", "buried"],
    default: "declared",
    index: true,
  },
  notes:                 { type: String, default: "" },
  // R7bj-F3: 10y retention (NABH + medico-legal).
  retainUntil:           { type: Date, default: () => new Date(Date.now() + TEN_YEARS_MS) },
  legalHold:             { type: Boolean, default: false },
}, { timestamps: true });

// TTL on retainUntil (purge after 10y unless under legalHold).
MortuaryRecordSchema.index(
  { retainUntil: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { legalHold: false } },
);

// Terminal states — once any of these are set, status cannot regress.
const MORTUARY_TERMINAL = new Set(["handed-over", "cremated", "buried"]);

// R7bj-F3 / R7bm-F10 NABH ROM 3-sig: handover validator — requires
// handoverBy + hospital witness + security guard when status flips to
// `handed-over` on save. All three sigs are mandatory; the family
// receiver (receivedBy/relationship) is enforced separately at the
// controller layer (validated against the witness so they can't be the
// same person).
MortuaryRecordSchema.pre("save", function (next) {
  if (this.status === "handed-over") {
    const hasHandover = this.handoverAt && this.handoverBy && this.handoverByName;
    const hasWitness  = this.witnessId && this.witnessName && this.witnessSignedAt;
    const hasGuard    = this.guardName && this.guardSignedAt;
    if (!hasHandover) {
      const err = new Error("MortuaryRecord: handed-over requires handoverAt/handoverBy/handoverByName");
      err.statusCode = 400;
      err.code = "MORTUARY_HANDOVER_INCOMPLETE";
      return next(err);
    }
    if (!hasWitness) {
      const err = new Error("MortuaryRecord: handed-over requires hospital witness (witnessId/witnessName/witnessSignedAt)");
      err.statusCode = 400;
      err.code = "MORTUARY_WITNESS_REQUIRED";
      return next(err);
    }
    if (!hasGuard) {
      const err = new Error("MortuaryRecord: handed-over requires security-guard signature (guardName/guardSignedAt) — NABH ROM 3-sig");
      err.statusCode = 400;
      err.code = "MORTUARY_GUARD_REQUIRED";
      return next(err);
    }
  }
  next();
});

// R7bj-F3: append-only guard on terminal-status transitions.
// Once status ∈ terminal set, blocking any status change unless
// Admin force-override (caller sets options.adminOverride + reason).
MortuaryRecordSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const upd = this.getUpdate() || {};
    const opts = this.getOptions() || {};
    const $set = upd.$set || {};
    const nextStatus = $set.status ?? upd.status;
    if (!nextStatus) return next();

    const adminOverride = opts.adminOverride === true;
    const overrideReason = typeof opts.overrideReason === "string" && opts.overrideReason.trim().length > 0;

    // Read current row to check whether status is already terminal.
    const current = await this.model.findOne(this.getQuery()).lean();
    if (current && MORTUARY_TERMINAL.has(current.status) && nextStatus !== current.status) {
      if (!(adminOverride && overrideReason)) {
        const err = new Error(
          `MortuaryRecord: status "${current.status}" is terminal — Admin force-override + reason required to change`,
        );
        err.statusCode = 409;
        err.code = "MORTUARY_STATUS_TERMINAL";
        return next(err);
      }
    }
    // When transitioning into handed-over via update, require witness +
    // guard fields too (NABH ROM 3-sig).
    if (nextStatus === "handed-over") {
      const wId  = $set.witnessId  ?? $set["witnessId"]  ?? current?.witnessId;
      const wNm  = $set.witnessName ?? $set["witnessName"] ?? current?.witnessName;
      const wAt  = $set.witnessSignedAt ?? $set["witnessSignedAt"] ?? current?.witnessSignedAt;
      const hOv  = $set.handoverBy ?? current?.handoverBy;
      const hNm  = $set.handoverByName ?? current?.handoverByName;
      const hAt  = $set.handoverAt ?? current?.handoverAt;
      // R7bm-F10: security guard 3rd signature.
      const gNm  = $set.guardName       ?? current?.guardName;
      const gAt  = $set.guardSignedAt   ?? current?.guardSignedAt;
      if (!(wId && wNm && wAt)) {
        const err = new Error("MortuaryRecord: handed-over requires witness fields");
        err.statusCode = 400;
        err.code = "MORTUARY_WITNESS_REQUIRED";
        return next(err);
      }
      if (!(hOv && hNm && hAt)) {
        const err = new Error("MortuaryRecord: handed-over requires handoverBy/Name/At");
        err.statusCode = 400;
        err.code = "MORTUARY_HANDOVER_INCOMPLETE";
        return next(err);
      }
      if (!(gNm && gAt)) {
        const err = new Error("MortuaryRecord: handed-over requires security-guard signature — NABH ROM 3-sig");
        err.statusCode = 400;
        err.code = "MORTUARY_GUARD_REQUIRED";
        return next(err);
      }
    }
    next();
  } catch (e) {
    next(e);
  }
});

module.exports = {
  WardShift:        mongoose.model("WardShift",        WardShiftSchema),
  EquipmentLog:     mongoose.model("EquipmentLog",     EquipmentLogSchema),
  WardSupplyLog:    mongoose.model("WardSupplyLog",    WardSupplyLogSchema),
  CodeBlueEvent:    mongoose.model("CodeBlueEvent",    CodeBlueEventSchema),
  MortuaryRecord:   mongoose.model("MortuaryRecord",   MortuaryRecordSchema),
};
