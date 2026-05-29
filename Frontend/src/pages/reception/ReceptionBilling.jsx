/**
 * ReceptionBilling.jsx — Front-desk billing & payment collection
 *
 * URL: /reception-billing          → search a patient (UHID)
 *      /reception-billing/:uhid    → directly load that patient's bills
 *
 * Receptionist-focused — does NOT add clinical services (nurses/doctors do
 * that via auto-billing triggers). Receptionist sees the bill, accepts
 * payment (cash/UPI/card/cheque), prints receipt.
 *
 * API:
 *   GET  /api/billing/uhid/:UHID         → patient + bills[]
 *   GET  /api/billing/:billId            → full bill (items + payments)
 *   POST /api/billing/:billId/generate   → finalize a DRAFT bill
 *   POST /api/billing/:billId/payment    → {amount, paymentMode, transactionId?, receivedBy?}
 *   GET  /api/reports/day-book?date=YYYY-MM-DD   (R7bh-F1: replaced
 *     legacy /api/billing/collection-summary; new endpoint routes
 *     through dayBookService and includes reversed-refund cash-back.)
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import { fetchHospitalSettings } from "../../Components/print/useHospitalSettings";
import { useAuth } from "../../context/AuthContext";
import ActivePatientDirectory from "../../Components/ActivePatientDirectory";
import "./reception-shared.css";
// R7ar-P1-14/D4-aq-02: centralised Decimal128 unwrap.
import { toMoney } from "../../utils/money";
import { confirm } from "../../Components/common/ConfirmDialog";

const fmtCur  = (n) => `₹${(toMoney(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS_CLASS = {
  DRAFT:     "pending",
  GENERATED: "submitted",
  PARTIAL:   "pending",
  PAID:      "cleared",
  CANCELLED: "revoked",
  REFUNDED:  "expired",
};

/* ────────────────────────────────────────────────────────────────
   IPD-Live-Ledger-aligned theme tokens. Defined once; referenced
   across the hero card, KPI strip, action row, and section
   accordions so the page matches IPDBillingLedger.jsx visually.
   Do not import additional palettes — keep one source of truth.
   ──────────────────────────────────────────────────────────────── */
const C = {
  bg:      "#f8fafc",
  card:    "#ffffff",
  border:  "#e2e8f0",
  text:    "#0f172a",
  muted:   "#64748b",
  subtle:  "#f8fafc",
  blue:    "#1d4ed8",  blueL:   "#eff6ff",
  green:   "#16a34a",  greenL:  "#dcfce7",
  red:     "#dc2626",  redL:    "#fef2f2",
  orange:  "#ea580c",  orangeL: "#fff7ed",
  amber:   "#d97706",  amberL:  "#fffbeb",
  purple:  "#7c3aed",  purpleL: "#f5f3ff",
  teal:    "#0d9488",  tealL:   "#ccfbf1",
  pink:    "#db2777",  pinkL:   "#fce7f3",
  slate:   "#475569",
};
const FONT_SANS = "'DM Sans', 'Inter', system-ui, sans-serif";
const FONT_MONO = "'DM Mono', monospace";

/* KPI tile — mirrors the IPDBillingLedger KPI helper so the strip
   on this page has identical sizing, padding, and typography. */
function KPI({ label, value, tone = C.text, sub, mono = true }) {
  return (
    <div style={{
      flex: 1, minWidth: 170,
      background: C.card, border: `1.5px solid ${C.border}`,
      borderRadius: 12, padding: "12px 14px",
      boxShadow: "0 1px 2px rgba(15,23,42,.04)",
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone, marginTop: 4, fontFamily: mono ? FONT_MONO : FONT_SANS, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, minHeight: 14 }}>{sub || "—"}</div>
    </div>
  );
}

/* Section accordion header — colored title pill on the left
   (icon + title + N-lines sub), right-aligned total + chevron. */
function SectionHeader({ icon, title, sub, total, tone = C.blue, toneBg = C.blueL, right, collapsed, onToggle }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px",
      background: toneBg,
      borderBottom: `1.5px solid ${C.border}`,
      borderTopLeftRadius: 12, borderTopRightRadius: 12,
    }}>
      <i className={`pi ${icon}`} style={{ color: tone, fontSize: 14 }} />
      <div style={{ fontSize: 12.5, fontWeight: 800, color: tone, textTransform: "uppercase", letterSpacing: ".4px" }}>
        {title}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>· {sub}</div>
      )}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {right}
        {total != null && (
          <div style={{ fontFamily: FONT_MONO, fontWeight: 800, color: C.text, fontSize: 13 }}>{total}</div>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            style={{ border: "none", background: "transparent", color: tone, cursor: "pointer", fontSize: 14, padding: 2 }}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <i className={`pi ${collapsed ? "pi-chevron-down" : "pi-chevron-up"}`} />
          </button>
        )}
      </div>
    </div>
  );
}

// Matches PaymentSchema.paymentMode enum on the backend. TPA_CLAIM is used
// when the TPA reimbursement settles a previously-pending share of a bill.
const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CHEQUE", "ONLINE", "TPA_CLAIM"];
const ADVANCE_MODES = ["CASH", "UPI", "CARD", "CHEQUE", "ONLINE"];

/* R7b-HIGH-3a: standardized on the central `openPrint()` helper so the
   advance-receipt flow benefits from the same sessionStorage handling,
   popup-blocker alert, fresh-window timestamp, and slug encoding as
   every other print in the app (R14 invariant). Previously this used a
   handcrafted sessionStorage write + window.open which diverged on the
   popup-blocked UX path. Single source of truth — both the
   success-state Print button and the per-row Reprint icon call this. */
function printAdvanceReceipt(advance, patient) {
  if (!advance || !patient) return;
  // R7en-2: receipt now shows Department + Doctor in the slots previously
  // occupied by Hospital/Customer GSTIN; pull from advance.admission when
  // populated (BillingService populates the nested admission ref).
  openPrint("advance-receipt", {
    receiptNo:    advance.receiptNumber,
    patientName:  [patient.title, patient.fullName].filter(Boolean).join(" "),
    uhid:         patient.UHID,
    ipdNo:        advance.admission?.admissionNumber || null,
    admissionDate: advance.admission?.admissionDate || null,
    bedNumber:    advance.admission?.bedNumber || null,
    wardName:     advance.admission?.wardName || null,
    department:   advance.admission?.department || null,
    doctor:       advance.admission?.attendingDoctor || null,
    date:         advance.paidAt || advance.createdAt || new Date().toISOString(),
    amount:       toMoney(advance.amount),
    method:       advance.paymentMode,
    refNo:        advance.transactionId,
    depositPurpose: advance.remarks || "hospitalization advance",
    // R7bh-F1 / META-1: PrintAudit anchor — bumps printCount on the
    // underlying PatientAdvance so reprints render the DUPLICATE
    // watermark and a row lands in the PrintAudit register.
    printAudit: {
      entityType:   "AdvanceReceipt",
      entityId:     advance._id,
      entityNumber: advance.receiptNumber,
      UHID:         patient.UHID,
      patientName:  [patient.title, patient.fullName].filter(Boolean).join(" "),
    },
  });
}

/* R7ao: Refund slip for an advance deposit — printed after the receptionist
   returns the unspent portion of a deposit to the patient (e.g. discharge
   with leftover credit). Uses the RefundReceipt print template — field
   names (sourceReceiptNo, sourceMethod, sourceAmount) mirror the bill-
   refund flow so the slip looks identical across both refund types. */
function printAdvanceRefundReceipt(advance, patient) {
  if (!advance || !patient) return;
  const refunded  = toMoney(advance.refundedAmount);
  const original  = toMoney(advance.amount);
  const applied   = toMoney(advance.appliedAmount);
  openPrint("refund-receipt", {
    receiptNo:        `${advance.receiptNumber}-RF`,
    patientName:      [patient.title, patient.fullName].filter(Boolean).join(" "),
    uhid:             patient.UHID,
    ipdNo:            advance.admission?.admissionNumber || null,
    date:             advance.refundedAt || new Date().toISOString(),
    amount:           refunded,
    method:           advance.refundMode || "CASH",
    refNo:            advance.refundTransactionId || "",
    reason:           advance.refundReason || "Patient discharge — unspent advance returned",
    refundedBy:       advance.refundedBy || "Reception",
    approvedBy:       advance.refundedBy || "Reception",
    sourceReceiptNo:  advance.receiptNumber,
    sourceMethod:     advance.paymentMode,
    sourceAmount:     original,
    runningBalance:   Math.max(0, +(original - applied - refunded).toFixed(2)),
    // R7bh-F1 / META-1: PrintAudit anchor — advance refunds carry the
    // PatientAdvance._id (same row that backed the receipt) so the
    // refund slip's printCount is tracked alongside its original.
    printAudit: {
      entityType:   "RefundReceipt",
      entityId:     advance._id,
      entityNumber: `${advance.receiptNumber}-RF`,
      UHID:         patient.UHID,
      patientName:  [patient.title, patient.fullName].filter(Boolean).join(" "),
    },
  });
}

