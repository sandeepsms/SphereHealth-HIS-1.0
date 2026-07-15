/**
 * services/Compliance/notifiableDiseases.js — NABH HIC/IMS + IDSP
 *
 * The statutorily notifiable communicable diseases (India, IDSP / state public-
 * health rules) keyed by ICD-10 code prefix. When a coded diagnosis on a
 * discharge summary (or elsewhere) matches, `matchNotifiable` returns the
 * disease so a NotifiableDiseaseRegister entry can be raised and the hospital
 * can report it to the district/IDSP authority within the statutory window.
 *
 * Prefix match: a diagnosis code "A90.0" matches the "A90" dengue prefix.
 */
"use strict";

// ICD-10 code prefix → { disease, timelineHours } (statutory reporting window).
const NOTIFIABLE = [
  { prefix: "A00", disease: "Cholera", hours: 24 },
  { prefix: "A01", disease: "Typhoid / enteric fever", hours: 24 },
  { prefix: "A03", disease: "Shigellosis", hours: 24 },
  { prefix: "A05", disease: "Bacterial foodborne intoxication", hours: 24 },
  { prefix: "A09", disease: "Acute diarrhoeal disease", hours: 24 },
  { prefix: "A15", disease: "Tuberculosis (respiratory)", hours: 168 },
  { prefix: "A16", disease: "Tuberculosis (respiratory)", hours: 168 },
  { prefix: "A17", disease: "Tuberculosis (nervous system)", hours: 168 },
  { prefix: "A18", disease: "Tuberculosis (other organs)", hours: 168 },
  { prefix: "A19", disease: "Miliary tuberculosis", hours: 168 },
  { prefix: "A20", disease: "Plague", hours: 24 },
  { prefix: "A22", disease: "Anthrax", hours: 24 },
  { prefix: "A27", disease: "Leptospirosis", hours: 24 },
  { prefix: "A33", disease: "Tetanus (neonatal)", hours: 24 },
  { prefix: "A34", disease: "Tetanus (obstetrical)", hours: 24 },
  { prefix: "A35", disease: "Tetanus (other)", hours: 24 },
  { prefix: "A36", disease: "Diphtheria", hours: 24 },
  { prefix: "A37", disease: "Whooping cough (pertussis)", hours: 24 },
  { prefix: "A39", disease: "Meningococcal disease", hours: 24 },
  { prefix: "A80", disease: "Acute poliomyelitis / AFP", hours: 24 },
  { prefix: "A82", disease: "Rabies", hours: 24 },
  { prefix: "A83", disease: "Japanese / mosquito-borne encephalitis", hours: 24 },
  { prefix: "A90", disease: "Dengue fever", hours: 24 },
  { prefix: "A91", disease: "Dengue haemorrhagic fever", hours: 24 },
  { prefix: "A92", disease: "Chikungunya / arboviral fever", hours: 24 },
  { prefix: "B01", disease: "Chickenpox (varicella)", hours: 24 },
  { prefix: "B05", disease: "Measles", hours: 24 },
  { prefix: "B06", disease: "Rubella", hours: 24 },
  { prefix: "B15", disease: "Acute hepatitis A", hours: 168 },
  { prefix: "B16", disease: "Acute hepatitis B", hours: 168 },
  { prefix: "B17", disease: "Other acute viral hepatitis", hours: 168 },
  { prefix: "B18", disease: "Chronic viral hepatitis", hours: 168 },
  { prefix: "B19", disease: "Viral hepatitis, unspecified", hours: 168 },
  { prefix: "B26", disease: "Mumps", hours: 24 },
  { prefix: "B50", disease: "Malaria (P. falciparum)", hours: 24 },
  { prefix: "B51", disease: "Malaria (P. vivax)", hours: 24 },
  { prefix: "B52", disease: "Malaria (P. malariae)", hours: 24 },
  { prefix: "B53", disease: "Malaria (other)", hours: 24 },
  { prefix: "B54", disease: "Malaria, unspecified", hours: 24 },
  { prefix: "J09", disease: "Influenza (novel/zoonotic, incl. H1N1)", hours: 24 },
  { prefix: "J10", disease: "Influenza (identified seasonal virus)", hours: 24 },
  { prefix: "J11", disease: "Influenza (virus not identified)", hours: 24 },
  { prefix: "U071", disease: "COVID-19", hours: 24 },
  { prefix: "U072", disease: "COVID-19 (virus not identified)", hours: 24 },
];

