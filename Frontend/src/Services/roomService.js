const API_BASE = "http://localhost:5000/api";

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
      const response = await fetch(`${API_BASE}/rooms`);
      const data = await response.json();
      const rooms = Array.isArray(data) ? data : data.data || data.rooms || [];
      return rooms.map(normalizeRoom);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getRoomById: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/rooms/${id}`);
      const room = await response.json();
      return normalizeRoom(room);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  getRoomDetails: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/rooms/details/${id}`);
      const room = await response.json();
      return normalizeRoom(room);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  createRoom: async (data) => {
    try {
      const response = await fetch(`${API_BASE}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const room = await response.json();
      return normalizeRoom(room);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  updateRoom: async (id, data) => {
    try {
      const response = await fetch(`${API_BASE}/rooms/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const room = await response.json();
      return normalizeRoom(room);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  deleteRoom: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/rooms/${id}`, {
        method: "DELETE",
      });
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  getRoomsWithLowAvailability: async () => {
    try {
      const response = await fetch(`${API_BASE}/rooms/availability/low`);
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
      const response = await fetch(`${API_BASE}/rooms/availability/full`);
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
      const response = await fetch(`${API_BASE}/rooms/category/${categoryId}`);
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
        `${API_BASE}/rooms/category/${categoryId}/available`
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
        `${API_BASE}/rooms/category/${categoryId}/stats`
      );
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  updateRoomServices: async (id, services) => {
    try {
      const response = await fetch(`${API_BASE}/rooms/${id}/services`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services }),
      });
      const room = await response.json();
      return normalizeRoom(room);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  updateBedOccupancy: async (id, occupancy) => {
    try {
      const response = await fetch(`${API_BASE}/rooms/${id}/occupancy`, {
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
