import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = `${API_ENDPOINTS.BASE}/prescriptions`;

export const prescriptionService = {
  createPrescription: async (data) => {
    try {
      const response = await axios.post(API_URL, data);
      return response.data;
    } catch (error) {
      console.error("Failed to create prescription:", error);
      throw error;
    }
  },

  getAllPrescriptions: async (filters = {}) => {
    try {
      const response = await axios.get(API_URL, { params: filters });
      return response.data;
    } catch (error) {
      console.error("Failed to fetch prescriptions:", error);
      throw error;
    }
  },

  getPrescriptionById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch prescription:", error);
      throw error;
    }
  },

  getPrescriptionsByUHID: async (UHID) => {
    try {
      const response = await axios.get(`${API_URL}/uhid/${UHID}`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch prescriptions by UHID:", error);
      throw error;
    }
  },

  updatePrescription: async (id, data) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("Failed to update prescription:", error);
      throw error;
    }
  },

  deletePrescription: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("Failed to delete prescription:", error);
      throw error;
    }
  },
};
