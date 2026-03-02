import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.RegistrationSearch;

export const RegistrationSearch = {
  RegistrationSearchs: async (uhid) => {
    try {
      const response = await axios.get(`${API_URL}/search/${uhid}`);
      return response.data;
    } catch (error) {
      console.error("Failed to fetch TPAs:", error);
      throw error;
    }
  },
};
