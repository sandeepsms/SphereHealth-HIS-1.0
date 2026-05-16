// models/CounterModel.js
//
// Centralised atomic sequence generator used by every auto-generated
// identifier in the HIS (UHID, visitNumber, emergencyNumber, appointmentNumber,
// orderNumber, transferNo, billNumber, gatePassNumber, MLR series, etc.).
//
// The legacy `countDocuments() + 1` pattern races under concurrent writes
// and silently duplicates serial numbers; the next save then 500s on the
// unique index. Counter solves both with an atomic `findOneAndUpdate $inc`.
//
// Usage:
//   const { nextSequence } = require("../utils/counter");
//   this.visitNumber = `OPD-${year}-${String(await nextSequence(`opd:${year}`)).padStart(6, "0")}`;

const mongoose = require("mongoose");

const CounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },     // scope key, e.g. "opd:2026", "ER:2026", "mlc:RK"
    seq: { type: Number, default: 0 },
  },
  { collection: "counters", versionKey: false },
);

module.exports =
  mongoose.models.Counter ||
  mongoose.model("Counter", CounterSchema);
