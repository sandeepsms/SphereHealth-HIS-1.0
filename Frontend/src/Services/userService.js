import axios from "axios";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
import { API_ENDPOINTS } from "../config/api";
const API_URL = API_ENDPOINTS.DOCTORPRECEPTION;

export const addPatient = async (data) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/patients/add`, data);
    return response;
  } catch (error) {
    console.error("Error posting new data:", error);
    throw error;
  }
};

export const Doctordetail = async (data) => {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/doctordetail/doctoradd`,
      data
    );
    return response;
  } catch (error) {
    console.error("Error posting new data:", error);
    throw error;
  }
};

export const RegistrationOPD = async (data) => {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/RegistrationOPD/Registraiondata`,
      data
    );
    return response;
  } catch (error) {
    console.error("Error posting new data:", error);
    throw error;
  }
};

export const getPatients = async (data) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/patients/getAllPatients`);
    return response.data;
  } catch (error) {
    console.error("Error posting get data:", error);
    throw error;
  }
};

// export const getPatientbyID = async (UHID) => {
//   try {
//     const response = await axios.get(
//       `${API_BASE_URL}/  /getPatientsbyID/${UHID}`
//     );
//     console.log(response);

//     return response.data;
//   } catch (error) {
//     console.error("Error fetching patient data:", error);
//     throw error;
//   }
// };


export const getPatientbyID = async (UHID) => {
  try {
    const response = await axios.get(
      `${API_URL}/${UHID}`
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching patient data:", error);
    throw error;
  }
};


export const getdoctorpatientbyID = async (UHID) => {
  try {
    const reponse = await axios.get(
      `${API_BASE_URL}/doctordetail/doctoradd/${UHID}`
    );
    return reponse.data;
  } catch (error) {
    console.error("Error fetching patient data:", error);
    throw error;
  }
};
