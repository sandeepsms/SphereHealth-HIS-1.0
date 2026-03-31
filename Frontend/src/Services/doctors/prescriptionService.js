import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.PRESCRIPTIONS;

export const prescriptionService = {
  // Check if prescription exists for UHID (CREATE or UPDATE mode)
  checkCreateOrUpdate: async (UHID) => {
    try {
      const response = await axios.get(`${API_URL}/checkByuhid/${UHID}`);
      return response;
    } catch (error) {
      console.error("checkCreateOrUpdate error:", error);
      throw error;
    }
  },

  // Create or update prescription by UHID
  createPrescription: async (UHID, data) => {
    try {
      const response = await axios.post(`${API_URL}/uhid/${UHID}`, data);
      return response.data;
    } catch (error) {
      console.error("createPrescription error:", error);
      throw error;
    }
  },

  // Get all prescriptions (with optional filters)
  getAllPrescriptions: async (filters = {}) => {
    try {
      const response = await axios.get(API_URL, { params: filters });
      return response.data;
    } catch (error) {
      console.error("getAllPrescriptions error:", error);
      throw error;
    }
  },

  // Get prescription by ID
  getPrescriptionById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("getPrescriptionById error:", error);
      throw error;
    }
  },

  // Get prescription by UHID
  getPrescriptionsByUHID: async (UHID) => {
    try {
      const response = await axios.get(`${API_URL}/uhid/${UHID}`);
      return response.data;
    } catch (error) {
      console.error("getPrescriptionsByUHID error:", error);
      throw error;
    }
  },

  // Update prescription by ID
  updatePrescription: async (id, data) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("updatePrescription error:", error);
      throw error;
    }
  },

  // Delete prescription
  deletePrescription: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("deletePrescription error:", error);
      throw error;
    }
  },
};
