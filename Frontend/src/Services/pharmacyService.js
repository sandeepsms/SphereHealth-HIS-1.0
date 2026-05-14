/**
 * pharmacyService.js — wrapper for /api/pharmacy/*.
 */
import authFetch from "../utils/authFetch";
import { API_ENDPOINTS } from "../config/api";

const BASE = `${API_ENDPOINTS.BASE}/pharmacy`;

const _j = async (r) => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`);
  return d;
};
const _qs = (p) => { const s = new URLSearchParams(p).toString(); return s ? "?" + s : ""; };
const _post = async (path, body) => _j(await authFetch(`${BASE}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
}));
const _put  = async (path, body) => _j(await authFetch(`${BASE}${path}`, {
  method: "PUT",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
}));
const _get  = async (path) => _j(await authFetch(`${BASE}${path}`));
const _del  = async (path) => _j(await authFetch(`${BASE}${path}`, { method: "DELETE" }));

// Drugs
export const listDrugs    = (params = {}) => _get(`/drugs${_qs(params)}`);
export const searchDrugs  = (q)            => _get(`/drugs/search?q=${encodeURIComponent(q)}`);
export const createDrug   = (body)         => _post(`/drugs`, body);
export const updateDrug   = (id, body)     => _put(`/drugs/${id}`, body);
export const deleteDrug   = (id)           => _del(`/drugs/${id}`);

// Suppliers
export const listSuppliers   = ()           => _get(`/suppliers`);
export const createSupplier  = (b)          => _post(`/suppliers`, b);
export const updateSupplier  = (id, b)      => _put (`/suppliers/${id}`, b);
export const deleteSupplier  = (id)         => _del (`/suppliers/${id}`);

// GRN + batches + stock
export const recordGRN     = (b)               => _post(`/grn`, b);
export const listBatches   = (params = {})     => _get(`/batches${_qs(params)}`);
export const stockRollup   = ()                => _get(`/stock`);

// Sales
export const dispense      = (b)               => _post(`/sales`, b);
export const listSales     = (params = {})     => _get(`/sales${_qs(params)}`);
export const getSale       = (id)              => _get(`/sales/${id}`);
export const cancelSale    = (id)              => _post(`/sales/${id}/cancel`);

// Dashboard
export const getStats      = () => _get(`/stats`);
export const getAlerts     = () => _get(`/alerts`);

// Settings (pharmacy identity for print — in-house vs outsourced)
export const getPharmacySettings    = ()   => _get(`/settings`);
export const updatePharmacySettings = (b)  => _put(`/settings`, b);

// Registers
export const getSalesRegister    = (p = {}) => _get(`/registers/sales${_qs(p)}`);
export const getPurchaseRegister = (p = {}) => _get(`/registers/purchase${_qs(p)}`);
export const getStockRegister    = (p = {}) => _get(`/registers/stock${_qs(p)}`);
export const getScheduleHRegister= (p = {}) => _get(`/registers/schedule-h${_qs(p)}`);
export const getExpiryRegister   = (p = {}) => _get(`/registers/expiry${_qs(p)}`);
export const getGstSummary       = (p = {}) => _get(`/registers/gst${_qs(p)}`);

export const DRUG_FORMS = ["Tablet","Capsule","Syrup","Injection","Drops","Cream","Ointment","Inhaler","Patch","Powder","Suppository","Other"];
export const DRUG_CATEGORIES = ["Antibiotic","Analgesic","Antipyretic","Antihypertensive","Antidiabetic","Cardiac","Respiratory","Neuro","Gastro","Steroid","Vitamin","Insulin","IV Fluid","Topical","Other"];
export const PAYMENT_MODES = ["Cash","Card","UPI","Mixed","Credit"];
export const SALE_TYPES    = ["Walk-in","OPD","IPD","Homecare"];

export default {
  listDrugs, searchDrugs, createDrug, updateDrug, deleteDrug,
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
  recordGRN, listBatches, stockRollup,
  dispense, listSales, getSale, cancelSale,
  getStats, getAlerts,
  DRUG_FORMS, DRUG_CATEGORIES, PAYMENT_MODES, SALE_TYPES,
};
