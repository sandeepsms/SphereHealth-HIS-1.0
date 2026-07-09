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
import { fetchHospitalSettings } from "../../Components/print/useHospitalSettings";
import ServiceAutocomplete from "../../Components/clinical/ServiceAutocomplete";
// R7fq Track B — shared NABH-style print frame for the Complete IPD Bill.
// The previous popup HTML duplicated the hospital-logo masthead inline,
// drifting from every other printable as Hospital Settings evolved. The
// helper returns the full <!doctype>…</html> string with hospital header,
// patient strip, banners, signature zone, disclaimer + footer baked in;
// callers only own the body slot (categorized bill table here).
import { buildPrintShellHtml } from "../../templates/PrintShell";
import { amountInWords } from "../../Components/print/amountWords";
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
  // Registration & Admission (was "Other Charges" — too vague; R7ex)
  REG: "Registration & Admission",
  REGISTRATION: "Registration & Admission",
  ADM: "Registration & Admission",
  ADMISSION: "Registration & Admission",
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
  ER: "Other Charges",
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
  primary: "#4f46e5", accent: "#7c3aed",
  success: "#059669", warn: "#d97706", danger: "#dc2626",
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  muted: "#64748b", dark: "#0f172a",
  bedTint: "#e0e7ff", nurseTint: "#fce7f3", docTint: "#ede9fe",
  labTint: "#fef9c3", drugTint: "#dcfce7", procTint: "#fed7aa",
};

