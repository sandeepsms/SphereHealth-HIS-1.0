/**
 * pharmacyService.js — wrapper for /api/pharmacy/*.
 */
import authFetch from "../utils/authFetch";
import { API_ENDPOINTS } from "../config/api";

const BASE = `${API_ENDPOINTS.BASE}/pharmacy`;

const _j = async (r) => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    // R7hr-23: surface structured error payload (code, drugName, schedule,
    // missing[], saleType, …) on the thrown Error so callers can branch
    // on `.code` instead of regex-matching `.message`. Preserves the legacy
    // human-readable .message so existing toast.error(e.message) keeps
    // working for callers that haven't migrated to the structured path.
    const err = new Error(d?.message || `HTTP ${r.status}`);
    err.code     = d?.code   || null;
    err.status   = r.status;
    err.data     = d         || null;
    err.drugName = d?.drugName || null;
    err.schedule = d?.schedule || null;
    err.missing  = Array.isArray(d?.missing) ? d.missing : [];
    err.saleType = d?.saleType || null;
    throw err;
  }
  return d;
};
const _qs = (p) => { const s = new URLSearchParams(p).toString(); return s ? "?" + s : ""; };
const _post = async (path, body) => _j(await authFetch(`${BASE}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
}));
const _put  = async (path, body) => _j(await authFetch(`${BASE}${path}`, {
  method: "PUT",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
}));
// R7bh-F9 / R7bg-4-HIGH-1 — accept an optional { signal } so search-as-
// you-type callers can attach an AbortController and cancel in-flight
// requests when the user keeps typing. Without this, fast typists
// generate a fan-out of overlapping fetches whose responses can race
// (last completed wins, not last issued) and stomp on fresh results.
const _get  = async (path, opts = {}) => _j(await authFetch(`${BASE}${path}`, opts));
const _del  = async (path) => _j(await authFetch(`${BASE}${path}`, { method: "DELETE" }));

// Drugs
export const listDrugs    = (params = {}, opts) => _get(`/drugs${_qs(params)}`, opts);
export const searchDrugs  = (q, opts)            => _get(`/drugs/search?q=${encodeURIComponent(q)}`, opts);
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

// R7hr-16: parse supplier invoice (PDF/JSON) → pre-fills GRN form. Multipart
// upload — purposely do NOT set Content-Type (browser sets the multipart
// boundary; authFetch only injects Authorization, never overrides headers).
export const parseInvoice = async (file) => {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const r = await authFetch(`${BASE}/grn/parse-invoice`, { method: "POST", body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`);
  return d;
};

// Sales
export const dispense      = (b)               => _post(`/sales`, b);
export const listSales     = (params = {}, opts) => _get(`/sales${_qs(params)}`, opts);
export const getSale       = (id)              => _get(`/sales/${id}`);
// R7hr-28: lookup previously-registered Walk-in / Homecare patients by
// mobile-number prefix. Returns up to 8 matches, latest-seen first.
export const lookupWalkInPatients = (q, opts)  => _get(`/walk-in-patients?q=${encodeURIComponent(q)}`, opts);
export const cancelSale    = (id)              => _post(`/sales/${id}/cancel`);
export const returnSaleItems = (id, body)       => _post(`/sales/${id}/return`, body);
export const addItemsToSale  = (id, body)       => _post(`/sales/${id}/add-items`, body);

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
  recordGRN, listBatches, stockRollup, parseInvoice,  // R7hr-16
  dispense, listSales, getSale, cancelSale, returnSaleItems, addItemsToSale,
  getStats, getAlerts,
  getPharmacySettings, updatePharmacySettings,
  getSalesRegister, getPurchaseRegister, getStockRegister,
  getScheduleHRegister, getExpiryRegister, getGstSummary,
  DRUG_FORMS, DRUG_CATEGORIES, PAYMENT_MODES, SALE_TYPES,
};
