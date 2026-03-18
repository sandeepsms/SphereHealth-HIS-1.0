// src/Services/admissionService.js

import axios from "axios";
import { API_ENDPOINTS } from "../config/api.js";

const API_URL = API_ENDPOINTS.ADMISSIONS;

const admissionService = {
  // ── GET /api/admissions ───────────────────────────────────────
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

  // ── GET /api/admissions/search?q=... ─────────────────────────
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
  getStatistics: async (params = {}) => {
    try {
      const response = await axios.get(`${API_URL}/statistics`, { params });
      return response.data;
    } catch (error) {
      console.error("admissionService.getStatistics error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/discharges/today ─────────────────────
  getTodayDischarges: async () => {
    try {
      const response = await axios.get(`${API_URL}/discharges/today`);
      return response.data;
    } catch (error) {
      console.error("admissionService.getTodayDischarges error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/discharges/expected ──────────────────
  getExpectedDischarges: async (date = null) => {
    try {
      const response = await axios.get(`${API_URL}/discharges/expected`, {
        params: date ? { date } : {},
      });
      return response.data;
    } catch (error) {
      console.error("admissionService.getExpectedDischarges error:", error);
      throw error;
    }
  },

  // ── GET /api/admissions/doctor/:doctorName ────────────────────
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

  // ── GET /api/admissions/patient-by-uhid/:uhid ────────────────
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
  // Used by PatientHistoryModal
  getPatientAdmissionHistory: async (patientId) => {
    try {
      const response = await axios.get(
        `${API_URL}/patient/${patientId}/history`,
      );
      return (
        response.data?.admissions || response.data?.data || response.data || []
      );
    } catch (error) {
      console.error(
        "admissionService.getPatientAdmissionHistory error:",
        error,
      );
      throw error;
    }
  },

  // ✅ Alias — same as getPatientAdmissionHistory
  // Used by PatientHistoryModal as admissionService.getAdmissionsByPatient
  getAdmissionsByPatient: async (patientId) => {
    try {
      const response = await axios.get(
        `${API_URL}/patient/${patientId}/history`,
      );
      return (
        response.data?.admissions || response.data?.data || response.data || []
      );
    } catch (error) {
      console.error("admissionService.getAdmissionsByPatient error:", error);
      // Fallback: getAllAdmissions with patientId filter
      try {
        const fb = await axios.get(API_URL, {
          params: { patientId, limit: 50 },
        });
        return fb.data?.admissions || fb.data?.data || [];
      } catch {
        return [];
      }
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

// Default export
export default admissionService;

// Named export (for files using: import { admissionService } from "...")
export { admissionService };