// Service-code prefix → friendly category label + badge tint
const CATEGORY = {
  BED:        { label: "Bed Charges",     icon: "pi-th-large",     tint: C.bedTint,   fg: "#4f46e5" },
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
  completed:   { bg: "#e0e7ff", fg: "#4f46e5" },
  in_progress: { bg: "#e0e7ff", fg: "#4f46e5" },
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
      boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)",
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
  const [tab, setTab] = useState("category");   // "category" | "daily" | "audit" | "payments"
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

  // R7hr-186 (USER) — Collect Payment right from the ledger (no detour
  // to the Billing Counter). Posts to the SAME endpoints the Counter
  // uses: POST /billing/:billId/payment for cash modes, and
  // POST /billing/advance/:advanceId/apply for Adjust-from-Advance.
  // R7al invariant mirrored: cash modes stay locked while the UHID
  // advance pool has unspent balance.
  const [payOpen, setPayOpen] = useState(false);
  const [payAmt,  setPayAmt]  = useState("");
  const [payMode, setPayMode] = useState("CASH");
  const [payRef,  setPayRef]  = useState("");
  const [payBusy, setPayBusy] = useState(false);

  // B4-T09 — Stuck triggers widget (Admin / Accountant only).
  // Surfaces BillingTrigger rows that landed in status="pending-review"
  // so the desk can spot revenue-leak risks and retry them in one click.
  // TODO(B4-T09): Backend lacks a GET /billing/triggers?status=pending-review
  // endpoint as of this commit; the fetch below 404s harmlessly and the
  // widget renders empty. Wire up the read endpoint + POST .../retry
  // route in autoBillingService for full functionality.
  const [stuckTriggers, setStuckTriggers] = useState([]);
  const [retryingIds, setRetryingIds] = useState(new Set());
  const [stuckOpen, setStuckOpen] = useState(true);

  const canSeeStuck = user?.role === "Admin" || user?.role === "Accountant";

  useEffect(() => {
    if (!canSeeStuck) return;
    let cancelled = false;
    (async () => {
      try {
        // TODO(B4-T09): confirm final endpoint shape; this is a best-guess
        // matching the GET /api/billing/triggers?status=pending-review path
        // suggested in the task brief.
        const { data: r } = await axios.get(
          `${API_ENDPOINTS.BASE}/billing/triggers?status=pending-review${admissionId ? `&admissionId=${admissionId}` : ""}`,
        );
        if (cancelled) return;
        const rows = Array.isArray(r) ? r : (r?.data || r?.triggers || []);
        setStuckTriggers(rows);
      } catch (_e) {
        // Endpoint may not exist yet — fail silent so the page still works.
        if (!cancelled) setStuckTriggers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [canSeeStuck, admissionId]);

  const retryTrigger = async (id) => {
    setRetryingIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      // TODO(B4-T09): confirm retry endpoint exists; brief specifies
      // POST /api/billing/triggers/:id/retry — wire up the controller +
      // route to re-run the autoBilling pipeline for this single trigger.
      await axios.post(`${API_ENDPOINTS.BASE}/billing/triggers/${id}/retry`);
      toast.success("Trigger retried");
      // Drop the row optimistically so the user sees their click work.
      setStuckTriggers(rows => rows.filter(t => t._id !== id));
      load();
    } catch (e) {
      toast.error(`Retry failed: ${e.response?.data?.message || e.message}`);
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const ageMin = (createdAt) => {
    if (!createdAt) return "?";
    const ms = Date.now() - new Date(createdAt).getTime();
    return Math.max(0, Math.floor(ms / 60000));
  };

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

  // R7hr-186 + R7hr-188 — Collect a pending payment from the ledger
  // itself. R7hr-188 relaxed the backend DRAFT guards (user: "payment
  // collect kr raha hu to advance me jma ho jaati hai... fix kro"), so
  // collections now post DIRECTLY against the running bill — Outstanding
  // drops and PAID rises live, even mid-stay while the bill is DRAFT
  // (the bill stays DRAFT server-side so daily auto-billing continues).
  // ADVANCE mode walks the UHID's open advances FIFO via
  // /advance/:id/apply; cash modes hit POST /billing/:billId/payment.
  // R7al lock: cash stays disabled while the advance pool has balance.
  const collectPayment = async () => {
    const amt = Math.round(Number(payAmt) * 100) / 100;
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    // R7hr-193 (G8): cap against the CURRENT bill's balance, not the
    // aggregated billSummary — older GENERATED bills carry their own
    // dues and the backend OVERPAY cap is per-bill, so the aggregate
    // could let through an amount the server then rejects.
    const aggDue  = Math.max(0, Number(data?.billSummary?.balanceAmount || 0));
    const billDue = Math.max(0, Number(data?.bill?.balanceAmount || 0));
    const due = billDue > 0 ? billDue : aggDue;
    if (due > 0 && amt > due + 0.01) { toast.error(`Amount exceeds outstanding (₹${due.toLocaleString("en-IN")})`); return; }
    const billId = data?.bill?._id;
    if (!billId) { toast.error("No bill on this admission yet — add a charge first"); return; }
    setPayBusy(true);
    try {
      if (payMode === "ADVANCE") {
        // Pull the live advance ledger and consume open balances FIFO.
        const r = await axios.get(`${API_ENDPOINTS.BILLING}/advance/uhid/${encodeURIComponent(data.admission.UHID)}`);
        // Endpoint shape: { success, data: <summary>, advances: [rows] } —
        // the rows live under `advances`; `data` is the totals object.
        const rows = Array.isArray(r.data?.advances) ? r.data.advances
                   : Array.isArray(r.data?.data) ? r.data.data : [];
        const advances = rows
          .filter(a => a.status !== "REFUNDED" && Number(a.remainingAmount ?? a.balanceAmount ?? 0) > 0)
          .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        if (!advances.length) { toast.error("No unspent advance found for this UHID"); setPayBusy(false); return; }
        let left = amt, applied = 0;
        for (const adv of advances) {
          if (left <= 0) break;
          const chunk = Math.min(left, Number(adv.remainingAmount ?? adv.balanceAmount ?? 0));
          if (chunk <= 0) continue;
          const res = await axios.post(`${API_ENDPOINTS.BASE}/billing/advance/${adv._id}/apply`, { billId, amount: chunk });
          const got = Number(res.data?.appliedAmount || chunk);
          applied += got; left -= got;
        }
        toast.success(`₹${applied.toLocaleString("en-IN")} adjusted from advance pool`);
      } else {
        const res = await axios.post(`${API_ENDPOINTS.BASE}/billing/${billId}/payment`, {
          amount: amt,
          paymentMode: payMode,
          // R7hr-211 — backend recordPayment reads `transactionId` (and its
          // duplicate-UTR guard keys on it); the old `paymentReference` key
          // was silently dropped, losing the card/UPI ref and defeating the
          // double-payment guard for IPD collections.
          transactionId: payRef.trim() || undefined,
        });
        toast.success(`₹${amt.toLocaleString("en-IN")} collected (${payMode}) — receipt created`);
        // R7hr-192 (G2) — print the payment receipt, mirroring the
        // Billing Counter's printPaymentReceipt contract (R7ar-F3).
        // The live IPD bill has no billNumber yet, so the receipt
        // number anchors on the admission number instead. Amount
        // fields go through toMoney() because recordPayment returns
        // the raw bill doc with Decimal128 ({$numberDecimal}) values.
        try {
          const freshBill = res.data?.data || res.data || {};
          const pays = freshBill.payments || [];
          const pay  = pays[pays.length - 1] || {};
          const p    = data.admission.patientId || {};
          const anchor = freshBill.billNumber || data.admission.admissionNumber || "IPD-LIVE";
          const receiptNo = `${anchor}-P${pays.length || 1}`;
          const balanceAfter = toMoney(freshBill.balanceAmount);
          openPrint("payment-receipt", {
            receiptNo,
            patientName:  p.fullName || data.admission.patientName,
            uhid:         p.UHID || data.admission.UHID,
            visitType:    freshBill.visitType || "IPD",
            visitNo:      data.admission.admissionNumber,
            age:          p.age,
            gender:       p.gender,
            amount:       toMoney(pay.amount) || amt,
            method:       pay.paymentMode || payMode,
            refNo:        pay.transactionId || payRef.trim() || "",
            receivedBy:   pay.receivedBy || "Reception",
            paidAt:       pay.paidAt || new Date().toISOString(),
            purpose:      balanceAfter <= 0.5
              ? `Full settlement towards ${anchor}`
              : `Part-payment towards ${anchor} (interim)`,
            billTotal:    toMoney(freshBill.netAmount),
            totalPaid:    toMoney(freshBill.advancePaid),
            runningBalance: balanceAfter,
            remarks:      pay.remarks || "",
            printAudit: {
              entityType:   "Receipt",
              entityId:     freshBill._id,
              entityNumber: receiptNo,
              UHID:         p.UHID || data.admission.UHID,
              patientName:  p.fullName || data.admission.patientName,
            },
          });
        } catch (_) { /* print best-effort — payment is already recorded */ }
      }
      setPayOpen(false); setPayAmt(""); setPayRef("");
      await load();
    } catch (e) {
      // R7hr-193 (G8): friendly OVERPAY message — the server cap is on
      // the bill's CURRENT balance, which may have moved (new charges /
      // another cashier) since this page last loaded.
      if (e?.response?.data?.code === "OVERPAY") {
        toast.error("Amount is more than the bill's current balance — page Refresh karke dobara try karein.");
        await load();
      } else {
        toast.error(e?.response?.data?.message || e.message || "Payment failed");
      }
    } finally { setPayBusy(false); }
  };

  // R7hr-194 (USER) — confirm a PENDING (requiresConfirmation) charge
  // right on the ledger. e.g. NRS-BLD blood transfusion lands as
  // PENDING; the receptionist verbally confirms with staff/doctor and
  // clicks "Confirm & Bill" on the row — no more detour to
  // /billing-audit-trail just to flip the status. Same backend endpoint
  // the audit page uses (billing.write).
  const confirmPending = async (t) => {
    const ok = window.confirm(
      `${t.serviceName} (₹${Number(t.totalAmount || 0).toLocaleString("en-IN")}) — staff/doctor se confirm ho gaya?\n\nConfirm & Bill?`,
    );
    if (!ok) return;
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/billing/audit/${t._id}/confirm-bill`, {
        confirmedBy: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || user?.name,
        confirmedByRole: user?.role || "Receptionist",
      });
      toast.success(`${t.serviceName} — confirmed & billed`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || "Confirm failed");
    }
  };

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
  // R7ew — IPD vs Daycare pill filter on the no-admission picker.
  // Default to "IPD" (matches admissionType in IPD/Planned/Transfer/
  // Emergency — true inpatient stays). "DAYCARE" matches Day Care /
  // Daycare. The picker already drops OPD/Services upstream via
  // INPATIENT_TYPES; this pill just splits the inpatient bucket so
  // the receptionist sees one workflow at a time.
  const [typeFilter,   setTypeFilter]   = useState("IPD");
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
  // R7ew — pill-driven type buckets.
  const IPD_BUCKET     = new Set(["IPD", "Planned", "Transfer", "Emergency"]);
  const DAYCARE_BUCKET = new Set(["Day Care", "Daycare"]);
  const matchesTypePill = (a) => {
    const t = a?.admissionType;
    if (typeFilter === "DAYCARE") return DAYCARE_BUCKET.has(t);
    return IPD_BUCKET.has(t); // default "IPD" pill
  };
  const typedList = pickerList.filter(matchesTypePill);

  // Live filter — search by name / UHID / IPD No / bed / doctor / dept.
  const filteredPicker = (() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return typedList;
    return typedList.filter(a => {
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
    // R7ex — toMoney() unwraps Decimal128 ({$numberDecimal:"500"}); raw
    // pass-through made every rate/amount render as ₹0.
    const items = (data.triggers || [])
      .filter(t => !["voided", "cancelled", "skipped"].includes(t.status))
      .map(t => {
        const rate = toMoney(t.unitPrice);
        const qty  = Number(t.quantity || 1);
        const amt  = toMoney(t.totalAmount) || (rate * qty);
        return {
          category:    printCategoryFor(t),
          name:        t.serviceName || t.serviceCode,
          description: t.orderDetails,
          date:        t.createdAt,
          qty,
          rate,
          amount:      amt,
        };
      });
    openPrint("final-bill", {
      isInterim:        false,
      viewMode:         "category",
      // R7ey-F3 — pass visitType so FinalBill prints "Day Care" / "Emergency"
      // / "IPD" titles correctly instead of always "IPD".
      visitType:        data.admission.admissionType,
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
      // R7en-FIX: stored field is attendingDoctor (legacy fields never
      // populated). TPA falls back to Self-pay for cash patients.
      consultantName:   data.admission.attendingDoctor
                      || data.admission.consultantDoctor?.fullName
                      || data.admission.primaryConsultant
                      || "—",
      finalDiagnosis:   data.admission.finalDiagnosis || data.admission.provisionalDiagnosis || data.admission.workingDiagnosis || data.admission.diagnosis || "",
      tpaName:          data.bill?.tpaName
                      || data.admission.tpaProvider
                      || data.admission.insuranceProvider
                      || "Self-pay",
      items,
      discount:         totalDiscount,
      advanceReceived:  paid,
      // R7hr(billing-audit P1.2) — same-episode OPD charges memo (referenced,
      // NOT merged — the OPD bill keeps its own number + GST; FinalBill renders
      // this as a footnote so the discharge document shows the whole episode).
      preAdmissionOpd:  linkedOpd ? {
        billNumber: (linkedOpd.bills || []).map(b => b.billNumber).filter(Boolean).join(", ") || linkedOpd.visitNumber || "",
        net:        Number(linkedOpd.netAmount || 0),
        due:        Number(linkedOpd.balanceAmount || 0),
      } : null,
      // R7hr(billing-audit R3) — aggregate payment rows across EVERY bill of
      // this admission, not just the active one. advanceReceived (= billSummary
      // .advancePaid) already sums all bills, so a multi-bill admission would
      // otherwise show a "paid" deduction larger than the Payment History
      // listed. Aggregating every bill's rows makes the breakdown tie out to
      // the deducted total. Sorted oldest-first.
      payments:         ((data.bills?.length ? data.bills : [data.bill]).filter(Boolean))
        .flatMap(b => b.payments || [])
        .map(p => ({
          date:   p.paidAt,
          method: p.paymentMode,
          refNo:  p.transactionId,
          amount: toMoney(p.amount),
        }))
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)),
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

  /* ── R7co: Print COMPLETE IPD Bill ──────────────────────────────
     Single comprehensive document covering EVERY angle the patient /
     TPA / accountant could ask for:
        • Section A — Category-wise summary (Bed / Nursing / Doctor /
                      Pharmacy / Investigations / Procedures / Misc)
                      with per-category subtotal + % of total.
        • Section B — Day-wise detailed breakdown (Day 1 → Day N with
                      every line item, date-grouped).
        • Section C — Payment ledger + advance adjustments (deposits
                      taken, applied, refunded).
        • Section D — Grand totals (Gross · Discount · Tax · Net · Paid
                      · Balance) with PATIENT ACCOUNT SETTLED / BALANCE
                      DUE banner.
     Pre-R7co the user had to pick the Category / Daily / Audit tab and
     print 3× to give the patient everything. Now one click prints the
     master bill. Existing Print Interim Bill (tab-scoped) stays for
     the day-to-day reception flow that wants a single view. */
  const handlePrintComplete = async () => {
    if (!data) return toast.warn("Ledger not loaded yet");
    let hs = {};
    try { hs = await fetchHospitalSettings(); } catch (_) { hs = {}; }

    // Pull the full advance ledger for this UHID so Section C can show
    // each deposit, status, applied amount, and remaining balance —
    // mirrors the OPD consolidated bill's ADVANCE DEPOSITS table.
    let advances = [];
    try {
      const r = await axios.get(`${API_ENDPOINTS.BILLING}/advance/uhid/${encodeURIComponent(data.admission.UHID)}`);
      advances = r?.data?.data?.advances || r?.data?.advances || [];
    } catch (_) { /* non-fatal — Section C still renders payments-only */ }

    const esc = (s = "") => String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
    // R7ex — Decimal128 unwrap. Mongoose serialises Decimal128 to JSON as
    // { $numberDecimal: "500" }. The default Object#toString returns
    // "[object Object]" → NaN, which silently zeroed every rate/amount on
    // the print. Check $numberDecimal explicitly before generic .toString.
    const _num = (v) => {
      if (v == null) return 0;
      if (typeof v === "object") {
        if (v.$numberDecimal != null)         v = v.$numberDecimal;
        else if (typeof v.toString === "function" && v.toString !== Object.prototype.toString) v = v.toString();
        else                                  v = NaN;
      }
      const n = Number(v); return Number.isFinite(n) ? n : 0;
    };
    const _money = (n) => `₹${_num(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const _dt    = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
    const _date  = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

    // Filter out voided / cancelled / skipped — those don't appear on a
    // settlement bill (audit trail mode includes them, but this is a
    // patient-facing document).
    const liveTriggers = (data.triggers || []).filter(t => !["voided", "cancelled", "skipped"].includes(t.status));

    // ── Section A: Category-wise aggregation ──────────────────────
    const catMap = {};
    let catTotal = 0;
    for (const t of liveTriggers) {
      const cat = printCategoryFor(t);
      const amt = _num(t.totalAmount) || (_num(t.unitPrice) * _num(t.quantity || 1));
      if (!catMap[cat]) catMap[cat] = { name: cat, lines: 0, qty: 0, total: 0 };
      catMap[cat].lines += 1;
      catMap[cat].qty   += _num(t.quantity || 1);
      catMap[cat].total += amt;
      catTotal          += amt;
    }
    const catRows = Object.values(catMap).sort((a, b) => b.total - a.total);

    // ── Section B: Day-wise aggregation ───────────────────────────
    const admitStart = new Date(data.admission.admissionDate);
    admitStart.setHours(0, 0, 0, 0);
    const dayMap = {};
    for (const t of liveTriggers) {
      const dKey = t.dateKey
        || (t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : "unknown");
      if (!dayMap[dKey]) {
        const dayDate = new Date(dKey);
        dayDate.setHours(0, 0, 0, 0);
        const dayN = Math.max(1, Math.floor((dayDate - admitStart) / 86400000) + 1);
        dayMap[dKey] = {
          dateKey: dKey,
          dayN,
          label: dKey === "unknown" ? "Undated" : `Day ${dayN} · ${_date(dayDate)}`,
          items: [],
          total: 0,
        };
      }
      const amt = _num(t.totalAmount) || (_num(t.unitPrice) * _num(t.quantity || 1));
      dayMap[dKey].items.push({
        category: printCategoryFor(t),
        name:     t.serviceName || t.serviceCode,
        code:     t.serviceCode,
        remarks:  t.orderDetails || "",
        qty:      _num(t.quantity || 1),
        rate:     _num(t.unitPrice),
        amount:   amt,
        when:     t.createdAt,
      });
      dayMap[dKey].total += amt;
    }
    const dayRows = Object.values(dayMap).sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    // ── Totals from canonical billSummary (so the page KPI strip and
    //    the printout never disagree). Fall back to the trigger sum if
    //    bills haven't materialised yet.
    const sumGross  = _num(data.billSummary?.grossAmount)   || catTotal;
    const sumDisc   = _num(data.billSummary?.totalDiscount);
    const sumTax    = _num(data.billSummary?.taxAmount);
    const sumNet    = _num(data.billSummary?.netAmount)     || sumGross;
    const sumPaid   = _num(data.billSummary?.advancePaid);
    const sumDue    = Math.max(0, _num(data.billSummary?.balanceAmount) || (sumNet - sumPaid));

    // ── Section C: Payments split by mode + advance ledger ────────
    const payments = (data.bill?.payments || []);
    const advApplied = payments
      .filter(p => p.paymentMode === "ADVANCE_ADJUSTMENT")
      .reduce((s, p) => s + _num(p.amount), 0);

    const stayDays = Math.max(1, Math.ceil(
      ((data.admission.actualDischargeDate ? new Date(data.admission.actualDischargeDate) : new Date()) -
       new Date(data.admission.admissionDate)) / 86400000,
    ));
    const patientName = (data.admission.patientId?.fullName) || data.admission.UHID || "Patient";
    // R7ex / R7ey-F39 — admission fallback chain. The audit confirmed
    // that `consultantDoctor` and `primaryConsultant` are phantom
    // fields (never populated by any save path); `attendingDoctor` is
    // the canonical denormalized name string. Lead with that.
    const _docRaw     = data.admission.attendingDoctor
                     || data.admission.consultantDoctor?.fullName
                     || data.admission.primaryConsultant
                     || "";
    const consultant  = _docRaw
      ? (/^(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i.test(_docRaw) ? _docRaw : `Dr. ${_docRaw}`)
      : "—";
    const dx          = data.admission.provisionalDiagnosis || data.admission.workingDiagnosis || data.admission.diagnosis || "—";
    const bedNo       = data.admission.bedId?.bedNumber || data.admission.bedNumber || "—";
    const wardName    = data.admission.bedId?.wardName   || data.admission.wardName  || data.admission.department || "—";

    // R7ey-F2 — derive visitLabel + visitLabelShort from admissionType so
    // Day Care / Emergency / Transfer admissions don't all print as "IPD".
    // Pattern-A from the R7eo print sweep (OPDReceipt etc. all use this
    // same ladder).
    const _visitRaw = String(data.admission.admissionType || "IPD").toUpperCase();
    const visitLabel =
        _visitRaw === "DAYCARE"   ? "Day Care"
      : _visitRaw === "DAY CARE"  ? "Day Care"
      : _visitRaw === "EMERGENCY" ? "Emergency"
      : _visitRaw === "ER"        ? "Emergency"
      : _visitRaw === "TRANSFER"  ? "Transfer"
      : _visitRaw === "PLANNED"   ? "IPD"
                                  : "IPD";
    // "IPD #:" / "Day Care #:" / "Emergency #:" row label — keep it terse.
    const visitNumLabel = visitLabel === "Day Care" ? "Day Care #" : `${visitLabel} #`;

    // R7fq Track B — hospital header / patient strip / signatures / footer
    // are now owned by the shared PrintShell. This handler only builds the
    // body HTML (categorised + day-wise + payments + totals + amount-in-
    // words + net strip) and delegates the chrome to buildPrintShellHtml.
    // Pre-R7fq this function carried its own inline masthead — every
    // Hospital Settings edit (logo, name, GSTIN, NABH cert) drifted from
    // every other printable until someone hand-synced this file.

    // Build the per-line categorised bill table (Sir Ganga Ram pattern:
    // category band row → line items → subtotal row, repeated per
    // category, then a single Grand Total row). The Section A/B/C
    // breakdown is preserved as supplementary blocks below the main
    // categorised table so the patient still sees day-wise + payments
    // + advance-deposits, but the top-of-bill view is now the standard
    // categorised pattern used across every bill print.
    let slNo = 0;
    // Group liveTriggers by category in CATEGORY_ORDER, then unknowns.
    const CATEGORY_ORDER = [
      "Registration & Admission",
      "Room/Bed Charges",
      "Doctor / Consultant Fees",
      "Nursing Charges",
      "Procedure / OT Charges",
      "Investigations / Lab",
      "Radiology / Imaging",
      "Pharmacy / Medications",
      "Consumables / Disposables",
      "Equipment / Monitoring",
      "Ambulance",
      "Other Charges",
    ];
    const grouped = {};
    for (const t of liveTriggers) {
      const cat = printCategoryFor(t);
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(t);
    }
    const orderedCats = [
      ...CATEGORY_ORDER.filter(c => grouped[c]),
      ...Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c)),
    ];
    const billRows = orderedCats.map(cat => {
      const rowsHtml = grouped[cat].map(t => {
        slNo += 1;
        const rate = _num(t.unitPrice);
        const qty  = _num(t.quantity || 1);
        const amt  = _num(t.totalAmount) || (rate * qty);
        return `
          <tr>
            <td>${slNo}</td>
            <td>${esc(t.serviceName || t.serviceCode)}${t.orderDetails ? `<div class="rmk">${esc(t.orderDetails)}</div>` : ""}</td>
            <td>${_date(t.createdAt)}</td>
            <td style="text-align:right">${rate.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="text-align:right">${qty.toFixed(2)}</td>
            <td style="text-align:right"><strong>${amt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
          </tr>`;
      }).join("");
      const sub = grouped[cat].reduce((s, t) => s + (_num(t.totalAmount) || (_num(t.unitPrice) * _num(t.quantity || 1))), 0);
      return `
        <tr class="ps-cat-row"><td colspan="6"><b>${esc(cat)}</b></td></tr>
        ${rowsHtml}
        <tr class="ps-subtotal"><td colspan="3"></td><td><b>Sub Total</b></td><td></td><td style="text-align:right"><b>${sub.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></td></tr>`;
    }).join("");

    // Supplementary tables — day-wise breakdown, payment ledger, advance
    // ledger — kept below the main categorised bill so the patient sees
    // the complete picture in one document (the original Section A/B/C/D
    // value).
    const dayBlocks = dayRows.map(d => {
      const itemsHtml = d.items.map(it => `
        <tr>
          <td>${esc(it.category)}</td>
          <td>${esc(it.name)}${it.remarks ? `<div class="rmk">${esc(it.remarks)}</div>` : ""}</td>
          <td style="text-align:right">${it.qty}</td>
          <td style="text-align:right">${_money(it.rate)}</td>
          <td style="text-align:right"><strong>${_money(it.amount)}</strong></td>
        </tr>`).join("");
      return `
        <div class="day-block">
          <div class="day-head">
            <strong>${esc(d.label)}</strong>
            <span class="day-total">${_money(d.total)}</span>
          </div>
          <table>
            <thead><tr>
              <th style="width:130px">Category</th>
              <th>Service</th>
              <th style="text-align:right;width:60px">Qty</th>
              <th style="text-align:right;width:100px">Rate</th>
              <th style="text-align:right;width:120px">Amount</th>
            </tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        </div>`;
    }).join("");

    const dailyHtml = dayRows.length === 0 ? "" : `
      <div class="ps-section">
        <div class="ps-section-title">Day-wise Detailed Breakdown</div>
        ${dayBlocks}
      </div>`;

    const payRows = payments.map(p => `
      <tr>
        <td>${_dt(p.paidAt || p.createdAt)}</td>
        <td>${esc(p.paymentMode || "—")}${p.paymentMode === "ADVANCE_ADJUSTMENT" ? " <span class='pill pill-adv'>ADV</span>" : ""}</td>
        <td>${esc(p.transactionId || "—")}</td>
        <td>${esc(p.receivedBy || "—")}</td>
        <td style="text-align:right"><strong>${_money(p.amount)}</strong></td>
      </tr>`).join("");

    const advRows = advances.map(a => `
      <tr>
        <td>${esc(a.receiptNumber || "ADV")}</td>
        <td>${_dt(a.paidAt || a.createdAt)}</td>
        <td>${esc(a.paymentMode || "—")}</td>
        <td><span class="pill pill-${esc((a.status || "").toLowerCase())}">${esc(a.status || "")}</span></td>
        <td style="text-align:right">${_money(a.amount)}</td>
        <td style="text-align:right">${_money(a.appliedAmount)}</td>
        <td style="text-align:right">${_money(a.remainingAmount)}</td>
      </tr>`).join("");

    const paymentsHtml = (payments.length === 0 && advances.length === 0) ? "" : `
      <div class="ps-section">
        <div class="ps-section-title">Payment Ledger &amp; Advance Adjustments</div>
        ${payments.length === 0 ? "" : `<table>
              <thead><tr>
                <th>Date</th><th>Mode</th><th>Reference</th><th>Received by</th>
                <th style="text-align:right;width:130px">Amount</th>
              </tr></thead>
              <tbody>${payRows}</tbody>
              <tfoot><tr>
                <td colspan="4" style="text-align:right">Total Payments Received</td>
                <td style="text-align:right"><strong>${_money(sumPaid)}</strong></td>
              </tr></tfoot>
            </table>`}
        ${advances.length === 0 ? "" : `
          <div class="ps-sub-title">Patient Advance Deposits (UHID-wide)</div>
          <table>
            <thead><tr>
              <th>Receipt #</th><th>Date</th><th>Mode</th><th>Status</th>
              <th style="text-align:right">Amount</th>
              <th style="text-align:right">Applied</th>
              <th style="text-align:right">Remaining</th>
            </tr></thead>
            <tbody>${advRows}</tbody>
          </table>`}
      </div>`;

    // Grand total + amount-in-words + net-payable strip (Sir Ganga Ram
    // pattern: a bold strip just under the bill table makes the bottom-
    // line unambiguous to a non-technical patient/relative). R7da
    // amountInWords helper handles Decimal128 wire format natively.
    const settled = sumDue <= 0;
    const bodyHtml = `
      <style>
        .ps-bill { width:100%; border-collapse:collapse; font-size:11.5px; margin-bottom:10px; }
        .ps-bill th, .ps-bill td { padding:5px 9px; border-bottom:1px solid #e5e7eb; text-align:left; vertical-align:top; }
        .ps-bill thead th { background:#f3f4f6; font-size:9.5px; text-transform:uppercase; letter-spacing:.4px; color:#374151; }
        .ps-bill .ps-cat-row td { background:#e0e7ff; color:#3730a3; font-size:11px; font-weight:800; letter-spacing:.4px; padding:6px 10px; text-transform:uppercase; }
        .ps-bill .ps-subtotal td { background:#f8fafc; font-weight:700; border-top:1px dashed #cbd5e1; }
        .ps-bill .ps-grand-total td { background:#fef3c7; color:#92400e; font-size:13px; font-weight:900; border-top:2px solid #1f2937; border-bottom:2px solid #1f2937; padding:8px 10px; }
        .ps-amount-words { padding:8px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px; margin:10px 0; }
        .ps-net-strip { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:#3730a3; color:#fff; border-radius:6px; font-size:13px; font-weight:800; margin:10px 0 14px; }
        .ps-net-strip b { font-size:16px; }
        .ps-section { margin:14px 0; }
        .ps-section-title { font-size:11.5px; font-weight:800; color:#1f2937; background:#e0e7ff; padding:5px 10px; border-left:3px solid #7c3aed; letter-spacing:.4px; margin-bottom:6px; }
        .ps-sub-title { font-size:10.5px; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:.4px; margin:12px 0 4px; }
        .ps-section table { width:100%; border-collapse:collapse; font-size:11px; }
        .ps-section th, .ps-section td { padding:4px 8px; border-bottom:1px solid #e5e7eb; text-align:left; vertical-align:top; }
        .ps-section th { background:#f3f4f6; font-size:9px; text-transform:uppercase; letter-spacing:.3px; color:#374151; }
        .ps-section tfoot td { background:#f8fafc; font-weight:700; }
        .rmk { font-size:9.5px; color:#94a3b8; margin-top:1px; font-style:italic; }
        .day-block { margin:8px 0 12px; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; page-break-inside:avoid; }
        .day-head { display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:#fef3c7; font-size:11px; color:#92400e; }
        .day-head .day-total { font-weight:900; color:#0f172a; }
        .pill { display:inline-block; padding:1px 7px; border-radius:10px; font-size:9px; font-weight:700; background:#f1f5f9; color:#475569; }
        .pill-adv { background:#f3e8ff; color:#7c3aed; }
        .pill-active { background:#e0e7ff; color:#4f46e5; }
        .pill-refunded { background:#fee2e2; color:#b91c1c; }
        .pill-exhausted { background:#dcfce7; color:#15803d; }
        .ps-status-banner { padding:8px 12px; border-radius:6px; font-size:12px; font-weight:800; margin:8px 0; text-align:center; letter-spacing:.4px; }
        .ps-status-banner.ok { background:#dcfce7; color:#166534; border:1px solid #86efac; }
        .ps-status-banner.due { background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; }
      </style>
      ${billRows ? `
      <table class="ps-bill">
        <thead>
          <tr>
            <th style="width:36px">Sl.No</th>
            <th>Item Name</th>
            <th style="width:90px">Date</th>
            <th style="width:90px;text-align:right">Price</th>
            <th style="width:60px;text-align:right">Qty</th>
            <th style="width:110px;text-align:right">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${billRows}
          ${sumDisc > 0 ? `<tr><td colspan="3"></td><td style="text-align:right">Less: Discount</td><td></td><td style="text-align:right">− ${sumDisc.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>` : ""}
          ${sumTax > 0 ? `<tr><td colspan="3"></td><td style="text-align:right">Add: Tax</td><td></td><td style="text-align:right">+ ${sumTax.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>` : ""}
          <tr class="ps-grand-total">
            <td colspan="3"></td>
            <td><b>Grand Total</b></td>
            <td style="text-align:right">${(catTotal).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="text-align:right"><b>${sumNet.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></td>
          </tr>
        </tbody>
      </table>

      <div class="ps-amount-words">
        <b>Amount in words:</b> ${esc(amountInWords(sumNet))}
      </div>

      <div class="ps-net-strip">
        <span>Net Amount to be paid by Patient:</span>
        <b>₹ ${sumNet.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
      </div>

      <div class="ps-section">
        <div class="ps-section-title">Settlement Summary</div>
        <table>
          <tbody>
            <tr><td>Total Net Payable</td><td style="text-align:right"><b>${_money(sumNet)}</b></td></tr>
            <tr><td>Paid (cash + advance)</td><td style="text-align:right; color:#15803d"><b>${_money(sumPaid)}</b></td></tr>
            ${advApplied > 0 ? `<tr><td style="padding-left:24px; color:#7c3aed">↳ via Advance Adjustment</td><td style="text-align:right; color:#7c3aed">${_money(advApplied)}</td></tr>` : ""}
          </tbody>
        </table>
        <div class="ps-status-banner ${settled ? "ok" : "due"}">
          ${settled ? `PATIENT ACCOUNT SETTLED · ${_money(0)}` : `BALANCE DUE · ${_money(sumDue)}`}
        </div>
      </div>
      ` : `<div style="padding:24px; text-align:center; color:#94a3b8; font-style:italic; background:#f8fafc; border-radius:6px;">No billable charges accrued yet.</div>`}

      ${paymentsHtml}
      ${dailyHtml}
    `;

    const html = buildPrintShellHtml({
      hospital: {
        ...hs,
        name: hs.hospitalName,
        phone: hs.phone1,
        helpline24x7: hs.emergencyPhone || hs.phone1,
      },
      docTitle: `Complete ${visitLabel} Bill`,
      docSubtitle: hs.tagline || "",
      patient: {
        left: [
          { label: "Bill No", value: data.bill?.billNumber || "DRAFT" },
          { label: "UHID", value: data.admission.UHID },
          { label: "Patient", value: patientName },
          { label: "Age/Sex", value: [data.admission.patientId?.age && `${data.admission.patientId.age}Y`, data.admission.patientId?.gender].filter(Boolean).join(" / ") || "—" },
          { label: "Contact", value: data.admission.patientId?.contactNumber || "—" },
          { label: "Diagnosis", value: dx },
        ],
        right: [
          { label: "Bill Date", value: _dt(new Date()) },
          { label: visitNumLabel, value: data.admission.admissionNumber },
          { label: "Admit/Discharge", value: `${_dt(data.admission.admissionDate)} — ${data.admission.actualDischargeDate ? _dt(data.admission.actualDischargeDate) : "Ongoing"}` },
          { label: "Stay", value: `${stayDays} day${stayDays === 1 ? "" : "s"}` },
          { label: "Doctor", value: consultant },
          { label: "Ward/Bed", value: `${wardName} / ${bedNo}` },
        ],
      },
      signatures: {
        type: "prepared-by",
        preparedBy: { name: user?.fullName || "Billing", role: "Billing" },
        showAttestedStamp: true,
      },
      banners: { emergency24x7: !!(hs.emergencyPhone || hs.phone1) },
      meta: {
        docNumber: data.bill?.billNumber || `IPD-${data.admission.admissionNumber}`,
        pageOf: "1 of {n}",
      },
      bodyHtml,
    });

    const win = window.open("", "_blank", "width=1100,height=1400");
    if (!win) return toast.warn("Pop-up blocked — allow pop-ups to print the complete bill");
    win.document.write(html);
    win.document.close();
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
      // R7ey-F3 — pass visitType so FinalBill normalises the doc title
      // (Day Care / Emergency / IPD) instead of always saying "IPD".
      visitType:        data.admission.admissionType,
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
      // R7en-FIX: the admission row stores the admitting/treating doctor
      // in `attendingDoctor` (string), not `consultantDoctor` / `primary
      // Consultant` — those legacy field names were never populated by the
      // reception form, so every interim bill printed "—" for Consultant.
      // Same fix for TPA: cash patients have no bill row + no TPA, but
      // the receipt shouldn't leave the field blank — fall back to
      // "Self-pay" so the surveyor / patient sees the payment basis.
      consultantName:   data.admission.attendingDoctor
                      || data.admission.consultantDoctor?.fullName
                      || data.admission.primaryConsultant
                      || "—",
      finalDiagnosis:   data.admission.provisionalDiagnosis || data.admission.workingDiagnosis || data.admission.diagnosis || "",
      tpaName:          data.bill?.tpaName
                      || data.admission.tpaProvider
                      || data.admission.insuranceProvider
                      || "Self-pay",
      discount:         totalDiscount,
      advanceReceived:  paid,
      // R7hr(billing-audit R3) — aggregate payment rows across EVERY bill of
      // this admission, not just the active one. advanceReceived (= billSummary
      // .advancePaid) already sums all bills, so a multi-bill admission would
      // otherwise show a "paid" deduction larger than the Payment History
      // listed. Aggregating every bill's rows makes the breakdown tie out to
      // the deducted total. Sorted oldest-first.
      payments:         ((data.bills?.length ? data.bills : [data.bill]).filter(Boolean))
        .flatMap(b => b.payments || [])
        .map(p => ({
          date:   p.paidAt,
          method: p.paymentMode,
          refNo:  p.transactionId,
          amount: toMoney(p.amount),
        }))
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)),
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
        .map(t => {
          // R7ex — Decimal128 unwrap so rate/amount aren't ₹0 on print
          const rate = toMoney(t.unitPrice);
          const qty  = Number(t.quantity || 1);
          const amt  = toMoney(t.totalAmount) || (rate * qty);
          return {
          when:           t.createdAt,
          source:         t.sourceType,
          category:       printCategoryFor(t),
          name:           t.serviceName || t.serviceCode,
          code:           t.serviceCode,
          remarks:        t.orderDetails,
          qty,
          rate,
          amount:         amt,
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
          };
        });
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
            // R7ex — Decimal128 unwrap (rate/amount were ₹0 on print)
            qty:         Number(t.quantity || 1),
            rate:        toMoney(t.unitPrice),
            amount:      toMoney(t.totalAmount) || (toMoney(t.unitPrice) * Number(t.quantity || 1)),
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
        // R7ex — Decimal128 unwrap (rate/amount were ₹0 on print)
        qty:         Number(t.quantity || 1),
        rate:        toMoney(t.unitPrice),
        amount:      toMoney(t.totalAmount) || (toMoney(t.unitPrice) * Number(t.quantity || 1)),
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

          {/* R7ew — Type filter pills. IPD bucket covers true inpatient
              stays (IPD/Planned/Transfer/Emergency); Daycare bucket
              covers same-day procedures (Day Care/Daycare). Each pill
              shows its own count from the unfiltered picker list so the
              receptionist can see at a glance how many of each type are
              live. */}
          {(() => {
            const ipdCount = pickerList.filter(a => IPD_BUCKET.has(a?.admissionType)).length;
            const dcCount  = pickerList.filter(a => DAYCARE_BUCKET.has(a?.admissionType)).length;
            const Pill = ({ value, label, count, icon, color, tint }) => {
              const active = typeFilter === value;
              return (
                <button
                  type="button"
                  onClick={() => setTypeFilter(value)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: `1.5px solid ${active ? color : C.border}`,
                    background: active ? `linear-gradient(135deg, ${color}, ${color}dd)` : C.card,
                    color: active ? "#fff" : C.dark,
                    fontSize: 12.5, fontWeight: 800,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 7,
                    transition: "all .15s",
                    boxShadow: active ? `0 2px 8px ${color}40` : "none",
                  }}
                >
                  <i className={`pi ${icon}`} style={{ fontSize: 13 }} />
                  {label}
                  <span style={{
                    background: active ? "rgba(255,255,255,.25)" : tint,
                    color: active ? "#fff" : color,
                    fontSize: 10.5, fontWeight: 800,
                    padding: "1px 7px", borderRadius: 999,
                    minWidth: 18, textAlign: "center",
                  }}>{count}</span>
                </button>
              );
            };
            return (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <Pill value="IPD"     label="IPD"     count={ipdCount} icon="pi-home" color="#7c3aed" tint="#f3e8ff" />
                <Pill value="DAYCARE" label="Day Care" count={dcCount}  icon="pi-sun"  color="#d97706" tint="#fef3c7" />
              </div>
            );
          })()}

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
              placeholder={`Search ${typeFilter === "DAYCARE" ? "daycare admissions" : "IPD admissions"} by name, UHID, IPD No, bed, doctor or department…`}
              style={{
                flex: 1, border: "none", outline: "none",
                fontSize: 14, fontFamily: "inherit", color: C.dark,
              }}
            />
            <span style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono', monospace" }}>
              {filteredPicker.length} / {typedList.length}
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
                <div>{pickerSearch
                  ? "No matching admissions"
                  : (typeFilter === "DAYCARE" ? "No active Day Care admissions" : "No active IPD admissions")
                }</div>
                <div style={{ fontSize: 11, marginTop: 6 }}>
                  {pickerSearch
                    ? "Try a different search term"
                    : (typeFilter === "DAYCARE"
                        ? "Admit a patient via Reception → New Registration → Day Care"
                        : "Admit a patient via Reception → New Registration → IPD/Emergency")
                  }
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

  const { admission, bill, billSummary, triggerLiveTotal, advanceBalance, linkedOpd, triggers, byCategory, byDay, counts, undoWindowMs } = data;
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

      {/* R7hr(billing-audit P1.2) — Pre-admission OPD charges. This admission
          converted from a same-day OPD visit; its OPD bill belongs to the SAME
          episode. Surfaced here so the biller sees the WHOLE episode (OPD + IPD)
          in ONE place; the discharge dues gate blocks on any unpaid OPD balance. */}
      {linkedOpd && (
        <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 12, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <i className="pi pi-arrow-right-arrow-left" style={{ color: "#4338ca", fontSize: 16 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#3730a3" }}>Pre-admission OPD charges · same episode</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
              Converted from OPD visit {linkedOpd.visitNumber || linkedOpd.admissionNumber}
              {linkedOpd.visitDate ? ` · ${fmtDate(linkedOpd.visitDate)}` : ""}
              {" · "}{(linkedOpd.bills || []).length} bill{(linkedOpd.bills || []).length === 1 ? "" : "s"}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700 }}>OPD Net</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.dark }}>{inr(Number(linkedOpd.netAmount || 0))}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", fontWeight: 700 }}>OPD Due</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: Number(linkedOpd.balanceAmount || 0) > 0 ? C.danger : C.success }}>{inr(Number(linkedOpd.balanceAmount || 0))}</div>
            </div>
            <button onClick={() => navigate(`/reception-billing/${admission.UHID}`)}
              style={{ padding: "7px 12px", background: "#fff", border: "1px solid #c7d2fe", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12, color: "#4338ca" }}>
              Open OPD bill
            </button>
          </div>
        </div>
      )}

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
        {/* R7hr-186 (USER) — collect the pending payment right here on
            the ledger. Default amount = full outstanding; Adjust-from-
            Advance is forced first while the pool has unspent balance
            (R7al invariant, mirrored from the Billing Counter). */}
        {can("billing.write") && balance > 0 && (
          <button onClick={() => {
            setPayAmt(String(advanceBalance > 0 ? Math.min(balance, advanceBalance) : balance));
            setPayMode(advanceBalance > 0 ? "ADVANCE" : "CASH");
            setPayRef("");
            setPayOpen(true);
          }} style={{
            padding: "7px 14px", background: "#0284c7", color: "#fff", border: "none",
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
          }}>
            <i className="pi pi-money-bill" style={{ marginRight: 6 }} />
            Collect Payment
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
        {/* R7co: COMPLETE IPD bill — single document with category-wise
            summary + day-wise breakdown + payment ledger + advance
            adjustments + grand totals. Use when patient / TPA / insurer
            asks for the full picture in one printout. */}
        <button onClick={handlePrintComplete} style={{
          padding: "7px 14px", background: "#fff", color: C.accent,
          border: `1px solid ${C.accent}`,
          borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
        }}
          title="Print one master bill with category summary + day-wise detail + payments + advances">
          <i className="pi pi-file" style={{ marginRight: 6 }} />
          Complete Bill
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
        {/* R7hr(CLAIM-P1.3 → P3.3) — Insurance Claim Pack: fetches the
            canonical claim data for this bill's episode and opens ONE
            combined pack (the payer's whole form set, page-broken) so the
            claims desk gets a single print / PDF. Scheme→forms routing now
            lives in ClaimPackBundle. Shown for TPA/insured patients. */}
        {can("billing.read") && data?.bill?._id && (
          <button
            onClick={async () => {
              try {
                const r = await axios.get(`${API_ENDPOINTS.BILLING}/${data.bill._id}/claim-data`);
                const cd = r.data?.data;
                if (!cd) { toast.warn("Claim data unavailable"); return; }
                const scheme = cd.patient?.payerScheme || "CASH";
                openPrint("claim-pack", cd);
                const label = scheme === "CGHS" ? "CGHS MRC + docket"
                  : scheme === "ESIC" ? "ESIC claim + docket"
                  : ["PMJAY", "STATE", "ECHS"].includes(scheme) ? "claim docket (portal-filed)"
                  : "IRDAI Part B + Part A";
                toast.success(`Claim Pack opened — ${label}`);
              } catch (e) { toast.error(e?.response?.data?.message || "Claim data fetch failed"); }
            }}
            title="Open the complete insurance Claim Pack (one print — all forms for this payer)"
            style={{ padding: "7px 14px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12 }}>
            <i className="pi pi-shield" style={{ marginRight: 6 }} />
            Claim Pack
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

      {/* B4-T09 — Stuck Triggers widget (Admin / Accountant only).
          Lists BillingTrigger rows in status="pending-review" so the
          accountant can spot revenue-leak risks and retry them with a
          single click. Hidden entirely when no rows are stuck or when
          the current role can't act on them. */}
      {canSeeStuck && stuckTriggers.length > 0 && (
        <div style={{
          background: "#fffbeb",
          border: `1px solid ${C.warn}`,
          borderRadius: 12,
          marginBottom: 14,
          overflow: "hidden",
        }}>
          <button
            type="button"
            onClick={() => setStuckOpen(o => !o)}
            style={{
              width: "100%", padding: "10px 14px",
              background: "transparent", border: "none",
              cursor: "pointer", textAlign: "left", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 10,
              borderBottom: stuckOpen ? `1px solid ${C.warn}` : "none",
            }}
          >
            <i className="pi pi-exclamation-triangle" style={{ fontSize: 16, color: C.warn }} />
            <span style={{ fontWeight: 800, color: C.warn, fontSize: 13 }}>
              Stuck Triggers ({stuckTriggers.length})
            </span>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
              · pending-review · revenue-leak risk
            </span>
            <i className="pi pi-chevron-down" style={{
              marginLeft: "auto", fontSize: 11, color: C.warn,
              transform: stuckOpen ? "rotate(0)" : "rotate(-90deg)",
              transition: "transform .15s",
            }} />
          </button>
          {stuckOpen && (
            <div style={{ padding: 0 }}>
              {stuckTriggers.map(t => (
                <div
                  key={t._id}
                  className="stuck-trigger-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 110px 1fr 70px 110px",
                    gap: 10,
                    padding: "8px 14px",
                    borderBottom: `1px solid #fde68a`,
                    alignItems: "center",
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontWeight: 700, color: C.dark, fontFamily: "'DM Mono', monospace" }}>
                    {t.kind || t.triggerType || t.serviceCode || "—"}
                  </span>
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    color: C.dark, fontWeight: 700,
                  }}>
                    {inr(t.amount ?? t.totalAmount ?? (Number(t.unitPrice || 0) * Number(t.quantity || 1)))}
                  </span>
                  <span
                    title={t.reviewReason || t.remarks || ""}
                    style={{
                      color: C.muted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {(t.reviewReason || t.remarks || "").slice(0, 80) || "—"}
                  </span>
                  <span style={{ color: C.muted, fontFamily: "'DM Mono', monospace", textAlign: "right" }}>
                    {ageMin(t.createdAt)}m
                  </span>
                  <button
                    onClick={() => retryTrigger(t._id)}
                    disabled={retryingIds.has(t._id)}
                    style={{
                      padding: "5px 10px",
                      background: C.warn, color: "#fff", border: "none",
                      borderRadius: 6, cursor: retryingIds.has(t._id) ? "wait" : "pointer",
                      fontFamily: "inherit", fontWeight: 700, fontSize: 11,
                      opacity: retryingIds.has(t._id) ? 0.7 : 1,
                    }}
                  >
                    {retryingIds.has(t._id) ? "Retrying…" : "Retry"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: `2px solid ${C.border}`, marginBottom: 14 }}>
        {[
          { id: "category", label: "Category",         icon: "pi-th-large" },
          { id: "daily",    label: "Daily Breakdown",  icon: "pi-calendar" },
          { id: "audit",    label: "Audit Trail",      icon: "pi-history" },
          // R7hr-187 (USER) — "kab kab payment ki hai patient ne"
          { id: "payments", label: "Payment Summary",  icon: "pi-wallet" },
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
          onConfirm={confirmPending} undoWindowMs={undoWindowMs} />
      )}
      {tab === "daily" && (
        <DailyView byDay={byDay} collapsed={collapsed} setCollapsed={setCollapsed}
          onUndo={openUndo} onOverride={openOverride} onCancel={openCancel}
          onConfirm={confirmPending} undoWindowMs={undoWindowMs} />
      )}
      {tab === "audit" && <AuditView triggers={triggers} />}
      {tab === "payments" && (
        <PaymentsView uhid={admission.UHID} bill={bill} refreshKey={data} onChanged={load} />
      )}

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
      {/* R7hr-186/188 — Collect Payment modal (user: "yaha se bhi to
          pending payment collect kr sakte hai"). Posts a REAL payment
          against the running bill (DRAFT included — R7hr-188 relaxed
          the backend guard; bill stays DRAFT server-side so daily
          auto-billing continues). Cash modes stay locked while the
          advance pool has unspent balance (R7al mirror). */}
      {payOpen && (
        <div onClick={(e) => { if (e.target === e.currentTarget && !payBusy) setPayOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: "min(480px, 100%)", background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.25)", fontFamily: "inherit" }}>
            <div style={{ background: "#0284c7", color: "#fff", padding: "13px 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <i className="pi pi-money-bill" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>Collect Payment — {data?.admission?.admissionNumber}</div>
                <div style={{ fontSize: 11, opacity: .9 }}>
                  Outstanding {inr(balance)} · Advance pool {inr(advanceBalance)}
                </div>
              </div>
              <button disabled={payBusy} onClick={() => setPayOpen(false)} style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(255,255,255,.2)", border: "none", color: "#fff", cursor: "pointer", fontWeight: 800 }}>×</button>
            </div>
            <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Amount (₹)</div>
                <input type="number" min="1" value={payAmt} onChange={e => setPayAmt(e.target.value)}
                  style={{ width: "100%", padding: "9px 11px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono', monospace", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {payMode === "ADVANCE" ? (
                    <button onClick={() => setPayAmt(String(Math.min(balance, advanceBalance)))} style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#f8fafc", fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      Max from advance ({inr(Math.min(balance, advanceBalance))})
                    </button>
                  ) : (
                    <button onClick={() => setPayAmt(String(balance))} style={{ padding: "3px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#f8fafc", fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      Full outstanding ({inr(balance)})
                    </button>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>Payment Mode</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {advanceBalance > 0 && (
                    <button onClick={() => { setPayMode("ADVANCE"); setPayAmt(String(Math.min(balance, advanceBalance))); }}
                      style={{ padding: "7px 13px", borderRadius: 8, border: `1.5px solid ${payMode === "ADVANCE" ? "#7c3aed" : C.border}`, background: payMode === "ADVANCE" ? "#f5f3ff" : "#fff", color: payMode === "ADVANCE" ? "#7c3aed" : C.muted, fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                      Adjust from Advance
                    </button>
                  )}
                  {["CASH", "CARD", "UPI"].map(m => {
                    const locked = advanceBalance > 0; // R7al — exhaust advance first
                    return (
                      <button key={m} disabled={locked} onClick={() => setPayMode(m)}
                        title={locked ? `₹${advanceBalance.toLocaleString("en-IN")} advance pool must be adjusted first (R7al)` : ""}
                        style={{ padding: "7px 13px", borderRadius: 8, border: `1.5px solid ${payMode === m ? "#0284c7" : C.border}`, background: payMode === m ? "#f0f9ff" : "#fff", color: locked ? "#cbd5e1" : payMode === m ? "#0284c7" : C.muted, fontWeight: 800, fontSize: 12, cursor: locked ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                        {m}
                      </button>
                    );
                  })}
                </div>
                {advanceBalance > 0 && (
                  <div style={{ fontSize: 10.5, color: "#7c3aed", marginTop: 5 }}>
                    ₹{advanceBalance.toLocaleString("en-IN")} unspent advance — cash modes unlock once the pool is exhausted (R7al).
                  </div>
                )}
              </div>
              {(payMode === "CARD" || payMode === "UPI") && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>
                    {payMode === "CARD" ? "Card last 4 / approval ref" : "UPI transaction ID"}
                  </div>
                  <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder={payMode === "CARD" ? "e.g. **6411 / APPR123" : "e.g. 4198xxxxxx"}
                    style={{ width: "100%", padding: "8px 11px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 12.5, boxSizing: "border-box", fontFamily: "inherit" }} />
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
                <button disabled={payBusy} onClick={() => setPayOpen(false)}
                  style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
                <button disabled={payBusy} onClick={collectPayment}
                  style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: payMode === "ADVANCE" ? "#7c3aed" : "#0284c7", color: "#fff", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                  {payBusy ? "Processing…" : payMode === "ADVANCE" ? "Adjust from Advance" : `Collect ${payMode}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

function TriggerRow({ t, onUndo, onOverride, onCancel, onConfirm, undoWindowMs }) {
  const { can } = useAuth();
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
        {t.status === "pending" && onConfirm && can("billing.write") && (
          <button
            onClick={() => onConfirm(t)}
            title="Staff/doctor se confirm karke charge ko bill par chadhayein"
            style={{
              display: "block", margin: "4px auto 0", padding: "3px 8px",
              border: "1px solid #f59e0b", borderRadius: 6, background: "#fffbeb",
              color: "#a16207", fontSize: 10, fontWeight: 800, cursor: "pointer",
              fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            <i className="pi pi-check-circle" style={{ marginRight: 3, fontSize: 9 }} />
            Confirm &amp; Bill
          </button>
        )}
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

function CategoryView({ byCategory, collapsed, setCollapsed, onUndo, onOverride, onCancel, onConfirm, undoWindowMs }) {
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
                      onConfirm={onConfirm} undoWindowMs={undoWindowMs} />
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

function DailyView({ byDay, collapsed, setCollapsed, onUndo, onOverride, onCancel, onConfirm, undoWindowMs }) {
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
              background: group.dayN === 1 ? "#eef2ff" : "#f8fafc",
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
                      onConfirm={onConfirm} undoWindowMs={undoWindowMs} />
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

/* ── R7hr-187 — Payment Summary tab ──────────────────────────────────
   User: "ek 'Payment Summary' tab bhi banana chahiye taki hum dekh
   sake kab kab payment ki hai patient ne."
   One read-only chronological money trail for this patient (UHID):
     • Advance deposits        — PatientAdvance rows (admission advance
                                 + R7hr-186 interim ledger collections)
     • Adjusted to bill        — each deposit's appliedTo[] entries
     • Bill payments           — bill.payments[] post final bill
                                 (ADVANCE_ADJUSTMENT rows skipped: that
                                 money already shows as "Adjusted to
                                 Bill" via appliedTo — listing both
                                 would double-count the trail)
     • Refunds                 — refundedAt/refundedAmount on deposits
   Nothing here mutates billing state. */
function PaymentsView({ uhid, bill, refreshKey, onChanged }) {
  const [advs, setAdvs] = useState(null);   // null = loading
  const [err,  setErr]  = useState("");
  // R7hr-192 (G3) — Void/Refund actions on bill-payment rows. The
  // Billing Counter no longer shows IPD bills (R7hr-189), so this tab
  // is the only place a cashier can reverse a typo'd live-ledger
  // collection. Backend gates: void = billing.undo (own payment,
  // 15-min window; Accountant/Admin any), refund = billing.refund.
  const { can } = useAuth();
  const [actBusy, setActBusy] = useState(false);
  const voidPay = async (r) => {
    const reason = window.prompt(`Void ₹${r.amount.toLocaleString("en-IN")} ${r.mode} payment? Reason:`);
    if (!reason || !reason.trim()) return;
    setActBusy(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/billing/${bill._id}/payment/${r.pid}/void`, { reason: reason.trim() });
      toast.success("Payment voided — reversal row added");
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || "Void failed");
    } finally { setActBusy(false); }
  };
  const refundPay = async (r) => {
    const amtStr = window.prompt(`Refund amount (max ₹${r.amount.toLocaleString("en-IN")}):`, String(r.amount));
    if (amtStr == null) return;
    const ramt = Math.round(Number(amtStr) * 100) / 100;
    if (!ramt || ramt <= 0) { toast.error("Enter a valid refund amount"); return; }
    const reason = window.prompt("Refund reason:");
    if (!reason || !reason.trim()) return;
    setActBusy(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/billing/${bill._id}/refund`, {
        amount: ramt, reason: reason.trim(), mode: r.mode || "CASH",
      });
      toast.success(`₹${ramt.toLocaleString("en-IN")} refund recorded`);
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.message || e.message || "Refund failed");
    } finally { setActBusy(false); }
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        setErr("");
        const r = await axios.get(`${API_ENDPOINTS.BILLING}/advance/uhid/${encodeURIComponent(uhid)}`);
        // Endpoint shape: { success, data: <summary>, advances: [rows] }
        const rows = Array.isArray(r.data?.advances) ? r.data.advances
                   : Array.isArray(r.data?.data) ? r.data.data : [];
        if (!dead) setAdvs(rows);
      } catch (e) {
        if (!dead) {
          setAdvs([]);
          setErr(e?.response?.data?.message || e.message || "Failed to load advance ledger");
        }
      }
    })();
    return () => { dead = true; };
  }, [uhid, refreshKey]);

  const num = (v) => {
    if (v == null) return 0;
    if (typeof v === "object") v = v.$numberDecimal ?? (typeof v.toString === "function" ? v.toString() : NaN);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const money = (n) => `₹${num(n).toLocaleString("en-IN")}`;
  const dt = (d) => d
    ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

  if (advs === null) return (
    <div style={{ padding: 40, textAlign: "center", color: C.muted, fontStyle: "italic" }}>
      Loading payment history…
    </div>
  );

  // ── Unified trail rows ─────────────────────────────────────────
  const rows = [];
  for (const a of advs) {
    rows.push({
      kind: "DEPOSIT", at: a.paidAt || a.createdAt, receipt: a.receiptNumber,
      mode: a.paymentMode, ref: a.transactionId, amount: num(a.amount),
      by: a.receivedBy, note: a.remarks || "", status: a.status,
    });
    for (const ap of (a.appliedTo || [])) {
      rows.push({
        kind: "ADJUSTED", at: ap.appliedAt, receipt: a.receiptNumber,
        mode: "ADVANCE", amount: num(ap.amount), by: ap.appliedBy,
        note: ap.billNumber ? `Adjusted into bill ${ap.billNumber}` : "Adjusted into bill",
      });
    }
    if (a.refundedAt && num(a.refundedAmount) > 0) {
      rows.push({
        kind: "REFUND", at: a.refundedAt, receipt: a.receiptNumber,
        mode: "CASH", amount: num(a.refundedAmount), by: a.refundedBy,
        note: a.refundReason || "Advance refunded",
      });
    }
  }
  for (const p of (bill?.payments || [])) {
    if (p.paymentMode === "ADVANCE_ADJUSTMENT") continue; // shown via appliedTo rows
    if (num(p.amount) <= 0) continue; // void-reversal negative rows — original row carries the VOIDED chip
    rows.push({
      // R7hr-188 — interim payments land on the still-DRAFT live bill,
      // which has no billNumber yet; label the source instead of "—".
      kind: "PAYMENT", at: p.paidAt, receipt: bill?.billNumber || "DRAFT (live)",
      mode: p.paymentMode, ref: p.transactionId, amount: num(p.amount),
      by: p.receivedBy, note: p.remarks || "",
      voided: !!p.voidedAt, voidedBy: p.voidedBy,
      pid: p._id, // R7hr-192 (G3) — anchor for void/refund actions
    });
  }
  rows.sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));

  // ── Tab KPIs (CANCELLED deposits excluded from money totals) ───
  const liveAdvs   = advs.filter(a => a.status !== "CANCELLED");
  const totDeposit = liveAdvs.reduce((s, a) => s + num(a.amount), 0);
  const totApplied = liveAdvs.reduce((s, a) => s + num(a.appliedAmount), 0);
  const totRefund  = liveAdvs.reduce((s, a) => s + num(a.refundedAmount), 0);
  const totPool    = liveAdvs.reduce((s, a) =>
    s + num(a.remainingAmount ?? (num(a.amount) - num(a.appliedAmount) - num(a.refundedAmount))), 0);
  const totBillPay = (bill?.payments || [])
    .filter(p => p.paymentMode !== "ADVANCE_ADJUSTMENT" && !p.voidedAt && num(p.amount) > 0)
    .reduce((s, p) => s + num(p.amount), 0);

  const KIND = {
    DEPOSIT:  { label: "Advance Deposit",  bg: "#ecfdf5", fg: "#059669" },
    ADJUSTED: { label: "Adjusted to Bill", bg: "#f5f3ff", fg: "#7c3aed" },
    PAYMENT:  { label: "Bill Payment",     bg: "#f0f9ff", fg: "#0284c7" },
    REFUND:   { label: "Refund",           bg: "#fef2f2", fg: "#dc2626" },
  };
  const chip = (k) => (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, background: KIND[k].bg, color: KIND[k].fg, fontSize: 10, fontWeight: 800, letterSpacing: ".3px", whiteSpace: "nowrap" }}>
      {KIND[k].label}
    </span>
  );
  const kpi = (label, value, fg) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: fg }}>{money(value)}</span>
    </div>
  );

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
        {kpi("Advance deposited", totDeposit, "#059669")}
        {kpi("Adjusted to bills", totApplied, "#7c3aed")}
        {kpi("Bill payments", totBillPay, "#0284c7")}
        {kpi("Refunded", totRefund, "#dc2626")}
        {kpi("Pool available", totPool, C.dark)}
      </div>
      {err && (
        <div style={{ padding: "8px 16px", fontSize: 11.5, color: "#dc2626", borderBottom: `1px solid ${C.border}` }}>{err}</div>
      )}
      {!rows.length ? (
        <div style={{ padding: 40, textAlign: "center", color: C.muted, fontStyle: "italic" }}>
          No payments yet — use Collect Payment or Take Advance to record the first collection.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc", fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
              <th style={th(140)}>When</th>
              <th style={th(130)}>Type</th>
              <th style={th(140)}>Receipt / Bill No</th>
              <th style={th(90)}>Mode</th>
              <th style={{ ...th(110), textAlign: "right" }}>Amount</th>
              <th style={th(150)}>By</th>
              <th style={th()}>Remarks</th>
              <th style={th(120)}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${C.border}`, opacity: r.voided ? .55 : 1 }}>
                <td style={{ padding: "8px 10px", fontSize: 11.5, whiteSpace: "nowrap", color: C.dark }}>{dt(r.at)}</td>
                <td style={{ padding: "8px 10px" }}>
                  {chip(r.kind)}
                  {r.kind === "DEPOSIT" && r.status && r.status !== "ACTIVE" && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, marginTop: 3 }}>{r.status.replace(/_/g, " ")}</div>
                  )}
                  {r.voided && (
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#dc2626", marginTop: 3 }}>VOIDED{r.voidedBy ? ` by ${r.voidedBy}` : ""}</div>
                  )}
                </td>
                <td style={{ padding: "8px 10px", fontSize: 11.5, fontFamily: "'DM Mono', monospace", color: C.dark }}>{r.receipt || "—"}</td>
                <td style={{ padding: "8px 10px", fontSize: 11.5, fontWeight: 700, color: C.dark }}>
                  {r.mode || "—"}
                  {r.ref ? <div style={{ fontSize: 9.5, color: C.muted, fontWeight: 500 }}>{r.ref}</div> : null}
                </td>
                <td style={{
                  padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 800,
                  fontSize: 12.5, fontFamily: "'DM Mono', monospace",
                  color: r.kind === "REFUND" ? "#dc2626" : r.kind === "ADJUSTED" ? "#7c3aed" : C.dark,
                  textDecoration: r.voided ? "line-through" : "none",
                }}>
                  {r.kind === "REFUND" ? `− ${money(r.amount)}` : money(r.amount)}
                </td>
                <td style={{ padding: "8px 10px", fontSize: 11.5, color: C.dark }}>{r.by || "—"}</td>
                <td style={{ padding: "8px 10px", fontSize: 11, color: C.muted }}>{r.note || "—"}</td>
                <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                  {r.kind === "PAYMENT" && !r.voided && r.pid && (
                    <>
                      {can("billing.undo") && (
                        <button disabled={actBusy} onClick={() => voidPay(r)}
                          title="Void this payment (15-min cashier window; Accountant/Admin anytime)"
                          style={{ padding: "3px 9px", marginRight: 5, borderRadius: 6, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          Void
                        </button>
                      )}
                      {can("billing.refund") && (
                        <button disabled={actBusy} onClick={() => refundPay(r)}
                          title="Record a refund against this bill"
                          style={{ padding: "3px 9px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#f8fafc", color: C.muted, fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          Refund
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