// Normalise a code to prefix-matchable form: strip dots + spaces, uppercase.
function _norm(code) {
  return String(code || "").toUpperCase().replace(/[.\s]/g, "");
}

/**
 * Match a single diagnosis code against the notifiable list.
 * @returns null | { disease, hours, matchedPrefix, code }
 */
function matchNotifiable(code) {
  const c = _norm(code);
  if (!c) return null;
  // Longest-prefix-first so "U071" beats a hypothetical "U07".
  const sorted = [...NOTIFIABLE].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const n of sorted) {
    if (c.startsWith(_norm(n.prefix))) return { disease: n.disease, hours: n.hours, matchedPrefix: n.prefix, code };
  }
  return null;
}

/**
 * Scan a list of {code, description} diagnoses and return the unique notifiable
 * hits (deduped by matchedPrefix).
 */
function scanDiagnoses(diagnoses = []) {
  const out = [];
  const seen = new Set();
  for (const d of diagnoses || []) {
    const hit = matchNotifiable(d.code || d.icd10Code || d.codeRaw);
    if (hit && !seen.has(hit.matchedPrefix)) {
      seen.add(hit.matchedPrefix);
      out.push({ ...hit, description: d.description || "" });
    }
  }
  return out;
}

/**
 * Auto-raise NotifiableDiseaseRegister rows from a set of diagnoses. Idempotent
 * per (admission|UHID, matchedPrefix) via sourceRef, so re-finalizing a
 * discharge doesn't duplicate cases. Best-effort — returns the rows created.
 * @returns Promise<Array<{caseNumber, disease}>>
 */
async function raiseNotifiableCases({ diagnoses = [], patient = {}, admission = {}, actor = {}, diagnosisDate = null } = {}) {
  const hits = scanDiagnoses(diagnoses);
  if (!hits.length) return [];
  const NotifiableDiseaseRegister = require("../../models/Compliance/NotifiableDiseaseRegisterModel");
  const created = [];
  for (const hit of hits) {
    const admId = admission?._id || admission?.admissionId || null;
    const sourceRef = `nd:${admId || patient?.UHID || "x"}:${hit.matchedPrefix}`;
    const existing = await NotifiableDiseaseRegister.findOne({ sourceRef }).lean();
    if (existing) continue;
    try {
      const row = await NotifiableDiseaseRegister.create({
        UHID: (patient?.UHID || "").toUpperCase(),
        patientId: patient?._id || null,
        patientName: patient?.fullName || patient?.name || patient?.patientName || "",
        age: patient?.age ?? null,
        sex: patient?.gender || patient?.sex || "",
        admissionId: admId,
        disease: hit.disease,
        icdCode: hit.code,
        diagnosisDate: diagnosisDate ? new Date(diagnosisDate) : new Date(), // R8-FIX(#31): anchor the statutory clock to the real diagnosis moment (not discharge)
        reportingWindowHours: hit.hours,
        sourceRef,
        sourceType: "AutoDiagnosis",
        createdByName: actor?.fullName || actor?.name || "System",
        auditTrail: [{ action: "CREATED", at: new Date(), byName: actor?.fullName || "System", notes: `auto-raised from diagnosis ${hit.code}` }],
      });
      created.push({ caseNumber: row.caseNumber, disease: row.disease });
    } catch (e) {
      // Non-blocking — surveillance raise must never abort the clinical write.
      // eslint-disable-next-line no-console
      console.warn("[notifiableDiseases] raise failed:", e.message);
    }
  }
  return created;
}

module.exports = { NOTIFIABLE, matchNotifiable, scanDiagnoses, raiseNotifiableCases };
