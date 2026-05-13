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
import PRINTABLES from "../../Components/print/printables";
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
    receiptNo: "PAY-2026-01108",
    patientName: "Demo Patient", uhid: "UH00000099", ipdNo: "IPD-2026-0042",
    amount: 5000,
    method: "card", refNo: "TXN-0099887", cardLast4: "4242",
    receivedBy: "Cashier · System Admin",
    purpose: "IPD running bill — partial payment",
    runningBalance: 12350,
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
    // 3) demo fallback when preview mode is requested
    if (search.get("demo") === "1") return DEMO[slug] || {};
    return null;
  }, [slug, search]);

  const { settings, ready } = useHospitalSettings();

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
  if (!ready) {
    return (
      <PrintPreviewPage toolbarTitle="Loading…" defaultPaper={cfg.defaultPaper}>
        <div className="pr-page" style={{ textAlign: "center", color: "#64748b" }}>
          Loading hospital settings…
        </div>
      </PrintPreviewPage>
    );
  }
  return (
    <PrintPreviewPage toolbarTitle={cfg.title} defaultPaper={cfg.defaultPaper}>
      <Component settings={settings} receipt={payload || {}} />
    </PrintPreviewPage>
  );
};

export default PrintRouterPage;
