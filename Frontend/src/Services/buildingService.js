import API_ENDPOINTS from "../config/api";

const API_BASE = API_ENDPOINTS.BASE;

const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeBuilding = (building) => {
  if (!building) return building;
  return {
    ...building,
    _id: extractId(building._id),
  };
};

export const buildingService = {
  getAllBuildings: async () => {
    try {
      const response = await fetch(API_ENDPOINTS.BUILDINGS);
      const data = await response.json();
      const buildings = Array.isArray(data)
        ? data
        : data.data || data.buildings || [];
      return buildings.map(normalizeBuilding);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getBuildingById: async (id) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.BUILDINGS}/${id}`);
      const building = await response.json();
      return normalizeBuilding(building);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  getBuildingDetails: async (id) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.BUILDINGS}/details/${id}`);
      const building = await response.json();
      return normalizeBuilding(building);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  createBuilding: async (data) => {
    try {
      const response = await fetch(API_ENDPOINTS.BUILDINGS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const building = await response.json();
      return normalizeBuilding(building);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  updateBuilding: async (id, data) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.BUILDINGS}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const building = await response.json();
      return normalizeBuilding(building);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  deleteBuilding: async (id) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.BUILDINGS}/${id}`, {
        method: "DELETE",
      });
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },
};
