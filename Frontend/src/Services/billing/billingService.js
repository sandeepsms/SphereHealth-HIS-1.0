import axios from "axios";
import { API_ENDPOINTS } from "../../config/api.js";

const API_URL = API_ENDPOINTS.BILLING;

export const billingService = {
  // Create bill from prescription
  createBillFromPrescription: async (prescriptionId) => {
    try {
      const response = await axios.post(`${API_URL}/from-prescription`, {
        prescriptionId,
      });
      return response.data;
    } catch (error) {
      console.error("Failed to create bill:", error);
      throw error;
    }
  },

  // Get bill by ID
  getBillById: async (billId) => {
    try {
      const response = await axios.get(`${API_URL}/${billId}`);
      return response.data?.data || response.data || null;
    } catch (error) {
      console.error("Failed to fetch bill:", error);
      throw error;
    }
  },

  // Get all bills with filters
  getAllBills: async (filters = {}, page = 1, limit = 10) => { 
    try {
      const cleanFilters = Object.entries(filters).reduce(
        (acc, [key, value]) => {
          if (value !== "" && value !== null && value !== undefined) {
            acc[key] = value;
          }
          return acc;
        },
        {},
      );

      const response = await axios.get(API_URL, {
        params: {
          ...cleanFilters,
          page,
          limit,
        },
      });

      return {
        bills: Array.isArray(response.data?.bills)
          ? response.data.bills
          : Array.isArray(response.data?.data)
            ? response.data.data
            : [],
        pagination: response.data?.pagination || {
          total: 0,
          page: 1,
          limit: 10,
          pages: 0,
        },
      };
    } catch (error) {
      console.error("Failed to fetch bills:", error);
      return {
        bills: [],
        pagination: { total: 0, page: 1, limit: 10, pages: 0 },
      };
    }
  },

  // Update bill
  updateBill: async (billId, data) => {
    try {
      const response = await axios.put(`${API_URL}/${billId}`, data);
      return response.data;
    } catch (error) {
      console.error("Failed to update bill:", error);
      throw error;
    }
  },

  // Generate final bill
  generateBill: async (billId) => {
    try {
      const response = await axios.post(`${API_URL}/${billId}/generate`);
      return response.data;
    } catch (error) {
      console.error("Failed to generate bill:", error);
      throw error;
    }
  },

  // Toggle investigation (in-house vs outside)
  toggleInvestigation: async (
    billId,
    investigationId,
    performInHouse,
    outsideDetails,
  ) => {
    try {
      const response = await axios.patch(
        `${API_URL}/${billId}/investigation/${investigationId}/toggle`,
        {
          performInHouse,
          outsideDetails: outsideDetails || {},
        },
      );
      return response.data;
    } catch (error) {
      console.error("Failed to toggle investigation:", error);
      throw error;
    }
  },

  // Add payment
  addPayment: async (billId, paymentData) => {
    try {
      const response = await axios.post(
        `${API_URL}/${billId}/payment`,
        paymentData,
      );
      return response.data;
    } catch (error) {
      console.error("Failed to add payment:", error);
      throw error;
    }
  },

  // Cancel bill
  cancelBill: async (billId, reason) => {
    try {
      const response = await axios.delete(`${API_URL}/${billId}/cancel`, {
        data: { reason },
      });
      return response.data;
    } catch (error) {
      console.error("Failed to cancel bill:", error);
      throw error;
    }
  },

  // Get outside investigations
  getOutsideInvestigations: async (billId) => {
    try {
      const response = await axios.get(
        `${API_URL}/${billId}/outside-investigations`,
      );
      return response.data;
    } catch (error) {
      console.error("Failed to fetch outside investigations:", error);
      throw error;
    }
  },

  // Get bill stats
  getBillStats: async (filters = {}) => {
    try {
      const cleanFilters = Object.entries(filters).reduce(
        (acc, [key, value]) => {
          if (value !== "" && value !== null && value !== undefined) {
            acc[key] = value;
          }
          return acc;
        },
        {},
      );

      const response = await axios.get(`${API_URL}/stats/summary`, {
        params: cleanFilters,
      });

      return (
        response.data?.data || {
          total: 0,
          paid: 0,
          partial: 0,
          draft: 0,
          cancelled: 0,
          totalRevenue: 0,
          totalCollected: 0,
          totalPending: 0,
        }
      );
    } catch (error) {
      console.error("Failed to fetch bill stats:", error);
      return {
        total: 0,
        paid: 0,
        partial: 0,
        draft: 0,
        cancelled: 0,
        totalRevenue: 0,
        totalCollected: 0,
        totalPending: 0,
      };
    }
  },

  // Recalculate bill
  recalculateBill: async (billId) => {
    try {
      const response = await axios.post(`${API_URL}/${billId}/recalculate`);
      return response.data;
    } catch (error) {
      console.error("Failed to recalculate bill:", error);
      throw error;
    }
  },

  // 🆕 NEW: Get available charges for a bill
  getAvailableCharges: async (billId) => {
    try {
      const response = await axios.get(
        `${API_URL}/${billId}/available-charges`,
      );
      return response.data;
    } catch (error) {
      console.error("Failed to fetch available charges:", error);
      throw error;
    }
  },

  // 🆕 NEW: Add charge to bill
  addChargeToBill: async (billId, chargeData) => {
    try {
      const response = await axios.post(
        `${API_URL}/${billId}/add-charge`,
        chargeData,
      );
      return response.data;
    } catch (error) {
      console.error("Failed to add charge:", error);
      throw error;
    }
  },

  // 🆕 NEW: Remove charge from bill
  removeChargeFromBill: async (billId, chargeIndex) => {
    try {
      const response = await axios.delete(
        `${API_URL}/${billId}/remove-charge/${chargeIndex}`,
      );
      return response.data;
    } catch (error) {
      console.error("Failed to remove charge:", error);
      throw error;
    }
  },
};
