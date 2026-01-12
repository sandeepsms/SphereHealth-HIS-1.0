import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.EMERGENCY;

const emergencyService = {
  createEmergencyVisit: (data) => axios.post(API_URL, data),

  getAllEmergencyVisits: (params) => axios.get(API_URL, { params }),

  getActiveEmergencies: () => axios.get(`${API_URL}/active`),

  getTodayEmergencies: () => axios.get(`${API_URL}/today`),

  getMLCCases: () => axios.get(`${API_URL}/mlc`),

  getEmergenciesByTriage: (category) =>
    axios.get(`${API_URL}/triage/${category}`),

  getEmergencyVisitById: (emergencyNumber) =>
    axios.get(`${API_URL}/${emergencyNumber}`),

  getPatientEmergencyHistory: (patientId) =>
    axios.get(`${API_URL}/patient/${patientId}`),

  updateEmergencyVisit: (emergencyNumber, data) =>
    axios.put(`${API_URL}/${emergencyNumber}`, data),

  deleteEmergencyVisit: (emergencyNumber) =>
    axios.delete(`${API_URL}/${emergencyNumber}`),

  addInvestigation: (emergencyNumber, data) =>
    axios.post(`${API_URL}/${emergencyNumber}/investigation`, data),

  updateInvestigationStatus: (emergencyNumber, data) =>
    axios.put(`${API_URL}/${emergencyNumber}/investigation/status`, data),

  addMedication: (emergencyNumber, data) =>
    axios.post(`${API_URL}/${emergencyNumber}/medication`, data),

  addProcedure: (emergencyNumber, data) =>
    axios.post(`${API_URL}/${emergencyNumber}/procedure`, data),

  addNursingNote: (emergencyNumber, data) =>
    axios.post(`${API_URL}/${emergencyNumber}/nursing-note`, data),

  updateDisposition: (emergencyNumber, data) =>
    axios.put(`${API_URL}/${emergencyNumber}/disposition`, data),

  updateTriageCategory: (emergencyNumber, data) =>
    axios.put(`${API_URL}/${emergencyNumber}/triage`, data),
};

export default emergencyService;
