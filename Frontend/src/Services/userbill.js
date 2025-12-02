import axios from "axios";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const Servicebill = async (data) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/Servicebilldata/addbill`, data);
    return response;
  } catch (error) {
    console.error("Error posting new data:", error);
    throw error;
  }
};


