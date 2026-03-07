// src/Services/patient/admissionService.js
// Tumhare existing /api/admissions routes ke according
// Same axios pattern as patientService.js

import axios from "axios";
import { API_ENDPOINTS } from "../config/api.js";

const API_URL = API_ENDPOINTS.ADMISSIONS;

const admissionService = {
  // ── GET /api/admissions ───────────────────────────────────────
  // Filters: status, admissionType, attendingDoctor
  getAllAdmissions: async (params = {}) => {
    try {
      const response = await axios.get(API_URL, { params });
      return response.data;
    } catch (error) {
      console.error("admissionService.getAllAdmissions error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/active ────────────────────────────────
  // Filters: department, admissionType, attendingDoctor
  getActiveAdmissions: async (params = {}) => {
    try {
      const response = await axios.get(`${API_URL}/active`, { params });
      return response.data;
    } catch (error) {
      console.error("admissionService.getActiveAdmissions error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/today ─────────────────────────────────
  getTodayAdmissions: async () => {
    try {
      const response = await axios.get(`${API_URL}/today`);
      return response.data;
    } catch (error) {
      console.error("admissionService.getTodayAdmissions error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/search?q=Rahul ───────────────────────
  searchAdmissions: async (q) => {
    try {
      const response = await axios.get(`${API_URL}/search`, { params: { q } });
      return response.data;
    } catch (error) {
      console.error("admissionService.searchAdmissions error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/statistics ───────────────────────────
  // Optional: startDate, endDate
  getStatistics: async (params = {}) => {
    try {
      const response = await axios.get(`${API_URL}/statistics`, { params });
      return response.data;
    } catch (error) {
      console.error("admissionService.getStatistics error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/discharges/today ──────────────────────
  getTodayDischarges: async () => {
    try {
      const response = await axios.get(`${API_URL}/discharges/today`);
      return response.data;
    } catch (error) {
      console.error("admissionService.getTodayDischarges error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/discharges/expected ───────────────────
  // Optional: date (e.g. "2026-02-27")
  getExpectedDischarges: async (date = null) => {
    try {
      const params = date ? { date } : {};
      const response = await axios.get(`${API_URL}/discharges/expected`, {
        params,
      });
      return response.data;
    } catch (error) {
      console.error("admissionService.getExpectedDischarges error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/doctor/:doctorName ────────────────────
  // Returns all ACTIVE admissions under that doctor
  getAdmissionsByDoctor: async (doctorName) => {
    try {
      const response = await axios.get(
        `${API_URL}/doctor/${encodeURIComponent(doctorName)}`,
      );
      return response.data;
    } catch (error) {
      console.error("admissionService.getAdmissionsByDoctor error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/patient-by-uhid/:uhid ─────────────────
  getPatientByUHID: async (uhid) => {
    try {
      const response = await axios.get(`${API_URL}/patient-by-uhid/${uhid}`);
      return response.data;
    } catch (error) {
      console.error("admissionService.getPatientByUHID error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/patient/:patientId/history ────────────
  getPatientAdmissionHistory: async (patientId) => {
    try {
      const response = await axios.get(
        `${API_URL}/patient/${patientId}/history`,
      );
      return response.data;
    } catch (error) {
      console.error(
        "admissionService.getPatientAdmissionHistory error:",
        error,
      );
      throw error;
    }
  },

  // ── GET /api/admissions/:id ───────────────────────────────────
  getAdmissionById: async (id) => {
    try {
      const response = await axios.get(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("admissionService.getAdmissionById error:", error);
      throw error;
    }
  },

  // ── POST /api/admissions ──────────────────────────────────────
  // Required: patientId (or UHID), bedId, department, reasonForAdmission
  // Optional: admissionDate, expectedDischargeDate, admissionType,
  //           attendingDoctor, estimatedCost, advancePaid
  createAdmission: async (data) => {
    try {
      const response = await axios.post(API_URL, data);
      return response.data;
    } catch (error) {
      console.error("admissionService.createAdmission error:", error);
      throw error;
    }
  },

  // ── PUT /api/admissions/:id ───────────────────────────────────
  // Allowed: department, expectedDischargeDate, reasonForAdmission,
  //          admissionType, attendingDoctor, dischargeNotes,
  //          dischargeSummary, estimatedCost, advancePaid
  updateAdmission: async (id, data) => {
    try {
      const response = await axios.put(`${API_URL}/${id}`, data);
      return response.data;
    } catch (error) {
      console.error("admissionService.updateAdmission error:", error);
      throw error;
    }
  },

  // ── DELETE /api/admissions/:id ────────────────────────────────
  // Admin only — frees bed if Active
  deleteAdmission: async (id) => {
    try {
      const response = await axios.delete(`${API_URL}/${id}`);
      return response.data;
    } catch (error) {
      console.error("admissionService.deleteAdmission error:", error);
      throw error;
    }
  },

  // ── POST /api/admissions/:id/discharge ───────────────────────
  // Optional: actualDischargeDate, dischargeNotes, dischargeSummary,
  //           conditionOnDischarge, followUpInstructions, totalCost
  dischargePatient: async (id, data = {}) => {
    try {
      const response = await axios.post(`${API_URL}/${id}/discharge`, data);
      return response.data;
    } catch (error) {
      console.error("admissionService.dischargePatient error:", error);
      throw error;
    }
  },

  // ── POST /api/admissions/:id/cancel ──────────────────────────
  // Required: reason
  cancelAdmission: async (id, reason) => {
    try {
      const response = await axios.post(`${API_URL}/${id}/cancel`, { reason });
      return response.data;
    } catch (error) {
      console.error("admissionService.cancelAdmission error:", error);
      throw error;
    }
  },

  // ── POST /api/admissions/:id/transfer ────────────────────────
  // Required: newBedId
  // Optional: reason
  transferBed: async (id, newBedId, reason = "") => {
    try {
      const response = await axios.post(`${API_URL}/${id}/transfer`, {
        newBedId,
        reason,
      });
      return response.data;
    } catch (error) {
      console.error("admissionService.transferBed error:", error);
      throw error;
    }
  },
};

// Default export (patientService.js pattern ke liye)
export default admissionService;

// Named export (BedVisualLayout.jsx pattern ke liye)
// import admissionService from "..."   ✅ dono kaam karenge
// import { admissionService } from "..." ✅
export { admissionService };
