// Services/patientService.js (Your service - FIXED)
import axios from "axios";

const API_URL = "http://localhost:5000/api";

const patientService = {
  // FIXED: Use correct endpoint from your service
  getAllPatients: async () => {
    try {
      const response = await axios.get(`${API_URL}/patients`, {
        params: { limit: 1000, active: true }, // Add sensible defaults
      });
      return response.data;
    } catch (error) {
      console.error("PatientService.getAllPatients error:", error);
      throw error;
    }
  },

  // For your specific route if needed
  getAllPatientsLegacy: async () => {
    try {
      const response = await axios.get(`${API_URL}/patients/getAllPatients`);
      return response.data;
    } catch (error) {
      console.error("PatientService.getAllPatientsLegacy error:", error);
      throw error;
    }
  },

  deletePatient: async (id) => {
    const response = await axios.delete(`${API_URL}/patients/${id}`);
    return response.data;
  },

  updatePatient: async (id, data) => {
    const response = await axios.put(`${API_URL}/patients/${id}`, data);
    return response.data;
  },
};

export default patientService;
