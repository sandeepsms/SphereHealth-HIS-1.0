/**
 * IPDBillingLedger.jsx — Live IPD / Day-Care billing ledger.
 *
 * Route: /billing/ipd/:admissionId
 * Backend: GET /api/billing/ipd/:admissionId/ledger
 *
 * The Ops view a receptionist/accountant/doctor opens to see the running
 * bill for an IPD or Day-Care admission. Built per the design memo
 * (project_billing_design.md) — every auto-fired charge appears here
 * with a 15-min Undo button for receptionists, an Override modal for
 * accountants, and a full audit timeline.
 *
 * Three tabs (the doctor said "1 & 2 both"):
 *   1. Category — Bed / Nursing / Doctor / Investigations / Drugs / etc.
 *   2. Daily   — Day-1, Day-2... breakdown
 *   3. Audit   — full chronological list with override history
 *
 * Action bar:
 *   - Take Advance Deposit  (Receptionist+)
 *   - Print Interim Bill    (Receptionist+)
 *   - Generate Final Bill   (Accountant)
 *   - Back to Bed View
 */
import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import API_ENDPOINTS from "../../config/api";
import { useAuth } from "../../context/AuthContext";
import { openPrint } from "../../Components/print/openPrint";
import ServiceAutocomplete from "../../Components/clinical/ServiceAutocomplete";
// R7ar-P1-14/D4-aq-02: centralised Decimal128 unwrap to avoid 7-page drift.
import { toMoney } from "../../utils/money";

/* Map a trigger to a friendly print-category label that lines up with
   the FinalBill printable's CATEGORY_ORDER (Room/Bed → Doctor → Nursing
   → Procedure → Investigations → Radiology → Pharmacy → Consumables →
   Equipment → Ambulance → Other).

   Resolution priority (each falls through to the next if no match):
     1. ServiceMaster.category (populated from backend if available)
     2. Trigger.sourceType    (BedCharge/DoctorNote/NurseNote/MAR/etc.)
     3. Any segment of the serviceCode matches a known prefix (so
        IPD-DOC-002 still lands in "Doctor" even though "IPD" alone
        doesn't, because "DOC" matches inside the code)
     4. Keyword search inside serviceName ("Doctor Visit", "Nursing
        Care", "Ward Round" etc.)
     5. "Other Charges" — final fallback so NO trigger is ever silently
        dropped from the bill. This is the "dynamic" guarantee: anything
        a user adds, the printout shows.
*/
const CODE_PREFIX = {
  // Bed / Room
  BED: "Room/Bed Charges",       ROOM: "Room/Bed Charges",      WARD: "Room/Bed Charges",
  // Doctor / Consultant
  DOC: "Doctor / Consultant Fees", DR: "Doctor / Consultant Fees",
  DOCTOR: "Doctor / Consultant Fees", CONSULT: "Doctor / Consultant Fees",
  CONS: "Doctor / Consultant Fees", CONSULTATION: "Doctor / Consultant Fees",
  PHYS: "Doctor / Consultant Fees", PHYSICIAN: "Doctor / Consultant Fees",
  VISIT: "Doctor / Consultant Fees", ROUND: "Doctor / Consultant Fees",
  // Nursing
  NRS: "Nursing Charges", NURSE: "Nursing Charges", NURSING: "Nursing Charges",
  // Lab / Investigation
  LAB: "Investigations / Lab", INV: "Investigations / Lab",
  INVEST: "Investigations / Lab", INVESTIGATION: "Investigations / Lab",
  TEST: "Investigations / Lab", CBC: "Investigations / Lab", ECG: "Investigations / Lab",
  // Radiology / Imaging
  RAD: "Radiology / Imaging", IMG: "Radiology / Imaging",
  IMAGE: "Radiology / Imaging", IMAGING: "Radiology / Imaging",
  XRAY: "Radiology / Imaging", USG: "Radiology / Imaging",
  CT: "Radiology / Imaging", MRI: "Radiology / Imaging",
  // Pharmacy / Medications
  PHARM: "Pharmacy / Medications", PHARMACY: "Pharmacy / Medications",
  MED: "Pharmacy / Medications", DRUG: "Pharmacy / Medications",
  MAR: "Pharmacy / Medications", RX: "Pharmacy / Medications",
  // Procedures / OT
  PRC: "Procedure / OT Charges", PROC: "Procedure / OT Charges",
  PROCEDURE: "Procedure / OT Charges", OT: "Procedure / OT Charges",
  SURG: "Procedure / OT Charges", SURGERY: "Procedure / OT Charges",
  // Consumables
  CON: "Consumables / Disposables", CONSUMABLE: "Consumables / Disposables",
  DISP: "Consumables / Disposables",
  // Equipment / Monitoring
  EQP: "Equipment / Monitoring", EQUIP: "Equipment / Monitoring",
  EQUIPMENT: "Equipment / Monitoring",
  // Ambulance
  AMB: "Ambulance", AMBULANCE: "Ambulance",
  // Misc
  NEB: "Nursing Charges",        // nebulization session
  PKG: "Other Charges", PACKAGE: "Other Charges",
  ER: "Other Charges", REG: "Other Charges", ADM: "Other Charges",
  IPD: null, OPD: null,           // pure prefixes — keep falling through
};

const SOURCE_TYPE_CATEGORY = {
  BedCharge:          "Room/Bed Charges",
  DoctorNote:         "Doctor / Consultant Fees",
  DoctorVisit:        "Doctor / Consultant Fees",
  DoctorAssessment:   "Doctor / Consultant Fees",
  NurseNote:          "Nursing Charges",
  Procedure:          "Procedure / OT Charges",
  InvestigationOrder: "Investigations / Lab",
  MAR:                "Pharmacy / Medications",
  Equipment:          "Equipment / Monitoring",
  Discharge:          "Other Charges",
  Admission:          "Other Charges",
  Emergency:          "Other Charges",
  CarePlan:           "Other Charges",
  Manual:             null,           // honest fallback — pick from name
  AutoCharge:         null,
};

// Keyword scan inside serviceName as a last attempt before "Other"
const NAME_KEYWORDS = [
  [/\b(ward|round|visit|doctor|physician|consult)\b/i, "Doctor / Consultant Fees"],
  [/\b(bed|room)\b/i,                                  "Room/Bed Charges"],
  [/\b(nurs|injection)\b/i,                            "Nursing Charges"],
  [/\b(lab|cbc|ecg|test|sample|blood|urine|culture)\b/i, "Investigations / Lab"],
  [/\b(x-?ray|ct|mri|usg|ultrasound|imaging|radio)\b/i,  "Radiology / Imaging"],
  [/\b(tab|cap|syrup|inj|drug|medic|pharm|capsule)\b/i,  "Pharmacy / Medications"],
  [/\b(procedure|operative|surgery|ot |suturing)\b/i,    "Procedure / OT Charges"],
  [/\b(glove|gauze|cannula|catheter|syringe|consum)\b/i, "Consumables / Disposables"],
  [/\b(monitor|equip|ventil|infusion|pump|oxygen|o2)\b/i,"Equipment / Monitoring"],
  [/\b(ambulance|transport)\b/i,                       "Ambulance"],
];

function printCategoryFor(trigger) {
  // Allow legacy string-only calls (some sites in the code still pass
  // serviceCode as a string) — wrap it in a faux trigger.
  const t = typeof trigger === "string" ? { serviceCode: trigger } : (trigger || {});

  // 1. ServiceMaster.category (populated)
  const masterCat = (t.serviceId?.category || t.category || "").toUpperCase();
  if (masterCat && CODE_PREFIX[masterCat]) return CODE_PREFIX[masterCat];

  // 2. sourceType
  if (t.sourceType && SOURCE_TYPE_CATEGORY[t.sourceType]) {
    return SOURCE_TYPE_CATEGORY[t.sourceType];
  }

  // 3. ANY segment of the serviceCode — split by "-" and test each
  const segments = (t.serviceCode || "").toUpperCase().split(/[-_\s]+/);
  for (const seg of segments) {
    if (CODE_PREFIX[seg]) return CODE_PREFIX[seg];
  }

  // 4. Keyword scan inside serviceName
  const name = String(t.serviceName || "");
  for (const [re, cat] of NAME_KEYWORDS) {
    if (re.test(name)) return cat;
  }

  // 5. Final fallback — never drop a row
  return "Other Charges";
}

