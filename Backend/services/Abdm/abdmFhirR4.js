/**
 * services/Abdm/abdmFhirR4.js — ABDM FHIR R4 document bundle
 *
 * ABDM Health Information Types (OPConsultation / DischargeSummary /
 * Prescription / DiagnosticReport / …) must be exchanged as a FHIR R4
 * **document** Bundle whose FIRST entry is a `Composition` that indexes the
 * clinical resources into typed sections. The existing fhirExporter produces
 * a `collection` Bundle of R4 resources — this module wraps that into a
 * conformant document Bundle + Composition so the payload is ABDM-submittable.
 *
 * `buildAbdmDocumentBundle(file, hospital, { hiType, hprId })` → document Bundle.
 */
"use strict";

const { buildBundle } = require("../Clinical/fhirExporter");

// ABDM HI Type → Composition.type SNOMED coding + human title.
const HI_TYPE_META = {
  OPConsultation:      { code: "371530004", display: "Clinical consultation report", title: "OP Consultation Record" },
  DischargeSummary:    { code: "373942005", display: "Discharge summary",            title: "Discharge Summary" },
  Prescription:        { code: "440545006", display: "Prescription record",          title: "Prescription" },
  DiagnosticReport:    { code: "721981007", display: "Diagnostic studies report",    title: "Diagnostic Report" },
  WellnessRecord:      { code: "419891008", display: "Record artifact",              title: "Wellness Record" },
  ImmunizationRecord:  { code: "41000179103", display: "Immunization record",        title: "Immunization Record" },
  HealthDocumentRecord:{ code: "419891008", display: "Record artifact",              title: "Health Document Record" },
};

// Section grouping: resourceType → section title. Everything a Composition
// might index; only sections with ≥1 resource are emitted.
const SECTION_TITLES = {
  Condition:                "Diagnoses",
  AllergyIntolerance:       "Allergies",
  MedicationRequest:        "Medications",
  MedicationStatement:      "Medications",
  MedicationAdministration: "Medication Administration",
  DiagnosticReport:         "Investigations",
  Observation:              "Observations (Vitals & Lab Results)",
  DocumentReference:        "Clinical Notes / Documents",
  Procedure:                "Procedures",
  CarePlan:                 "Follow-up / Care Plan",
  Consent:                  "Consent",
};

function _derive(file) {
  // Best-effort HI-Type inference from what the collection contains.
  if ((file.doctorOrders || []).some((o) => (o.orderType || "").toLowerCase().includes("medication") || o.orderDetails?.medicineName)) {
    // meds present but not a discharge → still an OP consult carries meds; a
    // pure prescription is chosen explicitly by the caller.
  }
  return "OPConsultation";
}

/**
 * Wrap the fhirExporter collection bundle into an ABDM document Bundle.
 * @param {object} file      pre-assembled clinical file (same shape fhirExporter takes)
 * @param {object} hospital  HospitalSettings-ish { name, hfrId, address }
 * @param {object} opts      { hiType, hprId }
 */
// R9-FIX(R9-074): map each HI Type to the clinical FHIR resource families it may
// carry. Without this, every HI Type shipped the patient's ENTIRE clinical file
// (buildBundle emits all resources; the bundle included them all regardless of
// the requested hiType). A `null` value = comprehensive record (all clinical
// resources) — DischargeSummary/OPConsultation are legitimately broad.
const HI_TYPE_RESOURCES = {
  Prescription:         new Set(["MedicationRequest", "MedicationStatement", "Medication"]),
  DiagnosticReport:     new Set(["DiagnosticReport", "Observation", "Specimen", "ImagingStudy"]),
  ImmunizationRecord:   new Set(["Immunization"]),
  WellnessRecord:       new Set(["Observation"]),
  OPConsultation:       null,
  DischargeSummary:     null,
  HealthDocumentRecord: null,
};

function buildAbdmDocumentBundle(file, hospital = {}, opts = {}) {
  const collection = buildBundle(file, hospital);
  const entries = Array.isArray(collection.entry) ? collection.entry : [];

  const hiType = HI_TYPE_META[opts.hiType] ? opts.hiType : _derive(file);
  const meta = HI_TYPE_META[hiType];

  // Locate the anchor resources.
  const findEntry = (rt) => entries.find((e) => e.resource?.resourceType === rt);
  const patientEntry = findEntry("Patient");
  const orgEntry = findEntry("Organization");
  const practitionerEntry = findEntry("Practitioner");
  const now = new Date().toISOString();
  const uhid = file?.patient?.UHID || "unknown";

  // Build sections from the resources present (skip Patient/Organization/
  // Encounter/Practitioner — those are structural, not clinical sections).
  const STRUCTURAL = new Set(["Patient", "Organization", "Encounter", "Practitioner"]);
  // R9-FIX(R9-074): keep only the clinical resources this HI Type authorises
  // (structural anchors always stay). A hiType with no allowlist (null) is
  // comprehensive and passes everything through.
  const _allowed = Object.prototype.hasOwnProperty.call(HI_TYPE_RESOURCES, hiType) ? HI_TYPE_RESOURCES[hiType] : null;
  const includedEntries = _allowed
    ? entries.filter((e) => { const rt = e.resource?.resourceType; return !rt || STRUCTURAL.has(rt) || _allowed.has(rt); })
    : entries;
  const byType = {};
  for (const e of includedEntries) {
    const rt = e.resource?.resourceType;
    if (!rt || STRUCTURAL.has(rt) || !SECTION_TITLES[rt]) continue;
    (byType[rt] = byType[rt] || []).push({ reference: e.fullUrl });
  }
  const section = Object.keys(byType).map((rt) => ({
    title: SECTION_TITLES[rt],
    entry: byType[rt],
  }));

  const composition = {
    resourceType: "Composition",
    id: `composition-${uhid}-${Date.now()}`,
    status: "final",
    type: { coding: [{ system: "http://snomed.info/sct", code: meta.code, display: meta.display }], text: meta.title },
    subject: patientEntry ? { reference: patientEntry.fullUrl } : undefined,
    encounter: findEntry("Encounter") ? { reference: findEntry("Encounter").fullUrl } : undefined,
    date: now,
    author: [
      practitionerEntry ? { reference: practitionerEntry.fullUrl } : null,
      orgEntry ? { reference: orgEntry.fullUrl } : null,
    ].filter(Boolean),
    title: meta.title,
    custodian: orgEntry ? { reference: orgEntry.fullUrl } : undefined,
    section: section.length ? section : undefined,
  };

  const compositionEntry = { fullUrl: `urn:uuid:${composition.id}`, resource: composition };

  return {
    resourceType: "Bundle",
    id: `abdm-doc-${uhid}-${Date.now()}`,
    type: "document",
    timestamp: now,
    identifier: { system: "https://abdm.gov.in/documents", value: `urn:uuid:${composition.id}` },
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle"], lastUpdated: now },
    // Composition MUST be the first entry in a document Bundle.
    // R9-FIX(R9-074): ship only the HI-Type-allowed clinical resources.
    entry: [compositionEntry, ...includedEntries],
  };
}

module.exports = { buildAbdmDocumentBundle, HI_TYPE_META };
