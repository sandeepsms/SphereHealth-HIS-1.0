import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.HOSPITAL_CHARGES;

export const hospitalChargesService = {
  getAllHospitalCharges: async (filters = {}) => {
    try {
      const response = await axios.get(API_URL, { params: filters });
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to fetch hospital charges:", error);
      throw error;
    }
  },

  // ✅ Get by document ID (for edit page)
  getHospitalChargesById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/document/${id}`);
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to fetch hospital charges:", error);
      throw error;
    }
  },

  // Get by TPA ID
  getHospitalChargesByTPA: async (tpaId) => {
    try {
      const response = await axios.get(`${API_URL}/tpa/${tpaId}`);
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to fetch hospital charges by TPA:", error);
      throw error;
    }
  },

  createHospitalCharges: async (data) => {
    try {
      const response = await axios.post(`${API_URL}/create`, data);
      return response.data;
    } catch (error) {
      console.error("Failed to create hospital charges:", error);
      throw error;
    }
  },

  updateHospitalCharges: async (id, charges) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, { charges });
      return response.data;
    } catch (error) {
      console.error("Failed to update hospital charges:", error);
      throw error;
    }
  },

  deleteHospitalCharges: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("Failed to delete hospital charges:", error);
      throw error;
    }
  },

  toggleActiveStatus: async (id) => {
    try {
      const response = await axios.patch(`${API_URL}/${id}/toggle-status`);
      return response.data;
    } catch (error) {
      console.error("Failed to toggle hospital charges status:", error);
      throw error;
    }
  },

  getActiveHospitalCharges: async () => {
    try {
      const response = await axios.get(API_URL, {
        params: { isActive: true },
      });
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to fetch active hospital charges:", error);
      throw error;
    }
  },

  searchHospitalCharges: async (searchTerm) => {
    try {
      const response = await axios.get(API_URL, {
        params: { search: searchTerm },
      });
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to search hospital charges:", error);
      throw error;
    }
  },
};
