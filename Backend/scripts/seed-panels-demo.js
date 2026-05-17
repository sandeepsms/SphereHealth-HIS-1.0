/* One-shot demo: inject one nurse note for each panel type on UH00000001
   so all the new Patient File panels (IV, Wound, Pain, Neuro, Procedure,
   SBAR) can be visually verified end-to-end. Idempotent. */
require("dotenv").config();
const mongoose = require("mongoose");
const NurseNote = require("../models/Nurse/NurseNotesModel");

const NOTES = [
  { noteType: "iv",        noteData: { fluid: "NS 0.9%", volume: "1000", rate: "100", dropsPerMin: "33", route: "IV Right Forearm", site: "Patent", condition: "Patent", cannulaDate: "2026-05-15", setChangeDate: "2026-05-17", additive: "Inj. KCl 20 mEq" }, remarks: "IV line patent, no infiltration." },
  { noteType: "wound",     noteData: { type: "Surgical", site: "Right lower abdomen", length: "5", width: "2", depth: "1", exudateAmt: "Moderate", exudateType: "Serous", healingStage: "Granulating", surroundingSkin: "Intact", tunneling: false, undermining: false, odour: false, dressing: "Hydrocolloid · changed Q72h", swabSent: false, nextDressingDate: "2026-05-20" }, remarks: "Clean granulating wound." },
  { noteType: "pain",      noteData: { scale: "NRS", score: 7, location: "Right lower quadrant", type: "Acute", character: "Stabbing", onset: "Sudden", duration: "2 hours", frequency: "Constant", radiation: false, aggravating: "Movement, coughing", relieving: "Rest", painOnMovement: true, nonPharm: "Position change", analgesicGiven: true, analgesic: "Inj. Tramadol 50 mg", analgesicRoute: "IV", analgesicTime: "09:30", reassessScore: 3, reassessTime: "10:00" }, remarks: "Pain reduced after analgesic." },
  { noteType: "neuro",     noteData: { gcse: 4, gcsv: 5, gcsm: 6, pupils: "Equal & Reactive", pupilSizeL: "3", pupilSizeR: "3", lightReflex: "Present", seizure: false, orientation: "Alert & Oriented ×3", limbUL: "5/5", limbUR: "5/5", limbLL: "5/5", limbLR: "5/5" }, remarks: "Neurologically intact." },
  { noteType: "procedure", noteData: { procedureName: "Foley Catheterisation", indication: "Acute urinary retention", site: "Urethra", laterality: "N/A", time: "08:15", consentObtained: true, performedBy: "Sunita Patil", designation: "Staff Nurse", assistant: "Asha P.", sterile: true, position: "Supine", outcome: "Tolerated Well", complications: "None", specimenSent: true, specimenType: "Urine culture", postProcVitals: "BP 122/80 · Pulse 80", followUp: "Monitor urine output hourly, check site for blood in 30 min" }, remarks: "16Fr Foley inserted aseptically. 400 mL clear urine drained." },
  { noteType: "discharge", noteData: { type: "Shift Handover", situation: "Post-op day 2 hemicolectomy, currently stable", background: "55 y/o male, HTN, op'd on 15 May for sigmoid CA", assessment: "Vitals stable. Pain controlled. Tolerating clear liquids. Ambulating with assist.", recommendation: "Continue Tramadol PRN, advance diet as tolerated, encourage early ambulation, watch for ileus.", incomingNurse: "Asha P.", patientStatus: "Stable", educationGiven: true, educationTopics: "Wound care, mobility, signs to report", followUpDate: "2026-05-18", valuablesHandedOver: false }, remarks: "Calm handover." },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  for (const n of NOTES) {
    const filter = { patientUHID: "UH00000001", noteType: n.noteType, "noteData.__demo": "patient-file-panels" };
    const payload = {
      patientUHID: "UH00000001",
      patientName: "JaiBhagwan",
      ipdNo:    "ADM-2026-0001",
      noteDate: new Date(),
      shift:    "morning",
      nurseName: "Sunita Patil",
      noteType:  n.noteType,
      status:    "submitted",
      submittedAt: new Date(),
      signedByName: "Sunita Patil",
      remarks: n.remarks,
      noteData: { ...n.noteData, __demo: "patient-file-panels" },
    };
    const r = await NurseNote.findOneAndUpdate(filter, payload, { upsert: true, new: true });
    console.log("upserted", n.noteType, "→", r._id.toString());
  }
  await mongoose.disconnect();
})();
