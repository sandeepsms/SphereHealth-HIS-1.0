import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const BASE = API_ENDPOINTS.OPD;

const opdService = {
  // ── Core CRUD ─────────────────────────────────────────────────
  createOPDVisit:  (data)               => axios.post(BASE, data),
  getAllOPDVisits:  (params)             => axios.get(BASE, { params }),
  getOPDVisitById: (visitNumber)        => axios.get(`${BASE}/${visitNumber}`),
  updateOPDVisit:  (visitNumber, data)  => axios.put(`${BASE}/${visitNumber}`, data),
  deleteOPDVisit:  (visitNumber)        => axios.delete(`${BASE}/${visitNumber}`),

  // ── Patient history ───────────────────────────────────────────
  getPatientOPDHistory: (patientId) => axios.get(`${BASE}/patient/${patientId}`),

  // R7cr — Pharmacy fast-lookup: today's OPD visits for a UHID with
  // diagnosis + prescribed medicines projected. Used by the Pharmacy
  // "OPD Rx" tab to display + dispense in one screen.
  getTodayRxByUHID: (UHID) => axios.get(`${BASE}/uhid/${encodeURIComponent(UHID)}/today-rx`),

  // ── Queue & filters ───────────────────────────────────────────
  // params: { departmentId, doctorId, vitalsStatus }
  getTodayVisits:        (params)       => axios.get(`${BASE}/today`, { params }),
  getFollowUpDue:        (date)         => axios.get(`${BASE}/followup-due`, { params: { date } }),
  getVisitsByDepartment: (deptId, date) => axios.get(`${BASE}/department/${deptId}`, { params: { date } }),
  getVisitsByDoctor:     (docId, date)  => axios.get(`${BASE}/doctor/${docId}`, { params: { date } }),

  // ── Nurse vitals & status ─────────────────────────────────────
  // vitalsData: { weight, height, temperature, bloodPressure, pulse, respiratoryRate, oxygenSaturation }
  updateVitals: (visitNumber, vitalsData, nurseName) =>
    axios.patch(`${BASE}/${visitNumber}/vitals`, { ...vitalsData, nurseName }),

  updateStatus: (visitNumber, status) =>
    axios.patch(`${BASE}/${visitNumber}/status`, { status }),

  // ── Investigations & prescriptions ───────────────────────────
  addInvestigation:        (visitNumber, data) => axios.post(`${BASE}/${visitNumber}/investigation`, data),
  updateInvestigationStatus: (visitNumber, data) => axios.put(`${BASE}/${visitNumber}/investigation/status`, data),
  addPrescription:         (visitNumber, data) => axios.post(`${BASE}/${visitNumber}/prescription`, data),
  completeVisit:           (visitNumber, data) => axios.put(`${BASE}/${visitNumber}/complete`, data || {}),

  // ── R7cj — Append addendum note + alias for fresh visit fetch ────
  getOPDVisit:             (visitNumber)       => axios.get(`${BASE}/${visitNumber}`),
  addAdditionalNote:       (visitNumber, note) => axios.post(`${BASE}/${visitNumber}/additional-note`, { note }),
};

export default opdService;
