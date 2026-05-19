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
 *   GET  /api/billing/collection-summary?date=YYYY-MM-DD
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import { useAuth } from "../../context/AuthContext";
import ActivePatientDirectory from "../../Components/ActivePatientDirectory";
import "./reception-shared.css";

const fmtCur  = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
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
  openPrint("advance-receipt", {
    receiptNo:    advance.receiptNumber,
    patientName:  [patient.title, patient.fullName].filter(Boolean).join(" "),
    uhid:         patient.UHID,
    ipdNo:        advance.admission?.admissionNumber || null,
    admissionDate: advance.admission?.admissionDate || null,
    bedNumber:    null,
    wardName:     null,
    date:         advance.paidAt || advance.createdAt || new Date().toISOString(),
    amount:       Number(advance.amount?.$numberDecimal ?? advance.amount) || 0,
    method:       advance.paymentMode,
    refNo:        advance.transactionId,
    depositPurpose: advance.remarks || "hospitalization advance",
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
  const [uhid, setUhid] = useState(paramUhid || "");
  const [patient, setPatient] = useState(null);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeBill, setActiveBill] = useState(null); // full bill detail
  const [billLoading, setBillLoading] = useState(false);
  const [payTarget, setPayTarget] = useState(null);
  const [refundTarget, setRefundTarget] = useState(null);
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

      // Parallel fetch — never blocks bill rendering if it 5xxs.
      try {
        const adv = await axios.get(`${API_ENDPOINTS.BILLING}/advance/uhid/${encodeURIComponent(uhidArg)}`);
        setAdvances(adv?.data?.data?.advances || []);
        setUnspentAdv(Number(adv?.data?.data?.totalUnspent) || 0);
      } catch (e) {
        console.warn("[ReceptionBilling] advance load failed:", e?.message);
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load bills");
    } finally { setLoading(false); }
  }, []);

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
      const opdBills = (bills || []).filter(b => b.visitType === "OPD");
      const target =
        opdBills.find(b => b.billStatus === "DRAFT") ||
        opdBills.find(b => ["GENERATED","PARTIAL"].includes(b.billStatus) && Number(b.balanceAmount) > 0) ||
        opdBills[0];
      if (target) setPayTarget(target);
      else toast.info("No OPD bill found yet — try again in a moment");
    } else if (action === "advance") {
      setShowAdvDlg(true);
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
  const pickPatient = (p) => {
    if (!p?.UHID) return;
    setUhid(p.UHID);
    setSearchQ("");
    setSearchOpen(false);
    setSearchResults([]);
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
  // Response shape: { success, date, summary: { totalCollected, totalGross, ... } }
  // AbortController guards against the receptionist navigating away mid-
  // request (E-05 pattern). Failure now logs to console instead of being
  // silently swallowed (E-06) — the live tile just shows no data, but
  // the operator can see in DevTools that the API call failed.
  useEffect(() => {
    const ac = new AbortController();
    axios.get(`${API_ENDPOINTS.BILLING}/collection-summary?date=${new Date().toISOString().slice(0, 10)}`, { signal: ac.signal })
      .then(({ data }) => { if (!ac.signal.aborted) setTodayCollection(data?.summary || data?.data?.summary || null); })
      .catch((e) => { if (!axios.isCancel(e)) console.error("[ReceptionBilling] collection-summary:", e?.message); });
    return () => ac.abort();
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

  const generateBill = async (billId) => {
    if (!window.confirm("Generate (finalize) this draft bill? After this, items cannot be removed.")) return;
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${billId}/generate`, { generatedBy: "Reception" });
      toast.success("Bill generated");
      await load(uhid);
      await loadBill(billId);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not generate bill");
    }
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
      // OPD-only fields (ignored by ServiceReceipt)
      doctorName:  bill.doctorName || bill.consultantName,
      department:  bill.department,
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
      if (k === "v" && ["GENERATED","PARTIAL"].includes(status) && unspentAdv > 0 && Number(activeBill.balanceAmount) > 0) {
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
    const sum = (k) => bills.reduce((s, b) => s + (b[k] || 0), 0);
    return {
      gross:    sum("netAmount"),
      due:      sum("balanceAmount"),
      paid:     sum("netAmount") - sum("balanceAmount"),
      bills:    bills.length,
      open:     bills.filter(b => ["GENERATED", "PARTIAL"].includes(b.billStatus)).length,
      drafts:   bills.filter(b => b.billStatus === "DRAFT").length,
    };
  }, [bills]);

  return (
    <div className="rx-page">
      <div className="rx-header">
        <div>
          <div className="rx-header-title"><i className="pi pi-receipt" /> Billing & Payments</div>
          <div className="rx-header-meta">
            Patient bills · Cash / UPI / Card collection · Receipt printing
            {todayCollection?.totalCollected != null && <> · Today: <strong className="rx-text-success-light">{fmtCur(todayCollection.totalCollected)}</strong></>}
          </div>
        </div>
        <div className="rx-header-actions">
          <button className="rx-btn-ghost"
                  onClick={() => setShowShortcuts(true)}
                  title="Keyboard shortcuts (press ?)">
            <i className="pi pi-question-circle" /> Shortcuts
            <kbd className="rx-kbd rx-kbd--dark">?</kbd>
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/patient-search")}>
            <i className="pi pi-search" /> Patient Search
          </button>
          <button className="rx-btn-ghost" onClick={() => navigate("/reception")}>
            <i className="pi pi-arrow-left" /> Dashboard
          </button>
        </div>
      </div>

      {/* Smart search bar — name / UHID / phone. Live dropdown of
          matches as the receptionist types (min 2 chars). */}
      <div style={{ position: "relative", marginBottom: 14 }}>
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
        <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
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
          {/* Patient summary */}
          <div className="rx-card rx-mb-12">
            <div className="rx-card-main">
              <div className="rx-card-name">
                {patient.fullName}
                {patient.tpa && <span className="rx-card-stage rx-card-stage--submitted">TPA</span>}
                {patient.paymentType && <span className="rx-mono-tag">{patient.paymentType}</span>}
              </div>
              <div className="rx-card-meta">
                <span>UHID: <strong>{patient.UHID}</strong></span>
                {patient.contactNumber && <span>📱 <strong>{patient.contactNumber}</strong></span>}
                {patient.department && <span>Dept: <strong>{typeof patient.department === "object" ? patient.department.name : patient.department}</strong></span>}
                {patient.doctor && <span>Doctor: <strong>{typeof patient.doctor === "object" ? (patient.doctor.fullName || patient.doctor.personalInfo?.fullName) : patient.doctor}</strong></span>}
              </div>
            </div>
            <div className="rx-card-actions">
              <button className="rx-action-btn rx-action-btn--primary"
                      onClick={() => setShowAdvDlg(true)}
                      title="Take cash / UPI / card deposit (T)">
                <i className="pi pi-wallet" /> Take Advance
                <kbd className="rx-kbd">T</kbd>
              </button>
              <button className="rx-action-btn"
                      onClick={() => navigate(`/visit-history/${patient.UHID}`)}
                      title="Visit history for this patient">
                <i className="pi pi-clock" /> History
              </button>
              <button className="rx-action-btn rx-action-btn--danger"
                      onClick={clearPatient}
                      title="Clear current patient and return to directory (Esc)">
                <i className="pi pi-times" /> Clear
                <kbd className="rx-kbd">Esc</kbd>
              </button>
            </div>
          </div>

          {/* KPI strip — 5th tile (Advance Credit) only renders when
              the patient has an unspent deposit; otherwise the strip
              stays compact at 4 tiles. */}
          <div className="rx-kpis">
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Total Bills</div>
              <div className="rx-kpi-value">{totals.bills}</div>
              <div className="rx-kpi-sub">{totals.drafts} draft · {totals.open} open</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Total Billed</div>
              <div className="rx-kpi-value">{fmtCur(totals.gross)}</div>
            </div>
            <div className="rx-kpi rx-kpi--accent">
              <div className="rx-kpi-label">Collected</div>
              <div className="rx-kpi-value rx-text-success">{fmtCur(totals.paid)}</div>
            </div>
            <div className={`rx-kpi rx-kpi--accent ${totals.due > 0 ? "rx-kpi--actionable" : ""}`}>
              <div className="rx-kpi-label">Outstanding</div>
              <div className={`rx-kpi-value ${totals.due > 0 ? "rx-text-danger" : "rx-text-success"}`}>{fmtCur(totals.due)}</div>
              {totals.due > 0 && totals.open > 0 && (
                <div className="rx-kpi-actions">
                  <button className="rx-kpi-btn rx-kpi-btn--success"
                          onClick={() => setShowBulkCollect(true)}
                          title={`Collect ${fmtCur(totals.due)} in one go — distributed FIFO across ${totals.open} bill${totals.open === 1 ? "" : "s"}`}>
                    <i className="pi pi-check-circle" /> Collect All Dues
                  </button>
                  <button className="rx-kpi-btn rx-kpi-btn--primary"
                          onClick={() => setShowBulkSettle(true)}
                          title="Apply one discount across every outstanding bill, then collect">
                    <i className="pi pi-sliders-h" /> Settle All
                  </button>
                </div>
              )}
            </div>
            {unspentAdv > 0 && (
              <div className="rx-kpi rx-kpi--accent rx-kpi--credit"
                   title="Unspent advance deposits on this UHID. Click Apply on any open bill to consume.">
                <div className="rx-kpi-label">Advance Credit</div>
                <div className="rx-kpi-value rx-text-success">{fmtCur(unspentAdv)}</div>
                <div className="rx-kpi-sub">{advances.filter((a) => (a.remainingAmount || 0) > 0).length} deposit{advances.filter((a) => (a.remainingAmount || 0) > 0).length === 1 ? "" : "s"}</div>
              </div>
            )}
          </div>

          {/* ── Advance Deposits ledger ─────────────────────────────
              Shows every deposit (active + applied + refunded). Reprint
              icon on each non-void row. When a bill is selected on the
              right, "Apply Advance" button on its toolbar consumes from
              the oldest active deposit. */}
          {advances.length > 0 && (
            <div className="rx-card rx-mb-12" style={{ borderLeft: "4px solid #06b6d4", display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 800, color: "#06b6d4", textTransform: "uppercase", letterSpacing: 0.4 }}>
                <i className="pi pi-wallet" /> Advance Deposits
                <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: unspentAdv > 0 ? "#15803d" : "#64748b", background: unspentAdv > 0 ? "#f0fdf4" : "#f1f5f9", padding: "3px 10px", borderRadius: 999, border: `1px solid ${unspentAdv > 0 ? "#86efac" : "#e2e8f0"}`, letterSpacing: 0, textTransform: "none" }}>
                  {unspentAdv > 0 ? `Available: ${fmtCur(unspentAdv)}` : "Fully applied"}
                </span>
              </div>
              {advances.map((a) => {
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
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3, paddingLeft: 4 }}>
                      {new Date(a.paidAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {" · status: "}<strong>{a.status}</strong>
                      {a.appliedTo?.length > 0 && ` · applied to ${a.appliedTo.map((x) => x.billNumber).join(", ")}`}
                      {a.remarks && ` · ${a.remarks}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Two-column layout: bill list | active bill details */}
          <div className="rx-split-list">
            {/* Bills column */}
            <div>
              {/* Bills list header — exposes a "New Bill" action so the
                  cashier can spin up a fresh DRAFT when the doctor adds
                  an ad-hoc charge (e.g. RBS after the previous bill was
                  already settled). Backend's getOrCreateDraftBill is
                  idempotent: if there's already a DRAFT for the same
                  (UHID, visitType, admission), it returns the existing
                  one instead of duplicating. */}
              <div className="rx-bill-list-head">
                <div className="rx-bill-list-head-title">
                  <i className="pi pi-list" /> Bills
                  {bills.length > 0 && <span className="rx-bill-list-count">{bills.length}</span>}
                </div>
                <button className="rx-action-btn rx-action-btn--primary"
                        onClick={() => setShowNewBill(true)}
                        title="Create a fresh DRAFT bill for ad-hoc charges">
                  <i className="pi pi-plus" /> New Bill
                </button>
              </div>

              {bills.length === 0 ? (
                <div className="rx-empty">
                  <span className="rx-empty-icon">📑</span>
                  No bills yet for this patient.
                </div>
              ) : bills.map(b => {
                const isActive = activeBill?._id === b._id;
                const cls = STATUS_CLASS[b.billStatus] || "pending";
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
                        <span>Total: <strong>{fmtCur(b.netAmount)}</strong></span>
                        <span className="paid">Paid: <strong>{fmtCur((b.netAmount || 0) - (b.balanceAmount || 0))}</strong></span>
                        {b.balanceAmount > 0 && <span className="due">Due: <strong>{fmtCur(b.balanceAmount)}</strong></span>}
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
                <div className="rx-empty"><i className="pi pi-spin pi-spinner rx-loader-icon" /></div>
              ) : !activeBill ? (
                <div className="rx-empty">
                  <span className="rx-empty-icon">👉</span>
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
          bills={bills.filter(b => ["GENERATED", "PARTIAL"].includes(b.billStatus) && Number(b.balanceAmount) > 0)}
          totalDue={totals.due}
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
    </div>
  );
}

/* ───────────────────────────────────────────────────────────── */

function BillDetail({ bill, unspentAdv = 0, onGenerate, onPay, onSettle, onPrint, onRefund, onCancel, onApplyAdvance, onAddService }) {
  const { can } = useAuth();
  const isDraft   = bill.billStatus === "DRAFT";
  const canPay    = ["GENERATED", "PARTIAL"].includes(bill.billStatus);
  const items     = bill.billItems || [];
  const payments  = bill.payments || [];
  const paidTotal = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const canApply  = canPay && unspentAdv > 0 && Number(bill.balanceAmount) > 0;
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

      {/* Totals */}
      <div className="rx-detail-totals">
        <div className="rx-grid-fit-120">
          <div>Gross: <strong>{fmtCur(bill.grossAmount)}</strong></div>
          <div>Discount: <strong className="rx-text-discount">{fmtCur(bill.totalDiscount)}</strong></div>
          <div>Tax: <strong>{fmtCur(bill.taxAmount)}</strong></div>
          <div>Net: <strong className="rx-text-strong">{fmtCur(bill.netAmount)}</strong></div>
          <div>Paid: <strong className="rx-text-success">{fmtCur((bill.netAmount || 0) - (bill.balanceAmount || 0))}</strong></div>
          <div>Balance: <strong className={bill.balanceAmount > 0 ? "rx-text-danger" : "rx-text-success"}>{fmtCur(bill.balanceAmount)}</strong></div>
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
      if (!window.confirm(`Amount ${fmtCur(amt)} exceeds balance ${fmtCur(bill.balanceAmount)}. Proceed anyway?`)) return;
    }
    if (["UPI", "CARD", "CHEQUE", "ONLINE"].includes(mode) && !txnId.trim()) {
      if (!window.confirm(`No transaction reference for ${mode} payment. Record anyway?`)) return;
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

function BulkCollectModal({ uhid, patient, bills, totalDue, onClose, onDone }) {
  const [amount, setAmount] = useState(totalDue || 0);
  const [mode, setMode] = useState("CASH");
  const [txnId, setTxnId] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  // FIFO preview — mirrors the backend's distribution logic so the
  // cashier sees exactly which bills will get how much before saving.
  const allocation = useMemo(() => {
    const amt = Number(amount) || 0;
    const sorted = [...bills].sort((a, b) =>
      new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    let remaining = amt;
    return sorted.map((b) => {
      const bal = Number(b.balanceAmount) || 0;
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
    if (["UPI", "CARD", "CHEQUE", "ONLINE"].includes(mode) && !txnId.trim()) {
      if (!window.confirm(`No transaction reference for ${mode} payment. Record anyway?`)) return;
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

          <div className="his-field-group">
            <label className="his-label">Payment Mode *</label>
            <div className="rx-grid-5">
              {PAYMENT_MODES.filter(m => m !== "TPA_CLAIM").map(m => (
                <button key={m} type="button"
                        className={`rx-slot ${mode === m ? "rx-slot--selected" : ""}`}
                        onClick={() => setMode(m)}>{m}</button>
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
          <button className="rx-modal-btn-primary rx-modal-btn-primary--success"
                  onClick={submit} disabled={saving}>
            <i className={`pi ${saving ? "pi-spin pi-spinner" : "pi-check"}`} /> Collect {fmtCur(amount)}
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

function receiptHTML(bill, patient) {
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
    <h1>SphereHealth Hospital</h1>
    <div class="meta">NABH Accredited · Receipt of payment</div>
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
      <div class="row"><span>Gross:</span><strong>${fmtCur(bill.grossAmount)}</strong></div>
      <div class="row"><span>Discount:</span><strong>− ${fmtCur(bill.totalDiscount)}</strong></div>
      <div class="row"><span>Tax:</span><strong>${fmtCur(bill.taxAmount)}</strong></div>
      <div class="row"><span><strong>Net Payable:</strong></span><strong>${fmtCur(bill.netAmount)}</strong></div>
      <div class="row" style="color:#15803d"><span>Paid:</span><strong>${fmtCur((bill.netAmount || 0) - (bill.balanceAmount || 0))}</strong></div>
      <div class="row" style="color:#b91c1c"><span><strong>Balance Due:</strong></span><strong>${fmtCur(bill.balanceAmount)}</strong></div>
    </div>

    ${payments ? `<h3 style="margin-top:18px; font-size:13px;">Payments</h3>
    <table><thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${payments}</tbody></table>` : ""}

    <div class="footer">
      Receipt generated by Reception · ${new Date().toLocaleString("en-IN")}<br>
      This is a computer-generated receipt. Thank you for choosing SphereHealth.
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
    const amt = Number(savedAdv.amount?.$numberDecimal ?? savedAdv.amount) || 0;
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
