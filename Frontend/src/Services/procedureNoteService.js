/**
 * procedureNoteService.js
 * Frontend wrapper around /api/procedure-notes — the post-op completion
 * note endpoint that transitions an OTRegister row Scheduled → Completed.
 *
 * Uses authFetch so the JWT goes through on every call.
 */
import authFetch from "../utils/authFetch";
import { API_BASE_URL } from "../config/api";

const BASE = `${API_BASE_URL}/procedure-notes`;

async function _json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.code;
    err.data = data?.data;
    throw err;
  }
  return data;
}

/**
 * Create a procedure note for a finished OT case.
 *
 * @param {object} payload
 * @param {string} payload.doctorOrderId         — source OT-bound DoctorOrder
 * @param {string} payload.startTime             — ISO timestamp
 * @param {string} payload.endTime               — ISO timestamp
 * @param {string} payload.actualProcedure       — required text
 * @param {string} [payload.surgeryName]
 * @param {string} [payload.surgeon]
 * @param {string[]} [payload.assistantSurgeons]
 * @param {string} [payload.anaesthetistName]
 * @param {string} [payload.anaesthesiaType]     — "" | General | Spinal | …
 * @param {string} [payload.asaGrade]            — "" | I..VI
 * @param {string} [payload.complications]
 * @param {number} [payload.bloodLossMl]
 * @param {Array<{name:string,sentTo:string,sentAt?:string}>} [payload.specimensSent]
 * @param {string} [payload.postOpDestination]   — Ward | ICU | HDU | Recovery | Discharge
 */
export async function createProcedureNote(payload) {
  const r = await authFetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return _json(r);
}

/**
 * Fetch the procedure note for a given DoctorOrder. Returns null when
 * the OT case is still Scheduled (no note yet).
 */
export async function getProcedureNoteByOrder(orderId) {
  try {
    const r = await authFetch(`${BASE}/order/${encodeURIComponent(orderId)}`);
    const data = await _json(r);
    return data?.data || null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function getProcedureNote(id) {
  const r = await authFetch(`${BASE}/${encodeURIComponent(id)}`);
  return _json(r);
}

export async function listProcedureNotes(params = {}) {
  const q = new URLSearchParams();
  if (params.doctorOrderId) q.set("doctorOrderId", params.doctorOrderId);
  if (params.UHID)          q.set("UHID", params.UHID);
  if (params.admissionId)   q.set("admissionId", params.admissionId);
  if (params.from)          q.set("from", params.from);
  if (params.to)            q.set("to", params.to);
  if (params.limit)         q.set("limit", String(params.limit));
  const r = await authFetch(`${BASE}?${q.toString()}`);
  return _json(r);
}

export default {
  createProcedureNote,
  getProcedureNoteByOrder,
  getProcedureNote,
  listProcedureNotes,
};
