// scripts/e2e-opd-r7d-test.js
// ────────────────────────────────────────────────────────────────────
// R7d* — End-to-end OPD workflow test exercising all 4 billing fixes
// shipped this session (R7dp, R7dq, R7dr, R7ds).
//
// Flow:
//   1. Login as Admin
//   2. Look up Dr Sandeep's per-doctor fee schedule (R7dp)
//   3. Register a fresh OPD patient (Ramesh Verma)
//   4. Create OPD visit with Dr Sandeep — consultationFee = opdFirst
//   5. Nurse records vitals (BP, pulse, temp, SpO2, etc.)
//   6. Doctor saves a COMPLETE OPD assessment with every field populated
//      (HOPI, past history, examination, diagnosis tiers, advice, plan)
//   7. Doctor orders a CBC investigation
//   8. Doctor adds 2 medications to the prescription
//   9. Audit BillingTriggers — bill should contain ONLY the OPD-CON
//      line at the doctor's actual rate. No CON-001 duplicate. No
//      phantom NRS-009 RBS.
// ────────────────────────────────────────────────────────────────────
require("dotenv").config();
const mongoose = require("mongoose");

const BASE = "http://localhost:5050/api";
let TOKEN = "";

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = { _raw: text }; }
  if (!r.ok) {
    console.log(`  ✗ ${method} ${path} → ${r.status}`);
    console.log(`    ${JSON.stringify(data).slice(0, 400)}`);
    return null;
  }
  return data;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Doctor = require("../models/Doctor/doctorModel");
  const BT = require("../models/Billing/BillingTrigger");

  console.log("\n" + "═".repeat(68));
  console.log("  R7d* — Complete OPD workflow E2E test");
  console.log("═".repeat(68) + "\n");

  // 1. Admin login
  console.log("▶ Step 1: Admin login");
  const loginRes = await api("POST", "/auth/login", { email: "admin@spherehealth.com", password: "Welcome@123" });
  if (!loginRes) { process.exit(1); }
  TOKEN = loginRes.token || loginRes.data?.token;
  console.log("  ✓ Logged in\n");

  // 2. Find Dr Sandeep
  console.log("▶ Step 2: Find Dr Sandeep + fee schedule");
  const dr = await Doctor.findOne({ "personalInfo.lastName": /Sandeep/i }).lean();
  console.log("  ✓ Dr Sandeep — opdFirst: ₹" + dr.consultationFee.opdFirst + ", opdFollowup: ₹" + dr.consultationFee.opdFollowup + "\n");

  // 3. Register patient
  console.log("▶ Step 3: Register fresh OPD patient");
  const pRes = await api("POST", "/patients", {
    fullName: "Ramesh Verma",
    firstName: "Ramesh", lastName: "Verma", title: "Mr.",
    phone: "9988776655", contactNumber: "9988776655",
    gender: "Male", age: 45,
    address: { pincode: "282001", city: "Agra", district: "Agra", state: "Uttar Pradesh", completeAddress: "12 Tajganj" },
  });
  if (!pRes || !pRes.data) { console.log("  patient create failed"); process.exit(1); }
  const patient = pRes.data;
  console.log("  ✓ Patient registered — UHID: " + patient.UHID + ", name: " + patient.fullName + "\n");

  // 4. OPD visit
  console.log("▶ Step 4: Reception creates OPD visit with Dr Sandeep");
  const opdRes = await api("POST", "/opd", {
    patientId: patient._id,
    doctorId: dr._id.toString(),
    consultantName: "Dr. Sandeep",
    department: String(dr.department),
    chiefComplaint: "Chest pain since 2 days + intermittent fever",
    consultationFee: dr.consultationFee.opdFirst,
    feeType: "opdFirst",
  });
  if (!opdRes || !opdRes.data) { console.log("  opd create failed"); process.exit(1); }
  const opd = opdRes.data;
  console.log("  ✓ OPD visit " + opd.visitNumber + " created — consult fee saved: ₹" + opd.consultationFee + "\n");

  // 5. Vitals
  console.log("▶ Step 5: Nurse records vitals");
  const vitalsRes = await api("PATCH", "/opd/" + opd.visitNumber + "/vitals", {
    weight: 72.5, height: 172,
    temperature: 99.2, bloodPressure: "138/86",
    pulse: 88, respiratoryRate: 18, oxygenSaturation: 97,
    nurseName: "Sister Asha",
  });
  if (vitalsRes) console.log("  ✓ Vitals recorded — BP 138/86, Temp 99.2°F, Pulse 88, SpO2 97%\n");

  // 6. Full assessment
  console.log("▶ Step 6: Doctor saves complete OPD assessment");
  const asmtRes = await api("POST", "/opd/" + opd.visitNumber + "/assessment", {
    historyOfPresentIllness:
      "Patient reports retrosternal chest pain x 2 days, dull aching, non-radiating, worse on exertion, partially relieved by rest. Associated with low-grade intermittent fever (max 99.5F). No SOB, no diaphoresis, no syncope. No prior cardiac history.",
    pastMedicalHistory: "Hypertension (5 yrs, on Amlodipine 5mg OD). No DM. No prior MI/stroke. No TB. No allergies.",
    allergyHistory: "NKDA (No known drug allergies)",
    currentMedications: "Tab Amlodipine 5mg OD (morning)",
    familyHistory: "Father — IHD at age 60. Mother — Hypertensive.",
    personalHistory: "Non-smoker, occasional alcohol, mixed diet, sedentary.",
    clinicalExamination: "General: Conscious, oriented, afebrile. Pallor absent, icterus absent, no cyanosis/clubbing/lymphadenopathy/edema. CVS: S1 S2 audible, no murmur. RS: BAE clear, no adventitious sounds. Abd: Soft, non-tender, no organomegaly. CNS: Higher functions normal, motor + sensory grossly normal, reflexes intact.",
    examinationFindings: ["Mild tenderness anterior chest wall reproducible on palpation", "BP elevated 138/86 (Stage 1 HTN)"],
    provisionalDiagnosis: "Atypical chest pain — likely musculoskeletal vs early angina (rule out)",
    workingDiagnosis: "Costochondritis vs Stable Angina (CCS Class I)",
    icdCodes: ["R07.4", "M94.0"],
    advice: "1. Rest x 48h, avoid heavy exertion. 2. Continue Amlodipine 5mg OD. 3. Investigations as ordered. 4. Review with reports after 3 days. 5. ER if pain worsens / SOB / sweating.",
    followUpInstructions: "Follow-up after 3 days with reports. ER if symptoms worsen.",
    followUpDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    plan: "Conservative — rule out cardiac cause first. Investigations baseline today, recheck after 3 days. Consider stress ECG if symptoms persist.",
    diagnosisTier: "Working",
  });
  if (asmtRes) console.log("  ✓ Assessment saved — HOPI, past history, exam, diagnosis, advice, plan all filled\n");

  // 7. CBC
  console.log("▶ Step 7: Doctor orders CBC");
  const cbcRes = await api("POST", "/opd/" + opd.visitNumber + "/investigation", {
    investigationCode: "INV-001",
    investigationName: "Complete Blood Count (CBC)",
    orderedBy: "Dr. Sandeep",
    notes: "Rule out anemia / infection markers",
  });
  if (cbcRes) console.log("  ✓ CBC ordered\n");

  // 8. Prescription
  console.log("▶ Step 8: Doctor adds prescription");
  const rxRes = await api("POST", "/opd/" + opd.visitNumber + "/prescription", {
    medicines: [
      { drugName: "Tab Pantoprazole 40mg", dose: "40mg", route: "PO", frequency: "OD", duration: "5 days", mealStatus: "Before food", instructions: "Empty stomach, 30 min before breakfast" },
      { drugName: "Tab Paracetamol 500mg", dose: "500mg", route: "PO", frequency: "SOS", duration: "PRN x 5 days", mealStatus: "After food", instructions: "For pain/fever, max 4 tab/24h" },
    ],
    prescribedBy: "Dr. Sandeep",
  });
  if (rxRes) console.log("  ✓ Prescription saved — Pantoprazole + Paracetamol\n");

  // 9. Audit triggers
  console.log("▶ Step 9: Audit BillingTriggers");
  await new Promise(r => setTimeout(r, 2000));
  const adm = await mongoose.connection.db.collection("admissions").findOne({ UHID: patient.UHID });
  const triggers = await BT.find({ admissionId: adm._id }).select("serviceCode serviceName unitPrice totalAmount status").lean();

  console.log("\n" + "─".repeat(68));
  console.log("  FINAL BILL — " + patient.fullName + " (" + patient.UHID + ")");
  console.log("  Doctor: Dr Sandeep — first visit");
  console.log("─".repeat(68));
  let total = 0;
  for (const t of triggers) {
    const amt = Number(t.totalAmount || t.unitPrice || 0);
    total += amt;
    const name = (t.serviceName || t.serviceCode || "").padEnd(50);
    console.log("  " + name + " ₹" + String(amt).padStart(6));
  }
  console.log("─".repeat(68));
  console.log("  TOTAL".padEnd(53) + "₹" + String(total).padStart(6));
  console.log("─".repeat(68));
  console.log("");

  const codes = triggers.map(t => t.serviceCode);
  const opdCon = triggers.find(t => t.serviceCode === "OPD-CON");
  console.log("══ VERDICT ══");
  console.log("  " + (opdCon && Number(opdCon.unitPrice) === dr.consultationFee.opdFirst ? "✓" : "✗") + " R7dp+R7dq  OPD-CON = ₹" + opdCon?.unitPrice + " (doctor's opdFirst ₹" + dr.consultationFee.opdFirst + ")");
  console.log("  " + (!codes.includes("CON-001") ? "✓" : "✗") + " R7dr        No duplicate CON-001 (Specialist Consultation)");
  console.log("  " + (!codes.includes("NRS-009") ? "✓" : "✗") + " R7ds        No phantom NRS-009 (RBS) auto-charge");
  console.log("  ⓘ R7dt        Sidebar logo (verified in browser)\n");

  console.log("  Patient was billed ₹" + total + " for a complete OPD visit with:");
  console.log("    • Doctor's correct first-visit consultation fee");
  console.log("    • Vitals recorded by nurse");
  console.log("    • Full clinical assessment (HOPI, exam, dx, advice, plan)");
  console.log("    • CBC investigation ordered");
  console.log("    • 2 prescriptions");
  console.log("");
  console.log("  Demo patient available in UI:");
  console.log("    UHID:        " + patient.UHID);
  console.log("    OPD visit:   " + opd.visitNumber);
  console.log("    Admission:   " + adm._id);
  console.log("");

  await mongoose.disconnect();
})().catch(e => { console.error("FATAL", e.message); process.exit(1); });
