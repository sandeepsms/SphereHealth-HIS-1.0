/**
 * equipmentService.js
 * Wrapper around /api/equipment endpoints.
 */
import authFetch from "../utils/authFetch";
import { API_ENDPOINTS } from "../config/api";

const BASE = `${API_ENDPOINTS.BASE}/equipment`;

async function _json(r) {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || `HTTP ${r.status}`);
  return data;
}

export const listEquipment   = async (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return _json(await authFetch(`${BASE}${qs ? "?" + qs : ""}`));
};
export const getEquipment    = async (id) => _json(await authFetch(`${BASE}/${id}`));
export const getEquipmentStats = async () => _json(await authFetch(`${BASE}/stats`));
export const getServiceDue   = async (days = 14) => _json(await authFetch(`${BASE}/service-due?days=${days}`));

export const createEquipment = async (body) => _json(await authFetch(BASE, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));
export const updateEquipment = async (id, body) => _json(await authFetch(`${BASE}/${id}`, {
  method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));
export const assignEquipment = async (id, body) => _json(await authFetch(`${BASE}/${id}/assign`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));
export const returnEquipment = async (id, body) => _json(await authFetch(`${BASE}/${id}/return`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));
export const logServiceEntry = async (id, body) => _json(await authFetch(`${BASE}/${id}/service`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));
export const retireEquipment = async (id) => _json(await authFetch(`${BASE}/${id}`, { method: "DELETE" }));

export const CATEGORIES = ["Respiratory","Mobility","Monitoring","Therapy","Diagnostic","Other"];
export const LOCATIONS  = ["WAREHOUSE","BED","HOMECARE","SERVICE","RETIRED"];
export const STATUSES   = ["Available","In-use","On-loan","Under-service","Out-of-service","Retired"];

export default {
  listEquipment, getEquipment, getEquipmentStats, getServiceDue,
  createEquipment, updateEquipment, assignEquipment, returnEquipment,
  logServiceEntry, retireEquipment,
  CATEGORIES, LOCATIONS, STATUSES,
};
