import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.TPA;

export const tpaService = {
  getAllTPAs: async (filters = {}) => {
    try {
      const response = await axios.get(API_URL, { params: filters });
      return response.data;
    } catch (error) {
      console.error("Failed to fetch TPAs:", error);
      throw error;
    }
  },

  getActiveTPAs: async () => {
    try {
      const response = await axios.get(`${API_URL}/active`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch active TPAs:", error);
      throw error;
    }
  },

  getTPAById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch TPA:", error);
      throw error;
    }
  },

  createTPA: async (data) => {
    try {
      const response = await axios.post(API_URL, data);
      return response.data;
    } catch (error) {
      console.error("Failed to create TPA:", error);
      throw error;
    }
  },

  updateTPA: async (id, data) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("Failed to update TPA:", error);
      throw error;
    }
  },

  deleteTPA: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("Failed to delete TPA:", error);
      throw error;
    }
  },

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
