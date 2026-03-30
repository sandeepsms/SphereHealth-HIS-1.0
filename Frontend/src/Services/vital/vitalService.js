import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL; 

export const saveVitalSheet = async (data) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/vitalsheet`, data); 
    return response.data;
  } catch (error) {
    console.error("Error saving vital sheet:", error);

    return {
      success: false,
      message: error.response?.data?.message || "Server error",
      status: error.response?.status || 500
    };
  }
};

export const getVitalSheet = async (uhid, date) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/vitalsheet`, {
      params: { uhid, date }
    });

    return response.data;

  } catch (error) {
    console.error("Error fetching vitals:", error);

    return {
      success: false,
      message: error.response?.data?.message || "Server error",
      status: error.response?.status || 500
    };
  }
};


export const updateVitalSheet = async (data) => {
  try {
    const response = await axios.put(`${API_BASE_URL}/vitalsheet/update`, data);

    return response.data;

  } catch (error) {
    console.error("Error updating vital sheet:", error);

    return {
      success: false,
      message: error.response?.data?.message || "Server error",
      status: error.response?.status || 500
    };
  }
};


export const deleteVitalSheet = async (uhid, date) => {
  try {
    const response = await axios.delete(`${API_BASE_URL}/vitalsheet/delete`, {
      data: { uhid, date }
    });

    return response.data;

  } catch (error) {
    console.error("Error deleting vital sheet:", error);

    return {
      success: false,
      message: error.response?.data?.message || "Server error",
      status: error.response?.status || 500
    };
  }
};
