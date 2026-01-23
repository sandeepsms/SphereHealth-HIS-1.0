// Services/tpa/tpaServiceService.js
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.TPA_SERVICES;

export const tpaServiceService = {
  getAllTPAServices: async (params = {}) => {
    try {
      const response = await axios.get(API_URL, { params });
      return response.data;
    } catch (error) {
      console.error("❌ Failed to fetch TPA services:", error);
      throw error;
    }
  },

  createTPAService: async (data) => {
    try {
      console.log("📤 Creating TPA Service:", data);
      const response = await axios.post(API_URL, data);
      console.log("✅ Create Response:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Failed to create TPA service:", error);
      throw error;
    }
  },

  updateTPAService: async (id, data) => {
    try {
      console.log("📤 Updating TPA Service:", { id, data });
      const response = await axios.put(`${API_URL}/${id}`, data);
      console.log("✅ Update Response:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Failed to update TPA service:", error);
      throw error;
    }
  },

  deleteTPAService: async (id) => {
    try {
      console.log("🗑️ Deleting TPA Service:", id);
      const response = await axios.delete(`${API_URL}/${id}`);
      console.log("✅ Delete Response:", response.data);
      return response.data;
    } catch (error) {
      console.error("❌ Failed to delete TPA service:", error);
      throw error;
    }
  },

  getTPAServiceById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("❌ Failed to fetch TPA service:", error);
      throw error;
    }
  },
};
