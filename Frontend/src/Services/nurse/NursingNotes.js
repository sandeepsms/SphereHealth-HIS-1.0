import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

// FIX (audit P22-B1): hard-coded http://localhost:5000 broke every prod
// deployment AND every team-mate dev box that uses a non-default port.
// Use the configured API base. Also fix the GET URL — backend has no
// `/:uhid` route on /api/nurse-notes; the correct lookup is by ipdNo.
const API = `${API_ENDPOINTS.BASE}/nurse-notes`;

// CREATE
export const createNurseNote = (data) => axios.post(API, data);

// GET (by IPD admission number — primary key for IPD notes)
export const getNurseNotesByIPD = (ipdNo) => axios.get(`${API}/ipd/${ipdNo}`);

// GET (by patient ObjectId — secondary lookup)
export const getNurseNotesByPatient = (patientId) =>
  axios.get(`${API}/patient/${patientId}`);

// Back-compat shim — callers that passed `uhid` were actually broken before;
// route their request to the ipdNo endpoint so they at least hit a real route.
export const getNurseNotes = (ipdOrUhid) =>
  axios.get(`${API}/ipd/${ipdOrUhid}`);

// UPDATE
export const updateNurseNote = (id, data) => axios.put(`${API}/${id}`, data);

// DELETE
export const deleteNurseNote = (id) => axios.delete(`${API}/${id}`);
