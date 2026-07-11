// pages/print/PrintRouterPage.jsx
// Renders the right printable for the URL slug, with paper-size
// toolbar on top. The data is passed via:
//   1. sessionStorage key `printPayload-<slug>` (set by the caller
//      that opened this window), OR
//   2. query string `?data=<base64 JSON>` (small payloads only), OR
//   3. an empty stub when neither is present (renders the layout
//      with placeholder data — useful for design preview).

import React, { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import useHospitalSettings from "../../Components/print/useHospitalSettings";
import PrintPreviewPage from "../../Components/print/PrintPreviewPage";
import { PrintFooterContext } from "../../Components/print/PrintShell";
import PRINTABLES from "../../Components/print/printables";
import { useEnrichedPrintPayload } from "../../Components/print/printEnrichment";
import "../../Components/print/print.css";

/* Demo data used when no payload is supplied (visual preview only). */
const DEMO = {
  "opd-receipt": {
    receiptNo: "OPD-2026-00042",
    patientName: "Demo Patient",
    uhid: "UH00000099", age: 32, gender: "Male",
    doctorName: "Dr. Sandeep Kumar", department: "General Medicine",
    visitDate: new Date().toISOString(),
    items: [
      { name: "Consultation Fee · General Medicine", qty: 1, rate: 500, amount: 500 },
      { name: "Blood Pressure Check", qty: 1, rate: 100, amount: 100 },
      { name: "ECG", description: "12-lead",       qty: 1, rate: 350, amount: 350 },
    ],
    discount: 50, tax: 0,
    paymentMethod: "upi", paymentRef: "UPI/24913XX",
  },
  "payment-receipt": {
    // R7hb — demo now shows the short format + dynamic visit-No label.
    // OPD receipt (most common): PAY-BILL-26-08-P1 / UH08 / OPD-26-08.
    receiptNo: "BILL-26-08-P1",
    patientName: "Demo Patient", uhid: "UH08",
    visitType: "OPD", visitNo: "OPD-26-08",
    amount: 5000,
    method: "card", refNo: "TXN-0099887", cardLast4: "4242",
    receivedBy: "Cashier · System Admin",
    purpose: "OPD bill — full settlement",
    runningBalance: 0,
  },
  "advance-receipt": {
    receiptNo: "ADV-2026-00012",
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    admissionDate: new Date().toISOString(),
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    amount: 20000, method: "cash",
    depositPurpose: "general hospitalization advance",
    estimatedCost: 75000,
  },
  "opd-prescription": {
    rxNo: "RX-2026-00891",
    patientName: "Demo Patient", uhid: "UH00000099",
    age: 42, gender: "Male", mobile: "+91-9876543210",
    doctorName: "Dr. Sandeep Kumar", doctorReg: "MCI-12345",
    department: "General Medicine",
    visitDate: new Date().toISOString(),
    vitals: { bp: "138/86", pulse: 88, temp: 99.2, spo2: 97, rr: 18, weight: 78, height: 174, bmi: "25.8" },
    chiefComplaints: "Fever × 3 days · headache · body ache.\nNo cough, no chest pain.",
    history: "Patient working in field, no prior co-morbidities. No recent travel history.",
    provisionalDx: "Viral pyrexia",
    icd10: "B34.9", icd10Desc: "Viral infection, unspecified",
    drugs: [
      { name: "Tab Paracetamol",  generic: "Paracetamol 650mg",  dose: "1 tab", frequency: "TDS",    duration: "5 days", instructions: "After food" },
      { name: "Tab Cetrizine",    generic: "Cetirizine 10mg",    dose: "1 tab", frequency: "HS",     duration: "5 days", instructions: "At bedtime" },
      { name: "Cap Pantoprazole", generic: "Pantoprazole 40mg",  dose: "1 cap", frequency: "OD",     duration: "5 days", instructions: "Before breakfast" },
      { name: "Syp Cremaffin",    generic: "Liquid paraffin + MOM", dose: "15 ml", frequency: "HS",  duration: "3 days", instructions: "If constipation" },
    ],
    investigations: [
      { name: "CBC + ESR",        notes: "If fever persists > 5 days" },
      { name: "Dengue NS1 + IgM/IgG", urgent: true },
      { name: "Urine Routine + Microscopy" },
    ],
    advice: [
      "Plenty of oral fluids — at least 3 litres/day",
      "Light, easily digestible diet — avoid oily food",
      "Adequate rest · avoid strenuous activity",
      "Tepid sponging if temperature crosses 101°F",
      "Return immediately if rash, bleeding, severe headache, or breathlessness develops",
    ],
    followUpDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    followUpNotes: "Bring this prescription and investigation reports.",
  },
  "final-bill": {
    billNo: "BILL-2026-00234",
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    age: 58, gender: "Male",
    admissionDate: new Date(Date.now() - 4 * 86400000).toISOString(),
    dischargeDate: new Date().toISOString(),
    totalDays: 4,
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    consultantName: "Dr. Sandeep Kumar",
    finalDiagnosis: "Acute gastroenteritis with mild dehydration",
    tpaName: "Self-paying",
    items: [
      { category: "Room/Bed Charges",       name: "General Ward · per day", qty: 4, rate: 1500, amount: 6000 },
      { category: "Doctor / Consultant Fees", name: "Daily round · Dr. Sandeep Kumar", qty: 4, rate: 500, amount: 2000 },
      { category: "Doctor / Consultant Fees", name: "Specialist consultation · Dr. Verma", qty: 1, rate: 800, amount: 800 },
      { category: "Nursing Charges",         name: "Nursing care · 24-hr",   qty: 4, rate: 400,  amount: 1600 },
      { category: "Investigations / Lab",    name: "CBC", qty: 1, rate: 350, amount: 350 },
      { category: "Investigations / Lab",    name: "Electrolytes (Na, K, Cl)", qty: 1, rate: 600, amount: 600 },
      { category: "Investigations / Lab",    name: "Stool routine + culture", qty: 1, rate: 450, amount: 450 },
      { category: "Pharmacy / Medications",  name: "Ondansetron inj × 6", qty: 6, rate: 45, amount: 270 },
      { category: "Pharmacy / Medications",  name: "IV fluids (RL, NS) × 8", qty: 8, rate: 85, amount: 680 },
      { category: "Pharmacy / Medications",  name: "Ciprofloxacin inj × 4", qty: 4, rate: 120, amount: 480 },
      { category: "Consumables / Disposables", name: "IV cannula", qty: 2, rate: 80, amount: 160 },
      { category: "Consumables / Disposables", name: "Syringe + needles", qty: 12, rate: 15, amount: 180 },
    ],
    discount: 500, tax: 0,
    advanceReceived: 5000,
    payments: [
      { date: new Date(Date.now() - 3 * 86400000).toISOString(), method: "cash", refNo: "ADV-2026-00012", amount: 5000 },
    ],
  },
  "ipd-file": {
    ipdNo: "IPD-2026-0042",
    patientName: "Mr. Demo Patient", uhid: "UH00000099",
    age: 58, gender: "Male", mobile: "+91-9876543210",
    bloodGroup: "B+",
    admissionDate: new Date(Date.now() - 4 * 86400000).toISOString(),
    dischargeDate: new Date().toISOString(),
    totalDays: 4,
    consultantName: "Dr. Sandeep Kumar",
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    admissionType: "Emergency",
    modeOfArrival: "Self / walk-in",
    referringDoctor: "Dr. Mehta · local GP",
    provisionalDiagnosis: "Acute gastroenteritis",
    workingDiagnosis: "AGE with mild dehydration",
    finalDiagnosis: "Acute gastroenteritis with mild dehydration",
    icd10: "A09", icd10Desc: "Infectious gastroenteritis and colitis, unspecified",
    allergies: ["Sulfa drugs"],
    isolationFlags: [],
    chiefComplaints: "Loose motions × 8-10 episodes/day for 2 days\nVomiting × 4 episodes\nGeneralised weakness",
    history: "Patient ate from a street-side eatery 3 days ago. Symptoms started next morning.\nNo blood or mucus in stools. No fever.",
    medicalHistory: "Type-2 DM × 8 years (on Metformin 500 BD). HTN × 5 years (on Telmisartan 40 OD).",
    surgicalHistory: "Appendectomy · 2009",
    familyHistory: "Father — DM, HTN. Mother — alive, well.",
    socialHistory: "Non-smoker. Occasional alcohol. Vegetarian.",
    vitalsOnAdmission: { bp: "92/68", pulse: 112, temp: 98.4, spo2: 98, rr: 22, weight: 76, height: 174, bmi: "25.1" },
    investigations: [
      { name: "CBC",              orderedAt: new Date(Date.now() - 4 * 86400000), reportedAt: new Date(Date.now() - 4 * 86400000 + 3600000), result: "Hb 13.4 · WBC 11200 · Platelets 245000" },
      { name: "Electrolytes",     orderedAt: new Date(Date.now() - 4 * 86400000), reportedAt: new Date(Date.now() - 4 * 86400000 + 3600000), result: "Na 132 · K 3.2 · Cl 98 (mild hyponatremia + hypokalemia)" },
      { name: "Stool routine",    orderedAt: new Date(Date.now() - 4 * 86400000), reportedAt: new Date(Date.now() - 3 * 86400000), result: "RBC nil, WBC 4-6/hpf, no parasites" },
      { name: "Stool culture",    orderedAt: new Date(Date.now() - 4 * 86400000), reportedAt: new Date(Date.now() - 2 * 86400000), result: "No growth after 48h" },
    ],
    medications: [
      { drug: "Inj Ondansetron",   dose: "4mg", route: "IV",   frequency: "TDS", startDate: new Date(Date.now() - 4*86400000), endDate: new Date(Date.now() - 1*86400000), indication: "Vomiting" },
      { drug: "Inj Ciprofloxacin", dose: "200mg", route: "IV", frequency: "BD",  startDate: new Date(Date.now() - 3*86400000), endDate: new Date(Date.now() - 1*86400000), indication: "Empirical antibiotic" },
      { drug: "IV Fluids RL",      dose: "500ml", route: "IV", frequency: "Q8H", startDate: new Date(Date.now() - 4*86400000), endDate: new Date(Date.now() - 2*86400000), indication: "Rehydration" },
      { drug: "Tab Loperamide",    dose: "2mg",   route: "PO", frequency: "After each loose stool", startDate: new Date(Date.now() - 4*86400000), endDate: new Date(Date.now() - 1*86400000), indication: "Anti-diarrheal" },
    ],
    doctorNotes: [
      { noteType: "Initial Assessment", shift: "morning", createdAt: new Date(Date.now() - 4 * 86400000), doctorName: "Dr. Sandeep Kumar", content: "Admitted via emergency. Started IV fluids, ondansetron, empirical ciprofloxacin. Monitor I/O." },
      { noteType: "Daily Progress",     shift: "morning", createdAt: new Date(Date.now() - 2 * 86400000), doctorName: "Dr. Sandeep Kumar", content: "Loose motions reduced to 2-3/day. Vomiting stopped. Tolerating oral fluids. Continue current regime." },
      { noteType: "Discharge Note",     shift: "evening", createdAt: new Date(), doctorName: "Dr. Sandeep Kumar", content: "Patient is afebrile, tolerating diet, stools formed. Fit for discharge." },
    ],
    nursingNotes: [
      { noteType: "Vitals",  shift: "morning", createdAt: new Date(Date.now() - 4 * 86400000), nurseName: "Sister Priya",   content: "BP 92/68, HR 112, SpO2 98%, T 98.4°F. Mild dehydration noted." },
      { noteType: "Intake/Output", shift: "evening", createdAt: new Date(Date.now() - 3 * 86400000), nurseName: "Sister Asha", content: "Intake 2200ml. Output 1800ml. 4 loose stools." },
    ],
    procedures: [],
    consents: [
      { name: "General Admission Consent", signed: true, signedAt: new Date(Date.now() - 4 * 86400000), signedBy: "Demo Patient", witness: "Sister Priya" },
      { name: "Cashless / TPA Authorization", signed: false },
    ],
    dischargeSummary: "Patient admitted with acute gastroenteritis and mild dehydration. Started on IV fluids, antiemetics, and empirical antibiotic coverage. Stool studies negative for pathogens. Symptoms resolved by Day 3. Tolerating oral diet by Day 4. Discharged in stable condition.",
    dischargeAdvice: "1. Tab Norfloxacin 400 BD × 3 days more.\n2. ORS sachets as needed.\n3. Light diet · avoid spicy / oily food × 1 week.\n4. Continue regular diabetic & antihypertensive medication.\n5. Return immediately if recurrence of symptoms or fever.",
    followUpDate: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
  "discharge-summary": {
    summaryNo: "DS-2026-00125",
    patientName: "Mr. Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    age: 58, gender: "Male",
    admissionDate: new Date(Date.now() - 4 * 86400000).toISOString(),
    dischargeDate: new Date().toISOString(),
    totalDays: 4,
    consultantName: "Dr. Sandeep Kumar",
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    dischargeType: "Normal",
    finalDiagnosis: "Acute gastroenteritis with mild dehydration",
    icd10: "A09", icd10Desc: "Infectious gastroenteritis and colitis, unspecified",
    secondaryDiagnoses: "Type-2 Diabetes Mellitus (controlled)\nEssential Hypertension (controlled)",
    chiefComplaints: "Loose motions × 8-10 episodes/day for 2 days, vomiting × 4 episodes, generalised weakness.",
    courseOfStay: "Patient admitted in emergency with mild dehydration. Started on IV fluids, antiemetics, and empirical ciprofloxacin. Symptoms resolved by Day 3. Tolerating oral diet by Day 4. Stool culture was negative. Discharged in stable condition.",
    proceduresDone: [],
    investigationsSummary: "CBC: Hb 13.4, WBC 11200, Platelets 245000.\nElectrolytes: Na 132, K 3.2, Cl 98 (mild hyponatremia + hypokalemia, corrected).\nStool routine + culture: no significant pathogens.",
    conditionOnDischarge: "Stable",
    dischargeMeds: [
      { name: "Tab Norfloxacin", generic: "Norfloxacin 400mg", dose: "1 tab", frequency: "BD",  duration: "3 days", instructions: "After food" },
      { name: "Tab Pantoprazole",generic: "Pantoprazole 40mg",  dose: "1 tab", frequency: "OD",  duration: "5 days", instructions: "Before breakfast" },
      { name: "ORS sachets",     generic: "WHO ORS",            dose: "1 sachet in 1L water", frequency: "PRN", duration: "PRN", instructions: "Sip slowly if loose stools" },
      { name: "Tab Metformin",   generic: "Metformin 500mg",    dose: "1 tab", frequency: "BD",  duration: "Continued", instructions: "Resume regular dose" },
    ],
    advice: [
      "Plenty of oral fluids — at least 3 L/day until stools formed",
      "Light diet — avoid spicy, oily, street food × 1 week",
      "Continue regular diabetic and antihypertensive medication",
      "Maintain personal hygiene; wash hands before meals and after toilet",
      "Monitor blood sugar at home and report values above 200 or below 70",
    ],
    dietAdvice: "Soft / bland diet for first 3 days — khichdi, curd-rice, banana, toast. Gradual return to normal diet.",
    followUpDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    followUpDoctor: "Dr. Sandeep Kumar · General Medicine OPD",
  },
  "cost-estimate": {
    estimateNo: "EST-2026-00056",
    patientName: "Demo Patient", uhid: "UH00000099",
    age: 52, gender: "Male",
    procedure: "Laparoscopic Cholecystectomy",
    wardClass: "Private Room · Premium",
    consultantName: "Dr. Surgical · MS (General Surgery)",
    estimatedDays: 3,
    items: [
      { category: "Room/Bed Charges", name: "Private Room × 3 days",      qty: 3, rate: 4500, amount: 13500 },
      { category: "Doctor / Consultant Fees", name: "Surgeon's fees",     qty: 1, rate: 25000, amount: 25000 },
      { category: "Doctor / Consultant Fees", name: "Anesthetist's fees", qty: 1, rate: 8000,  amount: 8000  },
      { category: "Doctor / Consultant Fees", name: "Daily rounds",       qty: 3, rate: 800,   amount: 2400  },
      { category: "Procedure / OT Charges",   name: "OT charges · Laparoscopy",          qty: 1, rate: 15000, amount: 15000 },
      { category: "Procedure / OT Charges",   name: "Disposables · trocars + clips",     qty: 1, rate: 8500,  amount: 8500  },
      { category: "Investigations / Lab",     name: "Pre-op work-up · CBC, LFT, KFT, INR", qty: 1, rate: 2200, amount: 2200 },
      { category: "Investigations / Lab",     name: "USG abdomen",       qty: 1, rate: 1500, amount: 1500 },
      { category: "Investigations / Lab",     name: "ECG · pre-anesthesia",qty: 1, rate: 350, amount: 350 },
      { category: "Pharmacy / Medications",   name: "Estimated pharmacy bill", qty: 1, rate: 4500, amount: 4500 },
      { category: "Nursing Charges",          name: "Nursing care × 3 days",   qty: 3, rate: 600,  amount: 1800 },
      { category: "Other Charges",            name: "Bio-medical waste, MRD, admin", qty: 1, rate: 1500, amount: 1500 },
    ],
    tax: 0,
  },
  "pharmacy-bill": {
    billNumber: "PHM-20260514-0042",
    createdAt: new Date().toISOString(),
    patientName: "Demo Patient", patientUHID: "UH00000099",
    age: 52, gender: "Male", contactNumber: "+91-9876512340",
    doctorName: "Dr. Sandeep Kumar",
    admissionNumber: "ADM-2026-0001",
    saleType: "IPD", paymentMode: "Credit",
    createdBy: "Pharmacist · Mr. Sharma",
    items: [
      { drugName: "Paracetamol 500mg", strength: "500mg · Tablet",  hsnCode: "30049011", batchNo: "PAR-20260514-0335", expiryDate: "2027-09-01", quantity: 30, unitPrice: 2.5,  gstRate: 12, discountPercent: 0, schedule: "OTC" },
      { drugName: "Azithromycin 500mg",strength: "500mg · Tablet",  hsnCode: "30049099", batchNo: "AZI-20260514-0102", expiryDate: "2027-06-15", quantity: 5,  unitPrice: 78,   gstRate: 12, discountPercent: 5, schedule: "H"   },
      { drugName: "Insulin Actrapid", strength: "40 IU/mL · 10mL",  hsnCode: "30043910", batchNo: "ACT-20260514-1701", expiryDate: "2026-12-31", quantity: 1,  unitPrice: 165,  gstRate: 5,  discountPercent: 0, schedule: "H"   },
      { drugName: "Pantoprazole 40mg",strength: "40mg · Tablet",    hsnCode: "30049079", batchNo: "PAN-20260514-0822", expiryDate: "2028-02-28", quantity: 10, unitPrice: 8.5,  gstRate: 12, discountPercent: 0, schedule: "H"   },
    ],
    subTotal: 745, totalDiscount: 19.5, totalTaxable: 725.5, totalGst: 81.96,
    grandTotal: 807, amountPaid: 807, balanceDue: 0,
  },
  "refund-receipt": {
    receiptNo: "REF-2026-00007",
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    date: new Date().toISOString(),
    approvedBy: "Admin · System Admin",
    refundedBy: "Cashier · Reception Desk",
    amount: 3250, method: "cash", refNo: "REF/24913",
    reason: "Unutilised portion of advance deposit after final bill adjustment.",
    sourceReceiptNo: "ADV-2026-00012",
    sourceMethod: "Cash",
    sourceAmount: 20000,
    runningBalance: 0,
  },
  "consent-form": {
    consentNo: "CON-2026-01342",
    formType: "surgical",
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    age: 52, gender: "Male",
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    consultantName: "Dr. Surgical · MS (General Surgery)",
    procedure: "Laparoscopic Cholecystectomy",
    additionalRisks: "Specific risks discussed include: bleeding requiring transfusion, infection, conversion to open surgery, bile duct injury (rare), post-operative shoulder pain from gas insufflation, retained stones, and rare anesthesia complications.",
    language: "Hindi / English",
    counsellor: "Dr. Surgical (lead surgeon)",
    signatoryName: "Demo Patient", signatoryRelation: "Self",
    witnessName: "Sister Priya · Staff Nurse",
  },
  "medical-certificate": {
    certNo: "MC-2026-00214",
    certType: "sickness",
    patientName: "Demo Patient", uhid: "UH00000099",
    age: 32, gender: "Male",
    doctorName: "Dr. Sandeep Kumar", doctorReg: "MCI-12345",
    diagnosis: "Viral pyrexia · resolving",
    icd10: "B34.9",
    fromDate: new Date(Date.now() - 4 * 86400000).toISOString(),
    toDate:   new Date().toISOString(),
    days: 5,
    resumeDate: new Date(Date.now() + 1 * 86400000).toISOString(),
    treatment: "Symptomatic management — paracetamol, antiemetics, oral rehydration, rest.",
    purpose: "submission to employer for sick leave",
  },
  "referral-letter": {
    referralNo: "REF-LTR-2026-00041",
    date: new Date().toISOString(),
    patientName: "Demo Patient", uhid: "UH00000099",
    age: 65, gender: "Female", mobile: "+91-9876512340",
    referToDoctor: "Dr. Mehta",
    referToSpeciality: "Consultant Cardiologist",
    referToHospital: "MetroCare Heart Institute",
    referToAddress: "Sector 12, Sonipat — 131001",
    reason: "Specialist cardiology opinion",
    urgency: "Urgent",
    provisionalDiagnosis: "Acute Coronary Syndrome (NSTEMI · Killip class I)",
    clinicalSummary: "65 yr female presented with retrosternal chest pain × 4 hours, radiating to left arm, associated with diaphoresis. BP 142/90, HR 96. Bedside ECG: T-wave inversions in V4-V6. Troponin-I elevated (0.42 ng/ml).",
    investigationsDone: [
      { name: "ECG",         result: "T-inversions V4-V6, no ST elevation" },
      { name: "Troponin-I",  result: "0.42 ng/ml (positive)" },
      { name: "CBC + KFT + LFT", result: "Within normal limits" },
    ],
    treatmentGiven: "Loaded with Aspirin 300mg + Clopidogrel 300mg + Atorvastatin 80mg. Started on Heparin infusion. NTG sublingual given.",
    reasonForReferral: "Patient requires further evaluation including echocardiography and possible coronary angiography. Our facility does not have a 24/7 cath-lab.",
    doctorName: "Dr. Sandeep Kumar",
    doctorQualifications: "MD (Internal Medicine)", doctorReg: "MCI-12345",
    department: "General Medicine",
  },
  "visitor-pass": {
    passNo: "VP-2026-008912",
    patientName: "JaiBhagwan", uhid: "UH00000001",
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    buildingName: "BIMS", floorNumber: "1",
    issuedAt: new Date().toISOString(),
    validTill: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    visitorName: "Mr. Suresh Kumar",
    relation: "Brother",
    mobile: "+91-9876543210",
    idType: "Aadhaar",
    idNumber: "XXXX-XXXX-4242",
    visitingHours: "5:00 PM – 7:00 PM (daily)",
  },
  "mar-sheet": {
    marNo: "MAR-2026-00087",
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    age: 58, gender: "Male",
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    date: new Date().toISOString(),
    shift: "Morning",
    allergies: ["Sulfa drugs"],
    timeSlots: ["06:00", "10:00", "14:00", "18:00", "22:00"],
    medications: [
      {
        drug: "Inj Ondansetron", dose: "4mg", route: "IV", frequency: "TDS",
        startDate: new Date(Date.now() - 3 * 86400000), endDate: new Date(Date.now() + 1 * 86400000),
        indication: "Anti-emetic",
        administrations: {
          "06:00": { status: "Given", nurse: "Priya" },
          "14:00": { status: "Given", nurse: "Priya" },
          "22:00": { status: "Given", nurse: "Asha" },
        },
      },
      {
        drug: "Inj Ciprofloxacin", dose: "200mg", route: "IV", frequency: "BD",
        startDate: new Date(Date.now() - 2 * 86400000), endDate: new Date(Date.now() + 1 * 86400000),
        indication: "Anti-microbial",
        administrations: {
          "10:00": { status: "Given", nurse: "Priya" },
          "22:00": { status: "Given", nurse: "Asha" },
        },
      },
      {
        drug: "Tab Pantoprazole", dose: "40mg", route: "PO", frequency: "OD",
        startDate: new Date(Date.now() - 3 * 86400000), endDate: new Date(Date.now() + 1 * 86400000),
        indication: "Gastric protection",
        administrations: {
          "06:00": { status: "Given", nurse: "Priya" },
        },
      },
      {
        drug: "Tab Loperamide", dose: "2mg", route: "PO", frequency: "After each loose stool",
        startDate: new Date(Date.now() - 3 * 86400000), endDate: new Date(),
        indication: "Anti-diarrheal", notes: "Hold if &gt; 16 mg in 24h",
        administrations: {
          "10:00": { status: "Hold", nurse: "Priya" },
        },
      },
    ],
  },
  "doctor-order": {
    orderNo: "DO-2026-00514",
    ipdNo: "IPD-2026-0042",
    patientName: "Demo Patient", uhid: "UH00000099",
    age: 58, gender: "Male",
    bedNumber: "BIMS-1-MGW-B02", wardName: "Male General Ward",
    roundAt: new Date().toISOString(),
    consultantName: "Dr. Sandeep Kumar",
    allergies: ["Sulfa drugs"],
    clinicalSummary: "Patient afebrile · BP 122/78 · stools forming · tolerating oral diet. Plan: step down IV fluids, switch ciprofloxacin to PO, prepare for discharge tomorrow if symptoms continue to settle.",
    orders: [
      { drug: "Tab Ciprofloxacin", generic: "Ciprofloxacin 500mg", dose: "1 tab", route: "PO", frequency: "BD", duration: "3 days", stat: false, indication: "Step-down from IV" },
      { drug: "Tab Pantoprazole",  generic: "Pantoprazole 40mg",  dose: "1 tab", route: "PO", frequency: "OD", duration: "Continue", stat: false, indication: "Gastric protection" },
      { drug: "ORS sachets",       dose: "1 sachet/L", route: "PO", frequency: "PRN", duration: "PRN", stat: false, indication: "Diarrhea" },
      { drug: "Stop IV Fluids",    dose: "—", route: "—", frequency: "—", duration: "—", stat: true, indication: "Patient tolerating oral intake" },
    ],
    investigations: [
      { name: "Repeat CBC tomorrow morning" },
      { name: "Blood sugar fasting + PP", urgent: false, notes: "Fasting overnight" },
    ],
    diet: "Soft diet · low residue · avoid milk for 2 more days",
    restrictions: "No outside food. Limit fluid to 2 L/day.",
    standingOrders: "Inform doctor if temp > 100°F or HR > 110.\nInform doctor if any new vomiting or worsening of symptoms.",
    vitalsFrequency: "Q4H (Q6H if stable for 12h)",
    iOMonitor: "Strict I/O charting · target +500 ml/day",
    specialNote: "Patient is a known diabetic — capillary blood glucose Q6H, sliding-scale insulin per protocol if &gt; 200 mg/dL.",
  },
  "tpa-authorization": {
    requestNo: "TPA-AUTH-2026-00078",
    date: new Date().toISOString(),
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    age: 52, gender: "Male",
    policyNo: "POL-MEDI-CARE-987654321",
    tpaName: "MediCare TPA Services Pvt. Ltd.",
    tpaAddress: "B-12, Connaught Place, New Delhi - 110001",
    insurerName: "Star Health Insurance",
    corporateName: "Acme Industries Pvt Ltd",
    tpaCardNo: "MC-99887766",
    admissionDate: new Date().toISOString(),
    provisionalDiagnosis: "Symptomatic Gall Stone Disease (Cholelithiasis with chronic cholecystitis)",
    icd10: "K80.1",
    icd10Desc: "Calculus of gallbladder with other cholecystitis",
    proposedProcedure: "Laparoscopic Cholecystectomy",
    treatmentLine: "Surgical",
    pastHistory: "Hypertension × 4 years (Telmisartan 40 OD)",
    comorbidities: "Hypertension (controlled)",
    preExisting: "Nil — gallstones first detected 2 months ago",
    costBreakdown: [
      { label: "Room rent · Private × 3 days",       amount: 13500 },
      { label: "Surgeon's fees",                     amount: 25000 },
      { label: "Anesthetist's fees",                 amount: 8000  },
      { label: "OT charges + disposables",           amount: 23500 },
      { label: "Pre-op work-up",                     amount: 2200  },
      { label: "USG abdomen, ECG",                   amount: 1850  },
      { label: "Pharmacy (estimated)",               amount: 4500  },
      { label: "Daily rounds × 3",                   amount: 2400  },
      { label: "Nursing care × 3 days",              amount: 1800  },
      { label: "Bio-medical waste, MRD, admin",      amount: 1500  },
    ],
    totalEstimated: 84250,
    doctorName: "Dr. Surgical Kumar",
    doctorQualifications: "MS, MBBS (Gen Surgery)", doctorReg: "MCI-77889",
  },
};

function readPayload(slug) {
  try {
    const raw = sessionStorage.getItem(`printPayload-${slug}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

const PrintRouterPage = () => {
  const { slug = "" } = useParams();
  const [search] = useSearchParams();
  const cfg = PRINTABLES[slug];

  const payload = useMemo(() => {
    // 1) sessionStorage (preferred for large payloads)
    const fromSession = readPayload(slug);
    if (fromSession) return fromSession;
    // 2) ?data=base64(json)
    const q = search.get("data");
    if (q) {
      try { return JSON.parse(atob(q)); } catch { /* ignore */ }
    }
    // 3) demo fallback when preview mode is requested.
    // R7ft: theme-suffixed slugs like ipd-file-narrative reuse the
    // base slug's DEMO payload. The theme is detected from the URL by
    // CompleteIPDFile.jsx, not from a separate demo bucket.
    if (search.get("demo") === "1") {
      if (DEMO[slug]) return DEMO[slug];
      const baseSlug = slug.replace(/-(narrative|timeline|executive|audit|editorial)$/i, "");
      if (DEMO[baseSlug]) return DEMO[baseSlug];
      return {};
    }
    return null;
  }, [slug, search]);

  const { settings, ready } = useHospitalSettings();

  // R7hr — "no dashes on printouts". If the payload carries a UHID but is
  // missing standard patient/admission fields, backfill them from the API
  // before the template renders — otherwise the strip under the header
  // prints "—" wherever the calling page didn't hand-plumb a field.
  const { receipt, enriching } = useEnrichedPrintPayload(payload);

  if (!cfg) {
    return (
      <PrintPreviewPage toolbarTitle="Unknown printable">
        <div className="pr-page">
          <h2 style={{ color: "#dc2626" }}>Printable not found</h2>
          <p>No printable is registered for slug <code>{slug}</code>.</p>
          <p>Available: {Object.keys(PRINTABLES).map(k => <code key={k} style={{ marginRight: 8 }}>{k}</code>)}</p>
        </div>
      </PrintPreviewPage>
    );
  }

  const Component = cfg.component;

  // Per-payload paper/orientation override — lets the calling page honour
  // user-saved pharmacy settings (e.g. defaultPaper, registerOrientation)
  // without each caller having to roll its own preview window.
  // Computed BEFORE the loading branch so the toolbar mounts on the
  // correct defaults from the start (useState only uses the initial
  // value, so mounting the toolbar with `cfg.defaultPaper` first and
  // then re-rendering with `overridePaper` would silently keep the
  // first value — that's the bug the `key` prop below now prevents).
  const overridePaper  = payload?.defaultPaper
    || payload?.pharmacySettings?.defaultPaper
    || cfg.defaultPaper;
  const overrideOrient = payload?.defaultOrient
    || payload?.pharmacySettings?.registerOrientation
    || cfg.defaultOrient;

  if (!ready || enriching) {
    return (
      <PrintPreviewPage
        key={`loading-${overridePaper}-${overrideOrient}`}
        toolbarTitle="Loading…"
        defaultPaper={overridePaper}
        defaultOrient={overrideOrient}
      >
        <div className="pr-page" style={{ textAlign: "center", color: "#64748b" }}>
          {ready ? "Fetching patient details…" : "Loading hospital settings…"}
        </div>
      </PrintPreviewPage>
    );
  }

  return (
    <PrintPreviewPage
      key={`ready-${overridePaper}-${overrideOrient}`}
      toolbarTitle={cfg.title}
      defaultPaper={overridePaper}
      defaultOrient={overrideOrient}
      /* R7bf-F / A4-CRIT-4: every payload may carry a printAudit block.
         Callers opt in by setting payload.printAudit = { entityType,
         entityId, entityNumber, UHID, patientName }; the PreviewPage
         POSTs to /api/print-audit before window.print(). */
      printAudit={payload?.printAudit}
    >
      {/* R7hr(FOOTER-N): registry `footer: "neutral"` flows to PrintShell
          via context so clinical/operational printables drop the billing
          footer without each component threading a prop. */}
      <PrintFooterContext.Provider value={cfg.footer || "billing"}>
        <Component settings={settings} receipt={receipt || {}} />
      </PrintFooterContext.Provider>
    </PrintPreviewPage>
  );
};

export default PrintRouterPage;
