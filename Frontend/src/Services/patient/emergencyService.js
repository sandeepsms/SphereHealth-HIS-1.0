import axios from "axios";

const API_URL = "http://localhost:5000/api";

const emergencyService = {
  createEmergencyVisit: (data) => axios.post(`${API_URL}/emergency`, data),

  getAllEmergencyVisits: (params) =>
    axios.get(`${API_URL}/emergency`, { params }),

  getActiveEmergencies: () => axios.get(`${API_URL}/emergency/active`),

  getTodayEmergencies: () => axios.get(`${API_URL}/emergency/today`),

  getMLCCases: () => axios.get(`${API_URL}/emergency/mlc`),

  getEmergenciesByTriage: (category) =>
    axios.get(`${API_URL}/emergency/triage/${category}`),

  getEmergencyVisitById: (emergencyNumber) =>
    axios.get(`${API_URL}/emergency/${emergencyNumber}`),

  getPatientEmergencyHistory: (patientId) =>
    axios.get(`${API_URL}/emergency/patient/${patientId}`),

  updateEmergencyVisit: (emergencyNumber, data) =>
    axios.put(`${API_URL}/emergency/${emergencyNumber}`, data),

  deleteEmergencyVisit: (emergencyNumber) =>
    axios.delete(`${API_URL}/emergency/${emergencyNumber}`),

  addInvestigation: (emergencyNumber, data) =>
    axios.post(`${API_URL}/emergency/${emergencyNumber}/investigation`, data),

  updateInvestigationStatus: (emergencyNumber, data) =>
    axios.put(
      `${API_URL}/emergency/${emergencyNumber}/investigation/status`,
      data
    ),

  addMedication: (emergencyNumber, data) =>
    axios.post(`${API_URL}/emergency/${emergencyNumber}/medication`, data),

  addProcedure: (emergencyNumber, data) =>
    axios.post(`${API_URL}/emergency/${emergencyNumber}/procedure`, data),

  addNursingNote: (emergencyNumber, data) =>
    axios.post(`${API_URL}/emergency/${emergencyNumber}/nursing-note`, data),

  updateDisposition: (emergencyNumber, data) =>
    axios.put(`${API_URL}/emergency/${emergencyNumber}/disposition`, data),

  updateTriageCategory: (emergencyNumber, data) =>
    axios.put(`${API_URL}/emergency/${emergencyNumber}/triage`, data),
};

export default emergencyService;
