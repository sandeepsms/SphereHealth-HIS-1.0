import { API_ENDPOINTS } from "../../config/api";

const API_BASE = API_ENDPOINTS.BILLING;

// ── Helper: normalize bill object ─────────────────────────────
const extractId = (obj) => {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  if (obj.$oid) return obj.$oid;
  if (obj._id) return extractId(obj._id);
  return obj;
};

const normalizeBill = (bill) => {
  if (!bill) return bill;
  return {
    ...bill,
    _id: extractId(bill._id),
    patient: extractId(bill.patient),
    admission: extractId(bill.admission),
    tpa: extractId(bill.tpa),
  };
};

export const billingService = {
  // ── GET /api/billing/summary ──────────────────────────────────
  // Dashboard stats: today's bills, pending, revenue, TPA pending
  getSummary: async () => {
    try {
      const response = await fetch(`${API_BASE}/summary`);
      const data = await response.json();
      return data.data || {};
    } catch (error) {
      console.error("Error fetching billing summary:", error);
      return {};
    }
  },

  // ── GET /api/billing  — paginated bills list ──────────────────
  // Used by Accountant / Admin "Bills List" page.
  // filters: { status, visitType, paymentType, UHID, billNumber, startDate, endDate }
  getAllBills: async (filters = {}, page = 1, limit = 50) => {
    try {
      const params = new URLSearchParams({ page, limit });
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") params.set(k, v);
      });
      const response = await fetch(`${API_BASE}?${params}`);
      const data = await response.json();
      return {
        bills: (data.data || []).map(normalizeBill),
        pagination: data.pagination || { total: 0, page, limit, pages: 0 },
      };
    } catch (error) {
      console.error("Error fetching bills list:", error);
      return { bills: [], pagination: { total: 0, page, limit, pages: 0 } };
    }
  },

  // ── GET /api/billing/summary?startDate=...&endDate=... ────────
  // Alias used by BillsList for the top "stat cards" row.
  getBillStats: async ({ startDate, endDate } = {}) => {
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate)   params.set("endDate", endDate);
      const response = await fetch(`${API_BASE}/summary?${params}`);
      const data = await response.json();
      return data.data || data.summary || {};
    } catch (error) {
      console.error("Error fetching bill stats:", error);
      return {};
    }
  },

  // ── GET /api/billing/uhid/:UHID ───────────────────────────────
  // Patient info + all their bills
  getPatientBills: async (UHID) => {
    try {
      const response = await fetch(`${API_BASE}/uhid/${UHID}`);
      const data = await response.json();
      return {
        patient: data.data?.patient || null,
        bills: (data.data?.bills || []).map(normalizeBill),
      };
    } catch (error) {
      console.error("Error fetching patient bills:", error);
      return { patient: null, bills: [] };
    }
  },

  // ── GET /api/billing/:billId ──────────────────────────────────
  getBillById: async (billId) => {
    try {
      const response = await fetch(`${API_BASE}/${billId}`);
      const data = await response.json();
      return normalizeBill(data.data);
    } catch (error) {
      console.error("Error fetching bill:", error);
      return null;
    }
  },

  // ── POST /api/billing/create ──────────────────────────────────
  // Get existing DRAFT or create new bill
  // { UHID, visitType: "OPD"|"IPD"|"DAYCARE"|"EMERGENCY", admissionId? }
  getOrCreateBill: async ({ UHID, visitType, admissionId = null }) => {
    try {
      const response = await fetch(`${API_BASE}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ UHID, visitType, admissionId }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to create bill");
      }

      const data = await response.json();
      return normalizeBill(data.data);
    } catch (error) {
      console.error("Error creating bill:", error);
      throw error;
    }
  },

  // ── POST /api/billing/:billId/add-service ─────────────────────
  // { serviceId, quantity?, chargeDate?, remarks? }
  addServiceToBill: async (
    billId,
    { serviceId, quantity = 1, chargeDate, remarks },
  ) => {
    try {
      const response = await fetch(`${API_BASE}/${billId}/add-service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, quantity, chargeDate, remarks }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to add service");
      }

      const data = await response.json();
      return normalizeBill(data.data);
    } catch (error) {
      console.error("Error adding service to bill:", error);
      throw error;
    }
  },

  // ── DELETE /api/billing/:billId/items/:itemId ─────────────────
  removeItemFromBill: async (billId, itemId) => {
    try {
      const response = await fetch(`${API_BASE}/${billId}/items/${itemId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to remove item");
      }

      const data = await response.json();
      return normalizeBill(data.data);
    } catch (error) {
      console.error("Error removing bill item:", error);
      throw error;
    }
  },

  // ── PUT /api/billing/:billId/items/:itemId ────────────────────
  updateItemQuantity: async (billId, itemId, quantity) => {
    try {
      const response = await fetch(`${API_BASE}/${billId}/items/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to update quantity");
      }

      const data = await response.json();
      return normalizeBill(data.data);
    } catch (error) {
      console.error("Error updating item quantity:", error);
      throw error;
    }
  },

  // ── POST /api/billing/:billId/generate ───────────────────────
  // DRAFT → GENERATED
  generateBill: async (billId, generatedBy = "Staff") => {
    try {
      const response = await fetch(`${API_BASE}/${billId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generatedBy }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to generate bill");
      }

      const data = await response.json();
      return normalizeBill(data.data);
    } catch (error) {
      console.error("Error generating bill:", error);
      throw error;
    }
  },

  // ── POST /api/billing/:billId/payment ─────────────────────────
  // { amount, paymentMode: "CASH"|"CARD"|"UPI"|"CHEQUE"|"ONLINE"|"TPA_CLAIM",
  //   transactionId?, receivedBy?, remarks? }
  recordPayment: async (billId, paymentData) => {
    try {
      const response = await fetch(`${API_BASE}/${billId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentData),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to record payment");
      }

      const data = await response.json();
      return normalizeBill(data.data);
    } catch (error) {
      console.error("Error recording payment:", error);
      throw error;
    }
  },

  // ── POST /api/billing/:billId/tpa-claim ──────────────────────
  // { status, claimNumber?, approvedAmount? }
  updateTPAClaimStatus: async (billId, claimData) => {
    try {
      const response = await fetch(`${API_BASE}/${billId}/tpa-claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claimData),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to update TPA claim");
      }

      const data = await response.json();
      return normalizeBill(data.data);
    } catch (error) {
      console.error("Error updating TPA claim:", error);
      throw error;
    }
  },

  // ── GET /api/billing/price/:serviceId ─────────────────────────
  // Check effective price for a service (tariffType + optional tpaId)
  getServicePrice: async (serviceId, tariffType = "CASH", tpaId = null) => {
    try {
      const params = new URLSearchParams({ tariffType });
      if (tpaId) params.append("tpaId", tpaId);

      const response = await fetch(`${API_BASE}/price/${serviceId}?${params}`);
      const data = await response.json();
      return data.data || null; // { service, pricing, effectivePrice }
    } catch (error) {
      console.error("Error fetching service price:", error);
      return null;
    }
  },

  // ── GET /api/billing/daycare-check/:admissionId ───────────────
  // Check if daycare patient exceeded time limit
  checkDaycareConversion: async (admissionId) => {
    try {
      const response = await fetch(`${API_BASE}/daycare-check/${admissionId}`);
      const data = await response.json();
      return data.data || null; // { converted, hours, remaining? }
    } catch (error) {
      console.error("Error checking daycare:", error);
      return null;
    }
  },
};
