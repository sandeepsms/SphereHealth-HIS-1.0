// services/tpaService.js (React)
import axios from "axios";

const API_URL = "http://localhost:5000/api/tpa";

export const tpaService = {
  // Get all TPAs
  getAllTPAs: async (filters = {}) => {
    try {
      const response = await axios.get(API_URL, { params: filters });
      return response.data;
    } catch (error) {
      console.error("Failed to fetch TPAs:", error);
      throw error;
    }
  },

  // Get active TPAs (for dropdown)
  getActiveTPAs: async () => {
    try {
      const response = await axios.get(`${API_URL}/active`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch active TPAs:", error);
      throw error;
    }
  },

  // Get TPA by ID
  getTPAById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch TPA:", error);
      throw error;
    }
  },

  // Create TPA
  createTPA: async (data) => {
    try {
      const response = await axios.post(API_URL, data);
      return response.data;
    } catch (error) {
      console.error("Failed to create TPA:", error);
      throw error;
    }
  },

  // Update TPA
  updateTPA: async (id, data) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("Failed to update TPA:", error);
      throw error;
    }
  },

  // Delete TPA
  deleteTPA: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("Failed to delete TPA:", error);
      throw error;
    }
  },

  // Search TPAs
  searchTPAs: async (searchTerm) => {
    try {
      const response = await axios.get(`${API_URL}/search`, {
        params: { q: searchTerm },
      });
      return response.data;
    } catch (error) {
      console.error("Failed to search TPAs:", error);
      throw error;
    }
  },
};
