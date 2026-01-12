import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.OPD;

const opdService = {
  createOPDVisit: (data) => axios.post(API_URL, data),

  getAllOPDVisits: (params) => axios.get(API_URL, { params }),

  getTodayVisits: () => axios.get(`${API_URL}/today`),

  getFollowUpDue: () => axios.get(`${API_URL}/followup-due`),

  getOPDVisitById: (visitNumber) => axios.get(`${API_URL}/${visitNumber}`),

  getPatientOPDHistory: (patientId) =>
    axios.get(`${API_URL}/patient/${patientId}`),

  updateOPDVisit: (visitNumber, data) =>
    axios.put(`${API_URL}/${visitNumber}`, data),

  deleteOPDVisit: (visitNumber) => axios.delete(`${API_URL}/${visitNumber}`),

  addInvestigation: (visitNumber, data) =>
    axios.post(`${API_URL}/${visitNumber}/investigation`, data),

  updateInvestigationStatus: (visitNumber, data) =>
    axios.put(`${API_URL}/${visitNumber}/investigation/status`, data),

  addPrescription: (visitNumber, data) =>
    axios.post(`${API_URL}/${visitNumber}/prescription`, data),

  completeVisit: (visitNumber) =>
    axios.put(`${API_URL}/${visitNumber}/complete`),
};

export default opdService;
