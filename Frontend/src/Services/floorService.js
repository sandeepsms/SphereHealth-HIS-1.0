import API_ENDPOINTS from "../config/api";
import authFetch from "../utils/authFetch";

const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeFloor = (floor) => {
  if (!floor) return floor;
  return {
    ...floor,
    _id: extractId(floor._id),
    building: extractId(floor.building),
  };
};

export const floorService = {
  getAllFloors: async () => {
    try {
      const response = await authFetch(API_ENDPOINTS.FLOORS);
      const data = await response.json();
      const floors = Array.isArray(data)
        ? data
        : data.data || data.floors || [];
      return floors.map(normalizeFloor);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getFloorById: async (id) => {
    try {
      const response = await authFetch(`${API_ENDPOINTS.FLOORS}/${id}`);
      const floor = await response.json();
      return normalizeFloor(floor);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  getFloorDetails: async (id) => {
    try {
      const response = await authFetch(`${API_ENDPOINTS.FLOORS}/details/${id}`);
      const floor = await response.json();
      return normalizeFloor(floor);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  createFloor: async (data) => {
    try {
      const response = await authFetch(API_ENDPOINTS.FLOORS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const floor = await response.json();
      return normalizeFloor(floor);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  updateFloor: async (id, data) => {
    try {
      const response = await authFetch(`${API_ENDPOINTS.FLOORS}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const floor = await response.json();
      return normalizeFloor(floor);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  deleteFloor: async (id) => {
    try {
      const response = await authFetch(`${API_ENDPOINTS.FLOORS}/${id}`, {
        method: "DELETE",
      });
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },
};
