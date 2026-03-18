// frontend/services/investigationService.js
import { API_ENDPOINTS } from "../../config/api";

const API_BASE = API_ENDPOINTS.INVESTIGATIONS;

export const investigationService = {
  getAll: async (params = {}) => {
    try {
      const query = new URLSearchParams(params).toString();
      const res = await fetch(`${API_BASE}${query ? `?${query}` : ""}`);
      const data = await res.json();
      return { investigations: data.data || [], total: data.total || 0 };
    } catch (e) {
      console.error(e);
      return { investigations: [], total: 0 };
    }
  },

  getGrouped: async () => {
    try {
      const res = await fetch(`${API_BASE}/grouped`);
      const data = await res.json();
      return data.data || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  getById: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/${id}`);
      const data = await res.json();
      return data.data;
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  create: async (formData) => {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to create");
    return data.data;
  },

  update: async (id, formData) => {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to update");
    return data.data;
  },

  deactivate: async (id) => {
    const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to deactivate");
    return data;
  },

  getPricing: async (id) => {
    try {
      const res = await fetch(`${API_BASE}/${id}/pricing`);
      const data = await res.json();
      return data.data || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  setPricing: async (id, pricingData) => {
    const res = await fetch(`${API_BASE}/${id}/pricing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pricingData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to set pricing");
    return data.data;
  },

  getEffectivePrice: async (
    id,
    { tariffType = "CASH", tpaId = null, UHID = null } = {},
  ) => {
    try {
      const params = new URLSearchParams({ tariffType });
      if (tpaId) params.append("tpaId", tpaId);
      if (UHID) params.append("UHID", UHID);
      const res = await fetch(`${API_BASE}/${id}/effective-price?${params}`);
      const data = await res.json();
      return data.data;
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  setDoctorOverride: async (id, overrideData) => {
    const res = await fetch(`${API_BASE}/${id}/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrideData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to set override");
    return data.data;
  },

  getOverridesForPatient: async (UHID) => {
    try {
      const res = await fetch(`${API_BASE}/overrides/${UHID}`);
      const data = await res.json();
      return data.data || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  seed: async () => {
    const res = await fetch(`${API_BASE}/seed`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Seed failed");
    return data.data;
  },
};
