/* One-shot demo: inject a nurse note for UH00000001 containing Braden +
   Morse scoring data so the new Patient File scoring panels are visible.
   Idempotent — re-running replaces the same demo note. */
require("dotenv").config();
const mongoose = require("mongoose");
const NurseNote = require("../models/Nurse/NurseNotesModel");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const filter = { patientUHID: "UH00000001", noteType: "fall-and-pressure-risk-demo" };
  const payload = {
    patientUHID: "UH00000001",
    patientName: "JaiBhagwan",
    ipdNo:    "ADM-2026-0001",
    noteDate: new Date(),
    shift:    "morning",
    nurseName: "Sunita Patil",
    noteType:  "fall-and-pressure-risk-demo",
    status:    "submitted",
    submittedAt: new Date(),
    signedByName: "Sunita Patil",
    remarks: "Routine risk re-screen at start of shift.",
    noteData: {
      braden: {
        b1: 3, b2: 3, b3: 2, b4: 2, b5: 2, b6: 2,
      },
      fallRisk: {
        m1: 25, m2: 15, m3: 15, m4: 20, m5: 10, m6: 15,
      },
    },
  };
  const r = await NurseNote.findOneAndUpdate(filter, payload, { upsert: true, new: true });
  console.log("upserted demo nurse note:", r._id.toString(), "noteData keys:", Object.keys(r.noteData));
  await mongoose.disconnect();
})();
