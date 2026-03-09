import { API_ENDPOINTS } from "../config/api";

const API_BASE = API_ENDPOINTS.BEDS;

const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeBed = (bed) => {
  if (!bed) return bed;
  return {
    ...bed,
    _id: extractId(bed._id),
    building: extractId(bed.building),
    floor: extractId(bed.floor),
    ward: extractId(bed.ward),
    room: extractId(bed.room),
    patient: extractId(bed.patient),
    admission: extractId(bed.admission),
  };
};

export const bedService = {
  getAllBeds: async () => {
    try {
      const response = await fetch(API_BASE);
      const data = await response.json();
      const beds = Array.isArray(data) ? data : data.data || data.beds || [];
      return beds.map(normalizeBed);
    } catch (error) {
      console.error("Error fetching beds:", error);
      return [];
    }
  },

  getAvailableBeds: async () => {
    try {
      const response = await fetch(`${API_BASE}/available`);
      const data = await response.json();
      const beds = Array.isArray(data) ? data : data.data || [];
      return beds.map(normalizeBed);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getBedById: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}`);
      const bed = await response.json();
      return normalizeBed(bed);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  createBed: async (formData) => {
    try {
      // ✅ FIX: flat payload bhejo — backend ko building, floor, room, bedNumber chahiye
      const payload = {
        building: formData.building,
        floor: formData.floor,
        ward: formData.ward || null,
        room: formData.room,
        bedNumber: formData.bedNumber,
        status: formData.status || "Available",
        isActive: formData.isActive ?? true,
        notes: formData.notes || "",
      };

      // Safety check — required fields
      if (!payload.room) throw new Error("Room is required");
      if (!payload.floor) throw new Error("Floor is required");
      if (!payload.building) throw new Error("Building is required");
      if (!payload.bedNumber) throw new Error("Bed number is required");

      const response = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorText}`,
        );
      }

      const result = await response.json();

      // Handle different response shapes
      if (result.createdBeds?.length > 0)
        return normalizeBed(result.createdBeds[0]);
      if (result.data) return normalizeBed(result.data);
      if (result._id) return normalizeBed(result);
      if (Array.isArray(result) && result.length > 0)
        return normalizeBed(result[0]);

      throw new Error(result.message || result.error || "Failed to create bed");
    } catch (error) {
      console.error("Error creating bed:", error);
      throw error;
    }
  },

  updateBed: async (id, data) => {
    try {
      // Strip pricing/services fields — managed via TPA
      const { pricing, services, ...cleanData } = data;

      const response = await fetch(`${API_BASE}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorText}`,
        );
      }

      const bed = await response.json();
      return normalizeBed(bed);
    } catch (error) {
      console.error("Error updating bed:", error);
      throw error;
    }
  },

  deleteBed: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  bookBed: async (id, data) => {
    try {
      const response = await fetch(`${API_BASE}/${id}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const bed = await response.json();
      return normalizeBed(bed);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  dischargeBed: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}/discharge`, {
        method: "POST",
      });
      const bed = await response.json();
      return normalizeBed(bed);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  updateBedStatus: async (id, status) => {
    try {
      const response = await fetch(`${API_BASE}/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const bed = await response.json();
      return normalizeBed(bed);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },
};
