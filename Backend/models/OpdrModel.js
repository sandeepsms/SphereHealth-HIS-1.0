const mongoose = require("mongoose");

const OPDSchema = new mongoose.Schema({
  Name: String,
  Age: Number,
  Gender: String,
  Contact: Number,
  Date: String,
  UHID: String,

  Department: String,
  Referred: String,

  fathername: String,
  Provisional_diagnosis1: String,

  History_of_Any_Allergy: String,
  History_of_Present_Illness: String,
  Physical_Examination: String,

  weight: Number,
  Temp: Number,
  BP: Number,
  Pulse: Number,

  Provisional_diagnosis: String,

  Investigation: String,
  Advice: String,
  User: [
    {
      Medicine: String,
      Schedule: String,
      Instruction: String,
      Route: String,
      Days: Number,
    },
  ],
});
module.exports = mongoose.model("OPDReegistration", OPDSchema);
