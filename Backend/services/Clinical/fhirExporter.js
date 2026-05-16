// services/Clinical/fhirExporter.js
// ═══════════════════════════════════════════════════════════════
// FHIR R5 bundle exporter for a patient's complete file.
//
// Output is an "International Patient Summary"-style Bundle:
//   • Patient
//   • Encounter (per admission)
//   • Practitioner (attending doctor)
//   • Organization (the hospital from HospitalSettings)
//   • Observation     (vitals + lab results)
//   • Condition       (diagnoses from doctor notes)
//   • MedicationRequest    (doctor orders type=Medication)
//   • MedicationAdministration  (MAR rows that fired)
//   • DiagnosticReport (investigation orders with results)
//   • DocumentReference (signed doctor notes — pointer + status)
//   • Consent          (consent forms)
//   • AllergyIntolerance (patient.knownAllergies)
//
// This is a minimum-viable shape — every resource carries identifier,
// status, subject, encounter references, and timestamps. SNOMED / LOINC
// codes are emitted where the source row has them; placeholder text
// otherwise.
//
// The bundle is `type: "collection"`. A consuming system (ABDM PHR /
// downstream EMR) can then choose to ingest selected resources.
// ═══════════════════════════════════════════════════════════════

function id(prefix, raw) {
  if (!raw) return `${prefix}-unknown-${Date.now()}`;
  return `${prefix}-${String(raw).replace(/[^A-Za-z0-9-]/g, "")}`;
}

function ref(resourceType, raw) { return { reference: `${resourceType}/${id(resourceType.toLowerCase(), raw)}` }; }

function isoOrNull(d) { return d ? new Date(d).toISOString() : undefined; }

function codeable(text, system, code, display) {
  const cc = { text };
  if (system && code) cc.coding = [{ system, code, display: display || text }];
  return cc;
}

// ── Patient ──────────────────────────────────────────────────
function buildPatient(p) {
  if (!p) return null;
  return {
    resourceType: "Patient",
    id: id("patient", p.UHID),
    identifier: [
      { system: "https://spherehealth/uhid", value: p.UHID },
      ...(p.abhaId ? [{ system: "https://abdm.gov.in/abha", value: p.abhaId }] : []),
    ],
    active: true,
    name: [{
      use: "official",
      text: `${p.title ? p.title + " " : ""}${p.fullName || ""}`.trim(),
      family: p.lastName || undefined,
      given:  p.firstName ? [p.firstName, ...(p.middleName ? [p.middleName] : [])] : undefined,
    }],
    telecom: [
      ...(p.contactNumber ? [{ system: "phone", value: p.contactNumber }] : []),
      ...(p.email         ? [{ system: "email", value: p.email }]         : []),
    ],
    gender: (p.gender || "unknown").toLowerCase().includes("m") ? "male"
          : (p.gender || "").toLowerCase().includes("f") ? "female"
          : "unknown",
    birthDate: p.dateOfBirth ? new Date(p.dateOfBirth).toISOString().slice(0, 10) : undefined,
    address: p.address ? [{ text: String(p.address) }] : undefined,
  };
}

// ── Encounter (one per admission) ────────────────────────────
function buildEncounter(adm, patientUHID) {
  if (!adm) return null;
  return {
    resourceType: "Encounter",
    id: id("encounter", adm._id || adm.admissionNumber),
    identifier: [{ system: "https://spherehealth/admission", value: adm.admissionNumber || String(adm._id) }],
    status: (adm.status || "in-progress").toLowerCase() === "active" ? "in-progress"
          : (adm.status || "").toLowerCase() === "discharged" ? "completed"
          : "unknown",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
             code: (adm.admissionType || "").toLowerCase().includes("emergency") ? "EMER" : "IMP",
             display: adm.admissionType || "Inpatient" },
    subject: ref("Patient", patientUHID),
    period: {
      start: isoOrNull(adm.admissionDate || adm.createdAt),
      end:   isoOrNull(adm.dischargeDate),
    },
    reasonCode: adm.reasonForAdmission ? [codeable(adm.reasonForAdmission)] : undefined,
    location: adm.bedNumber ? [{ location: { display: `${adm.bedNumber}${adm.wardName ? ` — ${adm.wardName}` : ""}` } }] : undefined,
  };
}

