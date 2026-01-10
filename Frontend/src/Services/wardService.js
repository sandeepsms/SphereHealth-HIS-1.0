const API_BASE = "http://localhost:5000/api";

const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeWard = (ward) => {
  if (!ward) return ward;
  return {
    ...ward,
    _id: extractId(ward._id),
    building: extractId(ward.building),
    floor: extractId(ward.floor),
  };
};

export const wardService = {
  getAllWards: async (filters = {}) => {
    try {
      console.log("Fetching all wards with filters:", filters);

      // Build query string
      const queryParams = new URLSearchParams(filters).toString();
      const url = queryParams
        ? `${API_BASE}/wards?${queryParams}`
        : `${API_BASE}/wards`;

      const response = await fetch(url);
      const result = await response.json();

      console.log("Raw API response:", result);

      // Extract wards array from response
      let wards = [];
      if (Array.isArray(result)) {
        wards = result;
      } else if (result.data && Array.isArray(result.data)) {
        wards = result.data;
      } else if (result.wards && Array.isArray(result.wards)) {
        wards = result.wards;
      }

      console.log("Extracted wards:", wards);
      console.log("Total wards count:", wards.length);

      return wards.map(normalizeWard);
    } catch (error) {
      console.error("Error fetching wards:", error);
      return [];
    }
  },

  getWardById: async (id) => {
    try {
      console.log("Fetching ward by ID:", id);

      const response = await fetch(`${API_BASE}/wards/${id}`);
      const result = await response.json();

      console.log("Ward by ID response:", result);

      // Extract ward from response
      const ward = result.data || result;
      return normalizeWard(ward);
    } catch (error) {
      console.error("Error fetching ward by ID:", error);
      return null;
    }
  },

  getWardDetails: async (id) => {
    try {
      console.log("Fetching ward details:", id);

      const response = await fetch(`${API_BASE}/wards/details/${id}`);
      const result = await response.json();

      console.log("Ward details response:", result);

      // Extract ward details from response
      const details = result.data || result;
      return details;
    } catch (error) {
      console.error("Error fetching ward details:", error);
      return null;
    }
  },

  createWard: async (data) => {
    try {
      console.log("Creating ward with data:", data);

      // Transform data to match backend expectations
      const payload = {
        buildingId: data.building,
        floorId: data.floor,
        wardName: data.wardName,
        wardCode: data.wardCode,
        wardType: data.wardType,
        totalBeds: data.totalBeds || 0,
        totalRooms: data.totalRooms || 0,
        hourlyCharge: data.hourlyCharge || 0,
        dailyCharge: data.dailyCharge || 0,
        facilities: data.facilities || [],
        isActive: data.isActive !== undefined ? data.isActive : true,
      };

      console.log("Transformed payload:", payload);

      const response = await fetch(`${API_BASE}/wards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Create ward error:", errorData);
        throw new Error(errorData.message || "Failed to create ward");
      }

      const result = await response.json();
      console.log("Create ward response:", result);

      // Extract ward from response
      const ward = result.data || result;
      return normalizeWard(ward);
    } catch (error) {
      console.error("Error creating ward:", error);
      throw error;
    }
  },

  updateWard: async (id, data) => {
    try {
      console.log("Updating ward:", id, "with data:", data);

      // Transform data to match backend expectations
      const payload = {
        buildingId: data.building,
        floorId: data.floor,
        wardName: data.wardName,
        wardCode: data.wardCode,
        wardType: data.wardType,
        totalBeds: data.totalBeds || 0,
        totalRooms: data.totalRooms || 0,
        hourlyCharge: data.hourlyCharge || 0,
        dailyCharge: data.dailyCharge || 0,
        facilities: data.facilities || [],
        isActive: data.isActive !== undefined ? data.isActive : true,
      };

      console.log("Transformed payload:", payload);

      const response = await fetch(`${API_BASE}/wards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Update ward error:", errorData);
        throw new Error(errorData.message || "Failed to update ward");
      }

      const result = await response.json();
      console.log("Update ward response:", result);

      // Extract ward from response
      const ward = result.data || result;
      return normalizeWard(ward);
    } catch (error) {
      console.error("Error updating ward:", error);
      throw error;
    }
  },

  deleteWard: async (id) => {
    try {
      console.log("Deleting ward:", id);

      const response = await fetch(`${API_BASE}/wards/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Delete ward error:", errorData);
        throw new Error(errorData.message || "Failed to delete ward");
      }

      const result = await response.json();
      console.log("Delete ward response:", result);

      return result;
    } catch (error) {
      console.error("Error deleting ward:", error);
      throw error;
    }
  },
};
