/* Seed extra procedure notes — one doctor, two nurse — on UH00000001 so
   the new Procedure Notes section shows both roles across two days. */
require("dotenv").config();
const mongoose = require("mongoose");
const NurseNote  = require("../models/Nurse/NurseNotesModel");
const DoctorNote = require("../models/Doctor/DoctorNotesModel");

const today = new Date(); today.setHours(0, 0, 0, 0);
const D = (off, h, m) => { const d = new Date(today); d.setDate(today.getDate() + off); d.setHours(h, m, 0, 0); return d; };

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // 1) Doctor procedure note — central-line insertion yesterday
  {
    const visitDate = D(-1, 14, 30);
    const filter = { patientUHID: "UH00000001", noteType: "procedure", "noteDetails.__demo_proc": "doc-cvc" };
    const payload = {
      patientUHID: "UH00000001",
      patientName: "JaiBhagwan",
      ipdNo:    "ADM-2026-0001",
      visitDate,
      shift:    "afternoon",
      doctorName: "Dr. Sandeep Kumar",
      doctorRegNo: "MCI-12345",
      noteType:  "procedure",
      status:    "signed",
      signedAt:  visitDate,
      signedByName: "Dr. Sandeep Kumar",
      signedByReg:  "MCI-12345",
      remarks: "CVC inserted in right IJV under USG guidance. ECG-guided tip placement. CXR ordered to confirm.",
      noteDetails: {
        procedureName: "Central Venous Catheter Insertion (Right IJV)",
        indication: "Inadequate peripheral access for inotrope infusion",
        site: "Right Internal Jugular Vein",
        laterality: "Right",
        time: "14:30",
        consentObtained: true,
        performedBy: "Dr. Sandeep Kumar",
        designation: "Consultant",
        assistant: "Dr. Priya Sharma (Resident)",
        sterile: true,
        position: "Trendelenburg",
        outcome: "Tolerated Well",
        complications: "None",
        specimenSent: false,
        postProcVitals: "BP 116/74 · Pulse 84 · SpO2 98%",
        followUp: "Confirm tip on CXR; daily dressing; remove in 7 days if not needed",
        __demo_proc: "doc-cvc",
      },
    };
    const r = await DoctorNote.findOneAndUpdate(filter, payload, { upsert: true, new: true });
    console.log("upserted doctor procedure →", r._id.toString());
  }

  // 2) Nurse procedure — RT/NG tube insertion today morning
  {
    const noteDate = D(0, 9, 45);
    const filter = { patientUHID: "UH00000001", noteType: "procedure", "noteData.__demo_proc": "ngt-insertion" };
    const payload = {
      patientUHID: "UH00000001",
      patientName: "JaiBhagwan",
      ipdNo:    "ADM-2026-0001",
      noteDate,
      shift:    "morning",
      nurseName: "Sunita Patil",
      noteType:  "procedure",
      status:    "submitted",
      submittedAt: noteDate,
      signedByName: "Sunita Patil",
      remarks: "NGT 16Fr inserted, position confirmed by gastric aspirate (pH 3) and auscultation. Secured with tape.",
      noteData: {
        procedureName: "Nasogastric Tube Insertion",
        indication: "Feed administration + gastric decompression",
        site: "Left nostril",
        laterality: "Left",
        time: "09:45",
        consentObtained: true,
        performedBy: "Sunita Patil",
        designation: "Staff Nurse",
        assistant: "Asha Pandey",
        sterile: false,
        position: "High Fowler",
        outcome: "Tolerated Well",
        complications: "None",
        specimenSent: true,
        specimenType: "Gastric aspirate (pH check)",
        postProcVitals: "BP 122/80 · Pulse 80 · SpO2 99%",
        followUp: "Verify position before each feed; check residual q4h",
        __demo_proc: "ngt-insertion",
      },
    };
    const r = await NurseNote.findOneAndUpdate(filter, payload, { upsert: true, new: true });
    console.log("upserted nurse procedure →", r._id.toString());
  }

  await mongoose.disconnect();
})();
