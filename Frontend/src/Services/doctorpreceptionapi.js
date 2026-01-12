import axios from "axios";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export const getdoctorprecetionbyID = async (UHID) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/RegistrationOPD/getPreceptionreport/${UHID}`
    );
    console.log(response);

    return response.data;
  } catch (error) {
    console.error("Error fetching patient data:", error);
    throw error;
  }
};
