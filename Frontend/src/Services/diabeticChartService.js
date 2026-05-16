/**
 * diabeticChartService.js
 * Frontend wrapper around /api/diabetic-chart. Uses authFetch so JWT
 * goes through on every call.
 */
import authFetch from "../utils/authFetch";
import { API_ENDPOINTS } from "../config/api";

const BASE = `${API_ENDPOINTS.BASE}/diabetic-chart`;

async function _json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

export async function getDiabeticChart(uhid, date) {
  const r = await authFetch(`${BASE}/${encodeURIComponent(uhid)}/${encodeURIComponent(date)}`);
  return _json(r);
}

export async function listDiabeticDates(uhid) {
  const r = await authFetch(`${BASE}/${encodeURIComponent(uhid)}`);
  return _json(r);
}

export async function upsertDiabeticChart(payload) {
  const r = await authFetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return _json(r);
}

export async function updateScale(sheetId, slidingScale) {
  const r = await authFetch(`${BASE}/${sheetId}/scale`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slidingScale),
  });
  return _json(r);
}

export async function upsertEntry(sheetId, entry) {
  const r = await authFetch(`${BASE}/${sheetId}/entry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  return _json(r);
}

export async function patchEntry(sheetId, entryId, patch) {
  const r = await authFetch(`${BASE}/${sheetId}/entry/${entryId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return _json(r);
}

export async function deleteEntry(sheetId, entryId) {
  const r = await authFetch(`${BASE}/${sheetId}/entry/${entryId}`, { method: "DELETE" });
  return _json(r);
}

export async function recommendDose(sheetId, bg) {
  const r = await authFetch(`${BASE}/${sheetId}/recommend?bg=${encodeURIComponent(bg)}`);
  return _json(r);
}

// Default slots used by the chart UI
export const DEFAULT_SLOTS = [
  { slot: "AC-Breakfast", label: "Pre-Breakfast",   scheduledTime: "07:00" },
  { slot: "PC-Breakfast", label: "Post-Breakfast",  scheduledTime: "09:30" },
  { slot: "AC-Lunch",     label: "Pre-Lunch",       scheduledTime: "12:30" },
  { slot: "PC-Lunch",     label: "Post-Lunch",      scheduledTime: "15:00" },
  { slot: "AC-Dinner",    label: "Pre-Dinner",      scheduledTime: "19:00" },
  { slot: "PC-Dinner",    label: "Post-Dinner",     scheduledTime: "21:30" },
  { slot: "HS",           label: "Bedtime (HS)",    scheduledTime: "22:30" },
];

export default {
  getDiabeticChart, listDiabeticDates, upsertDiabeticChart,
  updateScale, upsertEntry, patchEntry, deleteEntry,
  recommendDose, DEFAULT_SLOTS,
};
