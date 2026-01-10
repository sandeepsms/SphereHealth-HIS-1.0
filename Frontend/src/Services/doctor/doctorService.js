import axios from "axios";

const API_URL = "http://localhost:5000/api/doctors";

// ⭐ Debug log
console.log("🔧 doctorService.js loaded, API_URL:", API_URL);

export const doctorService = {
  getAllDoctors: async (filters = {}) => {
    try {
      const response = await axios.get(API_URL, { params: filters });
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to fetch doctors:", error);
      throw error;
    }
  },

  getDoctorById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to fetch doctor:", error);
      throw error;
    }
  },

  createDoctor: async (data) => {
    try {
      const response = await axios.post(API_URL, data);
      return response.data;
    } catch (error) {
      console.error("Failed to create doctor:", error);
      throw error;
    }
  },

  updateDoctor: async (id, data) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("Failed to update doctor:", error);
      throw error;
    }
  },

  deleteDoctor: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("Failed to delete doctor:", error);
      throw error;
    }
  },

  getActiveDoctors: async () => {
    try {
      const response = await axios.get(API_URL, {
        params: { isActive: true },
      });
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to fetch active doctors:", error);
      throw error;
    }
  },

  getDoctorsByDepartment: async (departmentId) => {
    try {
      const response = await axios.get(API_URL, {
        params: { department: departmentId },
      });
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to fetch doctors by department:", error);
      throw error;
    }
  },

  searchDoctors: async (searchTerm) => {
    try {
      const response = await axios.get(`${API_URL}/search`, {
        params: { q: searchTerm },
      });
      return response.data.data || response.data;
    } catch (error) {
      console.error("Failed to search doctors:", error);
      throw error;
    }
  },
};
