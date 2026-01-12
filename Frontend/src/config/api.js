// src/config/api.js
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

export const API_ENDPOINTS = {
  BASE: API_BASE_URL,
  DOCTORS: `${API_BASE_URL}/doctors`,
  PATIENTS: `${API_BASE_URL}/patients`,
  DEPARTMENTS: `${API_BASE_URL}/departments`,
  TPA: `${API_BASE_URL}/tpa`,
  BEDS: `${API_BASE_URL}/beds`,
};

export default API_ENDPOINTS;
