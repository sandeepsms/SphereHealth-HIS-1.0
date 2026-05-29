/**
 * roomCategoryChargesService.js — R7en
 *
 * Thin axios wrapper around /api/admin/room-charges. Mirrors the
 * Services/* convention used by admissionService etc. — every call
 * returns the raw response.data (so the caller decides what to do
 * with success/data envelope shapes) and logs an error before
 * re-throwing so the calling page can surface a toast.
 */
import axios from "axios";
import { API_BASE_URL } from "../config/api.js";

const API_URL = `${API_BASE_URL}/admin/room-charges`;

const roomCategoryChargesService = {
  // GET /api/admin/room-charges
  list: async () => {
    try {
      const r = await axios.get(API_URL);
      return r.data;
    } catch (e) {
      console.error("roomCategoryChargesService.list error:", e);
      throw e;
    }
  },

  // GET /api/admin/room-charges/:id
  getOne: async (id) => {
    try {
      const r = await axios.get(`${API_URL}/${id}`);
      return r.data;
    } catch (e) {
      console.error("roomCategoryChargesService.getOne error:", e);
      throw e;
    }
  },

  // POST /api/admin/room-charges
  create: async (payload) => {
    try {
      const r = await axios.post(API_URL, payload);
      return r.data;
    } catch (e) {
      console.error("roomCategoryChargesService.create error:", e);
      throw e;
    }
  },

  // PUT /api/admin/room-charges/:id
  update: async (id, payload) => {
    try {
      const r = await axios.put(`${API_URL}/${id}`, payload);
      return r.data;
    } catch (e) {
      console.error("roomCategoryChargesService.update error:", e);
      throw e;
    }
  },

  // DELETE /api/admin/room-charges/:id  (soft delete)
  remove: async (id) => {
    try {
      const r = await axios.delete(`${API_URL}/${id}`);
      return r.data;
    } catch (e) {
      console.error("roomCategoryChargesService.remove error:", e);
      throw e;
    }
  },

  // POST /api/admin/room-charges/seed  (idempotent default seed)
  seedDefaults: async () => {
    try {
      const r = await axios.post(`${API_URL}/seed`);
      return r.data;
    } catch (e) {
      console.error("roomCategoryChargesService.seedDefaults error:", e);
      throw e;
    }
  },

  // R7ep — GET /api/admin/room-charges/discover
  // Walks RoomCategoryModel + Room + Bed to surface categories that
  // have beds in the system but no matrix row yet. Returns
  // { configured:[…], missing:[…], summary:{…} }.
  discover: async () => {
    try {
      const r = await axios.get(`${API_URL}/discover`);
      return r.data;
    } catch (e) {
      console.error("roomCategoryChargesService.discover error:", e);
      throw e;
    }
  },

  // R7ep — POST /api/admin/room-charges/auto-import
  // Bulk-create matrix rows for the categories admin picked from the
  // discover panel. Pass { all:true } or { categoryCodes:[...] }.
  autoImport: async (payload) => {
    try {
      const r = await axios.post(`${API_URL}/auto-import`, payload);
      return r.data;
    } catch (e) {
      console.error("roomCategoryChargesService.autoImport error:", e);
      throw e;
    }
  },
};

export default roomCategoryChargesService;
