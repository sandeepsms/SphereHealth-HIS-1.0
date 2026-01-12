import axios from "axios";
import { API_ENDPOINTS } from "../config/api";

const API_URL = API_ENDPOINTS.DEPARTMENTS;

export const departmentService = {
  getAllDepartments: async (filters = {}) => {
    const response = await axios.get(API_URL, { params: filters });
    return response.data;
  },

  getDepartmentById: async (id) => {
    const response = await axios.get(`${API_URL}/${id}`);
    return response.data;
  },

  createDepartment: async (data) => {
    const response = await axios.post(API_URL, data);
    return response.data;
  },

  updateDepartment: async (id, data) => {
    const response = await axios.put(`${API_URL}/${id}`, data);
    return response.data;
  },

  deleteDepartment: async (id) => {
    const response = await axios.delete(`${API_URL}/${id}`);
    return response.data;
  },

  getActiveDepartments: async () => {
    const response = await axios.get(`${API_URL}/active`);
    return response.data;
  },

  getDepartmentsByCategory: async (category) => {
    const response = await axios.get(`${API_URL}/category/${category}`);
    return response.data;
  },

  searchDepartments: async (searchTerm) => {
    const response = await axios.get(`${API_URL}/search`, {
      params: { q: searchTerm },
    });
    return response.data;
  },

  getDepartmentStats: async () => {
    const response = await axios.get(`${API_URL}/stats`);
    return response.data;
  },
};
