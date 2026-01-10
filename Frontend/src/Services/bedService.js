const API_BASE = "http://localhost:5000/api";

// Helper function to extract ObjectId
const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

// Helper to normalize bed data
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
      const response = await fetch(`${API_BASE}/bedss`);
      const data = await response.json();
      console.log("Raw beds response:", data);
      const beds = Array.isArray(data) ? data : data.data || data.beds || [];
      console.log("Parsed beds:", beds);
      return beds.map(normalizeBed);
    } catch (error) {
      console.error("Error fetching beds:", error);
      return [];
    }
  },

  getAvailableBeds: async () => {
    try {
      const response = await fetch(`${API_BASE}/bedss/available`);
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
      const response = await fetch(`${API_BASE}/bedss/${id}`);
      const bed = await response.json();
      return normalizeBed(bed);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  createBed: async (formData) => {
    try {
      console.log("=== CREATE BED START ===");
      console.log("Form data received:", formData);

      // Transform data to match backend API format
      const payload = {
        roomId: formData.room,
        beds: [
          {
            bedNumber: formData.bedNumber,
            status: formData.status || "Available",
            pricing: formData.pricing || {
              perBedDailyRate: 0,
              nursingCharges: 0,
              equipmentCharges: 0,
              securityDeposit: 0,
              currency: "INR",
            },
            notes: formData.notes || "",
          },
        ],
      };

      console.log(
        "Transformed payload for API:",
        JSON.stringify(payload, null, 2)
      );

      const response = await fetch(`${API_BASE}/bedss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("Response status:", response.status);
      console.log("Response ok:", response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API Error Response:", errorText);
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorText}`
        );
      }

      const result = await response.json();
      console.log("Full API response:", JSON.stringify(result, null, 2));

      // Handle different response formats
      if (result.success === true) {
        console.log("Success response detected");

        if (
          result.createdBeds &&
          Array.isArray(result.createdBeds) &&
          result.createdBeds.length > 0
        ) {
          console.log("Found createdBeds array with beds");
          return normalizeBed(result.createdBeds[0]);
        } else if (result.data) {
          console.log("Found data object");
          return normalizeBed(result.data);
        } else {
          console.log("Success but no beds data found");
          console.log("Result keys:", Object.keys(result));
        }
      }

      // Try other response formats
      if (result.data) {
        console.log("Found data in result");
        return normalizeBed(result.data);
      } else if (Array.isArray(result) && result.length > 0) {
        console.log("Result is array");
        return normalizeBed(result[0]);
      } else if (result._id) {
        console.log("Result has _id, treating as bed object");
        return normalizeBed(result);
      }

      // If we got here, something unexpected happened
      console.error("=== UNEXPECTED RESPONSE FORMAT ===");
      console.error("Result:", result);
      console.error("Result type:", typeof result);
      console.error("Result keys:", Object.keys(result));
      throw new Error(
        result.message ||
          result.error ||
          "Failed to create bed - unexpected response format"
      );
    } catch (error) {
      console.error("=== CREATE BED ERROR ===");
      console.error("Error object:", error);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      throw error;
    }
  },

  updateBed: async (id, data) => {
    try {
      const response = await fetch(`${API_BASE}/bedss/${id}`, {
        method: "PUT",
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

  deleteBed: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/bedss/${id}`, {
        method: "DELETE",
      });
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  bookBed: async (id, data) => {
    try {
      const response = await fetch(`${API_BASE}/bedss/${id}/book`, {
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
      const response = await fetch(`${API_BASE}/bedss/${id}/discharge`, {
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
      const response = await fetch(`${API_BASE}/bedss/${id}/status`, {
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

  getBedPricing: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/bedss/${id}/pricing`);
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  estimateCharges: async (id, days) => {
    try {
      const response = await fetch(
        `${API_BASE}/bedss/${id}/estimate?days=${days}`
      );
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },
};