// ── Practitioner ─────────────────────────────────────────────
function buildPractitioner(name, regNo, hprId) {
  if (!name) return null;
  return {
    resourceType: "Practitioner",
    id: id("practitioner", regNo || name),
    identifier: [
      ...(regNo ? [{ system: "https://mci/registration", value: String(regNo) }] : []),
      ...(hprId ? [{ system: "https://abdm.gov.in/hpr",    value: String(hprId) }] : []),
    ],
    name: [{ text: name }],
  };
}

// ── Condition (diagnosis) ────────────────────────────────────
function buildCondition(note, patientUHID, encounterId) {
  const dx = note.finalDiagnosis || note.workingDiagnosis || note.provisionalDiagnosis;
  if (!dx) return null;
  return {
    resourceType: "Condition",
    id: id("condition", `${note._id}-dx`),
    clinicalStatus: { coding: [{
      system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
      code: "active",
    }] },
    code: codeable(
      dx,
      note.icd10Code ? "http://hl7.org/fhir/sid/icd-10" : undefined,
      note.icd10Code || undefined,
      note.icd10Description || dx,
    ),
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    recordedDate: isoOrNull(note.visitDate || note.createdAt),
    recorder: note.doctorName ? { display: note.doctorName } : undefined,
  };
}

// ── Observation (vitals) ─────────────────────────────────────
const VITAL_LOINC = {
  bp_systolic:  { code: "8480-6",  display: "Systolic blood pressure",  unit: "mm[Hg]" },
  bp_diastolic: { code: "8462-4",  display: "Diastolic blood pressure", unit: "mm[Hg]" },
  pulse:        { code: "8867-4",  display: "Heart rate",                unit: "/min" },
  temp:         { code: "8310-5",  display: "Body temperature",          unit: "[degF]" },
  rr:           { code: "9279-1",  display: "Respiratory rate",          unit: "/min" },
  spo2:         { code: "59408-5", display: "Oxygen saturation",         unit: "%" },
  bsl:          { code: "2339-0",  display: "Glucose [Mass/volume]",     unit: "mg/dL" },
  gcs:          { code: "9269-2",  display: "Glasgow Coma Scale",        unit: "" },
};
function vitalObservation(vitalKey, value, when, patientUHID, encounterId) {
  if (value == null || value === "") return null;
  const meta = VITAL_LOINC[vitalKey];
  if (!meta) return null;
  const num = Number(value);
  return {
    resourceType: "Observation",
    id: id("observation", `${vitalKey}-${when}`),
    status: "final",
    category: [codeable("vital-signs", "http://terminology.hl7.org/CodeSystem/observation-category", "vital-signs")],
    code: codeable(meta.display, "http://loinc.org", meta.code, meta.display),
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    effectiveDateTime: isoOrNull(when),
    valueQuantity: Number.isFinite(num)
      ? { value: num, unit: meta.unit, system: "http://unitsofmeasure.org" }
      : undefined,
    valueString: !Number.isFinite(num) ? String(value) : undefined,
  };
}

