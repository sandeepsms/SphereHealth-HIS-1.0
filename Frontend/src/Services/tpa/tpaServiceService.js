import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.TPA_SERVICES;

export const tpaServiceService = {
  getAllTPAServices: async () => {
    try {
      const response = await axios.get(API_URL);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  createTPAService: async (data) => {
    try {
      const response = await axios.post(API_URL, data);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  updateTPAService: async (id, data) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, data);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  deleteTPAService: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  getTPAServiceById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  },
};
