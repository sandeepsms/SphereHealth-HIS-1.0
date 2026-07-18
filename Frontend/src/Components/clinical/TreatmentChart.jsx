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
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";
// R7hr-176 (USER, 2026-06-09): Verbal-order modal now uses the SAME
// PrescriptionPanel + InfusionPanel components the Doctor IPD Initial
// Assessment uses — drug autocomplete, dilution fields, vasopressor
// strength selector, fluid presets — all consistent across IA + verbal.
import PrescriptionPanel from "./PrescriptionPanel";
import InfusionPanel     from "./InfusionPanel";

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

/* R7bq-J3 — Same predicate as NurseOrdersPanel.todayActionable: a course
   order is "actionable today" only if it has a non-STAT pending/delayed
   slot scheduled for today. When false but order.status === "InProgress",
   we want the row to read "Today Done · course continues" instead of
   the plain "InProgress" amber/blue pill. Local time, matches the rest
   of the codebase's setHours(0,0,0,0) convention. */
const todayActionable = (o) => {
  if (!Array.isArray(o?.administrationRecord) || !o.administrationRecord.length) return true;
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(start); end.setDate(end.getDate() + 1);
  return o.administrationRecord.some(a => {
    if (a.isStatDose) return false;
    const d = a.scheduledDate ? new Date(a.scheduledDate) : null;
    if (!d || d < start || d >= end) return false;
    return ["pending","delayed"].includes(a.status);
  });
};

/* R7bq-L — Live infusion volume calculation. Walks the rate-change
   timeline to compute "how much has been infused right now". Each
   segment runs at its own rate; total = sum of (hours × rate). Caps
   at totalVolume. Returns { ml, percent, etaMinutes, exhausted }.

   This is the source of truth for the volume progress bar in the
   nurse Infusion tab and drives the auto-stop when the bag is empty. */
