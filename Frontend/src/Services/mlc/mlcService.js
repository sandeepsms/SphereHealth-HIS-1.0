import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

const BASE = API_ENDPOINTS.MLC;

const mlcService = {
  list:    (params)      => axios.get(BASE, { params }).then(r => r.data),
  get:     (idOrMlr)     => axios.get(`${BASE}/${idOrMlr}`).then(r => r.data),
  create:  (payload)     => axios.post(BASE, payload).then(r => r.data),
  update:  (idOrMlr, p)  => axios.put(`${BASE}/${idOrMlr}`, p).then(r => r.data),
  remove:  (idOrMlr)     => axios.delete(`${BASE}/${idOrMlr}`).then(r => r.data),
  // Preview the 2-letter prefix candidates for a doctor
  previewPrefix: (doctorId) =>
    axios.get(`${BASE}/preview-prefix/${doctorId}`).then(r => r.data),
};

export default mlcService;
