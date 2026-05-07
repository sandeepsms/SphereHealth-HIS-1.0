/**
 * TreatmentChart.jsx — NABH-Compliant Shared Treatment Chart
 *
 * Displays and manages:
 *   • Medication Administration Record (MAR) — NABH MOM.3
 *   • Infusion Order & Monitoring Sheet — NABH MOM.2
 *   • High Alert Medication (HAM) flagging — NABH MOM.9
 *   • Nursing actions: Given / Hold / Not Available / Delayed / Partial / Refused
 *   • Infusion: Rate change / Hold / Stop / Monitoring entry
 *   • 5 Rights verification before every administration
 *   • Two-nurse sign-off for HAMs
 *
 * Used in both NursingNotes and DoctorNotesPage (read-only mode for doctors)
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

/* ────────────────────────────────────────────────────
   NABH High Alert Medications (HAM) detection
───────────────────────────────────────────────────── */
const HAM_KW = [
  "insulin","heparin","enoxaparin","warfarin","digoxin","amiodarone",
  "kcl","potassium chloride","magnesium sulphate","mgso4","calcium chloride",
  "dextrose 25%","dextrose 50%","hypertonic saline","nacl 3%",
  "morphine","fentanyl","pethidine","tramadol iv",
  "noradrenaline","norepinephrine","adrenaline","epinephrine",
  "dopamine","dobutamine","vasopressin","milrinone",
  "suxamethonium","succinylcholine","vecuronium","rocuronium","atracurium",
  "streptokinase","alteplase","tenecteplase",
  "methotrexate","cyclophosphamide","cisplatin","vincristine",
  "oxytocin","nitroprusside","ketamine","propofol","midazolam iv",
  "phenytoin iv","vancomycin iv","gentamicin iv","amikacin iv",
];
const isHAM = (name = "") => HAM_KW.some(k => name.toLowerCase().includes(k));

/* ── Frequency → scheduled times ── */
const FREQ_TIMES = {
  "OD":         ["08:00"],
  "BD":         ["08:00","20:00"],
  "TDS":        ["08:00","14:00","20:00"],
  "QID":        ["06:00","12:00","18:00","00:00"],
  "Q4H":        ["06:00","10:00","14:00","18:00","22:00","02:00"],
  "Q6H":        ["06:00","12:00","18:00","00:00"],
  "Q8H":        ["06:00","14:00","22:00"],
  "Q12H":       ["08:00","20:00"],
  "STAT":       ["Immediate"],
  "SOS":        ["As Needed"],
  "HS":         ["22:00"],
  "Before Food":["Before Meals"],
  "After Food": ["After Meals"],
  "Weekly":     ["Once Weekly"],
  "Continuous": ["Continuous"],
};

