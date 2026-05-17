/* One-shot demo: inject a blood-transfusion nurse note for UH00000001 so
   the new Patient File panel is visible. Idempotent. */
require("dotenv").config();
const mongoose = require("mongoose");
const NurseNote = require("../models/Nurse/NurseNotesModel");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const filter = { patientUHID: "UH00000001", noteType: "blood", "noteData.bagNo": "B-2026-0517-A" };
  const payload = {
    patientUHID: "UH00000001",
    patientName: "JaiBhagwan",
    ipdNo:    "ADM-2026-0001",
    noteDate: new Date(),
    shift:    "morning",
    nurseName: "Sunita Patil",
    noteType:  "blood",
    status:    "submitted",
    submittedAt: new Date(),
    signedByName: "Sunita Patil",
    remarks: "PRC transfusion started. Pre-vitals stable. No reaction so far.",
    noteData: {
      product: "PRC (Packed RBC)",
      bagNo: "B-2026-0517-A",
      crossMatchNo: "CM-2026-0517",
      volume: "350",
      groupVerified: true,
      secondNurse: "Asha P.",
      startTime: "09:30",
      endTime: "12:45",
      status: "Completed",
      reactionType: "None",
      preBP_sys: "120", preBP_dia: "78", prePulse: "82", preTemp: "98.4",
      intra: [
        { atMin: 15, bp_sys: "122", bp_dia: "80", pulse: "84", temp: "98.6" },
        { atMin: 30, bp_sys: "120", bp_dia: "78", pulse: "82", temp: "98.4" },
        { atMin: 60, bp_sys: "118", bp_dia: "76", pulse: "80", temp: "98.4" },
      ],
      postBP_sys: "118", postBP_dia: "76", postPulse: "80",
    },
  };
  const r = await NurseNote.findOneAndUpdate(filter, payload, { upsert: true, new: true });
  console.log("upserted blood demo:", r._id.toString());
  await mongoose.disconnect();
})();
