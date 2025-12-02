import axios from "axios";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const getTpaId = async (TpaId) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/Servicebilldata/getTpaId/${TpaId}`
    );
    console.log("rrr--------", response);

    return response.data;
  } catch (error) {
    console.error("Error fetching patient data:", error);
    throw error;
  }
};
