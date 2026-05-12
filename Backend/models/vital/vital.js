const mongoose = require("mongoose");

const VitalSheetSchema = new mongoose.Schema({
  uhid: {
    type: String,
    required: true,
  },
  date: {
    type: String, 
    required: true,
  },
  patientInfo: {
    name: String,
    age: Number,
    gender: String,
  },
  activeVitals: [
    {
      name: { type: String, required: true }
    }
  ],
  tableData: [
    {
      time: { type: String, required: true }, 
       values: {
          type: Map,
          of: new mongoose.Schema(
            {
              value: { type: Number, default: 0 },
              unit: { type: String, required: true }
            },
            { _id: false }
          )
        },
      notes: { type: String, default: "" },
      nurse: { type: String, default: "" }
    }
  ]
}, { timestamps: true });
VitalSheetSchema.index({ uhid: 1, date: 1 }, { unique: true });

// Legacy orphan file — the live VitalSheet model is at
// `Vitals/vitalSheetModel.js`. Guard the registration so any accidental
// require here doesn't OverwriteModelError. Field shapes differ from
// the live model — do NOT consume this for new code.
module.exports =
  mongoose.models.VitalSheet ||
  mongoose.model("VitalSheet", VitalSheetSchema);