// ── MedicationRequest ───────────────────────────────────────
function buildMedicationRequest(order, patientUHID, encounterId) {
  const od = order.orderDetails || {};
  if (!od.medicineName) return null;
  return {
    resourceType: "MedicationRequest",
    id: id("medreq", order._id),
    status: (order.status || "active").toLowerCase().replace("stopped", "stopped").replace("completed", "completed") || "active",
    intent: "order",
    medicationCodeableConcept: codeable(od.medicineName),
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    authoredOn: isoOrNull(order.orderedAt || order.createdAt),
    requester: order.orderedBy ? { display: order.orderedBy } : undefined,
    dosageInstruction: [{
      text: [od.dose, od.route, od.frequency, od.duration].filter(Boolean).join(" · "),
      route: od.route ? codeable(od.route) : undefined,
      timing: od.frequency ? { code: codeable(od.frequency) } : undefined,
      doseAndRate: od.dose ? [{ doseQuantity: { value: parseFloat(od.dose) || undefined, unit: (od.dose.match(/[a-zA-Z%]+/) || [""])[0] } }] : undefined,
    }],
    reasonCode: od.indication ? [codeable(od.indication)] : undefined,
  };
}

// ── MedicationAdministration ────────────────────────────────
function buildMedicationAdministration(order, admin, patientUHID, encounterId) {
  if (!admin || admin.status !== "given") return null;
  const od = order.orderDetails || {};
  return {
    resourceType: "MedicationAdministration",
    id: id("medadmin", `${order._id}-${admin.scheduledTime}-${admin.givenAt}`),
    status: "completed",
    medicationCodeableConcept: codeable(od.medicineName || "Medication"),
    subject: ref("Patient", patientUHID),
    context: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    effectiveDateTime: isoOrNull(admin.givenAt),
    performer: [{ actor: { display: admin.givenBy || "Nurse" } }],
    dosage: { text: od.dose, route: od.route ? codeable(od.route) : undefined },
    note: admin.notes ? [{ text: admin.notes }] : undefined,
  };
}

// ── DiagnosticReport (investigation) ────────────────────────
function buildDiagnosticReport(order, patientUHID, encounterId) {
  return {
    resourceType: "DiagnosticReport",
    id: id("diagreport", order._id),
    status: order.orderStatus === "COMPLETED" ? "final"
          : order.orderStatus === "IN_PROGRESS" ? "preliminary"
          : "registered",
    category: [codeable("LAB", "http://terminology.hl7.org/CodeSystem/v2-0074", "LAB")],
    code: codeable((order.items || []).map((i) => i.investigationName).join(", ") || "Investigation panel"),
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    effectiveDateTime: isoOrNull(order.createdAt),
    issued: isoOrNull(order.completedAt || order.updatedAt),
    performer: order.doctorName ? [{ display: order.doctorName }] : undefined,
    result: (order.items || []).map((it, i) => ({
      display: `${it.investigationName} — ${it.resultStatus}`,
      reference: `Observation/${id("observation", `${order._id}-${i}`)}`,
    })),
  };
}

// ── DocumentReference (signed doctor notes pointer) ─────────
function buildDocumentReference(note, patientUHID, encounterId) {
  return {
    resourceType: "DocumentReference",
    id: id("docref", note._id),
    status: note.status === "signed" ? "current" : "preliminary",
    type: codeable(note.noteType || "Clinical Note"),
    subject: ref("Patient", patientUHID),
    context: { encounter: encounterId ? [{ reference: `Encounter/${encounterId}` }] : undefined },
    date: isoOrNull(note.visitDate || note.createdAt),
    author: note.doctorName ? [{ display: note.doctorName }] : undefined,
    content: [{ attachment: { contentType: "text/plain", title: note.noteType, language: "en-IN" } }],
  };
}

// ── Consent ──────────────────────────────────────────────────
function buildConsent(c, patientUHID) {
  return {
    resourceType: "Consent",
    id: id("consent", c._id),
    status: c.status === "SIGNED" ? "active" : c.status === "REFUSED" ? "rejected" : "draft",
    scope: codeable("treatment", "http://terminology.hl7.org/CodeSystem/consentscope", "treatment"),
    category: [codeable(c.consentType || "GENERAL")],
    patient: ref("Patient", patientUHID),
    dateTime: isoOrNull(c.signedAt || c.createdAt),
    performer: c.signedByName ? [{ display: c.signedByName }] : undefined,
    policyRule: codeable("NABH PRE.3 / PRE.4"),
  };
}

