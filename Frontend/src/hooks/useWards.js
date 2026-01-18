import { useState, useEffect } from "react";
import { wardService } from "../Services/wardService";

export const useWards = () => {
  const [wards, setWards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchWards = async () => {
    setLoading(true);
    try {
      const data = await wardService.getAllWards();
      setWards(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createWard = async (wardData) => {
    setLoading(true);
    try {
      const newWard = await wardService.createWard(wardData);
      setWards([...wards, newWard]);
      setError(null);
      return newWard;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updateWard = async (id, wardData) => {
    setLoading(true);
    try {
      const updated = await wardService.updateWard(id, wardData);
      setWards(wards.map((w) => (w._id === id ? updated : w)));
      setError(null);
      return updated;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const deleteWard = async (id) => {
    setLoading(true);
    try {
      await wardService.deleteWard(id);
      setWards(wards.filter((w) => w._id !== id));
      setError(null);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWards();
  }, []);

  return {
    wards,
    loading,
    error,
    fetchWards,
    createWard,
    updateWard,
    deleteWard,
  };
};
