import API_ENDPOINTS from "../config/api";

const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeRoom = (room) => {
  if (!room) return room;
  return {
    ...room,
    _id: extractId(room._id),
    building: extractId(room.building),
    floor: extractId(room.floor),
    ward: extractId(room.ward),
    roomCategory: extractId(room.roomCategory),
  };
};

export const roomService = {
  getAllRooms: async () => {
    try {
      const response = await fetch(API_ENDPOINTS.ROOMS);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch rooms");
      }
      const data = await response.json();
      const rooms = Array.isArray(data) ? data : data.data || data.rooms || [];
      return rooms.map(normalizeRoom);
    } catch (error) {
      console.error("Error fetching rooms:", error);
      throw error;
    }
  },

  getRoomById: async (id) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.ROOMS}/${id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch room");
      }
      const room = await response.json();
      return normalizeRoom(room);
    } catch (error) {
      console.error("Error fetching room:", error);
      throw error;
    }
  },

  createRoom: async (data) => {
    try {
      // Strip any pricing/services fields (managed via TPA)
      const { pricing, services, ...cleanData } = data;

      const response = await fetch(API_ENDPOINTS.ROOMS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || result.error || "Failed to create room",
        );
      }

      return normalizeRoom(result);
    } catch (error) {
      console.error("Error creating room:", error);
      throw error;
    }
  },

  updateRoom: async (id, data) => {
    try {
      // Strip any pricing/services fields (managed via TPA)
      const { pricing, services, ...cleanData } = data;

      const response = await fetch(`${API_ENDPOINTS.ROOMS}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to update room");
      }

      return normalizeRoom(result);
    } catch (error) {
      console.error("Error updating room:", error);
      throw error;
    }
  },

  deleteRoom: async (id) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.ROOMS}/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete room");
      }

      return await response.json();
    } catch (error) {
      console.error("Error deleting room:", error);
      throw error;
    }
  },

  getRoomsWithLowAvailability: async () => {
    try {
      const response = await fetch(`${API_ENDPOINTS.ROOMS}/availability/low`);
      const data = await response.json();
      const rooms = Array.isArray(data) ? data : [];
      return rooms.map(normalizeRoom);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getFullyOccupiedRooms: async () => {
    try {
      const response = await fetch(`${API_ENDPOINTS.ROOMS}/availability/full`);
      const data = await response.json();
      const rooms = Array.isArray(data) ? data : [];
      return rooms.map(normalizeRoom);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getRoomsByCategory: async (categoryId) => {
    try {
      const response = await fetch(
        `${API_ENDPOINTS.ROOMS}/category/${categoryId}`,
      );
      const data = await response.json();
      const rooms = Array.isArray(data) ? data : [];
      return rooms.map(normalizeRoom);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getAvailableRoomsByCategory: async (categoryId) => {
    try {
      const response = await fetch(
        `${API_ENDPOINTS.ROOMS}/category/${categoryId}/available`,
      );
      const data = await response.json();
      const rooms = Array.isArray(data) ? data : [];
      return rooms.map(normalizeRoom);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getRoomStatsByCategory: async (categoryId) => {
    try {
      const response = await fetch(
        `${API_ENDPOINTS.ROOMS}/category/${categoryId}/stats`,
      );
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  // ❌ REMOVED: updateRoomServices() - services/pricing moved to TPA
  // ❌ REMOVED: updateBedOccupancy() - this is internal, handled by bedService

  updateBedOccupancy: async (id, occupancy) => {
    try {
      const response = await fetch(`${API_ENDPOINTS.ROOMS}/${id}/occupancy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(occupancy),
      });
      const room = await response.json();
      return normalizeRoom(room);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },
};
