const API_BASE = "http://localhost:5000/api";

const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeAdmission = (admission) => {
  if (!admission) return admission;
  return {
    ...admission,
    _id: extractId(admission._id),
    patient: extractId(admission.patient),
    bed: extractId(admission.bed),
    room: extractId(admission.room),
    ward: extractId(admission.ward),
    floor: extractId(admission.floor),
    building: extractId(admission.building),
  };
};

export const admissionService = {
  getAllAdmissions: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const response = await fetch(`${API_BASE}/admissions?${queryString}`);
      const data = await response.json();
      const admissions = Array.isArray(data)
        ? data
        : data.data || data.admissions || [];
      return admissions.map(normalizeAdmission);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getAdmissionById: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/admissions/${id}`);
      const admission = await response.json();
      return normalizeAdmission(admission);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  getAdmissionByNumber: async (admissionNumber) => {
    try {
      const response = await fetch(
        `${API_BASE}/admissions/number/${admissionNumber}`
      );
      const admission = await response.json();
      return normalizeAdmission(admission);
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  createAdmission: async (data) => {
    try {
      const response = await fetch(`${API_BASE}/admissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const admission = await response.json();
      return normalizeAdmission(admission);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  updateAdmission: async (id, data) => {
    try {
      const response = await fetch(`${API_BASE}/admissions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const admission = await response.json();
      return normalizeAdmission(admission);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  deleteAdmission: async (id) => {
    try {
      const response = await fetch(`${API_BASE}/admissions/${id}`, {
        method: "DELETE",
      });
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  searchAdmissions: async (query) => {
    try {
      const response = await fetch(`${API_BASE}/admissions/search?q=${query}`);
      const data = await response.json();
      const admissions = Array.isArray(data) ? data : [];
      return admissions.map(normalizeAdmission);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getActiveAdmissions: async (filters = {}) => {
    try {
      const queryString = new URLSearchParams(filters).toString();
      const response = await fetch(
        `${API_BASE}/admissions/active?${queryString}`
      );
      const data = await response.json();
      const admissions = Array.isArray(data) ? data : [];
      return admissions.map(normalizeAdmission);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getTodayAdmissions: async () => {
    try {
      const response = await fetch(`${API_BASE}/admissions/today`);
      const data = await response.json();
      const admissions = Array.isArray(data) ? data : [];
      return admissions.map(normalizeAdmission);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getTodayDischarges: async () => {
    try {
      const response = await fetch(`${API_BASE}/admissions/discharges/today`);
      const data = await response.json();
      const admissions = Array.isArray(data) ? data : [];
      return admissions.map(normalizeAdmission);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getExpectedDischarges: async (date) => {
    try {
      const response = await fetch(
        `${API_BASE}/admissions/discharges/expected?date=${date}`
      );
      const data = await response.json();
      const admissions = Array.isArray(data) ? data : [];
      return admissions.map(normalizeAdmission);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getAdmissionStatistics: async (startDate, endDate) => {
    try {
      let url = `${API_BASE}/admissions/statistics`;
      if (startDate && endDate) {
        url += `?startDate=${startDate}&endDate=${endDate}`;
      }
      const response = await fetch(url);
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      return null;
    }
  },

  getDepartmentWiseCount: async () => {
    try {
      const response = await fetch(`${API_BASE}/admissions/departments/count`);
      return await response.json();
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  getPatientAdmissionHistory: async (patientId) => {
    try {
      const response = await fetch(
        `${API_BASE}/admissions/patient/${patientId}/history`
      );
      const data = await response.json();
      const admissions = Array.isArray(data) ? data : [];
      return admissions.map(normalizeAdmission);
    } catch (error) {
      console.error("Error:", error);
      return [];
    }
  },

  transferBed: async (id, data) => {
    try {
      const response = await fetch(`${API_BASE}/admissions/${id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const admission = await response.json();
      return normalizeAdmission(admission);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  dischargePatient: async (id, data) => {
    try {
      const response = await fetch(`${API_BASE}/admissions/${id}/discharge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const admission = await response.json();
      return normalizeAdmission(admission);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },

  cancelAdmission: async (id, reason) => {
    try {
      const response = await fetch(`${API_BASE}/admissions/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const admission = await response.json();
      return normalizeAdmission(admission);
    } catch (error) {
      console.error("Error:", error);
      throw error;
    }
  },
};
