import axios from "axios";

const API = "http://localhost:5000/api/nurse-notes";

// CREATE
export const createNurseNote = (data) => axios.post(API, data);

// GET
export const getNurseNotes = (uhid) => axios.get(`${API}/${uhid}`);

// UPDATE
export const updateNurseNote = (id, data) =>
  axios.put(`${API}/${id}`, data);

// DELETE
export const deleteNurseNote = (id) =>
  axios.delete(`${API}/${id}`);