const C = {
  primary: "#1d4ed8", accent: "#7c3aed",
  success: "#059669", warn: "#d97706", danger: "#dc2626",
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  muted: "#64748b", dark: "#0f172a",
  bedTint: "#dbeafe", nurseTint: "#fce7f3", docTint: "#ede9fe",
  labTint: "#fef9c3", drugTint: "#dcfce7", procTint: "#fed7aa",
};

// Service-code prefix → friendly category label + badge tint
const CATEGORY = {
  BED:        { label: "Bed Charges",     icon: "pi-th-large",     tint: C.bedTint,   fg: "#1d4ed8" },
  NURSING:    { label: "Nursing",         icon: "pi-heart",        tint: C.nurseTint, fg: "#be185d" },
  NRS:        { label: "Nursing",         icon: "pi-heart",        tint: C.nurseTint, fg: "#be185d" },
  DOC:        { label: "Doctor Visits",   icon: "pi-user-edit",    tint: C.docTint,   fg: "#6d28d9" },
  LAB:        { label: "Investigations",  icon: "pi-search-plus",  tint: C.labTint,   fg: "#854d0e" },
  RAD:        { label: "Radiology",       icon: "pi-eye",          tint: "#ffe4e6",   fg: "#9f1239" },
  IMG:        { label: "Imaging",         icon: "pi-eye",          tint: "#ffe4e6",   fg: "#9f1239" },
  PHARM:      { label: "Pharmacy / Medications", icon: "pi-box",   tint: C.drugTint,  fg: "#15803d" },
  PHARMACY:   { label: "Pharmacy / Medications", icon: "pi-box",   tint: C.drugTint,  fg: "#15803d" },
  MED:        { label: "Pharmacy / Medications", icon: "pi-box",   tint: C.drugTint,  fg: "#15803d" },
  MAR:        { label: "Pharmacy / Medications", icon: "pi-box",   tint: C.drugTint,  fg: "#15803d" },
  DRUG:       { label: "Pharmacy / Medications", icon: "pi-box",   tint: C.drugTint,  fg: "#15803d" },
  PRC:        { label: "Procedures",      icon: "pi-bolt",         tint: C.procTint,  fg: "#c2410c" },
  PROC:       { label: "Procedures",      icon: "pi-bolt",         tint: C.procTint,  fg: "#c2410c" },
  PROCEDURE:  { label: "Procedures",      icon: "pi-bolt",         tint: C.procTint,  fg: "#c2410c" },
  OT:         { label: "OT / Surgical",   icon: "pi-cog",          tint: "#fecaca",   fg: "#b91c1c" },
  CONSUMABLE: { label: "Consumables",     icon: "pi-shopping-cart",tint: "#e0f2fe",   fg: "#0369a1" },
  CON:        { label: "Consumables",     icon: "pi-shopping-cart",tint: "#e0f2fe",   fg: "#0369a1" },
  EQP:        { label: "Equipment",       icon: "pi-server",       tint: "#f3e8ff",   fg: "#7e22ce" },
  PKG:        { label: "Packages",        icon: "pi-tag",          tint: "#fef3c7",   fg: "#a16207" },
  PACKAGE:    { label: "Packages",        icon: "pi-tag",          tint: "#fef3c7",   fg: "#a16207" },
  ER:         { label: "Emergency",       icon: "pi-flag",         tint: "#fee2e2",   fg: "#b91c1c" },
  REG:        { label: "Registration",    icon: "pi-id-card",      tint: "#f1f5f9",   fg: "#475569" },
  ADM:        { label: "Admission",       icon: "pi-id-card",      tint: "#f1f5f9",   fg: "#475569" },
};
const catBadge = (code) => {
  const head = (code || "OTHER").toUpperCase().split("-")[0];
  return CATEGORY[head] || { label: head, icon: "pi-receipt", tint: "#f1f5f9", fg: "#475569" };
};