/* ── Dose status config ── */
const STATUS_CFG = {
  pending:       { label: "Pending",       icon: "⏳", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  given:         { label: "Given ✓",       icon: "✅", color: "#15803d", bg: "#dcfce7", border: "#86efac" },
  hold:          { label: "Hold ⏸",        icon: "⏸", color: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd" },
  not_available: { label: "Not Available", icon: "📦", color: "#7c3aed", bg: "#f5f3ff", border: "#c4b5fd" },
  delayed:       { label: "Delayed ⏰",    icon: "⏰", color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" },
  skipped:       { label: "Skipped",       icon: "⏭", color: "#64748b", bg: "#f1f5f9", border: "#e2e8f0" },
  refused:       { label: "Refused ✗",     icon: "✗",  color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  partial:       { label: "Partial",       icon: "◑",  color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
};

const HOLD_REASONS    = ["Patient afebrile — not required","Patient NPO","Haemodynamic instability","Patient refused","Doctor order — hold","Drug interaction concern","Pre-procedure hold","Renal/hepatic adjustment","Other"];
const NA_REASONS      = ["Out of stock — pharmacy indent placed","Sent to pharmacy — not returned","Not supplied by pharmacy","Substitute ordered","Drug unavailable — doctor informed","Other"];
const DELAY_REASONS   = ["Patient was away for procedure","IV access not available","Patient asleep — SOS/PRN","Pharmacy delay","Nursing workload — given ASAP","Other"];
const RATE_REASONS    = ["Clinical condition change","Doctor order","Haemodynamic instability — MAP dropped","Fluid overload","Renal impairment — rate reduced","Hypotension","Hypertension","Titration protocol","Patient complaint","Extravasation — site changed","Infusion almost complete","Pump malfunction","Other"];
const SITE_CONDITIONS = ["Patent","Swollen (oedema)","Leaking","Phlebitis","Changed — new site","Infiltration"];
const INF_ACTIONS     = ["No Change","Rate Increased","Rate Decreased","Infusion Stopped","Infusion Restarted","Site Changed","Doctor Informed","Pump Alarm Resolved"];
const STOP_INF_REASONS = [
  "Total volume infused — course complete",
  "Doctor order — discontinue infusion",
  "Adverse reaction observed",
  "Extravasation / site infiltration",
  "IV access lost — not being re-sited",
  "Haemodynamic instability — doctor reviewing",
  "Patient to procedure / theatre",
  "Patient discharge",
  "Drug unavailable",
  "Patient request",
  "Other",
];
const HOLD_INF_REASONS = [
  "Patient NPO — pre-procedure",
  "IV access lost — new site being prepared",
  "Haemodynamic instability — doctor informed",
  "Fluid overload — rate adjustment pending",
  "Doctor order — hold temporarily",
  "Patient to procedure — will restart after",
  "Pump malfunction — maintenance called",
  "Drug interaction concern",
  "Patient request",
  "Other",
];

/* ── Design tokens ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#1e40af", primaryL: "#eff6ff", primaryMid: "#2563eb",
  green: "#15803d", greenL: "#dcfce7", greenB: "#86efac",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#dbeafe", blueB: "#93c5fd",
  purple: "#7c3aed", purpleL: "#f5f3ff", purpleB: "#c4b5fd",
  teal: "#0d9488", tealL: "#f0fdfa", tealB: "#99f6e4",
  orange: "#ea580c", orangeL: "#fff7ed",
  slate: "#1e293b",
};

const fld = { padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: C.text, outline: "none", background: "white", width: "100%", boxSizing: "border-box" };
const sel = { ...fld, cursor: "pointer" };
const ta  = { ...fld, resize: "vertical", minHeight: 56 };
const lbl = { display: "block", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4 };

function FL({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function TreatmentChart({ UHID, visitId, patientName, nurseMode = true, refreshTrigger = 0, onAdminSave }) {
  const { user } = useAuth();
  const nurseName = user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Nurse";

  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [activeTab,   setActiveTab]   = useState("medications"); // "medications" | "infusions"
  const [actionModal, setActionModal] = useState(null);          // { order, type, doseIndex }
  const [saving,        setSaving]        = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const autoTimer = useRef(null);

  /* ── Form state for action modals ── */
  const [adminForm, setAdminForm] = useState({
    status: "given", givenAt: "", doseGiven: "", routeUsed: "", siteUsed: "", notes: "",
    verifiedBy: "", fiveRights: { patient: false, drug: false, dose: false, route: false, time: false },
    holdReason: "", holdReasonCustom: "", holdUntil: "",
    delayedTo: "", delayReason: "", delayReasonCustom: "",
    prnEffect: "", prnReassessTime: "",
    adverseEvent: false, adverseDetails: "",
  });
  const [rateForm, setRateForm] = useState({
    newRate: "", reason: "Doctor order", reasonDetail: "", verifiedBy: "", doctorInformed: false, doctorName: "",
  });
  const [monitorForm, setMonitorForm] = useState({
    currentRate: "", bp: "", pulse: "", spo2: "", urineOutput: "", volumeInfused: "", siteCondition: "", action: "No Change", remarks: "",
  });

  /* ── Doctor action state ── */
  const [docModal,  setDocModal]  = useState(null);   // { order, type }
  const [docSaving, setDocSaving] = useState(false);
  const [docForm,   setDocForm]   = useState({
    reason: "", reasonDetail: "", holdUntil: "",
    newDose: "", newRoute: "", newFrequency: "", newDuration: "", newRate: "", newNotes: "",
    subName: "", subDose: "", subRoute: "", subFreq: "", subDuration: "", subIndication: "", subNotes: "",
  });

  /* ── Infusion Stop / Hold modal (replaces window.prompt) ── */
  const [infModal,  setInfModal]  = useState(null);   // { order, type: "stop"|"hold" }
  const [infSaving, setInfSaving] = useState(false);
  const [infForm,   setInfForm]   = useState({
    reason: "", reasonCustom: "", holdUntil: "", notes: "",
  });

  /* ── Fetch ── */
  const fetchOrders = useCallback(async (silent = false) => {
    if (!UHID) return;
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const url = visitId
        ? `${API_ENDPOINTS.DOCTOR_ORDERS}?UHID=${UHID}&visitId=${visitId}`
        : `${API_ENDPOINTS.DOCTOR_ORDERS}?UHID=${UHID}`;
      const { data } = await axios.get(url);
      const arr = Array.isArray(data) ? data : (data.data || []);
      setOrders(arr.filter(o => !["Cancelled"].includes(o.status)));
    } catch { /* silent */ }
    finally { silent ? setRefreshing(false) : setLoading(false); setLastRefreshed(new Date()); }
  }, [UHID, visitId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders, refreshTrigger]);

  /* Auto-refresh every 30s */
  useEffect(() => {
    autoTimer.current = setInterval(() => fetchOrders(true), 30000);
    return () => clearInterval(autoTimer.current);
  }, [fetchOrders]);

  /* Escape key closes any open modal */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setActionModal(null);
      setDocModal(null);
      setInfModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* ── Open action modal ── */
  const openAction = (order, type, doseEntry = null) => {
    // Lock: nurse cannot undo a "given" dose — requires doctor action
    if (doseEntry?.status === "given" && nurseMode) {
      toast.warn("🔒 This dose is already marked Given. Only a doctor can undo this action.", { autoClose: 4000 });
      return;
    }
    setActionModal({ order, type, doseEntry });
    const now = new Date().toTimeString().slice(0, 5);
    setAdminForm({
      status: "given", givenAt: now, doseGiven: order.orderDetails?.dose || "", routeUsed: order.orderDetails?.route || "", siteUsed: "", notes: "",
      verifiedBy: "", fiveRights: { patient: false, drug: false, dose: false, route: false, time: false },
      holdReason: "", holdReasonCustom: "", holdUntil: "",
      delayedTo: "", delayReason: "", delayReasonCustom: "",
      prnEffect: "", prnReassessTime: "",
      adverseEvent: false, adverseDetails: "",
    });
    setRateForm({ newRate: order.currentRate || order.orderDetails?.rate || "", reason: "Doctor order", reasonDetail: "", verifiedBy: "", doctorInformed: false, doctorName: "" });
    setMonitorForm({ currentRate: order.currentRate || "", bp: "", pulse: "", spo2: "", urineOutput: "", volumeInfused: "", siteCondition: "", action: "No Change", remarks: "" });
  };

  /* ── Administer medication ── */
  const submitAdminister = async () => {
    if (!actionModal) return;
    const { order, doseEntry } = actionModal;
    const f = adminForm;
    const sched = doseEntry?.scheduledTime || "";

    // 5 Rights validation for "given"
    if (f.status === "given") {
      const allRights = Object.values(f.fiveRights).every(Boolean);
      if (!allRights) { toast.error("All 5 Rights must be verified before marking as Given"); return; }
    }
    // HAM 2-nurse check
    if (order.twoNurseRequired && f.status === "given" && !f.verifiedBy.trim()) {
      toast.error("High Alert Medication — second nurse verification required (Verified By field)"); return;
    }
    if (!sched) { toast.error("Cannot determine scheduled time"); return; }

    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/administer`, {
        scheduledTime: sched,
        status: f.status,
        givenAt: f.status === "given" ? `${new Date().toISOString().split("T")[0]}T${f.givenAt}` : undefined,
        givenBy: nurseName,
        doseGiven: f.doseGiven,
        routeUsed: f.routeUsed,
        siteUsed: f.siteUsed,
        notes: f.notes,
        verifiedBy: f.verifiedBy || undefined,
        fiveRightsChecked: f.status === "given" ? Object.values(f.fiveRights).every(Boolean) : false,
        holdReason: f.holdReason === "Other" ? f.holdReasonCustom : f.holdReason,
        holdUntil: f.holdUntil,
        delayedTo: f.delayedTo,
        delayReason: f.delayReason === "Other" ? f.delayReasonCustom : f.delayReason,
        prnEffect: f.prnEffect,
        prnReassessTime: f.prnReassessTime,
        adverseEvent: f.adverseEvent,
        adverseDetails: f.adverseDetails,
      });
      const statusLabel = STATUS_CFG[f.status]?.label || f.status;
      toast.success(`${order.orderDetails?.medicineName || "Medication"} — ${statusLabel}`);
      setActionModal(null);
      onAdminSave?.();        // signal NurseOrdersPanel to refresh
      await fetchOrders(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Action failed");
    } finally { setSaving(false); }
  };

  /* ── Rate change ── */
  const submitRateChange = async () => {
    if (!actionModal) return;
    const { order } = actionModal;
    if (!rateForm.newRate.trim()) { toast.error("Enter new rate"); return; }
    if (order.twoNurseRequired && !rateForm.verifiedBy.trim()) {
      toast.error("HAM infusion — second nurse verification required"); return;
    }
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/infusion-rate`, {
        changedBy: nurseName,
        oldRate: order.currentRate || order.orderDetails?.rate,
        newRate: rateForm.newRate,
        reason: rateForm.reason,
        reasonDetail: rateForm.reasonDetail,
        verifiedBy: rateForm.verifiedBy || undefined,
        doctorInformed: rateForm.doctorInformed,
        doctorName: rateForm.doctorName,
      });
      toast.success(`Rate updated to ${rateForm.newRate} ml/hr`);
      setActionModal(null);
      await fetchOrders(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Rate change failed");
    } finally { setSaving(false); }
  };

  /* ── Add monitoring entry ── */
  const submitMonitoring = async () => {
    if (!actionModal) return;
    const { order } = actionModal;
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/infusion-monitor`, {
        nurse: nurseName,
        ...monitorForm,
      });
      toast.success("Monitoring entry added");
      setActionModal(null);
      await fetchOrders(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Monitoring entry failed");
    } finally { setSaving(false); }
  };

  /* ── Stop infusion — opens styled modal (replaces window.prompt) ── */
  const stopInfusion = (order) => {
    setInfModal({ order, type: "stop" });
    setInfForm({ reason: "", reasonCustom: "", holdUntil: "", notes: "" });
  };

  /* ── Hold infusion — opens styled modal (replaces window.prompt) ── */
  const holdInfusion = (order) => {
    setInfModal({ order, type: "hold" });
    setInfForm({ reason: "", reasonCustom: "", holdUntil: "", notes: "" });
  };

  /* ── Submit stop / hold infusion ── */
  const submitInfAction = async () => {
    if (!infModal) return;
    const { order, type } = infModal;
    const f = infForm;
    const finalReason = f.reason === "Other" ? f.reasonCustom.trim() : f.reason;
    if (!finalReason) { toast.error("Reason is required for NABH documentation"); return; }

    setInfSaving(true);
    try {
      if (type === "stop") {
        await axios.patch(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}`, {
          status: "Stopped",
          stopReason: finalReason,
          infusionStopped: new Date().toISOString(),
          nurseNotes: f.notes || undefined,
        });
        toast.success("Infusion stopped & documented");
      } else {
        await axios.patch(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}`, {
          status: "Held",
          nurseNotes: `Held: ${finalReason}${f.holdUntil ? ` until ${f.holdUntil}` : ""} — ${nurseName} @ ${new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}${f.notes ? ` | ${f.notes}` : ""}`,
        });
        toast.success("Infusion held & documented");
      }
      setInfModal(null);
      await fetchOrders(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Action failed");
    } finally { setInfSaving(false); }
  };

  /* ── Restart infusion ── */
  const restartInfusion = async (order) => {
    try {
      await axios.patch(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}`, { status: "InProgress" });
      toast.success("Infusion restarted");
      await fetchOrders(true);
    } catch { toast.error("Failed"); }
  };

  /* ═══════════════════════════════════════
     DOCTOR ACTIONS
  ═══════════════════════════════════════ */
  const openDocAction = (order, type) => {
    setDocModal({ order, type });
    setDocForm({
      reason: "", reasonDetail: "", holdUntil: "",
      newDose:      order.orderDetails?.dose      || "",
      newRoute:     order.orderDetails?.route     || "",
      newFrequency: order.orderDetails?.frequency || "",
      newDuration:  order.orderDetails?.duration  || "",
      newRate:      order.currentRate || order.orderDetails?.rate || "",
      newNotes:     order.orderDetails?.notes     || "",
      subName: "", subDose: "", subRoute: "PO", subFreq: "BD", subDuration: "", subIndication: "", subNotes: "",
    });
  };

  const submitDocAction = async (type) => {
    if (!docModal) return;
    const { order } = docModal;
    const f = docForm;
    const docName = nurseName; // from auth context

    if ((type === "stop" || type === "hold") && !f.reason.trim()) {
      toast.error("Reason is required"); return;
    }
    if (type === "modify" && !f.reason.trim()) {
      toast.error("Please state the reason for modification"); return;
    }
    if (type === "substitute" && !f.subName.trim()) {
      toast.error("Enter the substitute drug name"); return;
    }
    if (type === "rate" && !f.newRate.trim()) {
      toast.error("Enter the new infusion rate"); return;
    }

    setDocSaving(true);
    try {
      if (type === "rate") {
        // Doctor infusion rate change — uses existing infusion-rate endpoint
        await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/infusion-rate`, {
          changedBy: docName,
          oldRate: order.currentRate || order.orderDetails?.rate,
          newRate: f.newRate,
          reason: "Doctor order",
          reasonDetail: f.reason,
          doctorInformed: true,
          doctorName: docName,
        });
        toast.success(`Rate changed to ${f.newRate} ml/hr`);
      } else if (type === "modify") {
        await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/doctor-action`, {
          type: "modify",
          doneBy: docName,
          reason: f.reason,
          reasonDetail: f.reasonDetail,
          orderDetails: {
            dose: f.newDose, route: f.newRoute, frequency: f.newFrequency,
            duration: f.newDuration, notes: f.newNotes,
            ...(f.newRate ? { rate: f.newRate } : {}),
          },
        });
        toast.success("Order modified & audit logged");
      } else if (type === "substitute") {
        await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/doctor-action`, {
          type: "substitute",
          doneBy: docName,
          reason: f.reason || `Substituted with ${f.subName}`,
          substituteWith: {
            medicineName: f.subName, dose: f.subDose, route: f.subRoute,
            frequency: f.subFreq, duration: f.subDuration,
            indication: f.subIndication, notes: f.subNotes,
          },
        });
        toast.success(`${order.orderDetails?.medicineName} → ${f.subName} substitution done`);
      } else {
        await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/doctor-action`, {
          type,
          doneBy: docName,
          reason: f.reason,
          reasonDetail: f.reasonDetail,
          holdUntil: f.holdUntil,
        });
        const msgs = { stop: "Order discontinued", hold: "Order held", resume: "Order resumed" };
        toast.success(msgs[type] || "Done");
      }

      setDocModal(null);
      await fetchOrders(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Action failed");
    } finally { setDocSaving(false); }
  };

  /* ── Derived lists ── */
  const medOrders    = orders.filter(o => o.orderType === "Medication");
  const infOrders    = orders.filter(o => ["IV_Fluid","BloodTransfusion"].includes(o.orderType));
  // New Orders = Pending (not yet touched by nurse), sorted STAT first
  const newMedOrders = medOrders.filter(o => o.status === "Pending")
    .sort((a, b) => (a.priority === "STAT" ? -1 : b.priority === "STAT" ? 1 : 0));
  const newInfOrders = infOrders.filter(o => o.status === "Pending")
    .sort((a, b) => (a.priority === "STAT" ? -1 : b.priority === "STAT" ? 1 : 0));

  const timeNow = new Date().toTimeString().slice(0, 5); // "HH:MM"

  /* ── Helper: get today's admin record for a time ── */
  const getTodayRecord = (order, time) => {
    const todayStr = new Date().toDateString();
    return order.administrationRecord?.find(r => {
      if (r.scheduledTime !== time) return false;
      // Primary: scheduledDate is today (set correctly by backend)
      if (r.scheduledDate && new Date(r.scheduledDate).toDateString() === todayStr) return true;
      // Fallback: givenAt is today — covers legacy/seeded records with stale scheduledDate
      if (r.givenAt && new Date(r.givenAt).toDateString() === todayStr) return true;
      return false;
    });
  };

  /* ── Scheduled times for an order ── */
  const getScheduledTimes = (order) => {
    // 1. Always prefer the frequency mapping — it is the source of truth
    //    (administrationRecord only contains what was documented, not what is scheduled)
    const freq = order.orderDetails?.frequency;
    if (FREQ_TIMES[freq]) return FREQ_TIMES[freq];

    // 2. Unknown / custom frequency → derive unique times from past records
    if (order.administrationRecord?.length) {
      const unique = [...new Set(order.administrationRecord.map(r => r.scheduledTime).filter(Boolean))];
      if (unique.length) return unique;
    }
    return ["—"];
  };

  /* ── Color for overdue ── */
  const isOverdue = (time) => {
    if (!time || time === "Immediate" || time === "As Needed" || time === "Continuous") return false;
    return time < timeNow;
  };

  /* ── "X min/hr/d ago" label ── */
  const timeAgo = (date) => {
    if (!date) return "";
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  /* ── Day N of total duration ── */
  const getDurationChip = (order) => {
    const raw = order.orderDetails?.duration || "";
    const match = String(raw).match(/(\d+)/);
    if (!match) return null;
    const total = parseInt(match[1]);
    const start = new Date(order.startedAt || order.createdAt || Date.now());
    const dayN  = Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
    if (dayN < 1 || total < 1) return null;
    const over   = dayN > total;
    return { dayN: Math.min(dayN, total), total, over };
  };

  /* ── Overdue dose count across all active med orders (for tab badge) ── */
  const overdueMedCount = medOrders
    .filter(o => !["Stopped","Cancelled","Completed"].includes(o.status))
    .reduce((acc, o) => {
      const times = getScheduledTimes(o);
      return acc + times.filter(t => {
        const rec = getTodayRecord(o, t);
        return (!rec || rec.status === "pending") && isOverdue(t);
      }).length;
    }, 0);

  /* ════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════ */
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 16, fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text }}>

      {/* ── Header ── */}
      <div style={{ padding: "12px 20px", background: `linear-gradient(135deg, #0f172a, ${C.primary})`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-list" style={{ fontSize: 16, color: "white" }} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: "white" }}>Treatment Chart — Live MAR</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.7)" }}>NABH MOM.2 / MOM.3 · {new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</div>
          </div>
          <span style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 5, padding: "2px 10px", fontSize: 10, fontWeight: 800, color: "#7dd3fc", letterSpacing: "1px" }}>NABH</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {lastRefreshed && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,.5)", fontFamily: "monospace" }}>
              {refreshing ? "Refreshing…" : `Updated ${timeAgo(lastRefreshed)}`}
            </span>
          )}
          {refreshing && <i className="pi pi-spin pi-spinner" style={{ fontSize: 13, color: "#7dd3fc" }} />}
          <button onClick={() => fetchOrders(true)} style={{ padding: "5px 12px", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", borderRadius: 6, color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            <i className="pi pi-refresh" style={{ marginRight: 5, fontSize: 10 }} />Refresh
          </button>
          <button onClick={() => window.print()} style={{ padding: "5px 12px", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", borderRadius: 6, color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            <i className="pi pi-print" style={{ marginRight: 5, fontSize: 10 }} />Print MAR
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
        {/* Medications tab */}
        <button onClick={() => setActiveTab("medications")}
          style={{ padding: "11px 22px", border: "none", borderBottom: activeTab === "medications" ? `3px solid ${C.blue}` : "3px solid transparent", background: "none", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: activeTab === "medications" ? 700 : 500, color: activeTab === "medications" ? C.blue : C.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, transition: "all .15s" }}>
          <i className="pi pi-tablet" style={{ fontSize: 12 }} />
          Medication MAR
          <span style={{ background: activeTab === "medications" ? C.blue : "#e2e8f0", color: activeTab === "medications" ? "white" : C.muted, padding: "1px 7px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{medOrders.length}</span>
          {overdueMedCount > 0 && (
            <span style={{ background: C.red, color: "white", padding: "1px 7px", borderRadius: 8, fontSize: 10, fontWeight: 800 }} title={`${overdueMedCount} overdue dose${overdueMedCount > 1 ? "s" : ""}`}>
              ⚠ {overdueMedCount}
            </span>
          )}
        </button>
        {/* Infusions tab */}
        <button onClick={() => setActiveTab("infusions")}
          style={{ padding: "11px 22px", border: "none", borderBottom: activeTab === "infusions" ? `3px solid ${C.teal}` : "3px solid transparent", background: "none", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: activeTab === "infusions" ? 700 : 500, color: activeTab === "infusions" ? C.teal : C.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, transition: "all .15s" }}>
          <i className="pi pi-plus-circle" style={{ fontSize: 12 }} />
          Infusion Orders & Monitoring
          <span style={{ background: activeTab === "infusions" ? C.teal : "#e2e8f0", color: activeTab === "infusions" ? "white" : C.muted, padding: "1px 7px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{infOrders.length}</span>
          {newInfOrders.length > 0 && (
            <span style={{ background: C.amber, color: "white", padding: "1px 7px", borderRadius: 8, fontSize: 10, fontWeight: 800 }} title={`${newInfOrders.length} pending infusion order${newInfOrders.length > 1 ? "s" : ""}`}>
              🔔 {newInfOrders.length}
            </span>
          )}
        </button>
      </div>

      {/* ── NABH Legend ── */}
      <div style={{ padding: "6px 16px", background: "#fafbff", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px" }}>Status:</span>
        {Object.entries(STATUS_CFG).map(([k, v]) => (
          <span key={k} style={{ fontSize: 10, fontWeight: 600, color: v.color, background: v.bg, border: `1px solid ${v.border}`, padding: "1px 7px", borderRadius: 4 }}>
            {v.icon} {v.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 4, padding: "1px 8px", fontSize: 10, fontWeight: 800, color: "#dc2626" }}>🔴 HAM = High Alert</span>
        <span style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 4, padding: "1px 8px", fontSize: 10, fontWeight: 700, color: "#92400e" }}>👥 2-Nurse Verify required</span>
      </div>

      <div style={{ padding: "14px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize: 24, display: "block", marginBottom: 10 }} />
            Loading treatment orders…
          </div>
        ) : !UHID ? (
          <div style={{ textAlign: "center", padding: 30, color: C.muted, fontSize: 13 }}>
            <i className="pi pi-user" style={{ fontSize: 24, display: "block", marginBottom: 10, color: "#cbd5e1" }} />
            Load a patient to view the treatment chart
          </div>
        ) : (

          /* ════════ MEDICATIONS TAB ════════ */
          activeTab === "medications" ? (
            medOrders.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: C.muted }}>
                <i className="pi pi-tablet" style={{ fontSize: 28, display: "block", marginBottom: 10, color: "#cbd5e1" }} />
                No active medication orders. Use Doctor Notes → Medication Orders to prescribe.
              </div>
            ) : (
              <>
              {/* ── New Orders Banner ── */}
              {newMedOrders.length > 0 && nurseMode && (
                <div style={{ marginBottom: 14, border: `2px solid #fca5a5`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "8px 14px", background: "#fef2f2", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ background: C.red, color: "white", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 800, letterSpacing: ".5px" }}>
                      🔔 NEW ORDERS — {newMedOrders.length}
                    </span>
                    <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>
                      Doctor has placed {newMedOrders.length} new medication order{newMedOrders.length > 1 ? "s" : ""}. Click the dose cell below to administer.
                    </span>
                  </div>
                  <div style={{ padding: "10px 14px", background: "#fff8f8", display: "flex", flexDirection: "column", gap: 6 }}>
                    {newMedOrders.map(o => {
                      const isSTAT = o.priority === "STAT";
                      return (
                        <div key={o._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: `1.5px solid ${isSTAT ? C.red : "#fca5a5"}`, borderRadius: 8, background: isSTAT ? "#fef2f2" : "white" }}>
                          {isSTAT && <span style={{ background: C.red, color: "white", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4, flexShrink: 0 }}>STAT</span>}
                          <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>{o.orderDetails?.medicineName}</span>
                          <span style={{ fontSize: 11, color: C.muted }}>{o.orderDetails?.dose} · {o.orderDetails?.route} · {o.orderDetails?.frequency}</span>
                          <span style={{ fontSize: 10, color: C.muted }}>By: {o.orderedBy || "Doctor"}</span>
                          <button
                            onClick={() => {
                              const times = getScheduledTimes(o);
                              openAction(o, "administer", { scheduledTime: times[0] });
                            }}
                            style={{ padding: "4px 12px", background: C.blue, color: "white", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                            <i className="pi pi-check" style={{ fontSize: 9, marginRight: 4 }} />Administer
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 3 }}>
                    <tr style={{ background: C.blueL }}>
                      <th style={TH}>Drug (Generic)</th>
                      <th style={TH}>Dose / Route</th>
                      <th style={TH}>Freq</th>
                      <th style={TH}>Indication</th>
                      <th style={TH}>HAM</th>
                      <th style={TH}>Status</th>
                      <th style={{ ...TH, minWidth: 460 }}>Today's Scheduled Doses & Administration</th>
                      {nurseMode && <th style={TH}>Nurse Actions</th>}
                      {!nurseMode && <th style={{ ...TH, background: "#f0f9ff", color: "#0369a1", minWidth: 160 }}>Doctor Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {medOrders.map((order, oi) => {
                      const times = getScheduledTimes(order);
                      const hamBadge = order.hamFlag || isHAM(order.orderDetails?.medicineName || "");
                      const isStopped = ["Stopped","Cancelled"].includes(order.status);
                      return (
                        <tr key={order._id} style={{ background: isStopped ? "#fef2f2" : oi % 2 === 0 ? "white" : "#fafcff", opacity: isStopped ? 0.7 : 1 }}>

                          {/* Drug name */}
                          <td style={{ ...TD, fontWeight: 700, minWidth: 160 }}>
                            {hamBadge && (
                              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 4, padding: "2px 7px", fontSize: 9, fontWeight: 800, color: C.red, marginBottom: 4, display: "inline-block" }}>
                                🔴 HAM {order.twoNurseRequired && "· 👥 2-Nurse"}
                              </div>
                            )}
                            <div style={{ color: isStopped ? C.muted : C.text }}>{order.orderDetails?.medicineName || "—"}</div>
                            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{order.orderDetails?.notes}</div>
                            {/* "Ordered X ago" + duration chip */}
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
                              {(order.createdAt || order.orderedAt) && (
                                <span style={{ fontSize: 9, color: C.muted, background: "#f1f5f9", border: `1px solid ${C.border}`, borderRadius: 3, padding: "1px 5px" }}>
                                  🕐 {timeAgo(order.createdAt || order.orderedAt)}
                                </span>
                              )}
                              {/* Duration chip — only on active orders (Overrun not meaningful for Completed) */}
                              {order.status !== "Completed" && (() => {
                                const chip = getDurationChip(order);
                                if (!chip) return null;
                                return (
                                  <span style={{ fontSize: 9, fontWeight: 700, background: chip.over ? C.redL : C.amberL, color: chip.over ? C.red : C.amber, border: `1px solid ${chip.over ? C.redB : C.amberB}`, borderRadius: 3, padding: "1px 5px" }}>
                                    Day {chip.dayN}/{chip.total}{chip.over ? " ⚠ Overrun" : ""}
                                  </span>
                                );
                              })()}
                            </div>
                          </td>

                          {/* Dose / Route */}
                          <td style={{ ...TD, minWidth: 100 }}>
                            <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.blue }}>{order.orderDetails?.dose}</span>
                            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{order.orderDetails?.route}</div>
                          </td>

                          {/* Frequency */}
                          <td style={{ ...TD }}>
                            <span style={{ fontWeight: 700, color: C.slate }}>{order.orderDetails?.frequency}</span>
                          </td>

                          {/* Indication */}
                          <td style={{ ...TD, maxWidth: 160, fontSize: 11, color: C.muted }}>{order.orderDetails?.indication || "—"}</td>

                          {/* HAM badge */}
                          <td style={{ ...TD, textAlign: "center" }}>
                            {hamBadge
                              ? <span style={{ fontSize: 16 }}>🔴</span>
                              : <span style={{ fontSize: 14, color: "#d1d5db" }}>—</span>}
                          </td>

                          {/* Order status */}
                          <td style={{ ...TD }}>
                            <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: isStopped ? C.redL : order.status === "Completed" ? C.greenL : order.status === "InProgress" ? C.blueL : C.amberL, color: isStopped ? C.red : order.status === "Completed" ? C.green : order.status === "InProgress" ? C.blue : C.amber }}>
                              {order.status}
                            </span>
                            {order.priority === "STAT" && (
                              <div style={{ marginTop: 3, background: C.redL, color: C.red, borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 800, display: "inline-block" }}>STAT</div>
                            )}
                          </td>

                          {/* Dose cells */}
                          <td style={{ ...TD, minWidth: 460 }}>
                            {order.status === "Completed" ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: C.green, background: C.greenL, border: `1px solid ${C.greenB}`, borderRadius: 6, padding: "4px 10px", display: "inline-block" }}>
                                ✅ Course completed — no new doses
                              </span>
                            ) : (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {times.map(t => {
                                const rec = getTodayRecord(order, t);
                                const st  = rec?.status || "pending";
                                const cfg = STATUS_CFG[st] || STATUS_CFG.pending;
                                const overdue = !rec?.givenAt && st === "pending" && isOverdue(t);
                                return (
                                  <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: overdue ? C.red : C.muted, fontFamily: "monospace" }}>{t}</div>
                                    <div
                                      onClick={() => nurseMode && !isStopped && openAction(order, "administer", rec || { scheduledTime: t })}
                                      style={{ padding: "4px 8px", borderRadius: 6, border: `1.5px solid ${rec?.adverseEvent ? C.red : overdue && st === "pending" ? C.red : cfg.border}`, background: rec?.adverseEvent ? "#fef2f2" : overdue && st === "pending" ? "#fef2f2" : cfg.bg, color: overdue && st === "pending" ? C.red : cfg.color, fontSize: 10, fontWeight: 700, cursor: nurseMode && !isStopped ? (st === "given" ? "not-allowed" : "pointer") : "default", textAlign: "center", minWidth: 64, transition: "all .15s" }}
                                      title={st === "given" ? `🔒 Given by ${rec?.givenBy || "Nurse"} — Doctor approval required to undo` : (rec?.notes || rec?.holdReason || rec?.delayReason || "")}
                                    >
                                      <div>{cfg.icon} {cfg.label}</div>
                                      {st === "given" && <div style={{ fontSize: 8, color: C.green }}>🔒 Locked</div>}
                                      {rec?.givenAt && <div style={{ fontSize: 9, fontWeight: 400, marginTop: 1 }}>{new Date(rec.givenAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>}
                                      {rec?.givenBy && <div style={{ fontSize: 8, color: cfg.color + "cc" }}>{rec.givenBy.split(" ").slice(-1)[0]}</div>}
                                      {rec?.verifiedBy && <div style={{ fontSize: 8, color: C.green }}>👥 {rec.verifiedBy.split(" ").slice(-1)[0]}</div>}
                                      {overdue && st === "pending" && <div style={{ fontSize: 8, fontWeight: 800, color: C.red }}>OVERDUE</div>}
                                      {/* ADR flag */}
                                      {rec?.adverseEvent && <div style={{ fontSize: 8, fontWeight: 800, color: C.red, marginTop: 1 }}>⚠ ADR</div>}
                                      {/* PRN effectiveness */}
                                      {rec?.prnEffect && (
                                        <div style={{ fontSize: 8, fontWeight: 700, color: rec.prnEffect === "effective" ? C.green : rec.prnEffect === "partial" ? C.amber : C.red, marginTop: 1 }}>
                                          {rec.prnEffect === "effective" ? "✓ Effective" : rec.prnEffect === "partial" ? "◑ Partial" : "✗ No effect"}
                                        </div>
                                      )}
                                    </div>
                                    {rec?.holdReason && <div style={{ fontSize: 8, color: C.blue, maxWidth: 72, textAlign: "center", lineHeight: 1.2 }}>{rec.holdReason.slice(0,30)}</div>}
                                    {rec?.delayedTo && <div style={{ fontSize: 8, color: C.orange }}>→ {rec.delayedTo}</div>}
                                    {rec?.adverseEvent && (
                                      <div style={{ fontSize: 8, color: C.red, maxWidth: 72, textAlign: "center", lineHeight: 1.2, fontWeight: 700 }}>ADR reported</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            )}
                          </td>

                          {/* Nurse actions */}
                          {nurseMode && (
                            <td style={{ ...TD }}>
                              {!isStopped && order.status !== "Completed" && (
                                <button
                                  onClick={() => openAction(order, "administer", order.administrationRecord?.find(r => r.status === "pending") || { scheduledTime: times[0] })}
                                  style={{ padding: "4px 10px", background: C.blue, color: "white", border: "none", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                                  <i className="pi pi-check" style={{ fontSize: 9 }} />Administer
                                </button>
                              )}
                              {order.status === "Completed" && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: C.green }}>✅ Done</span>
                              )}
                            </td>
                          )}

                          {/* Doctor actions */}
                          {!nurseMode && (
                            <td style={{ ...TD, background: "#f8fbff" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {isStopped ? (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: C.red }}>⏹ Discontinued</span>
                                ) : order.status === "Completed" ? (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: C.green }}>✅ Completed</span>
                                ) : (
                                  <>
                                    <button onClick={() => openDocAction(order, "modify")}
                                      style={{ ...DOCBTN, background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe" }}>
                                      <i className="pi pi-pencil" style={{ fontSize: 9 }} /> Modify
                                    </button>
                                    {order.status === "OnHold" ? (
                                      <button onClick={() => openDocAction(order, "resume")}
                                        style={{ ...DOCBTN, background: C.greenL, color: C.green, border: `1.5px solid ${C.greenB}` }}>
                                        <i className="pi pi-play" style={{ fontSize: 9 }} /> Resume
                                      </button>
                                    ) : (
                                      <button onClick={() => openDocAction(order, "hold")}
                                        style={{ ...DOCBTN, background: C.amberL, color: C.amber, border: `1.5px solid ${C.amberB}` }}>
                                        <i className="pi pi-pause" style={{ fontSize: 9 }} /> Hold
                                      </button>
                                    )}
                                    <button onClick={() => openDocAction(order, "substitute")}
                                      style={{ ...DOCBTN, background: "#f5f3ff", color: "#7c3aed", border: "1.5px solid #c4b5fd" }}>
                                      <i className="pi pi-refresh" style={{ fontSize: 9 }} /> Substitute
                                    </button>
                                    <button onClick={() => openDocAction(order, "stop")}
                                      style={{ ...DOCBTN, background: C.redL, color: C.red, border: `1.5px solid ${C.redB}` }}>
                                      <i className="pi pi-times-circle" style={{ fontSize: 9 }} /> Discontinue
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )

          /* ════════ INFUSIONS TAB ════════ */
          ) : (
            infOrders.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: C.muted }}>
                <i className="pi pi-plus-circle" style={{ fontSize: 28, display: "block", marginBottom: 10, color: "#cbd5e1" }} />
                No active infusion orders. Use Doctor Notes → Infusion Orders to prescribe.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* ── New/Pending Infusion Orders Banner ── */}
                {newInfOrders.length > 0 && nurseMode && (
                  <div style={{ border: `2px solid #fca5a5`, borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ padding: "8px 14px", background: "#fef2f2", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ background: C.red, color: "white", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 800, letterSpacing: ".5px" }}>
                        🔔 NEW INFUSION ORDERS — {newInfOrders.length}
                      </span>
                      <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>
                        Doctor has placed {newInfOrders.length} new infusion order{newInfOrders.length > 1 ? "s" : ""} not yet started.
                      </span>
                    </div>
                    <div style={{ padding: "10px 14px", background: "#fff8f8", display: "flex", flexDirection: "column", gap: 6 }}>
                      {newInfOrders.map(o => {
                        const isSTAT = o.priority === "STAT";
                        return (
                          <div key={o._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: `1.5px solid ${isSTAT ? C.red : "#fca5a5"}`, borderRadius: 8, background: isSTAT ? "#fef2f2" : "white" }}>
                            {isSTAT && <span style={{ background: C.red, color: "white", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4, flexShrink: 0 }}>STAT</span>}
                            <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>{o.orderDetails?.displayName || o.orderDetails?.medicineName}</span>
                            <span style={{ fontSize: 11, color: C.muted }}>{o.orderDetails?.totalVolume && `${o.orderDetails.totalVolume}ml`} · {o.orderDetails?.rate && `${o.orderDetails.rate} ml/hr`}</span>
                            <span style={{ fontSize: 10, color: C.muted }}>By: {o.orderedBy || "Doctor"}</span>
                            <button
                              onClick={() => openAction(o, "rate-change")}
                              style={{ padding: "4px 12px", background: C.teal, color: "white", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                              <i className="pi pi-play" style={{ fontSize: 9, marginRight: 4 }} />Start Infusion
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {infOrders.map(order => {
                  const hamBadge = order.hamFlag || isHAM(order.orderDetails?.medicineName || "");
                  const isStopped = ["Stopped","Cancelled"].includes(order.status);
                  const isHeld    = order.status === "Held";
                  const lastMon   = order.infusionMonitoring?.slice(-1)[0];
                  const lastCheck = lastMon ? new Date(lastMon.time) : null;
                  const minutesSinceCheck = lastCheck ? Math.floor((Date.now() - lastCheck.getTime()) / 60000) : null;
                  const checkOverdue = minutesSinceCheck !== null && minutesSinceCheck > (hamBadge ? 30 : 60);

                  return (
                    <div key={order._id} style={{ border: `2px solid ${hamBadge ? "#fca5a5" : isStopped ? "#e2e8f0" : C.tealB}`, borderRadius: 12, overflow: "hidden", opacity: isStopped ? 0.75 : 1 }}>
                      {/* Infusion header */}
                      <div style={{ padding: "10px 16px", background: hamBadge ? "#fef2f2" : isStopped ? "#f8fafc" : C.tealL, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {hamBadge && <span style={{ background: C.redL, color: C.red, border: `1px solid ${C.redB}`, borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>🔴 HAM · 👥 2-Nurse Rate Change</span>}
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 13, color: isStopped ? C.muted : C.slate }}>
                              {order.orderDetails?.displayName || order.orderDetails?.medicineName || "IV Infusion"}
                            </div>
                            <div style={{ fontSize: 11, color: C.muted }}>
                              {order.orderDetails?.dilution && <span>{order.orderDetails.dilution} · </span>}
                              {order.orderDetails?.totalVolume && <span>Vol: {order.orderDetails.totalVolume}ml · </span>}
                              {order.orderDetails?.titrationGoal && <span>Goal: {order.orderDetails.titrationGoal}</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          {/* Current rate badge */}
                          <div style={{ background: isStopped ? "#f1f5f9" : "#fff", border: `2px solid ${isStopped ? "#e2e8f0" : C.teal}`, borderRadius: 8, padding: "5px 14px", textAlign: "center" }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Current Rate</div>
                            <div style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 16, color: isStopped ? C.muted : C.teal }}>
                              {order.currentRate || order.orderDetails?.rate || "—"} <span style={{ fontSize: 10, fontWeight: 400 }}>ml/hr</span>
                            </div>
                          </div>
                          {/* Status */}
                          <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: isStopped ? C.redL : isHeld ? C.blueL : C.greenL, color: isStopped ? C.red : isHeld ? C.blue : C.green, border: `1px solid ${isStopped ? C.redB : isHeld ? C.blueB : C.greenB}` }}>
                            {isStopped ? "⏹ Stopped" : isHeld ? "⏸ Held" : "▶ Running"}
                          </span>
                          {/* Hold-until badge — shown when infusion is held with a scheduled resume time */}
                          {isHeld && order.holdUntil && (
                            <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: C.blueL, color: C.blue, border: `1px solid ${C.blueB}` }}>
                              ⏱ Resume: {new Date(order.holdUntil).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}
                            </span>
                          )}
                          {/* Last check badge */}
                          {minutesSinceCheck !== null && !isStopped && (
                            <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: checkOverdue ? C.redL : C.amberL, color: checkOverdue ? C.red : C.amber, border: `1px solid ${checkOverdue ? C.redB : C.amberB}` }}>
                              {checkOverdue ? "⚠ " : ""}Last check: {minutesSinceCheck}m ago
                            </span>
                          )}
                          {/* First-time monitoring prompt — no entries yet for a running infusion */}
                          {minutesSinceCheck === null && !isStopped && !isHeld && (
                            <span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: C.amberL, color: C.amber, border: `1px solid ${C.amberB}` }}>
                              ⚠ No monitoring entry yet
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Volume progress bar — shown when totalVolume is prescribed */}
                      {(() => {
                        const totalVol   = parseFloat(order.orderDetails?.totalVolume);
                        const lastEntry  = order.infusionMonitoring?.slice(-1)[0];
                        const infusedVol = parseFloat(lastEntry?.volumeInfused || 0);
                        if (!totalVol || isStopped) return null;
                        const pct = Math.min(100, Math.round((infusedVol / totalVol) * 100));
                        const almostDone = pct >= 80;
                        const barColor   = pct >= 100 ? C.green : almostDone ? C.amber : C.teal;
                        return (
                          <div style={{ padding: "6px 16px", background: "#f8fafc", borderBottom: `1px solid ${C.border}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Volume Progress</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: barColor }}>
                                {infusedVol}ml / {totalVol}ml ({pct}%)
                                {almostDone && pct < 100 && <span style={{ marginLeft: 6, color: C.amber }}> ⚠ Almost complete</span>}
                                {pct >= 100 && <span style={{ marginLeft: 6, color: C.green }}> ✓ Course complete</span>}
                              </span>
                            </div>
                            <div style={{ height: 6, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 4, transition: "width .4s ease" }} />
                            </div>
                          </div>
                        );
                      })()}

                      {/* Rate change history */}
                      {order.rateChanges?.length > 0 && (
                        <div style={{ padding: "8px 16px", background: "#f8fafc", borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>Rate Change Log</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {order.rateChanges.map((rc, i) => (
                              <div key={i} style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 10px", fontSize: 11 }}>
                                <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{rc.oldRate} → {rc.newRate}</span> ml/hr
                                <span style={{ color: C.muted, marginLeft: 6 }}>· {rc.reason}</span>
                                {rc.reasonDetail && <div style={{ fontSize: 10, color: C.muted }}>{rc.reasonDetail}</div>}
                                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>
                                  {rc.changedBy} · {new Date(rc.changedAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                                  {rc.verifiedBy && <span style={{ color: C.green }}> · 👥 {rc.verifiedBy}</span>}
                                  {rc.doctorInformed && <span style={{ color: C.teal }}> · Dr. informed</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Overdue monitoring reminder banner */}
                      {checkOverdue && !isStopped && !isHeld && nurseMode && (
                        <div style={{ padding: "8px 16px", background: "#fef2f2", borderBottom: `1px solid ${C.redB}`, display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ background: C.red, color: "white", borderRadius: 5, padding: "2px 9px", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                            ⚠ MONITORING OVERDUE
                          </span>
                          <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>
                            {hamBadge
                              ? `HAM infusion — monitoring required every 30 min. Last entry: ${minutesSinceCheck}m ago.`
                              : `Standard IV — monitoring required every 60 min. Last entry: ${minutesSinceCheck}m ago.`}
                          </span>
                          <button onClick={() => openAction(order, "monitoring")}
                            style={{ marginLeft: "auto", padding: "4px 12px", background: C.teal, color: "white", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                            <i className="pi pi-chart-bar" style={{ fontSize: 9, marginRight: 4 }} />Add Entry Now
                          </button>
                        </div>
                      )}

                      {/* Monitoring log table */}
                      {order.infusionMonitoring?.length > 0 && (
                        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>Nursing Monitoring Log</div>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead>
                                <tr style={{ background: "#f0fdfa" }}>
                                  {["Time","Nurse","Rate","BP","Pulse","SpO₂","Urine (ml/hr)","Vol Infused","Site","Action","Remarks"].map(h => (
                                    <th key={h} style={{ ...TH, background: "transparent", color: C.teal, whiteSpace: "nowrap" }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {order.infusionMonitoring.map((m, mi) => (
                                  <tr key={mi} style={{ background: mi % 2 === 0 ? "white" : "#f0fdfa" }}>
                                    <td style={{ ...TD, fontFamily: "monospace", whiteSpace: "nowrap" }}>{new Date(m.time).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</td>
                                    <td style={TD}>{m.nurse}</td>
                                    <td style={{ ...TD, fontWeight: 700, color: C.teal, fontFamily: "monospace" }}>{m.currentRate} ml/hr</td>
                                    <td style={{ ...TD, fontFamily: "monospace" }}>{m.bp || "—"}</td>
                                    <td style={{ ...TD, fontFamily: "monospace" }}>{m.pulse || "—"}</td>
                                    <td style={{ ...TD, fontFamily: "monospace" }}>{m.spo2 ? `${m.spo2}%` : "—"}</td>
                                    <td style={{ ...TD, fontFamily: "monospace" }}>{m.urineOutput || "—"}</td>
                                    <td style={{ ...TD, fontFamily: "monospace" }}>{m.volumeInfused || "—"}</td>
                                    <td style={{ TD }}>{m.siteCondition || "—"}</td>
                                    <td style={{ ...TD }}>
                                      <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: m.action === "No Change" ? "#f1f5f9" : m.action?.includes("Stop") ? C.redL : C.amberL, color: m.action === "No Change" ? C.muted : m.action?.includes("Stop") ? C.red : C.amber }}>
                                        {m.action || "—"}
                                      </span>
                                    </td>
                                    <td style={{ ...TD, maxWidth: 180, fontSize: 10 }}>{m.remarks || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Nurse action buttons */}
                      {nurseMode && (
                        <div style={{ padding: "10px 16px", background: "#f8fafc", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginRight: 4 }}>Nursing Actions:</span>
                          {!isStopped && (
                            <>
                              <button onClick={() => openAction(order, "rate-change")}
                                style={{ ...ACTBTN, background: C.blueL, color: C.blue, border: `1.5px solid ${C.blueB}` }}>
                                <i className="pi pi-arrows-v" style={{ fontSize: 10 }} /> Rate Change
                              </button>
                              <button onClick={() => openAction(order, "monitoring")}
                                style={{ ...ACTBTN, background: C.tealL, color: C.teal, border: `1.5px solid ${C.tealB}` }}>
                                <i className="pi pi-chart-bar" style={{ fontSize: 10 }} /> Add Monitoring
                              </button>
                              {isHeld ? (
                                <button onClick={() => restartInfusion(order)}
                                  style={{ ...ACTBTN, background: C.greenL, color: C.green, border: `1.5px solid ${C.greenB}` }}>
                                  <i className="pi pi-play" style={{ fontSize: 10 }} /> Restart
                                </button>
                              ) : (
                                <button onClick={() => holdInfusion(order)}
                                  style={{ ...ACTBTN, background: C.amberL, color: C.amber, border: `1.5px solid ${C.amberB}` }}>
                                  <i className="pi pi-pause" style={{ fontSize: 10 }} /> Hold
                                </button>
                              )}
                              <button onClick={() => stopInfusion(order)}
                                style={{ ...ACTBTN, background: C.redL, color: C.red, border: `1.5px solid ${C.redB}` }}>
                                <i className="pi pi-stop" style={{ fontSize: 10 }} /> Stop & Document
                              </button>
                            </>
                          )}
                          {isStopped && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>
                              ⏹ Infusion stopped: {order.stopReason || "—"}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Doctor action buttons for infusions */}
                      {!nurseMode && (
                        <div style={{ padding: "10px 16px", background: "#f0f9ff", borderTop: `1px solid #bae6fd`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: ".6px", marginRight: 4 }}>
                            <i className="pi pi-user-edit" style={{ fontSize: 10 }} /> Doctor Orders:
                          </span>
                          {isStopped ? (
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.red }}>⏹ Stopped — {order.stopReason || "—"}</span>
                          ) : (
                            <>
                              <button onClick={() => openDocAction(order, "rate")}
                                style={{ ...ACTBTN, background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe" }}>
                                <i className="pi pi-arrows-v" style={{ fontSize: 10 }} /> Change Rate
                              </button>
                              <button onClick={() => openDocAction(order, "modify")}
                                style={{ ...ACTBTN, background: "#f5f3ff", color: "#7c3aed", border: "1.5px solid #c4b5fd" }}>
                                <i className="pi pi-pencil" style={{ fontSize: 10 }} /> Modify Order
                              </button>
                              {isHeld ? (
                                <button onClick={() => openDocAction(order, "resume")}
                                  style={{ ...ACTBTN, background: C.greenL, color: C.green, border: `1.5px solid ${C.greenB}` }}>
                                  <i className="pi pi-play" style={{ fontSize: 10 }} /> Resume
                                </button>
                              ) : (
                                <button onClick={() => openDocAction(order, "hold")}
                                  style={{ ...ACTBTN, background: C.amberL, color: C.amber, border: `1.5px solid ${C.amberB}` }}>
                                  <i className="pi pi-pause" style={{ fontSize: 10 }} /> Hold Infusion
                                </button>
                              )}
                              <button onClick={() => openDocAction(order, "stop")}
                                style={{ ...ACTBTN, background: C.redL, color: C.red, border: `1.5px solid ${C.redB}` }}>
                                <i className="pi pi-times-circle" style={{ fontSize: 10 }} /> Stop & Discontinue
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )
        )}
      </div>

      {/* ══════════════════ ACTION MODALS ══════════════════ */}

      {/* ── Administer Medication Modal ── */}
      {actionModal?.type === "administer" && (() => {
        const order = actionModal.order;
        const dose  = actionModal.doseEntry;
        const ham   = order.hamFlag || isHAM(order.orderDetails?.medicineName || "");
        const f     = adminForm;
        const rights5Done = Object.values(f.fiveRights).every(Boolean);
        return (
          <ModalOverlay onClose={() => setActionModal(null)}>
            <ModalHeader title={`Administer — ${order.orderDetails?.medicineName}`} sub={`${order.orderDetails?.dose} · ${order.orderDetails?.route} · ${dose?.scheduledTime}`} color={ham ? C.red : C.primary} icon="pi-check-circle" onClose={() => setActionModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>

              {ham && (
                <div style={{ background: "#fef2f2", border: "2px solid #fca5a5", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontWeight: 800, color: C.red, fontSize: 12, marginBottom: 4 }}>🔴 HIGH ALERT MEDICATION — Extra precautions mandatory</div>
                  <div style={{ fontSize: 11, color: "#7f1d1d" }}>Double-check with a second nurse before administration. Both signatures required in the MAR.</div>
                </div>
              )}

              {/* Action selection */}
              <div>
                <div style={lbl}>Administration Status *</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {[
                    { v: "given", label: "✅ Given", color: C.green },
                    { v: "hold",  label: "⏸ Hold", color: C.blue },
                    { v: "not_available", label: "📦 Not Available", color: C.purple },
                    { v: "delayed", label: "⏰ Delayed", color: C.orange },
                    { v: "refused", label: "✗ Patient Refused", color: C.red },
                    { v: "partial", label: "◑ Partial", color: C.amber },
                  ].map(btn => (
                    <button key={btn.v} onClick={() => setAdminForm(p => ({ ...p, status: btn.v }))}
                      style={{ padding: "6px 14px", borderRadius: 7, border: `2px solid ${f.status === btn.v ? btn.color : C.border}`, background: f.status === btn.v ? btn.color + "18" : "white", color: f.status === btn.v ? btn.color : C.muted, fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5 Rights — mandatory for "given" */}
              {f.status === "given" && (
                <div style={{ background: "#f0fdf4", border: `1.5px solid ${rights5Done ? C.greenB : C.amberB}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: rights5Done ? C.green : C.amber, marginBottom: 8 }}>
                    5 Rights Check — NABH MOM.3 {rights5Done ? "✓ All Verified" : "⚠ Verify all 5 before administering"}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {[
                      { k: "patient", label: `Right Patient — ${order.patientName || "Patient confirmed"}` },
                      { k: "drug",    label: `Right Drug — ${order.orderDetails?.medicineName}` },
                      { k: "dose",    label: `Right Dose — ${order.orderDetails?.dose}` },
                      { k: "route",   label: `Right Route — ${order.orderDetails?.route}` },
                      { k: "time",    label: `Right Time — ${dose?.scheduledTime}` },
                    ].map(right => (
                      <label key={right.k} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: f.fiveRights[right.k] ? C.green : C.text, padding: "5px 8px", borderRadius: 6, background: f.fiveRights[right.k] ? "#f0fdf4" : "white", border: `1px solid ${f.fiveRights[right.k] ? C.greenB : C.border}` }}>
                        <input type="checkbox" checked={f.fiveRights[right.k]} onChange={e => setAdminForm(p => ({ ...p, fiveRights: { ...p.fiveRights, [right.k]: e.target.checked } }))} style={{ accentColor: C.green, width: 14, height: 14 }} />
                        {right.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Given fields */}
              {f.status === "given" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <FL label="Time Given *"><input type="time" style={fld} value={f.givenAt} onChange={e => setAdminForm(p => ({ ...p, givenAt: e.target.value }))} /></FL>
                  <FL label="Dose Given (if different)"><input style={fld} value={f.doseGiven} placeholder={order.orderDetails?.dose} onChange={e => setAdminForm(p => ({ ...p, doseGiven: e.target.value }))} /></FL>
                  <FL label="Route Used"><input style={fld} value={f.routeUsed} placeholder={order.orderDetails?.route} onChange={e => setAdminForm(p => ({ ...p, routeUsed: e.target.value }))} /></FL>
                  <FL label="Injection Site (if applicable)"><input style={fld} value={f.siteUsed} placeholder="e.g. Right deltoid" onChange={e => setAdminForm(p => ({ ...p, siteUsed: e.target.value }))} /></FL>
                </div>
              )}

              {/* HAM 2-nurse */}
              {f.status === "given" && ham && (
                <FL label="Second Nurse Verification * (HAM mandatory)">
                  <input style={{ ...fld, borderColor: C.red }} value={f.verifiedBy} placeholder="Name of verifying nurse" onChange={e => setAdminForm(p => ({ ...p, verifiedBy: e.target.value }))} />
                </FL>
              )}

              {/* Hold fields */}
              {f.status === "hold" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <FL label="Hold Reason *">
                    <select style={sel} value={f.holdReason} onChange={e => setAdminForm(p => ({ ...p, holdReason: e.target.value }))}>
                      <option value="">— Select reason —</option>
                      {HOLD_REASONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </FL>
                  {f.holdReason === "Other" && <FL label="Specify"><input style={fld} value={f.holdReasonCustom} onChange={e => setAdminForm(p => ({ ...p, holdReasonCustom: e.target.value }))} /></FL>}
                  <FL label="Hold Until (time)"><input type="time" style={fld} value={f.holdUntil} onChange={e => setAdminForm(p => ({ ...p, holdUntil: e.target.value }))} /></FL>
                </div>
              )}

              {/* Not Available fields */}
              {f.status === "not_available" && (
                <FL label="Reason — Not Available *">
                  <select style={sel} value={f.holdReason} onChange={e => setAdminForm(p => ({ ...p, holdReason: e.target.value }))}>
                    <option value="">— Select reason —</option>
                    {NA_REASONS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </FL>
              )}

              {/* Delayed fields */}
              {f.status === "delayed" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <FL label="Delayed To (new time) *"><input type="time" style={fld} value={f.delayedTo} onChange={e => setAdminForm(p => ({ ...p, delayedTo: e.target.value }))} /></FL>
                  <FL label="Reason *">
                    <select style={sel} value={f.delayReason} onChange={e => setAdminForm(p => ({ ...p, delayReason: e.target.value }))}>
                      <option value="">— Select reason —</option>
                      {DELAY_REASONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </FL>
                  {f.delayReason === "Other" && <FL label="Specify"><input style={fld} value={f.delayReasonCustom} onChange={e => setAdminForm(p => ({ ...p, delayReasonCustom: e.target.value }))} /></FL>}
                </div>
              )}

              {/* PRN effectiveness (for SOS orders) */}
              {order.orderDetails?.frequency === "SOS" && f.status === "given" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, background: "#fafafa", borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
                  <FL label="PRN Effectiveness (reassess at)">
                    <select style={sel} value={f.prnEffect} onChange={e => setAdminForm(p => ({ ...p, prnEffect: e.target.value }))}>
                      <option value="">— To be assessed —</option>
                      <option value="effective">Effective</option>
                      <option value="partial">Partial improvement</option>
                      <option value="no_effect">No effect</option>
                    </select>
                  </FL>
                  <FL label="Reassessment Time"><input type="time" style={fld} value={f.prnReassessTime} onChange={e => setAdminForm(p => ({ ...p, prnReassessTime: e.target.value }))} /></FL>
                </div>
              )}

              {/* Adverse event */}
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, color: f.adverseEvent ? C.red : C.muted, padding: "7px 12px", background: f.adverseEvent ? C.redL : "#f8fafc", border: `1.5px solid ${f.adverseEvent ? C.redB : C.border}`, borderRadius: 8, transition: "all .15s" }}>
                <input type="checkbox" checked={f.adverseEvent} onChange={e => setAdminForm(p => ({ ...p, adverseEvent: e.target.checked }))} style={{ accentColor: C.red, width: 14, height: 14 }} />
                <i className="pi pi-exclamation-triangle" style={{ fontSize: 12, color: C.red }} />
                Adverse Drug Reaction / Event observed — NABH QPS.5
              </label>
              {f.adverseEvent && (
                <FL label="Adverse Event Details *">
                  <textarea style={ta} value={f.adverseDetails} placeholder="Describe adverse reaction — symptoms, severity, action taken, doctor notified…" onChange={e => setAdminForm(p => ({ ...p, adverseDetails: e.target.value }))} />
                </FL>
              )}

              <FL label="Notes / Remarks">
                <textarea style={ta} value={f.notes} placeholder="Additional observations, patient response, any concerns…" onChange={e => setAdminForm(p => ({ ...p, notes: e.target.value }))} />
              </FL>
            </div>
            <ModalFooter onCancel={() => setActionModal(null)} onSave={submitAdminister} saving={saving} saveLabel="Submit to MAR" />
          </ModalOverlay>
        );
      })()}

      {/* ── Rate Change Modal ── */}
      {actionModal?.type === "rate-change" && (() => {
        const order = actionModal.order;
        const ham   = order.hamFlag;
        return (
          <ModalOverlay onClose={() => setActionModal(null)}>
            <ModalHeader title="Infusion Rate Change" sub={`${order.orderDetails?.displayName || order.orderDetails?.medicineName} · Current: ${order.currentRate || "—"} ml/hr`} color={C.teal} icon="pi-arrows-v" onClose={() => setActionModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              {ham && (
                <div style={{ background: "#fef2f2", border: "2px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: C.red, fontWeight: 700 }}>
                  🔴 HAM Infusion — Rate change requires second nurse verification + doctor informed documentation
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FL label="Current Rate (ml/hr)">
                  <div style={{ ...fld, background: "#f8fafc", color: C.muted, fontFamily: "monospace", fontWeight: 700 }}>{order.currentRate || order.orderDetails?.rate || "—"}</div>
                </FL>
                <FL label="New Rate (ml/hr) *">
                  <input type="number" style={{ ...fld, borderColor: C.teal }} value={rateForm.newRate} placeholder="Enter new rate" onChange={e => setRateForm(p => ({ ...p, newRate: e.target.value }))} autoFocus />
                </FL>
              </div>
              <FL label="Reason for Rate Change *">
                <select style={sel} value={rateForm.reason} onChange={e => setRateForm(p => ({ ...p, reason: e.target.value }))}>
                  {RATE_REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </FL>
              <FL label="Details / Clinical Note">
                <textarea style={ta} value={rateForm.reasonDetail} placeholder="Clinical basis for rate change — vitals, clinical findings, doctor's verbal order…" onChange={e => setRateForm(p => ({ ...p, reasonDetail: e.target.value }))} />
              </FL>
              {ham && (
                <FL label="Second Nurse Verification * (HAM)">
                  <input style={{ ...fld, borderColor: C.red }} value={rateForm.verifiedBy} placeholder="Name of verifying nurse" onChange={e => setRateForm(p => ({ ...p, verifiedBy: e.target.value }))} />
                </FL>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: rateForm.doctorInformed ? C.green : C.muted }}>
                <input type="checkbox" checked={rateForm.doctorInformed} onChange={e => setRateForm(p => ({ ...p, doctorInformed: e.target.checked }))} style={{ accentColor: C.green, width: 14, height: 14 }} />
                Doctor has been informed of this rate change
              </label>
              {rateForm.doctorInformed && (
                <FL label="Doctor Name"><input style={fld} value={rateForm.doctorName} placeholder="Consulting doctor name" onChange={e => setRateForm(p => ({ ...p, doctorName: e.target.value }))} /></FL>
              )}
            </div>
            <ModalFooter onCancel={() => setActionModal(null)} onSave={submitRateChange} saving={saving} saveLabel="Save Rate Change" />
          </ModalOverlay>
        );
      })()}

      {/* ════════════════════════════════════
          DOCTOR ACTION MODALS
      ════════════════════════════════════ */}

      {/* ── Stop / Discontinue ── */}
      {docModal?.type === "stop" && (() => {
        const order = docModal.order;
        return (
          <ModalOverlay onClose={() => setDocModal(null)}>
            <ModalHeader title="Discontinue Order" sub={order.orderDetails?.medicineName || order.orderDetails?.displayName} color={C.red} icon="pi-times-circle" onClose={() => setDocModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: C.redL, border: `1.5px solid ${C.redB}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.red, fontWeight: 700 }}>
                ⚠ This will permanently discontinue the order. An audit trail will be logged (NABH MOM.5).
              </div>
              <FL label="Reason for Discontinuation *">
                <select style={sel} value={docForm.reason} onChange={e => setDocForm(p => ({ ...p, reason: e.target.value }))}>
                  <option value="">— Select reason —</option>
                  {["Treatment course completed","Clinical improvement — no longer required","Adverse drug reaction","Drug interaction identified","Patient refused","Change in diagnosis","Substitute ordered","Switched to oral therapy","Patient transferred","Patient discharged","Other"].map(r => <option key={r}>{r}</option>)}
                </select>
              </FL>
              {docForm.reason === "Other" || docForm.reason === "" ? null : (
                <FL label="Additional Details">
                  <textarea style={ta} value={docForm.reasonDetail} placeholder="Clinical basis, any relevant findings…" onChange={e => setDocForm(p => ({ ...p, reasonDetail: e.target.value }))} />
                </FL>
              )}
            </div>
            <ModalFooter onCancel={() => setDocModal(null)} onSave={() => submitDocAction("stop")} saving={docSaving} saveLabel="Discontinue Order" />
          </ModalOverlay>
        );
      })()}

      {/* ── Hold Order ── */}
      {docModal?.type === "hold" && (() => {
        const order = docModal.order;
        return (
          <ModalOverlay onClose={() => setDocModal(null)}>
            <ModalHeader title="Place Order on Hold" sub={order.orderDetails?.medicineName || order.orderDetails?.displayName} color={C.amber} icon="pi-pause" onClose={() => setDocModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: C.amberL, border: `1.5px solid ${C.amberB}`, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: C.amber, fontWeight: 700 }}>
                Order will be held. Nursing staff will be notified. Resume manually when ready.
              </div>
              <FL label="Reason for Hold *">
                <select style={sel} value={docForm.reason} onChange={e => setDocForm(p => ({ ...p, reason: e.target.value }))}>
                  <option value="">— Select reason —</option>
                  {["Pre-operative hold","Awaiting investigation results","Patient NPO","Drug interaction — monitoring","Renal/hepatic function reassessment","Haemodynamic reassessment","Lab values out of range","Patient uncooperative","Consent pending","Other"].map(r => <option key={r}>{r}</option>)}
                </select>
              </FL>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FL label="Hold Until (date/time)">
                  <input type="datetime-local" style={fld} value={docForm.holdUntil} onChange={e => setDocForm(p => ({ ...p, holdUntil: e.target.value }))} />
                </FL>
                <FL label="Details">
                  <input style={fld} value={docForm.reasonDetail} placeholder="Specific instructions for nursing staff" onChange={e => setDocForm(p => ({ ...p, reasonDetail: e.target.value }))} />
                </FL>
              </div>
            </div>
            <ModalFooter onCancel={() => setDocModal(null)} onSave={() => submitDocAction("hold")} saving={docSaving} saveLabel="Hold Order" />
          </ModalOverlay>
        );
      })()}

      {/* ── Resume Order ── */}
      {docModal?.type === "resume" && (() => {
        const order = docModal.order;
        return (
          <ModalOverlay onClose={() => setDocModal(null)}>
            <ModalHeader title="Resume Order" sub={order.orderDetails?.medicineName || order.orderDetails?.displayName} color={C.green} icon="pi-play" onClose={() => setDocModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: C.greenL, border: `1.5px solid ${C.greenB}`, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: C.green, fontWeight: 700 }}>
                This order will be resumed from held status. Nursing staff will proceed with the existing schedule.
              </div>
              <FL label="Resume Note (optional)">
                <input style={fld} value={docForm.reason} placeholder="e.g. Pre-op period over, labs within range, patient consented…" onChange={e => setDocForm(p => ({ ...p, reason: e.target.value }))} />
              </FL>
            </div>
            <ModalFooter onCancel={() => setDocModal(null)} onSave={() => submitDocAction("resume")} saving={docSaving} saveLabel="Resume Order" />
          </ModalOverlay>
        );
      })()}

      {/* ── Modify Order ── */}
      {docModal?.type === "modify" && (() => {
        const order = docModal.order;
        const isInfusion = ["IV_Fluid","BloodTransfusion"].includes(order.orderType);
        const ROUTES_LIST = ["IV","IV Infusion","IV Bolus","IM","SC","ID","PO","SL","Buccal","NG Tube","PEG Tube","Inhalation","Nebulization","Topical","Transdermal","Ophthalmic","Otic","Nasal","PR","PV"];
        const FREQ_LIST   = ["OD","BD","TDS","QID","Q4H","Q6H","Q8H","Q12H","HS","STAT","SOS","Before Food","After Food","Weekly","Continuous"];
        return (
          <ModalOverlay onClose={() => setDocModal(null)}>
            <ModalHeader title="Modify Order" sub={`${order.orderDetails?.medicineName || order.orderDetails?.displayName} — current: ${order.orderDetails?.dose || ""} ${order.orderDetails?.route || ""} ${order.orderDetails?.frequency || ""}`} color="#7c3aed" icon="pi-pencil" onClose={() => setDocModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: "#f5f3ff", border: "1.5px solid #c4b5fd", borderRadius: 8, padding: "8px 14px", fontSize: 11, color: "#5b21b6", fontWeight: 600 }}>
                All changes are audit-logged (NABH MOM.5). Original order is preserved in the audit trail.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <FL label="New Dose">
                  <input style={fld} value={docForm.newDose} placeholder={order.orderDetails?.dose} onChange={e => setDocForm(p => ({ ...p, newDose: e.target.value }))} />
                </FL>
                <FL label="Route">
                  <select style={sel} value={docForm.newRoute} onChange={e => setDocForm(p => ({ ...p, newRoute: e.target.value }))}>
                    {ROUTES_LIST.map(r => <option key={r}>{r}</option>)}
                  </select>
                </FL>
                {!isInfusion ? (
                  <FL label="Frequency">
                    <select style={sel} value={docForm.newFrequency} onChange={e => setDocForm(p => ({ ...p, newFrequency: e.target.value }))}>
                      {FREQ_LIST.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </FL>
                ) : (
                  <FL label="New Rate (ml/hr)">
                    <input type="number" style={fld} value={docForm.newRate} placeholder={order.currentRate || order.orderDetails?.rate} onChange={e => setDocForm(p => ({ ...p, newRate: e.target.value }))} />
                  </FL>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FL label="Duration">
                  <input style={fld} value={docForm.newDuration} placeholder={order.orderDetails?.duration || "e.g. 5 days"} onChange={e => setDocForm(p => ({ ...p, newDuration: e.target.value }))} />
                </FL>
                <FL label="Instructions / Notes">
                  <input style={fld} value={docForm.newNotes} placeholder={order.orderDetails?.notes || "Additional notes"} onChange={e => setDocForm(p => ({ ...p, newNotes: e.target.value }))} />
                </FL>
              </div>
              <FL label="Reason for Modification * (Audit log)">
                <select style={sel} value={docForm.reason} onChange={e => setDocForm(p => ({ ...p, reason: e.target.value }))}>
                  <option value="">— Select reason —</option>
                  {["Clinical response — dose adjustment","Adverse effect — dose reduction","Renal impairment — dose reduction","Hepatic impairment — dose reduction","Drug level monitoring","Therapeutic target not achieved","Switch to oral therapy","Route change — IV access issue","Patient weight change","New investigation results","Drug interaction management","Other"].map(r => <option key={r}>{r}</option>)}
                </select>
              </FL>
              <FL label="Clinical Detail (optional)">
                <textarea style={ta} value={docForm.reasonDetail} placeholder="Clinical basis, relevant lab values, vitals, clinical assessment…" onChange={e => setDocForm(p => ({ ...p, reasonDetail: e.target.value }))} />
              </FL>
            </div>
            <ModalFooter onCancel={() => setDocModal(null)} onSave={() => submitDocAction("modify")} saving={docSaving} saveLabel="Save Modification" />
          </ModalOverlay>
        );
      })()}

      {/* ── Substitute Drug ── */}
      {docModal?.type === "substitute" && (() => {
        const order = docModal.order;
        const ROUTES_LIST = ["PO","IV","IV Infusion","IV Bolus","IM","SC","ID","SL","Buccal","NG Tube","PEG Tube","Inhalation","Nebulization","Topical","Ophthalmic","Otic","Nasal","PR","PV"];
        const FREQ_LIST   = ["OD","BD","TDS","QID","Q4H","Q6H","Q8H","Q12H","HS","STAT","SOS","Before Food","After Food","Weekly","Continuous"];
        return (
          <ModalOverlay onClose={() => setDocModal(null)}>
            <ModalHeader title="Substitute Medication" sub={`Replace: ${order.orderDetails?.medicineName}`} color="#7c3aed" icon="pi-refresh" onClose={() => setDocModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 8, padding: "8px 14px", fontSize: 11, color: "#92400e", fontWeight: 600 }}>
                Current order will be stopped and a new order will be created automatically. Both changes are audit-logged.
              </div>

              {/* Current drug (read-only) */}
              <div style={{ background: C.redL, border: `1px solid ${C.redB}`, borderRadius: 8, padding: "8px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4 }}>Stopping</div>
                <div style={{ fontWeight: 700, color: C.red }}>{order.orderDetails?.medicineName} — {order.orderDetails?.dose} {order.orderDetails?.route} {order.orderDetails?.frequency}</div>
              </div>

              {/* New drug */}
              <div style={{ background: C.greenL, border: `1px solid ${C.greenB}`, borderRadius: 8, padding: "10px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>New Drug (Substitute)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <FL label="Drug Name *"><input style={fld} value={docForm.subName} placeholder="Generic drug name" onChange={e => setDocForm(p => ({ ...p, subName: e.target.value }))} autoFocus /></FL>
                  <FL label="Dose *"><input style={fld} value={docForm.subDose} placeholder="e.g. 500mg" onChange={e => setDocForm(p => ({ ...p, subDose: e.target.value }))} /></FL>
                  <FL label="Route">
                    <select style={sel} value={docForm.subRoute} onChange={e => setDocForm(p => ({ ...p, subRoute: e.target.value }))}>
                      {ROUTES_LIST.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </FL>
                  <FL label="Frequency">
                    <select style={sel} value={docForm.subFreq} onChange={e => setDocForm(p => ({ ...p, subFreq: e.target.value }))}>
                      {FREQ_LIST.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </FL>
                  <FL label="Duration"><input style={fld} value={docForm.subDuration} placeholder="e.g. 5 days" onChange={e => setDocForm(p => ({ ...p, subDuration: e.target.value }))} /></FL>
                  <FL label="Indication"><input style={fld} value={docForm.subIndication} placeholder="Reason for prescription" onChange={e => setDocForm(p => ({ ...p, subIndication: e.target.value }))} /></FL>
                </div>
                <div style={{ marginTop: 8 }}>
                  <FL label="Notes"><input style={fld} value={docForm.subNotes} placeholder="Special instructions for nursing staff" onChange={e => setDocForm(p => ({ ...p, subNotes: e.target.value }))} /></FL>
                </div>
              </div>

              <FL label="Reason for Substitution *">
                <select style={sel} value={docForm.reason} onChange={e => setDocForm(p => ({ ...p, reason: e.target.value }))}>
                  <option value="">— Select —</option>
                  {["Drug not available in formulary","Allergy / adverse reaction to original","Therapeutic equivalent substitution","Cost-effective alternative","Route change clinically indicated","Drug-drug interaction","Generic substitution","Patient preference","Other"].map(r => <option key={r}>{r}</option>)}
                </select>
              </FL>
            </div>
            <ModalFooter onCancel={() => setDocModal(null)} onSave={() => submitDocAction("substitute")} saving={docSaving} saveLabel="Stop & Create New Order" />
          </ModalOverlay>
        );
      })()}

      {/* ── Doctor Infusion Rate Change ── */}
      {docModal?.type === "rate" && (() => {
        const order = docModal.order;
        return (
          <ModalOverlay onClose={() => setDocModal(null)}>
            <ModalHeader title="Change Infusion Rate (Doctor Order)" sub={`${order.orderDetails?.displayName || order.orderDetails?.medicineName} · Current: ${order.currentRate || order.orderDetails?.rate || "—"} ml/hr`} color="#0369a1" icon="pi-arrows-v" onClose={() => setDocModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: "#f0f9ff", border: "1.5px solid #bae6fd", borderRadius: 8, padding: "8px 14px", fontSize: 11, color: "#0369a1", fontWeight: 600 }}>
                Rate change will be logged as Doctor Order in the infusion rate change history. Nursing staff will see the updated rate immediately.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FL label="Current Rate (ml/hr)">
                  <div style={{ ...fld, background: "#f8fafc", fontFamily: "monospace", fontWeight: 700, color: C.muted }}>{order.currentRate || order.orderDetails?.rate || "—"}</div>
                </FL>
                <FL label="New Rate (ml/hr) *">
                  <input type="number" style={{ ...fld, borderColor: "#0369a1" }} value={docForm.newRate} placeholder="Enter new rate" onChange={e => setDocForm(p => ({ ...p, newRate: e.target.value }))} autoFocus />
                </FL>
              </div>
              <FL label="Clinical Reason / Titration Goal *">
                <select style={sel} value={docForm.reason} onChange={e => setDocForm(p => ({ ...p, reason: e.target.value }))}>
                  <option value="">— Select —</option>
                  {["Haemodynamic target achieved — reduce rate","MAP target not met — increase rate","Fluid balance — restrict rate","Renal output adequate — resume standard rate","Titration protocol — step up","Titration protocol — step down","Fluid overload — reduce","Clinical deterioration — increase","Maintenance phase","Weaning off vasoactive support","Post-procedure rate adjustment","Other"].map(r => <option key={r}>{r}</option>)}
                </select>
              </FL>
              <FL label="Additional Clinical Details">
                <textarea style={ta} value={docForm.reasonDetail} placeholder="Vitals, labs, clinical findings that prompted this change…" onChange={e => setDocForm(p => ({ ...p, reasonDetail: e.target.value }))} />
              </FL>
            </div>
            <ModalFooter onCancel={() => setDocModal(null)} onSave={() => submitDocAction("rate")} saving={docSaving} saveLabel="Apply Rate Change" />
          </ModalOverlay>
        );
      })()}

      {/* ── Stop / Hold Infusion Modal (replaces window.prompt) ── */}
      {infModal && (() => {
        const { order, type } = infModal;
        const isStop = type === "stop";
        const reasons = isStop ? STOP_INF_REASONS : HOLD_INF_REASONS;
        const color   = isStop ? C.red : C.amber;
        const colorL  = isStop ? C.redL : C.amberL;
        const colorB  = isStop ? C.redB : C.amberB;
        const icon    = isStop ? "pi-stop" : "pi-pause";
        const titleTx = isStop ? "Stop & Document Infusion" : "Hold Infusion";
        const saveLbl = isStop ? "Stop Infusion" : "Hold Infusion";
        const f       = infForm;
        return (
          <ModalOverlay onClose={() => setInfModal(null)}>
            <ModalHeader
              title={titleTx}
              sub={order.orderDetails?.displayName || order.orderDetails?.medicineName}
              color={color} icon={icon} onClose={() => setInfModal(null)}
            />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Warning banner */}
              <div style={{ background: colorL, border: `1.5px solid ${colorB}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color, fontWeight: 700 }}>
                {isStop
                  ? "⚠ Stopping an infusion is a permanent action. Reason must be documented for NABH MOM.2 compliance."
                  : "⏸ Infusion will be held. Document reason and expected resume time. Nursing staff will be notified."}
              </div>

              {/* Reason dropdown */}
              <div>
                <label style={lbl}>{isStop ? "Stop Reason *" : "Hold Reason *"}</label>
                <select style={sel} value={f.reason} onChange={e => setInfForm(p => ({ ...p, reason: e.target.value, reasonCustom: "" }))}>
                  <option value="">— Select reason —</option>
                  {reasons.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>

              {/* Custom reason */}
              {f.reason === "Other" && (
                <div>
                  <label style={lbl}>Specify Reason *</label>
                  <input style={{ ...fld, borderColor: color }} value={f.reasonCustom}
                    placeholder="Describe the reason…"
                    onChange={e => setInfForm(p => ({ ...p, reasonCustom: e.target.value }))}
                    autoFocus />
                </div>
              )}

              {/* Hold until (only for hold) */}
              {!isStop && (
                <div>
                  <label style={lbl}>Hold Until (expected resume time)</label>
                  <input type="datetime-local" style={fld} value={f.holdUntil}
                    onChange={e => setInfForm(p => ({ ...p, holdUntil: e.target.value }))} />
                </div>
              )}

              {/* Notes */}
              <div>
                <label style={lbl}>Additional Notes / Clinical Observation</label>
                <textarea style={ta} value={f.notes}
                  placeholder={isStop
                    ? "Volume infused, patient status at time of stopping, doctor informed…"
                    : "Clinical details, doctor informed, restart plan…"}
                  onChange={e => setInfForm(p => ({ ...p, notes: e.target.value }))} />
              </div>

              {/* Current rate info */}
              <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", display: "flex", gap: 16, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Current Rate</div>
                  <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: C.teal }}>
                    {order.currentRate || order.orderDetails?.rate || "—"} ml/hr
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Documented By</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: C.text }}>{nurseName}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>Time</div>
                  <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 12, color: C.text }}>{new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
                </div>
              </div>
            </div>
            <ModalFooter onCancel={() => setInfModal(null)} onSave={submitInfAction} saving={infSaving} saveLabel={saveLbl} />
          </ModalOverlay>
        );
      })()}

      {/* ── Add Monitoring Entry Modal ── */}
      {actionModal?.type === "monitoring" && (() => {
        const order = actionModal.order;
        return (
          <ModalOverlay onClose={() => setActionModal(null)}>
            <ModalHeader title="Add Monitoring Entry" sub={order.orderDetails?.displayName || order.orderDetails?.medicineName} color={C.teal} icon="pi-chart-bar" onClose={() => setActionModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: C.tealL, border: `1px solid ${C.tealB}`, borderRadius: 8, padding: "8px 12px", fontSize: 11, color: C.teal, fontWeight: 700 }}>
                NABH MOM.2 — Infusion monitoring entry. Document every 30 min for vasoactive / HAM infusions, every 1 hr for standard IV fluids.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <FL label="Current Rate (ml/hr)"><input style={fld} value={monitorForm.currentRate} placeholder={order.currentRate || ""} onChange={e => setMonitorForm(p => ({ ...p, currentRate: e.target.value }))} /></FL>
                <FL label="Volume Infused (ml)"><input type="number" style={fld} value={monitorForm.volumeInfused} placeholder="Total vol given so far" onChange={e => setMonitorForm(p => ({ ...p, volumeInfused: e.target.value }))} /></FL>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>Vitals</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                  <FL label="BP (mmHg)"><input style={fld} value={monitorForm.bp} placeholder="120/80" onChange={e => setMonitorForm(p => ({ ...p, bp: e.target.value }))} /></FL>
                  <FL label="Pulse (/min)"><input type="number" style={fld} value={monitorForm.pulse} placeholder="80" onChange={e => setMonitorForm(p => ({ ...p, pulse: e.target.value }))} /></FL>
                  <FL label="SpO₂ (%)"><input type="number" style={fld} value={monitorForm.spo2} placeholder="98" onChange={e => setMonitorForm(p => ({ ...p, spo2: e.target.value }))} /></FL>
                  <FL label="Urine Output (ml/hr)"><input type="number" style={fld} value={monitorForm.urineOutput} placeholder="40" onChange={e => setMonitorForm(p => ({ ...p, urineOutput: e.target.value }))} /></FL>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FL label="IV Site Condition">
                  <select style={sel} value={monitorForm.siteCondition} onChange={e => setMonitorForm(p => ({ ...p, siteCondition: e.target.value }))}>
                    <option value="">— Select —</option>
                    {SITE_CONDITIONS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </FL>
                <FL label="Action Taken">
                  <select style={sel} value={monitorForm.action} onChange={e => setMonitorForm(p => ({ ...p, action: e.target.value }))}>
                    {INF_ACTIONS.map(a => <option key={a}>{a}</option>)}
                  </select>
                </FL>
              </div>
              <FL label="Remarks / Observations">
                <textarea style={ta} value={monitorForm.remarks} placeholder="Clinical observations, patient response, any concerns or actions taken…" onChange={e => setMonitorForm(p => ({ ...p, remarks: e.target.value }))} />
              </FL>
            </div>
            <ModalFooter onCancel={() => setActionModal(null)} onSave={submitMonitoring} saving={saving} saveLabel="Add Entry" />
          </ModalOverlay>
        );
      })()}
    </div>
  );
}

/* ── Table styles ── */
const TH = { padding: "7px 10px", border: `1px solid ${C.blueB}`, fontWeight: 700, color: C.blue, textAlign: "left", fontSize: 11, background: C.blueL, whiteSpace: "nowrap" };
const TD = { padding: "8px 10px", border: `1px solid #e8f0fe`, verticalAlign: "top", fontSize: 12 };
const ACTBTN = { padding: "5px 12px", borderRadius: 7, fontFamily: "'DM Sans',sans-serif", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all .15s" };
const DOCBTN = { padding: "4px 9px", borderRadius: 6, fontFamily: "'DM Sans',sans-serif", fontSize: 10, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "all .15s", whiteSpace: "nowrap" };

/* ── Modal helpers ── */
function ModalOverlay({ children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", backdropFilter: "blur(4px)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, width: 640, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.3)" }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function ModalHeader({ title, sub, color, icon, onClose }) {
  return (
    <div style={{ padding: "14px 20px", background: `linear-gradient(135deg, ${color}, ${color}cc)`, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: "16px 16px 0 0", position: "sticky", top: 0, zIndex: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className={`pi ${icon}`} style={{ fontSize: 15, color: "white" }} />
        </span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.8)" }}>{sub}</div>
        </div>
      </div>
      <button onClick={onClose} style={{ background: "rgba(255,255,255,.2)", border: "none", color: "white", fontSize: 18, cursor: "pointer", width: 30, height: 30, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
    </div>
  );
}
function ModalFooter({ onCancel, onSave, saving, saveLabel = "Save" }) {
  return (
    <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 8, background: "#f8fafc", borderRadius: "0 0 16px 16px", position: "sticky", bottom: 0 }}>
      <button onClick={onCancel} style={{ padding: "9px 20px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white", fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer", color: C.muted }}>Cancel</button>
      <button onClick={onSave} disabled={saving} style={{ padding: "9px 24px", background: saving ? "#94a3b8" : `linear-gradient(135deg,${C.primary},${C.primaryMid})`, color: "white", border: "none", borderRadius: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7 }}>
        <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 12 }} />
        {saving ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}
