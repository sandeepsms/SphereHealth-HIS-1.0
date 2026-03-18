const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

export const API_ENDPOINTS = {
  BASE: API_BASE_URL,

  // ── Doctors & Patients ────────────────────────────────────────
  DOCTORS: `${API_BASE_URL}/doctors`,
  PATIENTS: `${API_BASE_URL}/patients`,
  DEPARTMENTS: `${API_BASE_URL}/department`,

  // ── TPA & Old Billing ─────────────────────────────────────────
  TPA: `${API_BASE_URL}/tpa`,
  TPA_SERVICES: `${API_BASE_URL}/tpaservice`,
  TPASERVICEBILL: `${API_BASE_URL}/Servicebilldata/addbill`,
  HOSPITAL_CHARGES: `${API_BASE_URL}/hospital-charges`,

  // ── Bed Management ────────────────────────────────────────────
  BEDS: `${API_BASE_URL}/bedss`,
  BUILDINGS: `${API_BASE_URL}/buildings`,
  FLOORS: `${API_BASE_URL}/floors`,
  WARDS: `${API_BASE_URL}/wards`,
  ROOMS: `${API_BASE_URL}/rooms`,
  ROOM_CATEGORIES: `${API_BASE_URL}/room-categories`,

  // ── OPD / Emergency / Admissions ─────────────────────────────
  ADMISSIONS: `${API_BASE_URL}/admissions`,
  OPD: `${API_BASE_URL}/opd`,
  EMERGENCY: `${API_BASE_URL}/emergency`,

  // ── Doctor & Prescriptions ────────────────────────────────────
  DOCTORPRECEPTION: `${API_BASE_URL}/patients/uhid`,
  PRESCRIPTIONS: `${API_BASE_URL}/prescriptions`,

  // ── Search ────────────────────────────────────────────────────
  RegistrationSearch: `${API_BASE_URL}/registartion-search`,

  // ── New Billing System (billing-v3) ───────────────────────────
  SERVICES: `${API_BASE_URL}/services`,
  BILLING: `${API_BASE_URL}/billing`,
  // Bills, payments, TPA claims
  INVESTIGATIONS: `${API_BASE_URL}/investigations`, // Investigation master
};

export default API_ENDPOINTS;
