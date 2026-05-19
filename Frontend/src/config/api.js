// Single source of truth for the backend base URL. Set VITE_API_BASE_URL in
// .env / .env.production to point at the real host; the fallback is the dev
// loopback so a fresh `npm run dev` works out of the box without env config.
// Audit finding H-05: warn loudly when running in PROD without the env var
// set so a misconfigured deploy doesn't silently try to hit a developer
// laptop's localhost.
const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
export const API_BASE_URL = RAW_API_BASE_URL || "http://localhost:5000/api";

if (import.meta.env.PROD && !RAW_API_BASE_URL) {
  // eslint-disable-next-line no-console
  console.error(
    "[api] VITE_API_BASE_URL is not set in a PRODUCTION build — falling back to localhost. " +
    "This will break every API call once deployed. Set it in .env.production.",
  );
}

export const API_ENDPOINTS = {
  BASE: API_BASE_URL,

  // ── Auth ──────────────────────────────────────────────────────
  AUTH_LOGIN:      `${API_BASE_URL}/auth/login`,
  AUTH_ME:         `${API_BASE_URL}/auth/me`,
  AUTH_LOGOUT:     `${API_BASE_URL}/auth/logout`,
  AUTH_SIGNATURE:  `${API_BASE_URL}/auth/signature`,
  USERS:      `${API_BASE_URL}/users`,

  // ── Doctors & Patients ────────────────────────────────────────
  DOCTORS: `${API_BASE_URL}/doctors`,
  PATIENTS: `${API_BASE_URL}/patients`,
  DEPARTMENTS: `${API_BASE_URL}/department`,

  // ── TPA & Old Billing ─────────────────────────────────────────
  TPA: `${API_BASE_URL}/tpa`,
  TPA_SERVICES: `${API_BASE_URL}/tpaservice`,
  // NOTE: Backend mounts this at lowercase `/servicebilldata` — keep both
  // sides aligned so the route works on case-sensitive Linux deployments.
  TPASERVICEBILL: `${API_BASE_URL}/servicebilldata/addbill`,
  HOSPITAL_CHARGES: `${API_BASE_URL}/hospital-charges`,
  HOSPITAL_SETTINGS: `${API_BASE_URL}/hospital-settings`,

  // ── Bed Management ────────────────────────────────────────────
  BEDS: `${API_BASE_URL}/bedss`,
  BUILDINGS: `${API_BASE_URL}/buildings`,
  FLOORS: `${API_BASE_URL}/floors`,
  WARDS: `${API_BASE_URL}/wards`,
  ROOMS: `${API_BASE_URL}/rooms`,
  ROOM_CATEGORIES: `${API_BASE_URL}/room-categories`,

  // ── OPD / Emergency / Admissions ─────────────────────────────
  ADMISSIONS: `${API_BASE_URL}/admissions`,
  OPD: `${API_BASE_URL}/opd`,
  EMERGENCY: `${API_BASE_URL}/emergency`,

  // ── Doctor & Prescriptions ────────────────────────────────────
  DOCTORPRECEPTION: `${API_BASE_URL}/patients/uhid`,
  PRESCRIPTIONS: `${API_BASE_URL}/prescriptions`,

  // ── Medico-Legal Cases (MLC) ──────────────────────────────────
  MLC: `${API_BASE_URL}/mlc`,

  // ── Search ────────────────────────────────────────────────────
  RegistrationSearch: `${API_BASE_URL}/registartion-search`,

  // ── New Billing System (billing-v3) ───────────────────────────
  SERVICES: `${API_BASE_URL}/services`,
  BILLING: `${API_BASE_URL}/billing`,
  // Bills, payments, TPA claims
  INVESTIGATIONS: `${API_BASE_URL}/investigations`, // Investigation master
  // AI Billing Intelligence endpoints (BILLING_AI_SUGGEST /
  // BILLING_AI_CONFIRM) were removed along with BillingIntelligencePage.
  // The receptionist now handles billing entirely through the Billing
  // Counter page; AI-suggested charges are no longer auto-applied.
  BILLING_NURSE_SERVICES: `${API_BASE_URL}/billing/nurse-services`,
  // ── Billing Audit Trail ───────────────────────────────────────
  BILLING_AUDIT_TRAIL:    `${API_BASE_URL}/billing/audit-trail`,
  BILLING_AUDIT_SUMMARY:  `${API_BASE_URL}/billing/audit-summary`,
  BILLING_CONFIRM_TRIGGER:`${API_BASE_URL}/billing/audit`,

  // ── NABH Clinical Modules ─────────────────────────────────────
  DOCTOR_NOTES: `${API_BASE_URL}/doctor-notes`,
  DISCHARGE_SUMMARY: `${API_BASE_URL}/discharge-summary`,
  CONSENT_FORMS: `${API_BASE_URL}/consent-forms`,
  NURSING_CARE_PLANS: `${API_BASE_URL}/nursing-care-plans`,
  MAR: `${API_BASE_URL}/mar`,
  NURSE_NOTES: `${API_BASE_URL}/nurse-notes`,
  NURSING_NOTES: `${API_BASE_URL}/nursing-notes`,
  NURSING_CHARGES: `${API_BASE_URL}/nursing-charges`,

  // ── Doctor Orders ─────────────────────────────────────────────
  DOCTOR_ORDERS: `${API_BASE_URL}/doctor-orders`,

  // ── Bed Transfer Workflow ──────────────────────────────────────
  BED_TRANSFERS: `${API_BASE_URL}/bed-transfers`,

  // ── OPD Clinical Actions ──────────────────────────────────────
  OPD_ASSESSMENT: (visitNumber) => `${API_BASE_URL}/opd/${visitNumber}/assessment`,
  OPD_AUDIT_TRAIL: (visitNumber) => `${API_BASE_URL}/opd/${visitNumber}/audit-trail`,

  // ── SphereAI Assistant ────────────────────────────────────────
  AI_CHAT: `${API_BASE_URL}/ai/chat`,
  VITAL_SHEET: `${API_BASE_URL}/vitalsheet`,
};

export default API_ENDPOINTS;