function computeInfusionProgress(order, atTime = new Date()) {
  if (!order || !order.infusionStarted) {
    return { ml: 0, percent: 0, etaMinutes: null, exhausted: false, totalVol: 0, isPaused: false };
  }
  const totalVol = parseFloat(order.orderDetails?.totalVolume) || 0;
  const start = new Date(order.infusionStarted);
  const stop  = order.infusionStopped ? new Date(order.infusionStopped) : null;
  // R7hr-146 — Detect "currently paused" state. Pre-fix, OnHold still
  // ticked the bar because evalEnd was `atTime` regardless of status,
  // so the nurse's Pause success toast fired but the volume kept
  // climbing. Now: if status === "OnHold" and no stop yet, freeze the
  // computation at the last "Infusion Paused" auditLog entry.
  const isPausedNow = order.status === "OnHold" && !stop;
  const hardEnd = stop ? stop : (atTime || new Date());

  // R7hr-146 — Build "running intervals" from infusionStarted +
  // Pause/Resume auditLog events. Each running segment contributes
  // (duration × rate) to the total. Paused windows contribute zero —
  // the bar freezes during pauses and resumes ticking from the next
  // "Infusion Resumed" event.
  // The result is NABH MOM.2 audit-faithful: the bag volume reflects
  // ONLY the time the drip was actually flowing.
  const audit = Array.isArray(order.auditLog) ? order.auditLog : [];
  const pauseResumeEvents = audit
    .filter((a) => a && a.doneAt && a.step)
    .map((a) => ({ t: new Date(a.doneAt), step: a.step }))
    .filter((e) => /Infusion Paused/i.test(e.step) || /Infusion Resumed/i.test(e.step))
    .filter((e) => e.t > start && (!stop || e.t < stop))
    .sort((a, b) => a.t - b.t);

  // Walk events, building closed running segments.
  const runningSegments = [];
  let segStart = start;
  let running = true;
  for (const ev of pauseResumeEvents) {
    if (/Infusion Paused/i.test(ev.step) && running) {
      if (ev.t > segStart) runningSegments.push({ start: segStart, end: ev.t });
      running = false;
    } else if (/Infusion Resumed/i.test(ev.step) && !running) {
      segStart = ev.t;
      running = true;
    }
  }
  // Close the final segment — if still running, run up to hardEnd;
  // if paused (no resume yet), no segment to add.
  if (running) {
    if (hardEnd > segStart) runningSegments.push({ start: segStart, end: hardEnd });
  }

  if (runningSegments.length === 0) {
    return { ml: 0, percent: 0, etaMinutes: null, exhausted: false, totalVol, isPaused: isPausedNow };
  }

  // Initial rate = orderDetails.rate (doctor's prescription); subsequent
  // rateChanges segments override from their `changedAt` timestamp.
  const parseR = (v) => {
    const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const initialRate = parseR(order.orderDetails?.rate);
  const rateChanges = (order.rateChanges || [])
    .map((rc) => ({ t: new Date(rc.changedAt), rate: parseR(rc.newRate) }))
    .filter((c) => c.rate > 0)
    .sort((a, b) => a.t - b.t);

  // For each running segment, sum volume = duration × rate (split at
  // any rateChanges that fall inside the segment).
  const rateAt = (when) => {
    let r = initialRate;
    for (const rc of rateChanges) {
      if (rc.t <= when) r = rc.rate;
      else break;
    }
    return r;
  };
  let totalMl = 0;
  let lastRateInRunningSegment = initialRate;
  for (const seg of runningSegments) {
    let cursor = seg.start;
    let currentRate = rateAt(cursor);
    // Apply rate changes that fall inside [seg.start, seg.end)
    const changesInSeg = rateChanges.filter((rc) => rc.t > seg.start && rc.t < seg.end);
    for (const rc of changesInSeg) {
      const hrs = (rc.t - cursor) / 3_600_000;
      totalMl += hrs * currentRate;
      cursor = rc.t;
      currentRate = rc.rate;
    }
    const tailHrs = (seg.end - cursor) / 3_600_000;
    totalMl += tailHrs * currentRate;
    lastRateInRunningSegment = currentRate;
  }

  // R7hr-147 — Add bolus pushes (mL given outside the continuous drip).
  // Only count boluses given before `hardEnd` (i.e. before stop or now),
  // matching the same time horizon the drip math uses.
  const bolusList = Array.isArray(order.boluses) ? order.boluses : [];
  let bolusMl = 0;
  for (const b of bolusList) {
    if (!b || !b.time) continue;
    const t = new Date(b.time);
    if (t > hardEnd) continue;
    const v = parseFloat(b.volumeMl);
    if (Number.isFinite(v) && v > 0) bolusMl += v;
  }
  totalMl += bolusMl;

  // Cap at totalVol
  const exhausted = totalVol > 0 && totalMl >= totalVol;
  const ml = totalVol > 0 ? Math.min(totalMl, totalVol) : totalMl;
  const percent = totalVol > 0 ? Math.min(100, Math.round((ml / totalVol) * 100 * 10) / 10) : 0;

  // ETA — how many minutes until totalVol reached, at current rate.
  // Suppress when paused (cannot project a finish time while frozen).
  let etaMinutes = null;
  if (totalVol > 0 && !exhausted && !stop && !isPausedNow && lastRateInRunningSegment > 0) {
    const remaining = totalVol - ml;
    etaMinutes = Math.max(0, Math.round((remaining / lastRateInRunningSegment) * 60));
  }
  return {
    ml: Math.round(ml * 10) / 10,
    percent,
    etaMinutes,
    exhausted,
    totalVol,
    currentRate: lastRateInRunningSegment,
    isPaused: isPausedNow,
  };
}

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
  hold:          { label: "Hold ⏸",        icon: "⏸", color: "#4f46e5", bg: "#e0e7ff", border: "#93c5fd" },
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
const BOLUS_REASONS   = ["Loading dose","Hypotension/shock","Volume replacement","Pre-procedure","Hypoglycaemia rescue","Electrolyte correction","Symptomatic relief","Per doctor's verbal order","Other"];
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
// R7hr-132 — Reasons a held infusion gets resumed. Captured for NABH
// MOM.2 audit trail; without these the resume is invisible on the
// chart (you'd see Held → Running with no narrative of why nursing
// restarted it).
const RESUME_INF_REASONS = [
  "Patient now stable — safe to resume",
  "Pre-procedure NPO over — resuming maintenance",
  "New IV access secured — resuming infusion",
  "Doctor cleared resume after review",
  "Vitals back within target range",
  "Pain / agitation controlled — resume titration",
  "Adverse reaction resolved — resume at lower rate",
  "Held-until time reached — resuming per plan",
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
const STAT_REASONS = [
  "Breakthrough pain / symptom not controlled by scheduled dose",
  "Fever — patient above SOS threshold",
  "Doctor verbal order — emergency administration",
  "Pre-procedure / pre-op requirement",
  "Missed dose — patient returned from procedure / theatre",
  "Pharmacy delay — drug now available",
  "Patient clinical deterioration — urgent dose required",
  "Patient transfer — dose given before shifting",
  "Other",
];
// Frequency → interval hours (for next-dose recalculation after STAT)
const FREQ_INTERVALS = { "OD": 24, "BD": 12, "TDS": 8, "QID": 6, "Q4H": 4, "Q6H": 6, "Q8H": 8, "Q12H": 12 };

/* ── Design tokens ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#4338ca", primaryL: "#eef2ff", primaryMid: "#4f46e5",
  green: "#15803d", greenL: "#dcfce7", greenB: "#86efac",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#4f46e5", blueL: "#e0e7ff", blueB: "#93c5fd",
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
export default function TreatmentChart({ UHID, visitId, patientName, nurseMode = true, refreshTrigger = 0, onAdminSave, admissionId, pinnedDate = null, hideDateNav = false, compactView = false }) {
  // R7hr-124 — `pinnedDate` lets a parent (e.g. day-wise stack on the
  // Patient Panel) lock this instance to a specific calendar day; the
  // standalone /treatment-chart page leaves it null and keeps full
  // Prev/Today/Next navigation. `hideDateNav` suppresses the picker row
  // when the parent owns day selection.
  // R7hr-125 — `compactView` strips the heavy chrome (dark gradient
  // header with Refresh/Raise-Indent/Print buttons + the NABH status
  // legend strip) so the day-wise stacked tabular presentation can
  // render multiple days in succession without each one feeling like a
  // standalone page. The drug × scheduled-doses table itself is already
  // tabular and stays intact. Tabs remain visible so the viewer can
  // still toggle Medication MAR ↔ Infusion Orders per day. All props
  // default to legacy behaviour — standalone /treatment-chart page is
  // unchanged (R25).
  const { user } = useAuth();
  const navigate = useNavigate();
  const nurseName = user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Nurse";
  // R7j: Inline "Raise Indent" CTA — visible to Nurse/Doctor/Admin when an
  // admission ID is known. The indent page already has its own RoleGuard
  // (action="indent.raise" → Nurse/Doctor/Admin) so the button is only a
  // navigation shortcut; backend permissions are the trust boundary.
  const canRaiseIndent =
    !!admissionId &&
    (user?.role === "Nurse" || user?.role === "Doctor" || user?.role === "Admin");

  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [activeTab,   setActiveTab]   = useState("medications"); // "medications" | "infusions"
  const [actionModal, setActionModal] = useState(null);          // { order, type, doseIndex }
  const [saving,        setSaving]        = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const autoTimer = useRef(null);

  /* ── MAR date navigator ── */
  // R7hr-124 — when a parent pins the day (stacked view), initialise the
  // navigator from pinnedDate; otherwise keep the standalone-page default
  // of "today". setMarDate stays wired so the existing Prev/Next/Today
  // buttons work unchanged on the legacy single-day pager.
  const [marDate, setMarDate] = useState(() => {
    if (pinnedDate instanceof Date && !isNaN(pinnedDate)) return new Date(pinnedDate);
    if (typeof pinnedDate === "string" || typeof pinnedDate === "number") {
      const d = new Date(pinnedDate);
      if (!isNaN(d)) return d;
    }
    return new Date();
  });
  const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
  const isMarToday = marDate.toDateString() === new Date().toDateString();
  const marDateStr = marDate.toDateString();
  const prevMarDay = () => setMarDate(d => { const n = new Date(d); n.setDate(n.getDate()-1); return n; });
  const nextMarDay = () => setMarDate(d => { const n = new Date(d); n.setDate(n.getDate()+1); return n; });
  const canGoNext  = !isMarToday; // cannot go past today

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
  // R7hr-147 — Bolus form. The nurse documents an extra mL push from
  // the same regimen (flush, top-up, pre-load…). On save we POST to
  // /:id/bolus which adds the volume to the infusion's accumulated
  // total AND drops a CLINICAL_AUDIT row.
  const [bolusForm, setBolusForm] = useState({
    volumeMl: "", reason: "", reasonCustom: "", route: "IV", notes: "",
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

  /* ── R7hr-139 — Verbal/Telephonic Order modal state.
       parentOrder is set when the nurse restarts a completed infusion
       so the modal pre-fills the regimen for one-tap restart. */
  const [verbalModal, setVerbalModal] = useState({ open: false, parentOrder: null });
  const [verbalSaving, setVerbalSaving] = useState(false);
  const [verbalForm, setVerbalForm] = useState({
    orderType: "Medication",       // Medication | IV_Fluid
    verbalFromDoctor: "",          // Prescribing doctor name (mandatory)
    verbalReason: "",              // Phone consult / Off-floor / Emergency / Other
    verbalReasonCustom: "",
    readBackConfirmed: false,      // IPSG.2 mandatory
    // Medication fields (legacy single-order shape — retained as fallback
    // for restart-bag pre-fill; the multi-row array below is the primary
    // entry point now)
    medicineName: "", dose: "", route: "PO", frequency: "BD", duration: "",
    indication: "", notes: "",
    dilutionVolume: "", dilutionFluid: "", infuseOverMinutes: "",
    // Infusion fields
    fluidName: "", totalVolume: "", rate: "", infDuration: "", additives: "",
  });
  // R7hr-176 (USER, 2026-06-09): same shared multi-row Rx/Infusion panels
  // the IPD Initial Assessment uses. Doctor can dictate 1-N meds or fluids
  // in a single phone call; we loop on submit and POST one verbal order
  // per row (same verbalFromDoctor / reason / read-back applied to all).
  const [verbalMeds, setVerbalMeds] = useState([]);   // PrescriptionPanel value
  const [verbalInfs, setVerbalInfs] = useState([]);   // InfusionPanel value

  /* ── Fetch ── */
  // R7hr-175 (USER, 2026-06-09, INVESTOR-DAY): scope MAR fetch by
  // admissionId when in IPD context. Pre-fix the fallback path was
  // `?UHID=` which returned EVERY DoctorOrder for the patient across
  // EVERY visit — so an OPD prescription from yesterday's visit (Tab
  // Cefixime / Pantoprazole / Paracetamol 500mg) showed up in today's
  // IPD MAR alongside the Dr-IA injectables. Investor caught it. Now:
  //   • IPD context (admissionId prop set) → ?admissionId=<_id>
  //     fetches ONLY the orders attached to this admission (IA-fanned
  //     + manual + verbal). OPD orders have admissionId=undefined so
  //     they're filtered out by definition.
  //   • OPD context (visitId set, no admissionId) → unchanged.
  //   • Fallback (neither set) → unchanged.
  const fetchOrders = useCallback(async (silent = false) => {
    if (!UHID) return;
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const url = admissionId
        ? `${API_ENDPOINTS.DOCTOR_ORDERS}?admissionId=${admissionId}`
        : visitId
          ? `${API_ENDPOINTS.DOCTOR_ORDERS}?UHID=${UHID}&visitId=${visitId}`
          : `${API_ENDPOINTS.DOCTOR_ORDERS}?UHID=${UHID}`;
      const { data } = await axios.get(url);
      const arr = Array.isArray(data) ? data : (data.data || []);
      setOrders(arr.filter(o => !["Cancelled"].includes(o.status)));
    } catch { /* silent */ }
    finally { silent ? setRefreshing(false) : setLoading(false); setLastRefreshed(new Date()); }
  }, [UHID, visitId, admissionId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders, refreshTrigger]);

  /* Auto-refresh every 30s */
  useEffect(() => {
    autoTimer.current = setInterval(() => fetchOrders(true), 30000);
    return () => clearInterval(autoTimer.current);
  }, [fetchOrders]);

  /* R7bq-L — Live infusion tick. We re-render every 30s so the Volume
     Progress bar walks forward in real time without waiting for the
     parent fetch to land. `now` is a Date stamped at each tick and
     read by computeInfusionProgress to compute the current ml infused. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

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

    // Auto-detect STAT mode: no undocumented regular slot is currently in its 30-min window
    // Must exclude slots already documented (given/hold/etc.) — those are not "open"
    const regularTimes = (FREQ_TIMES[order.orderDetails?.frequency] || []).filter(t => !t.startsWith("STAT:"));
    const toMins = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
    const SPECIAL_T = ["Immediate","As Needed","Continuous","Before Meals","After Meals","Once Weekly","—"];
    const anyWindowOpen = regularTimes.some(t => {
      const existing = getTodayRecord(order, t);
      if (existing && existing.status !== "pending") return false; // slot already documented
      if (SPECIAL_T.includes(t)) return true;
      return toMins(now) >= toMins(t) - 30;
    });
    const autoStat = type === "administer" && regularTimes.length > 0 && !anyWindowOpen;

    setAdminForm({
      status: "given", givenAt: now, doseGiven: order.orderDetails?.dose || "", routeUsed: order.orderDetails?.route || "", siteUsed: "", notes: "",
      verifiedBy: "", fiveRights: { patient: false, drug: false, dose: false, route: false, time: false },
      holdReason: "", holdReasonCustom: "", holdUntil: "",
      delayedTo: "", delayReason: "", delayReasonCustom: "",
      prnEffect: "", prnReassessTime: "",
      adverseEvent: false, adverseDetails: "",
      statMode: autoStat, statReason: "", statReasonCustom: "",
    });
    setRateForm({ newRate: order.currentRate || order.orderDetails?.rate || "", reason: "Doctor order", reasonDetail: "", verifiedBy: "", doctorInformed: false, doctorName: "" });
    setMonitorForm({ currentRate: order.currentRate || "", bp: "", pulse: "", spo2: "", urineOutput: "", volumeInfused: "", siteCondition: "", action: "No Change", remarks: "" });
  };

  /* ── Administer medication ── */
  const submitAdminister = async () => {
    if (!actionModal) return;
    const { order, doseEntry } = actionModal;
    const f = adminForm;

    // STAT or regular scheduled time
    const isStatDose = f.statMode;
    const statReason = f.statReason === "Other" ? f.statReasonCustom.trim() : f.statReason;
    // STAT: use actual givenAt time as the scheduledTime token; Regular: use the slot time
    const sched = isStatDose ? f.givenAt : (doseEntry?.scheduledTime || "");

    // 5 Rights validation for "given"
    if (f.status === "given") {
      const allRights = Object.values(f.fiveRights).every(Boolean);
      if (!allRights) { toast.error("All 5 Rights must be verified before marking as Given"); return; }
    }
    // HAM 2-nurse check
    if (order.twoNurseRequired && f.status === "given" && !f.verifiedBy.trim()) {
      toast.error("High Alert Medication — second nurse verification required (Verified By field)"); return;
    }
    // STAT reason mandatory
    if (isStatDose && f.status === "given" && !statReason) {
      toast.error("STAT reason is mandatory for NABH documentation"); return;
    }
    if (!sched) { toast.error("Cannot determine scheduled time"); return; }

    const nextDose = isStatDose ? calcNextStatDose(f.givenAt, order.orderDetails?.frequency) : undefined;

    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/administer`, {
        scheduledTime: sched,
        status: f.status,
        // FIX (audit P15-B1): the legacy code hard-coded today's ISO
        // date, so a STAT recorded while viewing yesterday's MAR landed
        // on TODAY's chart and vanished from the day it was meant to
        // belong to. Use `marDate` (the day actually displayed) to stamp
        // the date portion. `f.givenAt` is HH:MM from the input.
        givenAt: f.status === "given"
          ? `${(marDate || new Date()).toISOString().split("T")[0]}T${f.givenAt}`
          : undefined,
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
        isStatDose: isStatDose || undefined,
        statReason: statReason || undefined,
        nextDoseAdjustedAt: nextDose || undefined,
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

  /* ── R7hr-147 — Submit a Bolus push for an infusion.
       The nurse enters a mL volume that's given manually outside the
       continuous drip rate. The backend appends to the bag's `boluses`
       array and bumps a running total that computeInfusionProgress
       picks up — so the volume bar correctly reflects ALL fluid given,
       drip + boluses. NABH MOM.2 emits CLINICAL_AUDIT INFUSION_BOLUS. */
  const submitBolus = async () => {
    if (!actionModal) return;
    const { order } = actionModal;
    const ml = parseFloat(bolusForm.volumeMl);
    if (!Number.isFinite(ml) || ml <= 0) {
      toast.error("Enter a positive bolus volume in ml");
      return;
    }
    const finalReason = bolusForm.reason === "Other"
      ? bolusForm.reasonCustom.trim()
      : bolusForm.reason;
    if (!finalReason) {
      toast.error("Reason is required for NABH documentation");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/bolus`, {
        volumeMl: ml,
        reason: finalReason,
        route: bolusForm.route || "IV",
        notes: bolusForm.notes || "",
        nurse: nurseName,
      });
      toast.success(`Bolus ${ml} ml documented`);
      setActionModal(null);
      setBolusForm({ volumeMl: "", reason: "", reasonCustom: "", route: "IV", notes: "" });
      await fetchOrders(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Bolus save failed");
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

  /* ── Resume infusion — opens styled modal (R7hr-132 — replaces the
       silent PATCH-to-InProgress restartInfusion path so every resume
       carries a documented NABH MOM.2 reason). */
  const resumeInfusion = (order) => {
    setInfModal({ order, type: "resume" });
    setInfForm({ reason: "", reasonCustom: "", holdUntil: "", notes: "" });
  };

  /* ── Submit stop / hold / resume infusion ──
     R7hr-134 — Reroute from PATCH /:id to POST /:id/nurse-infusion-action.
     Pre-R7hr-134 these three actions called PATCH /:id with `status` in the
     body; the PATCH_ALLOWED whitelist (R7hr-12-S?) silently dropped `status`
     so the chart appeared to flip Running ↔ Held but the DB never changed
     and no audit row landed (R7hr-132 was effectively a frontend-only UI
     ceremony). The new POST endpoint persists the status, stamps
     infusionStopped / stopReason / completedBy on stop, pushes a row to
     auditLog ("kab, kisne, kya, kyu") and emits a CLINICAL_AUDIT event
     (INFUSION_PAUSED / INFUSION_RESUMED / INFUSION_STOPPED) so the NABH
     MOM.2 timeline is complete.                                          */
  const submitInfAction = async () => {
    if (!infModal) return;
    const { order, type } = infModal;
    const f = infForm;
    const finalReason = f.reason === "Other" ? f.reasonCustom.trim() : f.reason;
    if (!finalReason) { toast.error("Reason is required for NABH documentation"); return; }

    // Map UI type → backend action verb.
    const ACTION_MAP = { stop: "stop", hold: "pause", resume: "resume" };
    const action = ACTION_MAP[type];
    if (!action) {
      toast.error(`Unknown infusion action: ${type}`);
      return;
    }

    setInfSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/nurse-infusion-action`, {
        action,
        reason: finalReason,
        reasonDetail: undefined,
        holdUntil: action === "pause" ? (f.holdUntil || undefined) : undefined,
        notes: f.notes || undefined,
        nurse: nurseName,
      });
      const SUCCESS_MSGS = {
        stop: "Infusion stopped & documented",
        pause: "Infusion paused & documented",
        resume: "Infusion resumed & documented",
      };
      toast.success(SUCCESS_MSGS[action]);
      setInfModal(null);
      await fetchOrders(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Action failed");
    } finally { setInfSaving(false); }
  };

  /* ── Restart infusion (resume held) ── */
  const restartInfusion = async (order) => {
    try {
      await axios.patch(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}`, { status: "InProgress" });
      toast.success("Infusion restarted");
      await fetchOrders(true);
    } catch { toast.error("Failed"); }
  };

  /* R7bq-L — Start a FRESH BAG of the same regimen.
     R7hr-139 — Now opens the verbal-order modal pre-filled with the
     previous bag's regimen instead of a silent confirm. This is
     because restarting a completed infusion is a new clinical
     decision (NABH MOM.7c) — even if it's "same drug same rate", the
     restart needs a doctor's verbal authorisation that the nurse
     documents with read-back + reason. The submit POSTs to
     /doctor-orders/verbal which fan-outs as a new DoctorOrder with
     isVerbal=true + parentOrderId pointing back at the exhausted bag. */
  const restartBag = (order) => {
    const det = order.orderDetails || {};
    setVerbalForm((prev) => ({
      ...prev,
      orderType: "IV_Fluid",
      fluidName: det.fluidName || det.displayName || det.medicineName || "",
      totalVolume: det.totalVolume || "",
      rate: order.currentRate || det.rate || "",
      infDuration: det.duration || "",
      additives: det.additives || "",
      indication: `Restart fresh bag of ${det.fluidName || "previous infusion"}`,
      verbalFromDoctor: "",
      verbalReason: "",
      verbalReasonCustom: "",
      readBackConfirmed: false,
    }));
    setVerbalModal({ open: true, parentOrder: order });
  };

  /* ── R7hr-139 — Submit verbal/telephonic order.
       Posts the captured order body + verbal metadata to the nurse-callable
       POST /doctor-orders/verbal endpoint. Backend re-stamps isVerbal +
       verbalEnteredBy from JWT (R7gw-B1-T01 pattern) so a malicious client
       can't impersonate. Pre-validation here mirrors the backend (IPSG.2
       read-back + doctor name + reason) so the nurse sees inline errors
       before the round-trip. */
  const submitVerbalOrder = async () => {
    const f = verbalForm;
    const finalReason = f.verbalReason === "Other" ? f.verbalReasonCustom.trim() : f.verbalReason;
    if (!f.verbalFromDoctor.trim()) {
      toast.error("Prescribing doctor name is required (NABH MOM.7c)");
      return;
    }
    if (!finalReason) {
      toast.error("Reason for verbal order is required");
      return;
    }
    if (!f.readBackConfirmed) {
      toast.error("Read-back confirmation is mandatory (NABH IPSG.2)");
      return;
    }

    // R7hr-176: build the list of order bodies from the shared panels'
    // arrays. Restart-bag flow falls back to the legacy single-field
    // shape (verbalForm.fluidName etc.) so the existing prefill keeps
    // working. New verbal-order flow uses the multi-row panels — same
    // UX as the Doctor IPD Initial Assessment.
    const isMed = f.orderType === "Medication";
    let orderBodies = [];

    if (verbalModal.parentOrder) {
      // Restart-bag — single row from the legacy fields
      if (!f.fluidName.trim()) {
        toast.error("Fluid name is required");
        return;
      }
      orderBodies.push({
        orderType: "IV_Fluid",
        orderDetails: {
          fluidName: f.fluidName.trim(),
          displayName: f.fluidName.trim(),
          totalVolume: f.totalVolume,
          rate: f.rate,
          route: "IV Infusion",
          duration: f.infDuration,
          additives: f.additives,
          notes: f.notes,
        },
      });
    } else if (isMed) {
      const rows = (verbalMeds || []).filter(m => (m.name || "").trim());
      if (rows.length === 0) {
        toast.error("Add at least one medicine to the verbal order");
        return;
      }
      orderBodies = rows.map(m => ({
        orderType: "Medication",
        orderDetails: {
          medicineName: m.name.trim(),
          displayName: m.name.trim(),
          genericName: m.genericName || "",
          form: m.form || "",
          dose: m.dose || "",
          route: m.route || "Oral",
          frequency: m.frequency || "",
          mealStatus: m.mealStatus || "",
          duration: m.duration || "",
          indication: m.instructions || "",
          notes: m.instructions || "",
          dilutionVolume: m.dilutionVolume || "",
          dilutionFluid: m.dilutionFluid || "",
          infuseOverMinutes: m.infuseOverMinutes || "",
        },
      }));
    } else {
      const rows = (verbalInfs || []).filter(i => (i.name || "").trim());
      if (rows.length === 0) {
        toast.error("Add at least one IV fluid / infusion to the verbal order");
        return;
      }
      orderBodies = rows.map(i => ({
        orderType: "IV_Fluid",
        orderDetails: {
          fluidName: i.name.trim(),
          displayName: i.name.trim(),
          totalVolume: i.totalVolume || "",
          rate: i.rate || "",
          route: i.route || "IV Infusion",
          duration: i.duration || "",
          additives: i.additives || "",
          strength: i.strength || "",
          notes: i.instructions || "",
        },
      }));
    }

    setVerbalSaving(true);
    let ok = 0, fail = 0;
    try {
      // POST each row sequentially — same verbal metadata applied to all.
      // Sequential (not parallel) so the backend's dedupe + order-number
      // sequencing doesn't race; this loop is small (typically 1-3 rows).
      for (const body of orderBodies) {
        try {
          await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/verbal`, {
            UHID,
            admissionId,
            visitId,
            orderType: body.orderType,
            orderDetails: body.orderDetails,
            status: "Pending",
            verbalFromDoctor: f.verbalFromDoctor.trim(),
            verbalReason: finalReason,
            readBackConfirmed: true,
            parentOrderId: verbalModal.parentOrder?._id || undefined,
          });
          ok++;
        } catch (e) {
          fail++;
          console.error("[verbal-order] row failed:", e?.response?.data?.message || e?.message);
        }
      }
      if (ok > 0 && fail === 0) {
        toast.success(verbalModal.parentOrder
          ? `Fresh bag started via verbal order from Dr. ${f.verbalFromDoctor}`
          : `${ok} verbal order${ok > 1 ? "s" : ""} documented — Dr. ${f.verbalFromDoctor} must cosign within 24h`);
      } else if (ok > 0 && fail > 0) {
        toast.warning(`${ok} order${ok > 1 ? "s" : ""} saved, ${fail} failed — check and retry the failed rows`);
      } else {
        toast.error("Verbal order failed — none of the rows saved");
        return; // keep modal open so nurse can retry
      }
      setVerbalModal({ open: false, parentOrder: null });
      // R7hr-176: reset the panels so the next "Take Verbal Order" click
      // starts with an empty form (otherwise the previous batch sticks).
      setVerbalMeds([]);
      setVerbalInfs([]);
      await fetchOrders(true);
    } finally { setVerbalSaving(false); }
  };

  /* R7bq-L — Auto-stop a running infusion when computed volume reaches
     totalVolume. Called by the volume-bar render path the first time
     `exhausted` flips true. Idempotent — re-firing is harmless because
     the route only flips Active→Completed and stamps infusionStopped.

     R7hr-153 — Switched from PATCH /:id to POST /:id/auto-complete. The
     generic PATCH whitelist (R7hr-12-S?) strips `status` + `stopReason`
     so the pre-R7hr-153 implementation never actually flipped status —
     only the cron caught up an hour later, and meanwhile the UI kept
     showing live actions (Pause / Rate Change / Add Bolus / Stop). The
     dedicated route goes through .save() so the state-machine fires
     and the completion banner + Restart Fresh Bag surfaces immediately. */
  const autoStopExhausted = async (order, mlInfused) => {
    try {
      await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${order._id}/auto-complete`, {
        nurse: nurseName || "Treatment Chart",
        mlInfused: Math.round(mlInfused),
        reason: `Total volume infused (${Math.round(mlInfused)} ml) — auto-stopped by Treatment Chart`,
      });
      await fetchOrders(true);
    } catch (_) { /* non-fatal — the cron will catch up on next tick */ }
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

  /* ── Helper: get the admin record for a time on marDate ── */
  const getTodayRecord = (order, time) => {
    // STAT token → match by scheduledTime; accept isStatDose flag OR non-standard time
    if (time?.startsWith("STAT:")) {
      const statTime = time.slice(5); // "HH:MM"
      const freq = order.orderDetails?.frequency;
      const standardSlots = new Set(FREQ_TIMES[freq] || []);
      return order.administrationRecord?.find(r => {
        if (r.scheduledTime !== statTime) return false;
        if (!r.givenAt || new Date(r.givenAt).toDateString() !== marDateStr) return false;
        return r.isStatDose || !standardSlots.has(r.scheduledTime);
      });
    }

    // Regular slot — exclude STAT records and non-standard-time records
    const freq = order.orderDetails?.frequency;
    const standardSlots = new Set(FREQ_TIMES[freq] || []);
    return order.administrationRecord?.find(r => {
      if (r.isStatDose) return false;
      if (r.scheduledTime && !standardSlots.has(r.scheduledTime)) return false;
      if (r.scheduledTime !== time) return false;
      if (r.scheduledDate && new Date(r.scheduledDate).toDateString() === marDateStr) return true;
      if (r.givenAt && new Date(r.givenAt).toDateString() === marDateStr) return true;
      return false;
    });
  };

  /* ── Scheduled times for an order ── */
  const getScheduledTimes = (order) => {
    const freq = order.orderDetails?.frequency;
    const regularTimes = FREQ_TIMES[freq] || null;
    const standardSlots = new Set(regularTimes || []);

    // Collect STAT doses for marDate: either flagged isStatDose OR a scheduledTime
    // not in the standard slot set (handles records saved before backend model update).
    const statEntries = (order.administrationRecord || []).filter(r => {
      if (!r.givenAt || new Date(r.givenAt).toDateString() !== marDateStr) return false;
      return r.isStatDose || !standardSlots.has(r.scheduledTime);
    });
    // Deduplicate by scheduledTime
    const seenStatTimes = new Map();
    statEntries.forEach(r => {
      const key = r.scheduledTime || new Date(r.givenAt).toTimeString().slice(0, 5);
      if (!seenStatTimes.has(key)) seenStatTimes.set(key, r);
    });
    const statTimes = [...seenStatTimes.keys()].map(k => `STAT:${k}`);

    if (regularTimes) return [...regularTimes, ...statTimes];

    // Unknown / custom frequency → derive from non-STAT records
    if (order.administrationRecord?.length) {
      const unique = [...new Set(
        order.administrationRecord
          .filter(r => !r.isStatDose && standardSlots.has(r.scheduledTime))
          .map(r => r.scheduledTime).filter(Boolean)
      )];
      if (unique.length) return [...unique, ...statTimes];
    }
    return statTimes.length ? statTimes : ["—"];
  };

  /* ── Color for overdue (only meaningful for today) ── */
  const isOverdue = (time) => {
    if (!isMarToday) return false; // Past/future dates: no overdue highlight
    if (!time || time?.startsWith("STAT:")) return false;
    if (time === "Immediate" || time === "As Needed" || time === "Continuous") return false;
    return time < timeNow;
  };

  /* ── Is the 30-min administration window open yet? ──
   * FIX (audit P15-B1): Q4H/Q6H/QID schedules include a 00:00 slot. The
   * naive comparison `timeNow >= slot - 30` flipped to TRUE the instant
   * `slot - 30` went negative, which meant the 00:00 dose looked "ready
   * to administer" all day long (from 00:00 onwards). Now the window
   * wraps cleanly: a 00:00 slot opens at 23:30 of the same calendar day
   * AND stays open for the rest of the night.
   */
  const isWithinWindow = (time) => {
    if (!time || time?.startsWith("STAT:")) return true; // STAT always in window
    const SPECIAL = ["Immediate","As Needed","Continuous","Before Meals","After Meals","Once Weekly","—"];
    if (SPECIAL.includes(time)) return true;
    if (!isMarToday) return true; // Past date: all slots are "open" (history view)
    const toMins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const now  = toMins(timeNow);
    const slot = toMins(time);
    const earlyOpen = slot - 30;
    if (earlyOpen >= 0) return now >= earlyOpen;
    // slot is 00:00–00:29 → opening time wraps to prior evening (23:30+).
    // Open if we're in the late-night wrap window OR already past the slot today.
    return now >= (1440 + earlyOpen) || now >= slot;
  };

  /* ── Next dose time after a STAT administration ── */
  const calcNextStatDose = (givenAtHHMM, freq) => {
    const interval = FREQ_INTERVALS[freq];
    if (!interval || !givenAtHHMM) return null;
    const [h, m] = givenAtHHMM.split(":").map(Number);
    const totalMins = h * 60 + m + interval * 60;
    const nh = Math.floor(totalMins / 60) % 24;
    const nm = totalMins % 60;
    return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
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

      {/* ── Header ──
          R7hr-125 — compactView omits this heavy dark gradient strip
          (chart title + Refresh/Raise-Indent/Print MAR action buttons)
          so the day-wise stack on the Patient Panel reads as a clean
          tabular presentation rather than a chain of standalone-page
          headers. The wrapper banner above each day already labels the
          card (Today / Yesterday / Day N). */}
      {!compactView && (
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
          {/* R7j: Raise Indent — quick jump to /nursing/indent/raise/:admissionId.
              Shown only when caller passed admissionId AND the viewer can act
              on it (Nurse / Doctor / Admin). Tinted amber so it stands out
              from the neutral Refresh / Print actions. */}
          {canRaiseIndent && (
            <button
              onClick={() => navigate(`/nursing/indent/raise/${admissionId}`)}
              title="Raise a pharmacy indent for this patient"
              style={{ padding: "5px 12px", background: "linear-gradient(135deg, #f59e0b, #d97706)", border: "1px solid rgba(255,255,255,.35)", borderRadius: 6, color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              <i className="pi pi-plus-circle" style={{ marginRight: 5, fontSize: 10 }} />Raise Indent
            </button>
          )}
          {/* R7hr-139 — Take Verbal/Telephonic Order (NABH MOM.7c + IPSG.2).
              Visible to the same actors who can raise indents (Nurse +
              Doctor + Admin). Opens a modal that captures the prescribing
              doctor, reason, read-back confirmation and the order body —
              backend POST /doctor-orders/verbal stamps isVerbal=true and
              waits for the doctor's 24h cosign. */}
          {nurseMode && admissionId && (
            <button
              onClick={() => setVerbalModal({ open: true, parentOrder: null })}
              title="Take a verbal/telephonic order from a doctor (NABH MOM.7c)"
              style={{ padding: "5px 12px", background: "linear-gradient(135deg, #06b6d4, #0891b2)", border: "1px solid rgba(255,255,255,.35)", borderRadius: 6, color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              <i className="pi pi-phone" style={{ marginRight: 5, fontSize: 10 }} />📞 Take Verbal Order
            </button>
          )}
          <button
            onClick={() => {
              // R7hr-152 — Open the day-wise Treatment Chart digest in a
              // print-friendly window (matches the patient panel layout
              // 1:1: Vitals Chart, Medications Administered table, Infusions,
              // Intake/Output, Other Observations — Yesterday + Today stacked).
              // window.print() on this page would have dumped the live MAR
              // table with all its action buttons + scroll bars; that's not
              // what the ward expects on paper.
              const qs = new URLSearchParams({
                uhid: UHID || "",
                visitId: visitId || "",
                ipdNo: visitId || "",
                admissionId: admissionId || "",
                patientName: patientName || "",
              }).toString();
              const w = window.open(`/print/treatment-chart-mar?${qs}`, "_blank",
                "popup=yes,width=1100,height=1200,resizable=yes,scrollbars=yes");
              if (!w) {
                alert("Browser blocked the print window. Allow popups for this site and try again.");
              }
            }}
            title="Print the day-wise Treatment Chart digest (matches the patient panel)"
            style={{ padding: "5px 12px", background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", borderRadius: 6, color: "white", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            <i className="pi pi-print" style={{ marginRight: 5, fontSize: 10 }} />Print MAR
          </button>
        </div>
      </div>
      )}

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

      {/* ── MAR Date Navigator ──
          R7hr-124 — hideDateNav lets the day-wise stacked wrapper own
          the per-day header (each instance is pinned to a single day
          already, so the Prev/Next/Today buttons are redundant + would
          let the user navigate off the pinned date). Default false
          preserves the standalone /treatment-chart page exactly. */}
      {!hideDateNav && (
      <div style={{ padding: "8px 16px", background: isMarToday ? "#f0fdf4" : "#fefce8", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px" }}>📅 Viewing MAR for:</span>
        <button onClick={prevMarDay} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "white", cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.blue }}>← Prev</button>
        <span style={{ fontWeight: 800, fontSize: 13, color: isMarToday ? C.green : C.amber, background: isMarToday ? C.greenL : C.amberL, border: `1.5px solid ${isMarToday ? C.greenB : C.amberB}`, borderRadius: 7, padding: "3px 12px" }}>
          {isMarToday ? "📅 Today — " : ""}{marDate.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
        </span>
        <button onClick={nextMarDay} disabled={!canGoNext} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: canGoNext ? "white" : "#f1f5f9", cursor: canGoNext ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700, color: canGoNext ? C.blue : C.muted, opacity: canGoNext ? 1 : 0.5 }}>Next →</button>
        {!isMarToday && (
          <button onClick={() => setMarDate(new Date())} style={{ padding: "4px 12px", borderRadius: 6, border: `1.5px solid ${C.green}`, background: C.greenL, cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.green }}>↩ Go to Today</button>
        )}
        {!isMarToday && (
          <span style={{ fontSize: 10, color: C.amber, fontWeight: 600, marginLeft: 4 }}>📖 History view — administration actions disabled</span>
        )}
      </div>
      )}

      {/* ── NABH Legend ──
          R7hr-125 — compactView omits this status-chip legend strip.
          The chips for each status (Given/Pending/Hold/Refused/HAM)
          are still rendered inline on every dose cell of the drug
          table, so the legend is redundant when multiple day-stacked
          instances render in succession. */}
      {!compactView && (
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
      )}

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
                          {/* R7m: Explicit Acknowledge step (NABH MOM.3).
                              Nurse acknowledges receipt of the prescription
                              before any administration. The /step endpoint
                              flips status Pending → Acknowledged, captures
                              who acknowledged + when. After acknowledgment
                              the Administer button stays visible. */}
                          <button
                            onClick={async () => {
                              try {
                                await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${o._id}/step`, {
                                  step: "Acknowledge",
                                  doneBy: nurseName,
                                });
                                toast.success(`Acknowledged: ${o.orderDetails?.medicineName || "order"}`);
                                fetchOrders(true);
                              } catch (e) {
                                toast.error(e?.response?.data?.message || "Could not acknowledge order");
                              }
                            }}
                            title="Acknowledge order (NABH MOM.3 — confirms nurse has received the order)"
                            style={{ padding: "4px 10px", background: "#0e7490", color: "white", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                            <i className="pi pi-eye" style={{ fontSize: 9, marginRight: 4 }} />Acknowledge
                          </button>
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
                            {/* R7hr-141 — Verbal-order badge. While the order is
                                still uncosigned (NABH MOM.7c §3 24h window), every
                                MAR row + every printed copy carries this badge so
                                the chain of custody is visible. Once the doctor
                                cosigns via DoctorOrdersPanel, badge disappears. */}
                            {order.isVerbal && !order.coSignedBy && (
                              <div className="verbal-order-badge" style={{ background: "#fffbeb", border: "1.5px solid #f59e0b", borderRadius: 4, padding: "2px 7px", fontSize: 9, fontWeight: 800, color: "#b45309", marginBottom: 4, display: "inline-block" }} title={`Verbal order from Dr. ${order.verbalFromDoctor || "?"} via nurse ${order.verbalEnteredByName || "?"} — pending cosign per NABH MOM.7c`}>
                                📞 VERBAL — pending cosign
                              </div>
                            )}
                            {order.isVerbal && order.coSignedBy && (
                              <div style={{ background: "#ecfdf5", border: "1px solid #86efac", borderRadius: 4, padding: "2px 7px", fontSize: 9, fontWeight: 700, color: "#15803d", marginBottom: 4, display: "inline-block" }} title={`Verbal order — cosigned by ${order.coSignedByName || "doctor"}`}>
                                ✓ verbal · cosigned
                              </div>
                            )}
                            <div style={{ color: isStopped ? C.muted : C.text }}>{order.orderDetails?.medicineName || "—"}</div>
                            {/* D11 — NABH MOM.4/MOM.5 medication-safety warnings
                                (Do-Not-Use abbreviation + LASA/tall-man). Backend
                                stamps order.safetyWarnings on save; surface each as
                                a non-blocking advisory so the decision-support
                                reaches the clinician at the point of administration. */}
                            {Array.isArray(order.safetyWarnings) && order.safetyWarnings.map((w, wi) => (
                              <div key={wi} style={{ background: C.amberL, border: `1px solid ${C.amberB}`, borderRadius: 4, padding: "3px 7px", fontSize: 9.5, fontWeight: 600, color: C.amber, marginTop: 3, lineHeight: 1.35 }} title={w.message}>
                                ⚠️ {w.message}
                              </div>
                            ))}
                            {/* R7bq-1 — IV dilution + infuse-over chip so nurse sees the drip rate
                                inline on the MAR row. On dose given, this drives the auto I/O entry. */}
                            {order.orderDetails?.dilutionVolume > 0 && (
                              <div style={{ fontSize: 9.5, fontWeight: 600, color: "#0369a1", background: "#e0f2fe", border: "1px solid #bae6fd", padding: "2px 6px", borderRadius: 4, marginTop: 3, display: "inline-block" }}>
                                💧 {order.orderDetails.dilutionVolume} ml {order.orderDetails.dilutionFluid || "NS 0.9%"}
                                {order.orderDetails.infuseOverMinutes > 0 && <> · {order.orderDetails.infuseOverMinutes} min</>}
                              </div>
                            )}
                            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{order.orderDetails?.notes}</div>
                            {/* R7m: Prescribing doctor — surfaced inline so
                                the nurse can see who ordered each med
                                without leaving the MAR row. Audit gap
                                surfaced when ordersList showed prescriber
                                only in the new-orders banner. */}
                            {order.orderedBy && (
                              <div style={{ fontSize: 10, color: C.slate, marginTop: 2, fontStyle: "italic" }}>
                                Rx by: <b style={{ fontStyle: "normal" }}>{order.orderedBy}</b>
                              </div>
                            )}
                            {/* "Ordered X ago" + duration chip */}
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
                              {(order.createdAt || order.orderedAt) && (
                                <span style={{ fontSize: 9, color: C.muted, background: "#f1f5f9", border: `1px solid ${C.border}`, borderRadius: 3, padding: "1px 5px" }}>
                                  🕐 {timeAgo(order.createdAt || order.orderedAt)}
                                </span>
                              )}
                              {/* R7m: Acknowledgment badge — green tick once
                                  nurse has formally acknowledged the order
                                  (status flipped from Pending to Acknowledged
                                  via /step endpoint). */}
                              {order.status === "Acknowledged" && (
                                <span style={{ fontSize: 9, fontWeight: 700, background: "#dcfce7", color: "#166534", border: "1px solid #86efac", borderRadius: 3, padding: "1px 5px" }}>
                                  ✓ Acknowledged
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
                            {/* R7bq-J3 — Swap the plain "InProgress" pill for a
                                "Today Done · course continues" badge when the
                                course is still running but today's slot is done. */}
                            {order.status === "InProgress" && !isStopped && !todayActionable(order) ? (
                              <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: C.greenL, color: C.green, border: `1px solid ${C.green}33` }}>
                                Today Done · course continues
                              </span>
                            ) : (
                              <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: isStopped ? C.redL : order.status === "Completed" ? C.greenL : order.status === "InProgress" ? C.blueL : C.amberL, color: isStopped ? C.red : order.status === "Completed" ? C.green : order.status === "InProgress" ? C.blue : C.amber }}>
                                {order.status}
                              </span>
                            )}
                            {order.priority === "STAT" && (
                              <div style={{ marginTop: 3, background: C.redL, color: C.red, borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 800, display: "inline-block" }}>STAT</div>
                            )}
                          </td>

                          {/* Dose cells */}
                          <td style={{ ...TD, minWidth: 460 }}>
                            {false ? null : (<>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {times.map(t => {
                                const isStat   = t.startsWith("STAT:");
                                const rec      = getTodayRecord(order, t);
                                const st       = rec?.status || "pending";
                                const cfg      = STATUS_CFG[st] || STATUS_CFG.pending;
                                const overdue  = !rec?.givenAt && st === "pending" && isOverdue(t);
                                const upcoming = !isStat && !rec && st === "pending" && !isWithinWindow(t);
                                const canClick = nurseMode && !isStopped && !upcoming && !isStat && st !== "given" && isMarToday;

                                // ── STAT dose cell ──
                                if (isStat) {
                                  return (
                                    <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                      <div style={{ fontSize: 9, fontWeight: 800, color: "#b45309", fontFamily: "monospace" }}>⚡ STAT</div>
                                      <div style={{ padding: "4px 8px", borderRadius: 6, border: "2px solid #fde047", background: "#fefce8", color: "#78350f", fontSize: 10, fontWeight: 700, textAlign: "center", minWidth: 64 }}>
                                        <div>✅ Given</div>
                                        <div style={{ fontSize: 9, fontWeight: 600, marginTop: 1 }}>{rec?.scheduledTime || t.slice(5)}</div>
                                        {rec?.givenBy && <div style={{ fontSize: 8, color: "#92400e" }}>{rec.givenBy.split(" ").slice(-1)[0]}</div>}
                                        {rec?.statReason && <div style={{ fontSize: 7, color: "#78350f", marginTop: 1, maxWidth: 68, lineHeight: 1.2 }}>{rec.statReason.slice(0, 22)}{rec.statReason.length > 22 ? "…" : ""}</div>}
                                        {rec?.nextDoseAdjustedAt && <div style={{ fontSize: 8, color: "#b45309", marginTop: 2, fontWeight: 700 }}>→ next: {rec.nextDoseAdjustedAt}</div>}
                                      </div>
                                    </div>
                                  );
                                }

                                // ── Regular dose cell ──
                                return (
                                  <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: upcoming ? "#94a3b8" : overdue ? C.red : C.muted, fontFamily: "monospace" }}>{t}</div>
                                    <div
                                      onClick={() => canClick && openAction(order, "administer", rec || { scheduledTime: t })}
                                      style={{
                                        padding: "4px 8px", borderRadius: 6, textAlign: "center", minWidth: 64, transition: "all .15s",
                                        border:      upcoming ? "1.5px dashed #cbd5e1" : `1.5px solid ${rec?.adverseEvent ? C.red : overdue ? C.red : cfg.border}`,
                                        background:  upcoming ? "#f8fafc"              : rec?.adverseEvent ? "#fef2f2" : overdue ? "#fef2f2" : cfg.bg,
                                        color:       upcoming ? "#94a3b8"              : overdue ? C.red : cfg.color,
                                        fontSize: 10, fontWeight: 700,
                                        cursor: canClick ? "pointer" : "not-allowed",
                                        opacity: upcoming ? 0.55 : 1,
                                        filter:  upcoming ? "blur(0.4px)" : "none",
                                      }}
                                      title={upcoming ? `Window opens 30 min before ${t}  — use Administer button for STAT/emergency` : st === "given" ? `🔒 Given by ${rec?.givenBy || "Nurse"} — Doctor approval required to undo` : (rec?.notes || rec?.holdReason || rec?.delayReason || "")}
                                    >
                                      {upcoming ? (
                                        <>
                                          <div>🔒 Upcoming</div>
                                          <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 1 }}>from {(() => { const [h, m] = t.split(":").map(Number); const oh = Math.floor(((h * 60 + m) - 30) / 60); const om = ((h * 60 + m) - 30) % 60; return `${String(oh).padStart(2,"0")}:${String(om).padStart(2,"0")}`; })()}</div>
                                        </>
                                      ) : (
                                        <>
                                          <div>{cfg.icon} {cfg.label}</div>
                                          {st === "given" && <div style={{ fontSize: 8, color: C.green }}>🔒 Locked</div>}
                                          {rec?.givenAt && <div style={{ fontSize: 9, fontWeight: 400, marginTop: 1 }}>{new Date(rec.givenAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>}
                                          {rec?.givenBy && <div style={{ fontSize: 8, color: cfg.color + "cc" }}>{rec.givenBy.split(" ").slice(-1)[0]}</div>}
                                          {rec?.verifiedBy && <div style={{ fontSize: 8, color: C.green }}>👥 {rec.verifiedBy.split(" ").slice(-1)[0]}</div>}
                                          {overdue && st === "pending" && <div style={{ fontSize: 8, fontWeight: 800, color: C.red }}>OVERDUE</div>}
                                          {rec?.adverseEvent && <div style={{ fontSize: 8, fontWeight: 800, color: C.red, marginTop: 1 }}>⚠ ADR</div>}
                                          {rec?.prnEffect && (
                                            <div style={{ fontSize: 8, fontWeight: 700, color: rec.prnEffect === "effective" ? C.green : rec.prnEffect === "partial" ? C.amber : C.red, marginTop: 1 }}>
                                              {rec.prnEffect === "effective" ? "✓ Effective" : rec.prnEffect === "partial" ? "◑ Partial" : "✗ No effect"}
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                    {!upcoming && rec?.holdReason && <div style={{ fontSize: 8, color: C.blue, maxWidth: 72, textAlign: "center", lineHeight: 1.2 }}>{rec.holdReason.slice(0,30)}</div>}
                                    {!upcoming && rec?.delayedTo && <div style={{ fontSize: 8, color: C.orange }}>→ {rec.delayedTo}</div>}
                                    {!upcoming && rec?.adverseEvent && (
                                      <div style={{ fontSize: 8, color: C.red, maxWidth: 72, textAlign: "center", lineHeight: 1.2, fontWeight: 700 }}>ADR reported</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {/* All today's regular doses administered → day-complete banner */}
                            {times.filter(t => !t.startsWith("STAT:")).length > 0 &&
                             times.filter(t => !t.startsWith("STAT:")).every(t => getTodayRecord(order, t)?.status === "given") && (
                              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: C.green, background: C.greenL, border: `1px solid ${C.greenB}`, borderRadius: 6, padding: "4px 10px", display: "inline-block" }}>
                                ✅ Course completed — no new doses
                              </div>
                            )}
                            </>)}
                          </td>

                          {/* Nurse actions */}
                          {nurseMode && (
                            <td style={{ ...TD }}>
                              {!isStopped && isMarToday && (
                                <button
                                  onClick={() => openAction(order, "administer", order.administrationRecord?.find(r => r.status === "pending") || { scheduledTime: times[0] })}
                                  style={{ padding: "4px 10px", background: C.blue, color: "white", border: "none", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                                  <i className="pi pi-check" style={{ fontSize: 9 }} />Administer
                                </button>
                              )}
                              {order.status === "Completed" && !isMarToday && (
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
                                      style={{ ...DOCBTN, background: "#eef2ff", color: "#4f46e5", border: "1.5px solid #c7d2fe" }}>
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
                            {/* R7m: Acknowledge before starting infusion. */}
                            <button
                              onClick={async () => {
                                try {
                                  await axios.post(`${API_ENDPOINTS.DOCTOR_ORDERS}/${o._id}/step`, {
                                    step: "Acknowledge",
                                    doneBy: nurseName,
                                  });
                                  toast.success(`Acknowledged: ${o.orderDetails?.displayName || o.orderDetails?.medicineName || "infusion"}`);
                                  fetchOrders(true);
                                } catch (e) {
                                  toast.error(e?.response?.data?.message || "Could not acknowledge");
                                }
                              }}
                              title="Acknowledge infusion order (NABH MOM.2)"
                              style={{ padding: "4px 10px", background: "#0e7490", color: "white", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
                              <i className="pi pi-eye" style={{ fontSize: 9, marginRight: 4 }} />Acknowledge
                            </button>
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
                {/* R7hr-112 — Hide Pending orders from the live monitoring card list.
                   Pending = doctor placed the order but the nurse hasn't Acknowledged +
                   Started it yet. Those orders surface in the "NEW INFUSION ORDERS"
                   alert banner above (with Acknowledge + Start Infusion buttons). Showing
                   them ALSO as a "Running" live-monitoring card would let nurses bypass
                   the ISMP-required acknowledge ceremony and would mislead anyone reading
                   the chart into believing a drip is actually going in when it isn't. */}
                {infOrders.filter(o => o.status !== "Pending").map(order => {
                  const hamBadge = order.hamFlag || isHAM(order.orderDetails?.medicineName || "");
                  const isStopped = ["Stopped","Cancelled"].includes(order.status);
                  // R7hr-147 — Backend's pause action sets status to "OnHold"
                  // (not "Held"), and R7hr-146's progress engine uses the same
                  // OnHold marker to freeze the volume bar. Pre-fix `isHeld`
                  // only matched the literal "Held", so the top-right toggle
                  // kept saying "Pause" even after a successful pause —
                  // which is the bug the user just hit. Recognise both.
                  const isHeld    = order.status === "Held" || order.status === "OnHold";
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
                          {/* R7hr-141 — Verbal-order badge on infusion card (same
                              treatment as the medication MAR row). Pending until
                              doctor cosigns; turns green once they do. */}
                          {order.isVerbal && !order.coSignedBy && (
                            <span style={{ background: "#fffbeb", color: "#b45309", border: "1.5px solid #f59e0b", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 800 }} title={`Verbal order from Dr. ${order.verbalFromDoctor || "?"} via nurse ${order.verbalEnteredByName || "?"} — pending cosign per NABH MOM.7c`}>
                              📞 VERBAL — pending cosign
                            </span>
                          )}
                          {order.isVerbal && order.coSignedBy && (
                            <span style={{ background: "#ecfdf5", color: "#15803d", border: "1px solid #86efac", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700 }} title={`Verbal order — cosigned by ${order.coSignedByName || "doctor"}`}>
                              ✓ verbal · cosigned
                            </span>
                          )}
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 13, color: isStopped ? C.muted : C.slate }}>
                              {order.orderDetails?.displayName || order.orderDetails?.medicineName || order.orderDetails?.fluidName || "IV Infusion"}
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
                          {/* Status / Play-Pause toggle
                              R7hr-132 — In nurseMode, the status badge
                              doubles as the prominent Play / Pause
                              toggle so the bedside nurse doesn't have
                              to scroll to the bottom row of actions.
                              Running → click opens Pause (reason)
                              Held    → click opens Resume (reason)
                              Stopped → static (no clinical undo from
                              this UI; if needed the doctor re-orders).
                              Bottom Pause / Resume buttons still
                              render too — they remain the explicit
                              tap target for staff who prefer the
                              actions row. */}
                          {nurseMode && !isStopped && order.status !== "Completed" ? (
                            <button
                              type="button"
                              onClick={() => isHeld ? resumeInfusion(order) : holdInfusion(order)}
                              title={isHeld
                                ? "Resume infusion — system will ask for NABH-compliant reason"
                                : "Pause infusion — system will ask for NABH-compliant reason"}
                              style={{
                                padding: "5px 14px",
                                borderRadius: 20,
                                fontSize: 12,
                                fontWeight: 800,
                                background: isHeld ? C.greenL : C.amberL,
                                color:      isHeld ? C.green  : C.amber,
                                border: `1.5px solid ${isHeld ? C.greenB : C.amberB}`,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                boxShadow: isHeld ? "0 1px 3px rgba(22,163,74,.20)" : "0 1px 3px rgba(217,119,6,.20)",
                                transition: "transform .12s",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.04)"; }}
                              onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
                            >
                              {/* R7hr-147 — User-requested copy: "Start Again"
                                  reads more naturally for a paused drip than
                                  the technical "Resume". Same backend action
                                  (nurse-infusion-action / action=resume). */}
                              {isHeld ? "▶ Start Again" : "❚❚ Pause"}
                            </button>
                          ) : (
                            <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: order.status === "Completed" ? C.greenL : isStopped ? C.redL : isHeld ? C.blueL : C.greenL, color: order.status === "Completed" ? C.green : isStopped ? C.red : isHeld ? C.blue : C.green, border: `1px solid ${order.status === "Completed" ? C.greenB : isStopped ? C.redB : isHeld ? C.blueB : C.greenB}` }}>
                              {order.status === "Completed" ? "✓ Completed" : isStopped ? "⏹ Stopped" : isHeld ? "⏸ Held" : "▶ Running"}
                            </span>
                          )}
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

                      {/* R7bq-L — Live Volume Progress bar.
                          Computed from infusionStarted + rateChanges timeline ×
                          elapsed time (capped at totalVolume). Ticks every 30s
                          via the `now` state set above. Auto-stops the order
                          when the bag is exhausted. The legacy "last monitoring
                          entry" reading was static at 0 because nurses rarely
                          back-fill volumeInfused on the per-hour monitoring
                          form — this read computes the same number the cron
                          would write. */}
                      {(() => {
                        const totalVol = parseFloat(order.orderDetails?.totalVolume);
                        if (!totalVol) return null;
                        const prog = computeInfusionProgress(order, now);
                        const pct = prog.percent;
                        const almostDone = pct >= 80 && pct < 100;
                        const barColor   = prog.exhausted ? C.green : almostDone ? C.amber : C.teal;
                        // Auto-stop on first tick where exhausted is true and
                        // the order is still considered live. Defer to avoid
                        // setState-during-render — fire on next tick.
                        if (prog.exhausted && !isStopped && order.status !== "Completed") {
                          setTimeout(() => autoStopExhausted(order, prog.ml), 0);
                        }
                        // R7hr-146 — Paused-state styling. When the nurse hits
                        // Pause, the bar should freeze visually + announce the
                        // paused status so the success toast is matched by the
                        // permanent visual state.
                        const isPaused = !!prog.isPaused;
                        const liveBadge = isStopped
                          ? null
                          : isPaused
                          ? <span style={{ color: C.amber, marginLeft: 4 }}>⏸ PAUSED</span>
                          : <span style={{ color: C.teal, marginLeft: 4 }}>● LIVE</span>;
                        return (
                          <div style={{
                            padding: "8px 16px",
                            background: isPaused ? "#fffbeb" : "#f8fafc",
                            borderBottom: `1px solid ${isPaused ? C.amberB : C.border}`,
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5, flexWrap: "wrap", gap: 8 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>
                                Volume Progress {liveBadge}
                              </span>
                              <span style={{ fontSize: 11.5, fontWeight: 700, color: isPaused ? C.amber : barColor, fontFamily: "'DM Mono', monospace" }}>
                                {prog.ml.toFixed(1)} ml / {totalVol} ml ({pct}%)
                                {isPaused && <span style={{ marginLeft: 8, color: C.amber, fontWeight: 700, fontFamily: "inherit" }}>· FROZEN AT PAUSE</span>}
                                {!isPaused && prog.etaMinutes != null && !prog.exhausted && (
                                  <span style={{ marginLeft: 8, color: C.muted, fontWeight: 600, fontFamily: "inherit" }}>
                                    · ETA {prog.etaMinutes >= 60 ? `${Math.floor(prog.etaMinutes/60)}h ${prog.etaMinutes%60}m` : `${prog.etaMinutes}m`}
                                  </span>
                                )}
                                {!isPaused && almostDone && <span style={{ marginLeft: 6, color: C.amber }}> ⚠ Almost complete</span>}
                                {prog.exhausted && <span style={{ marginLeft: 6, color: C.green }}> ✓ Bag complete</span>}
                              </span>
                            </div>
                            <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
                              <div style={{
                                height: "100%",
                                width: `${pct}%`,
                                background: isPaused ? `repeating-linear-gradient(45deg, ${C.amber}, ${C.amber} 6px, #fde68a 6px, #fde68a 12px)` : barColor,
                                borderRadius: 4,
                                transition: "width .8s ease",
                              }} />
                            </div>
                            {/* R7hr-147 — Bolus tally chip. Shows when 1+ bolus has been
                                pushed on this bag so the nurse can see "drip is X but
                                Y ml came from boluses" at a glance. */}
                            {Array.isArray(order.boluses) && order.boluses.length > 0 && (() => {
                              const totalBolus = order.boluses.reduce((s, b) => s + (parseFloat(b?.volumeMl) || 0), 0);
                              return (
                                <div style={{ marginTop: 6, fontSize: 10.5, color: "#6d28d9", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 4, padding: "1px 6px" }}>
                                    + {totalBolus.toFixed(1)} ml from {order.boluses.length} bolus push{order.boluses.length === 1 ? "" : "es"}
                                  </span>
                                </div>
                              );
                            })()}
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

                      {/* R7hr-135 — Audit-ready Completion / Stopped banner.
                          NABH MOM.2 requires the surveyor to see at a glance who
                          started the infusion, when it began, when it finished
                          and (for early stops) the documented reason. Pre-R7hr-135
                          the only completion cue was a tiny "✓ Bag complete" text
                          inside the nursing-actions row — which got truncated on
                          narrow screens and never showed the start-actor or
                          duration. This banner sits ABOVE both nurse + doctor
                          action rows so every viewer sees the same audit ribbon.

                          Data sources (all already persisted):
                          • Started by — acknowledgedBy + infusionStarted (R7hr-133
                            stamps infusionStarted on /step InProgress).
                          • Stopped by — completedBy + completedAt (set by the
                            R7hr-134 /nurse-infusion-action stop path or the
                            R7bq-L auto-stop on bag-exhausted).
                          • Reason — stopReason (mandatory at NABH MOM.2 surveys). */}
                      {(() => {
                        const isFinishedNow = isStopped || order.status === "Completed";
                        if (!isFinishedNow) return null;
                        const fmtDT = (d) => {
                          if (!d) return "—";
                          const dt = new Date(d);
                          return `${dt.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})} · ${dt.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})}`;
                        };
                        const startedAt = order.infusionStarted || order.acknowledgedAt;
                        const endedAt   = order.completedAt || order.infusionStopped;
                        let durLabel = "—";
                        if (startedAt && endedAt) {
                          const mins = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000));
                          const h = Math.floor(mins / 60); const m = mins % 60;
                          durLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
                        }
                        const headColor   = isStopped ? C.red    : C.green;
                        const headBg      = isStopped ? "#fef2f2" : "#ecfdf5";
                        const headBorder  = isStopped ? C.redB    : C.greenB;
                        const headLabel   = isStopped ? "INFUSION STOPPED" : "INFUSION COMPLETED";
                        const headIcon    = isStopped ? "⏹" : "✓";
                        const endByLabel  = isStopped ? "Stopped by" : "Auto-completed by";
                        const endByName   = order.completedBy || (isStopped ? "—" : "System (bag exhausted)");
                        return (
                          <div style={{
                            padding: "12px 16px",
                            background: headBg,
                            borderTop: `1px solid ${C.border}`,
                            borderBottom: `2px solid ${headBorder}`,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                              <span style={{
                                background: headColor, color: "white", borderRadius: 6,
                                padding: "5px 12px", fontSize: 11, fontWeight: 800, letterSpacing: ".5px",
                              }}>
                                {headIcon} {headLabel}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: headColor }}>
                                on {fmtDT(endedAt)}
                              </span>
                            </div>
                            <div style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                              gap: 8,
                            }}>
                              <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 3 }}>
                                  Started by
                                </div>
                                <div style={{ fontWeight: 700, color: C.slate, fontSize: 12 }}>{order.acknowledgedBy || "—"}</div>
                                <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", marginTop: 2 }}>
                                  {fmtDT(startedAt)}
                                </div>
                              </div>
                              <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 3 }}>
                                  {endByLabel}
                                </div>
                                <div style={{ fontWeight: 700, color: C.slate, fontSize: 12 }}>{endByName}</div>
                                <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", marginTop: 2 }}>
                                  {fmtDT(endedAt)}
                                </div>
                              </div>
                              <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px" }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 3 }}>
                                  Total infusion time
                                </div>
                                <div style={{ fontWeight: 700, color: C.slate, fontSize: 12, fontFamily: "monospace" }}>{durLabel}</div>
                                <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                                  Vol: {order.orderDetails?.totalVolume || "—"} @ {order.currentRate || order.orderDetails?.rate || "—"} ml/hr
                                </div>
                              </div>
                            </div>
                            {order.stopReason && (
                              <div style={{ marginTop: 8, padding: "6px 10px", background: "white", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }}>
                                <span style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginRight: 6 }}>
                                  Reason:
                                </span>
                                <span style={{ color: C.slate, fontWeight: 600 }}>{order.stopReason}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Nurse action buttons.
                          R7bq-L — `isFinished` = stopped OR auto-completed
                          (bag empty). When the bag is finished we hide the
                          live action buttons (Rate Change / Hold / Stop) and
                          surface the Restart Fresh Bag button instead. */}
                      {nurseMode && (() => {
                        const isFinished = isStopped || order.status === "Completed";
                        return (
                        <div style={{ padding: "10px 16px", background: "#f8fafc", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginRight: 4 }}>Nursing Actions:</span>
                          {!isFinished && (
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
                                // R7hr-147 — Renamed from "Resume" → "Start
                                // Again" so the wording matches the user's
                                // mental model + the paused-state ribbon.
                                <button onClick={() => resumeInfusion(order)}
                                  style={{ ...ACTBTN, background: C.greenL, color: C.green, border: `1.5px solid ${C.greenB}`, fontWeight: 800 }}>
                                  <i className="pi pi-play" style={{ fontSize: 10 }} /> Start Again
                                </button>
                              ) : (
                                // R7hr-132 — Renamed from "Hold" to "Pause" so the
                                // bedside nurse's mental model matches the
                                // ▶ / ❚❚ play/pause toggle in the header.
                                <button onClick={() => holdInfusion(order)}
                                  style={{ ...ACTBTN, background: C.amberL, color: C.amber, border: `1.5px solid ${C.amberB}` }}>
                                  <i className="pi pi-pause" style={{ fontSize: 10 }} /> Pause
                                </button>
                              )}
                              {/* R7hr-147 — Bolus mL entry. Nurses sometimes
                                  push a manual bolus from the same regimen
                                  (e.g. flush, pre-load, top-up). That mL
                                  needs to count toward the bag's running
                                  total so the volume-progress bar stays
                                  truthful. Available on every active card,
                                  including paused — a bolus IS a moment
                                  when fluid is given even though the drip
                                  is on hold. */}
                              <button onClick={() => openAction(order, "bolus")}
                                style={{ ...ACTBTN, background: "#ede9fe", color: "#6d28d9", border: "1.5px solid #c4b5fd" }}>
                                <i className="pi pi-plus-circle" style={{ fontSize: 10 }} /> Add Bolus
                              </button>
                              <button onClick={() => stopInfusion(order)}
                                style={{ ...ACTBTN, background: C.redL, color: C.red, border: `1.5px solid ${C.redB}` }}>
                                <i className="pi pi-stop" style={{ fontSize: 10 }} /> Stop & Document
                              </button>
                            </>
                          )}
                          {isFinished && (
                            <>
                              <span style={{ fontSize: 12, fontWeight: 700, color: isStopped ? C.red : C.green, flex: "1 1 auto" }}>
                                {isStopped ? "⏹" : "✓"} {isStopped ? "Stopped" : "Bag complete"}: {order.stopReason || (order.status === "Completed" ? "Total volume infused" : "—")}
                              </span>
                              {/* R7bq-L — Restart Bag button: continue same regimen with a fresh bag */}
                              <button onClick={() => restartBag(order)}
                                style={{ ...ACTBTN, background: C.tealL, color: C.teal, border: `1.5px solid ${C.tealB}`, marginLeft: "auto" }}>
                                <i className="pi pi-replay" style={{ fontSize: 10 }} /> Restart Fresh Bag
                              </button>
                            </>
                          )}
                        </div>
                        );
                      })()}

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
                                style={{ ...ACTBTN, background: "#eef2ff", color: "#4f46e5", border: "1.5px solid #c7d2fe" }}>
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
            <ModalHeader title={`Administer — ${order.orderDetails?.medicineName}`} sub={`${order.orderDetails?.dose} · ${order.orderDetails?.route} · ${f.statMode ? "⚡ STAT" : (dose?.scheduledTime || "")}`} color={f.statMode ? "#ca8a04" : ham ? C.red : C.primary} icon="pi-check-circle" onClose={() => setActionModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>

              {/* ── STAT / Emergency toggle ── */}
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "9px 14px", borderRadius: 9, background: f.statMode ? "#fefce8" : "#f8fafc", border: `2px solid ${f.statMode ? "#fde047" : C.border}`, transition: "all .15s" }}>
                <input type="checkbox" checked={f.statMode} onChange={e => setAdminForm(p => ({ ...p, statMode: e.target.checked }))} style={{ accentColor: "#ca8a04", width: 15, height: 15 }} />
                <span style={{ fontWeight: 800, fontSize: 12, color: f.statMode ? "#92400e" : C.muted }}>⚡ STAT / Emergency Dose — given outside the scheduled window</span>
                {f.statMode && <span style={{ marginLeft: "auto", fontSize: 10, background: "#fde047", color: "#78350f", borderRadius: 4, padding: "1px 7px", fontWeight: 700 }}>STAT</span>}
              </label>

              {/* STAT details section */}
              {f.statMode && (
                <div style={{ background: "#fefce8", border: "1.5px solid #fde047", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontWeight: 800, color: "#92400e", fontSize: 12 }}>⚡ STAT Dose Documentation — NABH mandatory</div>
                  <FL label="STAT Reason *">
                    <select style={{ ...sel, borderColor: "#fde047" }} value={f.statReason} onChange={e => setAdminForm(p => ({ ...p, statReason: e.target.value }))}>
                      <option value="">— Select reason —</option>
                      {STAT_REASONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </FL>
                  {f.statReason === "Other" && (
                    <FL label="Specify reason">
                      <input style={{ ...fld, borderColor: "#fde047" }} value={f.statReasonCustom} placeholder="Describe the clinical reason for STAT administration…" onChange={e => setAdminForm(p => ({ ...p, statReasonCustom: e.target.value }))} />
                    </FL>
                  )}
                  {calcNextStatDose(f.givenAt, order.orderDetails?.frequency) && (
                    <div style={{ fontSize: 11, color: "#78350f", background: "#fffbeb", borderRadius: 7, padding: "7px 11px", border: "1px solid #fde68a" }}>
                      📅 Next dose adjusted to: <strong>{calcNextStatDose(f.givenAt, order.orderDetails?.frequency)}</strong>
                      <span style={{ fontSize: 10, color: "#92400e", marginLeft: 6 }}>(based on {order.orderDetails?.frequency} interval from {f.givenAt})</span>
                    </div>
                  )}
                </div>
              )}

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
                      { k: "time",    label: `Right Time — ${f.statMode ? `⚡ STAT at ${f.givenAt}` : (dose?.scheduledTime || "")}` },
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

      {/* ── Stop / Pause / Resume Infusion Modal (replaces window.prompt)
          R7hr-132 — Extended from 2-type (stop|hold) to 3-type
          (stop|hold|resume). Resume reuses the same layout + reason
          picker but with green styling and the RESUME_INF_REASONS
          list — fields like Hold-Until are hidden because they only
          make sense for the pause variant. */}
      {infModal && (() => {
        const { order, type } = infModal;
        const isStop   = type === "stop";
        const isResume = type === "resume";
        const reasons  = isStop ? STOP_INF_REASONS
                      : isResume ? RESUME_INF_REASONS
                                 : HOLD_INF_REASONS;
        const color   = isStop ? C.red : isResume ? C.green : C.amber;
        const colorL  = isStop ? C.redL : isResume ? C.greenL : C.amberL;
        const colorB  = isStop ? C.redB : isResume ? C.greenB : C.amberB;
        const icon    = isStop ? "pi-stop" : isResume ? "pi-play" : "pi-pause";
        const titleTx = isStop ? "Stop & Document Infusion"
                      : isResume ? "Resume Infusion"
                                 : "Pause Infusion";
        const saveLbl = isStop ? "Stop Infusion"
                      : isResume ? "Resume Infusion"
                                 : "Pause Infusion";
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
                  : isResume
                    ? "▶ Infusion will resume now. Document the clinical reason — this is captured in the NABH MOM.2 audit trail."
                    : "❚❚ Infusion will be paused. Document reason and expected resume time. Nursing staff will be notified."}
              </div>

              {/* Reason dropdown */}
              <div>
                <label style={lbl}>{isStop ? "Stop Reason *" : isResume ? "Resume Reason *" : "Pause Reason *"}</label>
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

              {/* Hold until (only for hold/pause — not for stop, not for resume) */}
              {!isStop && !isResume && (
                <div>
                  <label style={lbl}>Pause Until (expected resume time)</label>
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
                    : isResume
                      ? "Vitals at resume, response to hold, rate verification, doctor informed if relevant…"
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

      {/* ── R7hr-139 — Verbal/Telephonic Order Modal ── */}
      {verbalModal.open && (() => {
        const f = verbalForm;
        const setF = (patch) => setVerbalForm((p) => ({ ...p, ...patch }));
        const isMed = f.orderType === "Medication";
        const titleTx = verbalModal.parentOrder ? "Restart Bag — Verbal Order" : "Take Verbal / Telephonic Order";
        return (
          <ModalOverlay width={920} onClose={() => setVerbalModal({ open: false, parentOrder: null })}>
            <ModalHeader
              title={titleTx}
              sub="NABH MOM.7c — Doctor must cosign within 24h"
              color="#0891b2" icon="pi-phone"
              onClose={() => setVerbalModal({ open: false, parentOrder: null })}
            />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* IPSG.2 read-back banner */}
              <div style={{ background: "#ecfeff", border: "1.5px solid #67e8f9", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#0e7490", fontWeight: 700 }}>
                ⚠ NABH IPSG.2 — You MUST read back the order to the prescribing doctor. Confirm spelling, dose, route, frequency BEFORE you check the read-back box.
              </div>

              {/* Order type selector — hidden if restart context (always IV_Fluid) */}
              {!verbalModal.parentOrder && (
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={() => setF({ orderType: "Medication" })}
                    style={{ flex: 1, padding: "10px", border: `2px solid ${isMed ? "#0891b2" : "#e2e8f0"}`, background: isMed ? "#ecfeff" : "white", borderRadius: 8, fontWeight: 700, color: isMed ? "#0891b2" : "#64748b", cursor: "pointer" }}>
                    💊 Medication
                  </button>
                  <button type="button" onClick={() => setF({ orderType: "IV_Fluid" })}
                    style={{ flex: 1, padding: "10px", border: `2px solid ${!isMed ? "#0891b2" : "#e2e8f0"}`, background: !isMed ? "#ecfeff" : "white", borderRadius: 8, fontWeight: 700, color: !isMed ? "#0891b2" : "#64748b", cursor: "pointer" }}>
                    💧 Infusion / IV Fluid
                  </button>
                </div>
              )}

              {/* Verbal-order metadata block */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#0891b2", textTransform: "uppercase", letterSpacing: ".5px" }}>📞 Verbal Order Documentation (NABH MOM.7c)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <FL label="Prescribing Doctor *">
                    <input style={fld} value={f.verbalFromDoctor} placeholder="Dr. Sandeep / Dr. Mehta" onChange={(e) => setF({ verbalFromDoctor: e.target.value })} />
                  </FL>
                  <FL label="Reason *">
                    <select style={fld} value={f.verbalReason} onChange={(e) => setF({ verbalReason: e.target.value })}>
                      <option value="">— Select reason —</option>
                      <option>Phone consult — doctor off-floor</option>
                      <option>Doctor in OT / cannot write</option>
                      <option>Emergency — code blue</option>
                      <option>Weekend / night round</option>
                      <option>Continuing previous regimen (restart)</option>
                      <option>Other</option>
                    </select>
                  </FL>
                </div>
                {f.verbalReason === "Other" && (
                  <FL label="Specify other reason">
                    <input style={fld} value={f.verbalReasonCustom} onChange={(e) => setF({ verbalReasonCustom: e.target.value })} />
                  </FL>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: f.readBackConfirmed ? "#ecfdf5" : "#fef2f2", border: `1.5px solid ${f.readBackConfirmed ? "#86efac" : "#fecaca"}`, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, color: f.readBackConfirmed ? "#15803d" : "#dc2626" }}>
                  <input type="checkbox" checked={f.readBackConfirmed} onChange={(e) => setF({ readBackConfirmed: e.target.checked })} style={{ width: 16, height: 16 }} />
                  ✓ I have read back the order to the prescribing doctor (NABH IPSG.2 mandatory)
                </label>
              </div>

              {/* R7hr-176: same shared panels used by the Doctor IPD Initial
                  Assessment. Doctor dictates 1-N meds or fluids; submit
                  loops and POSTs one verbal order per row. */}
              {isMed && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
                    💊 Medication Orders ({verbalMeds.length})
                  </div>
                  <PrescriptionPanel value={verbalMeds} onChange={setVerbalMeds} />
                  <div style={{ fontSize: 10.5, color: "#92400e", marginTop: 6, fontStyle: "italic" }}>
                    Add one or more medicines. All will be saved under the same verbal-order metadata above.
                  </div>
                </div>
              )}

              {!isMed && (
                <div style={{ background: "#ecfeff", border: "1px solid #67e8f9", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#0e7490", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
                    💧 IV Fluid / Infusion Orders ({verbalInfs.length})
                  </div>
                  <InfusionPanel value={verbalInfs} onChange={setVerbalInfs} />
                  <div style={{ fontSize: 10.5, color: "#0e7490", marginTop: 6, fontStyle: "italic" }}>
                    Add one or more infusions. Vasopressor / insulin / heparin drips will auto-tag as HAM on save.
                  </div>
                </div>
              )}
            </div>
            <ModalFooter
              onCancel={() => setVerbalModal({ open: false, parentOrder: null })}
              onSave={submitVerbalOrder}
              saving={verbalSaving}
              saveLabel={verbalModal.parentOrder ? "Restart Bag (Verbal)" : "Save Verbal Order"}
            />
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

      {/* ── Add Bolus mL Entry Modal (R7hr-147) ── */}
      {actionModal?.type === "bolus" && (() => {
        const order = actionModal.order;
        return (
          <ModalOverlay onClose={() => setActionModal(null)}>
            <ModalHeader title="Add Bolus mL" sub={order.orderDetails?.displayName || order.orderDetails?.fluidName} color="#7c3aed" icon="pi-bolt" onClose={() => setActionModal(null)} />
            <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#6d28d9", fontWeight: 700 }}>
                NABH MOM.2 — Bolus push given outside the continuous drip. Volume is added to the bag's total intake automatically.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FL label="Bolus Volume (ml) *">
                  <input type="number" style={fld} value={bolusForm.volumeMl} placeholder="e.g. 100" onChange={e => setBolusForm(p => ({ ...p, volumeMl: e.target.value }))} />
                </FL>
                <FL label="Route">
                  <select style={sel} value={bolusForm.route} onChange={e => setBolusForm(p => ({ ...p, route: e.target.value }))}>
                    {["IV","IV Push","Central Line","Peripheral"].map(r => <option key={r}>{r}</option>)}
                  </select>
                </FL>
              </div>
              <FL label="Reason *">
                <select style={sel} value={bolusForm.reason} onChange={e => setBolusForm(p => ({ ...p, reason: e.target.value, reasonCustom: "" }))}>
                  <option value="">— Select reason —</option>
                  {BOLUS_REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </FL>
              {bolusForm.reason === "Other" && (
                <FL label="Specify Reason">
                  <input style={fld} value={bolusForm.reasonCustom} placeholder="Free-text clinical reason…" onChange={e => setBolusForm(p => ({ ...p, reasonCustom: e.target.value }))} />
                </FL>
              )}
              <FL label="Notes / Observations">
                <textarea style={ta} value={bolusForm.notes} placeholder="Patient response, time of push, any concerns…" onChange={e => setBolusForm(p => ({ ...p, notes: e.target.value }))} />
              </FL>
            </div>
            <ModalFooter onCancel={() => setActionModal(null)} onSave={submitBolus} saving={saving} saveLabel="Save Bolus" />
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
// R7hr-181 (USER UI-only, 2026-06-11) — optional `width` prop. Default 640
// keeps every existing modal byte-identical; the verbal-order modal passes
// a wider value so the multi-row PrescriptionPanel / InfusionPanel rows
// (7 cells + dilution strip) breathe like they do on the IA page instead
// of truncating their selects ("Frequen…", "Meal st…").
function ModalOverlay({ children, onClose, width = 640 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", backdropFilter: "blur(4px)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, width, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.3)" }} onClick={e => e.stopPropagation()}>
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
