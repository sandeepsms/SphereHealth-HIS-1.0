/**
 * ecgRegisterService.js — R7en / NABH AAC.4 + IPSG.2 + COP.7
 *
 * Thin axios wrapper around /api/ecg-register. Five endpoints:
 *   listECG(params)        — GET   /
 *   getECG(id)             — GET   /:id
 *   createECG(payload)     — POST  /
 *   reportECG(id, body)    — PATCH /:id/report
 *   reviewECG(id, body)    — PATCH /:id/review
 *
 * Mirrors the pattern used by other compliance services (icuBundleService,
 * procedureNoteService etc.).
 */
import axios from "axios";
import { API_BASE_URL as API } from "../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const BASE = `${API}/ecg-register`;

export async function listECG(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  const r = await axios.get(`${BASE}?${qs.toString()}`, authHdr());
  return r.data;
}

export async function getECG(id) {
  const r = await axios.get(`${BASE}/${id}`, authHdr());
  return r.data;
}

export async function createECG(payload) {
  const r = await axios.post(BASE, payload, authHdr());
  return r.data;
}

export async function reportECG(id, body) {
  const r = await axios.patch(`${BASE}/${id}/report`, body, authHdr());
  return r.data;
}

export async function reviewECG(id, body) {
  const r = await axios.patch(`${BASE}/${id}/review`, body, authHdr());
  return r.data;
}

export default {
  listECG,
  getECG,
  createECG,
  reportECG,
  reviewECG,
};
