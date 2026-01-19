import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.PATIENTS;


const patientService = {
  getAllPatients: async () => {
    try {
      const response = await axios.get(API_URL, {
        params: { limit: 1000, active: true },
      });
      return response.data;
    } catch (error) {
      console.error("PatientService.getAllPatients error:", error);
      throw error;
    }
  },

  getAllPatientsLegacy: async () => {
    try {
      const response = await axios.get(`${API_URL}/getAllPatients`);
      return response.data;
    } catch (error) {
      console.error("PatientService.getAllPatientsLegacy error:", error);
      throw error;
    }
  },

  getPatientById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("PatientService.getPatientById error:", error);
      throw error;
    }
  },


  getPatientByUHID: async (uhid) => {
    try {
      const response = await axios.get(`${API_URL}/${uhid}`);
      return response.data;
    } catch (error) {
      console.error("PatientService.getPatientByuhid error:", error);
      throw error;
    }
  },


  deletePatient: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("PatientService.deletePatient error:", error);
      throw error;
    }
  },

  updatePatient: async (id, data) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("PatientService.updatePatient error:", error);
      throw error;
    }
  },
};

export default patientService;
