/**
 * services/Abdm/abdmLinkService.js — ABDM care-context discovery + linking
 *
 * Turns a patient's local encounters (admissions / OPD visits) into ABDM
 * "care contexts", links an ABHA to a patient, and answers the gateway's
 * discovery callback by matching a demographic request to a local UHID.
 */
"use strict";

const mongoose = require("mongoose");

// Derive the HI Types an encounter can serve from its type.
function _hiTypesFor(encounterType) {
  switch (encounterType) {
    case "IPD":       return ["DischargeSummary", "OPConsultation", "Prescription", "DiagnosticReport"];
    case "Emergency": return ["OPConsultation", "DiagnosticReport", "Prescription"];
    case "Daycare":   return ["OPConsultation", "Prescription", "DiagnosticReport"];
    default:          return ["OPConsultation", "Prescription", "DiagnosticReport"];
  }
}

function _encounterTypeOf(admissionType) {
  const t = String(admissionType || "").toLowerCase();
  if (t.includes("emergency")) return "Emergency";
  if (t.includes("day")) return "Daycare";
  if (t === "opd" || t.includes("services")) return "OPD";
  return "IPD";
}

/**
 * Build care-context descriptors for a patient's encounters (not yet persisted
 * as ABDM links — just the candidate list a discovery/link flow offers).
 * @returns [{ careContextReference, display, encounterType, admissionId, visitRef, hiTypes }]
 */
async function buildCareContextsForPatient(uhid) {
  const Admission = require("../../models/Patient/admissionModel");
  const rows = await Admission.find({ UHID: String(uhid).toUpperCase(), status: { $nin: ["Cancelled", "Deleted"] } })
    .select("admissionNumber visitNumber admissionType admissionDate")
    .sort({ admissionDate: -1 }).limit(200).lean();
  return rows.map((a) => {
    const encounterType = _encounterTypeOf(a.admissionType);
    const ref = a.admissionNumber || String(a._id);
    const when = a.admissionDate ? new Date(a.admissionDate).toISOString().slice(0, 10) : "";
    return {
      careContextReference: `CC-${ref}`,
      display: `${encounterType} visit ${ref}${when ? " (" + when + ")" : ""}`,
      encounterType,
      admissionId: a._id,
      visitRef: ref,
      hiTypes: _hiTypesFor(encounterType),
    };
  });
}

/**
 * Link an ABHA to a local patient + persist their care contexts as LINKED.
 * This is the HIP-side local linking (a real deployment also confirms the link
 * with the CM via the link/init→confirm OTP flow when the CM initiates it).
 * @returns { patient, careContexts }
 */
async function linkPatientAbha({ uhid, abhaNumber = "", abhaAddress = "", kycVerified = false, actor = {} }) {
  const Patient = require("../../models/Patient/patientModel");
  const AbdmCareContext = require("../../models/Abdm/AbdmCareContextModel");
  const UH = String(uhid).toUpperCase();

  const patient = await Patient.findOne({ UHID: UH });
  if (!patient) { const e = new Error("Patient not found"); e.status = 404; throw e; }

  patient.abhaNumber = abhaNumber || patient.abhaNumber;
  patient.abhaAddress = abhaAddress || patient.abhaAddress;
  patient.abhaId = abhaNumber || patient.abhaId;   // FHIR exporter reads abhaId
  patient.abhaLinked = !!(patient.abhaNumber || patient.abhaAddress);
  patient.abhaKycVerified = !!kycVerified || patient.abhaKycVerified;
  if (patient.abhaLinked && !patient.abhaLinkedAt) patient.abhaLinkedAt = new Date();
  await patient.save();

  const ccList = await buildCareContextsForPatient(UH);
  const now = new Date();
  const persisted = [];
  for (const cc of ccList) {
    const row = await AbdmCareContext.findOneAndUpdate(
      { careContextReference: cc.careContextReference },
      {
        $set: {
          UHID: UH, patientId: patient._id,
          abhaAddress: patient.abhaAddress, abhaNumber: patient.abhaNumber,
          encounterType: cc.encounterType, admissionId: cc.admissionId, visitRef: cc.visitRef,
          display: cc.display, hiTypes: cc.hiTypes,
          linkStatus: "LINKED", linkedAt: now,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    persisted.push(row);
  }
  return { patient, careContexts: persisted };
}

/**
 * Answer a discovery request: match the gateway's patient identifiers to a
 * local UHID + return that patient's care contexts.
 * @param identifiers { unverifiedIdentifiers?: [{type,value}], verifiedIdentifiers?, name?, gender?, yearOfBirth? }
 * @returns { matched, uhid, patientDisplay, careContexts }
 */
async function discoverForDemographics(identifiers = {}) {
  const Patient = require("../../models/Patient/patientModel");
  const all = [...(identifiers.verifiedIdentifiers || []), ...(identifiers.unverifiedIdentifiers || [])];
  const byType = (t) => all.find((i) => String(i.type || "").toUpperCase() === t)?.value;

  const abhaAddr = byType("ABHA_ADDRESS") || identifiers.id || "";
  const mobile = byType("MOBILE") || byType("MR") || "";

  let patient = null;
  if (abhaAddr) patient = await Patient.findOne({ abhaAddress: abhaAddr }).lean();
  if (!patient && mobile) patient = await Patient.findOne({ contactNumber: String(mobile).replace(/^\+?91/, "") }).lean();
  if (!patient && identifiers.name && identifiers.yearOfBirth) {
    patient = await Patient.findOne({
      fullName: new RegExp(`^${String(identifiers.name).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    }).lean();
  }
  if (!patient) return { matched: false, uhid: "", patientDisplay: "", careContexts: [] };

  const careContexts = await buildCareContextsForPatient(patient.UHID);
  return {
    matched: true,
    uhid: patient.UHID,
    patientReference: patient.UHID,
    patientDisplay: patient.fullName || patient.UHID,
    careContexts: careContexts.map((c) => ({ referenceNumber: c.careContextReference, display: c.display })),
  };
}

module.exports = { buildCareContextsForPatient, linkPatientAbha, discoverForDemographics };
