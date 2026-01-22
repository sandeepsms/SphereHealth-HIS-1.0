import axios from "axios";
// import { API_BASE_URL } from "../utils/constants";
import API_ENDPOINTS from "../../config/api";
// const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const API_BASE_URLs = API_ENDPOINTS.DOCTORPRECEPTION;

// export const getdoctorprecetionbyID = async (UHID) => {
//   try {
//     const response = await axios.get(
//       //  `${API_BASE_URL}/RegistrationOPD/getPreceptionreport/${UHID}`
//      `${API_BASE_URLs}/${UHID}`
//     );

//     return response.data;
//   } catch (error) {
//     console.error("Error fetching patient data:", error);
//     throw error;
//   }
// };

export const getdoctorprecetionbyID = async (UHID) => {
  try {
    const response = await axios.get(`${API_BASE_URLs}/${UHID}`);

    return response.data;
  } catch (error) {
    console.error("Error fetching patient data:", error);
    throw error;
  }
};
