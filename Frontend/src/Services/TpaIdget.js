import axios from "axios";
const API_BASE_URL = "http://localhost:5000/api";

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
