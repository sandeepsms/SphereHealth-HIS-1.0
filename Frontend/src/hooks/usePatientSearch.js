import { useState, useEffect, useCallback, useRef } from "react";
import patientService from "../Services/patient/patientService";

const usePatientSearch = (debounceMs = 400, minChars = 2, limit = 10) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const clearSearch = useCallback(() => {
    setSearchTerm("");
    setResults([]);
    setError(null);
  }, []);

  useEffect(() => {
    // Agar search term chota hai to clear karo
    if (!searchTerm || searchTerm.trim().length < minChars) {
      setResults([]);
      setError(null);
      return;
    }

    // Previous request cancel karo
    if (abortRef.current) {
      clearTimeout(abortRef.current);
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await patientService.searchPatients(
          searchTerm.trim(),
          limit,
        );

        if (response.success) {
          console.log(response.data,"datatattatatatatattaaaaaa");
          setResults(response.data || []);


        } else {
          setResults([]);
          setError(response.message || "Search failed");
        }
      } catch (err) {
        console.error("Search error:", err);
        setError("Search failed. Please try again.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    abortRef.current = timer;

    return () => clearTimeout(timer);
  }, [searchTerm, debounceMs, minChars, limit]);

  return {
    searchTerm,
    setSearchTerm,
    results,
    loading,
    error,
    clearSearch,
  };
};

export default usePatientSearch;
