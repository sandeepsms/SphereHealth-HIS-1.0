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

// ── Lab result Observation (per parameter) ──────────────────
// FHIR interpretation codes — our result flags (N/H/L/HH/LL/A) map 1:1 onto
// the HL7 v3 ObservationInterpretation code system.
const _INTERP = { N: "Normal", H: "High", L: "Low", HH: "Critical high", LL: "Critical low", A: "Abnormal" };
function interpretationOf(flag) {
  const f = String(flag || "").toUpperCase();
  if (!_INTERP[f]) return undefined;
  return [codeable(_INTERP[f], "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", f, _INTERP[f])];
}

function buildLabObservation(order, item, r, patientUHID, encounterId) {
  if (!r || r.value == null || r.value === "") return null;
  const num = Number(r.value);
  const loinc = item.loincCode;
  const obsId = id("labobs", `${order._id}-${item.investigationCode || item.investigationName}-${r.parameterName}`);
  const range = (r.refLow != null || r.refHigh != null)
    ? [{
        low:  r.refLow  != null ? { value: Number(r.refLow),  unit: r.unit || undefined } : undefined,
        high: r.refHigh != null ? { value: Number(r.refHigh), unit: r.unit || undefined } : undefined,
        text: r.normalRange || undefined,
      }]
    : (r.normalRange ? [{ text: r.normalRange }] : undefined);
  return {
    resourceType: "Observation",
    id: obsId,
    status: order.orderStatus === "COMPLETED" ? "final" : "preliminary",
    category: [codeable("laboratory", "http://terminology.hl7.org/CodeSystem/observation-category", "laboratory")],
    code: codeable(r.parameterName || item.investigationName,
                   loinc ? "http://loinc.org" : undefined, loinc || undefined, item.loincDisplay || r.parameterName),
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    effectiveDateTime: isoOrNull(r.resultedAt || order.completedAt || order.updatedAt || order.createdAt),
    valueQuantity: Number.isFinite(num)
      ? { value: num, unit: r.unit || undefined, system: r.unit ? "http://unitsofmeasure.org" : undefined }
      : undefined,
    valueString: !Number.isFinite(num) ? String(r.value) : undefined,
    interpretation: interpretationOf(r.flag),
    referenceRange: range,
    method: r.method ? codeable(r.method) : undefined,
  };
}

// ── DiagnosticReport (investigation) ────────────────────────
// `obsRefs` are the lab Observations built for this order's results — the
// report references them (was a dangling reference to never-built resources).
function buildDiagnosticReport(order, patientUHID, encounterId, obsRefs = []) {
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
    result: obsRefs.length
      ? obsRefs.map((o) => ({ reference: `Observation/${o.id}`, display: o.display }))
      : (order.items || []).map((it) => ({ display: `${it.investigationName} — ${it.resultStatus}` })),
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

// ── Discharge-summary resources ──────────────────────────────
// The discharge summary was fetched by the controller but never emitted.
// It carries the AAC-mandated content — final diagnoses (ICD-10), discharge
// medications, procedures (ICD-10-PCS), and follow-up — so we surface each as
// a proper FHIR resource.
function buildDischargeCondition(dx, ds, idx, patientUHID, encounterId) {
  const text = dx.description || dx.code || ds.finalDiagnosis;
  if (!text) return null;
  return {
    resourceType: "Condition",
    id: id("dxcond", `${ds._id}-${idx}`),
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "resolved" }] },
    category: [codeable("encounter-diagnosis", "http://terminology.hl7.org/CodeSystem/condition-category", "encounter-diagnosis")],
    code: codeable(text, dx.code ? "http://hl7.org/fhir/sid/icd-10" : undefined, dx.code || undefined, dx.description || text),
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    recordedDate: isoOrNull(ds.dischargeDate || ds.createdAt),
  };
}

