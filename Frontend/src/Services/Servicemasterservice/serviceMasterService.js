// services/serviceMasterService.js
// Service Master Catalog — sabhi hospital services ka CRUD
// Same pattern as bedService.js

import { API_ENDPOINTS } from "../../config/api";

const API_BASE = API_ENDPOINTS.SERVICES;

// ── Helper: normalize service object ──────────────────────────
const normalizeService = (service) => {
  if (!service) return service;
  return {
    ...service,
    _id: service._id?.$oid || service._id,
    createdAt: service.createdAt || null,
    updatedAt: service.updatedAt || null,
  };
};

export const serviceMasterService = {
  // ── GET /api/services ─────────────────────────────────────────
  // Filters: category, domain, applicableTo, isActive, search, page, limit
  getAllServices: async (params = {}) => {
    try {
      const query = new URLSearchParams(params).toString();
      const response = await fetch(`${API_BASE}${query ? `?${query}` : ""}`);
      const data = await response.json();
      const services = data.data || [];
      return {
        services: services.map(normalizeService),
        total: data.total || services.length,
        page: data.page || 1,
        totalPages: data.totalPages || 1,
      };
    } catch (error) {
      console.error("Error fetching services:", error);
      return { services: [], total: 0, page: 1, totalPages: 1 };
    }
  },

  // ── GET /api/services/grouped ─────────────────────────────────
  // Returns services grouped by domain + category (for billing picker UI)
  getGroupedServices: async (params = {}) => {
    try {
      const query = new URLSearchParams(params).toString();
      const response = await fetch(
        `${API_BASE}/grouped${query ? `?${query}` : ""}`,
      );
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Error fetching grouped services:", error);
      return [];
    }
  },

  // ── GET /api/services/:id ─────────────────────────────────────
  getServiceById: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}`);
      const data = await response.json();
      return normalizeService(data.data);
    } catch (error) {
      console.error("Error fetching service:", error);
      return null;
    }
  },

  // ── POST /api/services ────────────────────────────────────────
  createService: async (formData) => {
    try {
      const response = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to create service");
      }

      const data = await response.json();
      return normalizeService(data.data);
    } catch (error) {
      console.error("Error creating service:", error);
      throw error;
    }
  },

  // ── PUT /api/services/:id ─────────────────────────────────────
  updateService: async (id, formData) => {
    try {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to update service");
      }

      const data = await response.json();
      return normalizeService(data.data);
    } catch (error) {
      console.error("Error updating service:", error);
      throw error;
    }
  },

  // ── DELETE /api/services/:id (soft delete) ────────────────────
  deleteService: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error deleting service:", error);
      throw error;
    }
  },

  // ── GET /api/services/:id/pricing ────────────────────────────
  getServicePricing: async (serviceId) => {
    try {
      const response = await fetch(`${API_BASE}/${serviceId}/pricing`);
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Error fetching pricing:", error);
      return [];
    }
  },

  // ── POST /api/services/:id/pricing ───────────────────────────
  // tariffType: CASH / TPA / CORPORATE
  setServicePricing: async (serviceId, pricingData) => {
    try {
      const response = await fetch(`${API_BASE}/${serviceId}/pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricingData),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to set pricing");
      }

      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error("Error setting pricing:", error);
      throw error;
    }
  },

  // ── POST /api/services/seed ───────────────────────────────────
  // Run once — loads 80+ default hospital services
  seedDefaultServices: async () => {
    try {
      const response = await fetch(`${API_BASE}/seed`, { method: "POST" });
      const data = await response.json();
      return data.data; // { created, skipped, errors, total }
    } catch (error) {
      console.error("Error seeding services:", error);
      throw error;
    }
  },
};
