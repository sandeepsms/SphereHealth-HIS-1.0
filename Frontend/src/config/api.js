const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

export const API_ENDPOINTS = {
  BASE: API_BASE_URL,
  DOCTORS: `${API_BASE_URL}/doctors`,
  PATIENTS: `${API_BASE_URL}/patients`,
  DEPARTMENTS: `${API_BASE_URL}/department`,
  TPA: `${API_BASE_URL}/tpa`,
  BEDS: `${API_BASE_URL}/bedss`,
  BUILDINGS: `${API_BASE_URL}/buildings`,
  FLOORS: `${API_BASE_URL}/floors`,
  WARDS: `${API_BASE_URL}/wards`,
  ROOMS: `${API_BASE_URL}/rooms`,
  ROOM_CATEGORIES: `${API_BASE_URL}/room-categories`,
  ADMISSIONS: `${API_BASE_URL}/admissions`,
  SERVICES: `${API_BASE_URL}/services`,
  OPD: `${API_BASE_URL}/opd`,
  EMERGENCY: `${API_BASE_URL}/emergency`,
};

console.log("🌐 API Config Loaded:", API_BASE_URL);

export default API_ENDPOINTS;
