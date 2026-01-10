import { useState, useEffect } from "react";
import { bedService } from "../services/bedService";

export const useBeds = () => {
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBeds = async () => {
    setLoading(true);
    try {
      const data = await bedService.getAllBeds();
      setBeds(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableBeds = async () => {
    setLoading(true);
    try {
      const data = await bedService.getAvailableBeds();
      setBeds(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createBed = async (bedData) => {
    setLoading(true);
    try {
      const newBed = await bedService.createBed(bedData);
      setBeds([...beds, newBed]);
      setError(null);
      return newBed;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updateBed = async (id, bedData) => {
    setLoading(true);
    try {
      const updated = await bedService.updateBed(id, bedData);
      setBeds(beds.map((b) => (b._id === id ? updated : b)));
      setError(null);
      return updated;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const deleteBed = async (id) => {
    setLoading(true);
    try {
      await bedService.deleteBed(id);
      setBeds(beds.filter((b) => b._id !== id));
      setError(null);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const bookBed = async (id, bookingData) => {
    setLoading(true);
    try {
      const booked = await bedService.bookBed(id, bookingData);
      setBeds(beds.map((b) => (b._id === id ? booked : b)));
      setError(null);
      return booked;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const dischargeBed = async (id) => {
    setLoading(true);
    try {
      const discharged = await bedService.dischargeBed(id);
      setBeds(beds.map((b) => (b._id === id ? discharged : b)));
      setError(null);
      return discharged;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBeds();
  }, []);

  return {
    beds,
    loading,
    error,
    fetchBeds,
    fetchAvailableBeds,
    createBed,
    updateBed,
    deleteBed,
    bookBed,
    dischargeBed,
  };
};