// ── AllergyIntolerance ───────────────────────────────────────
function buildAllergy(p, patientUHID) {
  if (!p?.knownAllergies || ["NKDA", "None", "—", ""].includes(p.knownAllergies)) return null;
  return {
    resourceType: "AllergyIntolerance",
    id: id("allergy", `${patientUHID}-known`),
    clinicalStatus: codeable("active", "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", "active"),
    verificationStatus: codeable("confirmed", "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", "confirmed"),
    patient: ref("Patient", patientUHID),
    code: codeable(p.knownAllergies),
  };
}

// ── Main builder ─────────────────────────────────────────────
function buildBundle(file, hospital = {}) {
  if (!file?.patient) {
    return { resourceType: "Bundle", type: "collection", entry: [] };
  }
  const uhid = file.patient.UHID;
  const adm = file.currentAdmission;
  const encId = adm ? id("encounter", adm._id || adm.admissionNumber) : null;

  const entries = [];
  const push = (resource) => { if (resource) entries.push({ fullUrl: `urn:uuid:${resource.id}`, resource }); };

  // Organization (hospital)
  push({
    resourceType: "Organization",
    id: id("org", hospital.hfrId || hospital.name || "sphere"),
    identifier: hospital.hfrId
      ? [{ system: "https://abdm.gov.in/hfr", value: hospital.hfrId }]
      : undefined,
    name: hospital.name || "SphereHealth Hospital",
    type: [codeable("Healthcare Provider")],
    address: hospital.address ? [{ text: hospital.address }] : undefined,
  });

  push(buildPatient(file.patient));
  push(buildAllergy(file.patient, uhid));
  if (adm) push(buildEncounter(adm, uhid));

  // Practitioners — unique by reg no / name
  const seen = new Set();
  [...(file.doctorNotes || []), ...(file.doctorOrders || [])].forEach((row) => {
    const name = row.doctorName || row.orderedBy;
    const regNo = row.doctorRegNo;
    const hprId = row.doctorHprId;
    if (!name || seen.has(name + "|" + (regNo || ""))) return;
    seen.add(name + "|" + (regNo || ""));
    push(buildPractitioner(name, regNo, hprId));
  });

  (file.doctorNotes || []).forEach((n) => {
    push(buildCondition(n, uhid, encId));
    push(buildDocumentReference(n, uhid, encId));
  });

  (file.vitals || []).forEach((v) => {
    push(vitalObservation("bp_systolic",  v.bp?.systolic,  v.recordedAt, uhid, encId));
    push(vitalObservation("bp_diastolic", v.bp?.diastolic, v.recordedAt, uhid, encId));
    push(vitalObservation("pulse",        v.pulse,         v.recordedAt, uhid, encId));
    push(vitalObservation("temp",         v.temperature || v.temp, v.recordedAt, uhid, encId));
    push(vitalObservation("rr",           v.rr,            v.recordedAt, uhid, encId));
    push(vitalObservation("spo2",         v.spo2,          v.recordedAt, uhid, encId));
    push(vitalObservation("bsl",          v.bsl,           v.recordedAt, uhid, encId));
    push(vitalObservation("gcs",          v.gcs,           v.recordedAt, uhid, encId));
  });

  (file.doctorOrders || []).forEach((o) => {
    if ((o.orderType || "").toLowerCase().includes("medication") || o.orderDetails?.medicineName) {
      push(buildMedicationRequest(o, uhid, encId));
      (o.administrationRecord || []).forEach((a) => push(buildMedicationAdministration(o, a, uhid, encId)));
    }
  });

  (file.investigations || []).forEach((i) => push(buildDiagnosticReport(i, uhid, encId)));
  (file.consents       || []).forEach((c) => push(buildConsent(c, uhid)));

  return {
    resourceType: "Bundle",
    id: id("bundle", uhid + "-" + Date.now()),
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

module.exports = { buildBundle };
