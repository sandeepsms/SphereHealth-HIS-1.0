/**
 * nursingChargesService.js — R7hr-164
 *
 * Thin axios wrapper around /api/nursing-charges. Used by:
 *   • NursingEquipmentPage  (admin master catalogue CRUD)
 *   • NursingNotes          (nurse-side "Equipment Used This Shift")
 *
 * Pure read of the items list is gated by `billing.read` and master
 * mutations by `departments.write` (see nursingChargesRoutes.js). The
 * `log` + `voidEntry` paths are guarded by `billing.manual-charge` —
 * those are nurse-side ops and live on NursingNotes.jsx today, so this
 * service only ships the bits the admin page needs.
 *
 * Conventions match roomCategoryChargesService.js — every method
 * returns the raw response.data envelope and console.errors on failure
 * before re-throwing so the calling page surfaces a toast.
 */
import axios from "axios";
import { API_BASE_URL } from "../config/api.js";

const API_URL = `${API_BASE_URL}/nursing-charges`;

const nursingChargesService = {
  // GET /api/nursing-charges/items  → master catalogue (only isActive=true)
  listItems: async () => {
    try {
      const r = await axios.get(`${API_URL}/items`);
      return r.data;
    } catch (e) {
      console.error("nursingChargesService.listItems error:", e);
      throw e;
    }
  },

  // POST /api/nursing-charges/items  → create
  createItem: async (payload) => {
    try {
      const r = await axios.post(`${API_URL}/items`, payload);
      return r.data;
    } catch (e) {
      console.error("nursingChargesService.createItem error:", e);
      throw e;
    }
  },

  // PUT /api/nursing-charges/items/:id  → update
  updateItem: async (id, payload) => {
    try {
      const r = await axios.put(`${API_URL}/items/${id}`, payload);
      return r.data;
    } catch (e) {
      console.error("nursingChargesService.updateItem error:", e);
      throw e;
    }
  },

  // DELETE /api/nursing-charges/items/:id  → soft-delete (sets isActive=false)
  deleteItem: async (id) => {
    try {
      const r = await axios.delete(`${API_URL}/items/${id}`);
      return r.data;
    } catch (e) {
      console.error("nursingChargesService.deleteItem error:", e);
      throw e;
    }
  },
};

export default nursingChargesService;
