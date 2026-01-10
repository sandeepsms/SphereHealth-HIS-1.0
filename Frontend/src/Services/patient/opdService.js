import axios from "axios";

const API_URL = "http://localhost:5000/api";

const opdService = {
  createOPDVisit: (data) => axios.post(`${API_URL}/opd`, data),

  getAllOPDVisits: (params) => axios.get(`${API_URL}/opd`, { params }),

  getTodayVisits: () => axios.get(`${API_URL}/opd/today`),

  getFollowUpDue: () => axios.get(`${API_URL}/opd/followup-due`),

  getOPDVisitById: (visitNumber) => axios.get(`${API_URL}/opd/${visitNumber}`),

  getPatientOPDHistory: (patientId) =>
    axios.get(`${API_URL}/opd/patient/${patientId}`),

  updateOPDVisit: (visitNumber, data) =>
    axios.put(`${API_URL}/opd/${visitNumber}`, data),

  deleteOPDVisit: (visitNumber) =>
    axios.delete(`${API_URL}/opd/${visitNumber}`),

  addInvestigation: (visitNumber, data) =>
    axios.post(`${API_URL}/opd/${visitNumber}/investigation`, data),

  updateInvestigationStatus: (visitNumber, data) =>
    axios.put(`${API_URL}/opd/${visitNumber}/investigation/status`, data),

  addPrescription: (visitNumber, data) =>
    axios.post(`${API_URL}/opd/${visitNumber}/prescription`, data),

  completeVisit: (visitNumber) =>
    axios.put(`${API_URL}/opd/${visitNumber}/complete`),
};

export default opdService;
