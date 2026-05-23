/**
 * BmwTransportManifestModel.js  (R7bj-F6 / NABH WB-CRIT-1 / BMW Rules 2016 + 2018 amendment)
 *
 * Bio-medical Waste transport manifest. Closes WB-CRIT-1: pre-R7bj
 * the WardSupplyLog only captured bag-weights per ward — there was
 * no audit-grade chain-of-custody artefact tying those bags to the
 * Common Bio-medical Waste Treatment Facility (CBWTF) pickup. As a
 * consequence the monthly state Pollution Control Board (PCB) return
 * under BMW Rules 2016 (Form III / Form IV) could not be filed.
 *
 * One manifest per truck-load. Each bag is barcoded and weighed at
 * the hospital end, then countersigned by the CBWTF driver on
 * receipt. The 2018 amendment recognises a separate CYTOTOXIC bag
 * colour so the enum includes it explicitly alongside the four
 * classical colours (yellow / red / blue / white) plus the black bag
 * for general (non-BMW) waste cross-contamination control.
 *
 * Append-only after handover: once `handedOverAt` is set, only the
 * PCB-return administrative fields may be touched.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const BmwBagSchema = new Schema(
  {
    _id:        false,
    barcode:    { type: String, required: true, trim: true },
    bagColor:   {
      type: String,
      enum: ["YELLOW", "RED", "BLUE", "WHITE", "BLACK", "CYTOTOXIC"],
      required: true,
    },
    category:   {
      type: String,
      enum: ["INFECTIOUS", "ANATOMICAL", "SHARPS", "CHEMICAL", "CYTOTOXIC", "GENERAL"],
      required: true,
    },
    weight_kg:  { type: Number, required: true, min: 0 },
    fromWard:   { type: String, default: "" },
    generatedDate: { type: Date, default: null },
  },
);

const BmwTransportManifestSchema = new Schema(
  {
    // Auto-counter — formatId("BMW-YYYY", seq, 4) → "BMW-2026-0001"
    manifestNumber: { type: String, required: true, unique: true, index: true },

    manifestDate: { type: Date, required: true, default: Date.now, index: true },

    // CBWTF (Common Bio-medical Waste Treatment Facility) — vendor
    cbwtfName:           { type: String, required: true, trim: true },
    cbwtfLicenceNumber:  { type: String, required: true, trim: true },
    vehicleNumber:       { type: String, required: true, trim: true },
    driverName:          { type: String, default: "" },
    driverPhone:         { type: String, default: "" },

    bags:           { type: [BmwBagSchema], default: [], validate: { validator: v => Array.isArray(v) && v.length > 0, message: "manifest must contain at least one bag" } },
    totalBags:      { type: Number, default: 0, min: 0 },
    totalWeight_kg: { type: Number, default: 0, min: 0 },

    // Handover — hospital → CBWTF
    handedOverById:   { type: Schema.Types.ObjectId, ref: "User", default: null },
    handedOverByName: { type: String, default: "" },
    handedOverAt:     { type: Date, default: null, index: true },

    // Receipt — CBWTF driver acknowledgement
    cbwtfReceivedById: { type: String, default: "" },     // driver licence # / employee id (free-text)
    cbwtfReceivedAt:   { type: Date, default: null },

    signature: {
      hospital: { type: String, default: "" },            // base64 or signature image URL
      cbwtf:    { type: String, default: "" },
    },

    // Monthly state PCB return (Form IV) — administrative post-handover
    pcbReturnFiled:    { type: Boolean, default: false, index: true },
    pcbReturnRefNumber:{ type: String, default: "" },
    pcbReturnFiledAt:  { type: Date, default: null },
    pcbReturnFiledBy:  { type: Schema.Types.ObjectId, ref: "User", default: null },
    pcbReturnFiledByName: { type: String, default: "" },

    notes:      { type: String, default: "" },
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "bmw_transport_manifests" },
);

BmwTransportManifestSchema.index({ manifestDate: -1 });
BmwTransportManifestSchema.index({ pcbReturnFiled: 1, manifestDate: -1 });
BmwTransportManifestSchema.index({ "bags.barcode": 1 });

// Append-only after handover: once `handedOverAt` is set, only PCB-return
// + signature.cbwtf + cbwtfReceived* may mutate.  This protects the BMW
// Rules 2016 chain-of-custody (auditors should be able to take a snapshot
// at any moment and the bag list / weights / vendor must be immutable).
const POST_HANDOVER_ALLOWED = new Set([
  "pcbReturnFiled",
  "pcbReturnRefNumber",
  "pcbReturnFiledAt",
  "pcbReturnFiledBy",
  "pcbReturnFiledByName",
  "signature.cbwtf",
  "cbwtfReceivedById",
  "cbwtfReceivedAt",
  "notes",
  "updatedAt",
]);
function _guardPostHandover(queryThis) {
  const upd = queryThis.getUpdate() || {};
  const $set = upd.$set || upd;
  const trying = Object.keys($set || {});
  // We can only enforce when the doc is already in handed-over state —
  // a pre-handover update is fine. Therefore the guard fires only when
  // every key is set; we still want the cheapest path so we test up
  // front and let the service layer pass `runValidators:true` if needed.
  const illegal = trying.filter((k) => !POST_HANDOVER_ALLOWED.has(k) && !k.startsWith("$"));
  if (!illegal.length) return;
  // Resolve the doc to check handover status before throwing.
  return queryThis.model.findOne(queryThis.getQuery()).then((existing) => {
    if (existing && existing.handedOverAt) {
      const err = new Error(
        `BMW manifest is post-handover; cannot modify: ${illegal.join(",")}`,
      );
      err.statusCode = 409;
      err.code = "BMW_MANIFEST_APPEND_ONLY";
      throw err;
    }
  });
}
BmwTransportManifestSchema.pre("findOneAndUpdate", function (next) {
  try {
    const p = _guardPostHandover(this);
    if (p && typeof p.then === "function") return p.then(() => next()).catch(next);
    next();
  } catch (e) { next(e); }
});
BmwTransportManifestSchema.pre("updateOne", function (next) {
  try {
    const p = _guardPostHandover(this);
    if (p && typeof p.then === "function") return p.then(() => next()).catch(next);
    next();
  } catch (e) { next(e); }
});

module.exports =
  mongoose.models.BmwTransportManifest ||
  mongoose.model("BmwTransportManifest", BmwTransportManifestSchema);
