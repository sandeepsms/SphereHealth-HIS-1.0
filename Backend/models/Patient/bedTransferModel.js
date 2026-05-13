// models/Patient/bedTransferModel.js
// Bed Transfer Workflow — Doctor initiates with shiftingNotes, Nurse completes with handoverNotes

const mongoose = require("mongoose");

const BedTransferSchema = new mongoose.Schema(
  {
    transferNo: { type: String, unique: true, sparse: true },

    UHID:         { type: String, required: true, index: true },
    admissionId:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission", required: true },
    patientName:  { type: String, default: "" },

    // From
    fromBedId:     { type: mongoose.Schema.Types.ObjectId, ref: "Beds", default: null },
    fromBedNumber: { type: String, default: "" },
    fromWardName:  { type: String, default: "" },
    fromRoomNumber:{ type: String, default: "" },

    // To
    toBedId:       { type: mongoose.Schema.Types.ObjectId, ref: "Beds", required: true },
    toBedNumber:   { type: String, default: "" },
    toWardName:    { type: String, default: "" },
    toRoomNumber:  { type: String, default: "" },

    reason:        { type: String, default: "" },

    // Doctor writes this (required to initiate)
    shiftingNotes: { type: String, required: true },
    requestedBy:   { type: String, default: "" },
    requestedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    requestedAt:   { type: Date, default: Date.now },

    // Nurse writes this (required to complete)
    handoverNotes: { type: String, default: "" },
    handoverBy:    { type: String, default: "" },
    handoverById:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handoverAt:    { type: Date, default: null },

    status: {
      type: String,
      enum: ["PendingHandover", "Complete", "Cancelled"],
      default: "PendingHandover",
      index: true,
    },
  },
  { timestamps: true }
);

// Atomic transferNo via shared Counter.
const { nextSequence: nextSeqBT } = require("../../utils/counter");

BedTransferSchema.pre("validate", async function (next) {
  if (this.isNew && !this.transferNo) {
    try {
      const year = new Date().getFullYear();
      const seq  = await nextSeqBT(`bedtransfer:${year}`);
      this.transferNo = `BT-${year}-${String(seq).padStart(4, "0")}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

BedTransferSchema.index({ admissionId: 1, status: 1 });
// Prevent two concurrent PendingHandover transfers per admission.
BedTransferSchema.index(
  { admissionId: 1 },
  { unique: true, partialFilterExpression: { status: "PendingHandover" } },
);

module.exports =
  mongoose.models.BedTransfer ||
  mongoose.model("BedTransfer", BedTransferSchema);