// ── Money formatter ─────────────────────────────────────────────
// R7av-FIX-13/D4-R7at-money: use central toMoney so Decimal128 fields
// (grossAmount, totalDiscount, netAmount, advancePaid, balanceAmount,
// per-medicine prices) don't render as ₹NaN.
const inr = (n) => `₹${(toMoney(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate     = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ── Status pill colours ─────────────────────────────────────────
const STATUS_TONE = {
  billed:      { bg: "#dcfce7", fg: "#15803d" },
  pending:     { bg: "#fef3c7", fg: "#a16207" },
  completed:   { bg: "#dbeafe", fg: "#1d4ed8" },
  in_progress: { bg: "#dbeafe", fg: "#1d4ed8" },
  voided:      { bg: "#fee2e2", fg: "#b91c1c" },
  cancelled:   { bg: "#fee2e2", fg: "#b91c1c" },
  skipped:     { bg: "#f1f5f9", fg: "#475569" },
};
const statusTone = (s) => STATUS_TONE[s] || STATUS_TONE.pending;

// ═══════════════════════════════════════════════════════════════════
// Small composable bits
// ═══════════════════════════════════════════════════════════════════

function KPI({ label, value, tone = C.primary, sub }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "10px 14px",
      boxShadow: "0 1px 3px rgba(15,23,42,.05)",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: tone, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StatusPill({ status }) {
  const t = statusTone(status);
  return (
    <span style={{
      background: t.bg, color: t.fg,
      padding: "1px 8px", borderRadius: 10,
      fontSize: 10, fontWeight: 800,
      textTransform: "uppercase", letterSpacing: ".4px",
    }}>{status}</span>
  );
}

function CategoryBadge({ code }) {
  const cb = catBadge(code);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: cb.tint, color: cb.fg,
      padding: "2px 7px", borderRadius: 6,
      fontSize: 10, fontWeight: 800, letterSpacing: ".3px",
      fontFamily: "'DM Mono', monospace",
    }}>
      <i className={`pi ${cb.icon}`} style={{ fontSize: 10 }} />
      {(code || "OTHER").split("-")[0]}
    </span>
  );
}

// ── Reason-required modal ────────────────────────────────────────
// Used by Undo / Override / Cancel. The memory rule: "Manual override
// at any time with mandatory reason field". This is the implementation.
function ReasonModal({ open, title, intent = "primary", children, busy, onClose, onConfirm, confirmLabel }) {
  if (!open) return null;
  const tone =
    intent === "danger"   ? C.danger :
    intent === "warn"     ? C.warn :
    intent === "success"  ? C.success :
                            C.primary;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(15,23,42,.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.card, borderRadius: 14, width: 480, maxWidth: "92vw",
        padding: 22, boxShadow: "0 24px 48px rgba(15,23,42,.25)",
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: tone, marginBottom: 14 }}>{title}</div>
        {children}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onClose} disabled={busy} style={{
            padding: "8px 16px", border: `1px solid ${C.border}`, background: "#fff",
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
          }}>Cancel</button>
          <button onClick={onConfirm} disabled={busy} style={{
            padding: "8px 18px", border: "none", background: tone, color: "#fff",
            borderRadius: 8, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", fontWeight: 700,
          }}>
            {busy ? <><i className="pi pi-spin pi-spinner" /> Saving…</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════

export default function IPDBillingLedger() {
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("category");   // "category" | "daily" | "audit"
  const [collapsed, setCollapsed] = useState({});  // section open/closed state

  // Modal state for undo / override / cancel
  const [modal, setModal] = useState({ kind: null, trigger: null });
  const [reason, setReason] = useState("");
  const [overrideQty, setOverrideQty] = useState(1);
  const [overridePrice, setOverridePrice] = useState(0);
  const [busy, setBusy] = useState(false);

  // Manual-charge modal state — independent from the override/undo modal
  // (different fields, different submit endpoint). Opens when the user
  // hits "Add Charge". Only visible to roles with billing.manual-charge.
  const [addOpen, setAddOpen] = useState(false);
  const [addService, setAddService] = useState(null);    // ServiceMaster doc
  const [addSearch, setAddSearch] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [addPrice, setAddPrice] = useState("");          // empty = use tariff default
  const [addRemarks, setAddRemarks] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const load = useCallback(async () => {
    if (!admissionId) return;
    setLoading(true);
    try {
      const { data: res } = await axios.get(
        `${API_ENDPOINTS.BASE}/billing/ipd/${admissionId}/ledger`,
      );
      setData(res.data);
    } catch (e) {
      toast.error("Could not load ledger: " + (e.response?.data?.message || e.message));
    } finally {
      setLoading(false);
    }
  }, [admissionId]);

  useEffect(() => { load(); }, [load]);

  /* ─── Admission picker (when route is /billing/ipd without an id) ───
     Sidebar tile lands here without an admissionId. We render a
     lightweight picker: live list of active IPD/DC/ER admissions + a
     UHID search box. Click an admission row → navigate to
     /billing/ipd/{_id} which mounts the full ledger.

     Active list comes from /admissions/active (already filtered by the
     backend); UHID search hits /admissions?UHID=X which falls back to
     ALL admissions (including discharged) so the receptionist can also
     re-open a closed bill for re-print / refund. */
  const [pickerList,   setPickerList]   = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // R7af: the IPD Live Ledger only makes sense for INPATIENT admissions.
  // The /admissions/active endpoint legacy-returns OPD/Services rows
  // alongside real inpatient admissions (the Admission model has them
  // in its enum: "Emergency","Planned","Transfer","Day Care","OPD",
  // "Daycare","Services"). Filter to just the inpatient subset so the
  // picker doesn't surface OPD visits that don't belong on a ledger.
  const INPATIENT_TYPES = new Set([
    "IPD", "Emergency", "Planned", "Transfer", "Day Care", "Daycare",
  ]);
  const isInpatient = (a) =>
    INPATIENT_TYPES.has(a?.admissionType)
    // Also require an admissionNumber so legacy rows without one are skipped.
    && !!(a?.admissionNumber);

  useEffect(() => {
    if (admissionId) return; // ledger mode — skip picker fetch
    let cancelled = false;
    (async () => {
      setPickerLoading(true);
      try {
        const { data: r } = await axios.get(`${API_ENDPOINTS.BASE}/admissions/active`);
        const arr = Array.isArray(r) ? r : r?.data || [];
        // R7af: filter out OPD/Services rows at fetch time so the picker
        // count + search both reflect inpatient-only.
        const inpatientOnly = arr.filter(isInpatient);
        if (!cancelled) setPickerList(inpatientOnly);
      } catch (e) {
        if (!cancelled) toast.error("Could not load admissions: " + (e?.response?.data?.message || e?.message));
      } finally {
        if (!cancelled) setPickerLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionId]);
  // Live filter — search by name / UHID / IPD No / bed / doctor / dept.
  const filteredPicker = (() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return pickerList;
    return pickerList.filter(a => {
      const hay = [
        a.patientName, a.UHID, a.admissionNumber, a.bedNumber,
        a.attendingDoctor, a.department, a.admissionType,
        a.patientId?.fullName, a.patientId?.contactNumber,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  })();

  /* ── Row action handlers ─────────────────────────────────── */
  const openUndo = (trigger) => {
    setModal({ kind: "undo", trigger });
    setReason("");
  };
  const openOverride = (trigger) => {
    setModal({ kind: "override", trigger });
    setReason("");
    setOverrideQty(trigger.quantity || 1);
    setOverridePrice(trigger.unitPrice || 0);
  };
  const openCancel = (trigger) => {
    setModal({ kind: "cancel", trigger });
    setReason("");
  };
  const closeModal = () => setModal({ kind: null, trigger: null });

  /* ── Add Manual Charge ─────────────────────────────────────
     Doctor/nurse/receptionist/accountant adds an ad-hoc line item
     (procedure performed, nursing care delivered, consumable used).
     Doctor/Nurse can ADD but not set price — controller enforces the
     tier check; we drop the unitPrice from the request body if the
     current role isn't Accountant/Admin so the request is honest. */
  const openAdd = () => {
    setAddOpen(true);
    setAddService(null); setAddSearch("");
    setAddQty(1); setAddPrice(""); setAddRemarks("");
  };
  const closeAdd = () => {
    if (addBusy) return;
    setAddOpen(false);
  };
  const submitAdd = async () => {
    if (!addService?._id) return toast.warn("Please pick a service");
    if (!Number(addQty) || Number(addQty) <= 0) return toast.warn("Invalid quantity");
    setAddBusy(true);
    try {
      const body = {
        serviceId: addService._id,
        quantity:  Number(addQty),
        remarks:   addRemarks.trim() || undefined,
      };
      // Only send unitPrice if the current role can set price — backend
      // would silently drop it for lower tiers anyway, but skipping it
      // here keeps the request shape honest in the network log.
      if ((user?.role === "Admin" || user?.role === "Accountant") && addPrice !== "") {
        body.unitPrice = Number(addPrice);
      }
      await axios.post(
        `${API_ENDPOINTS.BASE}/billing/ipd/${admissionId}/manual-charge`,
        body,
      );
      toast.success("Charge added to bill");
      setAddOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setAddBusy(false);
    }
  };

  /* ── Print Final Bill ───────────────────────────────────────
     Same shape as Print Interim but with isInterim=false flag — that
     flips the title to "Final Bill (Discharge / IPD)", drops the "(so
     far)" suffix on length-of-stay, replaces the snapshot banner, and
     switches the signature lines to Billing Officer / Patient. Only
     accessible when the discharge workflow has reached DoctorApproved
     (or later). Always category-grouped for the final print regardless
     of the tab the user is on — final bill should always look the same. */
  const handlePrintFinal = () => {
    if (!data) return toast.warn("Ledger not loaded yet");
    if (!canGenerateFinal) {
      return toast.warn(`Discharge not yet approved (stage: ${dischargeStage}). Doctor must approve first.`);
    }
    const items = (data.triggers || [])
      .filter(t => !["voided", "cancelled", "skipped"].includes(t.status))
      .map(t => ({
        category:    printCategoryFor(t),
        name:        t.serviceName || t.serviceCode,
        description: t.orderDetails,
        date:        t.createdAt,
        qty:         t.quantity || 1,
        rate:        t.unitPrice || 0,
        amount:      t.totalAmount || ((t.unitPrice || 0) * (t.quantity || 1)),
      }));
    openPrint("final-bill", {
      isInterim:        false,
      viewMode:         "category",
      billNo:           data.bill?.billNumber || `FINAL-${data.admission.admissionNumber}`,
      patientName:      patient.fullName || data.admission.UHID,
      uhid:             data.admission.UHID,
      ipdNo:            data.admission.admissionNumber,
      age:              patient.age,
      gender:           patient.gender,
      admissionDate:    data.admission.admissionDate,
      dischargeDate:    data.admission.actualDischargeDate || null,
      totalDays:        stayDays,
      bedNumber:        data.admission.bedId?.bedNumber || "",
      wardName:         data.admission.bedId?.wardName || data.admission.department || "",
      consultantName:   data.admission.consultantDoctor?.fullName || data.admission.primaryConsultant || "",
      finalDiagnosis:   data.admission.finalDiagnosis || data.admission.provisionalDiagnosis || data.admission.workingDiagnosis || data.admission.diagnosis || "",
      tpaName:          data.bill?.tpaName || null,
      items,
      discount:         totalDiscount,
      advanceReceived:  paid,
      payments:         (data.bill?.payments || []).map(p => ({
        date:   p.paidAt,
        method: p.paymentMode,
        refNo:  p.transactionId,
        amount: toMoney(p.amount),
      })),
      // R7bh-F1 / META-1: PrintAudit anchor — final IPD bill maps to
      // PatientBill so the bill's printCount increments per print.
      printAudit: {
        entityType:   "Bill",
        entityId:     data.bill?._id || data.admission._id,
        entityNumber: data.bill?.billNumber || `FINAL-${data.admission.admissionNumber}`,
        UHID:         data.admission.UHID,
        patientName:  patient.fullName || data.admission.UHID,
      },
    });
  };

  /* ── Print Interim Bill ────────────────────────────────────
     Mirrors whichever tab is currently active so the printout the user
     sees on screen lands on paper in the same shape. Three modes:
       category — items grouped by Bed/Nursing/Doctor/Drugs/etc.
       day      — items grouped by Day-N · date
       audit    — chronological audit log with source + actor + status
                  + override/void history rows inline (no totals — this
                  is a compliance log, not a bill)
     The printable component (FinalBill.jsx) branches on receipt.viewMode. */
  const handlePrintInterim = () => {
    if (!data) return toast.warn("Ledger not loaded yet");

    const stayDaysCalc = Math.max(1, Math.ceil(
      ((data.admission.actualDischargeDate ? new Date(data.admission.actualDischargeDate) : new Date()) -
       new Date(data.admission.admissionDate)) / 86400000,
    ));
    // Header bits shared across all three modes — patient, admission,
    // bill number, totals. Only the middle table changes.
    const baseHeader = {
      isInterim:        true,
      billNo:           data.bill?.billNumber || `INTERIM-${data.admission.admissionNumber}`,
      patientName:      patient.fullName || data.admission.UHID,
      uhid:             data.admission.UHID,
      ipdNo:            data.admission.admissionNumber,
      age:              patient.age,
      gender:           patient.gender,
      admissionDate:    data.admission.admissionDate,
      dischargeDate:    data.admission.actualDischargeDate || null,
      totalDays:        stayDaysCalc,
      bedNumber:        data.admission.bedId?.bedNumber || "",
      wardName:         data.admission.bedId?.wardName || data.admission.department || "",
      consultantName:   data.admission.consultantDoctor?.fullName || data.admission.primaryConsultant || "",
      finalDiagnosis:   data.admission.provisionalDiagnosis || data.admission.workingDiagnosis || data.admission.diagnosis || "",
      tpaName:          data.bill?.tpaName || null,
      discount:         totalDiscount,
      advanceReceived:  paid,
      payments:         (data.bill?.payments || []).map(p => ({
        date:   p.paidAt,
        method: p.paymentMode,
        refNo:  p.transactionId,
        amount: toMoney(p.amount),
      })),
      // R7bh-F1 / META-1: PrintAudit anchor — interim bill prints
      // are tracked against the underlying PatientBill so all three
      // view-mode reprints (category/day/audit) share the same count.
      printAudit: {
        entityType:   "Bill",
        entityId:     data.bill?._id || data.admission._id,
        entityNumber: data.bill?.billNumber || `INTERIM-${data.admission.admissionNumber}`,
        UHID:         data.admission.UHID,
        patientName:  patient.fullName || data.admission.UHID,
      },
    };

    // ── Audit Trail mode — full chronological log ─────────────────
    // Includes voided/cancelled/skipped entries (the audit trail is the
    // whole point — operator needs to see what was reversed, by whom,
    // and why). Each entry carries its override history + void reason
    // so the printable can render the change log as sub-rows.
    if (tab === "audit") {
      const auditEntries = (data.triggers || [])
        .slice()                                  // copy before sort (lean response)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map(t => ({
          when:           t.createdAt,
          source:         t.sourceType,
          category:       printCategoryFor(t),
          name:           t.serviceName || t.serviceCode,
          code:           t.serviceCode,
          remarks:        t.orderDetails,
          qty:            t.quantity || 1,
          rate:           t.unitPrice || 0,
          amount:         t.totalAmount || ((t.unitPrice || 0) * (t.quantity || 1)),
          status:         t.status,
          actor:          t.orderedBy
            ? `${t.orderedBy}${t.orderedByRole ? ` (${t.orderedByRole})` : ""}`
            : "System",
          billedAt:       t.billedAt,
          voidedAt:       t.voidedAt,
          voidedBy:       t.voidedBy,
          voidedByRole:   t.voidedByRole,
          voidReason:     t.voidReason,
          overrideHistory:t.overrideHistory || [],
          originalUnitPrice: t.originalUnitPrice,
          originalQuantity:  t.originalQuantity,
        }));
      openPrint("interim-bill", {
        ...baseHeader,
        viewMode:     "audit",
        auditEntries,
      });
      return;
    }

    // ── Daily Breakdown mode — pre-group items by Day-N ───────────
    // Build categories[] directly (FinalBill accepts pre-grouped data
    // and skips its own category bucketing). Sort by date ascending so
    // Day 1 prints first, Day N last. Excludes voided/cancelled.
    if (tab === "daily") {
      const admitStart = new Date(data.admission.admissionDate);
      admitStart.setHours(0, 0, 0, 0);
      const byDay = {};
      (data.triggers || [])
        .filter(t => !["voided", "cancelled", "skipped"].includes(t.status))
        .forEach(t => {
          const dKey = t.dateKey
            || (t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : "unknown");
          if (!byDay[dKey]) {
            const dayDate = new Date(dKey);
            dayDate.setHours(0, 0, 0, 0);
            const dayN = Math.max(1, Math.floor((dayDate - admitStart) / 86400000) + 1);
            const label = dKey === "unknown"
              ? "Undated"
              : `Day ${dayN} · ${dayDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
            byDay[dKey] = { name: label, dateKey: dKey, items: [] };
          }
          byDay[dKey].items.push({
            category:    printCategoryFor(t),
            name:        t.serviceName || t.serviceCode,
            description: `${t.serviceCode}${t.orderDetails ? ` · ${t.orderDetails}` : ""}`,
            date:        t.createdAt,
            qty:         t.quantity || 1,
            rate:        t.unitPrice || 0,
            amount:      t.totalAmount || ((t.unitPrice || 0) * (t.quantity || 1)),
          });
        });
      const categories = Object.values(byDay).sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey)
      );
      openPrint("interim-bill", {
        ...baseHeader,
        viewMode:   "day",
        categories,                            // FinalBill uses this directly
      });
      return;
    }

    // ── Category mode (default) — items grouped by Bed/Nursing/etc. ─
    const items = (data.triggers || [])
      .filter(t => !["voided", "cancelled", "skipped"].includes(t.status))
      .map(t => ({
        category:    printCategoryFor(t),
        name:        t.serviceName || t.serviceCode,
        description: t.orderDetails,
        date:        t.createdAt,
        qty:         t.quantity || 1,
        rate:        t.unitPrice || 0,
        amount:      t.totalAmount || ((t.unitPrice || 0) * (t.quantity || 1)),
      }));
    openPrint("interim-bill", {
      ...baseHeader,
      viewMode: "category",
      items,
    });
  };

  const confirmAction = async () => {
    if (!modal.trigger) return;
    if (!reason.trim()) return toast.warn("Reason is required");
    setBusy(true);
    try {
      const url = `${API_ENDPOINTS.BASE}/billing/trigger/${modal.trigger._id}/${modal.kind}`;
      const body = modal.kind === "override"
        ? { quantity: Number(overrideQty), unitPrice: Number(overridePrice), reason: reason.trim() }
        : { reason: reason.trim() };
      await axios.post(url, body);
      toast.success(`Charge ${modal.kind === "undo" ? "undone" : modal.kind === "override" ? "overridden" : "cancelled"}`);
      closeModal();
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  /* ── Admission picker (no admissionId in URL) ────────────────
     Sidebar IPD Live Ledger tile drops the receptionist here without
     a specific admission. Show the active-admissions list with a UHID
     search; clicking a row navigates to /billing/ipd/{_id}. */
  if (!admissionId) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {/* Hero */}
          <div style={{
            background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
            borderRadius: 14, padding: "18px 22px", marginBottom: 18,
            color: "#fff", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
            boxShadow: "0 4px 14px rgba(124, 58, 237, .25)",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className="pi pi-chart-line" style={{ fontSize: 22 }} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>IPD Live Ledger</div>
              <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
                Pick an admission to view its rolling tab · Generate Final Bill · Print Final Bill
              </div>
            </div>
          </div>

          {/* Search box */}
          <div style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 14, marginBottom: 14,
            display: "flex", gap: 10, alignItems: "center",
          }}>
            <i className="pi pi-search" style={{ color: C.muted }} />
            <input
              autoFocus
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="Search by name, UHID, IPD No, bed, doctor or department…"
              style={{
                flex: 1, border: "none", outline: "none",
                fontSize: 14, fontFamily: "inherit", color: C.dark,
              }}
            />
            <span style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono', monospace" }}>
              {filteredPicker.length} / {pickerList.length}
            </span>
          </div>

          {/* List */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            {pickerLoading ? (
              <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
                <i className="pi pi-spin pi-spinner" style={{ fontSize: 22, marginBottom: 8 }} />
                <div>Loading active admissions…</div>
              </div>
            ) : filteredPicker.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
                <i className="pi pi-inbox" style={{ fontSize: 28, marginBottom: 8, color: "#cbd5e1" }} />
                <div>{pickerSearch ? "No matching admissions" : "No active IPD/DC/ER admissions"}</div>
                <div style={{ fontSize: 11, marginTop: 6 }}>
                  {pickerSearch ? "Try a different search term" : "Admit a patient via Reception → New Registration → IPD/Daycare/Emergency"}
                </div>
              </div>
            ) : (
              filteredPicker.map((a) => {
                const typeColor = ({
                  IPD: "#7c3aed", "Day Care": "#d97706", Daycare: "#d97706",
                  Emergency: "#dc2626", Planned: "#7c3aed",
                })[a.admissionType] || "#64748b";
                const days = a.admissionDate
                  ? Math.max(1, Math.floor((Date.now() - new Date(a.admissionDate).getTime()) / 86400000))
                  : "—";
                return (
                  <div
                    key={a._id}
                    onClick={() => navigate(`/billing/ipd/${a._id}`)}
                    style={{
                      padding: "12px 16px",
                      borderBottom: `1px solid ${C.border}`,
                      cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 14,
                      transition: "background .12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: `${typeColor}1a`, color: typeColor,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 800, fontSize: 13, flexShrink: 0,
                    }}>
                      {(a.patientName || a.patientId?.fullName || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, color: C.dark, fontSize: 14 }}>
                          {a.patientName || a.patientId?.fullName || "(no name)"}
                        </span>
                        <span style={{
                          padding: "1px 7px", borderRadius: 999,
                          background: `${typeColor}1a`, color: typeColor,
                          fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4,
                        }}>{a.admissionType || "IPD"}</span>
                        <span style={{ fontSize: 10, color: C.muted }}>Day {days}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontFamily: "'DM Mono', monospace" }}>
                        {a.UHID || "—"} · {a.admissionNumber || "—"} · Bed {a.bedNumber || "—"} · {a.department || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        Dr. {a.attendingDoctor || "—"}
                        {a.reasonForAdmission && <> · {a.reasonForAdmission}</>}
                      </div>
                    </div>
                    <i className="pi pi-chevron-right" style={{ color: C.muted, fontSize: 12 }} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── Loading / not found states ──────────────────────────── */
  if (loading) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <i className="pi pi-spin pi-spinner" style={{ fontSize: 32, color: C.primary }} />
      <div style={{ marginTop: 12, color: C.muted, fontSize: 13 }}>Loading IPD billing ledger…</div>
    </div>
  );
  if (!data) return <div style={{ padding: 60, textAlign: "center", color: C.danger }}>Ledger unavailable</div>;

  const { admission, bill, billSummary, triggerLiveTotal, advanceBalance, triggers, byCategory, byDay, counts, undoWindowMs } = data;
  const patient = admission.patientId || {};
  // Use aggregated billSummary so totals reflect every bill linked to this
  // admission (auto-biller may split across DRAFTs over a long stay), not
  // just the single bill the API picked as "active". Fall back to live
  // trigger sum when bills haven't materialised yet — keeps the KPI useful
  // for brand-new admissions before the first save() finishes.
  const s = billSummary || {};
  const grossAmount   = Number(s.grossAmount   || 0) || Number(triggerLiveTotal || 0);
  const totalDiscount = Number(s.totalDiscount || 0);
  const netAmount     = Number(s.netAmount     || 0) || grossAmount;
  const paid          = Number(s.advancePaid   || 0);
  const balance       = Math.max(0, Number(s.balanceAmount || 0) || (netAmount - paid));

  // Stay in days
  const dischargedAt = admission.actualDischargeDate;
  const stayMs = (dischargedAt ? new Date(dischargedAt) : new Date()) - new Date(admission.admissionDate);
  const stayDays = Math.max(1, Math.ceil(stayMs / 86400000));
  const isDaycare = admission.admissionType === "Day Care" || admission.admissionType === "Daycare";

  // Medicine tally — every live MAR / pharmacy trigger counts as one dose.
  // Total ₹ + dose count drive the new "Medicines" KPI card so the
  // attendant knows at-a-glance how much of the bill is drugs.
  const medTriggers = (triggers || []).filter(t =>
    !["voided", "cancelled", "skipped"].includes(t.status) &&
    (t.sourceType === "MAR" || /^(PHARM|MED|DRUG|MAR)/i.test(t.serviceCode || ""))
  );
  // Doses = sum of quantities across all medicine triggers (a row with
  // qty=6 = 6 tablets, not 1). Distinct drugs = trigger row count.
  const medicineCount  = medTriggers.reduce((s, t) => s + (Number(t.quantity) || 0), 0);
  const medicineLines  = medTriggers.length;
  const medicineTotal  = medTriggers.reduce((s, t) => s + Number(t.totalAmount || 0), 0);

  // Discharge gate: receptionist can clear the final bill only AFTER
  // doctor approves discharge. Final-bill generation is appropriate at:
  //   DoctorApproved → patient ready, bill needs settlement
  //   BillCleared    → already cleared, allow reprint
  // For other stages we hide the "Generate Final Bill" button — clicking
  // it before doctor signs off would be premature.
  const dischargeStage = admission.dischargeWorkflow?.stage || "NotRequested";
  const canGenerateFinal = ["DoctorApproved", "BillCleared", "GatePassIssued", "Completed"].includes(dischargeStage);
  const isDischarged = !!dischargedAt;

  /* ── Header card ────────────────────────────────────────── */
  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "16px 20px 60px" }}>
      {/* Back + title row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button onClick={() => navigate(-1)} style={{
          padding: "6px 12px", background: "#fff", border: `1px solid ${C.border}`,
          borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, color: C.dark,
        }}>
          <i className="pi pi-arrow-left" style={{ marginRight: 6, fontSize: 11 }} />
          Back
        </button>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.dark }}>
          {isDaycare ? "Day-Care" : "IPD"} Live Billing Ledger
        </div>
        <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted }}>
          {bill?.billNumber || "DRAFT"} · {admission.admissionNumber}
        </span>
      </div>

      {/* Patient + admission card */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 16, alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".4px" }}>Patient</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.dark, marginTop: 2 }}>{patient.fullName || "—"}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              UHID: <strong style={{ color: C.dark }}>{admission.UHID}</strong> ·
              {patient.age && ` ${patient.age}Y `} · {patient.gender || "—"} · {patient.contactNumber || "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700 }}>Admission</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.dark, marginTop: 4 }}>
              {fmtDateTime(admission.admissionDate)}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
              {admission.admissionType} · Day {stayDays}
              {dischargedAt && <> · <span style={{ color: C.warn }}>Discharged {fmtDate(dischargedAt)}</span></>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700 }}>Bed / Room</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.dark, marginTop: 4 }}>
              {admission.bedId?.bedNumber || "—"} {admission.bedId?.roomNumber ? `· ${admission.bedId.roomNumber}` : ""}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{admission.department || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700 }}>Package</div>
            {admission.package?.packageName ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.accent, marginTop: 4 }}>
                  {admission.package.packageName}
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                  Tier: <strong>{admission.package.tierUsed || "—"}</strong>
                  {admission.package.maxLOSDays && <> · LOS {admission.package.maxLOSDays}d</>}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4, fontStyle: "italic" }}>None matched</div>
            )}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <KPI label="Gross" value={inr(grossAmount)} sub={`${counts.billed} billed lines`} />
        <KPI label="Discount" value={inr(totalDiscount)} tone={C.warn} />
        <KPI label="Net Payable" value={inr(netAmount)} tone={C.dark} />
        <KPI label="Paid" value={inr(paid)} tone={C.success} sub={paid > 0 ? "From payments + advance" : "—"} />
        <KPI label="Outstanding" value={inr(balance)} tone={balance > 0 ? C.danger : C.success} />
        <KPI label="Medicines" value={`${medicineCount} dose${medicineCount === 1 ? "" : "s"}`}
             tone={C.success}
             sub={medicineTotal > 0
               ? `${medicineLines} drug${medicineLines === 1 ? "" : "s"} · ${inr(medicineTotal)}`
               : "No drugs billed yet"} />
        <KPI label="Advance Pool" value={inr(advanceBalance)} tone={C.accent} sub="Unspent UHID advance" />
      </div>

      {/* Action bar */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 10, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginRight: 6 }}>ACTIONS:</div>
        {can("billing.write") && (
          <button onClick={() => navigate(`/reception-billing/${admission.UHID}?admissionId=${admissionId}`)} style={{
            padding: "7px 14px", background: C.primary, color: "#fff", border: "none",
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
          }}>
            <i className="pi pi-wallet" style={{ marginRight: 6 }} />
            Open Billing Counter
          </button>
        )}
        {can("billing.write") && (
          <button onClick={() => navigate(`/reception-billing/${admission.UHID}?action=advance`)} style={{
            padding: "7px 14px", background: C.success, color: "#fff", border: "none",
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
          }}>
            <i className="pi pi-plus" style={{ marginRight: 6 }} />
            Take Advance
          </button>
        )}
        {/* Add Charge — every clinician + desk role above can push a
            line into the ledger. Pricing override is locked to
            Accountant/Admin (backend strips it for lower roles). */}
        {can("billing.manual-charge") && (
          <button onClick={openAdd} style={{
            padding: "7px 14px", background: C.accent, color: "#fff", border: "none",
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
          }}>
            <i className="pi pi-plus-circle" style={{ marginRight: 6 }} />
            Add Charge
          </button>
        )}
        {/* Raise Pharmacy Indent — nurse/doctor can request drugs for
            this admission. Opens IndentRaisePage in a new route. */}
        {can("indent.raise") && (
          <button onClick={() => navigate(`/nursing/indent/raise/${admissionId}`)} style={{
            padding: "7px 14px", background: "#0d9488", color: "#fff", border: "none",
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
          }}>
            <i className="pi pi-inbox" style={{ marginRight: 6 }} />
            Raise Indent
          </button>
        )}
        <button onClick={handlePrintInterim} style={{
          padding: "7px 14px", background: "#fff", color: C.dark, border: `1px solid ${C.border}`,
          borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
        }}>
          <i className="pi pi-print" style={{ marginRight: 6 }} />
          Print Interim Bill
        </button>
        {/* Final Bill — only enabled when doctor has approved discharge.
            Pre-discharge clicks show a toast explaining the gate. Once
            available the button is highlighted green so the receptionist
            sees it's the right action to settle the stay. */}
        {(can("billing.write") || can("billing.read")) && (
          <button
            onClick={handlePrintFinal}
            disabled={!canGenerateFinal}
            title={!canGenerateFinal
              ? `Discharge not yet approved (stage: ${dischargeStage})`
              : isDischarged ? "Reprint final bill" : "Generate the final settlement bill"}
            style={{
              padding: "7px 14px",
              background: canGenerateFinal ? C.success : "#e2e8f0",
              color: canGenerateFinal ? "#fff" : C.muted,
              border: "none",
              borderRadius: 8,
              cursor: canGenerateFinal ? "pointer" : "not-allowed",
              fontFamily: "inherit", fontWeight: 700, fontSize: 12,
            }}>
            <i className="pi pi-check-square" style={{ marginRight: 6 }} />
            {isDischarged ? "Reprint Final Bill" : "Generate Final Bill"}
          </button>
        )}
        <button onClick={load} style={{
          marginLeft: "auto",
          padding: "7px 12px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
          borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12,
        }}>
          <i className="pi pi-refresh" style={{ marginRight: 4 }} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: `2px solid ${C.border}`, marginBottom: 14 }}>
        {[
          { id: "category", label: "Category",         icon: "pi-th-large" },
          { id: "daily",    label: "Daily Breakdown",  icon: "pi-calendar" },
          { id: "audit",    label: "Audit Trail",      icon: "pi-history" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 18px", background: tab === t.id ? C.card : "transparent",
            border: "none", borderBottom: tab === t.id ? `3px solid ${C.primary}` : "3px solid transparent",
            marginBottom: -2, cursor: "pointer", fontFamily: "inherit",
            fontWeight: tab === t.id ? 800 : 600,
            color: tab === t.id ? C.primary : C.muted,
            fontSize: 13,
          }}>
            <i className={`pi ${t.icon}`} style={{ marginRight: 6, fontSize: 12 }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      {tab === "category" && (
        <CategoryView byCategory={byCategory} collapsed={collapsed} setCollapsed={setCollapsed}
          onUndo={openUndo} onOverride={openOverride} onCancel={openCancel}
          undoWindowMs={undoWindowMs} />
      )}
      {tab === "daily" && (
        <DailyView byDay={byDay} collapsed={collapsed} setCollapsed={setCollapsed}
          onUndo={openUndo} onOverride={openOverride} onCancel={openCancel}
          undoWindowMs={undoWindowMs} />
      )}
      {tab === "audit" && <AuditView triggers={triggers} />}

      {/* ── Undo modal ─────────────────────────────────────── */}
      <ReasonModal
        open={modal.kind === "undo"}
        title={`Undo charge — ${modal.trigger?.serviceName || ""}`}
        intent="warn"
        busy={busy}
        onClose={closeModal}
        onConfirm={confirmAction}
        confirmLabel="Confirm undo"
      >
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          This will remove <strong>{inr(modal.trigger?.totalAmount)}</strong> from the bill and mark the trigger as <strong>voided</strong>. Auditable.
        </div>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
          Reason (required) *
        </label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
          placeholder="e.g. Triggered by mistake — patient never received this service"
          style={{ width: "100%", marginTop: 6, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
      </ReasonModal>

      {/* ── Override modal ─────────────────────────────────── */}
      <ReasonModal
        open={modal.kind === "override"}
        title={`Override charge — ${modal.trigger?.serviceName || ""}`}
        intent="primary"
        busy={busy}
        onClose={closeModal}
        onConfirm={confirmAction}
        confirmLabel="Save override"
      >
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          Originally: {modal.trigger?.originalQuantity ?? "?"} × {inr(modal.trigger?.originalUnitPrice)} = <strong>{inr((modal.trigger?.originalQuantity || 1) * (modal.trigger?.originalUnitPrice || 0))}</strong>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>Quantity</label>
            <input type="number" min={1} value={overrideQty} onChange={e => setOverrideQty(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>Unit Price (₹)</label>
            <input type="number" min={0} step="0.01" value={overridePrice} onChange={e => setOverridePrice(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.dark, marginBottom: 10 }}>
          New total: <strong style={{ color: C.primary, fontFamily: "'DM Mono', monospace" }}>{inr(Number(overrideQty) * Number(overridePrice))}</strong>
        </div>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
          Reason (required) *
        </label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
          placeholder="e.g. Negotiated rate for long-stay patient; courtesy adjustment"
          style={{ width: "100%", marginTop: 6, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
      </ReasonModal>

      {/* ── Add Charge modal ─────────────────────────────────
           Doctor / Nurse / Receptionist / Accountant picks a service
           from ServiceMaster, sets qty (+ price for Accountant/Admin),
           writes a remark, and the line lands on the running DRAFT
           bill via the auto-billing pipeline. */}
      {addOpen && (
        <div onClick={closeAdd} style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(15,23,42,.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: C.card, borderRadius: 14, width: 540, maxWidth: "92vw",
            padding: 22, boxShadow: "0 24px 48px rgba(15,23,42,.25)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.accent, marginBottom: 14 }}>
              <i className="pi pi-plus-circle" style={{ marginRight: 6 }} />
              Add charge to bill — {patient.fullName || data?.admission?.UHID}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
                Service / Procedure / Consumable *
              </label>
              <ServiceAutocomplete
                showLabel={false}
                value={addSearch}
                onChange={(v) => { setAddSearch(v); if (!v) setAddService(null); }}
                onPick={(s) => {
                  setAddService(s);
                  setAddSearch(s.serviceName);
                  setAddPrice(s.defaultPrice ?? "");
                }}
                applicableTo={data?.admission?.admissionType === "Day Care" || data?.admission?.admissionType === "Daycare" ? "DAYCARE" : "IPD"}
                inputClassName=""
                inputStyle={{
                  width: "100%", padding: "9px 12px", marginTop: 6,
                  border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
                }}
              />
              {addService && (
                <div style={{ marginTop: 6, padding: "6px 10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 11, color: "#15803d" }}>
                  <strong>Selected:</strong> {addService.serviceName} ({addService.serviceCode}) · {addService.category}
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>Quantity *</label>
                <input type="number" min={1} value={addQty} onChange={(e) => setAddQty(e.target.value)}
                  style={{ width: "100%", marginTop: 4, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>
                  Unit Price (₹)
                  {!(user?.role === "Admin" || user?.role === "Accountant") && (
                    <span style={{ marginLeft: 4, fontSize: 9, color: C.muted, fontWeight: 600 }}>· read-only (tariff)</span>
                  )}
                </label>
                <input type="number" min={0} step="0.01" value={addPrice}
                  disabled={!(user?.role === "Admin" || user?.role === "Accountant")}
                  onChange={(e) => setAddPrice(e.target.value)}
                  style={{
                    width: "100%", marginTop: 4, padding: 8,
                    border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
                    background: !(user?.role === "Admin" || user?.role === "Accountant") ? "#f1f5f9" : "#fff",
                  }} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.dark, marginBottom: 12 }}>
              Line total: <strong style={{ color: C.accent, fontFamily: "'DM Mono', monospace", fontSize: 14 }}>
                {inr(Number(addQty || 0) * Number(addPrice || addService?.defaultPrice || 0))}
              </strong>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
                Remarks / Notes
              </label>
              <textarea value={addRemarks} onChange={(e) => setAddRemarks(e.target.value)} rows={2}
                placeholder="e.g. Cannulation done for IV fluids · Bedside ECG taken"
                style={{ width: "100%", marginTop: 6, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={closeAdd} disabled={addBusy} style={{
                padding: "8px 16px", border: `1px solid ${C.border}`, background: "#fff",
                borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
              }}>Cancel</button>
              <button onClick={submitAdd} disabled={addBusy || !addService} style={{
                padding: "8px 18px", border: "none", background: C.accent, color: "#fff",
                borderRadius: 8, cursor: addBusy ? "wait" : "pointer", fontFamily: "inherit", fontWeight: 700,
                opacity: !addService ? 0.5 : 1,
              }}>
                {addBusy ? <><i className="pi pi-spin pi-spinner" /> Adding…</> : "Add to bill"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel modal ───────────────────────────────────── */}
      <ReasonModal
        open={modal.kind === "cancel"}
        title={`Cancel charge — ${modal.trigger?.serviceName || ""}`}
        intent="danger"
        busy={busy}
        onClose={closeModal}
        onConfirm={confirmAction}
        confirmLabel="Cancel charge"
      >
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          This permanently removes <strong>{inr(modal.trigger?.totalAmount)}</strong> from the bill and locks the trigger as <strong style={{ color: C.danger }}>cancelled</strong>. Use for charges that were never delivered.
        </div>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
          Reason (required) *
        </label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
          placeholder="e.g. Service never delivered; patient refused; ordered in error after billing"
          style={{ width: "100%", marginTop: 6, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", resize: "vertical" }} />
      </ReasonModal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Trigger row + action buttons (shared by category + daily views)
// ═══════════════════════════════════════════════════════════════════

function TriggerRow({ t, onUndo, onOverride, onCancel, undoWindowMs }) {
  // Live countdown for the 15-min undo window so the receptionist can
  // see how much time is left. Tick once a second only when the row is
  // currently within the window (and not already voided).
  const isAuto = t.autoCharged && t.status === "billed";
  const expiry = isAuto && t.undoWindowExpiresAt ? new Date(t.undoWindowExpiresAt).getTime() : 0;
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!isAuto || expiry < Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isAuto, expiry]);
  const remainSec = Math.max(0, Math.floor((expiry - now) / 1000));
  const remainStr = remainSec > 0 ? `${Math.floor(remainSec / 60)}:${String(remainSec % 60).padStart(2, "0")}` : null;

  const wasOverridden = (t.overrideHistory || []).length > 0;

  return (
    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
      <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
        <CategoryBadge code={t.serviceCode} />
      </td>
      <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.dark }}>
          {t.serviceName || t.serviceCode}
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>
          {t.serviceCode} · {t.sourceType}
          {t.orderedBy && <> · by {t.orderedBy}{t.orderedByRole && ` (${t.orderedByRole})`}</>}
        </div>
        {t.orderDetails && (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1, fontStyle: "italic" }}>{t.orderDetails}</div>
        )}
        {wasOverridden && (
          <div style={{ fontSize: 10, color: C.warn, marginTop: 2, fontWeight: 700 }}>
            <i className="pi pi-history" style={{ marginRight: 3, fontSize: 9 }} />
            Overridden {t.overrideHistory.length}× · originally {inr((t.originalUnitPrice || 0) * (t.originalQuantity || 1))}
          </div>
        )}
        {t.voidedAt && (
          <div style={{ fontSize: 10, color: C.danger, marginTop: 2 }}>
            <i className="pi pi-ban" style={{ marginRight: 3, fontSize: 9 }} />
            {t.status === "cancelled" ? "Cancelled" : "Voided"} by {t.voidedBy} ({t.voidedByRole}) · {t.voidReason}
          </div>
        )}
      </td>
      <td style={{ padding: "8px 10px", verticalAlign: "top", whiteSpace: "nowrap", textAlign: "center", fontSize: 11.5, fontFamily: "'DM Mono', monospace" }}>
        {t.quantity}
      </td>
      <td style={{ padding: "8px 10px", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap", fontSize: 11.5, fontFamily: "'DM Mono', monospace" }}>
        {inr(t.unitPrice)}
      </td>
      <td style={{ padding: "8px 10px", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap", fontWeight: 800, fontSize: 12.5, fontFamily: "'DM Mono', monospace", color: t.status === "voided" || t.status === "cancelled" ? C.muted : C.dark, textDecoration: (t.status === "voided" || t.status === "cancelled") ? "line-through" : "none" }}>
        {inr(t.totalAmount)}
      </td>
      <td style={{ padding: "8px 10px", verticalAlign: "top", textAlign: "center", whiteSpace: "nowrap" }}>
        <StatusPill status={t.status} />
        <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{fmtDateTime(t.createdAt)}</div>
        {remainStr && t.canUndo && (
          <div style={{ fontSize: 9, fontWeight: 700, color: C.warn, marginTop: 2 }}>
            <i className="pi pi-clock" style={{ marginRight: 2, fontSize: 9 }} />
            Undo {remainStr}
          </div>
        )}
      </td>
      <td style={{ padding: "8px 6px", verticalAlign: "top", whiteSpace: "nowrap", textAlign: "right" }}>
        {t.canUndo && (
          <button onClick={() => onUndo(t)} title="Undo (15-min window)" style={actionBtnStyle(C.warn)}>
            <i className="pi pi-undo" />
          </button>
        )}
        {t.canOverride && (
          <button onClick={() => onOverride(t)} title="Override qty/price" style={actionBtnStyle(C.primary)}>
            <i className="pi pi-pencil" />
          </button>
        )}
        {t.canCancel && (
          <button onClick={() => onCancel(t)} title="Cancel charge" style={actionBtnStyle(C.danger)}>
            <i className="pi pi-times" />
          </button>
        )}
      </td>
    </tr>
  );
}

const actionBtnStyle = (color) => ({
  width: 28, height: 28, padding: 0, margin: "0 2px",
  background: color + "14", color, border: `1px solid ${color}30`,
  borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
});

// ═══════════════════════════════════════════════════════════════════
// Tab views
// ═══════════════════════════════════════════════════════════════════

function CategoryView({ byCategory, collapsed, setCollapsed, onUndo, onOverride, onCancel, undoWindowMs }) {
  if (!byCategory.length) return (
    <div style={{ padding: 40, textAlign: "center", color: C.muted, fontStyle: "italic" }}>
      No charges have been billed yet.
    </div>
  );
  const toggle = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }));

  return (
    <div>
      {byCategory.map(group => {
        const cb = catBadge(group.category);
        const open = !collapsed[`cat-${group.category}`];
        return (
          <div key={group.category} style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, marginBottom: 12, overflow: "hidden",
          }}>
            <button onClick={() => toggle(`cat-${group.category}`)} style={{
              width: "100%", padding: "12px 16px", background: cb.tint,
              border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 10,
              borderBottom: open ? `1px solid ${C.border}` : "none",
            }}>
              <i className={`pi ${cb.icon}`} style={{ fontSize: 14, color: cb.fg }} />
              <span style={{ fontWeight: 800, color: cb.fg, fontSize: 13 }}>{cb.label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: cb.fg, opacity: 0.7 }}>· {group.count} line{group.count > 1 ? "s" : ""}</span>
              <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: 14, color: cb.fg, fontFamily: "'DM Mono', monospace" }}>
                {inr(group.total)}
              </span>
              <i className="pi pi-chevron-down" style={{ marginLeft: 10, fontSize: 11, color: cb.fg, transform: open ? "rotate(0)" : "rotate(-90deg)", transition: "transform .15s" }} />
            </button>
            {open && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    <th style={th(60)}>Cat</th>
                    <th style={th()}>Service</th>
                    <th style={th(50, "center")}>Qty</th>
                    <th style={th(90, "right")}>Rate</th>
                    <th style={th(100, "right")}>Total</th>
                    <th style={th(110, "center")}>Status</th>
                    <th style={th(110, "right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map(t => (
                    <TriggerRow key={t._id} t={t}
                      onUndo={onUndo} onOverride={onOverride} onCancel={onCancel}
                      undoWindowMs={undoWindowMs} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DailyView({ byDay, collapsed, setCollapsed, onUndo, onOverride, onCancel, undoWindowMs }) {
  if (!byDay.length) return (
    <div style={{ padding: 40, textAlign: "center", color: C.muted, fontStyle: "italic" }}>
      No charges yet.
    </div>
  );
  const toggle = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }));

  return (
    <div>
      {byDay.map(group => {
        const open = !collapsed[`day-${group.dateKey}`];
        return (
          <div key={group.dateKey} style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, marginBottom: 12, overflow: "hidden",
          }}>
            <button onClick={() => toggle(`day-${group.dateKey}`)} style={{
              width: "100%", padding: "12px 16px",
              background: group.dayN === 1 ? "#eff6ff" : "#f8fafc",
              border: "none", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 10,
              borderBottom: open ? `1px solid ${C.border}` : "none",
            }}>
              <div style={{
                background: C.primary, color: "#fff",
                width: 44, height: 32, borderRadius: 6,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 800,
              }}>
                D{group.dayN}
              </div>
              <div>
                <div style={{ fontWeight: 800, color: C.dark, fontSize: 13 }}>
                  Day {group.dayN} · {fmtDate(group.dateKey)}
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{group.count} charge{group.count > 1 ? "s" : ""}</div>
              </div>
              <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: 15, color: C.dark, fontFamily: "'DM Mono', monospace" }}>
                {inr(group.total)}
              </span>
              <i className="pi pi-chevron-down" style={{ marginLeft: 10, fontSize: 11, color: C.muted, transform: open ? "rotate(0)" : "rotate(-90deg)", transition: "transform .15s" }} />
            </button>
            {open && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
                    <th style={th(60)}>Cat</th>
                    <th style={th()}>Service</th>
                    <th style={th(50, "center")}>Qty</th>
                    <th style={th(90, "right")}>Rate</th>
                    <th style={th(100, "right")}>Total</th>
                    <th style={th(110, "center")}>Status</th>
                    <th style={th(110, "right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map(t => (
                    <TriggerRow key={t._id} t={t}
                      onUndo={onUndo} onOverride={onOverride} onCancel={onCancel}
                      undoWindowMs={undoWindowMs} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AuditView({ triggers }) {
  if (!triggers.length) return (
    <div style={{ padding: 40, textAlign: "center", color: C.muted, fontStyle: "italic" }}>
      No audit entries.
    </div>
  );
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f8fafc", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
            <th style={th(150)}>When</th>
            <th style={th()}>Event</th>
            <th style={th(110, "center")}>Status</th>
            <th style={th(100, "right")}>Amount</th>
            <th style={th(160)}>Actor</th>
          </tr>
        </thead>
        <tbody>
          {triggers.map(t => (
            <React.Fragment key={t._id}>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 10px", verticalAlign: "top", fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>
                  {fmtDateTime(t.createdAt)}
                </td>
                <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <CategoryBadge code={t.serviceCode} />
                    <span style={{ fontWeight: 700, fontSize: 12, color: C.dark }}>{t.serviceName || t.serviceCode}</span>
                  </div>
                  {t.orderDetails && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{t.orderDetails}</div>}
                </td>
                <td style={{ padding: "8px 10px", verticalAlign: "top", textAlign: "center" }}>
                  <StatusPill status={t.status} />
                </td>
                <td style={{ padding: "8px 10px", verticalAlign: "top", textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 12 }}>
                  {inr(t.totalAmount)}
                </td>
                <td style={{ padding: "8px 10px", verticalAlign: "top", fontSize: 10.5, color: C.muted }}>
                  {t.orderedBy} ({t.orderedByRole})
                  {t.billedAt && <div style={{ fontSize: 9 }}>Billed: {fmtDateTime(t.billedAt)}</div>}
                </td>
              </tr>
              {/* Override history rows */}
              {(t.overrideHistory || []).map((h, i) => (
                <tr key={i} style={{ background: "#fffbeb", borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "6px 10px 6px 30px", fontSize: 10, color: C.warn }}>↪ override · {fmtDateTime(h.changedAt)}</td>
                  <td style={{ padding: "6px 10px", fontSize: 10.5, color: C.dark }} colSpan={3}>
                    <strong>Override:</strong> {JSON.stringify(h.oldValue)} → {JSON.stringify(h.newValue)} — <em>{h.reason}</em>
                  </td>
                  <td style={{ padding: "6px 10px", fontSize: 10, color: C.muted }}>
                    {h.changedBy} ({h.changedByRole})
                  </td>
                </tr>
              ))}
              {/* Void / cancel row */}
              {t.voidedAt && (
                <tr style={{ background: "#fef2f2", borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "6px 10px 6px 30px", fontSize: 10, color: C.danger }}>↪ {t.status === "cancelled" ? "cancel" : "void"} · {fmtDateTime(t.voidedAt)}</td>
                  <td style={{ padding: "6px 10px", fontSize: 10.5, color: C.dark }} colSpan={3}>
                    <strong>{t.status === "cancelled" ? "Cancelled" : "Voided"}:</strong> <em>{t.voidReason}</em>
                  </td>
                  <td style={{ padding: "6px 10px", fontSize: 10, color: C.muted }}>
                    {t.voidedBy} ({t.voidedByRole})
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th = (w, align = "left") => ({
  padding: "8px 10px",
  width: w || undefined,
  textAlign: align,
  fontWeight: 700,
  borderBottom: `1px solid ${C.border}`,
});
