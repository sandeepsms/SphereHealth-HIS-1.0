import axios from "axios";
import { API_BASE_URL } from "../config/api";

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
