import axios from "axios";
// const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// import { API_ENDPOINTS } from "../../../config/api.js";

import{API_ENDPOINTS}from "../config/api.js"

const API_URL = API_ENDPOINTS.TPASERVICEBILL;

export const Servicebill = async (data) => {
  try {
    const response = await axios.post(`${API_URL}`,data);
    return response;
  } catch (error) {
    console.error("Error posting new data:", error);
    throw error;
  }
};






// // TPA: `${API_BASE_URL}/tpa`,


// import axios from "axios";
// import { API_ENDPOINTS } from "../config/api";



// const API_URL = API_ENDPOINTS.TPASERVICEBILL;

// export const Servicebill = async (data) => {
//   try {
//     const response = await axios.post(`${API_URL}`, data); // ✅ BODY me
//     return response.data;
//   } catch (error) {
//     console.error("Error posting new data:", error);
//     throw error;
//   }
// };
