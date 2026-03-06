// src/Services/patient/patientService.js
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
      const response = await axios.get(`${API_URL}/uhid/${uhid}`);
      return response.data;
    } catch (error) {
      console.error("PatientService.getPatientByUHID error:", error);
      throw error;
    }
  },

  // ✅ NEW: Search patients by name, UHID, phone
  // q = search term, limit = kitne results chahiye
  searchPatients: async (q, limit = 10) => {
    try {
      const response = await axios.get(`${API_URL}/search`, {
        params: { q, limit },
      });
      return response.data; // { success, data: [...], count }
    } catch (error) {
      console.error("PatientService.searchPatients error:", error);
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

  createPatient: async (data) => {
    try {
      const response = await axios.post(API_URL, data);
      return response.data;
    } catch (error) {
      console.error("PatientService.createPatient error:", error);
      throw error;
    }
  },
};

export default patientService;
