/* Seed multi-shift, multi-date I/O entries so the new Intake/Output Sheet
   has interesting data to render. Idempotent. */
require("dotenv").config();
const mongoose = require("mongoose");
const NurseNote = require("../models/Nurse/NurseNotesModel");

const today = new Date(); today.setHours(0, 0, 0, 0);
const D = (off, h, m) => { const d = new Date(today); d.setDate(today.getDate() + off); d.setHours(h, m, 0, 0); return d; };

const ROWS = [
  // Yesterday — three shifts
  { off: -1, h: 8,  m: 30, shift: "morning",   nurse: "Sunita Patil", data: { oral: 500, ivFluids: 500, bloodProducts: 0,   urineOutput: 600, drainOutput: 0,  nasogastric: 0,   emesis: 0,   bloodLoss: 0, notes: "AM rounds, tolerating clear fluids" } },
  { off: -1, h: 12, m: 15, shift: "morning",   nurse: "Sunita Patil", data: { oral: 300, ivFluids: 400, bloodProducts: 0,   urineOutput: 350, drainOutput: 50, nasogastric: 0,   emesis: 0,   bloodLoss: 0, notes: "" } },
  { off: -1, h: 16, m: 0,  shift: "evening",   nurse: "Asha Pandey",  data: { oral: 400, ivFluids: 600, bloodProducts: 0,   urineOutput: 700, drainOutput: 50, nasogastric: 0,   emesis: 0,   bloodLoss: 0, notes: "Evening shift handover, stable" } },
  { off: -1, h: 22, m: 30, shift: "night",     nurse: "Meera Joshi",  data: { oral: 100, ivFluids: 800, bloodProducts: 0,   urineOutput: 500, drainOutput: 30, nasogastric: 0,   emesis: 0,   bloodLoss: 0, notes: "NPO from 10pm for tomorrow's procedure" } },
  // Today — morning + early evening
  { off:  0, h: 9,  m: 10, shift: "morning",   nurse: "Sunita Patil", data: { oral: 800, ivFluids: 1000, bloodProducts: 0,  urineOutput: 1300, drainOutput: 0, nasogastric: 150, emesis: 100, bloodLoss: 0, notes: "Tolerating oral well" } },
  { off:  0, h: 14, m: 0,  shift: "afternoon", nurse: "Asha Pandey",  data: { oral: 350, ivFluids: 500,  bloodProducts: 0,  urineOutput: 450, drainOutput: 0,  nasogastric: 80,  emesis: 0,   bloodLoss: 0, notes: "Post-lunch, NGT output minimal" } },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  for (let i = 0; i < ROWS.length; i++) {
    const r = ROWS[i];
    const when = D(r.off, r.h, r.m);
    const filter = { patientUHID: "UH00000001", noteType: "intake", "noteData.__demo_io": `seed-${i}` };
    const payload = {
      patientUHID: "UH00000001",
      patientName: "JaiBhagwan",
      ipdNo:    "ADM-2026-0001",
      noteDate: when,
      shift:    r.shift,
      nurseName: r.nurse,
      noteType:  "intake",
      status:    "submitted",
      submittedAt: when,
      signedByName: r.nurse,
      remarks: r.data.notes || "",
      noteData: { ...r.data, __demo_io: `seed-${i}` },
    };
    const doc = await NurseNote.findOneAndUpdate(filter, payload, { upsert: true, new: true });
    console.log("upserted I/O", when.toISOString().slice(0, 16), r.shift, "→", doc._id.toString());
  }
  await mongoose.disconnect();
})();