export default function ReceptionBilling() {
  const { uhid: paramUhid } = useParams();
  const navigate = useNavigate();
  // ?action= query param drives a deep-link from ReceptionConsole's
  // post-registration success card. After a fresh OPD/IPD/DC/ER
  // registration the receptionist clicks "Collect Payment / Advance"
  // and lands here with one of:
  //   ?action=opd-payment   → auto-open PaymentModal on the latest
  //                            DRAFT OPD bill once it loads
  //   ?action=advance       → auto-open TakeAdvanceModal so the
  //                            receptionist can record the IPD / DC /
  //                            ER admission deposit without hunting for
  //                            the button
  // Consumed exactly once per query-param value so reopening the page
  // doesn't keep popping the modal.
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const [uhid, setUhid] = useState(paramUhid || "");
  const [patient, setPatient] = useState(null);
  const [bills, setBills] = useState([]);
  // R7en-CURRENT-CTX: toggle to show historical (non-current-visit) bills
  // + advances. Default hidden so the page only shows the CURRENT visit's
  // billing context (IPD admission OR today's OPD walk-in). Receptionists
  // were getting confused seeing an IPD patient's 5-month-old OPD bill
  // mixed with the active IPD draft on the same page.
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeBill, setActiveBill] = useState(null); // full bill detail
  const [billLoading, setBillLoading] = useState(false);
  const [payTarget, setPayTarget] = useState(null);
  const [refundTarget, setRefundTarget] = useState(null);
  // R7ao: refund target for an advance-deposit row (separate from bill refund target).
  const [advanceRefundTarget, setAdvanceRefundTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [addSvcTarget, setAddSvcTarget] = useState(null);   // DRAFT bill currently being amended
  const [settleTarget, setSettleTarget] = useState(null);   // GENERATED/PARTIAL bill being adjusted at counter
  const [showBulkCollect, setShowBulkCollect] = useState(false);  // "Collect All Dues" modal on Outstanding KPI
  const [showBulkSettle,  setShowBulkSettle]  = useState(false);  // "Settle All" modal on Outstanding KPI
  const [showNewBill,     setShowNewBill]     = useState(false);  // "New Bill" creator (ad-hoc DRAFT)
  const [todayCollection, setTodayCollection] = useState(null);
  // ── Advance-deposit state — fetched alongside bills on every load.
  //    advances: full ledger; unspentAdv: aggregated remaining balance
  //    (drives the "Advance Credit" KPI + Apply-Advance button gate).
  //    showAdvDlg toggles the TakeAdvanceModal.
  const [advances,      setAdvances]      = useState([]);
  const [unspentAdv,    setUnspentAdv]    = useState(0);
  const [showAdvDlg,    setShowAdvDlg]    = useState(false);

  /* ─── R7en-CURRENT-CTX: split bills + advances into "current visit"
       vs "history" ────────────────────────────────────────────────
     Receptionists were seeing IPD draft + 5-month-old OPD bill on the
     same screen for the same patient, which made it unclear which row
     they were actually meant to collect against. Now:

       • If the patient has any ACTIVE IPD bill (DRAFT / GENERATED /
         PARTIAL) → currentContext = { type: "IPD", admissionNumber }.
         Current view shows ONLY bills for that admission + advances
         tied to it (or unscoped advances). History view shows the rest.
       • Else if there are OPD/Daycare/Emergency bills created today →
         currentContext = { type: "OPD" } and current shows today's
         non-IPD activity.
       • Else → patient has no active visit; current view is empty and
         the user is nudged to click History to see past bills.

     History toggle (showHistory) flips the lists shown — current and
     history never appear simultaneously, so receptionists see exactly
     one bucket and can drill into the other on demand. */
  const { currentBills, pastBills, currentAdvances, pastAdvances, currentContext } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const isToday = (d) => {
      if (!d) return false;
      const x = new Date(d); x.setHours(0, 0, 0, 0);
      return x.getTime() === today.getTime();
    };
    const isActiveStatus = (s) => ["DRAFT", "GENERATED", "PARTIAL"].includes(s);

    // 1. Look for an active IPD bill
    const activeIpd = bills.find(b =>
      b.visitType === "IPD" && isActiveStatus(b.billStatus));
    if (activeIpd?.admissionNumber) {
      const adm = activeIpd.admissionNumber;
      const cur = bills.filter(b =>
        b.visitType === "IPD" && b.admissionNumber === adm);
      const past = bills.filter(b => !cur.includes(b));
      const curAdv = advances.filter(a =>
        a.admission?.admissionNumber === adm || !a.admission);
      const pastAdv = advances.filter(a => !curAdv.includes(a));
      return { currentBills: cur, pastBills: past, currentAdvances: curAdv, pastAdvances: pastAdv,
               currentContext: { type: "IPD", admissionNumber: adm } };
    }

    // 2. No active IPD — look for today's OPD/Daycare/Emergency
    const todayBills = bills.filter(b =>
      b.visitType !== "IPD" && (isToday(b.createdAt) || isActiveStatus(b.billStatus)));
    if (todayBills.length > 0) {
      const past = bills.filter(b => !todayBills.includes(b));
      // OPD advances rarely have admission scoping — keep advances with no
      // admission OR ones created today as "current".
      const curAdv = advances.filter(a => !a.admission || isToday(a.createdAt) || isToday(a.paidAt));
      const pastAdv = advances.filter(a => !curAdv.includes(a));
      return { currentBills: todayBills, pastBills: past, currentAdvances: curAdv, pastAdvances: pastAdv,
               currentContext: { type: "OPD" } };
    }

    // 3. No current visit at all
    return { currentBills: [], pastBills: bills, currentAdvances: [], pastAdvances: advances,
             currentContext: null };
  }, [bills, advances]);

  // Pick the active list based on the toggle
  const displayBills    = showHistory ? pastBills    : currentBills;
  const displayAdvances = showHistory ? pastAdvances : currentAdvances;
  // ── Smart search + active-patient directory ────────────────────
  //   searchQ        — text in the search box (name / UHID / phone)
  //   searchResults  — live dropdown matches (debounced 250ms)
  //   searchOpen     — toggles the dropdown visibility
  //   directory      — patients of the currently selected type
  //   listType       — "ALL" / "OPD" / "IPD" / "Daycare" / "Emergency" / "Services"
  //   directoryLoading — spinner while the tab list refreshes
  const [searchQ,         setSearchQ]         = useState("");
  const [searchResults,   setSearchResults]   = useState([]);
  const [searchOpen,      setSearchOpen]      = useState(false);
  const [searchBusy,      setSearchBusy]      = useState(false);
  const [directory,       setDirectory]       = useState([]);
  const [listType,        setListType]        = useState("OPD");
  const [directoryLoading,setDirectoryLoading]= useState(false);
  const searchDebRef = React.useRef(null);

  // R7as-FIX-1: loadTodaySummary declared BEFORE `load` to avoid Temporal-Dead-
  // Zone ReferenceError. Pre-R7as the function lived ~200 lines below `load`,
  // but `load`'s deps array `[loadTodaySummary]` evaluated during every render
  // — TDZ access threw `ReferenceError: Cannot access 'loadTodaySummary' before
  // initialization` and React rendered a blank tree (caught by the outer
  // ErrorBoundary). Symptom: clicking "Open" on /accounts → blank screen.
  const loadTodaySummary = useCallback(() => {
    const istKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    // R7bh-F1 / META-4 (R7bg-6-CRIT-5): swap legacy collection-summary
    // for /api/reports/day-book. The page reads only `totalCollected`
    // from this payload, so we map `data.summary.collections` →
    // `totalCollected` (day-book is the reversal-aware ledger).
    return axios.get(`${API_ENDPOINTS.BASE}/reports/day-book?date=${istKey}`)
      .then(({ data }) => {
        const s = data?.data?.summary;
        if (!s) { setTodayCollection(null); return; }
        setTodayCollection({
          totalCollected: s.collections,
          txnCount:       s.collectionsCount,
          netCashFlow:    s.netCashFlow,
        });
      })
      .catch((e) => { if (!axios.isCancel(e)) console.error("[ReceptionBilling] day-book:", e?.message); });
  }, []);

  const load = useCallback(async (uhidArg) => {
    if (!uhidArg) return;
    setLoading(true);
    setPatient(null); setBills([]); setActiveBill(null);
    setAdvances([]); setUnspentAdv(0);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BILLING}/uhid/${uhidArg}`);
      const p = data?.patient || data?.data?.patient;
      const list = data?.bills || data?.data?.bills || [];
      if (!p) { toast.warning("No patient found for that UHID"); setLoading(false); return; }
      setPatient(p);
      setBills(list);

      // R7eq-FIX-2 — billingService.getBillsByUHID deliberately drops
      // populate("admission") for perf (see Backend billingService.js
      // line 294). When an IPD/Daycare/ER bill is present we therefore
      // have no bed/ward/admission-date on the bill payload, and
      // Patient.currentAdmission on the patient doc is just an ObjectId
      // (not nested). Probe /admissions/patient/:patientId — same call
      // the picker click handler runs — and stash the resolved active
      // inpatient admission on patient.currentAdmission so the hero
      // card's "Bed / Room" + "Admission" slots populate.
      //
      // Same gap exists for OPD bills: the bill carries only `visitId`
      // (no doctor/department denormalization) and the patient root has
      // no `currentVisit` field. So we ALSO probe /opd/patient/:pid for
      // the most recent OPD visit and stash it on patient.currentVisit
      // so the hero card's "Doctor" + "Department" slots populate.
      const hasIpdBill = list.some(
        (b) => b.visitType === "IPD" || b.visitType === "Daycare"
            || b.visitType === "Day Care" || b.visitType === "Emergency",
      );
      const hasOpdBill = list.some((b) => b.visitType === "OPD");
      if (hasOpdBill && !hasIpdBill && p._id) {
        try {
          const vr = await axios.get(
            `${API_ENDPOINTS.BASE}/opd/patient/${encodeURIComponent(p._id)}`,
          );
          const varr = vr?.data?.data || vr?.data?.visits || vr?.data || [];
          // Most recent first (server sorts by visitDate desc already).
          let recent = (Array.isArray(varr) ? varr : [])[0];
          if (recent) {
            // R7eq-FIX-3 — some OPD visits store the department as a raw
            // ObjectId on `.department` (legacy) without populating
            // `.departmentId`. Doctor profiles always carry their
            // department fully populated, so when the visit doesn't have
            // a usable department name we merge the doctor's into
            // `recent.doctorProfile.department` so the hero fallback
            // chain can read `cv.doctorProfile.department.departmentName`.
            const visitDeptName = recent?.departmentId?.departmentName
                                || recent?.departmentName;
            const docId = recent?.doctorId?._id || recent?.doctorId;
            if (!visitDeptName && docId) {
              try {
                const dr = await axios.get(
                  `${API_ENDPOINTS.BASE}/doctors/${encodeURIComponent(docId)}`,
                );
                const docDoc = dr?.data?.data || dr?.data?.doctor || dr?.data;
                if (docDoc) {
                  recent = { ...recent, doctorProfile: docDoc };
                }
              } catch (e) { /* soft-fail */ }
            }
            setPatient((prev) => prev ? { ...prev, currentVisit: recent } : prev);
          }
        } catch (e) {
          console.warn("[ReceptionBilling] OPD visit probe failed:", e?.message);
        }
      }
      if (hasIpdBill && p._id) {
        try {
          const ar = await axios.get(
            `${API_ENDPOINTS.BASE}/admissions/patient/${encodeURIComponent(p._id)}`,
          );
          const arr = ar?.data?.admissions || ar?.data?.data || ar?.data || [];
          // R7eq-FIX-2 — admission.admissionType is the *category* enum
          // (Planned / Emergency / Day Care / OPD-to-IPD / etc.), NOT a
          // visit-type tag. Real "is this an inpatient stay" signal is:
          //   • status === "Active"
          //   • AND either has a bed assigned (bedId / hasBed / bedNumber)
          //     OR the admissionNumber prefix says IPD/ER/DC
          // This mirrors the IPDBillingLedger's own admission resolver.
          const active = (Array.isArray(arr) ? arr : []).find((a) => {
            if (!a || a.status !== "Active") return false;
            const num = String(a.admissionNumber || "").toUpperCase();
            return !!(a.bedId
              || a.hasBed
              || a.bedNumber
              || /^(IPD|ER|EMG|DC|DAYCARE|DAY-CARE)-/.test(num)
              || a.admissionType === "IPD"
              || a.admissionType === "Emergency"
              || a.admissionType === "Day Care"
              || a.admissionType === "Daycare");
          });
          if (active) {
            setPatient((prev) => prev ? { ...prev, currentAdmission: active } : prev);
          }
        } catch (e) {
          console.warn("[ReceptionBilling] admission probe failed:", e?.message);
        }
      }

      // Parallel fetch — never blocks bill rendering if it 5xxs.
      try {
        const adv = await axios.get(`${API_ENDPOINTS.BILLING}/advance/uhid/${encodeURIComponent(uhidArg)}`);
        setAdvances(adv?.data?.data?.advances || adv?.data?.advances || []);
        setUnspentAdv(Number(adv?.data?.data?.totalUnspent ?? adv?.data?.meta?.totalUnspent) || 0);
      } catch (e) {
        console.warn("[ReceptionBilling] advance load failed:", e?.message);
      }
      // R7ar-P1-13: refresh the Today tile alongside the patient load.
      loadTodaySummary();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load bills");
    } finally { setLoading(false); }
  }, [loadTodaySummary]);

  useEffect(() => { if (paramUhid) load(paramUhid); }, [paramUhid, load]);

  /* ─── Deep-link modal opener ────────────────────────────────────
     Once the patient + bills finish loading, honour the ?action=
     hint from ReceptionConsole's post-registration redirect:
       opd-payment → open PaymentModal on the most recent OPD bill
                     (DRAFT auto-generates inside PaymentModal.submit()
                     per Fix B, so it doesn't matter if the bill is
                     still DRAFT here)
       advance     → open TakeAdvanceModal so the receptionist can
                     record the admission deposit immediately
     Self-consumes the URL param via setSearchParams so a page
     refresh / back-navigation doesn't re-trigger the modal. ─── */
  useEffect(() => {
    if (!patient || loading) return;
    const action = searchParams.get("action");
    if (!action) return;

    if (action === "opd-payment") {
      // Prefer a DRAFT OPD bill (just-created), else any GENERATED/PARTIAL
      // OPD bill with balance > 0, else the most recent OPD bill at all.
      //
      // R7aa: a bill whose recalcTotals never ran reports balanceAmount=0
      // even when items hold real money. Fall back to summing billItems
      // when balanceAmount is stale, so we still pick that bill for
      // collection instead of skipping past it.
      const opdBills = (bills || []).filter(b => b.visitType === "OPD");
      const effectiveBalance = (b) => {
        const bal = Number(b.balanceAmount || 0);
        if (bal > 0) return bal;
        const itemsNet = (b.billItems || []).reduce((s, i) => s + Number(i.netAmount || 0), 0);
        const paid     = (b.payments   || []).reduce((s, p) => s + Number(p.amount    || 0), 0);
        return Math.max(0, itemsNet - paid);
      };
      const target =
        opdBills.find(b => b.billStatus === "DRAFT") ||
        opdBills.find(b => ["GENERATED","PARTIAL"].includes(b.billStatus) && effectiveBalance(b) > 0) ||
        opdBills[0];
      if (target) setPayTarget(target);
      else toast.info("No OPD bill found yet — try again in a moment");
    } else if (action === "advance") {
      setShowAdvDlg(true);
    } else if (action === "collect-all") {
      // R7bp: deep-link from the Receptionist Dashboard's Patient Credit
      // Ledger (multi-select footer "Collect All for Patient" button).
      // The receptionist has already picked one UHID; opening the
      // BulkCollectModal here lets the existing FIFO flow distribute the
      // collected amount across every open bill for the patient.
      // Guard: only fire when there's at least one open bill — otherwise
      // the modal would render an empty allocation table and the apply
      // button would no-op (R7am surfaces this same warning).
      const openBills = (bills || []).filter((b) =>
        ["GENERATED", "PARTIAL"].includes(b.billStatus),
      );
      if (openBills.length === 0) {
        toast.info("No open bills found for this patient");
      } else {
        setShowBulkCollect(true);
      }
    }

    // Self-consume so refresh doesn't re-pop the modal.
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient, loading, bills]);

  // ── Live search — fires 250ms after the user stops typing. ─────
  // The /patients/search endpoint searches name + UHID + contact +
  // patientId + email simultaneously, so the cashier can type any
  // identifier without having to pick which one in advance.
  useEffect(() => {
    if (searchDebRef.current) clearTimeout(searchDebRef.current);
    const q = (searchQ || "").trim();
    if (q.length < 2) { setSearchResults([]); return; }
    const ac = new AbortController();
    searchDebRef.current = setTimeout(async () => {
      setSearchBusy(true);
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.PATIENTS}/search?q=${encodeURIComponent(q)}&limit=12`,
          { signal: ac.signal },
        );
        if (!ac.signal.aborted) setSearchResults(data?.data || data || []);
      } catch (e) {
        if (!axios.isCancel(e)) console.warn("[ReceptionBilling] search:", e?.message);
      } finally {
        if (!ac.signal.aborted) setSearchBusy(false);
      }
    }, 250);
    return () => { ac.abort(); if (searchDebRef.current) clearTimeout(searchDebRef.current); };
  }, [searchQ]);

  // ── Directory loader — refreshed whenever listType changes. ────
  // Pulls active patients of the selected registrationType (or all,
  // sorted by createdAt desc). Limit 60 keeps the grid responsive on
  // larger hospitals while still showing everyone for a small site.
  useEffect(() => {
    const ac = new AbortController();
    setDirectoryLoading(true);
    const params = new URLSearchParams({ limit: "60" });
    if (listType !== "ALL") params.set("registrationType", listType);
    axios.get(`${API_ENDPOINTS.PATIENTS}?${params.toString()}`, { signal: ac.signal })
      .then(({ data }) => {
        if (ac.signal.aborted) return;
        const rows = data?.patients || data?.data || (Array.isArray(data) ? data : []);
        setDirectory(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => { if (!axios.isCancel(e)) console.warn("[ReceptionBilling] directory:", e?.message); })
      .finally(() => { if (!ac.signal.aborted) setDirectoryLoading(false); });
    return () => ac.abort();
  }, [listType]);

  // Helper — load a patient row when the user clicks anywhere in the
  // search dropdown or directory grid. Updates URL too so a refresh
  // re-loads the same patient.
  //
  // R7ae: context-aware routing. If the patient has an ACTIVE inpatient
  // admission (IPD / Emergency / Day Care), the correct destination is
  // their live billing ledger — that's where per-day charges, package
  // accruals, advance pool, and final-bill generation live. Only pure
  // OPD / Services patients (or anyone whose admission is already
  // discharged) stay on this counter for cash-bill collection. The
  // decision uses the live Admission collection rather than the
  // directory row's `registrationType` (which is only the INITIAL type
  // set at first registration and doesn't reflect later admissions).
  const pickPatient = async (p) => {
    if (!p?.UHID) return;
    setUhid(p.UHID);
    setSearchQ("");
    setSearchOpen(false);
    setSearchResults([]);

    // Probe for an active inpatient admission. The endpoint
    // /admissions/patient/:patientId returns the admission history;
    // we pick the first row with status: "Active" and an inpatient
    // admissionType. (Note: `/admissions/patient-by-uhid/:uhid`
    // returns the PATIENT, not admissions — so we use patientId.)
    let activeIpd = null;
    if (p._id) {
      try {
        const r = await axios.get(`${API_ENDPOINTS.BASE}/admissions/patient/${encodeURIComponent(p._id)}`);
        const list = r?.data?.admissions || r?.data?.data || r?.data || [];
        const arr = Array.isArray(list) ? list : [];
        activeIpd = arr.find((a) => a && a.status === "Active" && (
          a.admissionType === "IPD"
          || a.admissionType === "Emergency"
          || a.admissionType === "Day Care"
          || a.admissionType === "Daycare"
        ));
      } catch (_) { /* network/scope failure → fall through to billing counter */ }
    }

    if (activeIpd?._id) {
      // Live ledger — IPD / ER / Day Care all use the same per-admission
      // ledger page.
      navigate(`/billing/ipd/${activeIpd._id}`);
      return;
    }
    // Stay on the billing counter for OPD / Services / discharged.
    load(p.UHID);
    navigate(`/reception-billing/${encodeURIComponent(p.UHID)}`, { replace: true });
  };

  // Helper — deselect the current patient and return to the directory.
  // Bound to the "Clear" button + Escape key. Clears all per-patient
  // state so the next pick starts clean.
  const clearPatient = useCallback(() => {
    setUhid("");
    setPatient(null);
    setBills([]);
    setActiveBill(null);
    setAdvances([]);
    setUnspentAdv(0);
    setSearchQ("");
    setSearchResults([]);
    setSearchOpen(false);
    navigate("/reception-billing", { replace: true });
  }, [navigate]);

  // Help-overlay toggle (? key) — shows the keyboard shortcut cheat sheet.
  const [showShortcuts, setShowShortcuts] = useState(false);

  // NOTE: The keyboard-shortcut useEffect is intentionally defined later in
  // this file (just before `totals`), AFTER loadBill / generateBill /
  // printReceipt are declared. Putting it here triggered a Temporal Dead
  // Zone (TDZ) crash because the dep array referenced functions declared
  // further down. See "Keyboard shortcuts" block below.

  // Today's collection summary — small live tile.
  // R7as-FIX-1: loadTodaySummary moved above `load` to avoid TDZ ReferenceError.
  // The mount-only useEffect remains here, but the declaration is now ~200
  // lines up. R7ar-P1-13 originally extracted this from inline so callers
  // could refresh after payments/refunds; that part still works — the only
  // change is the source-order.

  useEffect(() => {
    const ac = new AbortController();
    loadTodaySummary();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBill = async (billId) => {
    setBillLoading(true);
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BILLING}/${billId}`);
      setActiveBill(data?.data || data);
    } catch (e) {
      toast.error("Could not load bill");
    } finally { setBillLoading(false); }
  };

  /* R7ci — Hard-delete a DRAFT bill (no payments, no audit footprint).
     Bills move DRAFT → GENERATED → PARTIAL → PAID; a DRAFT was never
     issued to the patient, so it can be scrapped cleanly. Backend
     POST /api/billing/:billId/delete enforces the same guards
     (DRAFT-only, zero collected) and voids any related triggers. */
  const deleteDraftBill = async (bill) => {
    if (!bill || bill._id == null) return;
    if (bill.billStatus !== "DRAFT") {
      toast.warning(`Only DRAFT bills can be deleted. Use Cancel on a ${bill.billStatus} bill.`);
      return;
    }
    if (!(await confirm({
      title: "Delete this DRAFT bill?",
      body: `${bill.billNumber || "Draft"} — ${(bill.billItems || []).length} item(s) will be removed. This cannot be undone, but no money has been collected yet so it's safe to scrap.`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/delete`, {});
      toast.success("Draft bill deleted");
      // If the deleted bill was the currently selected one, clear the
      // detail pane so the user doesn't see a stale card.
      if (activeBill && activeBill._id === bill._id) setActiveBill(null);
      await load(uhid);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not delete bill");
    }
  };

  const generateBill = async (billId) => {
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Generate this bill?",
      body: "The draft bill will be finalised. Once generated, line items can no longer be removed and the bill becomes the receipt-of-record.",
      confirmLabel: "Generate",
    }))) return;
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${billId}/generate`, { generatedBy: "Reception" });
      toast.success("Bill generated");
      await load(uhid);
      await loadBill(billId);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not generate bill");
    }
  };

  /* R7an: One-click "Generate Final Bill" for OPD / Day Care / Emergency
     / Services patients. IPD admissions have their own /billing/ipd
     final-bill flow (locks the ledger, marks discharge complete). For
     everyone else this:
       1. Finalizes every DRAFT bill (POST /:billId/generate)
       2. Applies any unspent advance FIFO across the just-generated
          + already-open bills
       3. Opens a print window with a CONSOLIDATED Final Bill — every
          line item, every payment row, every advance receipt, totals
          at the bottom.
     Receptionist no longer has to repeat the same three clicks per bill
     on a multi-visit day. */
  const generateFinalBill = async () => {
    if (!uhid || !patient) return;
    // Scope to NON-IPD bills. An active IPD admission has its own
    // discharge-billing flow on /billing/ipd/:id — we don't want this
    // button to interfere with that.
    const NON_IPD_TYPES = new Set(["OPD", "Day Care", "Daycare", "Emergency", "ER", "Services"]);
    const scoped = (bills || []).filter(
      (b) => NON_IPD_TYPES.has(b.visitType) && b.billStatus !== "CANCELLED" && b.billStatus !== "REFUNDED",
    );
    if (scoped.length === 0) {
      return toast.warn("No OPD / Day Care / ER / Services bills to finalize for this patient.");
    }

    const drafts   = scoped.filter((b) => b.billStatus === "DRAFT");
    const openable = scoped.filter((b) => ["GENERATED", "PARTIAL"].includes(b.billStatus));
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Finalize all non-IPD bills?",
      body:
        `${scoped.length} bill${scoped.length === 1 ? "" : "s"} will be finalised ` +
        `(${drafts.length} draft → generated)` +
        (unspentAdv > 0 ? `, then ${fmtCur(unspentAdv)} from the advance pool will be applied FIFO.` : ".") +
        ` A consolidated final bill will be opened for printing.`,
      confirmLabel: "Finalize all",
    }))) return;

    try {
      // ── 1. Finalize every DRAFT bill ──
      for (const d of drafts) {
        await axios.post(`${API_ENDPOINTS.BILLING}/${d._id}/generate`, { generatedBy: "Reception" });
      }

      // ── 2. Apply unspent advance to any open balance (FIFO oldest-bill,
      //    newest-advance). Backend's /apply does the heavy lifting and
      //    R7am made it safe against stale parent totals. ──
      if (unspentAdv > 0 && advances?.length) {
        const advLeft = advances
          .filter((a) => Number(a.remainingAmount || 0) > 0)
          .sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0));
        // Refresh the scoped bills so we have the post-generate state
        const refreshed = await axios.get(`${API_ENDPOINTS.BASE}/billing/uhid/${encodeURIComponent(uhid)}`);
        const refreshedBills = (refreshed?.data?.data?.bills || refreshed?.data?.bills || [])
          .filter((b) => NON_IPD_TYPES.has(b.visitType)
            && ["GENERATED", "PARTIAL"].includes(b.billStatus))
          .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        let advIdx = 0;
        let advRem = Number(advLeft[advIdx]?.remainingAmount || 0);
        for (const b of refreshedBills) {
          const itemsNet = (b.billItems || []).reduce((s, i) => s + Number(i.netAmount || 0), 0);
          const paidPos  = (b.payments   || []).reduce((s, p) => s + Math.max(0, Number(p.amount || 0)), 0);
          const refNet   = Math.max(Number(b.patientPayableAmount || 0), Number(b.netAmount || 0), itemsNet);
          let billOwed   = Math.max(0, refNet - paidPos);
          while (billOwed > 0.005 && advIdx < advLeft.length) {
            if (advRem <= 0.005) {
              advIdx += 1;
              advRem = Number(advLeft[advIdx]?.remainingAmount || 0);
              continue;
            }
            const useThis = Math.min(advRem, billOwed);
            try {
              await axios.post(`${API_ENDPOINTS.BILLING}/advance/${advLeft[advIdx]._id}/apply`,
                { billId: b._id, amount: useThis });
              advRem   -= useThis;
              billOwed -= useThis;
            } catch (e) {
              console.warn(`[generateFinalBill] advance apply failed on ${b.billNumber}: ${e?.message}`);
              break;
            }
          }
          if (advIdx >= advLeft.length) break;
        }
      }

      // ── 3. Refresh + print the consolidated final bill ──
      await load(uhid);
      const fresh   = await axios.get(`${API_ENDPOINTS.BASE}/billing/uhid/${encodeURIComponent(uhid)}`);
      const freshBills = (fresh?.data?.data?.bills || fresh?.data?.bills || [])
        .filter((b) => NON_IPD_TYPES.has(b.visitType) && b.billStatus !== "CANCELLED");
      const freshAdv = await axios.get(`${API_ENDPOINTS.BILLING}/advance/uhid/${encodeURIComponent(uhid)}`);
      const advList  = (freshAdv?.data?.data?.advances || freshAdv?.data?.advances || []);
      await printConsolidatedFinalBill(freshBills, advList);
      toast.success(`Final bill ready — ${freshBills.length} bill${freshBills.length === 1 ? "" : "s"} consolidated`);
    } catch (e) {
      toast.error(e?.response?.data?.message || `Generate Final Bill failed: ${e?.message}`);
    }
  };

  /* R7an: print the consolidated Final Bill — one document covering every
     bill on this UHID (OPD / Day Care / ER / Services). Layout mirrors the
     IPD final-bill print but flattens across multiple bills instead of
     daily breakdown. */
  const printConsolidatedFinalBill = async (billsIn, advancesIn) => {
    const hs = await fetchHospitalSettings();
    const list = billsIn || [];
    const adv  = advancesIn || [];
    const _num = (v) => {
      if (v == null) return 0;
      if (typeof v === "object" && v.toString) v = v.toString();
      const n = Number(v); return Number.isFinite(n) ? n : 0;
    };
    // Aggregate totals across every bill, using the same effective-balance
    // fallback as the modal (R7am) so stale parent totals don't lie.
    let gross = 0, disc = 0, tax = 0, net = 0, paid = 0, due = 0, advApplied = 0;
    const billRows = list.map((b) => {
      const itemsNet = (b.billItems || []).reduce((s, i) => s + _num(i.netAmount), 0);
      const itemsGross = (b.billItems || []).reduce((s, i) => s + _num(i.unitPrice) * _num(i.quantity || 1), 0);
      const itemsDisc  = (b.billItems || []).reduce((s, i) => s + _num(i.discountAmount), 0);
      const itemsTax   = (b.billItems || []).reduce((s, i) => s + _num(i.taxAmount), 0);
      const paidPos    = (b.payments  || []).reduce((s, p) => s + Math.max(0, _num(p.amount)), 0);
      const refNet     = Math.max(_num(b.patientPayableAmount), _num(b.netAmount), itemsNet);
      const bGross     = _num(b.grossAmount)   || itemsGross;
      const bDisc      = _num(b.totalDiscount) || itemsDisc;
      const bTax       = _num(b.taxAmount)     || itemsTax;
      const bNet       = refNet;
      const bPaid      = paidPos;
      const bDue       = Math.max(0, bNet - bPaid);
      gross += bGross; disc += bDisc; tax += bTax; net += bNet; paid += bPaid; due += bDue;
      // Advance-adjustment payments contribute to advApplied AND to paid
      for (const p of (b.payments || [])) {
        if (p.paymentMode === "ADVANCE_ADJUSTMENT") advApplied += Math.max(0, _num(p.amount));
      }
      return { b, bGross, bDisc, bTax, bNet, bPaid, bDue };
    });
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) return toast.error("Pop-up blocked — allow pop-ups to print the final bill");
    const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
    // R7cb-B: pull live hospital identity from Settings (logo, name, tagline,
    // address, phones, GSTIN) so admin edits flow into every printed bill.
    const _addrLine = [hs.addressLine1, hs.addressLine2, [hs.city, hs.state, hs.pincode].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    const _phoneLine = [hs.phone1, hs.phone2, hs.emergencyPhone].filter(Boolean).join(" · ");
    const _hospName = hs.hospitalName || "Hospital";
    const _hospTagline = hs.tagline || "";
    const itemsHtml = billRows.map(({ b, bGross, bDisc, bTax, bNet, bPaid, bDue }) => {
      const itemsRows = (b.billItems || []).map((it) => `
        <tr>
          <td>${esc(it.serviceName || it.name || "")}</td>
          <td style="text-align:right">${it.quantity || 1}</td>
          <td style="text-align:right">₹${_num(it.unitPrice).toFixed(2)}</td>
          <td style="text-align:right">₹${_num(it.netAmount).toFixed(2)}</td>
        </tr>`).join("");
      const paysRows = (b.payments || []).map((p) => `
        <tr>
          <td>${new Date(p.paidAt || p.createdAt || Date.now()).toLocaleString("en-IN")}</td>
          <td>${esc(p.paymentMode || "")}</td>
          <td>${esc(p.transactionId || "—")}</td>
          <td style="text-align:right">₹${_num(p.amount).toFixed(2)}</td>
        </tr>`).join("");
      return `
        <div class="bill-block">
          <div class="bill-head">
            <strong>${esc(b.billNumber || "DRAFT")}</strong>
            <span class="pill pill-${esc((b.visitType || "").toLowerCase())}">${esc(b.visitType || "")}</span>
            <span class="pill pill-${esc((b.billStatus || "").toLowerCase())}">${esc(b.billStatus || "")}</span>
            <span class="meta">${new Date(b.billDate || b.createdAt).toLocaleString("en-IN")}</span>
          </div>
          <table>
            <thead><tr><th>Service</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Net</th></tr></thead>
            <tbody>${itemsRows || '<tr><td colspan="4" style="text-align:center;color:#999">— no items —</td></tr>'}</tbody>
          </table>
          <div class="bill-sub">
            Gross ₹${bGross.toFixed(2)} · Discount ₹${bDisc.toFixed(2)} · Tax ₹${bTax.toFixed(2)} ·
            <strong>Net ₹${bNet.toFixed(2)}</strong> · Paid ₹${bPaid.toFixed(2)} ·
            <strong style="color:${bDue > 0 ? "#b91c1c" : "#15803d"}">Due ₹${bDue.toFixed(2)}</strong>
          </div>
          ${paysRows ? `
            <div class="pay-head">Payments</div>
            <table>
              <thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th style="text-align:right">Amount</th></tr></thead>
              <tbody>${paysRows}</tbody>
            </table>` : ""}
        </div>`;
    }).join("");
    const advHtml = adv.length === 0 ? "" : `
      <div class="bill-block">
        <div class="bill-head"><strong>ADVANCE DEPOSITS</strong></div>
        <table>
          <thead><tr><th>Receipt #</th><th>Date</th><th>Mode</th><th>Status</th><th style="text-align:right">Amount</th><th style="text-align:right">Applied</th><th style="text-align:right">Remaining</th></tr></thead>
          <tbody>${adv.map((a) => `
            <tr>
              <td>${esc(a.receiptNumber || "ADV")}</td>
              <td>${new Date(a.paidAt || a.createdAt).toLocaleString("en-IN")}</td>
              <td>${esc(a.paymentMode || "")}</td>
              <td>${esc(a.status || "")}</td>
              <td style="text-align:right">₹${_num(a.amount).toFixed(2)}</td>
              <td style="text-align:right">₹${_num(a.appliedAmount).toFixed(2)}</td>
              <td style="text-align:right">₹${_num(a.remainingAmount).toFixed(2)}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>`;
    win.document.write(`<!doctype html><html><head>
      <title>Final Bill — ${esc(patient?.fullName || uhid)}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color:#0f172a; font-size:13px; }
        h1 { font-size: 22px; margin: 0; }
        .meta { color: #64748b; font-size: 11px; margin-bottom: 14px; }
        .hdr { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; padding-bottom:10px; border-bottom:1.5px solid #cbd5e1; }
        .bill-block { margin: 18px 0; padding-bottom: 12px; border-bottom: 1px dashed #e2e8f0; page-break-inside: avoid; }
        .bill-head { display:flex; gap:10px; align-items:center; margin-bottom:8px; }
        .pill { padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; background:#f1f5f9; color:#475569; }
        .pill-opd { background:#ecfeff; color:#0e7490; }
        .pill-emergency, .pill-er { background:#fef2f2; color:#b91c1c; }
        .pill-daycare, .pill-day { background:#fef3c7; color:#92400e; }
        .pill-services { background:#f3e8ff; color:#6b21a8; }
        .pill-paid { background:#dcfce7; color:#15803d; }
        .pill-generated { background:#ecfeff; color:#0369a1; }
        .pill-partial { background:#fef3c7; color:#a16207; }
        .pill-draft { background:#f1f5f9; color:#64748b; }
        .bill-sub { color:#475569; font-size:12px; margin: 6px 0 4px; }
        .pay-head { font-weight:700; font-size:11px; color:#475569; margin: 10px 0 4px; text-transform:uppercase; letter-spacing:.5px; }
        table { width:100%; border-collapse: collapse; margin: 4px 0 6px; font-size:12px; }
        th, td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; text-align:left; }
        th { background:#f8fafc; font-weight:700; }
        .grand { margin-top: 20px; padding-top: 12px; border-top: 2px solid #0f172a; }
        .grand-row { display:flex; justify-content:space-between; padding: 4px 0; }
        .grand-row.major { font-size:16px; font-weight:900; padding-top:8px; border-top:1px dashed #cbd5e1; margin-top:4px; }
        .footer { margin-top: 24px; padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 10px; color:#94a3b8; text-align:center; }
      </style></head><body>
      <div class="hdr">
        <div>
          ${hs.logo ? `<img src="${hs.logo}" alt="" style="max-height:54px;display:block;margin-bottom:6px"/>` : ""}
          <h1 style="color:${hs.printHeaderColor || "#0f172a"}">${esc(_hospName)}</h1>
          <div class="meta">${_hospTagline ? esc(_hospTagline) + " · " : ""}Final Consolidated Bill</div>
          ${_addrLine ? `<div class="meta">${esc(_addrLine)}</div>` : ""}
          ${_phoneLine ? `<div class="meta">${esc(_phoneLine)}</div>` : ""}
          ${hs.gstin ? `<div class="meta">GSTIN: ${esc(hs.gstin)}</div>` : ""}
        </div>
        <div style="text-align:right">
          <strong>${esc(patient?.fullName || "Patient")}</strong><br>
          <span class="meta">UHID: ${esc(uhid)} · ${patient?.age ? patient.age + "y" : ""} · ${esc(patient?.gender || "")}</span><br>
          <span class="meta">Phone: ${esc(patient?.contactNumber || "—")}</span><br>
          <span class="meta">Printed: ${new Date().toLocaleString("en-IN")}</span>
        </div>
      </div>
      ${itemsHtml}
      ${advHtml}
      <div class="grand">
        <div class="grand-row"><span>Total Gross</span><strong>₹${gross.toFixed(2)}</strong></div>
        <div class="grand-row"><span>Total Discount</span><strong>− ₹${disc.toFixed(2)}</strong></div>
        <div class="grand-row"><span>Total Tax</span><strong>₹${tax.toFixed(2)}</strong></div>
        <div class="grand-row"><span>Total Net Payable</span><strong>₹${net.toFixed(2)}</strong></div>
        <div class="grand-row" style="color:#15803d"><span>Paid (cash + advance)</span><strong>₹${paid.toFixed(2)}</strong></div>
        ${advApplied > 0 ? `<div class="grand-row" style="color:#7c3aed"><span>&nbsp;&nbsp;↳ via Advance Adjustment</span><strong>₹${advApplied.toFixed(2)}</strong></div>` : ""}
        <div class="grand-row major" style="color:${due > 0 ? "#b91c1c" : "#15803d"}">
          <span>${due > 0 ? "BALANCE DUE" : "PATIENT ACCOUNT SETTLED"}</span>
          <strong>₹${due.toFixed(2)}</strong>
        </div>
      </div>
      <div class="footer">
        Final consolidated bill generated by Reception · ${new Date().toLocaleString("en-IN")}<br>
        ${list.length} bill${list.length === 1 ? "" : "s"} across OPD / Day Care / ER / Services for this patient.
        ${hs.billFooterNote ? esc(hs.billFooterNote) : ""}
      </div>
      <script>window.onload = () => { setTimeout(() => window.print(), 200); };</script>
      </body></html>`);
    win.document.close();
  };

  /* Print a per-payment receipt — fires after EVERY payment recorded so
     the receptionist can hand the patient a physical slip. Distinct
     from `printReceipt` (which is the full bill / OPD receipt). Pulls
     the latest payment from bill.payments[] — caller must re-fetch the
     bill BEFORE calling this so the last row is the one just recorded. */
  const printPaymentReceipt = (bill, paymentOverride) => {
    if (!bill) return;
    const pay = paymentOverride || (bill.payments || []).slice(-1)[0];
    if (!pay) return;
    const balanceAfter = Number(bill.balanceAmount || 0);
    const isFullyPaid  = balanceAfter <= 0.5;
    openPrint("payment-receipt", {
      receiptNo:    `${bill.billNumber}-P${(bill.payments || []).length || 1}`,
      patientName:  patient?.fullName || bill.patientName,
      uhid:         patient?.UHID || bill.UHID,
      ipdNo:        bill.admissionNumber,
      age:          patient?.age,
      gender:       patient?.gender,
      amount:       Number(pay.amount || 0),
      method:       pay.paymentMode,
      refNo:        pay.transactionId || "",
      receivedBy:   pay.receivedBy || "Reception",
      paidAt:       pay.paidAt || new Date().toISOString(),
      purpose:      isFullyPaid
        ? `Full settlement of bill ${bill.billNumber}`
        : `Part-payment towards bill ${bill.billNumber}`,
      billTotal:    Number(bill.netAmount || 0),
      totalPaid:    Number(bill.advancePaid || 0),
      runningBalance: balanceAfter,
      remarks:      pay.remarks || "",
      // R7bh-F1 / META-1: PrintAudit anchor — Receipt entityType maps
      // to PatientBill in ENTITY_MODEL, so the bill's printCount bumps.
      printAudit: {
        entityType:   "Receipt",
        entityId:     bill._id,
        entityNumber: `${bill.billNumber}-P${(bill.payments || []).length || 1}`,
        UHID:         patient?.UHID || bill.UHID,
        patientName:  patient?.fullName || bill.patientName,
      },
    });
  };

  /* R7a: Refund-receipt slip — fires after every refund recorded so the
     audit trail produces a physical document for the patient + NABH file.
     The fresh bill should be re-fetched BEFORE calling this so the
     latest negative payment row is included in totals. `refundInfo`
     carries what the cashier just submitted (amount/mode/reason/etc.). */
  const printRefundReceipt = (bill, refundInfo) => {
    if (!bill || !refundInfo) return;
    const amt = Number(refundInfo.amount) || 0;
    // Find the original (positive) payment row this refund is most
    // logically linked to — the largest positive row before the refund.
    // Best-effort: helps the audit file but not critical.
    const positiveRows = (bill.payments || []).filter(p => Number(p.amount) > 0);
    const source = positiveRows.length
      ? positiveRows.reduce((a, b) => (Number(a.amount) >= Number(b.amount) ? a : b))
      : null;
    const refundCount = (bill.payments || []).filter(p => Number(p.amount) < 0).length || 1;
    openPrint("refund-receipt", {
      receiptNo:    `${bill.billNumber}-R${refundCount}`,
      patientName:  patient?.fullName || bill.patientName,
      uhid:         patient?.UHID || bill.UHID,
      ipdNo:        bill.admissionNumber,
      opdNo:        bill.opdNumber,
      date:         new Date().toISOString(),
      approvedBy:   refundInfo.refundedBy || "Reception",
      refundedBy:   refundInfo.refundedBy || "Reception",
      amount:       amt,
      method:       refundInfo.mode,
      refNo:        refundInfo.transactionId || "",
      reason:       refundInfo.reason,
      sourceReceiptNo: source ? `${bill.billNumber}-P${(bill.payments || []).indexOf(source) + 1}` : "—",
      sourceMethod:    source?.paymentMode || "—",
      sourceAmount:    source ? Number(source.amount) : null,
      runningBalance:  Number(bill.balanceAmount || 0),
      // R7bh-F1 / META-1: PrintAudit anchor — RefundReceipt entityType
      // maps to PatientBill so the source bill's printCount bumps.
      printAudit: {
        entityType:   "RefundReceipt",
        entityId:     bill._id,
        entityNumber: `${bill.billNumber}-R${refundCount}`,
        UHID:         patient?.UHID || bill.UHID,
        patientName:  patient?.fullName || bill.patientName,
      },
    });
  };

  /* Open the unified printable system (CSS-driven, paper-size picker,
   * header/footer auto-pulled from Hospital Settings). The legacy
   * receiptHTML() path below is kept as a fallback if anyone needs it
   * but new code should always go through openPrint(). */
  const printReceipt = (bill) => {
    const items = (bill.billItems || []).map(it => ({
      name: it.serviceName || it.name,
      description: it.description,
      qty:  it.quantity || 1,
      rate: it.unitPrice,
      amount: it.netAmount,
    }));
    const lastPay = (bill.payments || []).slice(-1)[0];
    // R7b-HIGH-3b: SERVICE bills (walk-in lab/imaging/day procedures with
    // no admission) get a dedicated service-receipt slug so the printable
    // header reads "Service Date / Reference / Counter" instead of the
    // OPD-only "Doctor / Department / Visit Date". Falls back to OPD
    // receipt for everything else (OPD/IPD interim/Daycare/Emergency).
    const isService = bill.visitType === "SERVICE" || bill.billType === "SERVICE";
    openPrint(isService ? "service-receipt" : "opd-receipt", {
      receiptNo:   bill.billNumber,
      patientName: patient?.fullName,
      uhid:        patient?.UHID,
      age:         patient?.age,
      gender:      patient?.gender,
      // R7en-VISIT-TITLE: lets OPDReceipt title the document with the
      // actual visit type ("IPD Bill / Receipt" for IPD interim sub-bills,
      // "Daycare Bill / Receipt" for Daycare, etc.) instead of the
      // hardcoded "OPD Bill / Receipt".
      visitType:   bill.visitType,
      // OPD-only fields (ignored by ServiceReceipt)
      // R7en-DOC-DEPT-FIX: bill.doctorName + bill.department are often
      // empty because the BillingService doesn't always denormalize them
      // onto the bill at create time. Fall back to the populated visit /
      // admission ref (server populates these for OPD/IPD), then to the
      // patient's currentVisit object, then "—" so the slot is never
      // literally blank like before.
      doctorName:  bill.doctorName
                || bill.consultantName
                || bill.attendingDoctor
                || bill.opdVisit?.attendingDoctor
                || bill.opdVisit?.doctorName
                || bill.admission?.attendingDoctor
                || patient?.currentVisit?.attendingDoctor
                || patient?.currentVisit?.doctorName
                || patient?.currentAdmission?.attendingDoctor
                || "—",
      department:  bill.department
                || bill.opdVisit?.department
                || bill.opdVisit?.departmentName
                || bill.admission?.department
                || patient?.currentVisit?.department
                || patient?.currentVisit?.departmentName
                || patient?.currentAdmission?.department
                || "—",
      visitDate:   bill.createdAt,
      // SERVICE-only fields (ignored by OPDReceipt)
      serviceDate: bill.createdAt,
      referredBy:  bill.referredBy || bill.referralSource,
      counter:     bill.counter || bill.generatedBy,
      items,
      // R7d: bill-level field is `totalDiscount` (includes both per-item
      // discounts + extra settlement discount). `bill.discountAmount`
      // only exists at the BillItem level, so reading it here would
      // always be undefined → 0 on the printed receipt.
      discount:    bill.totalDiscount ?? bill.discountAmount,
      tax:         bill.taxAmount,
      paymentMethod: lastPay?.paymentMode,
      paymentRef:    lastPay?.transactionId,
      // R7bh-F1 / META-1: PrintAudit anchor — both opd-receipt and
      // service-receipt back into PatientBill, so we use Receipt
      // entityType (maps to PatientBill in ENTITY_MODEL).
      printAudit: {
        entityType:   "Receipt",
        entityId:     bill._id,
        entityNumber: bill.billNumber,
        UHID:         patient?.UHID,
        patientName:  patient?.fullName,
      },
    });
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────
  //
  // Receptionist-facing hotkeys. Defined HERE (not next to clearPatient)
  // so that loadBill / generateBill / printReceipt are already in scope
  // — otherwise the dep array hits a TDZ on first render.
  //
  // Skip when the user is typing in an input/textarea/select/contenteditable
  // (so "1" inside a search box doesn't fire the OPD tab). Most modals
  // close themselves on Escape via their own backdrop click — Escape here
  // only clears the patient selection when no modal is open.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      const isTyping =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        e.target?.isContentEditable;

      // "?" — always show help (also works while typing, since "?"
      // requires Shift and is unlikely to be typed by accident; but
      // skip it if a modal text input is currently focused).
      if (e.key === "?" && !isTyping) {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

      // "/" or Ctrl+K — focus the search box (industry standard).
      // Skip when already in an input so it stays as a literal "/" key.
      if (!isTyping && (e.key === "/" || (e.ctrlKey && e.key.toLowerCase() === "k"))) {
        e.preventDefault();
        const el = document.querySelector('input[placeholder*="name, UHID"]');
        if (el) el.focus();
        return;
      }

      // Esc — close help, clear search dropdown, or clear patient.
      // Modals own their own Esc → those don't reach here (they
      // stopPropagation via the backdrop click).
      if (e.key === "Escape") {
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (isTyping) return;
        if (searchOpen)    { setSearchOpen(false); return; }
        if (patient)       { clearPatient(); return; }
      }

      // The rest only fire when NOT typing (so "g" inside a search
      // box still types a "g") and a patient is selected for the
      // action-shortcuts.
      if (isTyping) return;

      // 1-6 — directory tab switch (only when no patient loaded).
      if (!patient && /^[1-6]$/.test(e.key)) {
        const TABS = ["OPD","IPD","Daycare","Emergency","Services","ALL"];
        setListType(TABS[Number(e.key) - 1]);
        return;
      }

      if (!patient) return;

      const k = e.key.toLowerCase();

      // T — Take Advance (always available when a patient is loaded).
      if (k === "t") {
        e.preventDefault();
        setShowAdvDlg(true);
        return;
      }

      // Bill-specific shortcuts only when a bill is selected on the
      // right side. Backend status guards still apply.
      if (!activeBill) return;
      const status = activeBill.billStatus;
      if (k === "g" && status === "DRAFT") {        // Generate
        e.preventDefault();
        generateBill(activeBill._id);
        return;
      }
      if (k === "a" && status === "DRAFT") {        // Add Service
        e.preventDefault();
        setAddSvcTarget(activeBill);
        return;
      }
      if (k === "p" && ["GENERATED","PARTIAL"].includes(status)) {  // Pay
        e.preventDefault();
        setPayTarget(activeBill);
        return;
      }
      // R7aa: effective-balance fallback for the V (apply advance)
      // shortcut. If balanceAmount is stale (0 on a bill with real items)
      // we still want the user to be able to apply an advance.
      const _vBal = Number(activeBill.balanceAmount || 0)
        || Math.max(
             0,
             (activeBill.billItems || []).reduce((s, i) => s + Number(i.netAmount || 0), 0)
               - (activeBill.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0),
           );
      if (k === "v" && ["GENERATED","PARTIAL"].includes(status) && unspentAdv > 0 && _vBal > 0) {
        // V — apply adVance to bill (FIFO oldest first). Mirrors the
        // onApplyAdvance click handler on the BillDetail toolbar.
        e.preventDefault();
        const unspent = advances.filter((a) => (a.remainingAmount || 0) > 0);
        const adv = unspent[unspent.length - 1] || unspent[0];
        if (adv) {
          axios.post(`${API_ENDPOINTS.BILLING}/advance/${adv._id}/apply`, { billId: activeBill._id })
            .then(async () => { toast.success("Advance applied"); await load(uhid); await loadBill(activeBill._id); })
            .catch((err) => toast.error(err?.response?.data?.message || "Apply failed"));
        }
        return;
      }
      if (k === "r" && status !== "DRAFT") {        // pRint receipt
        e.preventDefault();
        printReceipt(activeBill);
        return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // loadBill / generateBill / printReceipt are recreated each render;
    // listing them keeps callbacks fresh but they're not in deps array
    // to avoid the listener bouncing on every render. The closure picks
    // up the latest patient/activeBill/etc which is what we care about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient, activeBill, advances, unspentAdv, uhid, searchOpen, showShortcuts, clearPatient, load]);

  const totals = useMemo(() => {
    // R7aa: fall back to summing billItems when a bill's parent totals
    // are stale (recalcTotals never ran). Keeps the patient-level summary
    // strip honest even when individual bill rows have ₹0 grossAmount.
    const _eff = (b) => {
      const net = Number(b.netAmount || 0);
      if (net > 0) return { net, bal: Number(b.balanceAmount || 0) };
      const itemsNet = (b.billItems || []).reduce((s, i) => s + Number(i.netAmount || 0), 0);
      const paid     = (b.payments   || []).reduce((s, p) => s + Number(p.amount    || 0), 0);
      return { net: itemsNet, bal: Math.max(0, itemsNet - paid) };
    };
    const agg = bills.reduce((acc, b) => {
      const { net, bal } = _eff(b);
      acc.gross += net;
      acc.due   += bal;
      return acc;
    }, { gross: 0, due: 0 });
    return {
      gross:    agg.gross,
      due:      agg.due,
      paid:     agg.gross - agg.due,
      bills:    bills.length,
      open:     bills.filter(b => ["GENERATED", "PARTIAL"].includes(b.billStatus)).length,
      drafts:   bills.filter(b => b.billStatus === "DRAFT").length,
    };
  }, [bills]);

  return (
    <div className="rx-page" style={{ background: C.bg, minHeight: "100vh", padding: "16px 20px 60px", fontFamily: FONT_SANS }}>
      {/* Back + title row — matches the IPDBillingLedger header strip. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => navigate("/reception")} style={{
          padding: "6px 12px", background: "#fff", border: `1px solid ${C.border}`,
          borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, color: C.text, fontSize: 12,
        }}>
          <i className="pi pi-arrow-left" style={{ marginRight: 6, fontSize: 11 }} />
          Dashboard
        </button>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
          <i className="pi pi-receipt" style={{ color: C.blue }} />
          Billing Counter
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>
          Cash · UPI · Card · Cheque collection
          {todayCollection?.totalCollected != null && <> · Today: <strong style={{ color: C.green }}>{fmtCur(todayCollection.totalCollected)}</strong></>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => setShowShortcuts(true)}
                  title="Keyboard shortcuts (press ?)"
                  style={{
                    padding: "6px 12px", background: "#fff", border: `1px solid ${C.border}`,
                    borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, color: C.muted, fontSize: 12,
                  }}>
            <i className="pi pi-question-circle" style={{ marginRight: 6 }} /> Shortcuts
            <kbd className="rx-kbd rx-kbd--dark" style={{ marginLeft: 4 }}>?</kbd>
          </button>
          <button onClick={() => navigate("/patient-search")} style={{
            padding: "6px 12px", background: "#fff", border: `1px solid ${C.border}`,
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, color: C.muted, fontSize: 12,
          }}>
            <i className="pi pi-search" style={{ marginRight: 6 }} /> Patient Search
          </button>
        </div>
      </div>

      {/* Smart search bar — name / UHID / phone. Live dropdown of
          matches as the receptionist types (min 2 chars). The white
          card wrapper matches the filter-bar look from the IPD
          Live Ledger reference design. */}
      <div style={{
        position: "relative", marginBottom: 14,
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 12, padding: "10px 14px",
      }}>
        <div className="rx-search" style={{ marginBottom: 0 }}>
          <i className="pi pi-search" />
          <input
            placeholder="Search by name, UHID, or mobile number…"
            value={searchQ}
            onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 180)}   // delay so click on dropdown registers
            onKeyDown={e => {
              if (e.key === "Enter") {
                if (searchResults.length === 1) pickPatient(searchResults[0]);
                else if ((searchQ || "").trim().toUpperCase().startsWith("UH")) {
                  load(searchQ.trim().toUpperCase());
                  setSearchOpen(false);
                }
              } else if (e.key === "Escape") {
                setSearchOpen(false);
              }
            }}
          />
          {searchBusy && <i className="pi pi-spin pi-spinner" style={{ color: "#94a3b8" }} />}
        </div>

        {searchOpen && searchQ.trim().length >= 2 && (
          <div className="rx-search-dropdown" style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)", maxHeight: 380,
            overflowY: "auto", zIndex: 50,
          }}>
            {searchResults.length === 0 && !searchBusy ? (
              <div style={{ padding: "16px 14px", color: "#94a3b8", fontSize: 13, textAlign: "center" }}>
                No patient matches "{searchQ}"
              </div>
            ) : (
              searchResults.map(p => (
                <button key={p._id}
                        onMouseDown={() => pickPatient(p)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          width: "100%", padding: "8px 12px", border: 0,
                          borderBottom: "1px solid #f1f5f9", background: "#fff",
                          cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                        onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: "linear-gradient(135deg, #0891b2, #06b6d4)",
                    color: "#fff", fontWeight: 800, fontSize: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {String(p.fullName || "?").trim().split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
                      {p.title ? `${p.title} ` : ""}{p.fullName}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span className="rx-mono-tag rx-mono-tag--subtle">{p.UHID}</span>
                      {p.contactNumber && <span>📱 {p.contactNumber}</span>}
                      {p.age != null && <span>{p.age}y · {p.gender || "—"}</span>}
                    </div>
                  </div>
                  {p.registrationType && (
                    <span className="rx-mode-pill" style={{ fontSize: 10, padding: "2px 8px" }}>
                      {p.registrationType}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{
          background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
          padding: 40, textAlign: "center", color: C.muted,
        }}>
          <i className="pi pi-spin pi-spinner" style={{ fontSize: 26, color: C.blue }} />
        </div>
      ) : !patient ? (
        /* ── Active-patient directory ──────────────────────────────
           No patient picked yet. Show a tabbed list of currently
           active patients filtered by registration type so the
           cashier can click a row instead of typing a UHID.
           Rendered via the shared <ActivePatientDirectory> so the
           TODAY badge + 24h window logic lives in exactly one file. */
        <ActivePatientDirectory
          listType={listType}
          setListType={setListType}
          rows={directory}
          loading={directoryLoading}
          onPick={pickPatient}
        />
      ) : (
        <>
          {/* ──────────────────────────────────────────────────────
              Hero / patient summary card — 4-column grid layout
              cloned from IPDBillingLedger. Slot 3 auto-adapts based
              on the current visit context (BED/ROOM for IPD,
              DEPARTMENT/DOCTOR for OPD/Daycare/Service). All field
              labels are ALL-CAPS small grey above bold values.
              ────────────────────────────────────────────────────── */}
          {(() => {
            // Derive department + doctor + an IPD admission ref (if any)
            // up front so each grid slot stays a tidy expression. Falls
            // back through patient + active IPD bill so the new layout
            // never shows "—" when data exists elsewhere on the page.
            const ipdBill = (bills || []).find((b) => b.visitType === "IPD" && b.admissionNumber);
            const ctxType = currentContext?.type;
            const isIPD   = ctxType === "IPD";
            // R7eq-FIX-3 — PatientBill carries no doctor/department for
            // OPD; the OPDVisit doc has them on `consultantName` (denorm
            // string) + `doctorId` (populated to {personalInfo.fullName})
            // + `departmentId` (populated to {departmentName}) or the
            // legacy `department` string. load() now stashes the most
            // recent OPD visit on patient.currentVisit so this chain has
            // something to read from. Last fallback skips raw ObjectIds
            // (24-hex chars) that some legacy visits stored in `.department`
            // by mistake — we'd rather render "—" than an ObjectId.
            const cv = patient.currentVisit;
            const _looksLikeObjectId = (s) =>
              typeof s === "string" && /^[a-f0-9]{24}$/i.test(s);
            const _safe = (v) => (_looksLikeObjectId(v) ? "" : v);
            const dept =
                 (cv?.departmentId?.departmentName)
              || (cv?.departmentName)
              || (cv?.doctorProfile?.department?.departmentName)
              || (cv?.doctorProfile?.department?.name)
              || _safe(cv?.department)
              || (typeof patient.department === "object"
                    ? (patient.department?.name)
                    : _safe(patient.department))
              || "—";
            const doc =
                 (cv?.consultantName)
              || (cv?.doctorId?.personalInfo?.fullName)
              || (cv?.doctorId?.fullName)
              || (cv?.doctorName)
              || (cv?.attendingDoctor)
              || (typeof patient.doctor === "object"
                    ? (patient.doctor?.fullName || patient.doctor?.personalInfo?.fullName)
                    : patient.doctor)
              || "—";
            // OPD/Daycare/ER bills created today (for the visit summary slot)
            const todayBill = (currentBills || [])[0] || (bills || [])[0];
            return (
              <div style={{
                background: C.card, border: `1.5px solid ${C.border}`,
                borderRadius: 14, padding: 18, marginBottom: 12,
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 16, alignItems: "start" }}>
                  {/* PATIENT */}
                  <div>
                    <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".5px" }}>Patient</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginTop: 4 }}>
                      {patient.title ? `${patient.title} ` : ""}{patient.fullName || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                      UHID: <strong style={{ color: C.text }}>{patient.UHID}</strong>
                      {patient.age != null && <> · {patient.age}y</>}
                      {patient.gender && <> · {patient.gender}</>}
                      {patient.contactNumber && <> · {patient.contactNumber}</>}
                    </div>
                  </div>
                  {/* ADMISSION / VISIT */}
                  <div>
                    <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".5px" }}>
                      {isIPD ? "Admission" : "Visit"}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 5 }}>
                      {isIPD
                        ? fmtDateTime(
                            ipdBill?.admission?.admissionDate
                            || patient?.currentAdmission?.admissionDate
                            || ipdBill?.admissionDate
                            || todayBill?.createdAt
                          )
                        : fmtDateTime(todayBill?.createdAt || new Date())}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {isIPD
                        ? `IPD · ${currentContext?.admissionNumber || ipdBill?.admissionNumber || "—"}`
                        : `${todayBill?.visitType || "OPD"} · Today`}
                      {patient.tpa && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 800, color: C.amber,
                          background: C.amberL, padding: "2px 6px", borderRadius: 6,
                        }}>TPA</span>
                      )}
                    </div>
                  </div>
                  {/* BED / ROOM (IPD)   or   DEPARTMENT / DOCTOR (OPD) */}
                  <div>
                    <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".5px" }}>
                      {isIPD ? "Bed / Room" : "Department"}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 5 }}>
                      {/* R7eq-FIX: PatientBill does NOT denormalize bed/ward —
                          they live on the populated admission ref (mirrors the
                          advance.admission?.bedNumber pattern at line 150).
                          Read through the ref first, then admission-level
                          patient fallbacks, then the flat bill fields as a
                          last-resort safety net. */}
                      {isIPD
                        ? (ipdBill?.admission?.bedNumber
                           || patient?.currentAdmission?.bedNumber
                           || ipdBill?.bedNumber
                           || patient?.bedNumber
                           || "—")
                        : dept}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {isIPD
                        ? (ipdBill?.admission?.wardName
                           || patient?.currentAdmission?.wardName
                           || ipdBill?.wardName
                           || patient?.wardName
                           || dept
                           || "—")
                        : (doc
                            ? (/^(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i.test(doc) ? doc : `Dr. ${doc}`)
                            : "—")}
                    </div>
                  </div>
                  {/* PACKAGE / TPA */}
                  <div>
                    <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".5px" }}>
                      Package / TPA
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: patient.tpa ? C.purple : C.text, marginTop: 5 }}>
                      {patient.tpa
                        ? (typeof patient.tpa === "object" ? (patient.tpa.tpaName || patient.tpa.name || "TPA") : patient.tpa)
                        : (patient.paymentType || "Self-pay")}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {patient.tpa ? "Insurance / TPA" : "None matched"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ──────────────────────────────────────────────────────
              KPI strip — cloned from IPDBillingLedger. 7 tiles in
              auto-fit grid; reuses the totals useMemo (totals.gross,
              totals.due, totals.paid, totals.bills, totals.open,
              totals.drafts) + unspentAdv state. Sub-text shows
              context-sensitive hints so the tiles never look empty.
              ────────────────────────────────────────────────────── */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 12, marginBottom: 12,
          }}>
            <KPI label="Gross"        value={fmtCur(totals.gross)} tone={C.text}
                 sub={`${totals.bills} billed line${totals.bills === 1 ? "" : "s"}`} />
            <KPI label="Discount"     value={fmtCur(Math.max(0, totals.gross - totals.paid - totals.due))} tone={C.orange}
                 sub={totals.gross - totals.paid - totals.due > 0 ? "Applied" : "—"} />
            <KPI label="Net Payable"  value={fmtCur(totals.gross)} tone={C.text}
                 sub={`${totals.open} open bill${totals.open === 1 ? "" : "s"}`} />
            <KPI label="Paid"         value={fmtCur(totals.paid)} tone={C.green}
                 sub={totals.paid > 0 ? "Collected" : "—"} />
            <KPI label="Outstanding"  value={fmtCur(totals.due)} tone={totals.due > 0 ? C.red : C.green}
                 sub={totals.due > 0 ? `${totals.open} bill${totals.open === 1 ? "" : "s"} due` : "All settled"} />
            <KPI label="Drafts"       value={String(totals.drafts)} tone={totals.drafts > 0 ? C.amber : C.text} mono={false}
                 sub={totals.drafts > 0 ? "Awaiting generation" : "—"} />
            <KPI label="Advance Pool" value={fmtCur(unspentAdv)} tone={unspentAdv > 0 ? C.purple : C.muted}
                 sub={unspentAdv > 0
                   ? `${advances.filter((a) => (a.remainingAmount || 0) > 0).length} deposit${advances.filter((a) => (a.remainingAmount || 0) > 0).length === 1 ? "" : "s"}`
                   : "Unspent UHID advance"} />
          </div>

          {/* ──────────────────────────────────────────────────────
              Action bar — single row of pill buttons mirroring the
              IPDBillingLedger layout. Mapped to ReceptionBilling's
              existing handlers (setShowAdvDlg, generateFinalBill,
              clearPatient, etc.). IPD-only actions hide for OPD.
              ────────────────────────────────────────────────────── */}
          <div style={{
            background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
            padding: 10, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginRight: 6, letterSpacing: ".4px" }}>ACTIONS:</div>
            {/* Take Advance — every receptionist can record a deposit. */}
            <button onClick={() => setShowAdvDlg(true)}
                    title="Take cash / UPI / card deposit (T)"
                    style={{
                      padding: "7px 14px", background: C.green, color: "#fff", border: "none",
                      borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
              <i className="pi pi-plus" /> Take Advance
              <kbd className="rx-kbd" style={{ background: "rgba(255,255,255,.22)", color: "#fff", marginLeft: 2 }}>T</kbd>
            </button>
            {/* Add Charge — creates a fresh DRAFT bill so the user can
                add an ad-hoc service. Maps to the existing New Bill modal. */}
            <button onClick={() => setShowNewBill(true)}
                    title="Add an ad-hoc charge / new draft bill"
                    style={{
                      padding: "7px 14px", background: C.purple, color: "#fff", border: "none",
                      borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
              <i className="pi pi-plus" /> Add Charge
            </button>
            {/* Generate Final Bill — only when at least one active non-IPD bill exists. */}
            {(bills || []).some((b) =>
              ["OPD", "Day Care", "Daycare", "Emergency", "ER", "Services"].includes(b.visitType)
              && b.billStatus !== "CANCELLED" && b.billStatus !== "REFUNDED",
            ) && (
              <button onClick={generateFinalBill}
                      title="Finalize all DRAFT bills, apply any remaining advance, and print one consolidated Final Bill"
                      style={{
                        padding: "7px 14px", background: "#fff", color: C.purple,
                        border: `1.5px solid ${C.purple}`,
                        borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}>
                <i className="pi pi-check-square" /> Generate Final Bill
              </button>
            )}
            {/* Bulk collect / settle — only render when there is something outstanding. */}
            {totals.due > 0 && totals.open > 0 && (
              <>
                <button onClick={() => setShowBulkCollect(true)}
                        title={`Collect ${fmtCur(totals.due)} in one go — distributed FIFO across ${totals.open} bill${totals.open === 1 ? "" : "s"}`}
                        style={{
                          padding: "7px 14px", background: C.blue, color: "#fff", border: "none",
                          borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
                          display: "inline-flex", alignItems: "center", gap: 6,
                        }}>
                  <i className="pi pi-check-circle" /> Collect All Dues
                </button>
                <button onClick={() => setShowBulkSettle(true)}
                        title="Apply one discount across every outstanding bill, then collect"
                        style={{
                          padding: "7px 14px", background: "#fff", color: C.blue,
                          border: `1.5px solid ${C.blue}`,
                          borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
                          display: "inline-flex", alignItems: "center", gap: 6,
                        }}>
                  <i className="pi pi-sliders-h" /> Settle All
                </button>
              </>
            )}
            {/* Clear — push to the right; matches the "Refresh" position
                on the reference. Keeps Esc shortcut. */}
            <button onClick={clearPatient}
                    title="Clear current patient and return to directory (Esc)"
                    style={{
                      marginLeft: "auto",
                      padding: "7px 12px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
                      borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
              <i className="pi pi-times" /> Clear
              <kbd className="rx-kbd" style={{ marginLeft: 2 }}>Esc</kbd>
            </button>
          </div>

          {/* ── Advance Deposits ledger ─────────────────────────────
              Shows every deposit (active + applied + refunded). Reprint
              icon on each non-void row. When a bill is selected on the
              right, "Apply Advance" button on its toolbar consumes from
              the oldest active deposit. Header pill uses purple tint to
              match the section-accordion palette from IPDBillingLedger. */}
          {displayAdvances.length > 0 && (
            <div style={{
              background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
              overflow: "hidden", marginBottom: 12,
            }}>
              <SectionHeader
                icon="pi-wallet"
                title={`Advance Deposits${showHistory ? " · History" : ""}`}
                sub={`${displayAdvances.length} entr${displayAdvances.length === 1 ? "y" : "ies"}`}
                tone={C.purple} toneBg={C.purpleL}
                right={(
                  <span style={{
                    fontSize: 10.5, fontWeight: 700,
                    color: unspentAdv > 0 ? C.green : C.muted,
                    background: unspentAdv > 0 ? C.greenL : "#f1f5f9",
                    padding: "3px 10px", borderRadius: 999,
                    border: `1px solid ${unspentAdv > 0 ? "#86efac" : C.border}`,
                  }}>
                    {unspentAdv > 0 ? `Available: ${fmtCur(unspentAdv)}` : "Fully applied"}
                  </span>
                )}
              />
              <div style={{ padding: "8px 14px" }}>
              {displayAdvances.map((a) => {
                const isVoid = a.status === "REFUNDED" || a.status === "CANCELLED";
                return (
                  <div key={a._id} style={{
                    padding: "6px 0",
                    borderBottom: "1px dotted #f1f5f9",
                    opacity: a.status === "FULLY_APPLIED" ? 0.7 : (isVoid ? 0.45 : 1),
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#475569" }}>
                      <span className="rx-mono-tag">{a.receiptNumber}</span>
                      <span className="rx-mode-pill">{a.paymentMode}</span>
                      {a.transactionId && <span className="rx-mono-tag rx-mono-tag--subtle">{a.transactionId}</span>}
                      <span style={{ color: "#94a3b8" }}>by {a.receivedBy}</span>
                      <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontWeight: 800, color: "#0f172a", fontSize: 13 }}>
                        {fmtCur(a.amount)}
                        {a.remainingAmount > 0 && a.remainingAmount < Number(a.amount) && (
                          <span style={{ fontWeight: 600, fontSize: 11, color: "#15803d", marginLeft: 4 }}>
                            ({fmtCur(a.remainingAmount)} left)
                          </span>
                        )}
                      </span>
                      {!isVoid && (
                        <button
                          type="button"
                          onClick={() => printAdvanceReceipt(a, patient)}
                          title={`Reprint receipt ${a.receiptNumber}`}
                          style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <i className="pi pi-print" style={{ fontSize: 12 }} />
                        </button>
                      )}
                      {/* R7ao: Refund the unspent portion of this advance.
                          Visible only when the row has remaining balance AND the
                          user has billing.refund permission. ACTIVE and
                          PARTIALLY_APPLIED rows are both refundable. */}
                      {!isVoid && Number(a.remainingAmount || 0) > 0 && can("billing.refund") && (
                        <button
                          type="button"
                          onClick={() => setAdvanceRefundTarget(a)}
                          title={`Refund ${fmtCur(Number(a.remainingAmount || 0))} unspent — patient discharge / cancellation`}
                          style={{ height: 28, padding: "0 10px", borderRadius: 6, border: "1px solid #dc2626", background: "#fff", color: "#dc2626", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700 }}
                        >
                          <i className="pi pi-undo" style={{ fontSize: 11 }} /> Refund
                        </button>
                      )}
                      {a.status === "REFUNDED" && toMoney(a.refundedAmount) > 0 && (
                        <button
                          type="button"
                          onClick={() => printAdvanceRefundReceipt(a, patient)}
                          title={`Reprint refund slip — ${fmtCur(toMoney(a.refundedAmount))} refunded ${a.refundedAt ? `on ${new Date(a.refundedAt).toLocaleDateString("en-IN")}` : ""}`}
                          style={{ height: 28, padding: "0 10px", borderRadius: 6, border: "1px solid #94a3b8", background: "#f8fafc", color: "#475569", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700 }}
                        >
                          <i className="pi pi-print" style={{ fontSize: 11 }} /> Refund Slip
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3, paddingLeft: 4 }}>
                      {new Date(a.paidAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {" · status: "}<strong>{a.status}</strong>
                      {a.appliedTo?.length > 0 && ` · applied to ${a.appliedTo.map((x) => x.billNumber).join(", ")}`}
                      {a.remarks && ` · ${a.remarks}`}
                    </div>
                    {/* R7ao: show refund trail under the row when REFUNDED. */}
                    {a.status === "REFUNDED" && toMoney(a.refundedAmount) > 0 && (
                      <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 2, paddingLeft: 4, fontWeight: 700 }}>
                        ↩ Refunded {fmtCur(toMoney(a.refundedAmount))}
                        {a.refundMode  && ` via ${a.refundMode}`}
                        {a.refundedBy  && ` by ${a.refundedBy}`}
                        {a.refundedAt  && ` on ${new Date(a.refundedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                        {a.refundReason && ` — ${a.refundReason}`}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          )}

          {/* Tab strip — Current ↔ History toggle, restyled as a tab
              underline (blue 2px bottom border on active, grey text on
              inactive) to match the IPDBillingLedger tab aesthetic.
              Hidden when no past entries exist. */}
          {(pastBills.length > 0 || pastAdvances.length > 0) && (
            <div style={{ display: "flex", gap: 4, borderBottom: `2px solid ${C.border}`, marginBottom: 12 }}>
              {[
                { id: false, label: "Current Visit", icon: "pi-bookmark" },
                { id: true,  label: `History${pastBills.length + pastAdvances.length > 0 ? ` (${pastBills.length + pastAdvances.length})` : ""}`, icon: "pi-history" },
              ].map(t => (
                <button key={String(t.id)} onClick={() => setShowHistory(t.id)} style={{
                  padding: "10px 18px", background: showHistory === t.id ? C.card : "transparent",
                  border: "none",
                  borderBottom: showHistory === t.id ? `3px solid ${C.blue}` : "3px solid transparent",
                  marginBottom: -2, cursor: "pointer", fontFamily: "inherit",
                  fontWeight: showHistory === t.id ? 800 : 600,
                  color: showHistory === t.id ? C.blue : C.muted, fontSize: 13,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                  <i className={`pi ${t.icon}`} style={{ fontSize: 12 }} />
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Two-column layout: bill list | active bill details */}
          <div className="rx-split-list">
            {/* Bills column — wrapped in a section card with a colored
                header pill (blue tint for current, grey for history) so
                it matches the section-accordion aesthetic. */}
            <div style={{
              background: C.card, border: `1.5px solid ${C.border}`,
              borderRadius: 12, overflow: "hidden",
            }}>
              {/* SectionHeader replaces the old rx-bill-list-head. The
                  "New Bill" action is wired into the header's right slot
                  (only when not viewing history), and the current-visit
                  context chip lives in the sub-label. Backend's
                  getOrCreateDraftBill is idempotent: if there's already
                  a DRAFT for the same (UHID, visitType, admission), it
                  returns the existing one instead of duplicating. */}
              <SectionHeader
                icon="pi-list"
                title={showHistory ? "Bills · History" : "Bills · Current"}
                sub={displayBills.length > 0
                  ? `${displayBills.length} bill${displayBills.length === 1 ? "" : "s"}`
                  : "Empty"}
                tone={showHistory ? C.slate : C.blue}
                toneBg={showHistory ? "#f1f5f9" : C.blueL}
                right={(
                  <>
                    {!showHistory && currentContext && (
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: currentContext.type === "IPD" ? C.purple : "#0891b2",
                        background: currentContext.type === "IPD" ? C.purpleL : "#ecfeff",
                        padding: "2px 8px", borderRadius: 999,
                        border: `1px solid ${currentContext.type === "IPD" ? "#c4b5fd" : "#a5f3fc"}`,
                      }}>
                        {currentContext.type === "IPD" ? `IPD ${currentContext.admissionNumber}` : "Today"}
                      </span>
                    )}
                    {!showHistory && (
                      <button onClick={() => setShowNewBill(true)}
                              title="Create a fresh DRAFT bill for ad-hoc charges"
                              style={{
                                padding: "5px 11px", background: C.blue, color: "#fff", border: "none",
                                borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 11,
                                display: "inline-flex", alignItems: "center", gap: 4,
                              }}>
                        <i className="pi pi-plus" style={{ fontSize: 10 }} /> New Bill
                      </button>
                    )}
                  </>
                )}
              />

              {displayBills.length === 0 ? (
                <div style={{
                  padding: 40, textAlign: "center", color: C.muted, fontSize: 13,
                  background: C.subtle,
                }}>
                  <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.6 }}>📑</div>
                  {showHistory
                    ? "No past bills for this patient."
                    : currentContext
                      ? `No bills yet for the current ${currentContext.type === "IPD" ? "admission" : "visit"}.`
                      : "No active visit. Click History to see past bills."}
                </div>
              ) : displayBills.map(b => {
                const isActive = activeBill?._id === b._id;
                const cls = STATUS_CLASS[b.billStatus] || "pending";
                // R7aa: derive effective Total/Paid/Due from billItems when
                // the parent fields are stale (recalcTotals didn't run).
                const _itemsNet = (b.billItems || []).reduce((s, i) => s + Number(i.netAmount || 0), 0);
                const _paidSum  = (b.payments   || []).reduce((s, p) => s + Number(p.amount    || 0), 0);
                const rowNet    = Number(b.netAmount || 0) || _itemsNet;
                const rowBal    = Number(b.netAmount || 0) > 0
                  ? Number(b.balanceAmount || 0)
                  : Math.max(0, _itemsNet - _paidSum);
                const rowPaid   = Math.max(0, rowNet - rowBal);
                return (
                  <div key={b._id} className={`rx-bill-row ${isActive ? "rx-bill-row--active" : ""}`}
                       onClick={() => loadBill(b._id)}>
                    <div className="rx-min-zero">
                      <div className="rx-bill-row-line">
                        <span className="rx-bill-num">{b.billNumber || "DRAFT"}</span>
                        <span className={`rx-card-stage rx-card-stage--${cls}`}>{b.billStatus}</span>
                        {b.visitType && <span className="rx-mono-tag rx-mono-tag--subtle">{b.visitType}</span>}
                      </div>
                      <div className="rx-bill-amounts">
                        <span>Total: <strong>{fmtCur(rowNet)}</strong></span>
                        <span className="paid">Paid: <strong>{fmtCur(rowPaid)}</strong></span>
                        {rowBal > 0 && <span className="due">Due: <strong>{fmtCur(rowBal)}</strong></span>}
                      </div>
                      <div className="rx-bill-row-meta">
                        Created: {fmtDate(b.createdAt)} · {(b.billItems || []).length} item{(b.billItems || []).length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Active bill details */}
            <div>
              {billLoading ? (
                <div style={{
                  background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
                  padding: 40, textAlign: "center", color: C.muted,
                }}>
                  <i className="pi pi-spin pi-spinner" style={{ fontSize: 24, color: C.blue }} />
                </div>
              ) : !activeBill ? (
                <div style={{
                  background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
                  padding: 40, textAlign: "center", color: C.muted, fontSize: 13,
                }}>
                  <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.6 }}>👉</div>
                  Select a bill from the left to view items, payments and collect.
                </div>
              ) : (
                <BillDetail
                  bill={activeBill}
                  unspentAdv={unspentAdv}
                  onGenerate={() => generateBill(activeBill._id)}
                  onPay={() => setPayTarget(activeBill)}
                  onSettle={() => setSettleTarget(activeBill)}
                  onPrint={() => printReceipt(activeBill)}
                  onRefund={() => setRefundTarget(activeBill)}
                  onCancel={() => setCancelTarget(activeBill)}
                  onAddService={() => setAddSvcTarget(activeBill)}
                  onDelete={() => deleteDraftBill(activeBill)}
                  onApplyAdvance={async () => {
                    const unspent = advances.filter((a) => (a.remainingAmount || 0) > 0);
                    if (unspent.length === 0) { toast.warning("No unspent advance available"); return; }
                    // FIFO — apply oldest first. Backend caps the amount at
                    // MIN(advance remaining, bill balance) so a single click
                    // is always safe.
                    const adv = unspent[unspent.length - 1];
                    try {
                      await axios.post(`${API_ENDPOINTS.BILLING}/advance/${adv._id}/apply`, { billId: activeBill._id });
                      toast.success("Advance applied to bill");
                      await load(uhid);
                      await loadBill(activeBill._id);
                    } catch (e) {
                      toast.error(e?.response?.data?.message || "Apply failed");
                    }
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}

      {payTarget && (
        <PaymentModal
          bill={payTarget}
          onClose={() => setPayTarget(null)}
          onDone={async () => {
            const id = payTarget._id;
            setPayTarget(null);
            await load(uhid);
            await loadBill(id);
            // Auto-print the payment receipt as soon as the bill refresh
            // settles. The fresh fetch is in activeBill state by now,
            // so we re-read it; fallback to direct refetch if state
            // hasn't propagated yet (e.g. cashier closed modal fast).
            try {
              const { data } = await axios.get(`${API_ENDPOINTS.BILLING}/${id}`);
              const fresh = data?.data || data;
              if (fresh) printPaymentReceipt(fresh);
            } catch (_) { /* don't block on receipt-print issues */ }
          }}
        />
      )}

      {settleTarget && (
        <SettlementModal
          bill={settleTarget}
          onClose={() => setSettleTarget(null)}
          onDone={async (openPayAfter) => {
            const id = settleTarget._id;
            setSettleTarget(null);
            await load(uhid);
            const fresh = await axios.get(`${API_ENDPOINTS.BILLING}/${id}`).catch(() => null);
            const freshBill = fresh?.data?.data || fresh?.data || null;
            if (freshBill) setActiveBill(freshBill);
            // When the cashier clicks "Save & Take Payment", chain straight
            // into the existing PaymentModal pre-filled to the new balance.
            if (openPayAfter && freshBill) setPayTarget(freshBill);
          }}
        />
      )}

      {showBulkCollect && (
        <BulkCollectModal
          uhid={uhid}
          patient={patient}
          /* R7am: filter on EFFECTIVE balance (items - positive payments)
              instead of stored bill.balanceAmount. Some bills have stale
              balanceAmount=0 even though billItems hold real money
              (R7aa root cause). Without this, the modal showed "0 bills"
              in the FIFO preview and the apply loop was a no-op while
              the toast lied "success". */
          bills={bills
            .filter((b) => ["GENERATED", "PARTIAL"].includes(b.billStatus))
            .map((b) => {
              const itemsNet = (b.billItems || []).reduce((s, i) => s + Number(i.netAmount || 0), 0);
              const paidPos  = (b.payments   || []).reduce((s, p) => s + Math.max(0, Number(p.amount || 0)), 0);
              const stored   = Number(b.balanceAmount || 0);
              const refNet   = Math.max(Number(b.patientPayableAmount || 0), Number(b.netAmount || 0), itemsNet);
              const effBal   = stored > 0 ? stored : Math.max(0, refNet - paidPos);
              return { ...b, _effectiveBalance: effBal };
            })
            .filter((b) => b._effectiveBalance > 0)}
          totalDue={totals.due}
          advances={advances}
          unspentAdv={unspentAdv}
          onClose={() => setShowBulkCollect(false)}
          onDone={async () => { setShowBulkCollect(false); await load(uhid); }}
        />
      )}

      {showBulkSettle && (
        <BulkSettleModal
          uhid={uhid}
          patient={patient}
          bills={bills.filter(b => ["GENERATED", "PARTIAL"].includes(b.billStatus) && Number(b.balanceAmount) > 0)}
          totalDue={totals.due}
          onClose={() => setShowBulkSettle(false)}
          onDone={async (openCollectAfter) => {
            setShowBulkSettle(false);
            await load(uhid);
            if (openCollectAfter) setShowBulkCollect(true);
          }}
        />
      )}

      {showNewBill && patient && (
        <NewBillModal
          uhid={uhid}
          patient={patient}
          existingBills={bills}
          onClose={() => setShowNewBill(false)}
          onCreated={async (newBill) => {
            setShowNewBill(false);
            await load(uhid);
            // Auto-select the freshly-created DRAFT in the right pane
            // and pop the Add Service picker so the cashier can tack on
            // the ad-hoc charge (e.g. RBS) in one continuous flow.
            if (newBill?._id) {
              const r = await axios.get(`${API_ENDPOINTS.BILLING}/${newBill._id}`).catch(() => null);
              const fresh = r?.data?.data || r?.data;
              if (fresh) {
                setActiveBill(fresh);
                setAddSvcTarget(fresh);
              }
            }
          }}
        />
      )}

      {showAdvDlg && patient && (
        <TakeAdvanceModal
          patient={patient}
          onClose={() => setShowAdvDlg(false)}
          onSaved={() => { setShowAdvDlg(false); load(uhid); }}
        />
      )}

      {showShortcuts && (
        <ShortcutsModal
          patientLoaded={!!patient}
          activeBillStatus={activeBill?.billStatus}
          unspentAdv={unspentAdv}
          onClose={() => setShowShortcuts(false)}
        />
      )}

      {addSvcTarget && (
        <AddServiceModal
          bill={addSvcTarget}
          onClose={() => setAddSvcTarget(null)}
          onChanged={async () => {
            // Keep modal open so the cashier can add multiple services
            // in one sitting; just refresh the underlying bill + totals.
            await load(uhid);
            await loadBill(addSvcTarget._id);
            // Re-sync the modal's `bill` prop so the running total updates.
            const r = await axios.get(`${API_ENDPOINTS.BILLING}/${addSvcTarget._id}`).catch(() => null);
            const fresh = r?.data?.data || r?.data;
            if (fresh) setAddSvcTarget(fresh);
          }}
        />
      )}

      {refundTarget && (
        <RefundModal
          bill={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={async (refundInfo) => {
            const id = refundTarget._id;
            setRefundTarget(null);
            await load(uhid);
            await loadBill(id);
            // R7a: auto-print refund-receipt — same pattern as PaymentModal.
            // Fresh-fetch so the latest negative payment row + balance are
            // included; don't block UI if print payload fails.
            try {
              const { data } = await axios.get(`${API_ENDPOINTS.BILLING}/${id}`);
              const fresh = data?.data || data;
              if (fresh && refundInfo) printRefundReceipt(fresh, refundInfo);
            } catch (_) { /* refund itself succeeded — receipt is best-effort */ }
            // R7c: when the cashier elected to credit-to-advance, the
            // backend returned the freshly-created PatientAdvance row.
            // Print the advance receipt for the second leg of the
            // transfer so the patient gets both slips (refund out of the
            // bill + advance deposit in the pool).
            if (refundInfo?.creditToAdvance && refundInfo?.advance && patient) {
              try {
                printAdvanceReceipt(refundInfo.advance, patient);
              } catch (_) { /* receipt is best-effort */ }
            }
          }}
        />
      )}

      {cancelTarget && (
        <CancelBillModal
          bill={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={async () => {
            const id = cancelTarget._id;
            setCancelTarget(null);
            await load(uhid);
            await loadBill(id);
          }}
        />
      )}

      {/* R7ao: Refund the unspent portion of an advance deposit. Opens
          from the Advance Deposits ledger row when remaining > 0 and the
          user has billing.refund permission. After success: refresh, print
          refund slip, toast. */}
      {advanceRefundTarget && (
        <RefundAdvanceModal
          advance={advanceRefundTarget}
          patient={patient}
          onClose={() => setAdvanceRefundTarget(null)}
          onDone={async (refundedAdv) => {
            setAdvanceRefundTarget(null);
            await load(uhid);
            if (refundedAdv && patient) {
              try { printAdvanceRefundReceipt(refundedAdv, patient); }
              catch (_) { /* receipt is best-effort */ }
            }
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function BillDetail({ bill, unspentAdv = 0, onGenerate, onPay, onSettle, onPrint, onRefund, onCancel, onApplyAdvance, onAddService, onDelete }) {
  const { can } = useAuth();
  const isDraft   = bill.billStatus === "DRAFT";
  const canPay    = ["GENERATED", "PARTIAL"].includes(bill.billStatus);
  const items     = bill.billItems || [];
  const payments  = bill.payments || [];
  const paidTotal = payments.reduce((s, p) => s + (p.amount || 0), 0);

  // R7aa: defensive fallback for the totals strip.
  //
  // Some legacy bills (and any bill whose save path bypassed the pre-save
  // recalcTotals hook — e.g. raw findOneAndUpdate that mutated billItems[]
  // but never re-saved through the schema) end up with billItems holding
  // real amounts while bill.grossAmount / netAmount / balanceAmount stay
  // at 0. The Reception strip used to read the parent fields verbatim,
  // which then displayed ₹0 on a bill that visibly had ₹300 of items.
  //
  // If the bill's own gross is zero but the line items sum to a positive
  // number, fall back to the line-item aggregate. We DO NOT silently
  // overwrite a non-zero parent gross — that would mask a real
  // discount/override change. The fallback only fires for stale rows.
  const _num = (v) => {
    if (v == null) return 0;
    if (typeof v === "object" && v.toString) v = v.toString();
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const itemGross    = items.reduce((s, i) => s + _num(i.unitPrice) * _num(i.quantity || 1), 0);
  const itemDiscount = items.reduce((s, i) => s + _num(i.discountAmount), 0);
  const itemTax      = items.reduce((s, i) => s + _num(i.taxAmount), 0);
  const itemNet      = items.reduce((s, i) => s + _num(i.netAmount), 0);

  const grossDisplay    = _num(bill.grossAmount)    || itemGross;
  const discountDisplay = _num(bill.totalDiscount)  || itemDiscount;
  const taxDisplay      = _num(bill.taxAmount)      || itemTax;
  const netDisplay      = _num(bill.netAmount)      || itemNet;
  // Balance: prefer the bill's own (post-payment) field; fall back to
  // net − paid (which equals net when nothing collected yet).
  const balanceDisplay  = _num(bill.netAmount) > 0
    ? _num(bill.balanceAmount)
    : Math.max(0, netDisplay - paidTotal);
  const paidDisplay     = Math.max(0, netDisplay - balanceDisplay);

  const canApply  = canPay && unspentAdv > 0 && balanceDisplay > 0;
  // Receptionist may collect payments but NOT issue refunds or cancel a
  // finalized bill — those need Accountant/Admin (billing.refund).
  // Backend already 403s the call; this hides the button so the UX matches.
  const canRefund = can("billing.refund") && paidTotal > 0 && bill.billStatus !== "CANCELLED";
  const canCancel = can("billing.refund") && !isDraft && paidTotal <= 0 && !["CANCELLED", "REFUNDED"].includes(bill.billStatus);

  return (
    <div className="rx-detail-card">
      <div className="rx-detail-head">
        <i className="pi pi-receipt rx-icon-info" />
        <div className="rx-flex-1">
          <div className="rx-detail-head-title">
            {bill.billNumber || "DRAFT BILL"}
            <span className={`rx-card-stage rx-card-stage--${STATUS_CLASS[bill.billStatus]} rx-ml-auto`}>{bill.billStatus}</span>
          </div>
          <div className="rx-detail-head-sub">{bill.visitType || "OPD"} · {items.length} item{items.length === 1 ? "" : "s"} · Created {fmtDate(bill.createdAt)}</div>
        </div>
        {isDraft && onAddService && (
          <button className="rx-action-btn rx-action-btn--success"
                  onClick={onAddService}
                  title="Add ECG, dressing, nebulisation, etc. to this draft">
            <i className="pi pi-plus" /> Add Service
          </button>
        )}
        {isDraft && (
          <button className="rx-action-btn rx-action-btn--primary" onClick={onGenerate}>
            <i className="pi pi-check" /> Generate Bill
          </button>
        )}
        {/* R7ci — Delete is DRAFT-only and only when nothing has been
            collected against it. Backend re-validates both invariants
            before actually removing the row. */}
        {isDraft && onDelete && paidTotal === 0 && (
          <button className="rx-action-btn rx-action-btn--danger"
                  onClick={onDelete}
                  title="Permanently delete this draft bill — items go with it. Use only when the draft was created by mistake.">
            <i className="pi pi-trash" /> Delete Draft
          </button>
        )}
        {canApply && (
          <button className="rx-action-btn rx-action-btn--primary"
                  onClick={onApplyAdvance}
                  title={`Consume from the oldest unspent advance (${unspentAdv.toLocaleString("en-IN")} available)`}>
            <i className="pi pi-arrow-circle-down" /> Apply Advance
          </button>
        )}
        {canPay && (
          <>
            {/* Two-button settlement flow. "Full Payment" is the one-click
                happy path — opens the payment modal pre-filled to the full
                outstanding balance. "Partial Settlement" routes through the
                adjustment modal first so the receptionist can apply an
                extra discount or tweak any item before collecting. */}
            <button className="rx-action-btn rx-action-btn--success"
                    onClick={onPay}
                    title={`Collect the full outstanding ${fmtCur(bill.balanceAmount)}`}>
              <i className="pi pi-check-circle" /> Full Payment
              <span className="rx-action-amount">{fmtCur(bill.balanceAmount)}</span>
            </button>
            <button className="rx-action-btn rx-action-btn--primary"
                    onClick={onSettle}
                    title="Adjust items / add extra discount, then collect">
              <i className="pi pi-sliders-h" /> Partial Settlement
            </button>
          </>
        )}
        {!isDraft && (
          <button className="rx-action-btn" onClick={onPrint}>
            <i className="pi pi-print" /> Print
          </button>
        )}
        {canRefund && (
          <button className="rx-action-btn rx-action-btn--danger" onClick={onRefund} title="Refund a payment">
            <i className="pi pi-undo" /> Refund
          </button>
        )}
        {canCancel && (
          <button className="rx-action-btn" onClick={onCancel} title="Cancel this bill (only when nothing collected)">
            <i className="pi pi-ban" /> Cancel
          </button>
        )}
      </div>

      {/* Items */}
      <div className="rx-detail-body">
        <div className="rx-section-label">Items</div>
        {items.length === 0 ? (
          <div className="rx-empty-tip">No items on this bill yet.</div>
        ) : (
          <table className="rx-table">
            <thead>
              <tr>
                <th>Service</th>
                <th className="right">Qty</th>
                <th className="right">Unit Price</th>
                <th className="right">Discount</th>
                <th className="right">Net</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it._id || i}>
                  <td>
                    {it.serviceName || it.name}
                    {it.appliedTariff && <span className="rx-tariff-pill">{it.appliedTariff}</span>}
                  </td>
                  <td className="right">{it.quantity || 1}</td>
                  <td className="right">{fmtCur(it.unitPrice)}</td>
                  <td className="right rx-text-discount">{it.discountPercent ? `${it.discountPercent}%` : "—"}</td>
                  <td className="right bold">{fmtCur(it.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Totals — R7aa: fall back to line-item aggregate when the parent
          bill's totals are stale (item rows were edited without firing
          recalcTotals on save). See grossDisplay / netDisplay / etc. */}
      <div className="rx-detail-totals">
        <div className="rx-grid-fit-120">
          <div>Gross: <strong>{fmtCur(grossDisplay)}</strong></div>
          <div>Discount: <strong className="rx-text-discount">{fmtCur(discountDisplay)}</strong></div>
          <div>Tax: <strong>{fmtCur(taxDisplay)}</strong></div>
          <div>Net: <strong className="rx-text-strong">{fmtCur(netDisplay)}</strong></div>
          <div>Paid: <strong className="rx-text-success">{fmtCur(paidDisplay)}</strong></div>
          <div>Balance: <strong className={balanceDisplay > 0 ? "rx-text-danger" : "rx-text-success"}>{fmtCur(balanceDisplay)}</strong></div>
        </div>
      </div>

      {/* Payments */}
      {payments.length > 0 && (
        <div className="rx-detail-payments">
          <div className="rx-section-label">Payments ({payments.length})</div>
          <table className="rx-table rx-table--sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Txn / Ref</th>
                <th>By</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={p._id || i}>
                  <td>{fmtDateTime(p.paidAt)}</td>
                  <td><span className="rx-mode-pill">{p.paymentMode}</span></td>
                  <td>{p.transactionId || "—"}</td>
                  <td>{p.receivedBy || "—"}</td>
                  <td className="right bold rx-text-success">{fmtCur(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function PaymentModal({ bill, onClose, onDone }) {
  const [amount, setAmount] = useState(bill.balanceAmount || 0);
  const [mode, setMode] = useState("CASH");
  const [txnId, setTxnId] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (amt > (bill.balanceAmount || 0) + 0.5) {
      // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
      if (!(await confirm({
        title: "Amount exceeds balance",
        body: `Amount ${fmtCur(amt)} exceeds the bill balance of ${fmtCur(bill.balanceAmount)}. The overage will be held as advance on the patient account.`,
        danger: true,
        confirmLabel: "Proceed",
      }))) return;
    }
    if (["UPI", "CARD", "CHEQUE", "ONLINE"].includes(mode) && !txnId.trim()) {
      // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
      if (!(await confirm({
        title: "No transaction reference",
        body: `No transaction reference was entered for the ${mode} payment. Record this payment anyway?`,
        danger: true,
        confirmLabel: "Record anyway",
      }))) return;
    }
    setSaving(true);
    try {
      // If bill is still DRAFT, auto-generate first — receptionist's
      // expectation is "take payment NOW". Calling /generate makes the
      // backend payment endpoint accept the request (it rejects DRAFT
      // bills hard). Skip generate if there are zero line items (would
      // 400 server-side anyway).
      if (bill.billStatus === "DRAFT") {
        if (!(bill.billItems || []).length) {
          toast.error("Bill has no items — add a service before generating");
          setSaving(false);
          return;
        }
        try {
          await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/generate`, { generatedBy: receivedBy || "Reception" });
        } catch (e) {
          toast.error(e?.response?.data?.message || "Auto-generate failed before payment");
          setSaving(false);
          return;
        }
      }
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/payment`, {
        amount: amt, paymentMode: mode,
        transactionId: txnId || undefined,
        receivedBy: receivedBy || undefined,
        remarks: remarks || undefined,
      });
      toast.success(`${fmtCur(amt)} recorded via ${mode}`);
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Payment failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--success">
          <i className="pi pi-wallet" />
          <span className="rx-modal-title">Collect Payment — {bill.billNumber}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--success">
            💰 Balance Due: <strong>{fmtCur(bill.balanceAmount)}</strong> of <strong>{fmtCur(bill.netAmount)}</strong>
          </div>

          <div className="his-field-group">
            <label className="his-label">Amount (₹) *</label>
            <input className="his-field" type="number" min="0" step="0.01"
                   value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
          </div>

          <div className="his-field-group">
            <label className="his-label">Payment Mode *</label>
            <div className="rx-grid-5">
              {PAYMENT_MODES.map(m => (
                <button key={m} type="button"
                        className={`rx-slot ${mode === m ? "rx-slot--selected" : ""}`}
                        onClick={() => setMode(m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {mode !== "CASH" && (
            <div className="his-field-group">
              <label className="his-label">{mode === "UPI" ? "UPI Reference / VPA" : mode === "CHEQUE" ? "Cheque Number" : "Transaction ID"}</label>
              <input className="his-field" value={txnId} onChange={e => setTxnId(e.target.value)}
                     placeholder={mode === "UPI" ? "e.g. 412345678901" : mode === "CHEQUE" ? "e.g. 000123" : "Auth / approval code"} />
            </div>
          )}

          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Received By</label>
              <input className="his-field" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="Reception staff name" />
            </div>
            <div className="his-field-group">
              <label className="his-label">Remarks</label>
              <input className="his-field" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--success" onClick={submit} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} /> Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function RefundModal({ bill, onClose, onDone }) {
  const paid = (bill.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const [amount, setAmount] = useState(paid);
  const [mode, setMode] = useState("CASH");
  const [reason, setReason] = useState("");
  const [refundedBy, setRefundedBy] = useState("");
  const [txnId, setTxnId] = useState("");
  // R7c: when true, the refund stays inside the hospital — money flows
  // back into the patient's advance pool instead of leaving the till.
  // Useful for IPD patients with bills still coming. Gated to non-TPA
  // modes because TPA money must return to the insurer.
  const [creditToAdvance, setCreditToAdvance] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a refund amount");
    if (amt > paid + 0.5) return toast.error(`Cannot refund more than collected (${fmtCur(paid)})`);
    if (!reason.trim()) return toast.error("Refund reason is mandatory for audit");
    setSaving(true);
    try {
      const { data: resp } = await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/refund`, {
        amount: amt, mode, reason: reason.trim(),
        refundedBy: refundedBy || undefined,
        transactionId: txnId || undefined,
        creditToAdvance,
      });
      const msg = creditToAdvance && resp?.advance
        ? `Refund ${fmtCur(amt)} credited to patient's advance pool`
        : `Refund ${fmtCur(amt)} recorded`;
      toast.success(msg);
      // R7a + R7c: pass refund details up so the parent prints the
      // refund-receipt; also pass the created PatientAdvance row (when
      // creditToAdvance was set) so the parent fires the advance-receipt
      // print for the second leg of the transfer.
      onDone({
        amount: amt,
        mode,
        reason: reason.trim(),
        refundedBy: refundedBy || "Reception",
        transactionId: txnId || "",
        creditToAdvance,
        advance: resp?.advance || null,
      });
    } catch (e) {
      toast.error(e?.response?.data?.message || "Refund failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--danger">
          <i className="pi pi-undo" />
          <span className="rx-modal-title">Refund — {bill.billNumber}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--danger">
            ⚠ Already collected: <strong>{fmtCur(paid)}</strong> · Refunds are permanently logged for NABH audit.
          </div>

          <div className="his-field-group">
            <label className="his-label">Refund Amount (₹) *</label>
            <input className="his-field" type="number" min="0" step="0.01"
                   value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
          </div>

          <div className="his-field-group">
            <label className="his-label">Refund Mode</label>
            <div className="rx-grid-5">
              {PAYMENT_MODES.map(m => (
                <button key={m} type="button"
                        className={`rx-slot ${mode === m ? "rx-slot--selected" : ""}`}
                        onClick={() => setMode(m)}>{m}</button>
              ))}
            </div>
          </div>

          <div className="his-field-group">
            <label className="his-label">Reason *</label>
            <textarea className="his-textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Service not rendered, duplicate charge, patient complaint…" />
          </div>

          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Refunded By</label>
              <input className="his-field" value={refundedBy} onChange={e => setRefundedBy(e.target.value)} placeholder="Reception staff name" />
            </div>
            {mode !== "CASH" && (
              <div className="his-field-group">
                <label className="his-label">{mode === "UPI" ? "UPI Reference" : mode === "CHEQUE" ? "Cheque #" : "Transaction ID"}</label>
                <input className="his-field" value={txnId} onChange={e => setTxnId(e.target.value)} />
              </div>
            )}
          </div>

          {/* R7c: credit-to-advance toggle. Hidden for TPA refunds because
              insurer money can't sit in patient's pool. Disabled when the
              user picks TPA mode — defensive defence in case backend
              changes accept it later. */}
          {mode !== "TPA_CLAIM" && (
            <label className="rx-checkbox-row">
              <input type="checkbox" checked={creditToAdvance}
                     onChange={e => setCreditToAdvance(e.target.checked)} />
              <span>
                <strong>Credit to patient's advance pool</strong>
                {" "}— no cash handed back; the amount becomes deposit
                credit usable on future bills (a separate advance receipt
                will print alongside the refund slip).
              </span>
            </label>
          )}
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Keep Payment</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--danger" onClick={submit} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-undo"}`} /> {creditToAdvance ? "Credit to Advance Pool" : "Confirm Refund"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */
/* SettlementModal — counter-side adjustment for GENERATED/PARTIAL
   bills. Lets the receptionist:
     - bump any line item's quantity / unit price up or down
     - apply an extra bill-level discount (either as a % of the gross
       or as a flat ₹ amount)
     - capture a mandatory reason + their name (audit)
     - either save the adjustment, or chain straight into the payment
       modal for the new balance.

   The math runs entirely on the frontend for the live preview; the
   actual recompute happens on the server (pre-save hook) when we
   POST /:billId/settlement-adjust.                                    */

function SettlementModal({ bill, onClose, onDone }) {
  // Editable line items — keyed by itemId so we can submit a small
  // diff (only the items the cashier actually touched) instead of the
  // whole list. Start as null and lazily fill on first edit.
  const [edits, setEdits] = useState({});
  const [extraDiscPct, setExtraDiscPct] = useState(0);   // % entry mode
  const [extraDiscAmt, setExtraDiscAmt] = useState(0);   // ₹ entry mode
  const [discMode, setDiscMode]   = useState("PERCENT"); // PERCENT | AMOUNT
  const [reason, setReason]       = useState("");
  const [adjustedBy, setAdjustedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const items = bill.billItems || [];

  // Effective row — falls back to the original bill item if the
  // cashier hasn't touched this row yet.
  const effective = (it) => {
    const e = edits[it._id] || {};
    return {
      quantity:        e.quantity        ?? (it.quantity ?? 1),
      unitPrice:       e.unitPrice       ?? Number(it.unitPrice),
      discountPercent: e.discountPercent ?? (it.discountPercent ?? 0),
    };
  };

  const setField = (itemId, field, value) => {
    setEdits((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || {}), [field]: value },
    }));
  };

  // Live preview math. Mirrors the backend pre-save hook so the
  // numbers in the UI match exactly what the server will compute.
  const preview = useMemo(() => {
    let gross = 0, disc = 0, tax = 0;
    items.forEach((it) => {
      const eff = effective(it);
      const g = Number(eff.unitPrice) * Number(eff.quantity);
      const d = (g * Number(eff.discountPercent || 0)) / 100;
      const n = g - d;
      const t = it.isTaxable ? (n * Number(it.taxPercent || 0)) / 100 : 0;
      gross += g; disc += d; tax += t;
    });
    const subtotal = gross - disc + tax;
    const extra = discMode === "PERCENT"
      ? (subtotal * Number(extraDiscPct || 0)) / 100
      : Number(extraDiscAmt || 0);
    const cappedExtra = Math.min(Math.max(0, extra), subtotal);
    const newNet = subtotal - cappedExtra;
    const paidSoFar = Number(bill.netAmount || 0) - Number(bill.balanceAmount || 0);
    const newBalance = Math.max(0, newNet - paidSoFar);
    return { gross, disc, tax, extra: cappedExtra, newNet, paidSoFar, newBalance };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, extraDiscPct, extraDiscAmt, discMode, items, bill.netAmount, bill.balanceAmount]);

  const submit = async (openPayAfter) => {
    if (!reason.trim())     return toast.error("Reason is mandatory (audit log)");
    if (!adjustedBy.trim()) return toast.error("Your name is required (audit log)");

    // Build the diff: only send rows the cashier actually changed.
    const itemsPayload = [];
    items.forEach((it) => {
      const e = edits[it._id];
      if (!e) return;
      const row = { itemId: it._id };
      if (e.quantity != null && Number(e.quantity) !== Number(it.quantity)) {
        row.quantity = Number(e.quantity);
      }
      if (e.unitPrice != null && Number(e.unitPrice) !== Number(it.unitPrice)) {
        row.unitPrice = Number(e.unitPrice);
      }
      if (
        e.discountPercent != null &&
        Number(e.discountPercent) !== Number(it.discountPercent || 0)
      ) {
        row.discountPercent = Number(e.discountPercent);
      }
      if (row.quantity != null || row.unitPrice != null || row.discountPercent != null) {
        itemsPayload.push(row);
      }
    });

    const payload = {
      adjustedBy: adjustedBy.trim(),
      reason:     reason.trim(),
      items:      itemsPayload,
      extraDiscount:       preview.extra,
      extraDiscountReason: reason.trim(),
    };

    if (itemsPayload.length === 0 && !preview.extra) {
      return toast.error("Nothing to adjust — change at least one line or set an extra discount");
    }

    setSaving(true);
    try {
      await axios.post(
        `${API_ENDPOINTS.BILLING}/${bill._id}/settlement-adjust`,
        payload,
      );
      toast.success("Adjustment saved · audit logged");
      onDone(openPayAfter);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Adjustment failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal rx-modal--lg" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--primary">
          <i className="pi pi-sliders-h" />
          <span className="rx-modal-title">Partial Settlement — {bill.billNumber}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--info">
            Current balance: <strong>{fmtCur(bill.balanceAmount)}</strong> of <strong>{fmtCur(bill.netAmount)}</strong>
            {(bill.netAmount - bill.balanceAmount) > 0 && (
              <> · Already paid: <strong className="rx-text-success">{fmtCur(preview.paidSoFar)}</strong></>
            )}
          </div>

          <div className="rx-section-label">Adjust line items</div>
          <table className="rx-table rx-table--sm rx-settle-table">
            <thead>
              <tr>
                <th>Service</th>
                <th className="right">Qty</th>
                <th className="right">Unit Price</th>
                <th className="right">Disc %</th>
                <th className="right">Net</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const eff = effective(it);
                const lineGross = eff.unitPrice * eff.quantity;
                const lineNet   = lineGross - (lineGross * eff.discountPercent) / 100;
                const touched   = !!edits[it._id];
                return (
                  <tr key={it._id} className={touched ? "rx-row-touched" : ""}>
                    <td>{it.serviceName}</td>
                    <td className="right">
                      <input type="number" min="0" step="1"
                             className="rx-settle-input"
                             value={eff.quantity}
                             onChange={e => setField(it._id, "quantity", e.target.value === "" ? "" : Number(e.target.value))} />
                    </td>
                    <td className="right">
                      <input type="number" min="0" step="0.01"
                             className="rx-settle-input"
                             value={eff.unitPrice}
                             onChange={e => setField(it._id, "unitPrice", e.target.value === "" ? "" : Number(e.target.value))} />
                    </td>
                    <td className="right">
                      <input type="number" min="0" max="100" step="0.5"
                             className="rx-settle-input rx-settle-input--xs"
                             value={eff.discountPercent}
                             onChange={e => setField(it._id, "discountPercent", e.target.value === "" ? "" : Number(e.target.value))} />
                    </td>
                    <td className="right bold">{fmtCur(lineNet)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="rx-section-label" style={{ marginTop: 14 }}>Extra discount (bill-level)</div>
          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Discount Mode</label>
              <div className="rx-grid-2">
                <button type="button"
                        className={`rx-slot ${discMode === "PERCENT" ? "rx-slot--selected" : ""}`}
                        onClick={() => setDiscMode("PERCENT")}>
                  % of subtotal
                </button>
                <button type="button"
                        className={`rx-slot ${discMode === "AMOUNT" ? "rx-slot--selected" : ""}`}
                        onClick={() => setDiscMode("AMOUNT")}>
                  Flat ₹ amount
                </button>
              </div>
            </div>
            {discMode === "PERCENT" ? (
              <div className="his-field-group">
                <label className="his-label">Additional Discount %</label>
                <input type="number" min="0" max="100" step="0.5"
                       className="his-field"
                       value={extraDiscPct}
                       onChange={e => setExtraDiscPct(e.target.value === "" ? 0 : Number(e.target.value))}
                       placeholder="e.g. 5" />
              </div>
            ) : (
              <div className="his-field-group">
                <label className="his-label">Additional Discount (₹)</label>
                <input type="number" min="0" step="1"
                       className="his-field"
                       value={extraDiscAmt}
                       onChange={e => setExtraDiscAmt(e.target.value === "" ? 0 : Number(e.target.value))}
                       placeholder="e.g. 200" />
              </div>
            )}
          </div>

          <div className="rx-section-label" style={{ marginTop: 14 }}>Audit details *</div>
          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Your Name *</label>
              <input className="his-field" value={adjustedBy}
                     onChange={e => setAdjustedBy(e.target.value)}
                     placeholder="Reception staff name" />
            </div>
            <div className="his-field-group">
              <label className="his-label">Reason *</label>
              <input className="his-field" value={reason}
                     onChange={e => setReason(e.target.value)}
                     placeholder="e.g. courtesy waiver, line correction" />
            </div>
          </div>

          {/* Live preview summary */}
          <div className="rx-settle-preview">
            <div className="rx-settle-preview-row">
              <span>Subtotal (after item edits)</span>
              <strong>{fmtCur(preview.gross - preview.disc + preview.tax)}</strong>
            </div>
            <div className="rx-settle-preview-row rx-text-discount">
              <span>– Extra discount</span>
              <strong>{fmtCur(preview.extra)}</strong>
            </div>
            <div className="rx-settle-preview-row rx-settle-preview-row--total">
              <span>New net total</span>
              <strong>{fmtCur(preview.newNet)}</strong>
            </div>
            <div className="rx-settle-preview-row">
              <span>Paid so far</span>
              <strong className="rx-text-success">{fmtCur(preview.paidSoFar)}</strong>
            </div>
            <div className="rx-settle-preview-row rx-settle-preview-row--balance">
              <span>NEW BALANCE DUE</span>
              <strong className={preview.newBalance > 0 ? "rx-text-danger" : "rx-text-success"}>
                {fmtCur(preview.newBalance)}
              </strong>
            </div>
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary"
                  onClick={() => submit(false)} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-save"}`} /> Save Adjustment
          </button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--success"
                  onClick={() => submit(true)} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-wallet"}`} /> Save &amp; Take Payment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */
/* NewBillModal — create a fresh DRAFT bill for ad-hoc charges
   AFTER the patient's previous bills are already settled. Common
   scenario: doctor adds an RBS or dressing during follow-up; the
   existing OPD/IPD bill is PAID, so the cashier needs a clean
   slate. Backend uses getOrCreateDraftBill which is idempotent:
   if a DRAFT for the same (UHID, visitType, admission) already
   exists, it returns that one — so this is also a safe "open
   the current DRAFT" shortcut.                                    */

function NewBillModal({ uhid, patient, existingBills = [], onClose, onCreated }) {
  // Default to OPD because that's the most common ad-hoc case
  // (follow-up consults, walk-in tests). If the patient has an
  // active admission we'll auto-show IPD as a one-tap alternative.
  const [visitType, setVisitType] = useState("OPD");
  const [saving, setSaving] = useState(false);

  // Surface the existing DRAFT (if any) so the cashier doesn't
  // accidentally try to create a duplicate. Backend would just
  // return the same row anyway, but showing it up front is
  // clearer.
  const existingDraft = useMemo(
    () => existingBills.find(b => b.visitType === visitType && b.billStatus === "DRAFT"),
    [existingBills, visitType],
  );

  const ADHOC_TYPES = [
    { key: "OPD",       label: "OPD",       icon: "pi-user-plus", color: "#06b6d4" },
    { key: "IPD",       label: "IPD",       icon: "pi-home",      color: "#7c3aed" },
    { key: "DAYCARE",   label: "Day Care",  icon: "pi-sun",       color: "#d97706" },
    { key: "EMERGENCY", label: "Emergency", icon: "pi-bolt",      color: "#dc2626" },
  ];

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await axios.post(`${API_ENDPOINTS.BILLING}/create`, {
        UHID:      uhid,
        visitType,
      });
      const newBill = data?.data || data;
      toast.success(
        existingDraft
          ? "Existing DRAFT reopened — add services to continue"
          : `New DRAFT bill created (${visitType})`,
      );
      onCreated(newBill);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not create bill");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--primary">
          <i className="pi pi-plus" />
          <span className="rx-modal-title">
            New Bill — {patient?.fullName || uhid}
          </span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--info">
            Spins up a fresh DRAFT bill so you can add ad-hoc services
            (e.g. RBS, dressing, nebulisation) the doctor just ordered.
            <br />After creation, the Add Service picker opens right away.
          </div>

          <div className="his-field-group">
            <label className="his-label">Visit Type *</label>
            <div className="rx-grid-5">
              {ADHOC_TYPES.map(t => (
                <button key={t.key} type="button"
                        className={`rx-slot ${visitType === t.key ? "rx-slot--selected" : ""}`}
                        onClick={() => setVisitType(t.key)}>
                  <i className={`pi ${t.icon}`} /> {t.label}
                </button>
              ))}
            </div>
          </div>

          {existingDraft && (
            <div className="rx-banner rx-banner--warning">
              ⚠ A DRAFT {visitType} bill already exists
              ({existingDraft.billNumber || "no #"}, ₹{Number(existingDraft.netAmount) || 0}).
              Clicking Create will reopen it — services you add go onto
              that draft, not a new row.
            </div>
          )}
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--success"
                  onClick={submit} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} />
            {existingDraft ? " Reopen DRAFT" : " Create DRAFT Bill"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */
/* BulkCollectModal — collect a single lump sum across every
   outstanding bill for the UHID. Backend distributes FIFO; this
   modal shows the cashier the projected allocation BEFORE submit so
   they can sanity-check what each bill will receive.                  */

function BulkCollectModal({ uhid, patient, bills, totalDue, advances = [], unspentAdv = 0, onClose, onDone }) {
  const [amount, setAmount] = useState(totalDue || 0);
  const [mode, setMode] = useState("CASH");
  const [txnId, setTxnId] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  // R7ak: live list of advance receipts with money still available.
  // Newest-first so the receptionist sees the most recent deposit at top
  // — easier to confirm with the patient ("the ₹50,000 you gave today").
  const availableAdvances = (advances || [])
    .filter((a) => Number(a.remainingAmount || 0) > 0)
    .sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0));

  // FIFO preview — mirrors the backend's distribution logic so the
  // cashier sees exactly which bills will get how much before saving.
  // R7am: use the EFFECTIVE balance (parent-injected `_effectiveBalance`)
  // so bills whose stored balanceAmount is stale (R7aa root) still
  // appear in the FIFO with their true outstanding.
  const allocation = useMemo(() => {
    const amt = Number(amount) || 0;
    const sorted = [...bills].sort((a, b) =>
      new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    let remaining = amt;
    return sorted.map((b) => {
      const bal = Number(b._effectiveBalance ?? b.balanceAmount) || 0;
      const leg = Math.min(remaining, bal);
      remaining = Math.max(0, remaining - leg);
      return {
        billId:    b._id,
        billNumber: b.billNumber,
        balance:   bal,
        leg,
        leftover:  Math.max(0, bal - leg),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, bills]);

  const willTouch = allocation.filter(a => a.leg > 0.005).length;

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0)        return toast.error("Enter a valid amount");
    if (amt > totalDue + 0.5)    return toast.error(`Cannot collect more than total due (${fmtCur(totalDue)})`);
    // R7ak: CHEQUE removed from the bulk picker — wasn't used in practice
    // and cheque collections need a dedicated reconciliation flow.
    if (["UPI", "CARD", "ONLINE"].includes(mode) && !txnId.trim()) {
      // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
      if (!(await confirm({
        title: "No transaction reference",
        body: `No transaction reference was entered for the ${mode} payment. Record this bulk collection anyway?`,
        danger: true,
        confirmLabel: "Record anyway",
      }))) return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post(
        `${API_ENDPOINTS.BILLING}/uhid/${encodeURIComponent(uhid)}/collect-all`,
        {
          amount:        amt,
          paymentMode:   mode,
          transactionId: txnId || undefined,
          receivedBy:    receivedBy || undefined,
          remarks:       remarks || undefined,
        },
      );
      const meta = data?.data;
      toast.success(`${fmtCur(meta?.totalCollected || amt)} collected across ${meta?.billsTouched || willTouch} bill(s)`);
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Collection failed");
    } finally {
      setSaving(false);
    }
  };

  // R7ak: settle outstanding bills by applying the patient's advance
  // pool. Loops over availableAdvances (newest first) and over the FIFO
  // billable allocation, posting /advance/:id/apply for each bill until
  // either the amount field is satisfied or advances run dry. Each leg
  // gets its own receipt-style audit entry on the bill + advance row.
  const applyAdvance = async () => {
    const amt = Math.min(Number(amount) || 0, unspentAdv, totalDue);
    if (!amt || amt <= 0) {
      return toast.warn("Nothing to apply — check the amount and that the patient has unspent advance.");
    }
    if (availableAdvances.length === 0) {
      return toast.warn("No unspent advance available to apply.");
    }
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Apply advance to outstanding bills?",
      body:
        `${fmtCur(amt)} from the patient's advance pool will be applied FIFO across ${bills.length} outstanding bill${bills.length === 1 ? "" : "s"}. ` +
        `${fmtCur(unspentAdv)} is available in total.`,
      confirmLabel: "Apply",
    }))) return;

    // R7am: guard against the "no bills" case — if allocation is empty
    // we'd silently no-op the loop and toast success. That's the bug
    // the user hit. Now we abort with a clear error.
    if (allocation.length === 0 || allocation.every((l) => l.leg <= 0.005)) {
      return toast.error("No open bills to apply against. Check that bills have balance > 0.");
    }

    setSaving(true);
    let totalApplied = 0;
    let lastError = null;
    try {
      // Walk the FIFO allocation and apply each bill leg from the
      // advance pool. We now pass an EXPLICIT `amount` per call so the
      // backend doesn't fall back to its own (stale) balance calc.
      // Each call's response carries the actual appliedAmount — we sum
      // those instead of the optimistic local counter so the toast
      // tells the truth even if the backend partially-applied.
      let advIdx = 0;
      let advLeft = Number(availableAdvances[advIdx]?.remainingAmount || 0);
      for (const leg of allocation) {
        if (leg.leg <= 0.005) continue;
        let billOwed = leg.leg;
        while (billOwed > 0.005 && advIdx < availableAdvances.length) {
          if (advLeft <= 0.005) {
            advIdx += 1;
            advLeft = Number(availableAdvances[advIdx]?.remainingAmount || 0);
            continue;
          }
          const adv = availableAdvances[advIdx];
          const requestThisLeg = Math.min(advLeft, billOwed);
          try {
            const { data } = await axios.post(
              `${API_ENDPOINTS.BILLING}/advance/${adv._id}/apply`,
              { billId: leg.billId, amount: requestThisLeg },
            );
            const applied = Number(data?.appliedAmount || requestThisLeg) || 0;
            totalApplied += applied;
            advLeft  -= applied;
            billOwed -= applied;
          } catch (apiErr) {
            // Surface the failure rather than continuing silently. Keep
            // looping is dangerous — we might apply some legs and skip
            // others without telling the cashier.
            lastError = apiErr;
            throw apiErr;
          }
        }
        if (advIdx >= availableAdvances.length) break;
      }
      if (totalApplied <= 0.005) {
        toast.warn("Nothing was applied — backend returned ₹0 for every leg. Check bill status.");
      } else {
        toast.success(`Applied ${fmtCur(totalApplied)} from advance pool`);
      }
      onDone();
    } catch (e) {
      const msg = e?.response?.data?.message || lastError?.response?.data?.message || e?.message || "Apply advance failed";
      toast.error(`${msg}${totalApplied > 0 ? ` — only ${fmtCur(totalApplied)} got through before the error` : ""}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal rx-modal--lg" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--success">
          <i className="pi pi-check-circle" />
          <span className="rx-modal-title">
            Collect All Dues — {patient?.fullName || uhid}
          </span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--success">
            💰 Total outstanding: <strong>{fmtCur(totalDue)}</strong> across <strong>{bills.length}</strong> bill{bills.length === 1 ? "" : "s"}
          </div>

          <div className="his-field-group">
            <label className="his-label">Amount (₹) *</label>
            <input className="his-field" type="number" min="0" step="0.01"
                   value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
          </div>

          {/* R7al: when patient has unspent advance, CASH/UPI/CARD/ONLINE
              are HARD-LOCKED. The receptionist must adjust from the
              deposit pool first — only after the advance is exhausted
              do the other payment modes unlock. This enforces the
              hospital rule that pre-deposited money MUST be applied
              before taking fresh payment. */}
          {unspentAdv > 0 && (
            <div className="rx-banner" style={{ background:"#fef3c7", borderColor:"#f59e0b", color:"#78350f", fontWeight: 600 }}>
              <i className="pi pi-lock" />{" "}
              <strong>Advance pool must be applied first.</strong> Patient has{" "}
              <strong style={{ color:"#0f172a" }}>{fmtCur(unspentAdv)}</strong> on deposit
              {availableAdvances.length > 1 && ` (across ${availableAdvances.length} receipts)`}.
              {" "}Other payment modes are locked until this is fully adjusted.
              Click <strong>Apply Advance</strong> below first.
            </div>
          )}

          <div className="his-field-group">
            <label className="his-label">Payment Mode *</label>
            {/* R7ak: CHEQUE removed — bulk cheque collections never settle
                cleanly here (cheque needs bank-clearance reconciliation
                separately).
                R7al: every non-CASH mode is disabled while the patient
                still has unspent advance. CASH stays visually selected
                (default) but the Collect button is also disabled, so
                the receptionist can't accidentally double-charge. */}
            <div className="rx-grid-5">
              {PAYMENT_MODES
                .filter(m => m !== "TPA_CLAIM" && m !== "CHEQUE")
                .map(m => {
                  const locked = unspentAdv > 0;
                  return (
                    <button key={m} type="button"
                            className={`rx-slot ${mode === m ? "rx-slot--selected" : ""}`}
                            onClick={() => { if (!locked) setMode(m); }}
                            disabled={locked}
                            title={locked ? `Locked — apply ${fmtCur(unspentAdv)} advance pool first` : ""}
                            style={locked ? { opacity: 0.45, cursor: "not-allowed" } : {}}>
                      {locked && <i className="pi pi-lock" style={{ fontSize: 10, marginRight: 4 }} />}
                      {m}
                    </button>
                  );
                })}
            </div>
          </div>

          {mode !== "CASH" && unspentAdv === 0 && (
            <div className="his-field-group">
              <label className="his-label">{mode === "UPI" ? "UPI Reference / VPA" : "Transaction ID"}</label>
              <input className="his-field" value={txnId} onChange={e => setTxnId(e.target.value)}
                     placeholder={mode === "UPI" ? "e.g. 412345678901" : "Auth / approval code"} />
            </div>
          )}

          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Received By</label>
              <input className="his-field" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="Reception staff name" />
            </div>
            <div className="his-field-group">
              <label className="his-label">Remarks</label>
              <input className="his-field" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {/* FIFO allocation preview */}
          <div className="rx-section-label" style={{ marginTop: 14 }}>
            FIFO allocation preview ({willTouch} bill{willTouch === 1 ? "" : "s"})
          </div>
          <table className="rx-table rx-table--sm">
            <thead>
              <tr>
                <th>Bill #</th>
                <th className="right">Balance</th>
                <th className="right">This payment</th>
                <th className="right">Will leave</th>
              </tr>
            </thead>
            <tbody>
              {allocation.map((a) => (
                <tr key={a.billId} style={a.leg <= 0.005 ? { opacity: 0.4 } : {}}>
                  <td className="rx-mono-tag rx-mono-tag--subtle">{a.billNumber}</td>
                  <td className="right">{fmtCur(a.balance)}</td>
                  <td className="right bold rx-text-success">{a.leg > 0.005 ? fmtCur(a.leg) : "—"}</td>
                  <td className="right">{a.leg > 0.005 ? (a.leftover > 0.005 ? fmtCur(a.leftover) : "PAID") : fmtCur(a.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          {/* R7ak/R7al: Apply Advance is the PRIMARY action when the
              patient has unspent advance. Settles outstanding bills
              from the deposit pool — FIFO across advance receipts
              (newest-first) and bills (oldest-first). When advance is
              exhausted this button hides and the cash Collect button
              becomes primary. */}
          {unspentAdv > 0 && (
            <button className="rx-modal-btn-primary"
                    style={{ background: "#7c3aed", borderColor: "#7c3aed" }}
                    onClick={applyAdvance}
                    disabled={saving || !Number(amount) || Number(amount) <= 0}
                    title={`Adjust ${fmtCur(Math.min(Number(amount) || 0, unspentAdv, totalDue))} from advance pool (₹${unspentAdv} available)`}>
              <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-arrow-circle-down"}`} />{" "}
              Apply Advance ({fmtCur(Math.min(Number(amount) || 0, unspentAdv, totalDue))})
            </button>
          )}
          {/* R7al: Collect button is LOCKED while unspent advance > 0
              — the receptionist must run Apply Advance first. After
              that, this button becomes the primary cash-collection
              affordance for whatever balance remains. */}
          <button className="rx-modal-btn-primary rx-modal-btn-primary--success"
                  onClick={submit}
                  disabled={saving || unspentAdv > 0}
                  title={unspentAdv > 0
                    ? `Locked — apply ${fmtCur(unspentAdv)} advance pool first`
                    : ""}
                  style={unspentAdv > 0 ? { opacity: 0.45, cursor: "not-allowed" } : {}}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : (unspentAdv > 0 ? "pi-lock" : "pi-check")}`} />{" "}
            Collect {fmtCur(amount)}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */
/* BulkSettleModal — one discount distributed across every
   outstanding bill for the UHID. PERCENT mode is uniform per-bill;
   AMOUNT mode is proportional to each bill's share of total
   outstanding. Always emits an audit log entry per bill.            */

function BulkSettleModal({ uhid, patient, bills, totalDue, onClose, onDone }) {
  const [mode, setMode]      = useState("PERCENT");
  const [pct,  setPct]       = useState(0);
  const [amt,  setAmt]       = useState(0);
  const [reason, setReason]  = useState("");
  const [adjustedBy, setAdjustedBy] = useState("");
  const [saving, setSaving]  = useState(false);

  // Live preview per-bill mirrors the backend math.
  const preview = useMemo(() => {
    const out = bills.map((b) => {
      const bal = Number(b.balanceAmount) || 0;
      let disc;
      if (mode === "PERCENT") {
        disc = (bal * Number(pct || 0)) / 100;
      } else {
        disc = totalDue > 0 ? (Number(amt || 0) * bal) / totalDue : 0;
      }
      disc = Math.min(Math.max(0, disc), bal);
      return {
        billId:    b._id,
        billNumber: b.billNumber,
        balance:   bal,
        discount:  disc,
        newBalance: bal - disc,
      };
    });
    const totalDiscount = out.reduce((s, r) => s + r.discount, 0);
    const newTotalDue   = totalDue - totalDiscount;
    return { rows: out, totalDiscount, newTotalDue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, mode, pct, amt, totalDue]);

  const submit = async (openCollectAfter) => {
    if (!reason.trim())     return toast.error("Reason is mandatory (audit log)");
    if (!adjustedBy.trim()) return toast.error("Your name is required (audit log)");
    const value = mode === "PERCENT" ? Number(pct) : Number(amt);
    if (!value || value <= 0) return toast.error("Enter a non-zero discount");

    setSaving(true);
    try {
      const { data } = await axios.post(
        `${API_ENDPOINTS.BILLING}/uhid/${encodeURIComponent(uhid)}/bulk-settle`,
        { mode, value, adjustedBy: adjustedBy.trim(), reason: reason.trim() },
      );
      const meta = data?.data;
      const touched = meta?.billsTouched || 0;
      const skipped = Array.isArray(meta?.skipped) ? meta.skipped : [];
      // R7d: surface the skipped[] array from R7b's bulk-settle state-
      // predicate fix. If any bills were skipped (state changed mid-
      // batch or VersionError race), the cashier needs to know they
      // weren't included in the discount so they can retry individually.
      toast.success(`Bulk discount ${fmtCur(meta?.totalDiscount || preview.totalDiscount)} applied to ${touched} bill(s)`);
      if (skipped.length > 0) {
        toast.error(
          `${skipped.length} bill(s) skipped: ${skipped.map(s => `${s.billNumber} (${s.reason})`).join("; ")}`,
          { duration: 8000 },
        );
      }
      onDone(openCollectAfter);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Bulk settlement failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal rx-modal--lg" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--primary">
          <i className="pi pi-sliders-h" />
          <span className="rx-modal-title">
            Settle All — {patient?.fullName || uhid}
          </span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--info">
            Outstanding before discount: <strong>{fmtCur(totalDue)}</strong> across <strong>{bills.length}</strong> bill{bills.length === 1 ? "" : "s"}
          </div>

          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Discount Mode</label>
              <div className="rx-grid-2">
                <button type="button"
                        className={`rx-slot ${mode === "PERCENT" ? "rx-slot--selected" : ""}`}
                        onClick={() => setMode("PERCENT")}>
                  % per bill
                </button>
                <button type="button"
                        className={`rx-slot ${mode === "AMOUNT" ? "rx-slot--selected" : ""}`}
                        onClick={() => setMode("AMOUNT")}>
                  Flat ₹ (proportional)
                </button>
              </div>
            </div>
            {mode === "PERCENT" ? (
              <div className="his-field-group">
                <label className="his-label">Discount % (each bill) *</label>
                <input type="number" min="0" max="100" step="0.5" className="his-field"
                       value={pct} onChange={e => setPct(Number(e.target.value) || 0)} placeholder="e.g. 5" />
              </div>
            ) : (
              <div className="his-field-group">
                <label className="his-label">Total ₹ discount (split FIFO) *</label>
                <input type="number" min="0" step="1" className="his-field"
                       value={amt} onChange={e => setAmt(Number(e.target.value) || 0)} placeholder="e.g. 500" />
              </div>
            )}
          </div>

          <div className="rx-section-label" style={{ marginTop: 14 }}>Audit details *</div>
          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Your Name *</label>
              <input className="his-field" value={adjustedBy}
                     onChange={e => setAdjustedBy(e.target.value)}
                     placeholder="Reception staff name" />
            </div>
            <div className="his-field-group">
              <label className="his-label">Reason *</label>
              <input className="his-field" value={reason}
                     onChange={e => setReason(e.target.value)}
                     placeholder="e.g. courtesy waiver, billing dispute" />
            </div>
          </div>

          <div className="rx-section-label" style={{ marginTop: 14 }}>Per-bill preview</div>
          <table className="rx-table rx-table--sm">
            <thead>
              <tr>
                <th>Bill #</th>
                <th className="right">Balance</th>
                <th className="right">Discount</th>
                <th className="right">New Balance</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.billId}>
                  <td className="rx-mono-tag rx-mono-tag--subtle">{r.billNumber}</td>
                  <td className="right">{fmtCur(r.balance)}</td>
                  <td className="right bold rx-text-discount">– {fmtCur(r.discount)}</td>
                  <td className="right bold">{fmtCur(r.newBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="rx-settle-preview" style={{ marginTop: 10 }}>
            <div className="rx-settle-preview-row">
              <span>Total before discount</span>
              <strong>{fmtCur(totalDue)}</strong>
            </div>
            <div className="rx-settle-preview-row rx-text-discount">
              <span>– Bulk discount</span>
              <strong>{fmtCur(preview.totalDiscount)}</strong>
            </div>
            <div className="rx-settle-preview-row rx-settle-preview-row--balance">
              <span>NEW TOTAL DUE</span>
              <strong className={preview.newTotalDue > 0 ? "rx-text-danger" : "rx-text-success"}>
                {fmtCur(preview.newTotalDue)}
              </strong>
            </div>
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="rx-modal-btn-primary"
                  onClick={() => submit(false)} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-save"}`} /> Save Settlement
          </button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--success"
                  onClick={() => submit(true)} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-wallet"}`} /> Save &amp; Collect All
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

/* R7ao: Refund the unspent portion of an advance deposit. Triggered from
   the Advance Deposits ledger row's "Refund" button when a patient is
   leaving with leftover credit. Backend only refunds remainingAmount —
   any portion already applied to bills stays untouched in the audit
   trail. */
function RefundAdvanceModal({ advance, patient, onClose, onDone }) {
  const total    = toMoney(advance?.amount);
  const applied  = toMoney(advance?.appliedAmount);
  const refunded = toMoney(advance?.refundedAmount);
  const remaining = Math.max(0, +(total - applied - refunded).toFixed(2));

  const [mode,         setMode]         = useState("CASH");
  const [reason,       setReason]       = useState("");
  const [refundedBy,   setRefundedBy]   = useState("");
  const [txnId,        setTxnId]        = useState("");
  const [saving,       setSaving]       = useState(false);

  const MODES = ["CASH", "UPI", "BANK_TRANSFER", "CARD", "ONLINE"];

  const submit = async () => {
    if (remaining <= 0) return toast.error("No remaining balance to refund");
    if (!reason.trim()) return toast.error("Refund reason is mandatory for audit");
    setSaving(true);
    try {
      const { data: resp } = await axios.post(
        `${API_ENDPOINTS.BILLING}/advance/${advance._id}/refund`,
        {
          mode,
          reason: reason.trim(),
          refundReason: reason.trim(),
          refundedBy: refundedBy || undefined,
          transactionId: txnId || undefined,
        },
      );
      toast.success(`Refunded ${fmtCur(remaining)} from advance ${advance.receiptNumber}`);
      onDone(resp?.data || resp?.advance || advance);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Refund failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--danger">
          <i className="pi pi-undo" />
          <span className="rx-modal-title">
            Refund Advance — {advance?.receiptNumber}
          </span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--danger">
            ⚠ Refunding the <strong>unspent</strong> portion of this deposit.
            {applied > 0
              ? ` ${fmtCur(applied)} already applied to bills stays untouched in the audit trail.`
              : " No portion of this deposit has been applied to any bill yet."}
          </div>

          {/* Quick summary card */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, margin: "8px 0 14px" }}>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>Deposited</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 800, fontSize: 16, color: "#0f172a" }}>{fmtCur(total)}</div>
            </div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>Applied</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 800, fontSize: 16, color: "#0f172a" }}>{fmtCur(applied)}</div>
            </div>
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, color: "#b91c1c", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>To Refund</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 800, fontSize: 16, color: "#dc2626" }}>{fmtCur(remaining)}</div>
            </div>
          </div>

          <div className="his-field-group">
            <label className="his-label">Refund Mode *</label>
            <div className="rx-grid-5">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`rx-slot ${mode === m ? "rx-slot--selected" : ""}`}
                  onClick={() => setMode(m)}
                >
                  {m === "BANK_TRANSFER" ? "BANK" : m}
                </button>
              ))}
            </div>
          </div>

          <div className="his-field-group">
            <label className="his-label">Reason *</label>
            <textarea
              className="his-textarea"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Patient discharged with leftover credit, admission cancelled, duplicate deposit…"
            />
          </div>

          <div className="rx-grid-2">
            <div className="his-field-group">
              <label className="his-label">Refunded By</label>
              <input
                className="his-field"
                value={refundedBy}
                onChange={(e) => setRefundedBy(e.target.value)}
                placeholder="Reception staff name"
              />
            </div>
            {mode !== "CASH" && (
              <div className="his-field-group">
                <label className="his-label">
                  {mode === "UPI" ? "UPI Ref" : mode === "BANK_TRANSFER" ? "Transfer Ref" : "Transaction ID"}
                </label>
                <input
                  className="his-field"
                  value={txnId}
                  onChange={(e) => setTxnId(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn" onClick={onClose}>Cancel</button>
          <button
            className="rx-modal-btn rx-modal-btn--danger"
            disabled={saving || remaining <= 0}
            onClick={submit}
          >
            <i className="pi pi-undo" /> {saving ? "Refunding…" : `Refund ${fmtCur(remaining)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function CancelBillModal({ bill, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [cancelledBy, setCancelledBy] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return toast.error("Cancellation reason is mandatory");
    setSaving(true);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/cancel`, {
        reason: reason.trim(),
        cancelledBy: cancelledBy || undefined,
      });
      toast.success("Bill cancelled");
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Cancel failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rx-modal-backdrop" onClick={onClose}>
      <div className="rx-modal" onClick={e => e.stopPropagation()}>
        <div className="rx-modal-head rx-modal-head--neutral">
          <i className="pi pi-ban" />
          <span className="rx-modal-title">Cancel Bill — {bill.billNumber}</span>
          <button className="rx-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rx-modal-body">
          <div className="rx-banner rx-banner--neutral">
            ⚠ Cancellation is permanent. Only allowed when no payment has been collected. For collected bills, issue a refund instead.
          </div>
          <div className="his-field-group">
            <label className="his-label">Cancellation Reason *</label>
            <textarea className="his-textarea" rows={3} value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. Duplicate bill, wrong patient, services not rendered" />
          </div>
          <div className="his-field-group">
            <label className="his-label">Cancelled By</label>
            <input className="his-field" value={cancelledBy} onChange={e => setCancelledBy(e.target.value)} placeholder="Reception staff name" />
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-modal-btn-cancel" onClick={onClose}>Keep Bill</button>
          <button className="rx-modal-btn-primary rx-modal-btn-primary--neutral" onClick={submit} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-ban"}`} /> Confirm Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */
/* Print receipt — opens a simple printable window                */

function receiptHTML(bill, patient, hs = {}) {
  // R7cb-B: hs is the live HospitalSettings object (or {} if caller didn't
  // pass one — DEFAULT_SETTINGS keeps strings non-empty). Callers should
  // await fetchHospitalSettings() and forward it.
  const _hospName = hs.hospitalName || "Hospital";
  const _hospTagline = hs.tagline || "";
  const _addrLine = [hs.addressLine1, hs.addressLine2, [hs.city, hs.state, hs.pincode].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const _phoneLine = [hs.phone1, hs.phone2, hs.emergencyPhone].filter(Boolean).join(" · ");
  const items = (bill.billItems || []).map(it => `
    <tr>
      <td>${escapeHtml(it.serviceName || it.name)}</td>
      <td style="text-align:right">${it.quantity || 1}</td>
      <td style="text-align:right">${fmtCur(it.unitPrice)}</td>
      <td style="text-align:right">${fmtCur(it.netAmount)}</td>
    </tr>`).join("");

  const payments = (bill.payments || []).map(p => `
    <tr>
      <td>${fmtDateTime(p.paidAt)}</td>
      <td>${escapeHtml(p.paymentMode || "")}</td>
      <td>${escapeHtml(p.transactionId || "—")}</td>
      <td style="text-align:right">${fmtCur(p.amount)}</td>
    </tr>`).join("");

  // R7aa: same line-item fallback as the live BillDetail tile — guards
  // the print receipt against legacy bills whose parent totals never
  // got recomputed. Don't show a printed bill with ₹0 net under a list
  // of paid items.
  const _num = (v) => {
    if (v == null) return 0;
    if (typeof v === "object" && v.toString) v = v.toString();
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const _itemGross    = (bill.billItems || []).reduce((s, i) => s + _num(i.unitPrice) * _num(i.quantity || 1), 0);
  const _itemDiscount = (bill.billItems || []).reduce((s, i) => s + _num(i.discountAmount), 0);
  const _itemTax      = (bill.billItems || []).reduce((s, i) => s + _num(i.taxAmount), 0);
  const _itemNet      = (bill.billItems || []).reduce((s, i) => s + _num(i.netAmount), 0);
  const _paidFromRows = (bill.payments || []).reduce((s, p) => s + _num(p.amount), 0);
  const grossPrint    = _num(bill.grossAmount)   || _itemGross;
  const discountPrint = _num(bill.totalDiscount) || _itemDiscount;
  const taxPrint      = _num(bill.taxAmount)     || _itemTax;
  const netPrint      = _num(bill.netAmount)     || _itemNet;
  const balancePrint  = _num(bill.netAmount) > 0
    ? _num(bill.balanceAmount)
    : Math.max(0, netPrint - _paidFromRows);
  const paidPrint     = Math.max(0, netPrint - balancePrint);

  return `<!doctype html><html><head><title>Receipt ${bill.billNumber}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; font-size: 13px; }
    h1 { font-size: 22px; margin: 0; }
    .meta { color: #64748b; font-size: 11px; margin-bottom: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 12px; }
    th, td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background: #f8fafc; font-weight: 700; }
    .totals { text-align: right; font-size: 13px; margin-top: 10px; }
    .totals .row { display:flex; justify-content:flex-end; gap:14px; margin-bottom:3px; }
    .totals strong { display:inline-block; min-width:120px; text-align:right; }
    .pill { display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; background:#ecfeff; color:#0e7490; }
    .footer { margin-top: 24px; padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 10px; color:#94a3b8; text-align:center; }
  </style></head><body>
    ${hs.logo ? `<img src="${hs.logo}" alt="" style="max-height:54px;display:block;margin-bottom:6px"/>` : ""}
    <h1 style="color:${hs.printHeaderColor || "#0f172a"}">${escapeHtml(_hospName)}</h1>
    <div class="meta">${_hospTagline ? escapeHtml(_hospTagline) + " · " : ""}Receipt of payment</div>
    ${_addrLine ? `<div class="meta">${escapeHtml(_addrLine)}</div>` : ""}
    ${_phoneLine ? `<div class="meta">${escapeHtml(_phoneLine)}</div>` : ""}
    ${hs.gstin ? `<div class="meta">GSTIN: ${escapeHtml(hs.gstin)}</div>` : ""}
    <hr>
    <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
      <div>
        <strong>Patient:</strong> ${escapeHtml(patient?.fullName || "—")}<br>
        <strong>UHID:</strong> ${escapeHtml(patient?.UHID || "—")}<br>
        <strong>Mobile:</strong> ${escapeHtml(patient?.contactNumber || "—")}
      </div>
      <div style="text-align:right">
        <strong>Bill #:</strong> ${escapeHtml(bill.billNumber || "—")}<br>
        <strong>Status:</strong> <span class="pill">${escapeHtml(bill.billStatus || "")}</span><br>
        <strong>Date:</strong> ${fmtDate(bill.createdAt)}<br>
        <strong>Type:</strong> ${escapeHtml(bill.visitType || "OPD")}
      </div>
    </div>

    <table><thead><tr><th>Service</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Net</th></tr></thead>
    <tbody>${items}</tbody></table>

    <div class="totals">
      <div class="row"><span>Gross:</span><strong>${fmtCur(grossPrint)}</strong></div>
      <div class="row"><span>Discount:</span><strong>− ${fmtCur(discountPrint)}</strong></div>
      <div class="row"><span>Tax:</span><strong>${fmtCur(taxPrint)}</strong></div>
      <div class="row"><span><strong>Net Payable:</strong></span><strong>${fmtCur(netPrint)}</strong></div>
      <div class="row" style="color:#15803d"><span>Paid:</span><strong>${fmtCur(paidPrint)}</strong></div>
      <div class="row" style="color:#b91c1c"><span><strong>Balance Due:</strong></span><strong>${fmtCur(balancePrint)}</strong></div>
    </div>

    ${payments ? `<h3 style="margin-top:18px; font-size:13px;">Payments</h3>
    <table><thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${payments}</tbody></table>` : ""}

    <div class="footer">
      Receipt generated by Reception · ${new Date().toLocaleString("en-IN")}<br>
      This is a computer-generated receipt. ${hs.billFooterNote ? escapeHtml(hs.billFooterNote) : ""}
    </div>
  </body></html>`;
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

/* ═══════════════════════════════════════════════════════════════
   ShortcutsModal — cheat sheet of all hotkeys on the Billing Counter
   Triggered by "?" key or the "Shortcuts" button in the header.
   Greys out shortcuts that aren't applicable in the current state
   (e.g. "G - Generate" is dim if the active bill is already GENERATED).
═══════════════════════════════════════════════════════════════ */
function ShortcutsModal({ patientLoaded, activeBillStatus, unspentAdv, onClose }) {
  const dim = (active) => ({
    opacity: active ? 1 : 0.35,
    pointerEvents: "none",
  });
  const isDraft     = activeBillStatus === "DRAFT";
  const canPay      = ["GENERATED", "PARTIAL"].includes(activeBillStatus);
  const canApply    = canPay && unspentAdv > 0;
  const hasBillCtx  = !!activeBillStatus;

  return (
    <div className="rx-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rx-modal" style={{ maxWidth: 560 }}>
        <div className="rx-modal-head">
          <i className="pi pi-info-circle" /> Keyboard Shortcuts
          <button className="rx-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="rx-modal-body" style={{ padding: "12px 16px", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#06b6d4", letterSpacing: 0.4, marginTop: 4 }}>
            Search &amp; navigation
          </div>
          <ShortcutRow keys={["/", "Ctrl", "K"]} label="Focus the search box" />
          <ShortcutRow keys={["?"]} label="Show / hide this help" />
          <ShortcutRow keys={["Esc"]} label={patientLoaded ? "Clear current patient → return to directory" : "Close dropdown / help"} />

          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#06b6d4", letterSpacing: 0.4, marginTop: 10 }}>
            Directory tabs (no patient selected)
          </div>
          <div style={dim(!patientLoaded)}>
            <ShortcutRow keys={["1"]} label="OPD" />
            <ShortcutRow keys={["2"]} label="IPD" />
            <ShortcutRow keys={["3"]} label="Day Care" />
            <ShortcutRow keys={["4"]} label="Emergency" />
            <ShortcutRow keys={["5"]} label="Services" />
            <ShortcutRow keys={["6"]} label="All Types" />
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#06b6d4", letterSpacing: 0.4, marginTop: 10 }}>
            Patient actions
          </div>
          <div style={dim(patientLoaded)}>
            <ShortcutRow keys={["T"]} label="Take Advance deposit" />
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#06b6d4", letterSpacing: 0.4, marginTop: 10 }}>
            Bill actions (when a bill is selected)
          </div>
          <div style={dim(hasBillCtx && isDraft)}>
            <ShortcutRow keys={["A"]} label="Add Service to bill (DRAFT only)" />
            <ShortcutRow keys={["G"]} label="Generate (finalize) DRAFT bill" />
          </div>
          <div style={dim(hasBillCtx && canPay)}>
            <ShortcutRow keys={["P"]} label="Collect Payment" />
          </div>
          <div style={dim(hasBillCtx && canApply)}>
            <ShortcutRow keys={["V"]} label="Apply Advance to this bill" />
          </div>
          <div style={dim(hasBillCtx && activeBillStatus && activeBillStatus !== "DRAFT")}>
            <ShortcutRow keys={["R"]} label="Print Receipt" />
          </div>

          <div style={{ marginTop: 12, padding: "8px 12px", background: "#ecfeff", color: "#0e7490", border: "1px solid #67e8f9", borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
            <i className="pi pi-info-circle" /> Shortcuts are <strong>ignored while typing</strong> in
            input boxes (so "1" in the search bar still types "1"). Press <kbd className="rx-kbd">Esc</kbd> to
            unfocus an input and re-enable hotkeys.
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-action-btn rx-action-btn--primary" onClick={onClose}>
            <i className="pi pi-check" /> Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// One row in the shortcuts cheat sheet — keys on the left, label on the right.
function ShortcutRow({ keys, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", fontSize: 12, color: "#475569" }}>
      <div style={{ display: "inline-flex", gap: 4, minWidth: 90 }}>
        {keys.map((k, i) => (
          <React.Fragment key={k}>
            {i > 0 && <span style={{ color: "#94a3b8", fontSize: 11, alignSelf: "center" }}>+</span>}
            <kbd className="rx-kbd rx-kbd--lg">{k}</kbd>
          </React.Fragment>
        ))}
      </div>
      <span style={{ flex: 1 }}>{label}</span>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   AddServiceModal — searchable ServiceMaster picker for DRAFT bills
   The receptionist taps "Add Service" on a DRAFT OPD bill mid-visit
   (e.g. patient needs an ECG, dressing, nebulisation). The modal:
     1. Live-searches /api/services?search=…&applicableTo=<visitType>
     2. Lists matching services with code · name · billingType · price
     3. Click "Add" → POST /api/billing/:billId/add-service
     4. Bill is reloaded behind the modal; running total updates.
     5. Modal stays open so multiple services can be added in one go.
   Backend gates additions to DRAFT bills only (audit F-05 lock); the
   button itself is only shown for DRAFT, so the UX never offers an
   action the server will reject.
═══════════════════════════════════════════════════════════════ */
function AddServiceModal({ bill, onClose, onChanged }) {
  const [query,    setQuery]    = useState("");
  const [results,  setResults]  = useState([]);
  const [domain,   setDomain]   = useState(bill.visitType || "OPD");
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState(null);
  const [savingId, setSavingId] = useState(null);
  const debRef = React.useRef(null);

  // Live-debounced search. Empty query loads the most-common 50 for
  // the chosen domain so the cashier can browse without typing.
  React.useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        const params = new URLSearchParams({ limit: "60", isActive: "true" });
        if (query.trim().length >= 2) params.set("search", query.trim());
        if (domain && domain !== "ALL") params.set("applicableTo", domain);
        const { data } = await axios.get(`${API_ENDPOINTS.BASE}/services?${params.toString()}`);
        const list = data?.data || data?.services || [];
        setResults(Array.isArray(list) ? list : []);
      } catch (e) {
        setErr(e?.response?.data?.message || "Search failed");
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [query, domain]);

  const add = async (svc) => {
    setSavingId(svc._id);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/add-service`, {
        serviceId: svc._id,
        quantity: 1,
      });
      toast.success(`${svc.serviceName} added`);
      onChanged && onChanged();
    } catch (e) {
      const msg = e?.response?.data?.message || "Could not add service";
      toast.error(msg);
    } finally {
      setSavingId(null);
    }
  };

  const billItemCount = (bill.billItems || []).length;
  const currentTotal  = Number(bill.netAmount) || 0;

  return (
    <div className="rx-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rx-modal" style={{ maxWidth: 720, maxHeight: "90vh" }}>
        <div className="rx-modal-head">
          <i className="pi pi-plus-circle" /> Add Service to Bill
          <button className="rx-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="rx-modal-body" style={{ padding: "12px 16px", gap: 10 }}>
          {/* Bill context bar */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#475569", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <strong>{bill.billNumber || "DRAFT"}</strong>
              {" · "}<span className="rx-mono-tag rx-mono-tag--subtle">{bill.visitType}</span>
              {" · "}{billItemCount} item{billItemCount === 1 ? "" : "s"}
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 800, color: "#0f172a" }}>
              Running total: {fmtCur(currentTotal)}
            </div>
          </div>

          {/* Search bar + domain filter */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            <div className="rx-search" style={{ marginBottom: 0, flex: 1 }}>
              <i className="pi pi-search" />
              <input autoFocus
                     value={query}
                     onChange={(e) => setQuery(e.target.value)}
                     placeholder="Search service name or code (e.g. ECG, dressing, NRS-001)…" />
            </div>
            <select value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    style={{ padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 13, background: "#fff", minWidth: 110 }}
                    title="Filter by where the service is applicable">
              <option value="OPD">OPD</option>
              <option value="IPD">IPD</option>
              <option value="DAYCARE">Day Care</option>
              <option value="EMERGENCY">Emergency</option>
              <option value="ALL">All</option>
            </select>
          </div>

          {err && (
            <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
              {err}
            </div>
          )}

          {/* Result list */}
          <div style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
            {busy && results.length === 0 ? (
              <div style={{ textAlign: "center", color: "#94a3b8", padding: "20px 0", fontSize: 13 }}>
                <i className="pi pi-spin pi-spinner" /> Searching…
              </div>
            ) : results.length === 0 ? (
              <div style={{ textAlign: "center", color: "#94a3b8", padding: "20px 0", fontSize: 13 }}>
                No services match "{query || "(all)"}"
              </div>
            ) : results.map((s) => (
              <div key={s._id}
                   style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="rx-mono-tag">{s.serviceCode}</span>
                    <span style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>{s.serviceName}</span>
                    {s.isAutoCharged && <span className="rx-mode-pill" style={{ background: "#fff7ed", color: "#c2410c", borderColor: "#fed7aa" }}>AUTO</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {s.category} · {s.billingType} · {s.unitLabel || "unit"}
                    {s.domain && ` · ${s.domain}`}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 90, fontFamily: "'DM Mono', monospace", fontWeight: 800, color: "#0f172a", fontSize: 14 }}>
                  {fmtCur(s.defaultPrice)}
                </div>
                <button
                  className="rx-action-btn rx-action-btn--primary"
                  onClick={() => add(s)}
                  disabled={savingId === s._id}
                  title={`Add ${s.serviceName} to ${bill.billNumber || "draft"}`}
                  style={{ minWidth: 70 }}
                >
                  {savingId === s._id ? <><i className="pi pi-spin pi-spinner" /> </> : <><i className="pi pi-plus" /> Add</>}
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, padding: "8px 12px", background: "#ecfeff", color: "#0e7490", border: "1px solid #67e8f9", borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
            <i className="pi pi-info-circle" /> Items can only be added while the bill is <strong>DRAFT</strong>.
            Once you click <strong>Generate Bill</strong>, it locks for the cashier &mdash; any later
            additions need the amendment workflow (Accountant tier).
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-action-btn rx-action-btn--primary" onClick={onClose}>
            <i className="pi pi-check" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TakeAdvanceModal — cash/UPI/card deposit before bills exist
   Posts to /api/billing/advance, switches to success state with a
   Print Receipt button, then refreshes the parent on Done.
═══════════════════════════════════════════════════════════════ */
function TakeAdvanceModal({ patient, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [mode,   setMode]   = useState("CASH");
  const [txnId,  setTxnId]  = useState("");
  const [bank,   setBank]   = useState("");
  const [remarks,setRemarks]= useState("");
  const [err,    setErr]    = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAdv, setSavedAdv] = useState(null);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter a valid amount"); return; }
    if (mode !== "CASH" && !txnId) { setErr(`Transaction reference required for ${mode}`); return; }
    setErr(null);
    setSaving(true);
    try {
      const { data } = await axios.post(`${API_ENDPOINTS.BILLING}/advance`, {
        UHID: patient.UHID,
        amount: amt,
        paymentMode: mode,
        transactionId: txnId || null,
        bankName: bank || null,
        remarks: remarks || null,
      });
      setSavedAdv(data?.data || null);
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (savedAdv) {
    const amt = toMoney(savedAdv.amount);
    return (
      <div className="rx-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onSaved && onSaved(); }}>
        <div className="rx-modal">
          <div className="rx-modal-head" style={{ background: "linear-gradient(135deg, #15803d, #16a34a)" }}>
            <i className="pi pi-check-circle" style={{ color: "#bbf7d0" }} /> Advance Received
            <button className="rx-modal-close" onClick={() => onSaved && onSaved()}>✕</button>
          </div>
          <div className="rx-modal-body">
            <div style={{ background: "linear-gradient(135deg, #fef9c3, #fde68a)", border: "2px solid #facc15", borderRadius: 12, padding: "18px 20px", textAlign: "center" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 800, color: "#92400e", letterSpacing: 0.5, textTransform: "uppercase" }}>{savedAdv.receiptNumber}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 32, fontWeight: 900, color: "#713f12", lineHeight: 1.1, marginTop: 6 }}>{fmtCur(amt)}</div>
              <div style={{ fontSize: 12, color: "#92400e", marginTop: 4, fontWeight: 600 }}>
                {savedAdv.paymentMode}{savedAdv.transactionId ? ` · ref ${savedAdv.transactionId}` : ""}
              </div>
              <div style={{ fontSize: 12, color: "#92400e", marginTop: 4, fontWeight: 600 }}>
                from {patient.title ? patient.title + " " : ""}{patient.fullName} ({patient.UHID})
              </div>
            </div>
            <div style={{ marginTop: 12, padding: "10px 12px", background: "#ecfeff", color: "#0e7490", border: "1px solid #67e8f9", borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
              <i className="pi pi-info-circle" /> This credit is now on the UHID with status <strong>ACTIVE</strong>.
              Click <strong>Apply Advance</strong> on any open bill to consume from it.
            </div>
          </div>
          <div className="rx-modal-foot">
            <button className="rx-action-btn" onClick={() => onSaved && onSaved()}>Done</button>
            <button className="rx-action-btn rx-action-btn--primary"
                    onClick={() => printAdvanceReceipt(savedAdv, patient)}>
              <i className="pi pi-print" /> Print Receipt
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rx-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rx-modal">
        <div className="rx-modal-head">
          <i className="pi pi-wallet" /> Take Advance Deposit
          <button className="rx-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="rx-modal-body">
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#0f172a" }}>
            <strong>{patient.title ? `${patient.title} ` : ""}{patient.fullName}</strong>
            <div style={{ fontSize: 11, color: "#64748b" }}>{patient.UHID} · {patient.contactNumber || "no phone"}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Amount (₹) *</div>
              <input type="number" min="1" autoFocus
                     value={amount}
                     onChange={(e) => setAmount(e.target.value)}
                     placeholder="e.g. 10000"
                     style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Payment Mode *</div>
              <select value={mode} onChange={(e) => setMode(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, background: "#fff" }}>
                {ADVANCE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {mode !== "CASH" && (
              <div style={{ gridColumn: "span 2" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
                  {mode === "CHEQUE" ? "Cheque No" : mode === "CARD" ? "Card Auth / Last 4" : "Transaction Reference"} *
                </div>
                <input value={txnId} onChange={(e) => setTxnId(e.target.value)}
                       placeholder={mode === "UPI" ? "UPI ref id (12 digits)" : ""}
                       style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
              </div>
            )}
            {(mode === "CHEQUE" || mode === "ONLINE") && (
              <div style={{ gridColumn: "span 2" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Bank Name</div>
                <input value={bank} onChange={(e) => setBank(e.target.value)}
                       placeholder="e.g. HDFC, SBI"
                       style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
              </div>
            )}
            <div style={{ gridColumn: "span 2" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Remarks</div>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)}
                     placeholder="e.g. IPD admission deposit"
                     style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }} />
            </div>
          </div>

          {err && <div style={{ marginTop: 10, padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{err}</div>}

          <div style={{ marginTop: 12, padding: "10px 12px", background: "#ecfeff", color: "#0e7490", border: "1px solid #67e8f9", borderRadius: 8, fontSize: 11, lineHeight: 1.5 }}>
            <i className="pi pi-info-circle" /> Deposit lands on this UHID as <strong>ADV-YYYY-NNNNNN</strong> with
            status <strong>ACTIVE</strong>. Click <strong>Apply Advance</strong> on a generated bill to consume credit.
          </div>
        </div>
        <div className="rx-modal-foot">
          <button className="rx-action-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="rx-action-btn rx-action-btn--primary"
                  onClick={submit}
                  disabled={saving || !amount || Number(amount) <= 0}>
            <i className="pi pi-check" /> {saving ? "Saving…" : "Save Deposit"}
          </button>
        </div>
      </div>
    </div>
  );
}