function buildDischargeMedication(med, ds, idx, patientUHID, encounterId) {
  if (!med?.medicineName) return null;
  return {
    resourceType: "MedicationRequest",
    id: id("dischmed", `${ds._id}-${idx}`),
    status: "active",
    intent: "order",
    category: [codeable("discharge", "http://terminology.hl7.org/CodeSystem/medicationrequest-category", "discharge")],
    medicationCodeableConcept: codeable(med.medicineName),
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    authoredOn: isoOrNull(ds.dischargeDate || ds.createdAt),
    dosageInstruction: [{
      text: [med.dose, med.route, med.frequency, med.duration, med.remarks].filter(Boolean).join(" · "),
      route: med.route ? codeable(med.route) : undefined,
      timing: med.frequency ? { code: codeable(med.frequency) } : undefined,
    }],
  };
}

function buildProcedure(proc, ds, idx, patientUHID, encounterId) {
  if (!proc?.procedureName) return null;
  return {
    resourceType: "Procedure",
    id: id("procedure", `${ds._id}-${idx}`),
    status: "completed",
    code: codeable(proc.procedureName, proc.pcsCode ? "http://hl7.org/fhir/sid/icd-10-pcs" : undefined, proc.pcsCode || undefined, proc.procedureName),
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    performedDateTime: isoOrNull(proc.date),
    performer: proc.performedBy ? [{ actor: { display: proc.performedBy } }] : undefined,
  };
}

function buildFollowUpCarePlan(ds, patientUHID, encounterId) {
  if (!(ds.followUpInstructions || ds.followUpDate || ds.followUpDoctor)) return null;
  return {
    resourceType: "CarePlan",
    id: id("careplan", `${ds._id}-followup`),
    status: "active",
    intent: "plan",
    title: "Discharge Follow-up",
    description: ds.followUpInstructions || undefined,
    subject: ref("Patient", patientUHID),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    created: isoOrNull(ds.dischargeDate || ds.createdAt),
    period: ds.followUpDate ? { start: isoOrNull(ds.followUpDate) } : undefined,
    author: ds.followUpDoctor ? [{ display: ds.followUpDoctor }] : undefined,
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

  // Investigations → DiagnosticReport + the per-parameter lab Observations it
  // references (with LOINC codes, values, reference ranges, H/L/critical flags).
  (file.investigations || []).forEach((order) => {
    const obsRefs = [];
    (order.items || []).forEach((item) => {
      (item.results || []).forEach((r) => {
        const obs = buildLabObservation(order, item, r, uhid, encId);
        if (obs) { push(obs); obsRefs.push({ id: obs.id, display: `${item.investigationName}: ${r.parameterName}` }); }
      });
    });
    push(buildDiagnosticReport(order, uhid, encId, obsRefs));
  });

  (file.consents || []).forEach((c) => push(buildConsent(c, uhid)));

  // Discharge summary → structured diagnoses / discharge meds / procedures /
  // follow-up. Prefer the finalized summary; fall back to the most recent.
  const dsList = Array.isArray(file.dischargeSummary)
    ? file.dischargeSummary
    : (file.dischargeSummary ? [file.dischargeSummary] : []);
  const ds = dsList.find((d) => d.status === "finalized") || dsList[0];
  if (ds) {
    const coded = (Array.isArray(ds.codedDiagnoses) && ds.codedDiagnoses.length)
      ? ds.codedDiagnoses
      : (ds.finalDiagnosis ? [{ description: ds.finalDiagnosis, code: ds.icdCode }] : []);
    coded.forEach((dx, i) => push(buildDischargeCondition(dx, ds, i, uhid, encId)));
    (ds.medicationsOnDischarge || []).forEach((m, i) => push(buildDischargeMedication(m, ds, i, uhid, encId)));
    (ds.proceduresDone || []).forEach((p, i) => push(buildProcedure(p, ds, i, uhid, encId)));
    push(buildFollowUpCarePlan(ds, uhid, encId));
  }

  return {
    resourceType: "Bundle",
    id: id("bundle", uhid + "-" + Date.now()),
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

module.exports = { buildBundle };
