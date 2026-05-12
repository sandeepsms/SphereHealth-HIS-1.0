// frontend/hooks/useBilling.js
import { useState, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../config/api";

// API_ENDPOINTS.BASE already includes the `/api` segment so callers can
// just append the resource path. Previous code used VITE_API_URL which
// the rest of the app doesn't set — production builds were pointing at
// localhost.
const BASE = API_ENDPOINTS.BASE;

// ═══════════════════════════════════════════════════════════════
// useBilling Hook
// All billing + admission + service API calls in one place
// Used by PatientBilling.jsx and ServiceMasterManager.jsx
// ═══════════════════════════════════════════════════════════════

export function useBilling() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const call = useCallback(async (fn) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      const msg = e.response?.data?.message || e.message;
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Billing ─────────────────────────────────────────────
  const getPatientBills = (UHID) =>
    call(() =>
      axios.get(`${BASE}/billing/uhid/${UHID}`).then((r) => r.data.data),
    );

  const createBill = (data) =>
    call(() =>
      axios.post(`${BASE}/billing/create`, data).then((r) => r.data.data),
    );

  const addService = (billId, data) =>
    call(() =>
      axios
        .post(`${BASE}/billing/${billId}/add-service`, data)
        .then((r) => r.data.data),
    );

  const removeItem = (billId, itemId) =>
    call(() =>
      axios
        .delete(`${BASE}/billing/${billId}/items/${itemId}`)
        .then((r) => r.data.data),
    );

  const updateItemQty = (billId, itemId, quantity) =>
    call(() =>
      axios
        .put(`${BASE}/billing/${billId}/items/${itemId}`, { quantity })
        .then((r) => r.data.data),
    );

  const generateBill = (billId, generatedBy = "Staff") =>
    call(() =>
      axios
        .post(`${BASE}/billing/${billId}/generate`, { generatedBy })
        .then((r) => r.data.data),
    );

  const recordPayment = (billId, data) =>
    call(() =>
      axios
        .post(`${BASE}/billing/${billId}/payment`, data)
        .then((r) => r.data.data),
    );

  const getServicePrice = (serviceId, tariffType, tpaId) =>
    call(() =>
      axios
        .get(`${BASE}/billing/price/${serviceId}`, {
          params: { tariffType, tpaId },
        })
        .then((r) => r.data.data),
    );

  const checkDaycare = (admissionId) =>
    call(() =>
      axios
        .get(`${BASE}/billing/daycare-check/${admissionId}`)
        .then((r) => r.data.data),
    );

  const getBillingSummary = () =>
    call(() => axios.get(`${BASE}/billing/summary`).then((r) => r.data.data));

  // ── Services ───────────────────────────────────────────────
  const getServicesGrouped = (params = {}) =>
    call(() =>
      axios
        .get(`${BASE}/services/grouped`, { params })
        .then((r) => r.data.data),
    );

  const getAllServices = (params = {}) =>
    call(() => axios.get(`${BASE}/services`, { params }).then((r) => r.data));

  const createService = (data) =>
    call(() => axios.post(`${BASE}/services`, data).then((r) => r.data.data));

  const updateService = (id, data) =>
    call(() =>
      axios.put(`${BASE}/services/${id}`, data).then((r) => r.data.data),
    );

  const deleteService = (id) =>
    call(() => axios.delete(`${BASE}/services/${id}`).then((r) => r.data));

  const getServicePricing = (serviceId) =>
    call(() =>
      axios
        .get(`${BASE}/services/${serviceId}/pricing`)
        .then((r) => r.data.data),
    );

  const setServicePricing = (serviceId, data) =>
    call(() =>
      axios
        .post(`${BASE}/services/${serviceId}/pricing`, data)
        .then((r) => r.data.data),
    );

  const seedServices = () =>
    call(() => axios.post(`${BASE}/services/seed`).then((r) => r.data.data));

  // ── Admissions ─────────────────────────────────────────────
  const createAdmission = (data) =>
    call(() => axios.post(`${BASE}/admissions`, data).then((r) => r.data.data));

  const getAdmissions = (UHID) =>
    call(() =>
      axios.get(`${BASE}/admissions/uhid/${UHID}`).then((r) => r.data.data),
    );

  const getAllAdmissions = (params = {}) =>
    call(() => axios.get(`${BASE}/admissions`, { params }).then((r) => r.data));

  const dischargePatient = (id, data) =>
    call(() =>
      axios
        .put(`${BASE}/admissions/${id}/discharge`, data)
        .then((r) => r.data.data),
    );

  const updateAdmission = (id, data) =>
    call(() =>
      axios.put(`${BASE}/admissions/${id}`, data).then((r) => r.data.data),
    );

  return {
    loading,
    error,
    // Billing
    getPatientBills,
    createBill,
    addService,
    removeItem,
    updateItemQty,
    generateBill,
    recordPayment,
    getServicePrice,
    checkDaycare,
    getBillingSummary,
    // Services
    getServicesGrouped,
    getAllServices,
    createService,
    updateService,
    deleteService,
    getServicePricing,
    setServicePricing,
    seedServices,
    // Admissions
    createAdmission,
    getAdmissions,
    getAllAdmissions,
    dischargePatient,
    updateAdmission,
  };
}
