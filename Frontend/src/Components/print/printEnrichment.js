/**
 * printEnrichment.js — "no dashes on printouts" (R7hr policy).
 *
 * Every printable's patient/billing strip falls back to "—" when the caller's
 * payload lacks a field. 42 call sites build payloads by hand, so misses are
 * endemic (a receipt fired from billing knows the amount but not the blood
 * group; a slip fired from security knows the visitor but not the patient's
 * age). Fixing each call site is whack-a-mole — this module fixes it ONCE at
 * the /print/:slug choke point (PrintRouterPage):
 *
 *   payload → enrichPrintPayload() → template
 *
 * If the payload carries a UHID and any standard patient/admission field is
 * missing, we fetch the patient (GET /api/patients/uhid/:uhid — includes
 * doctor + department + TPA populated) and, when IPD-context fields are also
 * missing, the latest admission (GET /api/admissions/patient/:id/history).
 * Missing keys are backfilled under EVERY alias the templates use
 * (uhid/UHID/patientUHID, mobile/contactNumber, ipdNo/admissionNumber, …).
 *
 * Guarantees:
 *   • Caller-supplied values are NEVER overwritten — only empty/"—" filled.
 *   • Best-effort: any fetch failure returns the payload unchanged.
 *   • Cached per UHID for the print window's lifetime.
 */
import axios from "axios";
import { useEffect, useState } from "react";
import { API_ENDPOINTS } from "../../config/api";

const _lookupCache = new Map(); // uhid → Promise<{patient, admission}>

const isEmpty = (v) =>
  v === undefined || v === null || v === "" || v === "—" || v === "-" ||
  (typeof v === "string" && v.trim() === "");

/** Set payload[key] only when the caller left it empty. */
const fill = (payload, key, val) => {
  if (isEmpty(payload[key]) && !isEmpty(val)) payload[key] = val;
};

const ageFromDob = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  const years = Math.floor(diff / (365.25 * 86400000));
  return years >= 0 && years < 130 ? years : null;
};

// Demographic + IPD-context keys the templates read (all alias spellings).
const DEMO_KEYS = ["patientName", "age", "gender", "mobile", "contactNumber", "address", "bloodGroup"];
const IPD_KEYS  = ["ipdNo", "admissionNumber", "bedNumber", "wardName", "admissionDate", "consultantName"];

export function payloadNeedsEnrichment(payload) {
  if (!payload || typeof payload !== "object") return false;
  const uhid = payload.uhid || payload.UHID || payload.patientUHID;
  if (!uhid) return false;
  return DEMO_KEYS.some((k) => isEmpty(payload[k])) || IPD_KEYS.some((k) => isEmpty(payload[k]));
}

async function lookup(uhid, wantAdmission, admissionHint = {}) {
  // TD-3 — the hint pins WHICH admission backfills the payload. Before this,
  // reprinting an OLD admission's document silently stamped the CURRENT
  // (latest) admission's bed/ward/dates onto it. When the payload carries an
  // admissionId/admissionNumber we now match that exact stay; latest is only
  // the fallback for payloads with no admission identity at all.
  const hintKey = admissionHint.admissionId || admissionHint.admissionNumber || "";
  const key = `${String(uhid).toUpperCase()}|${wantAdmission ? 1 : 0}|${hintKey}`;
  if (_lookupCache.has(key)) return _lookupCache.get(key);
  const p = (async () => {
    let patient = null;
    let admission = null;
    try {
      const res = await axios.get(`${API_ENDPOINTS.PATIENTS}/uhid/${encodeURIComponent(uhid)}`);
      patient = res.data?.data || res.data?.patient || null;
    } catch (_) { /* unknown UHID / no access — leave null */ }
    if (wantAdmission && patient?._id) {
      try {
        const res = await axios.get(`${API_ENDPOINTS.ADMISSIONS}/patient/${patient._id}/history`);
        const list = res.data?.admissions || res.data?.data || [];
        if (Array.isArray(list) && list.length) {
          admission =
            (admissionHint.admissionId &&
              list.find((a) => String(a._id) === String(admissionHint.admissionId))) ||
            (admissionHint.admissionNumber &&
              list.find((a) => a.admissionNumber === admissionHint.admissionNumber)) ||
            [...list].sort(
              (a, b) => new Date(b.admissionDate || 0) - new Date(a.admissionDate || 0),
            )[0];
        }
      } catch (_) { /* no admissions — fine (OPD-only patient) */ }
    }
    return { patient, admission };
  })();
  _lookupCache.set(key, p);
  return p;
}

