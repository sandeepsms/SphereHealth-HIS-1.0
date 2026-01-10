import { useState, useEffect } from "react";
import { roomService } from "../services/roomService";

export const useRooms = () => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const data = await roomService.getAllRooms();
      setRooms(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createRoom = async (roomData) => {
    setLoading(true);
    try {
      const newRoom = await roomService.createRoom(roomData);
      setRooms([...rooms, newRoom]);
      setError(null);
      return newRoom;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updateRoom = async (id, roomData) => {
    setLoading(true);
    try {
      const updated = await roomService.updateRoom(id, roomData);
      setRooms(rooms.map((r) => (r._id === id ? updated : r)));
      setError(null);
      return updated;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const deleteRoom = async (id) => {
    setLoading(true);
    try {
      await roomService.deleteRoom(id);
      setRooms(rooms.filter((r) => r._id !== id));
      setError(null);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  return {
    rooms,
    loading,
    error,
    fetchRooms,
    createRoom,
    updateRoom,
    deleteRoom,
  };
};