/**
 * Backfill missing patient/admission fields on a print payload.
 * Never throws; never overwrites caller data.
 */
export async function enrichPrintPayload(raw) {
  if (!payloadNeedsEnrichment(raw)) return raw;
  const payload = { ...raw };
  const uhid = payload.uhid || payload.UHID || payload.patientUHID;
  const wantAdmission =
    IPD_KEYS.some((k) => isEmpty(payload[k])) &&
    // Only chase an admission when the payload smells IPD-ish (has any IPD
    // hint) OR carries none of the IPD keys at all but is a clinical doc.
    (payload.ipdNo || payload.admissionNumber || payload.admissionId ||
     payload.bedNumber || payload.wardName || payload.admissionDate ||
     payload.dischargeDate) !== undefined;

  try {
    const { patient, admission } = await lookup(uhid, !!wantAdmission, {
      admissionId: payload.admissionId,
      admissionNumber: payload.admissionNumber || payload.ipdNo,
    });

    if (patient) {
      const name =
        patient.fullName ||
        [patient.title, patient.firstName, patient.lastName].filter(Boolean).join(" ").trim();
      fill(payload, "patientName", name);
      const age = !isEmpty(patient.age) ? patient.age : ageFromDob(patient.dateOfBirth);
      fill(payload, "age", age);
      fill(payload, "gender", patient.gender);
      fill(payload, "mobile", patient.contactNumber || patient.mobile);
      fill(payload, "contactNumber", patient.contactNumber || patient.mobile);
      fill(payload, "address", patient.completeAddress || patient.address);
      fill(payload, "bloodGroup", patient.bloodGroup);
      // Normalise the UHID trio so every template's alias resolves.
      fill(payload, "uhid", patient.UHID || uhid);
      fill(payload, "UHID", patient.UHID || uhid);
      fill(payload, "patientUHID", patient.UHID || uhid);
      // OPD context — the patient doc carries populated doctor + department.
      fill(payload, "doctorName", patient.doctor?.personalInfo?.fullName);
      fill(payload, "department", patient.department?.departmentName);
    }

    if (admission) {
      fill(payload, "ipdNo", admission.admissionNumber);
      fill(payload, "admissionNumber", admission.admissionNumber);
      fill(payload, "bedNumber",
        admission.bed?.bedNumber || admission.bedId?.bedNumber || admission.bedNumber);
      fill(payload, "wardName",
        admission.bed?.ward || admission.wardName || admission.wardId?.wardName);
      fill(payload, "admissionDate", admission.admissionDate);
      fill(payload, "dischargeDate", admission.dischargeDate);
      fill(payload, "consultantName",
        admission.attendingDoctor ||
        admission.attendingDoctorId?.personalInfo?.fullName);
      fill(payload, "doctorName",
        admission.attendingDoctor ||
        admission.attendingDoctorId?.personalInfo?.fullName);
    }
  } catch (_) { /* best-effort — return whatever we have */ }
  return payload;
}

/**
 * Hook for PrintRouterPage: returns { receipt, enriching }. `enriching` is
 * true only while a lookup is actually needed + in flight — the router keeps
 * showing its loading shell so the operator never sees (or prints) a strip
 * full of dashes that silently fills in later.
 */
export function useEnrichedPrintPayload(payload) {
  const needs = payloadNeedsEnrichment(payload);
  const [state, setState] = useState({ receipt: payload, enriching: needs });

  useEffect(() => {
    let alive = true;
    if (!needs) {
      setState({ receipt: payload, enriching: false });
      return () => { alive = false; };
    }
    setState({ receipt: payload, enriching: true });
    enrichPrintPayload(payload).then((out) => {
      if (alive) setState({ receipt: out, enriching: false });
    });
    return () => { alive = false; };
  }, [payload, needs]);

  return state;
}
